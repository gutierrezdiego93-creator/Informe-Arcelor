// Documento PDF del Reporte de Condición (análisis de vibraciones)
// Se genera en el navegador con @react-pdf/renderer
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import type { ReactNode } from "react";

// ---------- Datos que recibe el documento ----------

export interface FilaVelocidad {
  sensor: string;
  sensorDesc: string;
  posicion: string;
  valor: number | null;
  nivel: "NORMAL" | "ALERTA" | "CRÍTICO" | null;
  /** primera fila del grupo: pinta la celda del sensor con rowSpan visual */
  primeraDelGrupo: boolean;
  filasDelGrupo: number;
}

export interface OtroValor {
  sensor: string;
  medidor: string;
  valor: string;
  unidad: string;
}

export interface EvidenciaPDF {
  fotos: string[]; // data URLs
  comentario: string; // HTML (texto enriquecido) — diagnóstico de este espectro
}

export interface InformeData {
  activo: {
    nombre: string;
    codigo: string;
    fabricante?: string;
    modelo?: string;
  };
  semana: string;
  fecha: string;
  area: string;
  analista: string;
  condicionOperacion: string;
  nivelGeneral: "NORMAL" | "ALERTA" | "CRÍTICO";
  observaciones: string; // HTML (texto enriquecido)
  filasVelocidad: FilaVelocidad[];
  otrosValores: OtroValor[];
  recomendaciones: string; // HTML (texto enriquecido) — cierre del informe
  evidencias: EvidenciaPDF[];
}

// ---------- Colores del semáforo ----------

const COLOR_NIVEL: Record<string, { bg: string; fg: string }> = {
  NORMAL: { bg: "#22c55e", fg: "#ffffff" },
  ALERTA: { bg: "#fde047", fg: "#1e293b" },
  CRÍTICO: { bg: "#dc2626", fg: "#ffffff" },
};

const BRAND = "#2929ff";

// ---------- HTML (texto enriquecido) → elementos del PDF ----------

/** ¿El HTML no tiene texto real (solo etiquetas vacías)? */
function htmlEstaVacio(html: string | undefined | null): boolean {
  if (!html) return true;
  const texto = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  return texto.length === 0;
}

/** Recorre los ancestros de un nodo de texto para armar el estilo combinado
 *  (negrita / cursiva / tachado / tamaño) que le corresponde. */
function estiloDesdeAncestros(nodo: Node): Record<string, unknown> {
  let bold = false;
  let italic = false;
  let strike = false;
  let fontSize: number | undefined;
  let p: Node | null = nodo.parentNode;
  while (p && (p as HTMLElement).tagName) {
    const el = p as HTMLElement;
    const tag = el.tagName.toUpperCase();
    if (tag === "B" || tag === "STRONG") bold = true;
    if (tag === "I" || tag === "EM") italic = true;
    if (tag === "S" || tag === "STRIKE" || tag === "DEL") strike = true;
    if (fontSize === undefined && el.style?.fontSize) {
      const n = parseInt(el.style.fontSize, 10);
      if (!isNaN(n)) fontSize = n;
    }
    p = p.parentNode;
  }
  const estilo: Record<string, unknown> = {};
  if (bold && italic) estilo.fontFamily = "Helvetica-BoldOblique";
  else if (bold) estilo.fontFamily = "Helvetica-Bold";
  else if (italic) estilo.fontFamily = "Helvetica-Oblique";
  if (strike) estilo.textDecoration = "line-through";
  if (fontSize) estilo.fontSize = Math.round(fontSize * 0.72); // px → pt aprox.
  return estilo;
}

let claveHtml = 0;

/** Convierte un HTML simple (del editor de texto) en bloques del PDF:
 *  párrafos con negrita/cursiva/tachado/tamaño y listas con viñetas o
 *  numeradas. Se ejecuta solo en el navegador (usa DOMParser). */
function htmlABloquesPdf(html: string): ReactNode[] {
  if (typeof window === "undefined" || htmlEstaVacio(html)) {
    return [
      <Text key={`vacio-${claveHtml++}`} style={{ color: "#94a3b8" }}>
        —
      </Text>,
    ];
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const bloques: ReactNode[] = [];

  function textRuns(el: Node): ReactNode[] {
    const runs: ReactNode[] = [];
    el.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent) {
          runs.push(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <Text key={`run-${claveHtml++}`} style={estiloDesdeAncestros(child) as any}>
              {child.textContent}
            </Text>
          );
        }
      } else if (child.nodeName === "BR") {
        runs.push(<Text key={`br-${claveHtml++}`}>{"\n"}</Text>);
      } else {
        runs.push(...textRuns(child));
      }
    });
    return runs;
  }

  function procesarBloque(el: Element) {
    const tag = el.tagName.toUpperCase();
    if (tag === "UL" || tag === "OL") {
      Array.from(el.children).forEach((li, i) => {
        bloques.push(
          <View
            key={`li-${claveHtml++}`}
            style={{ flexDirection: "row", marginBottom: 2 }}
            wrap={false}
          >
            <Text style={{ width: 14 }}>{tag === "OL" ? `${i + 1}.` : "•"}</Text>
            <Text style={{ flex: 1, lineHeight: 1.4 }}>{textRuns(li)}</Text>
          </View>
        );
      });
      return;
    }
    const tieneHijosBloque = Array.from(el.children).some((c) =>
      ["P", "DIV", "UL", "OL"].includes(c.tagName.toUpperCase())
    );
    if (tieneHijosBloque) {
      Array.from(el.childNodes).forEach((c) => {
        if (c.nodeType === Node.ELEMENT_NODE) procesarBloque(c as Element);
      });
      return;
    }
    const runs = textRuns(el);
    if (runs.length > 0) {
      bloques.push(
        <Text key={`p-${claveHtml++}`} style={{ lineHeight: 1.5, marginBottom: 4 }}>
          {runs}
        </Text>
      );
    }
  }

  Array.from(doc.body.childNodes).forEach((n) => {
    if (n.nodeType === Node.ELEMENT_NODE) {
      procesarBloque(n as Element);
    } else if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) {
      bloques.push(
        <Text key={`txt-${claveHtml++}`} style={{ lineHeight: 1.5, marginBottom: 4 }}>
          {n.textContent}
        </Text>
      );
    }
  });

  return bloques.length > 0
    ? bloques
    : [
        <Text key={`vacio2-${claveHtml++}`} style={{ color: "#94a3b8" }}>
          —
        </Text>,
      ];
}

// ---------- Estilos ----------

const s = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 40,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
  // Encabezado
  bandera: {
    backgroundColor: BRAND,
    color: "#ffffff",
    padding: 10,
    borderRadius: 4,
    marginBottom: 12,
  },
  titulo: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  subtitulo: { fontSize: 9, marginTop: 2, opacity: 0.9 },
  // Grid de metadatos
  metaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 4,
    marginBottom: 14,
  },
  metaCelda: {
    width: "33.33%",
    padding: 6,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e2e8f0",
  },
  metaLabel: {
    fontSize: 6.5,
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  metaValor: { fontSize: 9.5, fontFamily: "Helvetica-Bold" },
  // Secciones
  seccion: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 10,
    marginBottom: 6,
    color: BRAND,
  },
  seccionCentrada: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
    marginBottom: 6,
    color: BRAND,
    textAlign: "center",
  },
  // Cuadro de velocidades — más angosto y centrado, estilo estilizado
  tablaWrap: {
    width: "82%",
    alignSelf: "center",
    marginBottom: 3,
  },
  tabla: {
    borderWidth: 1,
    borderColor: "#94a3b8",
    borderRadius: 6,
  },
  filaHead: {
    flexDirection: "row",
    backgroundColor: BRAND,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  fila: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#e2e8f0",
  },
  filaAlt: {
    backgroundColor: "#f8fafc",
  },
  celdaHead: {
    padding: 5,
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    textTransform: "uppercase",
    color: "#ffffff",
    letterSpacing: 0.3,
  },
  celda: { padding: 4, justifyContent: "center" },
  cSensor: { width: "30%", borderRightWidth: 0.5, borderColor: "#e2e8f0" },
  cPos: { width: "20%", borderRightWidth: 0.5, borderColor: "#e2e8f0" },
  cVal: { width: "25%", borderRightWidth: 0.5, borderColor: "#e2e8f0" },
  cNivel: { width: "25%" },
  chip: {
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 6,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    fontSize: 8.5,
  },
  leyenda: {
    fontSize: 7,
    color: "#64748b",
    marginBottom: 10,
    textAlign: "center",
  },
  // Tabla secundaria (aceleraciones / temperaturas) — también angosta
  tablaSecWrap: {
    width: "88%",
    alignSelf: "center",
    marginBottom: 4,
  },
  parrafo: { lineHeight: 1.5, textAlign: "justify" },
  // Evidencias
  bloqueEvidencia: {
    marginTop: 10,
    marginBottom: 4,
  },
  fotosFila: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 6,
  },
  fotoMarco: {
    width: "48%",
    marginRight: "2%",
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: "#cbd5e1",
    borderRadius: 4,
    padding: 3,
    backgroundColor: "#ffffff",
  },
  foto: {
    height: 190,
    width: "100%",
    objectFit: "contain",
  },
  comentario: {
    backgroundColor: "#f8fafc",
    borderLeftWidth: 3,
    borderColor: BRAND,
    padding: 8,
    marginBottom: 4,
  },
  piePagina: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#94a3b8",
    borderTopWidth: 0.5,
    borderColor: "#e2e8f0",
    paddingTop: 6,
  },
});

function ChipNivel({ nivel }: { nivel: string }) {
  const c = COLOR_NIVEL[nivel] ?? COLOR_NIVEL.NORMAL;
  return (
    <Text style={[s.chip, { backgroundColor: c.bg, color: c.fg }]}>
      {nivel}
    </Text>
  );
}

export function InformePDF({ data }: { data: InformeData }) {
  const pie = (
    <View style={s.piePagina} fixed>
      <Text>
        Reporte de Condición · {data.activo.nombre} ({data.activo.codigo}) ·
        Semana {data.semana}
      </Text>
      <Text
        render={({ pageNumber, totalPages }) =>
          `Página ${pageNumber} de ${totalPages}`
        }
      />
    </View>
  );

  let filaIdx = 0;

  return (
    <Document
      title={`Reporte de Condición ${data.activo.codigo} - Semana ${data.semana}`}
      author={data.analista}
    >
      <Page size="LETTER" style={s.page} wrap>
        {/* Encabezado */}
        <View style={s.bandera}>
          <Text style={s.titulo}>
            REPORTE DE CONDICIÓN · ANÁLISIS DE VIBRACIONES
          </Text>
          <Text style={s.subtitulo}>
            ArcelorMittal · Generado desde Fracttal · Semana {data.semana} ·{" "}
            {data.fecha}
          </Text>
        </View>

        {/* Datos generales */}
        <View style={s.metaGrid}>
          {(
            [
              ["Equipo", `${data.activo.nombre} (${data.activo.codigo})`],
              [
                "Fabricante / Modelo",
                [data.activo.fabricante, data.activo.modelo]
                  .filter(Boolean)
                  .join(" / ") || "—",
              ],
              ["Área", data.area || "—"],
              ["Fecha de inspección", data.fecha],
              ["Analista predictivo", data.analista],
              ["Condición de operación", data.condicionOperacion],
            ] as const
          ).map(([label, valor]) => (
            <View key={label} style={s.metaCelda}>
              <Text style={s.metaLabel}>{label}</Text>
              <Text style={s.metaValor}>{valor}</Text>
            </View>
          ))}
          <View style={[s.metaCelda, { width: "100%" }]}>
            <Text style={s.metaLabel}>Nivel de condición general</Text>
            <View style={{ width: 90, marginTop: 2 }}>
              <ChipNivel nivel={data.nivelGeneral} />
            </View>
          </View>
        </View>

        {/* Cuadro de velocidades — angosto y centrado */}
        <Text style={s.seccionCentrada}>
          Valores globales de vibración (Velocidad, in/s)
        </Text>
        <View style={s.tablaWrap}>
          <View style={s.tabla}>
            <View style={s.filaHead}>
              <Text style={[s.celdaHead, s.cSensor]}>Punto de medición</Text>
              <Text style={[s.celdaHead, s.cPos]}>Posición</Text>
              <Text style={[s.celdaHead, s.cVal, { textAlign: "center" }]}>
                Velocidad
              </Text>
              <Text style={[s.celdaHead, s.cNivel, { textAlign: "center" }]}>
                Condición
              </Text>
            </View>
            {data.filasVelocidad.map((f, i) => {
              const alterna = filaIdx % 2 === 1;
              filaIdx++;
              return (
                <View
                  key={i}
                  style={[s.fila, alterna ? s.filaAlt : {}]}
                  wrap={false}
                >
                  <View style={[s.celda, s.cSensor]}>
                    {f.primeraDelGrupo ? (
                      <>
                        <Text style={{ fontFamily: "Helvetica-Bold" }}>
                          {f.sensor}
                        </Text>
                        <Text style={{ fontSize: 6.5, color: "#64748b" }}>
                          {f.sensorDesc}
                        </Text>
                      </>
                    ) : (
                      <Text> </Text>
                    )}
                  </View>
                  <View style={[s.celda, s.cPos]}>
                    <Text>{f.posicion}</Text>
                  </View>
                  <View style={[s.celda, s.cVal]}>
                    {f.valor !== null && f.nivel ? (
                      <Text
                        style={[
                          s.chip,
                          {
                            backgroundColor: COLOR_NIVEL[f.nivel].bg,
                            color: COLOR_NIVEL[f.nivel].fg,
                          },
                        ]}
                      >
                        {f.valor.toFixed(4)}
                      </Text>
                    ) : (
                      <Text style={{ textAlign: "center", color: "#94a3b8" }}>
                        —
                      </Text>
                    )}
                  </View>
                  <View style={[s.celda, s.cNivel]}>
                    <Text
                      style={{
                        textAlign: "center",
                        fontFamily: "Helvetica-Bold",
                        fontSize: 7.5,
                      }}
                    >
                      {f.nivel ?? ""}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
        <Text style={s.leyenda}>
          Semáforo: verde &lt; 0.2 in/s · amarillo 0.2 – 0.3 in/s · rojo ≥ 0.3
          in/s
        </Text>

        {/* Otros valores (aceleraciones y temperaturas) */}
        {data.otrosValores.length > 0 && (
          <View style={s.tablaSecWrap}>
            <Text style={s.seccionCentrada}>Aceleraciones y temperaturas</Text>
            <View style={s.tabla}>
              <View style={s.filaHead}>
                <Text style={[s.celdaHead, { width: "25%" }]}>Sensor</Text>
                <Text style={[s.celdaHead, { width: "40%" }]}>Medidor</Text>
                <Text
                  style={[s.celdaHead, { width: "20%", textAlign: "center" }]}
                >
                  Valor
                </Text>
                <Text style={[s.celdaHead, { width: "15%" }]}>Unidad</Text>
              </View>
              {data.otrosValores.map((o, i) => (
                <View
                  key={i}
                  style={[s.fila, i % 2 === 1 ? s.filaAlt : {}]}
                  wrap={false}
                >
                  <Text
                    style={[
                      s.celda,
                      { width: "25%", fontFamily: "Helvetica-Bold" },
                    ]}
                  >
                    {o.sensor}
                  </Text>
                  <Text style={[s.celda, { width: "40%" }]}>{o.medidor}</Text>
                  <Text
                    style={[s.celda, { width: "20%", textAlign: "center" }]}
                  >
                    {o.valor || "—"}
                  </Text>
                  <Text style={[s.celda, { width: "15%" }]}>{o.unidad}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Después del cuadro: solo Observaciones (como en el informe manual) */}
        {!htmlEstaVacio(data.observaciones) && (
          <>
            <Text style={s.seccion}>Observaciones</Text>
            {htmlABloquesPdf(data.observaciones)}
          </>
        )}

        {/* Espectros: fotos (1 a 3, con marco y separación) + diagnóstico */}
        {data.evidencias
          .filter((ev) => ev.fotos.length > 0 || !htmlEstaVacio(ev.comentario))
          .map((ev, i) => (
            <View key={i} style={s.bloqueEvidencia} wrap={false}>
              <Text style={s.seccion}>Espectro {i + 1}</Text>
              {ev.fotos.length > 0 && (
                <View style={s.fotosFila}>
                  {ev.fotos.map((foto, j) => (
                    <View key={j} style={s.fotoMarco}>
                      {/* eslint-disable-next-line jsx-a11y/alt-text */}
                      <Image src={foto} style={s.foto} />
                    </View>
                  ))}
                </View>
              )}
              {!htmlEstaVacio(ev.comentario) && (
                <View style={s.comentario}>
                  {htmlABloquesPdf(ev.comentario)}
                </View>
              )}
            </View>
          ))}

        {/* Recomendaciones: cierre del informe */}
        {!htmlEstaVacio(data.recomendaciones) && (
          <View style={{ marginTop: 10 }}>
            <Text style={s.seccion}>Recomendaciones</Text>
            {htmlABloquesPdf(data.recomendaciones)}
          </View>
        )}

        {pie}
      </Page>
    </Document>
  );
}
