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
import {
  getSensorsForAsset,
  getMeterReadings,
  esVelocidad,
  mmsAInsNumero,
  nivelVelocidad,
  type MeterReading,
  type SensorGroup,
  type NivelSeveridad,
} from "@/lib/fracttal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mismos parámetros que /api/fracttal/averages (vista en vivo): promedio de
// las últimas N lecturas dentro de una ventana de 45 días.
const N_LECTURAS = 10;
const DIAS_VENTANA = 45;
const MAX_PAGES = 6; // tope de seguridad (600 lecturas por sensor)

export interface SemaforoActivo {
  /** Peor nivel entre los sensores de vibración; null = sin datos. */
  nivel: NivelSeveridad | null;
  /** Sensores de vibración (con medidores H/V/A) considerados. */
  sensoresEvaluados: number;
  /** De esos, cuántos tuvieron lecturas para calcular su color. */
  sensoresConDato: number;
  /** Desglose por color (solo sensores con dato). */
  porNivel: Record<NivelSeveridad, number>;
}

const PESO: Record<NivelSeveridad, number> = {
  normal: 0,
  alerta: 1,
  critico: 2,
};

/** Promedio de las últimas N lecturas por medidor de un sensor (sub-activo). */
async function promediosPorMedidor(
  code: string,
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
    const ultimas = lecturas.slice(-N_LECTURAS);
    const suma = ultimas.reduce((acc, r) => acc + r.data.value, 0);
    promedios.set(idMeter, suma / ultimas.length);
  }
  return promedios;
}

/**
 * Color de un sensor: el peor de sus ejes de velocidad H/V/A (misma
 * semaforización que la vista en vivo: mm/s → in/s → nivelVelocidad).
 * null = el sensor no tuvo lecturas en la ventana.
 */
async function nivelDeSensor(grupo: SensorGroup): Promise<NivelSeveridad | null> {
  const velocidades = grupo.meters.filter(esVelocidad);
  if (velocidades.length === 0) return null;

  // Sensor "desarmado" (code sintético ACTIVO::idMedidor): las lecturas se
  // piden con el code real del activo dueño + el serial del medidor.
  const esDesarmado = grupo.code.includes("::");
  const promedios = esDesarmado
    ? await promediosPorMedidor(grupo.meters[0].code, grupo.meters[0].serial)
    : await promediosPorMedidor(grupo.code);

  let peor: NivelSeveridad | null = null;
  for (const m of velocidades) {
    const avg = promedios.get(m.id);
    if (avg == null) continue;
    const nivel = nivelVelocidad(mmsAInsNumero(avg));
    if (peor === null || PESO[nivel] > PESO[peor]) peor = nivel;
  }
  return peor;
}

/** Semáforo global de UN activo monitoreado. */
async function semaforoDeActivo(activoCode: string): Promise<SemaforoActivo> {
  const vacio: SemaforoActivo = {
    nivel: null,
    sensoresEvaluados: 0,
    sensoresConDato: 0,
    porNivel: { normal: 0, alerta: 0, critico: 0 },
  };

  const [detalle, grupos] = await Promise.all([
    obtenerActivoMonitoreado(activoCode),
    getSensorsForAsset(activoCode),
  ]);
  if (!detalle || detalle.sensores.length === 0) return vacio;

  const grupoPorCode = new Map(grupos.map((g) => [g.code, g]));

  // Solo los sensores POSICIONADOS del activo que además tengan medidores
  // de velocidad (vibración). Los de energía/otros quedan fuera en paso 1.
  const gruposVibracion = detalle.sensores
    .map((s) => grupoPorCode.get(s.sensor_code))
    .filter((g): g is SensorGroup => !!g && g.meters.some(esVelocidad));

  if (gruposVibracion.length === 0) return vacio;

  const niveles = await Promise.all(
    gruposVibracion.map((g) => nivelDeSensor(g).catch(() => null))
  );

  const porNivel: Record<NivelSeveridad, number> = {
    normal: 0,
    alerta: 0,
    critico: 0,
  };
  let peor: NivelSeveridad | null = null;
  for (const n of niveles) {
    if (n === null) continue;
    porNivel[n] += 1;
    if (peor === null || PESO[n] > PESO[peor]) peor = n;
  }

  return {
    nivel: peor,
    sensoresEvaluados: gruposVibracion.length,
    sensoresConDato: niveles.filter((n) => n !== null).length,
    porNivel,
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
