// Activos monitoreados: listar y guardar configuración (imagen + sensores)
import { NextRequest, NextResponse } from "next/server";
import {
  listarActivosMonitoreados,
  guardarActivoConfig,
  reemplazarPosicionesSensores,
} from "@/lib/db";
import { subirImagenBase64 } from "@/lib/blob";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const activos = await listarActivosMonitoreados();
    return NextResponse.json({ success: true, data: activos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

interface PosicionEntrante {
  sensorCode: string;
  sensorLabel: string;
  x: number;
  y: number;
}

interface GuardarActivoBody {
  activoCode: string;
  activoNombre: string;
  imagen: string; // data URL (o URL de Blob si no cambió)
  sensores: PosicionEntrante[];
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GuardarActivoBody;
    if (!body.activoCode || !body.imagen) {
      return NextResponse.json(
        { success: false, message: "Falta activoCode o imagen" },
        { status: 400 }
      );
    }
    const imagenUrl = await subirImagenBase64(
      body.imagen,
      `activos/${body.activoCode}`
    );
    await guardarActivoConfig(body.activoCode, body.activoNombre, imagenUrl);
    await reemplazarPosicionesSensores(body.activoCode, body.sensores ?? []);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
