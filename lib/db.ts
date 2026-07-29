// Acceso a la base de datos Postgres (Vercel Postgres / Neon).
// Guarda el historial de informes generados y, más adelante, la
// configuración de "Activos monitoreados" (imagen + sensores posicionados).
import { sql } from "@vercel/postgres";
import type { InformeData } from "@/components/InformePDF";

let esquemaListo: Promise<void> | null = null;

/** Crea las tablas si no existen. Se puede llamar en cada request: es barato
 *  y evita depender de migraciones manuales que Diego tendría que correr. */
export function asegurarEsquema(): Promise<void> {
  if (!esquemaListo) {
    esquemaListo = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS informes (
          id SERIAL PRIMARY KEY,
          activo_code TEXT,
          activo_nombre TEXT,
          semana TEXT,
          fecha TEXT,
          area TEXT,
          analista TEXT,
          condicion_operacion TEXT,
          nivel_general TEXT,
          observaciones TEXT,
          recomendaciones TEXT,
          filas_velocidad JSONB,
          otros_valores JSONB,
          evidencias JSONB,
          created_at TIMESTAMPTZ DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS activos_config (
          activo_code TEXT PRIMARY KEY,
          activo_nombre TEXT,
          imagen_url TEXT,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS sensores_posicionados (
          id SERIAL PRIMARY KEY,
          activo_code TEXT NOT NULL REFERENCES activos_config(activo_code) ON DELETE CASCADE,
          sensor_code TEXT NOT NULL,
          sensor_label TEXT,
          pos_x REAL NOT NULL,
          pos_y REAL NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now()
        )
      `;
    })();
  }
  return esquemaListo;
}

export interface InformeResumen {
  id: number;
  activo_code: string | null;
  activo_nombre: string | null;
  semana: string | null;
  fecha: string | null;
  analista: string | null;
  nivel_general: string | null;
  created_at: string;
}

/** Lista los informes guardados, más recientes primero. */
export async function listarInformes(limit = 100): Promise<InformeResumen[]> {
  await asegurarEsquema();
  const { rows } = await sql<InformeResumen>`
    SELECT id, activo_code, activo_nombre, semana, fecha, analista, nivel_general, created_at
    FROM informes
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows;
}

/** Guarda un informe ya generado (se llama justo después de crear el PDF). */
export async function guardarInforme(data: InformeData): Promise<number> {
  await asegurarEsquema();
  const { rows } = await sql`
    INSERT INTO informes (
      activo_code, activo_nombre, semana, fecha, area, analista,
      condicion_operacion, nivel_general, observaciones, recomendaciones,
      filas_velocidad, otros_valores, evidencias
    ) VALUES (
      ${data.activo.codigo}, ${data.activo.nombre}, ${data.semana}, ${data.fecha}, ${data.area}, ${data.analista},
      ${data.condicionOperacion}, ${data.nivelGeneral}, ${data.observaciones}, ${data.recomendaciones},
      ${JSON.stringify(data.filasVelocidad)}, ${JSON.stringify(data.otrosValores)}, ${JSON.stringify(data.evidencias)}
    )
    RETURNING id
  `;
  return rows[0].id as number;
}

/** Elimina un informe del historial. */
export async function eliminarInforme(id: number): Promise<void> {
  await asegurarEsquema();
  await sql`DELETE FROM informes WHERE id = ${id}`;
}
