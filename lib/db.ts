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
      // Posición personalizada de la etiqueta de valores (H/V/A/T) cuando el
      // ingeniero la arrastra para separarla del punto; null = posición
      // automática (pegada al punto).
      await sql`
        ALTER TABLE sensores_posicionados
        ADD COLUMN IF NOT EXISTS etiqueta_pos_x REAL
      `;
      await sql`
        ALTER TABLE sensores_posicionados
        ADD COLUMN IF NOT EXISTS etiqueta_pos_y REAL
      `;
      // Caché persistente (sobrevive cold starts, a diferencia del Map en
      // memoria de lib/fracttal.ts) para listados lentos de Fracttal, como
      // el catálogo de activos de una ubicación. Genérica por "clave" para
      // poder reusarla con otros listados a futuro.
      await sql`
        CREATE TABLE IF NOT EXISTS cache_fracttal (
          clave TEXT PRIMARY KEY,
          datos JSONB NOT NULL,
          actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // ---- Pestaña Mapa ----
      // El mapa de planta son N posiciones fijas ("slots"). Cada slot se
      // asocia a UN activo de Fracttal; el nombre se guarda solo como copia
      // para poder pintar la tarjeta sin volver a consultar el catálogo (la
      // fuente de verdad sigue siendo Fracttal y se refresca al reasignar).
      await sql`
        CREATE TABLE IF NOT EXISTS mapa_slots (
          slot INTEGER PRIMARY KEY,
          activo_code TEXT,
          activo_nombre TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Posiciones de los puntos sobre el plano, en PORCENTAJES relativos a
      // la imagen (no píxeles) para que escale sin descuadrarse. Tabla aparte
      // de `sensores_posicionados` porque aquellas coordenadas son de la foto
      // lateral del gemelo digital y se pisarían entre sí.
      await sql`
        CREATE TABLE IF NOT EXISTS mapa_sensores (
          id SERIAL PRIMARY KEY,
          slot INTEGER NOT NULL REFERENCES mapa_slots(slot) ON DELETE CASCADE,
          sensor_code TEXT NOT NULL,
          sensor_label TEXT,
          pos_x REAL NOT NULL,
          pos_y REAL NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
    })();
  }
  return esquemaListo;
}

// ---------- Caché persistente genérica (Postgres) ----------

export interface EntradaCacheDB<T> {
  datos: T;
  actualizadoEn: string;
}

/** Lee una entrada de la caché persistente, o null si nunca se guardó. */
export async function leerCacheDB<T>(
  clave: string
): Promise<EntradaCacheDB<T> | null> {
  await asegurarEsquema();
  const { rows } = await sql<{ datos: T; actualizado_en: string }>`
    SELECT datos, actualizado_en FROM cache_fracttal WHERE clave = ${clave}
  `;
  if (rows.length === 0) return null;
  return { datos: rows[0].datos, actualizadoEn: rows[0].actualizado_en };
}

/** Guarda (o reemplaza) una entrada de la caché persistente. */
export async function guardarCacheDB<T>(
  clave: string,
  datos: T
): Promise<void> {
  await asegurarEsquema();
  await sql`
    INSERT INTO cache_fracttal (clave, datos, actualizado_en)
    VALUES (${clave}, ${JSON.stringify(datos)}::jsonb, now())
    ON CONFLICT (clave) DO UPDATE
    SET datos = EXCLUDED.datos, actualizado_en = now()
  `;
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

// ---------- Activos monitoreados (imagen + sensores posicionados) ----------

export interface ActivoMonitoreadoResumen {
  activo_code: string;
  activo_nombre: string | null;
  imagen_url: string | null;
  num_sensores: number;
  updated_at: string;
}

export interface SensorPosicionado {
  id: number;
  sensor_code: string;
  sensor_label: string | null;
  pos_x: number;
  pos_y: number;
  etiqueta_pos_x: number | null;
  etiqueta_pos_y: number | null;
}

export interface ActivoMonitoreadoDetalle {
  activo_code: string;
  activo_nombre: string | null;
  imagen_url: string | null;
  sensores: SensorPosicionado[];
}

/** Lista los activos ya configurados como "digital twin", más recientes primero. */
export async function listarActivosMonitoreados(): Promise<
  ActivoMonitoreadoResumen[]
> {
  await asegurarEsquema();
  const { rows } = await sql<ActivoMonitoreadoResumen>`
    SELECT
      c.activo_code,
      c.activo_nombre,
      c.imagen_url,
      c.updated_at,
      COUNT(s.id)::int AS num_sensores
    FROM activos_config c
    LEFT JOIN sensores_posicionados s ON s.activo_code = c.activo_code
    GROUP BY c.activo_code, c.activo_nombre, c.imagen_url, c.updated_at
    ORDER BY c.updated_at DESC
  `;
  return rows;
}

/** Trae la configuración (imagen + posiciones) de un activo, o null si no existe. */
export async function obtenerActivoMonitoreado(
  activoCode: string
): Promise<ActivoMonitoreadoDetalle | null> {
  await asegurarEsquema();
  const { rows: configRows } = await sql`
    SELECT activo_code, activo_nombre, imagen_url
    FROM activos_config
    WHERE activo_code = ${activoCode}
  `;
  if (configRows.length === 0) return null;

  const { rows: sensorRows } = await sql<SensorPosicionado>`
    SELECT id, sensor_code, sensor_label, pos_x, pos_y, etiqueta_pos_x, etiqueta_pos_y
    FROM sensores_posicionados
    WHERE activo_code = ${activoCode}
    ORDER BY id ASC
  `;

  return {
    activo_code: configRows[0].activo_code,
    activo_nombre: configRows[0].activo_nombre,
    imagen_url: configRows[0].imagen_url,
    sensores: sensorRows,
  };
}

/** Crea o actualiza la imagen/nombre de un activo monitoreado (upsert). */
export async function guardarActivoConfig(
  activoCode: string,
  activoNombre: string,
  imagenUrl: string
): Promise<void> {
  await asegurarEsquema();
  await sql`
    INSERT INTO activos_config (activo_code, activo_nombre, imagen_url, updated_at)
    VALUES (${activoCode}, ${activoNombre}, ${imagenUrl}, now())
    ON CONFLICT (activo_code) DO UPDATE
    SET activo_nombre = EXCLUDED.activo_nombre,
        imagen_url = EXCLUDED.imagen_url,
        updated_at = now()
  `;
}

/** Reemplaza por completo las posiciones de sensores de un activo. */
export async function reemplazarPosicionesSensores(
  activoCode: string,
  posiciones: { sensorCode: string; sensorLabel: string; x: number; y: number }[]
): Promise<void> {
  await asegurarEsquema();
  await sql`DELETE FROM sensores_posicionados WHERE activo_code = ${activoCode}`;
  for (const p of posiciones) {
    await sql`
      INSERT INTO sensores_posicionados
        (activo_code, sensor_code, sensor_label, pos_x, pos_y)
      VALUES (${activoCode}, ${p.sensorCode}, ${p.sensorLabel}, ${p.x}, ${p.y})
    `;
  }
}

/** Guarda la posición personalizada (arrastrada) de una o más etiquetas de
 *  valores. `x`/`y` son porcentajes relativos a la imagen, igual que pos_x/pos_y. */
export async function actualizarPosicionesEtiquetas(
  activoCode: string,
  etiquetas: { id: number; x: number; y: number }[]
): Promise<void> {
  await asegurarEsquema();
  for (const e of etiquetas) {
    await sql`
      UPDATE sensores_posicionados
      SET etiqueta_pos_x = ${e.x}, etiqueta_pos_y = ${e.y}
      WHERE id = ${e.id} AND activo_code = ${activoCode}
    `;
  }
}

/** Elimina un activo monitoreado (y en cascada sus posiciones de sensores). */
export async function eliminarActivoMonitoreado(
  activoCode: string
): Promise<void> {
  await asegurarEsquema();
  await sql`DELETE FROM activos_config WHERE activo_code = ${activoCode}`;
}

// ---------- Mapa de planta (slots + puntos sobre el plano) ----------

/** Posiciones del mapa. Hoy 4 (los cuatro molinos); subir este número basta
 *  para ampliar el mapa, no hay nada más hardcodeado. */
export const SLOTS_MAPA = 4;

export interface SensorMapa {
  id: number;
  sensor_code: string;
  sensor_label: string | null;
  pos_x: number;
  pos_y: number;
}

export interface SlotMapa {
  slot: number;
  /** null = posición todavía sin activo asignado. */
  activo_code: string | null;
  /** Nombre del activo tal como está en Fracttal (copia local). */
  activo_nombre: string | null;
  sensores: SensorMapa[];
}

/** Devuelve SIEMPRE los SLOTS_MAPA slots, vacíos los que aún no se configuran. */
export async function listarMapa(): Promise<SlotMapa[]> {
  await asegurarEsquema();
  const { rows: slotRows } = await sql<{
    slot: number;
    activo_code: string | null;
    activo_nombre: string | null;
  }>`
    SELECT slot, activo_code, activo_nombre FROM mapa_slots ORDER BY slot ASC
  `;
  const { rows: sensorRows } = await sql<SensorMapa & { slot: number }>`
    SELECT slot, id, sensor_code, sensor_label, pos_x, pos_y
    FROM mapa_sensores
    ORDER BY id ASC
  `;

  const porSlot = new Map(slotRows.map((s) => [s.slot, s]));
  return Array.from({ length: SLOTS_MAPA }, (_, i) => {
    const n = i + 1;
    const guardado = porSlot.get(n);
    return {
      slot: n,
      activo_code: guardado?.activo_code ?? null,
      activo_nombre: guardado?.activo_nombre ?? null,
      sensores: sensorRows
        .filter((s) => s.slot === n)
        .map(({ id, sensor_code, sensor_label, pos_x, pos_y }) => ({
          id,
          sensor_code,
          sensor_label,
          pos_x,
          pos_y,
        })),
    };
  });
}

/** Asigna el activo de un slot y reemplaza por completo sus puntos. */
export async function guardarSlotMapa(
  slot: number,
  activoCode: string,
  activoNombre: string,
  sensores: { sensorCode: string; sensorLabel: string; x: number; y: number }[]
): Promise<void> {
  await asegurarEsquema();
  await sql`
    INSERT INTO mapa_slots (slot, activo_code, activo_nombre, updated_at)
    VALUES (${slot}, ${activoCode}, ${activoNombre}, now())
    ON CONFLICT (slot) DO UPDATE
    SET activo_code = EXCLUDED.activo_code,
        activo_nombre = EXCLUDED.activo_nombre,
        updated_at = now()
  `;
  await sql`DELETE FROM mapa_sensores WHERE slot = ${slot}`;
  for (const s of sensores) {
    await sql`
      INSERT INTO mapa_sensores (slot, sensor_code, sensor_label, pos_x, pos_y)
      VALUES (${slot}, ${s.sensorCode}, ${s.sensorLabel}, ${s.x}, ${s.y})
    `;
  }
}

/** Deja un slot vacío (quita el activo y sus puntos). */
export async function limpiarSlotMapa(slot: number): Promise<void> {
  await asegurarEsquema();
  await sql`DELETE FROM mapa_slots WHERE slot = ${slot}`;
}
