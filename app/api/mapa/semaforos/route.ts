// Semáforos de la pestaña Mapa, en una sola llamada.
//
//   GET /api/mapa/semaforos
//   → { success, data: { [slot]: SemaforoActivo } }
//
// Se indexa por SLOT y no por activo_code porque el mismo activo podría estar
// asignado a dos posiciones del mapa. Cada slot devuelve, además del color
// global, el nivel de CADA sensor para poder pintar los puntos del plano.
//
// Usa exactamente el mismo cálculo que las cartillas (lib/semaforo.ts), así
// que mapa y "Activos monitoreados" nunca pueden contradecirse.
import { NextResponse } from "next/server";
import { listarMapa } from "@/lib/db";
import { semaforoDeActivo, SEMAFORO_VACIO } from "@/lib/semaforo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const slots = await listarMapa();

    const entradas = await Promise.all(
      slots.map(async (s) => {
        if (!s.activo_code || s.sensores.length === 0) {
          return [s.slot, SEMAFORO_VACIO] as const;
        }
        try {
          const semaforo = await semaforoDeActivo(
            s.activo_code,
            s.sensores.map((x) => ({
              code: x.sensor_code,
              label: x.sensor_label || x.sensor_code,
            }))
          );
          return [s.slot, semaforo] as const;
        } catch {
          // Un molino que falle no debe tumbar el mapa entero.
          return [s.slot, SEMAFORO_VACIO] as const;
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
