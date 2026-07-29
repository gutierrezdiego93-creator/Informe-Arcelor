// Guarda la posición personalizada (arrastrada) de las etiquetas de valores
// de un activo monitoreado.
import { NextRequest, NextResponse } from "next/server";
import { actualizarPosicionesEtiquetas } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  try {
    const { codigo } = await params;
    const body = await req.json();
    const etiquetas = body.etiquetas as { id: number; x: number; y: number }[];
    if (!Array.isArray(etiquetas)) {
      return NextResponse.json(
        { success: false, message: "Formato inválido: se esperaba 'etiquetas'" },
        { status: 400 }
      );
    }
    await actualizarPosicionesEtiquetas(decodeURIComponent(codigo), etiquetas);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
