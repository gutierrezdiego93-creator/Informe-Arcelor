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
  comentario: string;
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
  observaciones: string;
  filasVelocidad: FilaVelocidad[];
  otrosValores: OtroValor[];
  diagnostico: string;
  recomendaciones: string;
  evidencias: EvidenciaPDF[];
}

// ---------- Colores del semáforo ----------

const COLOR_NIVEL: Record<string, { bg: string; fg: string }> = {
  NORMAL: { bg: "#22c55e", fg: "#ffffff" },
  ALERTA: { bg: "#fde047", fg: "#1e293b" },
  CRÍTICO: { bg: "#dc2626", fg: "#ffffff" },
};

const BRAND = "#2929ff";

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
    marginBottom: 12,
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
  parrafo: { lineHeight: 1.5, textAlign: "justify" },
  // Tabla
  tabla: {
    borderWidth: 1,
    borderColor: "#94a3b8",
    borderRadius: 2,
    marginBottom: 4,
  },
  filaHead: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderBottomWidth: 1.5,
    borderColor: "#94a3b8",
  },
  fila: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#cbd5e1",
  },
  celdaHead: {
    padding: 5,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    textTransform: "uppercase",
  },
  celda: { padding: 4, justifyContent: "center" },
  cSensor: { width: "28%", borderRightWidth: 0.5, borderColor: "#cbd5e1" },
  cPos: { width: "22%", borderRightWidth: 0.5, borderColor: "#cbd5e1" },
  cVal: { width: "25%", borderRightWidth: 0.5, borderColor: "#cbd5e1" },
  cNivel: { width: "25%" },
  chip: {
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 6,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    fontSize: 9,
  },
  // Evidencias
  foto: {
    maxHeight: 260,
    objectFit: "contain",
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  comentario: {
    backgroundColor: "#f8fafc",
    borderLeftWidth: 3,
    borderColor: BRAND,
    padding: 8,
    lineHeight: 1.5,
    marginBottom: 10,
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

  return (
    <Document
      title={`Reporte de Condición ${data.activo.codigo} - Semana ${data.semana}`}
      author={data.analista}
    >
      <Page size="LETTER" style={s.page}>
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

        {/* Cuadro de velocidades */}
        <Text style={s.seccion}>
          Valores globales de vibración (Velocidad, in/s)
        </Text>
        <View style={s.tabla}>
          <View style={s.filaHead}>
            <Text style={[s.celdaHead, s.cSensor]}>Punto de medición</Text>
            <Text style={[s.celdaHead, s.cPos]}>Posición</Text>
            <Text style={[s.celdaHead, s.cVal, { textAlign: "center" }]}>
              Velocidad (in/s)
            </Text>
            <Text style={[s.celdaHead, s.cNivel, { textAlign: "center" }]}>
              Condición
            </Text>
          </View>
          {data.filasVelocidad.map((f, i) => (
            <View key={i} style={s.fila} wrap={false}>
              <View style={[s.celda, s.cSensor]}>
                {f.primeraDelGrupo ? (
                  <>
                    <Text style={{ fontFamily: "Helvetica-Bold" }}>
                      {f.sensor}
                    </Text>
                    <Text style={{ fontSize: 7, color: "#64748b" }}>
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
                    fontSize: 8,
                  }}
                >
                  {f.nivel ?? ""}
                </Text>
              </View>
            </View>
          ))}
        </View>
        <Text style={{ fontSize: 7, color: "#64748b", marginBottom: 6 }}>
          Semáforo: verde &lt; 0.2 in/s · amarillo 0.2 – 0.3 in/s · rojo ≥ 0.3
          in/s
        </Text>

        {/* Otros valores (aceleraciones y temperaturas) */}
        {data.otrosValores.length > 0 && (
          <>
            <Text style={s.seccion}>Aceleraciones y temperaturas</Text>
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
                <View key={i} style={s.fila} wrap={false}>
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
          </>
        )}

        {/* Observaciones / diagnóstico / recomendaciones */}
        {data.observaciones.trim() !== "" && (
          <>
            <Text style={s.seccion}>Observaciones generales</Text>
            <Text style={s.parrafo}>{data.observaciones}</Text>
          </>
        )}
        {data.diagnostico.trim() !== "" && (
          <>
            <Text style={s.seccion}>Diagnóstico</Text>
            <Text style={s.parrafo}>{data.diagnostico}</Text>
          </>
        )}
        {data.recomendaciones.trim() !== "" && (
          <>
            <Text style={s.seccion}>Recomendaciones</Text>
            <Text style={s.parrafo}>{data.recomendaciones}</Text>
          </>
        )}

        {pie}
      </Page>

      {/* Espectros: cada bloque en su propia página */}
      {data.evidencias
        .filter((ev) => ev.fotos.length > 0 || ev.comentario.trim() !== "")
        .map((ev, i) => (
          <Page key={i} size="LETTER" style={s.page}>
            <Text style={s.seccion}>Espectro {i + 1}</Text>
            {ev.fotos.map((foto, j) => (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image key={j} src={foto} style={s.foto} />
            ))}
            {ev.comentario.trim() !== "" && (
              <View style={s.comentario}>
                <Text>{ev.comentario}</Text>
              </View>
            )}
            {pie}
          </Page>
        ))}
    </Document>
  );
}
