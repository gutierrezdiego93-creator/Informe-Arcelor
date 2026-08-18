"use client";

// Mapa de planta: una vista de semáforos, sin valores numéricos.
//
// Cada posición del mapa muestra el mismo plano de vista superior con un punto
// de color por sensor. El color (global y por punto) sale de
// /api/mapa/semaforos, que usa exactamente el mismo cálculo ISO que las
// cartillas de "Activos monitoreados".
//
// Modo editar: se elige la posición → se elige el ACTIVO de Fracttal (el
// nombre mostrado es el de Fracttal, no uno escrito a mano) → se despliegan
// ÚNICAMENTE los sensores asociados a ese activo (misma llamada acotada por
// code que usa el wizard) → clic en el sensor y clic en el plano.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SlotMapa } from "@/lib/db";
import type { Asset, SensorGroup, NivelSeveridad } from "@/lib/fracttal";
import type { SemaforoActivo } from "@/lib/semaforo";

const PLANO = "/molino-vista-superior.jpg";
const SEGUNDOS_AUTOREFRESH = 60;

const COLOR_PUNTO: Record<NivelSeveridad, string> = {
  normal: "#3B6D11",
  alerta: "#EF9F27",
  critico: "#E24B4A",
};

const PASTILLA: Record<NivelSeveridad, { clase: string; punto: string; texto: string }> = {
  normal: { clase: "bg-[#C0DD97] text-[#173404]", punto: "#3B6D11", texto: "NORMAL" },
  alerta: { clase: "bg-[#FAC775] text-[#412402]", punto: "#854F0B", texto: "ALERTA" },
  critico: { clase: "bg-[#F09595] text-[#501313]", punto: "#A32D2D", texto: "CRÍTICO" },
};

interface PuntoEdicion {
  sensorCode: string;
  sensorLabel: string;
  x: number;
  y: number;
}

function Pastilla({
  semaforo,
  cargando,
}: {
  semaforo: SemaforoActivo | undefined;
  cargando: boolean;
}) {
  if (!semaforo && cargando) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-400">
        <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />…
      </span>
    );
  }
  if (!semaforo || semaforo.nivel === null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500">
        <span className="h-2 w-2 rounded-full bg-slate-500" />
        SIN DATOS
      </span>
    );
  }
  const p = PASTILLA[semaforo.nivel];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${p.clase}`}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.punto }} />
      {p.texto}
    </span>
  );
}

export default function MapaMolinos({
  slotsIniciales,
}: {
  slotsIniciales: SlotMapa[];
}) {
  const [slots, setSlots] = useState(slotsIniciales);
  const [semaforos, setSemaforos] = useState<Record<string, SemaforoActivo>>({});
  const [cargandoSemaforos, setCargandoSemaforos] = useState(true);
  const [ultimaActualizacion, setUltimaActualizacion] = useState<Date | null>(null);
  const [, setTick] = useState(0);

  // --- Modo edición ---
  const [editando, setEditando] = useState(false);
  const [slotSel, setSlotSel] = useState<number | null>(null);
  const [activoSel, setActivoSel] = useState<{ code: string; nombre: string } | null>(null);
  const [puntos, setPuntos] = useState<PuntoEdicion[]>([]);
  const [sensorArmado, setSensorArmado] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Catálogo de activos (se pide una sola vez, al entrar a editar)
  const [activos, setActivos] = useState<Asset[]>([]);
  const [cargandoActivos, setCargandoActivos] = useState(false);
  const [errorActivos, setErrorActivos] = useState("");
  const [filtro, setFiltro] = useState("");
  const [eligiendoActivo, setEligiendoActivo] = useState(false);

  // Sensores del activo elegido (SOLO de ese activo)
  const [grupos, setGrupos] = useState<SensorGroup[]>([]);
  const [cargandoSensores, setCargandoSensores] = useState(false);
  const [errorSensores, setErrorSensores] = useState("");

  const panelRef = useRef<HTMLDivElement | null>(null);

  const cargarSemaforos = useCallback(async () => {
    setCargandoSemaforos(true);
    try {
      const res = await fetch("/api/mapa/semaforos", { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setSemaforos(json.data as Record<string, SemaforoActivo>);
        setUltimaActualizacion(new Date());
      }
    } catch {
      // Silencioso: se conserva el último estado y se reintenta en 60 s.
    } finally {
      setCargandoSemaforos(false);
    }
  }, []);

  useEffect(() => {
    cargarSemaforos();
    const idRefresh = setInterval(cargarSemaforos, SEGUNDOS_AUTOREFRESH * 1000);
    const idTick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(idRefresh);
      clearInterval(idTick);
    };
  }, [cargarSemaforos]);

  const cargarActivos = useCallback(async () => {
    setCargandoActivos(true);
    setErrorActivos("");
    try {
      const res = await fetch("/api/fracttal/assets", { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Error desconocido");
      setActivos(json.data as Asset[]);
    } catch (err) {
      setErrorActivos(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setCargandoActivos(false);
    }
  }, []);

  const cargarSensores = useCallback(async (code: string) => {
    setCargandoSensores(true);
    setErrorSensores("");
    setGrupos([]);
    try {
      const res = await fetch(
        `/api/fracttal/sensors?code=${encodeURIComponent(code)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Error desconocido");
      setGrupos(json.data as SensorGroup[]);
    } catch (err) {
      setErrorSensores(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setCargandoSensores(false);
    }
  }, []);

  function entrarAEditar() {
    setEditando(true);
    setSlotSel(null);
    setActivoSel(null);
    setPuntos([]);
    setGrupos([]);
    setSensorArmado(null);
    if (activos.length === 0) cargarActivos();
  }

  function salirDeEditar() {
    setEditando(false);
    setSlotSel(null);
    setActivoSel(null);
    setPuntos([]);
    setGrupos([]);
    setSensorArmado(null);
    setEligiendoActivo(false);
  }

  function elegirSlot(slot: number) {
    const s = slots.find((x) => x.slot === slot);
    setSlotSel(slot);
    setSensorArmado(null);
    if (s?.activo_code) {
      setActivoSel({ code: s.activo_code, nombre: s.activo_nombre ?? s.activo_code });
      setPuntos(
        s.sensores.map((x) => ({
          sensorCode: x.sensor_code,
          sensorLabel: x.sensor_label ?? x.sensor_code,
          x: x.pos_x,
          y: x.pos_y,
        }))
      );
      setEligiendoActivo(false);
      cargarSensores(s.activo_code);
    } else {
      setActivoSel(null);
      setPuntos([]);
      setGrupos([]);
      setEligiendoActivo(true);
    }
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function elegirActivo(a: Asset) {
    const nombre = a.field_1 ?? a.description;
    setActivoSel({ code: a.code, nombre });
    setPuntos([]);
    setSensorArmado(null);
    setEligiendoActivo(false);
    setFiltro("");
    cargarSensores(a.code);
  }

  function clicEnPlano(e: React.MouseEvent<HTMLDivElement>, slot: number) {
    if (!editando || slot !== slotSel || !sensorArmado) return;
    const grupo = grupos.find((g) => g.code === sensorArmado);
    if (!grupo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Number((((e.clientX - rect.left) / rect.width) * 100).toFixed(2));
    const y = Number((((e.clientY - rect.top) / rect.height) * 100).toFixed(2));
    setPuntos((prev) => [
      ...prev.filter((p) => p.sensorCode !== sensorArmado),
      { sensorCode: grupo.code, sensorLabel: grupo.description, x, y },
    ]);
    setSensorArmado(null);
  }

  function quitarPunto(sensorCode: string) {
    setPuntos((prev) => prev.filter((p) => p.sensorCode !== sensorCode));
    if (sensorArmado === sensorCode) setSensorArmado(null);
  }

  /** Copia las posiciones de otro slot (el plano es el mismo para los cuatro).
   *  Solo se aplican a los sensores que EXISTEN en el activo actual, así que
   *  sirve como plantilla aunque los codes no coincidan del todo. */
  function copiarPosicionesDe(slotOrigen: number) {
    const origen = slots.find((s) => s.slot === slotOrigen);
    if (!origen || grupos.length === 0) return;
    const porOrden = [...origen.sensores].sort((a, b) => a.id - b.id);
    const nuevos: PuntoEdicion[] = [];
    porOrden.forEach((s, i) => {
      const destino =
        grupos.find((g) => g.code === s.sensor_code) ?? grupos[i] ?? null;
      if (!destino) return;
      if (nuevos.some((p) => p.sensorCode === destino.code)) return;
      nuevos.push({
        sensorCode: destino.code,
        sensorLabel: destino.description,
        x: s.pos_x,
        y: s.pos_y,
      });
    });
    setPuntos(nuevos);
  }

  async function guardar() {
    if (slotSel === null || !activoSel) return;
    setGuardando(true);
    try {
      const res = await fetch("/api/mapa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot: slotSel,
          activoCode: activoSel.code,
          activoNombre: activoSel.nombre,
          sensores: puntos.map((p) => ({
            sensorCode: p.sensorCode,
            sensorLabel: p.sensorLabel,
            x: p.x,
            y: p.y,
          })),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Error desconocido");
      setSlots(json.data as SlotMapa[]);
      salirDeEditar();
      cargarSemaforos();
    } catch (err) {
      alert(
        "No se pudo guardar: " +
          (err instanceof Error ? err.message : "error desconocido")
      );
    } finally {
      setGuardando(false);
    }
  }

  async function vaciarSlot() {
    if (slotSel === null) return;
    if (!confirm("¿Quitar el activo de esta posición del mapa y sus puntos?")) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/mapa?slot=${slotSel}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Error desconocido");
      setSlots(json.data as SlotMapa[]);
      salirDeEditar();
      cargarSemaforos();
    } catch (err) {
      alert(
        "No se pudo quitar: " +
          (err instanceof Error ? err.message : "error desconocido")
      );
    } finally {
      setGuardando(false);
    }
  }

  const activosFiltrados = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return activos.slice(0, 60);
    return activos
      .filter(
        (a) =>
          a.code.toLowerCase().includes(q) ||
          (a.field_1 ?? a.description).toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [activos, filtro]);

  const colocados = useMemo(
    () => new Set(puntos.map((p) => p.sensorCode)),
    [puntos]
  );

  const slotsConPosiciones = slots.filter(
    (s) => s.sensores.length > 0 && s.slot !== slotSel
  );

  const haceSegundos = ultimaActualizacion
    ? Math.max(0, Math.round((Date.now() - ultimaActualizacion.getTime()) / 1000))
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLOR_PUNTO.normal }} />
            Normal
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLOR_PUNTO.alerta }} />
            Alerta
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLOR_PUNTO.critico }} />
            Crítico
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
            Sin datos
          </span>
          {haceSegundos !== null && !editando && (
            <span className="text-slate-400">· actualizado hace {haceSegundos} s</span>
          )}
        </div>
        {editando ? (
          <div className="flex items-center gap-2">
            <button
              onClick={salirDeEditar}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={guardando || slotSel === null || !activoSel}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar posición"}
            </button>
          </div>
        ) : (
          <button
            onClick={entrarAEditar}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Editar posiciones
          </button>
        )}
      </div>

      {editando && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Elige una posición del mapa, asígnale un activo de Fracttal y coloca
          sus sensores: clic en el sensor de la lista y luego clic sobre el
          plano. Se guarda una posición a la vez.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {slots.map((s) => {
          const semaforo = semaforos[String(s.slot)];
          const nivelPorSensor = new Map(
            (semaforo?.sensores ?? []).map((x) => [x.code, x.nivel])
          );
          const enEdicion = editando && slotSel === s.slot;
          const puntosAMostrar = enEdicion
            ? puntos.map((p) => ({
                code: p.sensorCode,
                label: p.sensorLabel,
                x: p.x,
                y: p.y,
              }))
            : s.sensores.map((x) => ({
                code: x.sensor_code,
                label: x.sensor_label ?? x.sensor_code,
                x: x.pos_x,
                y: x.pos_y,
              }));
          const sinActivo = enEdicion ? !activoSel : !s.activo_code;
          const nombre = enEdicion
            ? activoSel?.nombre ?? "Sin activo asignado"
            : s.activo_nombre ?? "Sin activo asignado";

          return (
            <div
              key={s.slot}
              className={`overflow-hidden rounded-xl border bg-white transition ${
                enEdicion ? "border-brand ring-2 ring-brand/20" : "border-slate-200"
              }`}
            >
              <div className="flex items-start justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p
                    className={`truncate text-sm font-medium ${
                      sinActivo ? "text-slate-400" : "text-slate-800"
                    }`}
                    title={nombre}
                  >
                    {nombre}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {enEdicion
                      ? activoSel?.code ?? `Posición ${s.slot}`
                      : s.activo_code ?? `Posición ${s.slot}`}
                  </p>
                </div>
                {sinActivo ? (
                  <span className="shrink-0 rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                    SIN INFORMACIÓN
                  </span>
                ) : (
                  <Pastilla semaforo={semaforo} cargando={cargandoSemaforos} />
                )}
              </div>

              <div
                onClick={(e) => clicEnPlano(e, s.slot)}
                className={`relative border-t border-slate-100 bg-white ${
                  enEdicion && sensorArmado ? "cursor-crosshair" : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={PLANO}
                  alt={`Vista superior · ${nombre}`}
                  className={`pointer-events-none block w-full select-none ${
                    sinActivo ? "opacity-30" : ""
                  }`}
                />
                {puntosAMostrar.map((p) => {
                  const nivel = enEdicion ? null : nivelPorSensor.get(p.code) ?? null;
                  const color = nivel ? COLOR_PUNTO[nivel] : "#94a3b8";
                  return (
                    <button
                      key={p.code}
                      type="button"
                      title={p.label}
                      onClick={(e) => {
                        if (!enEdicion) return;
                        e.stopPropagation();
                        setSensorArmado(p.code);
                      }}
                      style={{ left: `${p.x}%`, top: `${p.y}%` }}
                      className="group absolute -translate-x-1/2 -translate-y-1/2"
                    >
                      <span
                        className={`block rounded-full border-2 border-white shadow ${
                          enEdicion && sensorArmado === p.code
                            ? "h-4 w-4 ring-2 ring-brand"
                            : "h-3 w-3"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                      <span
                        className={`pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-slate-900/90 px-1.5 py-0.5 text-[10px] font-medium text-white ${
                          enEdicion ? "" : "hidden group-hover:block"
                        }`}
                      >
                        {p.label}
                      </span>
                    </button>
                  );
                })}
                {!sinActivo && puntosAMostrar.length === 0 && (
                  <span className="absolute inset-x-0 top-1/2 text-center text-[11px] text-slate-400">
                    Sin puntos ubicados
                  </span>
                )}
              </div>

              {editando && (
                <div className="border-t border-slate-100 p-2">
                  <button
                    onClick={() => elegirSlot(s.slot)}
                    className={`w-full rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      enEdicion
                        ? "bg-brand text-white"
                        : "border border-slate-300 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {enEdicion ? "Editando esta posición" : "Editar esta posición"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ---------- Panel de edición ---------- */}
      {editando && slotSel !== null && (
        <div
          ref={panelRef}
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-700">
              Posición {slotSel} de {slots.length}
            </h3>
            <button
              onClick={vaciarSlot}
              disabled={guardando}
              className="text-xs text-red-600 hover:underline disabled:opacity-50"
            >
              Vaciar posición
            </button>
          </div>

          {/* Activo elegido */}
          <div className="mt-3">
            {activoSel && !eligiendoActivo ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {activoSel.nombre}
                  </p>
                  <p className="text-xs text-slate-500">
                    {activoSel.code} · nombre tal como está en Fracttal
                  </p>
                </div>
                <button
                  onClick={() => {
                    setEligiendoActivo(true);
                    if (activos.length === 0) cargarActivos();
                  }}
                  className="shrink-0 text-xs text-brand hover:underline"
                >
                  Cambiar activo
                </button>
              </div>
            ) : (
              <div>
                <input
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value)}
                  placeholder={
                    cargandoActivos
                      ? "Cargando catálogo de Fracttal…"
                      : `Buscar entre ${activos.length} activo(s)…`
                  }
                  className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-brand focus:outline-none"
                />
                {errorActivos && (
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    <span>{errorActivos}</span>
                    <button
                      onClick={cargarActivos}
                      className="shrink-0 rounded-lg bg-brand px-3 py-1.5 font-semibold text-white"
                    >
                      Reintentar
                    </button>
                  </div>
                )}
                <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                  {activosFiltrados.length === 0 && !cargandoActivos && (
                    <li className="p-3 text-xs text-slate-500">Sin resultados.</li>
                  )}
                  {activosFiltrados.map((a) => (
                    <li key={a.id}>
                      <button
                        onClick={() => elegirActivo(a)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <span className="font-medium">
                          {a.field_1 ?? a.description}
                        </span>
                        <span className="ml-2 text-xs text-slate-500">{a.code}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Sensores del activo elegido */}
          {activoSel && !eligiendoActivo && (
            <div className="mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-600">
                  Sensores asociados a {activoSel.code} en Fracttal
                  {grupos.length > 0 && <> · {grupos.length}</>}
                </p>
                {slotsConPosiciones.length > 0 && grupos.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span>Copiar posiciones de:</span>
                    {slotsConPosiciones.map((o) => (
                      <button
                        key={o.slot}
                        onClick={() => copiarPosicionesDe(o.slot)}
                        className="rounded-full border border-slate-300 px-2 py-0.5 text-[11px] hover:bg-slate-50"
                      >
                        {o.activo_nombre ?? `Posición ${o.slot}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {cargandoSensores && (
                <p className="mt-2 text-xs text-slate-500">Cargando sensores…</p>
              )}
              {errorSensores && (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  <span>{errorSensores}</span>
                  <button
                    onClick={() => cargarSensores(activoSel.code)}
                    className="shrink-0 rounded-lg bg-brand px-3 py-1.5 font-semibold text-white"
                  >
                    Reintentar
                  </button>
                </div>
              )}
              {!cargandoSensores && !errorSensores && grupos.length === 0 && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  El activo no tiene sensores asociados en Fracttal.
                </p>
              )}

              {grupos.length > 0 && (
                <>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {grupos.map((g) => {
                      const ya = colocados.has(g.code);
                      const armado = sensorArmado === g.code;
                      return (
                        <span key={g.code} className="inline-flex items-center">
                          <button
                            onClick={() => setSensorArmado(armado ? null : g.code)}
                            title={g.description}
                            className={`rounded-l-lg border px-2.5 py-1 text-xs transition ${
                              armado
                                ? "border-brand bg-brand text-white"
                                : ya
                                  ? "border-slate-200 bg-slate-100 text-slate-500"
                                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            } ${ya ? "" : "rounded-r-lg"}`}
                          >
                            {g.description || g.code}
                            {armado && " · clic en el plano"}
                          </button>
                          {ya && (
                            <button
                              onClick={() => quitarPunto(g.code)}
                              title="Quitar del plano"
                              className="rounded-r-lg border border-l-0 border-slate-200 bg-slate-100 px-1.5 py-1 text-xs text-red-500 hover:text-red-700"
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">
                    {puntos.length} ubicado(s) · {grupos.length - puntos.length}{" "}
                    pendiente(s). Solo aparecen los sensores de este activo.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
