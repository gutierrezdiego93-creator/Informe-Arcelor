// Historial de informes: listar y guardar
import { NextRequest, NextResponse } from "next/server";
import { listarInformes, guardarInforme } from "@/lib/db";
import { subirImagenBase64 } from "@/lib/blob";
import type { InformeData } from "@/components/InformePDF";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const informes = await listarInformes();
    return NextResponse.json({ success: true, data: informes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = (await req.json()) as InformeData;

    // Sube cada foto de evidencia (base64) a Vercel Blob para no llenar la
    // base de datos con imágenes; el informe queda con URLs livianas.
    const evidenciasConUrls = await Promise.all(
      (data.evidencias ?? []).map(async (ev) => ({
        comentario: ev.comentario,
        fotos: await Promise.all(
          ev.fotos.map((foto) =>
            subirImagenBase64(foto, `informes/${data.activo?.codigo ?? "sin-codigo"}`)
          )
        ),
      }))
    );

    const id = await guardarInforme({ ...data, evidencias: evidenciasConUrls });
    return NextResponse.json({ success: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
