// Cliente de la API de Fracttal (OAuth 2.0 - Credenciales de Cliente)
// Docs: https://api.fracttal.com/reference/oauth-2

const TOKEN_URL =
  process.env.FRACTTAL_TOKEN_URL ?? "https://one.fracttal.com/oauth/token";
const BASE_URL =
  process.env.FRACTTAL_BASE_URL ?? "https://app.fracttal.com/api";

// ---------- Tipos ----------

export interface FracttalResponse<T> {
  success: boolean;
  message: string;
  data: T;
  total?: number | string;
}

export interface LastData {
  date: string;
  value: number;
  accumulated_value: number;
}

export interface Meter {
  id: number;
  active: boolean;
  description: string;
  serial: string;
  is_counter: boolean;
  counter_value: number;
  last_data: LastData | null;
  units_description: string;
  units_code: string;
  items_description: string;
  parent_description?: string;
  items_parent_description?: string;
  min_value: number | null;
  max_value: number | null;
  code: string;
  items_code?: string;
  code_parent_location?: string;
  tasks_description?: string;
  last_value_trigger?: string | null;
  last_date_maintenance?: string | null;
}

export interface MeterReading {
  id_meter: number;
  date_reading: string;
  date: string;
  data: LastData;
  units_description: string;
  units_code: string;
  trigger_run: boolean;
  source: "API" | "WORK_ORDER" | "MANUAL";
}

export interface SensorGroup {
  /** Código del sub-activo (sensor), ej. CLL, RINT, MLC */
  code: string;
  description: string;
  parentPath: string;
  meters: Meter[];
}

export interface Asset {
  id: number;
  active: boolean;
  code: string;
  description: string;
  /** 1=Ubicación, 2=Equipo, 3=Herramienta, 4=Repuesto, 5=Digital */
  id_type_item: number;
  field_1: string | null; // Nombre
  field_2: string | null; // Fabricante (equipos)
  field_3: string | null; // Modelo (equipos)
  parent_description: string | null;
  location_code: string | null;
  available: boolean;
}

// ---------- Caché en memoria de listados (activos / sensores) ----------
// Fracttal pagina de a cientos de registros y cada página es una llamada
// HTTP en serie: listar activos o sensores puede tomar varios segundos.
// Como el catálogo de equipos/sensores casi no cambia minuto a minuto, se
// guarda el resultado un rato corto para que abrir el wizard varias veces
// seguidas (o que varios ingenieros abran el mismo activo) no dispare la
// consulta completa cada vez.
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

interface EntradaCache<T> {
  data: T;
  expiresAt: number;
}

const cacheActivos = new Map<string, EntradaCache<Asset[]>>();
const cacheSensores = new Map<string, EntradaCache<SensorGroup[]>>();

function leerCache<T>(mapa: Map<string, EntradaCache<T>>, clave: string): T | null {
  const entrada = mapa.get(clave);
  if (!entrada) return null;
  if (Date.now() > entrada.expiresAt) {
    mapa.delete(clave);
    return null;
  }
  return entrada.data;
}

function guardarCache<T>(
  mapa: Map<string, EntradaCache<T>>,
  clave: string,
  data: T
): void {
  mapa.set(clave, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------- Token OAuth con caché en memoria ----------

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const key = process.env.FRACTTAL_CLIENT_KEY;
  const secret = process.env.FRACTTAL_CLIENT_SECRET;
  if (!key || !secret) {
    throw new Error(
      "Faltan las variables FRACTTAL_CLIENT_KEY / FRACTTAL_CLIENT_SECRET"
    );
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${key}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Error al obtener token de Fracttal: ${res.status}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.token;
}

// ---------- Fetch genérico ----------

async function fracttalFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<FracttalResponse<T>> {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (res.status === 401) {
    // token expirado a media vida: invalidar caché y reintentar una vez
    cachedToken = null;
    return fracttalFetch<T>(path, init);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Fracttal ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as FracttalResponse<T>;
}

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== ""
  );
  if (entries.length === 0) return "";
  return (
    "?" +
    entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")
  );
}

// ---------- Endpoint de activos ----------

/** GET /items/ — activos con filtros (location_code, item_type, is_tree…) */
export async function getItems(params: {
  code?: string;
  location_code?: string;
  item_type?: number;
  active?: boolean;
  is_tree?: boolean;
  start?: number;
  limit?: number;
}): Promise<FracttalResponse<Asset[]>> {
  return fracttalFetch<Asset[]>(
    `/items/${qs(params as Record<string, string | number | undefined>)}`
  );
}

type ParamsPaginables = {
  code?: string;
  location_code?: string;
  item_type?: number;
  active?: boolean;
  is_tree?: boolean;
};

/**
 * Trae TODAS las páginas de /items/ para un filtro dado.
 *
 * Antes se pedía página por página en serie (cada `await` esperaba a la
 * anterior), lo que con listados grandes (activo con muchos sub-equipos o
 * `is_tree=true` sobre una ubicación raíz) podía encadenar hasta 10 llamadas
 * HTTP seguidas y superar el límite de 60s de la función serverless.
 *
 * Ahora se pide la primera página, se lee `total` de la respuesta y —si
 * Fracttal lo informa— el resto de páginas se piden todas EN PARALELO. Si no
 * informa `total`, se cae de vuelta al modo secuencial (más lento pero
 * siempre correcto).
 */
async function paginarActivos(
  params: ParamsPaginables,
  limitPagina: number,
  maxPages: number
): Promise<Asset[]> {
  const primera = await getItems({ ...params, start: 0, limit: limitPagina });
  const datos = primera.data ?? [];
  if (datos.length < limitPagina) return datos; // ya vino todo en una sola página

  const totalCrudo = primera.total;
  const total =
    typeof totalCrudo === "string" ? parseInt(totalCrudo, 10) : totalCrudo;

  if (total && Number.isFinite(total)) {
    const totalPaginas = Math.min(Math.ceil(total / limitPagina), maxPages);
    if (totalPaginas <= 1) return datos;

    const indices = Array.from({ length: totalPaginas - 1 }, (_, i) => i + 1);
    const resto = await Promise.all(
      indices.map((i) =>
        getItems({ ...params, start: i * limitPagina, limit: limitPagina })
      )
    );
    const todos = [...datos];
    for (const pagina of resto) todos.push(...(pagina.data ?? []));
    return todos;
  }

  // Fallback: Fracttal no informó `total` -> seguimos en serie como antes.
  const todos = [...datos];
  let start = limitPagina;
  for (let i = 1; i < maxPages; i++) {
    const pagina = await getItems({ ...params, start, limit: limitPagina });
    todos.push(...(pagina.data ?? []));
    if (!pagina.data || pagina.data.length < limitPagina) break;
    start += limitPagina;
  }
  return todos;
}

/**
 * Lista los EQUIPOS (id_type_item = 2) bajo una ubicación, incluyendo toda
 * la jerarquía descendiente (is_tree=true) si hace falta.
 */
export async function getAssetsForLocation(
  locationCode: string,
  opciones: { forzar?: boolean } = {}
): Promise<Asset[]> {
  if (!opciones.forzar) {
    const cacheado = leerCache(cacheActivos, locationCode);
    if (cacheado) return cacheado;
  }

  const LIMIT_PAGINA = 300; // páginas grandes = menos llamadas en total
  const MAX_PAGES = 10; // tope de seguridad (3000 registros)

  // 1) Equipos hijos directos de la ubicación (rápido)
  let all = await paginarActivos(
    { location_code: locationCode, item_type: 2, active: true },
    LIMIT_PAGINA,
    MAX_PAGES
  );

  // 2) Si no hay hijos directos, buscar en toda la jerarquía descendiente
  if (all.length === 0) {
    all = await paginarActivos(
      { location_code: locationCode, item_type: 2, active: true, is_tree: true },
      LIMIT_PAGINA,
      MAX_PAGES
    );
  }

  // Excluir sub-activos (sensores): un equipo cuyo padre (location_code)
  // es OTRO equipo del listado es un sub-activo, no un equipo principal.
  const codigosEquipos = new Set(all.map((a) => a.code));
  const resultado = all
    .filter((a) => !a.location_code || !codigosEquipos.has(a.location_code))
    .sort((a, b) =>
      (a.field_1 ?? a.description).localeCompare(b.field_1 ?? b.description)
    );

  guardarCache(cacheActivos, locationCode, resultado);
  return resultado;
}

// ---------- Endpoints de medidores ----------

/** GET /meters/ — medidores por activo, serial o localización padre */
export async function getMeters(params: {
  code?: string;
  serial?: string;
  location_code?: string;
  start?: number;
  limit?: number;
}): Promise<FracttalResponse<Meter[]>> {
  return fracttalFetch<Meter[]>(`/meters/${qs(params)}`);
}

/** GET /meters_advanced/{code} — incluye tarea asociada y último mantenimiento */
export async function getMetersAdvanced(
  code: string,
  params: {
    serial?: string;
    code_parent_location?: string;
    tasks_description?: string;
    start?: number;
    limit?: number;
  } = {}
): Promise<FracttalResponse<Meter[]>> {
  return fracttalFetch<Meter[]>(
    `/meters_advanced/${encodeURIComponent(code)}${qs(params)}`
  );
}

/** GET /meters_reading/ — historial de lecturas (fallback a meters_reading_list/) */
export async function getMeterReadings(params: {
  code?: string;
  serial?: string;
  type_date?: "date" | "date_reading";
  since?: string;
  until?: string;
  start?: number;
  limit?: number;
}): Promise<FracttalResponse<MeterReading[]>> {
  try {
    return await fracttalFetch<MeterReading[]>(`/meters_reading/${qs(params)}`);
  } catch {
    // La doc muestra dos rutas posibles; probamos la alternativa
    return fracttalFetch<MeterReading[]>(`/meters_reading_list/${qs(params)}`);
  }
}

/** POST /meters/ — crear medidor (auto-provisión de puntos H/V/A) */
export async function createMeter(body: {
  description: string;
  item_code: string;
  unit_code: string;
  serial?: string;
  is_counter?: boolean;
}): Promise<FracttalResponse<Meter>> {
  return fracttalFetch<Meter>(`/meters/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** PUT /meter_reading/{code} — insertar lectura (code = código del SUB-activo) */
export async function insertReading(
  assetCode: string,
  body: {
    date: string;
    value: number;
    serial: string;
    is_historical?: boolean;
  }
): Promise<FracttalResponse<{ meter: Meter; tasks: { task: string }[] }>> {
  return fracttalFetch(`/meter_reading/${encodeURIComponent(assetCode)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// ---------- Lógica de negocio ----------

/**
 * Descubre los sensores (sub-activos) de un activo principal.
 * Los medidores NO cuelgan del activo principal sino de sus hijos:
 *   MOLINO → CLL, CLC, REDUCTOR (RINT/RBAJ/RALT), MOTOR MOLINO (MLC/MLL)
 * `location_code` trae en una sola llamada los medidores de todas las hijas.
 */
export async function getSensorsForAsset(
  assetCode: string
): Promise<SensorGroup[]> {
  const cacheado = leerCache(cacheSensores, assetCode);
  if (cacheado) return cacheado;

  const LIMIT_PAGINA = 300; // páginas grandes = menos llamadas en serie
  const all: Meter[] = [];

  // 1) medidores de las ubicaciones hijas (paginado en serie: cada página
  //    depende de la anterior) y 2) medidores directos del activo, en
  //    paralelo entre sí porque no dependen uno del otro.
  async function medidoresDeHijas(): Promise<Meter[]> {
    const acumulado: Meter[] = [];
    let start = 0;
    for (;;) {
      const page = await getMeters({
        location_code: assetCode,
        start,
        limit: LIMIT_PAGINA,
      });
      acumulado.push(...(page.data ?? []));
      if (!page.data || page.data.length < LIMIT_PAGINA) break;
      start += LIMIT_PAGINA;
    }
    return acumulado;
  }

  const [hijas, direct] = await Promise.all([
    medidoresDeHijas(),
    getMeters({ code: assetCode, limit: LIMIT_PAGINA }),
  ]);
  all.push(...hijas);
  for (const m of direct.data ?? []) {
    if (!all.some((x) => x.id === m.id)) all.push(m);
  }

  // 3) agrupar por sub-activo (code del ítem dueño del medidor)
  const groups = new Map<string, SensorGroup>();
  for (const m of all) {
    if (!m.active) continue;
    const code = m.code || m.items_code || "SIN-CODIGO";
    if (!groups.has(code)) {
      groups.set(code, {
        code,
        description: m.items_description ?? code,
        parentPath: m.parent_description ?? m.items_parent_description ?? "",
        meters: [],
      });
    }
    groups.get(code)!.meters.push(m);
  }

  const resultado = [...groups.values()]
    .flatMap(desarmarSiEsPlano)
    .sort((a, b) => a.code.localeCompare(b.code));
  guardarCache(cacheSensores, assetCode, resultado);
  return resultado;
}

// Cuántas unidades distintas puede tener razonablemente UN punto físico de
// vibración (ej. velocidad in/s + aceleración g + temperatura °C = 3). Un
// grupo con más unidades distintas que esto ya no representa "un sensor",
// sino un activo donde Fracttal no separó los instrumentos en sub-activos
// (ej. una bomba con voltaje/corriente/potencia/vibración/temperatura, TODOS
// colgando del mismo código). En ese caso no tiene sentido colapsar 12
// medidores en 1 solo pin: se ubica cada medidor por separado.
const MAX_UNIDADES_POR_PUNTO = 3;

/**
 * Si un grupo mezcla más tipos de unidad de los esperables para un solo
 * punto de sensor, lo "desarma" en un grupo por medidor (cada uno ubicable
 * por separado). Si no, lo deja igual que hoy (1 grupo = 1 pin).
 */
function desarmarSiEsPlano(grupo: SensorGroup): SensorGroup[] {
  const unidades = new Set(grupo.meters.map((m) => m.units_code));
  if (unidades.size <= MAX_UNIDADES_POR_PUNTO) return [grupo];

  return grupo.meters.map((m) => ({
    code: `${grupo.code}::${m.id}`,
    description: m.description,
    parentPath: grupo.parentPath,
    meters: [m],
  }));
}

// ---------- Clasificación y orden de medidores ----------
// (compartido por el wizard de informes y la vista de Activos monitoreados)

/** ¿El medidor es de velocidad? (por unidad o por serial tipo CLC_velX) */
export function esVelocidad(m: Meter): boolean {
  return (
    m.units_code === "in/s" ||
    m.units_code === "mm/s" ||
    m.serial.toLowerCase().includes("vel")
  );
}

/** Categoría del medidor: velocidad, aceleración o temperatura */
export function categoriaDeMedidor(m: Meter): "vel" | "acel" | "temp" {
  if (esVelocidad(m)) return "vel";
  if (m.units_code === "g" || m.serial.toLowerCase().includes("accel"))
    return "acel";
  return "temp";
}

/** Convierte mm/s (dato crudo de Fracttal) a in/s. 1 in = 25.4 mm */
export function mmsAInsNumero(mms: number): number {
  // 4 decimales máximo, sin ceros de sobra (ej. 4.48 → 0.1764)
  return Number((mms / 25.4).toFixed(4));
}

/** Convierte mm/s (dato crudo de Fracttal) a in/s, como texto para mostrar. */
export function mmsAIns(mms: number): string {
  return String(mmsAInsNumero(mms));
}

// ---------- Niveles de severidad (vista en vivo de Activos monitoreados) ----------
// Mismos límites de velocidad que el informe manual (en in/s). La
// temperatura no tiene un límite oficial del informe; se usa un rango
// definido por Diego para la vista en vivo (rojo desde 70°C).

export type NivelSeveridad = "normal" | "alerta" | "critico";

export function nivelVelocidad(inPorSeg: number): NivelSeveridad {
  if (inPorSeg < 0.2) return "normal";
  if (inPorSeg < 0.3) return "alerta";
  return "critico";
}

export function nivelTemperatura(celsius: number): NivelSeveridad {
  if (celsius < 55) return "normal";
  if (celsius < 70) return "alerta";
  return "critico";
}

/** Posición del punto: extrae "Horizontal/Vertical/Axial" de la descripción */
export function posicionDeMedidor(m: Meter): string {
  const match = m.description.match(/\((.+?)\)/);
  if (match) return match[1];
  const s = m.serial.toLowerCase();
  if (s.endsWith("x")) return "X";
  if (s.endsWith("y")) return "Y";
  if (s.endsWith("z")) return "Z";
  return m.description;
}

/** Orden fijo del informe: Horizontal → Vertical → Axial */
export function ordenarPorPosicion(meters: Meter[]): Meter[] {
  const peso = (m: Meter) => {
    const p = posicionDeMedidor(m).toLowerCase();
    if (p.startsWith("h")) return 0; // Horizontal
    if (p.startsWith("v")) return 1; // Vertical
    return 2; // Axial (o cualquier otra)
  };
  return [...meters].sort((a, b) => peso(a) - peso(b));
}

/** Velocidades primero (como en el informe), luego aceleraciones y temperatura */
export function ordenarMedidores(meters: Meter[]): Meter[] {
  const peso = (m: Meter) =>
    m.units_code === "in/s" ? 0 : m.units_code === "g" ? 1 : 2;
  return [...meters].sort(
    (a, b) => peso(a) - peso(b) || a.description.localeCompare(b.description)
  );
}
