// Limpieza de nombres que vienen de Fracttal para mostrarlos en pantalla.
//
// Las descripciones de sub-activos llegan con ruido técnico que no aporta
// nada al ingeniero, por ejemplo:
//
//   "RALT 69d842b5ff988c5c7cfce7c8 { RALT }"  →  "RALT"
//
// El id hexadecimal es el identificador interno del ítem y el bloque entre
// llaves repite el código. Se limpia SOLO en la vista: en la base de datos y
// en las llamadas a Fracttal se conserva el texto original, para no romper
// nada que dependa de él.

/** Sufijo entre llaves: "{ RALT }". */
const BLOQUE_LLAVES = /\{[^}]*\}/g;
/** UUID con guiones: "69d842b5-ff98-8c5c-7cfc-e7c8a1b2c3d4". */
const UUID = /\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b/g;
/** Id hexadecimal largo y corrido: "69d842b5ff988c5c7cfce7c8". */
const HEX_LARGO = /\b[0-9a-fA-F]{16,}\b/g;
/** Separadores sueltos que quedan en los extremos tras quitar el ruido. */
const BORDES = /^[\s·\-–|:,]+|[\s·\-–|:,]+$/g;

/**
 * Devuelve el nombre sin ids ni bloques entre llaves. Si al limpiar no queda
 * nada (nombres que son SOLO un id), se devuelve el texto original para no
 * dejar la pantalla en blanco.
 */
export function limpiarNombre(texto: string | null | undefined): string {
  if (!texto) return "";
  const limpio = texto
    .replace(BLOQUE_LLAVES, " ")
    .replace(UUID, " ")
    .replace(HEX_LARGO, " ")
    .replace(/\s{2,}/g, " ")
    .replace(BORDES, "")
    .trim();
  return limpio || texto.trim();
}
