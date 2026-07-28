// Diagnóstico: buscar medidores por serial o por código de activo
//   /api/fracttal/meters?serial=CLL_velX
//   /api/fracttal/meters?code=CLL
import { NextRequest, NextResponse } from "next/server";
import { getMeters } from "@/lib/fracttal";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const serial = p.get("serial")?.trim();
  const code = p.get("code")?.trim();
  if (!serial && !code) {
    return NextResponse.json(
      { success: false, message: "Usa ?serial=… o ?code=…" },
      { status: 400 }
    );
  }
  try {
    const res = await getMeters({ serial, code, limit: 100 });
    // Resumen legible: a qué activo pertenece cada medidor
    const resumen = (res.data ?? []).map((m) => ({
      id: m.id,
      description: m.description,
      serial: m.serial,
      active: m.active,
      activo_code: m.code,
      activo: m.items_description,
      ubicacion: m.parent_description ?? m.items_parent_description ?? "",
    }));
    return NextResponse.json({ success: true, total: resumen.length, data: resumen });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
