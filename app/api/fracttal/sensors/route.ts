// Proxy servidor → Fracttal. Las credenciales NUNCA llegan al navegador.
import { NextRequest, NextResponse } from "next/server";
import { getSensorsForAsset } from "@/lib/fracttal";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.trim();
  if (!code) {
    return NextResponse.json(
      { success: false, message: "Falta el parámetro ?code= del activo" },
      { status: 400 }
    );
  }
  try {
    const sensors = await getSensorsForAsset(code);
    return NextResponse.json({ success: true, data: sensors });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
