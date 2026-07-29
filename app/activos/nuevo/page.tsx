"use client";

// Wizard de configuración de un "Activo monitoreado" (digital twin)
// Paso 1: elegir activo Fracttal · Paso 2: subir foto/diagrama
// Paso 3: clic para ubicar cada sensor sobre la imagen · Guardar
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Asset, SensorGroup } from "@/lib/fracttal";

type Estado = "idle" | "cargando" | "ok" | "error";

async function fetchJsonConReintentos(
  url: string,
  intentos = 3
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  let ultimoError = "";
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const texto = await res.text();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

interface Posicion {
  x: number;
  y: number;
}

export default function NuevoActivoMonitoreado() {
  const router = useRouter();
  const [paso, setPaso] = useState<1 | 2 | 3>(1);

  // --- Paso 1: elegir activo ---
  const [activos, setActivos] = useState<Asset[]>([]);
  const [ubicacion, setUbicacion] = useState("");
  const [estadoActivos, setEstadoActivos] = useState<Estado>("cargando");
  const [errorActivos, setErrorActivos] = useState("");
  const [filtro, setFiltro] = useState("");
  const [activoSel, setActivoSel] = useState<Asset | null>(null);

  // --- Paso 2: imagen ---
  const [imagen, setImagen] = useState<string | null>(null);

  // --- Paso 3: sensores y posiciones ---
  const [estadoSensores, setEstadoSensores] = useState<Estado>("idle");
  const [errorSensores, setErrorSensores] = useState("");
  const [grupos, setGrupos] = useState<SensorGroup[]>([]);
  const [posiciones, setPosiciones] = useState<Record<string, Posicion>>({});
  const [sensorArmado, setSensorArmado] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

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

  function elegirActivo(a: Asset) {
    setActivoSel(a);
    setPaso(2);
  }

  function subirImagen(file: File) {
    const reader = new FileReader();
    reader.onload = () => setImagen(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function irAPaso3() {
    if (!activoSel) return;
    setPaso(3);
    setEstadoSensores("cargando");
    setErrorSensores("");
    try {
      const json = await fetchJsonConReintentos(
        `/api/fracttal/sensors?code=${encodeURIComponent(activoSel.code)}`
      );
      setGrupos(json.data);
      setEstadoSensores("ok");
    } catch (err) {
      setErrorSensores(
        err instanceof Error ? err.message : "Error desconocido"
      );
      setEstadoSensores("error");
    }
  }

  function manejarClicImagen(e: React.MouseEvent<HTMLDivElement>) {
    if (!sensorArmado) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Number(
      (((e.clientX - rect.left) / rect.width) * 100).toFixed(2)
    );
    const y = Number(
      (((e.clientY - rect.top) / rect.height) * 100).toFixed(2)
    );
    setPosiciones((prev) => ({ ...prev, [sensorArmado]: { x, y } }));
    setSensorArmado(null);
  }

  function quitarPosicion(code: string) {
    setPosiciones((prev) => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
    if (sensorArmado === code) setSensorArmado(null);
  }

  const pendientes = useMemo(
    () => grupos.filter((g) => !posiciones[g.code]),
    [grupos, posiciones]
  );
  const colocados = useMemo(
    () => grupos.filter((g) => posiciones[g.code]),
    [grupos, posiciones]
  );

  async function guardar() {
    if (!activoSel || !imagen) return;
    setGuardando(true);
    try {
      const sensores = colocados.map((g) => ({
        sensorCode: g.code,
        sensorLabel: g.description,
        x: posiciones[g.code].x,
        y: posiciones[g.code].y,
      }));
      const res = await fetch("/api/activos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activoCode: activoSel.code,
          activoNombre: activoSel.field_1 ?? activoSel.description,
          imagen,
          sensores,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Error desconocido");
      router.push(`/activos/${encodeURIComponent(activoSel.code)}`);
    } catch (err) {
      alert(
        "No se pudo guardar: " +
          (err instanceof Error ? err.message : "error desconocido")
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-brand">
          Paso {paso} de 3
        </p>
        <h2 className="text-xl font-semibold">
          {paso === 1 && "Elegir activo"}
          {paso === 2 && "Subir foto o diagrama"}
          {paso === 3 && "Ubicar sensores sobre la imagen"}
        </h2>
        {activoSel && paso > 1 && (
          <p className="mt-1 text-sm text-slate-600">
            {activoSel.field_1 ?? activoSel.description} ({activoSel.code})
          </p>
        )}
      </div>

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
            .
          </p>

          {estadoActivos === "cargando" && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
              Cargando activos de Fracttal…
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
              <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                {activosFiltrados.length === 0 && (
                  <li className="p-4 text-sm text-slate-500">
                    Sin resultados.
                  </li>
                )}
                {activosFiltrados.map((a) => (
                  <li key={a.id}>
                    <button
                      onClick={() => elegirActivo(a)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50"
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
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* ================= PASO 2 ================= */}
      {paso === 2 && (
        <>
          <p className="text-sm text-slate-600">
            Sube una foto o diagrama del equipo. Sobre esta imagen ubicarás
            cada sensor en el paso siguiente.
          </p>

          {imagen ? (
            <div className="overflow-hidden rounded-xl border-2 border-slate-300 bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagen}
                alt="Diagrama del activo"
                className="max-h-96 w-full bg-white object-contain"
              />
            </div>
          ) : (
            <label className="flex h-56 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-brand hover:text-brand">
              <span className="text-2xl">+</span>
              <span>Subir foto o diagrama del activo</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) subirImagen(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {imagen && (
            <label className="inline-block cursor-pointer text-xs text-brand hover:underline">
              Cambiar imagen
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) subirImagen(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}

          <div className="flex justify-between border-t border-slate-200 pt-4">
            <button
              onClick={() => setPaso(1)}
              className="rounded-lg border border-slate-300 px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Paso 1
            </button>
            <button
              onClick={irAPaso3}
              disabled={!imagen}
              className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Continuar → Paso 3
            </button>
          </div>
        </>
      )}

      {/* ================= PASO 3 ================= */}
      {paso === 3 && (
        <>
          <p className="text-sm text-slate-600">
            Haz clic en un sensor de la lista y luego clic sobre la imagen en
            el punto donde está instalado. Repite para cada sensor. Puedes
            hacer clic en un sensor ya ubicado para reposicionarlo, o quitarlo
            con la ✕.
          </p>

          {estadoSensores === "cargando" && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
              Cargando sensores de {activoSel?.code}…
            </div>
          )}
          {estadoSensores === "error" && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <span>{errorSensores}</span>
              <button
                onClick={irAPaso3}
                className="shrink-0 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
              >
                Reintentar
              </button>
            </div>
          )}
          {estadoSensores === "ok" && grupos.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              El activo no tiene sensores asociados.
            </div>
          )}

          {estadoSensores === "ok" && grupos.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
              {/* Imagen con marcadores */}
              <div
                onClick={manejarClicImagen}
                className={`relative overflow-hidden rounded-xl border-2 bg-white ${
                  sensorArmado
                    ? "cursor-crosshair border-brand"
                    : "border-slate-300"
                }`}
              >
                {imagen && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imagen}
                    alt="Diagrama del activo"
                    className="pointer-events-none block w-full select-none"
                  />
                )}
                {colocados.map((g) => (
                  <button
                    key={g.code}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSensorArmado(g.code);
                    }}
                    style={{
                      left: `${posiciones[g.code].x}%`,
                      top: `${posiciones[g.code].y}%`,
                    }}
                    className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-lg ${
                      sensorArmado === g.code
                        ? "h-8 w-8 bg-amber-500"
                        : "h-7 w-7 bg-brand"
                    }`}
                    title={`${g.code} · ${g.description}`}
                  >
                    {g.code.slice(0, 2)}
                  </button>
                ))}
              </div>

              {/* Panel de sensores */}
              <div className="space-y-4">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">
                    Pendientes ({pendientes.length})
                  </h3>
                  {pendientes.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      Todos los sensores están ubicados.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {pendientes.map((g) => (
                        <li key={g.code}>
                          <button
                            onClick={() => setSensorArmado(g.code)}
                            className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                              sensorArmado === g.code
                                ? "border-brand bg-brand/10 text-brand"
                                : "border-slate-200 bg-white hover:border-brand hover:bg-brand/5"
                            }`}
                          >
                            <span className="font-medium">{g.code}</span>{" "}
                            <span className="text-xs text-slate-500">
                              {g.description}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {colocados.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-slate-700">
                      Ubicados ({colocados.length})
                    </h3>
                    <ul className="space-y-1.5">
                      {colocados.map((g) => (
                        <li
                          key={g.code}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                          <span>
                            <span className="font-medium">{g.code}</span>{" "}
                            <span className="text-xs text-slate-500">
                              {g.description}
                            </span>
                          </span>
                          <button
                            onClick={() => quitarPosicion(g.code)}
                            className="shrink-0 text-red-500 hover:text-red-700"
                            title="Quitar posición"
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {sensorArmado && (
                  <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                    Haz clic sobre la imagen para ubicar{" "}
                    <strong>{sensorArmado}</strong>.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-between border-t border-slate-200 pt-4">
            <button
              onClick={() => setPaso(2)}
              className="rounded-lg border border-slate-300 px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Paso 2
            </button>
            <button
              onClick={guardar}
              disabled={guardando || colocados.length === 0}
              className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {guardando
                ? "Guardando…"
                : `Guardar (${colocados.length} sensor(es))`}
            </button>
          </div>
          {colocados.length === 0 && estadoSensores === "ok" && (
            <p className="text-xs text-slate-400">
              * Ubica al menos un sensor para poder guardar.
            </p>
          )}
        </>
      )}
    </div>
  );
}
