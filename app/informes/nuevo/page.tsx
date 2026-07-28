"use client";

// Paso 1 del wizard: seleccionar activo principal → sensores (sub-activos)
import { useState } from "react";
import type { SensorGroup } from "@/lib/fracttal";

type Estado = "idle" | "cargando" | "ok" | "error";

export default function NuevoInforme() {
  const [assetCode, setAssetCode] = useState("");
  const [estado, setEstado] = useState<Estado>("idle");
  const [error, setError] = useState("");
  const [grupos, setGrupos] = useState<SensorGroup[]>([]);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    if (!assetCode.trim()) return;
    setEstado("cargando");
    setError("");
    setGrupos([]);
    setSeleccion(new Set());
    try {
      const res = await fetch(
        `/api/fracttal/sensors?code=${encodeURIComponent(assetCode.trim())}`
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message ?? `Error ${res.status}`);
      }
      setGrupos(json.data);
      // Por defecto todos los sensores seleccionados
      setSeleccion(new Set(json.data.map((g: SensorGroup) => g.code)));
      setEstado("ok");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setEstado("error");
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
    // TODO Paso 2: datos de inspección. Por ahora persistimos la selección.
    sessionStorage.setItem(
      "informe-seleccion",
      JSON.stringify({ assetCode, sensores: [...seleccion] })
    );
    alert(
      `Activo ${assetCode} · ${seleccion.size} sensor(es) seleccionados.\nEl paso 2 (datos de inspección) llega en el siguiente PR.`
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
          Escribe el código del activo principal en Fracttal (ej.{" "}
          <code className="rounded bg-slate-100 px-1">MOLINO-6-5A</code>). Se
          listarán sus sensores y marcarás cuáles incluir en el informe.
        </p>
      </div>

      <form onSubmit={buscar} className="flex gap-2">
        <input
          value={assetCode}
          onChange={(e) => setAssetCode(e.target.value)}
          placeholder="Código del activo principal"
          className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-brand focus:outline-none"
        />
        <button
          type="submit"
          disabled={estado === "cargando"}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {estado === "cargando" ? "Buscando…" : "Buscar"}
        </button>
      </form>

      {estado === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {estado === "ok" && grupos.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          El activo no tiene medidores asociados (ni en sus sub-activos).
          Verifica el código o crea los medidores en Fracttal.
        </div>
      )}

      {grupos.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              Sensores encontrados ({grupos.length})
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
                      {g.parentPath && (
                        <p className="truncate text-xs text-slate-400">
                          {g.parentPath}
                        </p>
                      )}
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
