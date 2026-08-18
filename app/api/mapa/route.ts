// Configuración del mapa de planta: qué activo de Fracttal ocupa cada
// posición y dónde está cada uno de sus puntos sobre el plano.
//
//   GET    /api/mapa            → { success, data: SlotMapa[] }  (siempre 4)
//   PUT    /api/mapa            → guarda un slot (activo + puntos)
//   DELETE /api/mapa?slot=2     → deja el slot vacío
import { NextRequest, NextResponse } from "next/server";
import {
  listarMapa,
  guardarSlotMapa,
  limpiarSlotMapa,
  SLOTS_MAPA,
} from "@/lib/db";

export const dynamic = "force-dynamic";

interface CuerpoPut {
  slot?: number;
  activoCode?: string;
  activoNombre?: string;
  sensores?: {
    sensorCode?: string;
    sensorLabel?: string;
    x?: number;
    y?: number;
  }[];
}

function slotValido(slot: unknown): slot is number {
  return (
    typeof slot === "number" &&
    Number.isInteger(slot) &&
    slot >= 1 &&
    slot <= SLOTS_MAPA
  );
}

export async function GET() {
  try {
    return NextResponse.json({ success: true, data: await listarMapa() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as CuerpoPut;

    if (!slotValido(body.slot)) {
      return NextResponse.json(
        { success: false, message: `slot debe ser un entero 1..${SLOTS_MAPA}` },
        { status: 400 }
      );
    }
    const activoCode = body.activoCode?.trim();
    if (!activoCode) {
      return NextResponse.json(
        { success: false, message: "Falta activoCode" },
        { status: 400 }
      );
    }

    // Se descartan puntos incompletos o fuera del plano en vez de rechazar
    // todo el guardado: el resto de posiciones del ingeniero no se pierde.
    const sensores = (body.sensores ?? [])
      .filter(
        (s) =>
          typeof s.sensorCode === "string" &&
          s.sensorCode.trim() !== "" &&
          typeof s.x === "number" &&
          typeof s.y === "number" &&
          s.x >= 0 &&
          s.x <= 100 &&
          s.y >= 0 &&
          s.y <= 100
      )
      .map((s) => ({
        sensorCode: s.sensorCode as string,
        sensorLabel: s.sensorLabel ?? (s.sensorCode as string),
        x: s.x as number,
        y: s.y as number,
      }));

    await guardarSlotMapa(
      body.slot,
      activoCode,
      body.activoNombre?.trim() || activoCode,
      sensores
    );

    return NextResponse.json({ success: true, data: await listarMapa() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const slot = Number(req.nextUrl.searchParams.get("slot"));
    if (!slotValido(slot)) {
      return NextResponse.json(
        { success: false, message: `slot debe ser un entero 1..${SLOTS_MAPA}` },
        { status: 400 }
      );
    }
    await limpiarSlotMapa(slot);
    return NextResponse.json({ success: true, data: await listarMapa() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
