// Lista de activos (equipos) bajo la ubicación configurada.
//
// El listado en vivo contra Fracttal puede ser lento (paginación +
// recorrido de jerarquía) y llegó a superar el límite de 60s de la función
// serverless (504). Para que el wizard nunca se quede esperando:
//   1. Se sirve siempre desde una caché persistente en Postgres (instantáneo).
//   2. Si esa caché ya tiene más de 5 minutos, se dispara un refresco en
//      segundo plano (no bloquea la respuesta) para la próxima visita.
//   3. Si nunca se ha guardado nada (primera vez), se hace la consulta en
//      vivo una única vez y se guarda para todas las visitas futuras.
//   4. `?refrescar=1` fuerza una consulta en vivo síncrona (botón manual
//      "Actualizar catálogo" en el wizard).
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getAssetsForLocation } from "@/lib/fracttal";
import { leerCacheDB, guardarCacheDB } from "@/lib/db";
import type { Asset } from "@/lib/fracttal";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // solo aplica a la consulta en vivo (primera vez o refresco manual)

const DEFAULT_LOCATION = process.env.FRACTTAL_LOCATION_CODE ?? "ARCELOR01";
const REFRESCO_MINIMO_MS = 5 * 60 * 1000; // no relanzar el refresco en cada visita

function claveCache(location: string): string {
  return `activos:${location}`;
}

async function refrescarEnVivo(location: string): Promise<Asset[]> {
  const assets = await getAssetsForLocation(location, { forzar: true });
  await guardarCacheDB(claveCache(location), assets);
  return assets;
}

export async function GET(req: NextRequest) {
  const location =
    req.nextUrl.searchParams.get("location")?.trim() || DEFAULT_LOCATION;
  const forzar = req.nextUrl.searchParams.get("refrescar") === "1";

  try {
    if (forzar) {
      const assets = await refrescarEnVivo(location);
      return NextResponse.json({
        success: true,
        location,
        data: assets,
        actualizadoEn: new Date().toISOString(),
        fuente: "vivo",
      });
    }

    const cache = await leerCacheDB<Asset[]>(claveCache(location));

    if (cache) {
      const edadMs = Date.now() - new Date(cache.actualizadoEn).getTime();
      if (edadMs > REFRESCO_MINIMO_MS) {
        // No bloquea la respuesta: se ejecuta después de enviarla.
        after(() => refrescarEnVivo(location).catch(() => {}));
      }
      return NextResponse.json({
        success: true,
        location,
        data: cache.datos,
        actualizadoEn: cache.actualizadoEn,
        fuente: "cache",
      });
    }

    // Primera vez que se pide esta ubicación: no hay nada que servir todavía.
    const assets = await refrescarEnVivo(location);
    return NextResponse.json({
      success: true,
      location,
      data: assets,
      actualizadoEn: new Date().toISOString(),
      fuente: "vivo",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
