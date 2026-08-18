// Cálculo del semáforo (criterio ISO peor caso) de un activo a partir de una
// lista de sensores ya elegidos por el usuario.
//
// Vive aquí —y no dentro de una ruta— porque lo consumen dos vistas distintas
// con listas de sensores de origen diferente:
//   - /api/activos/semaforos → sensores de `sensores_posicionados` (cartillas)
//   - /api/mapa/semaforos    → sensores de `mapa_sensores` (pestaña Mapa)
// Manteniendo un único cálculo, cartilla, vista en vivo y mapa nunca se
// contradicen entre sí.
//
// Reglas (paso 1: solo vibración):
//   - color de un sensor = el peor de sus ejes de velocidad H/V/A
//   - color del activo   = el peor de sus sensores de vibración
//   - la temperatura y los medidores genéricos (voltaje, corriente…) NO entran
import {
  getSensorsForAsset,
  getMeterReadings,
  esVelocidad,
  mmsAInsNumero,
  nivelVelocidad,
  posicionDeMedidor,
  type MeterReading,
  type SensorGroup,
  type NivelSeveridad,
} from "@/lib/fracttal";

// Mismos parámetros que la vista en vivo (VistaActivoVivo → /api/fracttal/
// averages): promedio de las últimas N lecturas dentro de una ventana de 45
// días. N debe COINCIDIR con la vista en vivo para que la cartilla y el
// detalle muestren siempre el mismo color:
//   - sensores agrupados (molino, H/V/A en un punto)  → 10 lecturas
//   - sensores desarmados (bomba de lodos, "::")      → 5 lecturas
const N_LECTURAS_AGRUPADO = 10;
const N_LECTURAS_DESARMADO = 5;
const DIAS_VENTANA = 45;
const MAX_PAGES = 6; // tope de seguridad (600 lecturas por sensor)

export interface EjeEnRojo {
  /** Abreviatura del eje: H, V o A. */
  eje: string;
  /** Promedio en in/s (ya convertido). */
  valor: number;
}

export interface SensorEnRojo {
  code: string;
  /** Nombre para mostrar (label guardado por el usuario o el code). */
  label: string;
  /** Ejes que dispararon el rojo, con su valor en in/s. */
  ejes: EjeEnRojo[];
}

export interface SensorSemaforo {
  code: string;
  label: string;
  /** Peor nivel entre sus ejes de velocidad; null = sin datos. */
  nivel: NivelSeveridad | null;
}

export interface SemaforoActivo {
  /** Peor nivel entre los sensores de vibración; null = sin datos. */
  nivel: NivelSeveridad | null;
  /** Sensores de vibración (con medidores H/V/A) considerados. */
  sensoresEvaluados: number;
  /** De esos, cuántos tuvieron lecturas para calcular su color. */
  sensoresConDato: number;
  /** Desglose por color (solo sensores con dato). */
  porNivel: Record<NivelSeveridad, number>;
  /** Sensores con al menos un eje en rojo, para identificarlos en la cartilla. */
  sensoresEnRojo: SensorEnRojo[];
  /** Nivel de CADA sensor evaluado (lo usa el mapa para pintar cada punto). */
  sensores: SensorSemaforo[];
}

/** Sensor tal como lo eligió el usuario (viene de nuestra BD, no de Fracttal). */
export interface SensorElegido {
  code: string;
  label: string;
}

export const SEMAFORO_VACIO: SemaforoActivo = {
  nivel: null,
  sensoresEvaluados: 0,
  sensoresConDato: 0,
  porNivel: { normal: 0, alerta: 0, critico: 0 },
  sensoresEnRojo: [],
  sensores: [],
};

const PESO: Record<NivelSeveridad, number> = {
  normal: 0,
  alerta: 1,
  critico: 2,
};

/** Promedio de las últimas N lecturas por medidor de un sensor (sub-activo). */
async function promediosPorMedidor(
  code: string,
  nLecturas: number,
  serial?: string
): Promise<Map<number, number>> {
  const since = new Date(Date.now() - DIAS_VENTANA * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const todas: MeterReading[] = [];
  let start = 0;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await getMeterReadings({
      code,
      serial,
      type_date: "date_reading",
      since,
      start,
      limit: 100,
    });
    todas.push(...(page.data ?? []));
    if (!page.data || page.data.length < 100) break;
    start += 100;
  }

  const porMedidor = new Map<number, MeterReading[]>();
  for (const r of todas) {
    if (!r.data || typeof r.data.value !== "number") continue;
    const lista = porMedidor.get(r.id_meter) ?? [];
    lista.push(r);
    porMedidor.set(r.id_meter, lista);
  }

  const promedios = new Map<number, number>();
  for (const [idMeter, lecturas] of porMedidor) {
    lecturas.sort(
      (a, b) =>
        new Date(a.date_reading ?? a.date).getTime() -
        new Date(b.date_reading ?? b.date).getTime()
    );
    const ultimas = lecturas.slice(-nLecturas);
    const suma = ultimas.reduce((acc, r) => acc + r.data.value, 0);
    promedios.set(idMeter, suma / ultimas.length);
  }
  return promedios;
}

/** Abreviatura de eje para la cartilla: Horizontal→H, Vertical→V, Axial→A. */
function abreviaturaEje(posicion: string): string {
  const p = posicion.trim();
  return p ? p[0].toUpperCase() : "?";
}

interface EvaluacionSensor {
  /** Peor nivel entre los ejes con dato; null = sin lecturas en la ventana. */
  nivel: NivelSeveridad | null;
  /** Ejes en rojo (≥ 0.3 in/s), con su valor convertido. */
  ejesRojos: EjeEnRojo[];
}

/**
 * Evalúa un sensor: el peor de sus ejes de velocidad H/V/A (misma
 * semaforización que la vista en vivo: mm/s → in/s → nivelVelocidad),
 * más el detalle de qué ejes están en rojo.
 */
async function evaluarSensor(grupo: SensorGroup): Promise<EvaluacionSensor> {
  const velocidades = grupo.meters.filter(esVelocidad);
  if (velocidades.length === 0) return { nivel: null, ejesRojos: [] };

  // Sensor "desarmado" (code sintético ACTIVO::idMedidor): las lecturas se
  // piden con el code real del activo dueño + el serial del medidor, y con
  // el MISMO N que usa la vista en vivo (5) para que ambos coincidan.
  const esDesarmado = grupo.code.includes("::");
  const promedios = esDesarmado
    ? await promediosPorMedidor(
        grupo.meters[0].code,
        N_LECTURAS_DESARMADO,
        grupo.meters[0].serial
      )
    : await promediosPorMedidor(grupo.code, N_LECTURAS_AGRUPADO);

  let peor: NivelSeveridad | null = null;
  const ejesRojos: EjeEnRojo[] = [];
  for (const m of velocidades) {
    const avg = promedios.get(m.id);
    if (avg == null) continue;
    const enPulgadas = mmsAInsNumero(avg);
    const nivel = nivelVelocidad(enPulgadas);
    if (peor === null || PESO[nivel] > PESO[peor]) peor = nivel;
    if (nivel === "critico") {
      ejesRojos.push({
        eje: abreviaturaEje(posicionDeMedidor(m)),
        valor: enPulgadas,
      });
    }
  }
  return { nivel: peor, ejesRojos };
}

/**
 * Semáforo global de un activo considerando SOLO los sensores indicados
 * (los que el usuario posicionó, sean de la cartilla o del mapa).
 * Los sensores que no existan en Fracttal o que no tengan medidores de
 * velocidad simplemente se ignoran.
 */
export async function semaforoDeActivo(
  activoCode: string,
  elegidos: SensorElegido[]
): Promise<SemaforoActivo> {
  if (elegidos.length === 0) return SEMAFORO_VACIO;

  const grupos = await getSensorsForAsset(activoCode);
  const grupoPorCode = new Map(grupos.map((g) => [g.code, g]));

  const pares = elegidos
    .map((sensor) => ({ sensor, grupo: grupoPorCode.get(sensor.code) }))
    .filter(
      (p): p is { sensor: SensorElegido; grupo: SensorGroup } =>
        !!p.grupo && p.grupo.meters.some(esVelocidad)
    );

  if (pares.length === 0) return SEMAFORO_VACIO;

  const evaluaciones = await Promise.all(
    pares.map((p) =>
      evaluarSensor(p.grupo).catch(
        (): EvaluacionSensor => ({ nivel: null, ejesRojos: [] })
      )
    )
  );

  const porNivel: Record<NivelSeveridad, number> = {
    normal: 0,
    alerta: 0,
    critico: 0,
  };
  let peor: NivelSeveridad | null = null;
  const sensoresEnRojo: SensorEnRojo[] = [];
  const sensores: SensorSemaforo[] = [];

  evaluaciones.forEach((ev, i) => {
    const { sensor } = pares[i];
    sensores.push({
      code: sensor.code,
      label: sensor.label || sensor.code,
      nivel: ev.nivel,
    });
    if (ev.nivel === null) return;
    porNivel[ev.nivel] += 1;
    if (peor === null || PESO[ev.nivel] > PESO[peor]) peor = ev.nivel;
    if (ev.ejesRojos.length > 0) {
      sensoresEnRojo.push({
        code: sensor.code,
        label: sensor.label || sensor.code,
        ejes: ev.ejesRojos,
      });
    }
  });

  return {
    nivel: peor,
    sensoresEvaluados: pares.length,
    sensoresConDato: evaluaciones.filter((ev) => ev.nivel !== null).length,
    porNivel,
    sensoresEnRojo,
    sensores,
  };
}
