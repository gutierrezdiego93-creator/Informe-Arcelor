"use client";

// Vista en vivo de un "Activo monitoreado": imagen con indicadores tipo
// SCADA/PLC pegados a cada punto (velocidad H/V/A + temperatura), siempre
// visibles. Se actualiza manualmente o cada 60s.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ActivoMonitoreadoDetalle, SensorPosicionado } from "@/lib/db";
import type { Meter, SensorGroup } from "@/lib/fracttal";
import {
  esVelocidad,
  categoriaDeMedidor,
  mmsAIns,
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

      {/* Imagen con indicadores tipo SCADA. self-start evita que la imagen
          se estire; sin overflow-hidden para que los recuadros de valores
          puedan salirse del marco cuando el punto está cerca de un borde. */}
      <div className="relative w-full self-start rounded-xl border-2 border-slate-300 bg-white">
        {detalle.imagen_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={detalle.imagen_url}
            alt={detalle.activo_nombre ?? detalle.activo_code}
            className="block w-full select-none rounded-xl"
          />
        )}
        {detalle.sensores.map((s) => (
          <IndicadorSensor
            key={s.id}
            sensor={s}
            grupo={metaPorSensor[s.sensor_code]}
            promedios={promediosPorSensor[s.sensor_code] ?? {}}
            cargando={estado === "cargando" && !metaPorSensor[s.sensor_code]}
          />
        ))}
      </div>
    </div>
  );
}

function IndicadorSensor({
  sensor,
  grupo,
  promedios,
  cargando,
}: {
  sensor: SensorPosicionado;
  grupo: SensorGroup | undefined;
  promedios: PromediosPorMedidor;
  cargando: boolean;
}) {
  const meters: Meter[] = grupo?.meters ?? [];
  const velocidades = ordenarPorPosicion(meters.filter(esVelocidad)).slice(
    0,
    3
  );
  const temperatura = meters.find((m) => categoriaDeMedidor(m) === "temp");

  function valor(m: Meter | undefined): string {
    if (!m) return "—";
    const prom = promedios[m.id];
    if (!prom) return "—";
    return esVelocidad(m) ? mmsAIns(prom.avg) : String(prom.avg);
  }

  // Ancla el recuadro hacia el lado contrario del borde más cercano para
  // que se salga lo menos posible de la imagen.
  const haciaIzquierda = sensor.pos_x > 65;
  const haciaArriba = sensor.pos_y > 75;

  return (
    <>
      {/* Punto exacto */}
      <div
        style={{ left: `${sensor.pos_x}%`, top: `${sensor.pos_y}%` }}
        className="absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand shadow"
      />
      {/* Recuadro de indicadores, siempre visible */}
      <div
        style={{
          left: `${sensor.pos_x}%`,
          top: `${sensor.pos_y}%`,
          transform: `translate(${
            haciaIzquierda ? "calc(-100% - 10px)" : "10px"
          }, ${haciaArriba ? "calc(-100% - 6px)" : "6px"})`,
        }}
        className="absolute z-20 w-max rounded-md bg-slate-900/90 px-2 py-1 text-[10px] leading-tight text-white shadow-lg"
      >
        <p className="mb-0.5 font-semibold text-slate-200">
          {sensor.sensor_code}
        </p>
        {cargando ? (
          <p className="text-slate-400">Cargando…</p>
        ) : !grupo ? (
          <p className="text-slate-400">Sin datos</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            <span>
              <span className="text-slate-400">H</span> {valor(velocidades[0])}
            </span>
            <span>
              <span className="text-slate-400">V</span> {valor(velocidades[1])}
            </span>
            <span>
              <span className="text-slate-400">A</span> {valor(velocidades[2])}
            </span>
            <span>
              <span className="text-slate-400">T</span> {valor(temperatura)}°
            </span>
          </div>
        )}
      </div>
    </>
  );
}
