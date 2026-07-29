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

/**
 * Lista los EQUIPOS (id_type_item = 2) bajo una ubicación, incluyendo toda
 * la jerarquía descendiente (is_tree=true). Pagina de 100 en 100.
 */
export async function getAssetsForLocation(
  locationCode: string
): Promise<Asset[]> {
  const all: Asset[] = [];
  const MAX_PAGES = 10; // tope de seguridad (1000 registros)

  // 1) Equipos hijos directos de la ubicación (rápido)
  let start = 0;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await getItems({
      location_code: locationCode,
      item_type: 2,
      active: true,
      start,
      limit: 100,
    });
    all.push(...(page.data ?? []));
    if (!page.data || page.data.length < 100) break;
    start += 100;
  }

  // 2) Si no hay hijos directos, buscar en toda la jerarquía descendiente
  if (all.length === 0) {
    start = 0;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await getItems({
        location_code: locationCode,
        item_type: 2,
        active: true,
        is_tree: true,
        start,
        limit: 100,
      });
      all.push(...(page.data ?? []));
      if (!page.data || page.data.length < 100) break;
      start += 100;
    }
  }

  // Excluir sub-activos (sensores): un equipo cuyo padre (location_code)
  // es OTRO equipo del listado es un sub-activo, no un equipo principal.
  const codigosEquipos = new Set(all.map((a) => a.code));
  return all
    .filter((a) => !a.location_code || !codigosEquipos.has(a.location_code))
    .sort((a, b) =>
      (a.field_1 ?? a.description).localeCompare(b.field_1 ?? b.description)
    );
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
  const all: Meter[] = [];

  // 1) medidores de las ubicaciones hijas
  let start = 0;
  for (;;) {
    const page = await getMeters({
      location_code: assetCode,
      start,
      limit: 100,
    });
    all.push(...(page.data ?? []));
    if (!page.data || page.data.length < 100) break;
    start += 100;
  }

  // 2) medidores directos del activo (por si también tiene propios)
  const direct = await getMeters({ code: assetCode, limit: 100 });
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

  return [...groups.values()].sort((a, b) => a.code.localeCompare(b.code));
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
