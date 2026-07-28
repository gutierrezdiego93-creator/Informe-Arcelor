"use client";

// Paso 1 del wizard: elegir activo principal (lista de la ubicación) → sensores
import { useEffect, useMemo, useState } from "react";
import type { Asset, SensorGroup } from "@/lib/fracttal";

type Estado = "idle" | "cargando" | "ok" | "error";

export default function NuevoInforme() {
  // --- Activos de la ubicación ---
  const [activos, setActivos] = useState<Asset[]>([]);
  const [ubicacion, setUbicacion] = useState("");
  const [estadoActivos, setEstadoActivos] = useState<Estado>("cargando");
  const [errorActivos, setErrorActivos] = useState("");
  const [filtro, setFiltro] = useState("");
  const [activoSel, setActivoSel] = useState<Asset | null>(null);

  // --- Sensores del activo elegido ---
  const [estadoSensores, setEstadoSensores] = useState<Estado>("idle");
  const [errorSensores, setErrorSensores] = useState("");
  const [grupos, setGrupos] = useState<SensorGroup[]>([]);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/fracttal/assets");
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message ?? `Error ${res.status}`);
        }
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

  async function elegirActivo(a: Asset) {
    setActivoSel(a);
    setEstadoSensores("cargando");
    setErrorSensores("");
    setGrupos([]);
    setSeleccion(new Set());
    try {
      const res = await fetch(
        `/api/fracttal/sensors?code=${encodeURIComponent(a.code)}`
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message ?? `Error ${res.status}`);
      }
      setGrupos(json.data);
      setSeleccion(new Set(json.data.map((g: SensorGroup) => g.code)));
      setEstadoSensores("ok");
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

  function continuar() {
    sessionStorage.setItem(
      "informe-seleccion",
      JSON.stringify({ assetCode: activoSel?.code, sensores: [...seleccion] })
    );
    alert(
      `Activo ${activoSel?.code} · ${seleccion.size} sensor(es) seleccionados.\nEl paso 2 (datos de inspección) llega en el siguiente PR.`
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-brand">
          Paso 1 de 7
        </p>
        <h2 className="text-xl font-semibold">Activo y sensores</h2>
        <p className="mt-1 text-sm text-slate-600">
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
      </div>

      {/* --- Lista de activos --- */}
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
                Sin resultados. La ubicación no tiene equipos o el filtro no
                coincide.
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

      {/* --- Sensores del activo --- */}
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
          El activo no tiene medidores asociados (ni en sus sub-activos).
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
                        {g.meters.length} medidor(es):{" "}
                        {g.meters
                          .map((m) => m.description)
                          .slice(0, 4)
                          .join(", ")}
                        {g.meters.length > 4 ? "…" : ""}
                      </p>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="flex justify-end border-t border-slate-200 pt-4">
            <button
              onClick={continuar}
              disabled={seleccion.size === 0}
              className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Continuar → Paso 2
            </button>
          </div>
        </>
      )}
    </div>
  );
}
