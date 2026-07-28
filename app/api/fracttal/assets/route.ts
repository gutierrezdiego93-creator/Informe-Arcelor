// Lista de activos (equipos) bajo la ubicación configurada
import { NextRequest, NextResponse } from "next/server";
import { getAssetsForLocation } from "@/lib/fracttal";

export const dynamic = "force-dynamic";

const DEFAULT_LOCATION = process.env.FRACTTAL_LOCATION_CODE ?? "ARCELOR01";

export async function GET(req: NextRequest) {
  const location =
    req.nextUrl.searchParams.get("location")?.trim() || DEFAULT_LOCATION;
  try {
    const assets = await getAssetsForLocation(location);
    return NextResponse.json({ success: true, location, data: assets });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
