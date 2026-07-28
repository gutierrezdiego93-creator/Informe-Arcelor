"use client";

// Wizard del informe de condición
// Paso 1: activo y sensores · Paso 2: datos de inspección · Paso 3: valores
// Paso 4: diagnóstico y recomendaciones por sensor
import { useEffect, useMemo, useState } from "react";
import type { Asset, Meter, SensorGroup } from "@/lib/fracttal";

type Estado = "idle" | "cargando" | "ok" | "error";

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

export default function NuevoInforme() {
  const [paso, setPaso] = useState<1 | 2 | 3 | 4>(1);

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

  // --- Paso 4: diagnóstico y recomendaciones GENERALES del informe ---
  const [diagnosticoGeneral, setDiagnosticoGeneral] = useState("");
  const [recomendacionesGeneral, setRecomendacionesGeneral] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/fracttal/assets");
        const json = await res.json();
        if (!res.ok || !json.success)
          throw new Error(json.message ?? `Error ${res.status}`);
        setActivos(json.data);
        setUbicacion(json.location);
        setEstadoActivos("ok");
      } catch (err) {
        setErrorActivos(
          err instanceof Error ? err.message : "Error desconocido"
        );
        setEstadoActivos("error");
      }
    })();
  }, []);

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
      const res = await fetch(
        `/api/fracttal/sensors?code=${encodeURIComponent(a.code)}`
      );
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.message ?? `Error ${res.status}`);
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

  function irAPaso3() {
    // Precargar valores desde la última lectura de cada medidor.
    // Las VELOCIDADES llegan de Fracttal en mm/s: convertir a in/s (÷ 25.4).
    const iniciales: Record<string, string> = {};
    for (const g of gruposSeleccionados) {
      for (const m of g.meters) {
        if (valores[m.serial] !== undefined) {
          iniciales[m.serial] = valores[m.serial];
        } else if (m.last_data) {
          iniciales[m.serial] = esVelocidad(m)
            ? mmsAIns(m.last_data.value)
            : String(m.last_data.value);
        } else {
          iniciales[m.serial] = "";
        }
      }
    }
    setValores(iniciales);
    setPaso(3);
  }

  function irAPaso4() {
    setPaso(4);
  }

  function finalizarBorrador() {
    alert(
      "Datos capturados. Los pasos 5-7 (evidencias fotográficas, vista previa y generación del PDF/Word) llegan en el siguiente cambio."
    );
  }

  // ---------- Render ----------

  const encabezado = (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-brand">
        Paso {paso} de 7
      </p>
      <h2 className="text-xl font-semibold">
        {paso === 1 && "Activo y sensores"}
        {paso === 2 && "Datos de inspección"}
        {paso === 3 && "Valores de vibración"}
        {paso === 4 && "Diagnóstico y recomendaciones"}
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
              Cargando activos de Fracttal…
            </div>
          )}
          {estadoActivos === "error" && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {errorActivos}
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
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {errorSensores}
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
              <textarea
                value={datos.observaciones}
                onChange={(e) =>
                  setDatos((d) => ({ ...d, observaciones: e.target.value }))
                }
                rows={4}
                placeholder="Comportamiento observado, cambios respecto a la semana anterior…"
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-brand focus:outline-none"
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
              disabled={!datos.fecha || !datos.analista.trim()}
              className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Continuar → Paso 3
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
            Marca los medidores que entrarán en el informe (valores
            precargados con la <strong>última lectura</strong> de Fracttal;
            puedes ajustarlos si tomaste una medición más reciente con el
            colector). Las <strong>velocidades</strong> se convierten
            automáticamente de mm/s (dato crudo de Fracttal) a in/s (÷ 25.4).
          </p>

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
                      <th className="px-4 py-2">Última lectura</th>
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
                            {m.last_data ? (
                              <>
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
                  const velocidades = ordenarMedidores(g.meters).filter(
                    (m) => esVelocidad(m) && !excluidos.has(m.serial)
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

          {/* Diagnóstico y recomendaciones GENERALES */}
          <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Diagnóstico general
              </label>
              <textarea
                value={diagnosticoGeneral}
                onChange={(e) => setDiagnosticoGeneral(e.target.value)}
                rows={5}
                placeholder="Ej. Los puntos 3, 4 y 9 presentan niveles críticos de vibración. Se observa incremento respecto a la semana anterior…"
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Recomendaciones generales
              </label>
              <textarea
                value={recomendacionesGeneral}
                onChange={(e) => setRecomendacionesGeneral(e.target.value)}
                rows={5}
                placeholder="Ej. Programar inspección de rodamientos del reductor. Continuar monitoreo semanal…"
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-between border-t border-slate-200 pt-4">
            <button
              onClick={() => setPaso(3)}
              className="rounded-lg border border-slate-300 px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Paso 3
            </button>
            <button
              onClick={finalizarBorrador}
              className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              Continuar → Paso 5
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** ¿El medidor es de velocidad? (por unidad o por serial tipo CLC_velX) */
function esVelocidad(m: Meter): boolean {
  return (
    m.units_code === "in/s" ||
    m.units_code === "mm/s" ||
    m.serial.toLowerCase().includes("vel")
  );
}

/** Convierte mm/s (dato crudo de Fracttal) a in/s. 1 in = 25.4 mm */
function mmsAIns(mms: number): string {
  const ins = mms / 25.4;
  // 4 decimales máximo, sin ceros de sobra (ej. 4.48 → 0.1764)
  return String(Number(ins.toFixed(4)));
}

/** Posición del punto: extrae "Horizontal/Vertical/Axial" de la descripción */
function posicionDeMedidor(m: Meter): string {
  const match = m.description.match(/\((.+?)\)/);
  if (match) return match[1];
  const s = m.serial.toLowerCase();
  if (s.endsWith("x")) return "X";
  if (s.endsWith("y")) return "Y";
  if (s.endsWith("z")) return "Z";
  return m.description;
}

/** Velocidades primero (como en el informe), luego aceleraciones y temperatura */
function ordenarMedidores(meters: Meter[]): Meter[] {
  const peso = (m: Meter) =>
    m.units_code === "in/s" ? 0 : m.units_code === "g" ? 1 : 2;
  return [...meters].sort(
    (a, b) => peso(a) - peso(b) || a.description.localeCompare(b.description)
  );
}
