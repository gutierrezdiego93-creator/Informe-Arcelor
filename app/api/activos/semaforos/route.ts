// Semáforo global por activo monitoreado, criterio ISO peor caso:
//   - color de cada sensor  = el peor de sus ejes de velocidad H/V/A
//   - color global del activo = el peor de sus sensores de vibración
// La temperatura y los medidores genéricos (voltaje, corriente, etc.) NO
// entran en este cálculo (paso 1: solo vibración).
//
//   GET /api/activos/semaforos
//   → { success, data: { [activo_code]: SemaforoActivo } }
//
// Una sola llamada resuelve TODAS las cartillas: el trabajo pesado (lecturas
// de Fracttal por sensor) se hace en el servidor y en paralelo, en vez de
// disparar decenas de fetch desde el navegador.
import { NextResponse } from "next/server";
import {
  listarActivosMonitoreados,
  obtenerActivoMonitoreado,
} from "@/lib/db";
import type { SensorPosicionado } from "@/lib/db";
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

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  /** Nombre para mostrar en la cartilla (label del wizard o el code). */
  label: string;
  /** Ejes que dispararon el rojo, con su valor en in/s. */
  ejes: EjeEnRojo[];
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
}

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

/** Semáforo global de UN activo monitoreado. */
async function semaforoDeActivo(activoCode: string): Promise<SemaforoActivo> {
  const vacio: SemaforoActivo = {
    nivel: null,
    sensoresEvaluados: 0,
    sensoresConDato: 0,
    porNivel: { normal: 0, alerta: 0, critico: 0 },
    sensoresEnRojo: [],
  };

  const [detalle, grupos] = await Promise.all([
    obtenerActivoMonitoreado(activoCode),
    getSensorsForAsset(activoCode),
  ]);
  if (!detalle || detalle.sensores.length === 0) return vacio;

  const grupoPorCode = new Map(grupos.map((g) => [g.code, g]));

  // Solo los sensores POSICIONADOS del activo que además tengan medidores
  // de velocidad (vibración). Los de energía/otros quedan fuera.
  // Se conserva el sensor posicionado junto a su grupo para poder mostrar
  // su nombre (sensor_label) en el aviso de rojos de la cartilla.
  const pares = detalle.sensores
    .map((sensor) => ({ sensor, grupo: grupoPorCode.get(sensor.sensor_code) }))
    .filter(
      (p): p is { sensor: SensorPosicionado; grupo: SensorGroup } =>
        !!p.grupo && p.grupo.meters.some(esVelocidad)
    );

  if (pares.length === 0) return vacio;

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
  evaluaciones.forEach((ev, i) => {
    if (ev.nivel === null) return;
    porNivel[ev.nivel] += 1;
    if (peor === null || PESO[ev.nivel] > PESO[peor]) peor = ev.nivel;
    if (ev.ejesRojos.length > 0) {
      const { sensor } = pares[i];
      sensoresEnRojo.push({
        code: sensor.sensor_code,
        label: sensor.sensor_label || sensor.sensor_code,
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
  };
}

export async function GET() {
  try {
    const activos = await listarActivosMonitoreados();

    const entradas = await Promise.all(
      activos.map(async (a) => {
        try {
          return [a.activo_code, await semaforoDeActivo(a.activo_code)] as const;
        } catch {
          // Un activo que falle (Fracttal lento, etc.) no debe tumbar el
          // semáforo de los demás: se reporta como "sin datos".
          return [
            a.activo_code,
            {
              nivel: null,
              sensoresEvaluados: 0,
              sensoresConDato: 0,
              porNivel: { normal: 0, alerta: 0, critico: 0 },
              sensoresEnRojo: [],
            } satisfies SemaforoActivo,
          ] as const;
        }
      })
    );

    return NextResponse.json({
      success: true,
      data: Object.fromEntries(entradas),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
