// Activo monitoreado individual: ver detalle y eliminar
import { NextRequest, NextResponse } from "next/server";
import { obtenerActivoMonitoreado, eliminarActivoMonitoreado } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  try {
    const { codigo } = await params;
    const detalle = await obtenerActivoMonitoreado(decodeURIComponent(codigo));
    if (!detalle) {
      return NextResponse.json(
        { success: false, message: "Activo no configurado" },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: detalle });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  try {
    const { codigo } = await params;
    await eliminarActivoMonitoreado(decodeURIComponent(codigo));
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
