"use client";

// Grid de activos monitoreados (Activos > Home) con opción de eliminar y
// semáforo global por activo (criterio ISO peor caso, solo vibración H/V/A).
// El semáforo se pide a /api/activos/semaforos (una sola llamada para todas
// las cartillas) al cargar y luego cada 60 segundos.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ActivoMonitoreadoResumen } from "@/lib/db";
import type { NivelSeveridad } from "@/lib/fracttal";
import { limpiarNombre } from "@/lib/nombres";

interface EjeEnRojo {
  eje: string;
  valor: number;
}

interface SensorEnRojo {
  code: string;
  label: string;
  ejes: EjeEnRojo[];
}

interface SemaforoActivo {
  nivel: NivelSeveridad | null;
  sensoresEvaluados: number;
  sensoresConDato: number;
  porNivel: Record<NivelSeveridad, number>;
  sensoresEnRojo: SensorEnRojo[];
}

const SEGUNDOS_AUTOREFRESH = 60;

// Orden fijo de los ejes dentro de un chip, para que dos cartillas siempre se
// lean igual (Fracttal puede devolver los medidores en cualquier orden).
const ORDEN_EJE = ["H", "V", "A"];

function ordenarEjes(ejes: EjeEnRojo[]): EjeEnRojo[] {
  const peso = (eje: string) => {
    const i = ORDEN_EJE.indexOf(eje.toUpperCase());
    return i === -1 ? ORDEN_EJE.length : i;
  };
  return [...ejes].sort((a, b) => peso(a.eje) - peso(b.eje));
}

// Mismos colores de severidad que la vista en vivo.
const PASTILLA: Record<NivelSeveridad, { clase: string; punto: string; texto: string }> = {
  normal: { clase: "bg-[#C0DD97] text-[#173404]", punto: "#3B6D11", texto: "NORMAL" },
  alerta: { clase: "bg-[#FAC775] text-[#412402]", punto: "#854F0B", texto: "ALERTA" },
  critico: { clase: "bg-[#F09595] text-[#501313]", punto: "#A32D2D", texto: "CRÍTICO" },
};

function PastillaSemaforo({
  semaforo,
  cargando,
}: {
  semaforo: SemaforoActivo | undefined;
  cargando: boolean;
}) {
  if (!semaforo && cargando) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-400">
        <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
        …
      </span>
    );
  }
  if (!semaforo || semaforo.nivel === null) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500">
        <span className="h-2 w-2 rounded-full bg-slate-500" />
        SIN DATOS
      </span>
    );
  }
  const p = PASTILLA[semaforo.nivel];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${p.clase}`}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: p.punto }}
      />
      {p.texto}
    </span>
  );
}

export default function ListaActivos({
  activosIniciales,
}: {
  activosIniciales: ActivoMonitoreadoResumen[];
}) {
  const [activos, setActivos] = useState(activosIniciales);
  const [eliminandoCode, setEliminandoCode] = useState<string | null>(null);
  const [semaforos, setSemaforos] = useState<Record<string, SemaforoActivo>>(
    {}
  );
  const [cargandoSemaforos, setCargandoSemaforos] = useState(true);
  const [ultimaActualizacion, setUltimaActualizacion] = useState<Date | null>(
    null
  );
  // Tick de 1s solo para refrescar el "hace Xs" de las leyendas.
  const [, setTick] = useState(0);

  const cargarSemaforos = useCallback(async () => {
    setCargandoSemaforos(true);
    try {
      const res = await fetch("/api/activos/semaforos", { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setSemaforos(json.data as Record<string, SemaforoActivo>);
        setUltimaActualizacion(new Date());
      }
    } catch {
      // Silencioso: la cartilla mantiene el último estado conocido y el
      // siguiente ciclo de 60s vuelve a intentar.
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

  async function eliminar(code: string) {
    if (
      !confirm(
        "¿Eliminar la configuración de este activo? Se perderán la imagen y las posiciones de los sensores."
      )
    ) {
      return;
    }
    setEliminandoCode(code);
    try {
      const res = await fetch(`/api/activos/${encodeURIComponent(code)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Error desconocido");
      setActivos((prev) => prev.filter((a) => a.activo_code !== code));
    } catch (err) {
      alert(
        "No se pudo eliminar: " +
          (err instanceof Error ? err.message : "error desconocido")
      );
    } finally {
      setEliminandoCode(null);
    }
  }

  if (activos.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Todavía no hay activos configurados.
      </p>
    );
  }

  const haceSegundos = ultimaActualizacion
    ? Math.max(0, Math.round((Date.now() - ultimaActualizacion.getTime()) / 1000))
    : null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {activos.map((a) => {
        const semaforo = semaforos[a.activo_code];
        return (
          <div
            key={a.activo_code}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white"
          >
            <Link href={`/activos/${encodeURIComponent(a.activo_code)}`}>
              {a.imagen_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.imagen_url}
                  alt={limpiarNombre(a.activo_nombre) || a.activo_code}
                  className="h-40 w-full bg-slate-100 object-cover"
                />
              ) : (
                <div className="flex h-40 items-center justify-center bg-slate-100 text-xs text-slate-400">
                  Sin imagen
                </div>
              )}
            </Link>
            <div className="p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {limpiarNombre(a.activo_nombre) || a.activo_code}
                  </p>
                  <p className="text-xs text-slate-500">
                    {a.activo_code} · {a.num_sensores} sensor(es)
                  </p>
                </div>
                <PastillaSemaforo
                  semaforo={semaforo}
                  cargando={cargandoSemaforos}
                />
              </div>
              {semaforo && (semaforo.sensoresEnRojo?.length ?? 0) > 0 && (
                <div className="mt-2 rounded-lg border border-[#F7C1C1] bg-[#FCEBEB] p-2">
                  <p className="text-xs font-medium text-[#791F1F]">
                    ⚠ {semaforo.sensoresEnRojo.length} sensor(es) en rojo
                  </p>
                  {/* Un chip por SENSOR con sus ejes en rojo dentro: las 3
                      medidas H/V/A pertenecen al mismo punto físico, así que
                      no deben verse como sensores distintos. */}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {semaforo.sensoresEnRojo.map((s) => (
                      <span
                        key={s.code}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#F09595] px-2 py-0.5 text-[11px] text-[#501313]"
                      >
                        <span className="font-semibold">
                          {limpiarNombre(s.label) || s.code}
                        </span>
                        <span>
                          {ordenarEjes(s.ejes)
                            .map((e) => `${e.eje} ${e.valor}`)
                            .join(" · ")}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {semaforo && semaforo.sensoresEvaluados > 0 && (
                <p className="mt-2 text-[11px] text-slate-400">
                  Semáforo: {semaforo.sensoresConDato}/{semaforo.sensoresEvaluados}{" "}
                  sensor(es) de vibración
                  {haceSegundos !== null && <> · hace {haceSegundos} s</>}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between">
                <Link
                  href={`/activos/${encodeURIComponent(a.activo_code)}`}
                  className="text-sm text-brand hover:underline"
                >
                  Ver en vivo →
                </Link>
                <button
                  onClick={() => eliminar(a.activo_code)}
                  disabled={eliminandoCode === a.activo_code}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  {eliminandoCode === a.activo_code ? "Eliminando…" : "Eliminar"}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
