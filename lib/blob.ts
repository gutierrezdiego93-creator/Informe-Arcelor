// Subida de archivos a Vercel Blob (fotos de evidencias y, más adelante,
// diagramas de activos).
import { put } from "@vercel/blob";

/** Sube una imagen en formato data URL (base64) y devuelve su URL pública. */
export async function subirImagenBase64(
  dataUrl: string,
  nombreCarpeta: string
): Promise<string> {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) {
    // No es una data URL (ej. ya es una URL de Blob de una edición anterior):
    // se devuelve tal cual.
    return dataUrl;
  }
  const [, mime, base64] = match;
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const buffer = Buffer.from(base64, "base64");
  const nombreArchivo = `${nombreCarpeta}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;
  const blob = await put(nombreArchivo, buffer, {
    access: "public",
    contentType: mime,
  });
  return blob.url;
}
