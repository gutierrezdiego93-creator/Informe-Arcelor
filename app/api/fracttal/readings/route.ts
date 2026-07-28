// Historial de lecturas de un sensor (para la comparativa semanal)
import { NextRequest, NextResponse } from "next/server";
import { getMeterReadings } from "@/lib/fracttal";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const code = p.get("code")?.trim();
  if (!code) {
    return NextResponse.json(
      { success: false, message: "Falta el parámetro ?code= del sub-activo" },
      { status: 400 }
    );
  }
  try {
    const res = await getMeterReadings({
      code,
      since: p.get("since") ?? undefined,
      until: p.get("until") ?? undefined,
      type_date: "date_reading",
      limit: Number(p.get("limit") ?? 100),
    });
    return NextResponse.json({ success: true, data: res.data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
