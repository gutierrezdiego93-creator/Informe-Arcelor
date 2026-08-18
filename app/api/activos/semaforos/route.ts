// Semáforo global por activo monitoreado (cartillas de "Activos monitoreados").
//
//   GET /api/activos/semaforos
//   → { success, data: { [activo_code]: SemaforoActivo } }
//
// Una sola llamada resuelve TODAS las cartillas: el trabajo pesado (lecturas
// de Fracttal por sensor) se hace en el servidor y en paralelo, en vez de
// disparar decenas de fetch desde el navegador.
//
// El cálculo (criterio ISO peor caso, solo vibración) vive en lib/semaforo.ts
// porque lo comparte con la pestaña Mapa.
import { NextResponse } from "next/server";
import { listarActivosMonitoreados, obtenerActivoMonitoreado } from "@/lib/db";
import {
  semaforoDeActivo,
  SEMAFORO_VACIO,
  type SemaforoActivo,
} from "@/lib/semaforo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Re-export para no romper importaciones existentes de estos tipos.
export type { EjeEnRojo, SensorEnRojo, SemaforoActivo } from "@/lib/semaforo";

/** Semáforo de UN activo monitoreado, con sus sensores posicionados. */
async function semaforoDeActivoMonitoreado(
  activoCode: string
): Promise<SemaforoActivo> {
  const detalle = await obtenerActivoMonitoreado(activoCode);
  if (!detalle || detalle.sensores.length === 0) return SEMAFORO_VACIO;

  return semaforoDeActivo(
    activoCode,
    detalle.sensores.map((s) => ({
      code: s.sensor_code,
      label: s.sensor_label || s.sensor_code,
    }))
  );
}

export async function GET() {
  try {
    const activos = await listarActivosMonitoreados();

    const entradas = await Promise.all(
      activos.map(async (a) => {
        try {
          return [
            a.activo_code,
            await semaforoDeActivoMonitoreado(a.activo_code),
          ] as const;
        } catch {
          // Un activo que falle (Fracttal lento, etc.) no debe tumbar el
          // semáforo de los demás: se reporta como "sin datos".
          return [a.activo_code, SEMAFORO_VACIO] as const;
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
