"use client";

// Vista en vivo de un "Activo monitoreado": imagen con marcadores + valores
// (velocidad H/V/A + temperatura) actualizados manualmente o cada 60s.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ActivoMonitoreadoDetalle } from "@/lib/db";
import type { Meter, SensorGroup } from "@/lib/fracttal";
import {
  esVelocidad,
  categoriaDeMedidor,
  mmsAIns,
  posicionDeMedidor,
  ordenarPorPosicion,
} from "@/lib/fracttal";

interface PromedioMedidor {
  avg: number;
  count: number;
  min: number;
  max: number;
  last: string;
}

type PromediosPorMedidor = Record<number, PromedioMedidor>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store" });
  const texto = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new Error("Fracttal tardó demasiado en responder (falla temporal)");
  }
  if (!res.ok || json.success === false) {
    throw new Error(json.message ?? `Error ${res.status}`);
  }
  return json;
}

const SEGUNDOS_AUTOREFRESH = 60;

export default function VistaActivoVivo({
  detalle,
}: {
  detalle: ActivoMonitoreadoDetalle;
}) {
  const [metaPorSensor, setMetaPorSensor] = useState<
    Record<string, SensorGroup>
  >({});
  const [promediosPorSensor, setPromediosPorSensor] = useState<
    Record<string, PromediosPorMedidor>
  >({});
  const [estado, setEstado] = useState<"cargando" | "ok" | "error">(
    "cargando"
  );
  const [error, setError] = useState("");
  const [ultimaActualizacion, setUltimaActualizacion] = useState<Date | null>(
    null
  );
  const [segundosRestantes, setSegundosRestantes] = useState(
    SEGUNDOS_AUTOREFRESH
  );
  const [sensorActivo, setSensorActivo] = useState<string | null>(null);

  const cargarValores = useCallback(async () => {
    setEstado((prev) => (prev === "ok" ? "ok" : "cargando"));
    setError("");
    try {
      const jsonSensores = await fetchJson(
        `/api/fracttal/sensors?code=${encodeURIComponent(detalle.activo_code)}`
      );
      const gruposTodos: SensorGroup[] = jsonSensores.data;
      const metaPorCodigo: Record<string, SensorGroup> = {};
      for (const g of gruposTodos) metaPorCodigo[g.code] = g;

      const entradas = await Promise.all(
        detalle.sensores.map(async (s) => {
          try {
            const j = await fetchJson(
              `/api/fracttal/averages?code=${encodeURIComponent(
                s.sensor_code
              )}&n=10`
            );
            return [s.sensor_code, j.data as PromediosPorMedidor] as const;
          } catch {
            return [s.sensor_code, {} as PromediosPorMedidor] as const;
          }
        })
      );

      setMetaPorSensor(metaPorCodigo);
      setPromediosPorSensor(Object.fromEntries(entradas));
      setEstado("ok");
      setUltimaActualizacion(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setEstado("error");
    }
  }, [detalle]);

  useEffect(() => {
    cargarValores();
  }, [cargarValores]);

  useEffect(() => {
    const id = setInterval(() => {
      setSegundosRestantes((s) => {
        if (s <= 1) {
          cargarValores();
          return SEGUNDOS_AUTOREFRESH;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [cargarValores]);

  function actualizarAhora() {
    cargarValores();
    setSegundosRestantes(SEGUNDOS_AUTOREFRESH);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/activos" className="text-sm text-brand hover:underline">
            ← Activos monitoreados
          </Link>
          <h2 className="text-xl font-semibold">
            {detalle.activo_nombre ?? detalle.activo_code}
          </h2>
          <p className="text-xs text-slate-500">
            {detalle.activo_code} · {detalle.sensores.length} sensor(es)
          </p>
        </div>
        <div className="flex items-center gap-3">
          {ultimaActualizacion && (
            <span className="text-xs text-slate-400">
              Última actualización:{" "}
              {ultimaActualizacion.toLocaleTimeString("es-MX")}
            </span>
          )}
          <button
            onClick={actualizarAhora}
            disabled={estado === "cargando"}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {estado === "cargando"
              ? "Actualizando…"
              : `Actualizar ahora (${segundosRestantes}s)`}
          </button>
        </div>
      </div>

      {estado === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        {/* Imagen con marcadores */}
        <div className="relative overflow-hidden rounded-xl border-2 border-slate-300 bg-white">
          {detalle.imagen_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={detalle.imagen_url}
              alt={detalle.activo_nombre ?? detalle.activo_code}
              className="block w-full select-none"
            />
          )}
          {detalle.sensores.map((s) => (
            <button
              key={s.id}
              onClick={() =>
                setSensorActivo((prev) =>
                  prev === s.sensor_code ? null : s.sensor_code
                )
              }
              style={{ left: `${s.pos_x}%`, top: `${s.pos_y}%` }}
              className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-lg transition ${
                sensorActivo === s.sensor_code
                  ? "h-9 w-9 bg-amber-500"
                  : "h-7 w-7 bg-brand hover:bg-brand/80"
              }`}
              title={`${s.sensor_code} · ${s.sensor_label ?? ""}`}
            >
              {s.sensor_code.slice(0, 2)}
            </button>
          ))}
        </div>

        {/* Tarjetas de valores por sensor */}
        <div className="space-y-3">
          {detalle.sensores.map((s) => {
            const grupo = metaPorSensor[s.sensor_code];
            const promedios = promediosPorSensor[s.sensor_code] ?? {};
            return (
              <SensorCard
                key={s.id}
                codigo={s.sensor_code}
                etiqueta={s.sensor_label ?? grupo?.description ?? ""}
                grupo={grupo}
                promedios={promedios}
                cargando={estado === "cargando" && !grupo}
                activo={sensorActivo === s.sensor_code}
                onClick={() =>
                  setSensorActivo((prev) =>
                    prev === s.sensor_code ? null : s.sensor_code
                  )
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SensorCard({
  codigo,
  etiqueta,
  grupo,
  promedios,
  cargando,
  activo,
  onClick,
}: {
  codigo: string;
  etiqueta: string;
  grupo: SensorGroup | undefined;
  promedios: PromediosPorMedidor;
  cargando: boolean;
  activo: boolean;
  onClick: () => void;
}) {
  const meters: Meter[] = grupo?.meters ?? [];
  const velocidades = ordenarPorPosicion(meters.filter(esVelocidad));
  const temperatura = meters.find((m) => categoriaDeMedidor(m) === "temp");

  function valorMostrado(m: Meter): string {
    const prom = promedios[m.id];
    if (!prom) return "—";
    return esVelocidad(m)
      ? `${mmsAIns(prom.avg)} in/s`
      : `${prom.avg} ${m.units_code}`;
  }

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border bg-white p-4 text-left transition ${
        activo ? "border-brand ring-2 ring-brand/30" : "border-slate-200"
      }`}
    >
      <p className="text-sm font-semibold text-slate-800">
        {codigo}
        {etiqueta && (
          <span className="ml-2 font-normal text-slate-500">{etiqueta}</span>
        )}
      </p>

      {cargando ? (
        <p className="mt-2 text-xs text-slate-400">Cargando…</p>
      ) : !grupo ? (
        <p className="mt-2 text-xs text-slate-400">
          Sin datos de Fracttal para este sensor.
        </p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          {velocidades.length === 0 && (
            <p className="col-span-2 text-slate-400">Sin medidores de velocidad.</p>
          )}
          {velocidades.map((m) => (
            <div key={m.id} className="rounded-lg bg-slate-50 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">
                {posicionDeMedidor(m)}
              </p>
              <p className="font-semibold text-slate-700">{valorMostrado(m)}</p>
            </div>
          ))}
          <div className="rounded-lg bg-slate-50 px-2 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
              Temperatura
            </p>
            <p className="font-semibold text-slate-700">
              {temperatura ? valorMostrado(temperatura) : "—"}
            </p>
          </div>
        </div>
      )}
    </button>
  );
}
