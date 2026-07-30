"use client";

// Wizard del informe de condición
// Paso 1: activo y sensores · Paso 2: datos de inspección · Paso 3: valores
// Paso 4: diagnóstico y recomendaciones por sensor
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Asset, SensorGroup } from "@/lib/fracttal";
import {
  esVelocidad,
  categoriaDeMedidor,
  mmsAIns,
  posicionDeMedidor,
  ordenarPorPosicion,
  ordenarMedidores,
} from "@/lib/fracttal";
import type {
  DiagramaActivo,
  FilaVelocidad,
  InformeData,
  OtroValor,
} from "@/components/InformePDF";
import type { ActivoMonitoreadoDetalle } from "@/lib/db";
import RichTextEditor from "@/components/RichTextEditor";

type Estado = "idle" | "cargando" | "ok" | "error";

/**
 * fetch que tolera fallas temporales de Fracttal/Vercel:
 * - Reintenta hasta 3 veces (espera 2 s entre intentos).
 * - Si la respuesta no es JSON (página de error de Vercel), lo trata
 *   como falla temporal en vez de romper con "Unexpected token".
 */
async function fetchJsonConReintentos(
  url: string,
  intentos = 3
): Promise<any> {
  let ultimoError = "";
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const texto = await res.text();
      let json: any;
      try {
        json = JSON.parse(texto);
      } catch {
        throw new Error(
          "Fracttal tardó demasiado en responder (falla temporal)"
        );
      }
      if (!res.ok || json.success === false) {
        throw new Error(json.message ?? `Error ${res.status}`);
      }
      return json;
    } catch (err) {
      ultimoError = err instanceof Error ? err.message : "Error desconocido";
      if (i < intentos - 1) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(
    `${ultimoError}. Se intentó ${intentos} veces — pulsa Reintentar.`
  );
}

const NIVELES = ["NORMAL", "ALERTA", "CRÍTICO"] as const;
type Nivel = (typeof NIVELES)[number];

interface DatosInspeccion {
  semana: string;
  fecha: string;
  area: string;
  analista: string;
  condicionOperacion: string;
  nivel: Nivel;
  observaciones: string;
}

function semanaISO(fechaStr: string): string {
  const d = new Date(fechaStr + "T12:00:00");
  if (isNaN(d.getTime())) return "";
  const target = new Date(d.valueOf());
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getDay() + 6) % 7)) /
        7
    );
  return String(week);
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Límites de severidad para VELOCIDAD (in/s), como en el informe manual */
function nivelPorVelocidad(v: number): Nivel {
  if (v < 0.2) return "NORMAL";
  if (v < 0.3) return "ALERTA";
  return "CRÍTICO";
}

/** Clases de color de celda según nivel (verde / amarillo / rojo) */
function claseNivel(n: Nivel): string {
  if (n === "NORMAL") return "bg-green-500 text-white";
  if (n === "ALERTA") return "bg-yellow-300 text-slate-900";
  return "bg-red-600 text-white";
}

/** Bloque de evidencia (paso 5): hasta 3 fotos de espectro + diagnóstico */
interface Evidencia {
  fotos: string[]; // data URLs (base64)
  comentario: string; // HTML (texto enriquecido): diagnóstico de este espectro
}

const MAX_FOTOS_POR_BLOQUE = 3;

export default function NuevoInforme() {
  const [paso, setPaso] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);

  // --- Paso 1: activos y sensores ---
  const [activos, setActivos] = useState<Asset[]>([]);
  const [ubicacion, setUbicacion] = useState("");
  const [estadoActivos, setEstadoActivos] = useState<Estado>("cargando");
  const [errorActivos, setErrorActivos] = useState("");
  const [filtro, setFiltro] = useState("");
  const [activoSel, setActivoSel] = useState<Asset | null>(null);
  const [estadoSensores, setEstadoSensores] = useState<Estado>("idle");
  const [errorSensores, setErrorSensores] = useState("");
  const [grupos, setGrupos] = useState<SensorGroup[]>([]);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());

  // --- Paso 2: datos de inspección ---
  const [datos, setDatos] = useState<DatosInspeccion>({
    semana: semanaISO(hoyISO()),
    fecha: hoyISO(),
    area: "",
    analista: "",
    condicionOperacion: "En operación",
    nivel: "NORMAL",
    observaciones: "",
  });

  // --- Paso 3: valores por medidor (editables), clave = serial ---
  const [valores, setValores] = useState<Record<string, string>>({});
  // Medidores EXCLUIDOS del informe (todos incluidos por defecto)
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  // Promedio de las últimas 10 lecturas por medidor (clave = id del medidor)
  const [promedios, setPromedios] = useState<
    Record<number, { avg: number; count: number; min: number; max: number }>
  >({});
  const [calculandoProm, setCalculandoProm] = useState(false);

  // --- Paso 5: evidencias (espectros) ---
  const [evidencias, setEvidencias] = useState<Evidencia[]>([
    { fotos: [], comentario: "" },
  ]);

  // --- Paso 6: recomendaciones GENERALES (cierre del informe) ---
  const [recomendacionesGeneral, setRecomendacionesGeneral] = useState("");

  const cargarActivos = useCallback(async () => {
    setEstadoActivos("cargando");
    setErrorActivos("");
    try {
      const json = await fetchJsonConReintentos("/api/fracttal/assets");
      setActivos(json.data);
      setUbicacion(json.location);
      setEstadoActivos("ok");
    } catch (err) {
      setErrorActivos(
        err instanceof Error ? err.message : "Error desconocido"
      );
      setEstadoActivos("error");
    }
  }, []);

  useEffect(() => {
    cargarActivos();
  }, [cargarActivos]);

  const activosFiltrados = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return activos;
    return activos.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        (a.field_1 ?? a.description).toLowerCase().includes(q)
    );
  }, [activos, filtro]);

  const gruposSeleccionados = useMemo(
    () => grupos.filter((g) => seleccion.has(g.code)),
    [grupos, seleccion]
  );

  async function elegirActivo(a: Asset) {
    setActivoSel(a);
    setEstadoSensores("cargando");
    setErrorSensores("");
    setGrupos([]);
    setSeleccion(new Set());
    setExcluidos(new Set());
    try {
      const json = await fetchJsonConReintentos(
        `/api/fracttal/sensors?code=${encodeURIComponent(a.code)}`
      );
      setGrupos(json.data);
      setSeleccion(new Set(json.data.map((g: SensorGroup) => g.code)));
      setEstadoSensores("ok");
      setDatos((d) => ({
        ...d,
        area: a.parent_description?.replaceAll("//", "").trim() ?? d.area,
      }));
    } catch (err) {
      setErrorSensores(
        err instanceof Error ? err.message : "Error desconocido"
      );
      setEstadoSensores("error");
    }
  }

  function toggle(code: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleMedidor(serial: string) {
    setExcluidos((prev) => {
      const next = new Set(prev);
      if (next.has(serial)) next.delete(serial);
      else next.add(serial);
      return next;
    });
  }

  /** Marca o desmarca de golpe TODOS los medidores de una categoría
   *  (velocidad / aceleración / temperatura) en todos los sensores */
  function toggleCategoria(cat: "vel" | "acel" | "temp" | "todos") {
    setExcluidos((prev) => {
      const next = new Set(prev);
      const medidores = gruposSeleccionados.flatMap((g) =>
        g.meters.filter((m) => cat === "todos" || categoriaDeMedidor(m) === cat)
      );
      const todosIncluidos = medidores.every((m) => !next.has(m.serial));
      for (const m of medidores) {
        if (todosIncluidos) next.add(m.serial);
        else next.delete(m.serial);
      }
      return next;
    });
  }

  /** Marca o desmarca todos los medidores de un sensor */
  function toggleGrupoMedidores(g: SensorGroup) {
    setExcluidos((prev) => {
      const next = new Set(prev);
      const todosIncluidos = g.meters.every((m) => !next.has(m.serial));
      for (const m of g.meters) {
        if (todosIncluidos) next.add(m.serial);
        else next.delete(m.serial);
      }
      return next;
    });
  }

  const totalMedidoresIncluidos = useMemo(
    () =>
      gruposSeleccionados.reduce(
        (acc, g) =>
          acc + g.meters.filter((m) => !excluidos.has(m.serial)).length,
        0
      ),
    [gruposSeleccionados, excluidos]
  );

  async function irAPaso3() {
    // 1) Pedir a Fracttal las últimas 10 lecturas de cada medidor (por sensor)
    //    y calcular el promedio para un valor más representativo.
    setCalculandoProm(true);
    const prom: Record<
      number,
      { avg: number; count: number; min: number; max: number }
    > = {};
    try {
      await Promise.all(
        gruposSeleccionados.map(async (g) => {
          try {
            const json = await fetchJsonConReintentos(
              `/api/fracttal/averages?code=${encodeURIComponent(g.code)}&n=10`
            );
            Object.assign(prom, json.data);
          } catch {
            // este sensor queda con la última lectura como respaldo
          }
        })
      );
    } catch {
      // sin promedios: se usa la última lectura como respaldo
    }
    setPromedios(prom);

    // 2) Precargar valores: promedio si existe, si no la última lectura.
    //    Las VELOCIDADES llegan de Fracttal en mm/s: convertir a in/s (÷ 25.4).
    const iniciales: Record<string, string> = {};
    for (const g of gruposSeleccionados) {
      for (const m of g.meters) {
        if (valores[m.serial] !== undefined) {
          iniciales[m.serial] = valores[m.serial];
          continue;
        }
        const base = prom[m.id]?.avg ?? m.last_data?.value;
        if (base === undefined) {
          iniciales[m.serial] = "";
        } else {
          iniciales[m.serial] = esVelocidad(m)
            ? mmsAIns(base)
            : String(Number(base.toFixed(4)));
        }
      }
    }
    setValores(iniciales);
    setCalculandoProm(false);
    setPaso(3);
  }

  function irAPaso4() {
    setPaso(4);
  }

  /** Lee un archivo de imagen y lo agrega como data URL al bloque indicado */
  function agregarFoto(idxBloque: number, file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setEvidencias((prev) =>
        prev.map((ev, i) =>
          i === idxBloque && ev.fotos.length < MAX_FOTOS_POR_BLOQUE
            ? { ...ev, fotos: [...ev.fotos, dataUrl] }
            : ev
        )
      );
    };
    reader.readAsDataURL(file);
  }

  function quitarFoto(idxBloque: number, idxFoto: number) {
    setEvidencias((prev) =>
      prev.map((ev, i) =>
        i === idxBloque
          ? { ...ev, fotos: ev.fotos.filter((_, j) => j !== idxFoto) }
          : ev
      )
    );
  }

  function setComentario(idxBloque: number, texto: string) {
    setEvidencias((prev) =>
      prev.map((ev, i) =>
        i === idxBloque ? { ...ev, comentario: texto } : ev
      )
    );
  }

  /** Arma el diagrama del activo para el PDF, SI el activo tiene un
   *  "Activo monitoreado" configurado (imagen + sensores posicionados).
   *  Solo incluye los sensores que están seleccionados en este informe
   *  (presentes en gruposSeleccionados); muestra únicamente su ubicación
   *  y código, sin valores (los valores están en el cuadro de abajo). */
  function construirDiagrama(
    configActivo: ActivoMonitoreadoDetalle | null
  ): DiagramaActivo | null {
    if (!configActivo) return null;
    const sensores = configActivo.sensores
      .filter((sp) =>
        gruposSeleccionados.some((gr) => gr.code === sp.sensor_code)
      )
      .map((sp) => ({
        sensorCode: sp.sensor_code,
        sensorLabel: sp.sensor_label ?? sp.sensor_code,
        posX: sp.pos_x,
        posY: sp.pos_y,
      }));
    return { imagenUrl: configActivo.imagen_url ?? "", sensores };
  }

  /** Reúne todo lo capturado en la estructura que consume el PDF */
  function construirDatosInforme(
    configActivo: ActivoMonitoreadoDetalle | null
  ): InformeData {
    const filasVelocidad: FilaVelocidad[] = [];
    const otrosValores: OtroValor[] = [];
    let peor: Nivel = "NORMAL";
    const pesoNivel = { NORMAL: 0, ALERTA: 1, CRÍTICO: 2 } as const;

    for (const g of gruposSeleccionados) {
      const velocidades = ordenarPorPosicion(
        g.meters.filter((m) => esVelocidad(m) && !excluidos.has(m.serial))
      );
      velocidades.forEach((m, i) => {
        const v = parseFloat(valores[m.serial] ?? "");
        const nivel = isNaN(v) ? null : nivelPorVelocidad(v);
        if (nivel && pesoNivel[nivel] > pesoNivel[peor]) peor = nivel;
        filasVelocidad.push({
          sensor: g.code,
          sensorDesc: g.description,
          posicion: posicionDeMedidor(m),
          valor: isNaN(v) ? null : v,
          nivel,
          primeraDelGrupo: i === 0,
          filasDelGrupo: velocidades.length,
        });
      });
      for (const m of ordenarMedidores(g.meters)) {
        if (esVelocidad(m) || excluidos.has(m.serial)) continue;
        otrosValores.push({
          sensor: g.code,
          medidor: m.description,
          valor: valores[m.serial] ?? "",
          unidad: m.units_code,
        });
      }
    }

    return {
      activo: {
        nombre: activoSel?.field_1 ?? activoSel?.description ?? "",
        codigo: activoSel?.code ?? "",
        fabricante: activoSel?.field_2 ?? undefined,
        modelo: activoSel?.field_3 ?? undefined,
      },
      semana: datos.semana,
      fecha: datos.fecha,
      area: datos.area,
      analista: datos.analista,
      condicionOperacion: datos.condicionOperacion,
      nivelGeneral: peor,
      observaciones: datos.observaciones,
      filasVelocidad,
      otrosValores,
      recomendaciones: recomendacionesGeneral,
      evidencias,
      diagrama: construirDiagrama(configActivo),
    };
  }

  const [generandoPDF, setGenerandoPDF] = useState(false);

  async function generarPDF() {
    setGenerandoPDF(true);
    try {
      // Import dinámico: la librería solo se descarga al generar el PDF
      const [{ pdf }, { InformePDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/InformePDF"),
      ]);

      // Si el activo tiene un "Activo monitoreado" configurado (imagen +
      // sensores posicionados), se agrega el diagrama al PDF. Si no está
      // configurado o falla la consulta, el informe se genera igual, sin
      // esa sección — no interrumpe la descarga.
      let configActivo: ActivoMonitoreadoDetalle | null = null;
      if (activoSel) {
        try {
          const res = await fetch(
            `/api/activos/${encodeURIComponent(activoSel.code)}`,
            { cache: "no-store" }
          );
          if (res.ok) {
            const json = await res.json();
            if (json.success) configActivo = json.data;
          }
        } catch {
          // sin diagrama si falla la consulta
        }
      }

      const data = construirDatosInforme(configActivo);
      const blob = await pdf(<InformePDF data={data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Reporte_Condicion_${data.activo.codigo}_Semana_${data.semana}.pdf`;
      a.click();

      // Guarda el informe en el historial (si falla, no interrumpe la descarga)
      try {
        await fetch("/api/informes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } catch (errGuardado) {
        console.warn("No se pudo guardar el informe en el historial:", errGuardado);
      }

      // Dar tiempo a que inicie la descarga y volver al inicio para un nuevo informe
      setTimeout(() => {
        URL.revokeObjectURL(url);
        window.location.href = "/";
      }, 1500);
    } catch (err) {
      alert(
        "No se pudo generar el PDF: " +
          (err instanceof Error ? err.message : "error desconocido")
      );
    } finally {
      setGenerandoPDF(false);
    }
  }

  // ---------- Render ----------

  const encabezado = (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-brand">
        Paso {paso} de 6
      </p>
      <h2 className="text-xl font-semibold">
        {paso === 1 && "Activo y sensores"}
        {paso === 2 && "Datos de inspección"}
        {paso === 3 && "Valores de vibración"}
        {paso === 4 && "Cuadro de condición"}
        {paso === 5 && "Evidencias · Espectros"}
        {paso === 6 && "Recomendaciones"}
      </h2>
      {activoSel && paso > 1 && (
        <p className="mt-1 text-sm text-slate-600">
          {activoSel.field_1 ?? activoSel.description} ({activoSel.code}) ·{" "}
          {gruposSeleccionados.length} sensor(es)
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {encabezado}

      {/* ================= PASO 1 ================= */}
      {paso === 1 && (
        <>
          <p className="text-sm text-slate-600">
            Selecciona el activo principal
            {ubicacion && (
              <>
                {" "}
                de la ubicación{" "}
                <code className="rounded bg-slate-100 px-1">{ubicacion}</code>
              </>
            )}
            . Luego marca los sensores a incluir en el informe.
          </p>

          {estadoActivos === "cargando" && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
              Cargando activos de Fracttal… (si tarda, reintenta solo hasta 3
              veces)
            </div>
          )}
          {estadoActivos === "error" && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <span>{errorActivos}</span>
              <button
                onClick={cargarActivos}
                className="shrink-0 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
              >
                Reintentar
              </button>
            </div>
          )}
          {estadoActivos === "ok" && (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 p-3">
                <input
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value)}
                  placeholder={`Filtrar entre ${activos.length} activo(s)…`}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </div>
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {activosFiltrados.length === 0 && (
                  <li className="p-4 text-sm text-slate-500">
                    Sin resultados.
                  </li>
                )}
                {activosFiltrados.map((a) => (
                  <li key={a.id}>
                    <button
                      onClick={() => elegirActivo(a)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50 ${
                        activoSel?.id === a.id ? "bg-brand/5" : ""
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="font-medium">
                          {a.field_1 ?? a.description}
                        </span>
                        <span className="ml-2 text-xs text-slate-500">
                          {a.code}
                        </span>
                        {a.parent_description && (
                          <span className="block truncate text-xs text-slate-400">
                            {a.parent_description}
                          </span>
                        )}
                      </span>
                      {activoSel?.id === a.id && (
                        <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-white">
                          Seleccionado
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {estadoSensores === "cargando" && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
              Cargando sensores de {activoSel?.code}…
            </div>
          )}
          {estadoSensores === "error" && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <span>{errorSensores}</span>
              <button
                onClick={() => activoSel && elegirActivo(activoSel)}
                className="shrink-0 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
              >
                Reintentar
              </button>
            </div>
          )}
          {estadoSensores === "ok" && grupos.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              El activo no tiene medidores asociados.
            </div>
          )}

          {grupos.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">
                  Sensores de {activoSel?.field_1 ?? activoSel?.code} (
                  {grupos.length})
                </h3>
                <button
                  onClick={() =>
                    setSeleccion(
                      seleccion.size === grupos.length
                        ? new Set()
                        : new Set(grupos.map((g) => g.code))
                    )
                  }
                  className="text-sm text-brand hover:underline"
                >
                  {seleccion.size === grupos.length
                    ? "Deseleccionar todos"
                    : "Seleccionar todos"}
                </button>
              </div>

              <ul className="grid gap-3 sm:grid-cols-2">
                {grupos.map((g) => {
                  const activo = seleccion.has(g.code);
                  return (
                    <li key={g.code}>
                      <label
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                          activo
                            ? "border-brand bg-brand/5"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={activo}
                          onChange={() => toggle(g.code)}
                          className="mt-1 h-4 w-4 accent-[#2929ff]"
                        />
                        <div className="min-w-0">
                          <p className="font-medium">
                            {g.code}{" "}
                            <span className="font-normal text-slate-500">
                              · {g.description}
                            </span>
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {g.meters.length} medidor(es)
                          </p>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>

              <div className="flex justify-end border-t border-slate-200 pt-4">
                <button
                  onClick={() => setPaso(2)}
                  disabled={seleccion.size === 0}
                  className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Continuar → Paso 2
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* ================= PASO 2 ================= */}
      {paso === 2 && (
        <>
          <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Fecha de inspección
              </label>
              <input
                type="date"
                value={datos.fecha}
                onChange={(e) =>
                  setDatos((d) => ({
                    ...d,
                    fecha: e.target.value,
                    semana: semanaISO(e.target.value),
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Semana (automática)
              </label>
              <input
                value={datos.semana}
                onChange={(e) =>
                  setDatos((d) => ({ ...d, semana: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Área</label>
              <input
                value={datos.area}
                onChange={(e) =>
                  setDatos((d) => ({ ...d, area: e.target.value }))
                }
                placeholder="Ej. Molienda"
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Analista predictivo
              </label>
              <input
                value={datos.analista}
                onChange={(e) =>
                  setDatos((d) => ({ ...d, analista: e.target.value }))
                }
                placeholder="Nombre o iniciales (ej. JCBV)"
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Condición de operación
              </label>
              <select
                value={datos.condicionOperacion}
                onChange={(e) =>
                  setDatos((d) => ({
                    ...d,
                    condicionOperacion: e.target.value,
                  }))
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm focus:border-brand focus:outline-none"
              >
                <option>En operación</option>
                <option>Carga parcial</option>
                <option>Detenido</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Nivel de condición
              </label>
              <div className="flex gap-2">
                {NIVELES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDatos((d) => ({ ...d, nivel: n }))}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold ${
                      datos.nivel === n
                        ? n === "NORMAL"
                          ? "border-green-600 bg-green-600 text-white"
                          : n === "ALERTA"
                            ? "border-amber-500 bg-amber-500 text-white"
                            : "border-red-600 bg-red-600 text-white"
                        : "border-slate-300 bg-white text-slate-600"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">
                Observaciones generales
              </label>
              <RichTextEditor
                value={datos.observaciones}
                onChange={(html) =>
                  setDatos((d) => ({ ...d, observaciones: html }))
                }
                minRows={4}
                placeholder="Comportamiento observado, cambios respecto a la semana anterior…"
              />
            </div>
          </div>

          <div className="flex justify-between border-t border-slate-200 pt-4">
            <button
              onClick={() => setPaso(1)}
              className="rounded-lg border border-slate-300 px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Paso 1
            </button>
            <button
              onClick={irAPaso3}
              disabled={!datos.fecha || !datos.analista.trim() || calculandoProm}
              className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {calculandoProm
                ? "Calculando promedios de Fracttal…"
                : "Continuar → Paso 3"}
            </button>
          </div>
          {!datos.analista.trim() && (
            <p className="text-xs text-slate-400">
              * Escribe el nombre del analista para continuar.
            </p>
          )}
        </>
      )}

      {/* ================= PASO 3 ================= */}
      {paso === 3 && (
        <>
          <p className="text-sm text-slate-600">
            Marca los medidores que entrarán en el informe. Los valores vienen
            precargados con el <strong>promedio de las últimas 10 lecturas</strong>{" "}
            de Fracttal (puedes ajustarlos si tomaste una medición más reciente
            con el colector). Las <strong>velocidades</strong> se convierten
            automáticamente de mm/s (dato crudo de Fracttal) a in/s (÷ 25.4).
          </p>

          {/* Barra de selección rápida por categoría */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Marcar / desmarcar en un clic:
            </span>
            {(
              [
                ["todos", "Todos"],
                ["vel", "Velocidades (in/s)"],
                ["acel", "Aceleraciones (g)"],
                ["temp", "Temperaturas (°C)"],
              ] as const
            ).map(([cat, etiqueta]) => {
              const medidores = gruposSeleccionados.flatMap((g) =>
                g.meters.filter(
                  (m) => cat === "todos" || categoriaDeMedidor(m) === cat
                )
              );
              const incluidos = medidores.filter(
                (m) => !excluidos.has(m.serial)
              ).length;
              const activo = incluidos === medidores.length && medidores.length > 0;
              return (
                <button
                  key={cat}
                  onClick={() => toggleCategoria(cat)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    activo
                      ? "border-brand bg-brand text-white"
                      : incluidos > 0
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-slate-300 bg-white text-slate-500"
                  }`}
                >
                  {etiqueta} · {incluidos}/{medidores.length}
                </button>
              );
            })}
          </div>

          {gruposSeleccionados.map((g) => {
            const incluidosGrupo = g.meters.filter(
              (m) => !excluidos.has(m.serial)
            ).length;
            return (
              <div
                key={g.code}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
              >
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
                  <div>
                    <span className="font-semibold">{g.code}</span>{" "}
                    <span className="text-sm text-slate-500">
                      · {g.description}
                    </span>
                    <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                      {incluidosGrupo}/{g.meters.length} en informe
                    </span>
                  </div>
                  <button
                    onClick={() => toggleGrupoMedidores(g)}
                    className="text-xs text-brand hover:underline"
                  >
                    {incluidosGrupo === g.meters.length
                      ? "Desmarcar todos"
                      : "Marcar todos"}
                  </button>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="w-10 px-4 py-2"></th>
                      <th className="px-4 py-2">Medidor</th>
                      <th className="px-4 py-2">Valor</th>
                      <th className="px-4 py-2">Unidad</th>
                      <th className="px-4 py-2">Dato de Fracttal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ordenarMedidores(g.meters).map((m) => {
                      const incluido = !excluidos.has(m.serial);
                      return (
                        <tr
                          key={m.id}
                          className={incluido ? "" : "opacity-40"}
                        >
                          <td className="px-4 py-2">
                            <input
                              type="checkbox"
                              checked={incluido}
                              onChange={() => toggleMedidor(m.serial)}
                              className="h-4 w-4 accent-[#2929ff]"
                            />
                          </td>
                          <td className="px-4 py-2">{m.description}</td>
                          <td className="px-4 py-2">
                            <input
                              type="number"
                              step="any"
                              disabled={!incluido}
                              value={valores[m.serial] ?? ""}
                              onChange={(e) =>
                                setValores((v) => ({
                                  ...v,
                                  [m.serial]: e.target.value,
                                }))
                              }
                              className="w-28 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none disabled:bg-slate-100"
                            />
                          </td>
                          <td className="px-4 py-2 text-slate-500">
                            {m.units_code}
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-400">
                            {promedios[m.id] ? (
                              <>
                                <span className="font-medium text-slate-500">
                                  Prom. de {promedios[m.id].count} lecturas
                                </span>
                                <span className="block text-slate-300">
                                  {promedios[m.id].min} – {promedios[m.id].max}{" "}
                                  {esVelocidad(m) ? "mm/s en Fracttal" : m.units_code}
                                </span>
                              </>
                            ) : m.last_data ? (
                              <>
                                Última:{" "}
                                {new Date(m.last_data.date).toLocaleString(
                                  "es-MX"
                                )}
                                {esVelocidad(m) && (
                                  <span className="block text-slate-300">
                                    {m.last_data.value} mm/s en Fracttal
                                  </span>
                                )}
                              </>
                            ) : (
                              "Sin lecturas"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}

          <div className="flex justify-between border-t border-slate-200 pt-4">
            <button
              onClick={() => setPaso(2)}
              className="rounded-lg border border-slate-300 px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Paso 2
            </button>
            <button
              onClick={irAPaso4}
              disabled={totalMedidoresIncluidos === 0}
              className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Continuar → Paso 4 ({totalMedidoresIncluidos} medidores)
            </button>
          </div>
          {totalMedidoresIncluidos === 0 && (
            <p className="text-xs text-slate-400">
              * Marca al menos un medidor para continuar.
            </p>
          )}
        </>
      )}

      {/* ================= PASO 4 ================= */}
      {paso === 4 && (
        <>
          <p className="text-sm text-slate-600">
            Cuadro de valores globales de vibración con el semáforo del
            informe: <span className="font-semibold text-green-600">verde</span>{" "}
            &lt; 0.2 in/s ·{" "}
            <span className="font-semibold text-amber-500">amarillo</span> 0.2
            – 0.3 in/s ·{" "}
            <span className="font-semibold text-red-600">rojo</span> ≥ 0.3
            in/s. Los colores se calculan solos con los valores del paso 3.
          </p>

          {/* Cuadro de velocidades estilo informe */}
          <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-slate-300 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                  <th className="px-4 py-2">Punto de medición</th>
                  <th className="px-4 py-2">Posición</th>
                  <th className="px-4 py-2 text-center">
                    Velocidad (in/s)
                    <span className="block normal-case text-slate-400">
                      {datos.fecha}
                    </span>
                  </th>
                  <th className="px-4 py-2 text-center">Condición</th>
                </tr>
              </thead>
              <tbody>
                {gruposSeleccionados.map((g) => {
                  const velocidades = ordenarPorPosicion(
                    g.meters.filter(
                      (m) => esVelocidad(m) && !excluidos.has(m.serial)
                    )
                  );
                  if (velocidades.length === 0) return null;
                  return velocidades.map((m, i) => {
                    const v = parseFloat(valores[m.serial] ?? "");
                    const tieneValor = !isNaN(v);
                    const nivel = tieneValor ? nivelPorVelocidad(v) : null;
                    return (
                      <tr
                        key={m.id}
                        className={
                          i === velocidades.length - 1
                            ? "border-b-2 border-slate-300"
                            : "border-b border-dashed border-slate-200"
                        }
                      >
                        {i === 0 && (
                          <td
                            rowSpan={velocidades.length}
                            className="border-r border-slate-200 px-4 py-2 align-middle font-semibold"
                          >
                            {g.code}
                            <span className="block text-xs font-normal text-slate-500">
                              {g.description}
                            </span>
                          </td>
                        )}
                        <td className="px-4 py-1.5 text-slate-600">
                          {posicionDeMedidor(m)}
                        </td>
                        <td className="px-4 py-1.5 text-center">
                          {tieneValor ? (
                            <span
                              className={`inline-block w-24 rounded px-2 py-1 font-bold ${claseNivel(nivel!)}`}
                            >
                              {v.toFixed(4)}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-1.5 text-center text-xs font-semibold">
                          {nivel ?? ""}
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between border-t border-slate-200 pt-4">
            <button
              onClick={() => setPaso(3)}
              className="rounded-lg border border-slate-300 px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Paso 3
            </button>
            <button
              onClick={() => setPaso(5)}
              className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              Continuar → Paso 5
            </button>
          </div>
        </>
      )}

      {/* ================= PASO 5 ================= */}
      {paso === 5 && (
        <>
          <p className="text-sm text-slate-600">
            Sube las capturas de los <strong>espectros</strong> del colector
            (1, 2 o 3 fotos por bloque, a tu elección) y escribe abajo el
            diagnóstico de ese análisis, como en el informe original. Puedes
            agregar más bloques si documentas varios puntos.
          </p>

          {evidencias.map((ev, i) => (
            <div
              key={i}
              className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Espectro {i + 1}</h3>
                {evidencias.length > 1 && (
                  <button
                    onClick={() =>
                      setEvidencias((prev) =>
                        prev.filter((_, j) => j !== i)
                      )
                    }
                    className="text-xs text-red-600 hover:underline"
                  >
                    Eliminar bloque
                  </button>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {ev.fotos.map((foto, j) => (
                  <div
                    key={j}
                    className="relative overflow-hidden rounded-lg border-2 border-slate-300 bg-white p-1 shadow-sm"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={foto}
                      alt={`Espectro ${i + 1} - foto ${j + 1}`}
                      className="max-h-72 w-full bg-white object-contain"
                    />
                    <button
                      onClick={() => quitarFoto(i, j)}
                      className="absolute right-2 top-2 rounded-full bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
                {ev.fotos.length < MAX_FOTOS_POR_BLOQUE && (
                  <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-brand hover:text-brand">
                    <span className="text-2xl">+</span>
                    <span>
                      Subir foto {ev.fotos.length + 1} de {MAX_FOTOS_POR_BLOQUE} (espectro)
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) agregarFoto(i, f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Diagnóstico de este espectro
                </label>
                <RichTextEditor
                  value={ev.comentario}
                  onChange={(html) => setComentario(i, html)}
                  minRows={3}
                  placeholder="Ej. El análisis orbital confirma la desalineación entre piñón y corona (se refleja el 2xGM). Dar seguimiento…"
                />
              </div>
            </div>
          ))}

          <button
            onClick={() =>
              setEvidencias((prev) => [...prev, { fotos: [], comentario: "" }])
            }
            className="w-full rounded-xl border-2 border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 hover:border-brand hover:text-brand"
          >
            + Agregar otro espectro
          </button>

          <div className="flex justify-between border-t border-slate-200 pt-4">
            <button
              onClick={() => setPaso(4)}
              className="rounded-lg border border-slate-300 px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Paso 4
            </button>
            <button
              onClick={() => setPaso(6)}
              className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              Continuar → Paso 6
            </button>
          </div>
        </>
      )}

      {/* ================= PASO 6 ================= */}
      {paso === 6 && (
        <>
          <div>
            <h3 className="mb-1 font-semibold">Recomendaciones</h3>
            <p className="text-sm text-slate-600">
              Escribe las recomendaciones finales del informe (mantenimiento,
              seguimiento, repuestos, plazos, etc.). Con esto se cierra el
              reporte de condición.
            </p>
          </div>

          <RichTextEditor
            value={recomendacionesGeneral}
            onChange={setRecomendacionesGeneral}
            minRows={6}
            placeholder="Ej. Se recomienda reprogramar el balanceo del ventilador en la próxima parada y verificar el estado de los rodamientos en 30 días…"
          />

          <div className="flex justify-between border-t border-slate-200 pt-4">
            <button
              onClick={() => setPaso(5)}
              className="rounded-lg border border-slate-300 px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Paso 5
            </button>
            <button
              onClick={generarPDF}
              disabled={generandoPDF}
              className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {generandoPDF ? "Generando PDF…" : "⬇ Generar PDF del informe"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
