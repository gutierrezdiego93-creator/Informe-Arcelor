"use client";

// Vista en vivo de un "Activo monitoreado": imagen con indicadores tipo
// SCADA/PLC pegados a cada punto (velocidad H/V/A + temperatura), siempre
// visibles. Se actualiza manualmente o cada 60s. Las etiquetas se pueden
// arrastrar (modo "Organizar etiquetas") para separarlas cuando se
// superponen; su posición se guarda en la base de datos.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ActivoMonitoreadoDetalle, SensorPosicionado } from "@/lib/db";
import type { Meter, SensorGroup } from "@/lib/fracttal";
import {
  esVelocidad,
  categoriaDeMedidor,
  mmsAInsNumero,
  nivelVelocidad,
  nivelTemperatura,
  nivelDesdeRango,
  unidadDeMedidor,
  ordenarPorPosicion,
  ordenarMedidores,
  posicionDeMedidor,
  type NivelSeveridad,
} from "@/lib/fracttal";

/** Colores de las pastillas de valor según nivel de severidad. */
const CLASE_NIVEL: Record<NivelSeveridad, string> = {
  normal: "bg-[#C0DD97] text-[#173404]",
  alerta: "bg-[#FAC775] text-[#412402]",
  critico: "bg-[#F09595] text-[#501313]",
};
const CLASE_SIN_DATO = "bg-slate-700 text-slate-300";

interface PromedioMedidor {
  avg: number;
  count: number;
  min: number;
  max: number;
  last: string;
}

type PromediosPorMedidor = Record<number, PromedioMedidor>;

type PosicionEtiqueta = { x: number; y: number } | null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchJson(url: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(url, { cache: "no-store", ...opts });
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

  // ---- Posiciones de etiquetas (arrastrables) ----
  const [posiciones, setPosiciones] = useState<
    Record<number, PosicionEtiqueta>
  >(() => {
    const obj: Record<number, PosicionEtiqueta> = {};
    detalle.sensores.forEach((s) => {
      obj[s.id] =
        s.etiqueta_pos_x != null && s.etiqueta_pos_y != null
          ? { x: s.etiqueta_pos_x, y: s.etiqueta_pos_y }
          : null;
    });
    return obj;
  });
  const [modoOrganizar, setModoOrganizar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const posicionesRespaldoRef = useRef<Record<number, PosicionEtiqueta>>({});
  const contenedorRef = useRef<HTMLDivElement>(null);

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
          // Un sensor "desarmado" (tarea #47) tiene un code sintético
          // "ACTIVO::idMedidor" que no existe en Fracttal — hay que pedir
          // las lecturas con el code REAL del activo dueño + el serial del
          // medidor. Los sensores normales (agrupados) siguen usando su
          // code real de siempre.
          const esDesarmado = s.sensor_code.includes("::");
          const grupo = metaPorCodigo[s.sensor_code];
          const params = new URLSearchParams();
          if (esDesarmado && grupo?.meters[0]) {
            params.set("code", grupo.meters[0].code);
            params.set("serial", grupo.meters[0].serial);
            params.set("n", "5");
          } else {
            params.set("code", s.sensor_code);
            params.set("n", "10");
          }
          try {
            const j = await fetchJson(
              `/api/fracttal/averages?${params.toString()}`
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

  function moverEtiqueta(id: number, x: number, y: number) {
    setPosiciones((prev) => ({ ...prev, [id]: { x, y } }));
  }

  function iniciarOrganizar() {
    posicionesRespaldoRef.current = posiciones;
    setModoOrganizar(true);
  }

  function cancelarOrganizar() {
    setPosiciones(posicionesRespaldoRef.current);
    setModoOrganizar(false);
  }

  async function guardarPosiciones() {
    setGuardando(true);
    try {
      const etiquetas = Object.entries(posiciones)
        .filter(([, v]) => v !== null)
        .map(([id, v]) => ({ id: Number(id), x: v!.x, y: v!.y }));
      await fetchJson(
        `/api/activos/${encodeURIComponent(detalle.activo_code)}/etiquetas`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ etiquetas }),
        }
      );
      setModoOrganizar(false);
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
        <div className="flex flex-wrap items-center gap-3">
          {ultimaActualizacion && !modoOrganizar && (
            <span className="text-xs text-slate-400">
              Última actualización:{" "}
              {ultimaActualizacion.toLocaleTimeString("es-MX")}
            </span>
          )}
          {modoOrganizar ? (
            <>
              <button
                onClick={cancelarOrganizar}
                disabled={guardando}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={guardarPosiciones}
                disabled={guardando}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {guardando ? "Guardando…" : "Guardar posiciones"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={iniciarOrganizar}
                className="rounded-lg border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand/5"
              >
                Organizar etiquetas
              </button>
              <button
                onClick={actualizarAhora}
                disabled={estado === "cargando"}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {estado === "cargando"
                  ? "Actualizando…"
                  : `Actualizar ahora (${segundosRestantes}s)`}
              </button>
            </>
          )}
        </div>
      </div>

      {modoOrganizar && (
        <div className="rounded-lg border border-brand/30 bg-brand/5 p-3 text-sm text-slate-700">
          Arrastra las etiquetas para separarlas donde mejor se vean. El punto
          azul no se mueve. Cuando termines, presiona{" "}
          <strong>Guardar posiciones</strong>.
        </div>
      )}

      {estado === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Imagen con indicadores tipo SCADA. self-start evita que la imagen
          se estire; sin overflow-hidden para que los recuadros de valores
          puedan salirse del marco cuando el punto está cerca de un borde. */}
      <div
        ref={contenedorRef}
        className="relative w-full select-none self-start rounded-xl border-2 border-slate-300 bg-white"
      >
        {detalle.imagen_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={detalle.imagen_url}
            alt={detalle.activo_nombre ?? detalle.activo_code}
            className="block w-full select-none rounded-xl"
            draggable={false}
          />
        )}

        {/* Líneas conectoras entre el punto y su etiqueta cuando se movió. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {detalle.sensores.map((s) => {
            const custom = posiciones[s.id];
            if (!custom) return null;
            return (
              <line
                key={s.id}
                x1={s.pos_x}
                y1={s.pos_y}
                x2={custom.x}
                y2={custom.y}
                stroke="#2929ff"
                strokeWidth={1.25}
                strokeDasharray="3 2"
                vectorEffect="non-scaling-stroke"
                opacity={0.6}
              />
            );
          })}
        </svg>

        {detalle.sensores.map((s) => (
          <IndicadorSensor
            key={s.id}
            sensor={s}
            grupo={metaPorSensor[s.sensor_code]}
            promedios={promediosPorSensor[s.sensor_code] ?? {}}
            cargando={estado === "cargando" && !metaPorSensor[s.sensor_code]}
            modoOrganizar={modoOrganizar}
            posicionEtiqueta={posiciones[s.id] ?? null}
            onMoverEtiqueta={moverEtiqueta}
            contenedorRef={contenedorRef}
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
  modoOrganizar,
  posicionEtiqueta,
  onMoverEtiqueta,
  contenedorRef,
}: {
  sensor: SensorPosicionado;
  grupo: SensorGroup | undefined;
  promedios: PromediosPorMedidor;
  cargando: boolean;
  modoOrganizar: boolean;
  posicionEtiqueta: PosicionEtiqueta;
  onMoverEtiqueta: (id: number, x: number, y: number) => void;
  contenedorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const meters: Meter[] = grupo?.meters ?? [];
  const velocidades = ordenarPorPosicion(meters.filter(esVelocidad)).slice(
    0,
    3
  );
  // Un punto de vibración clásico (molino) trae velocidad H/V/A [+ temp] en
  // un mismo grupo: solo ahí tiene sentido la rejilla H/V/A/T. Cualquier otro
  // grupo (voltaje, corriente, o un eje de vibración "desarmado" con un solo
  // medidor, como los Eje x/y/z de la bomba de lodos) se muestra como 1
  // pastilla por medidor.
  const esPuntoDeVibracion = velocidades.length >= 2;
  const temperatura = meters.find((m) => categoriaDeMedidor(m) === "temp");
  const medidoresGenericos = ordenarMedidores(meters);

  const arrastreRef = useRef<{
    clientX: number;
    clientY: number;
    xPercent: number;
    yPercent: number;
  } | null>(null);

  /** Texto y nivel de severidad de un medidor de velocidad (H/V/A). */
  function datoVelocidad(m: Meter | undefined): {
    texto: string;
    nivel: NivelSeveridad | null;
  } {
    if (!m) return { texto: "—", nivel: null };
    const prom = promedios[m.id];
    if (!prom) return { texto: "—", nivel: null };
    const enPulgadas = mmsAInsNumero(prom.avg);
    return { texto: String(enPulgadas), nivel: nivelVelocidad(enPulgadas) };
  }

  /** Texto y nivel de severidad del medidor de temperatura. */
  function datoTemperatura(m: Meter | undefined): {
    texto: string;
    nivel: NivelSeveridad | null;
  } {
    if (!m) return { texto: "—", nivel: null };
    const prom = promedios[m.id];
    if (!prom) return { texto: "—", nivel: null };
    return { texto: String(prom.avg), nivel: nivelTemperatura(prom.avg) };
  }

  /**
   * Texto (con unidad) y nivel de un medidor genérico: voltaje, corriente,
   * potencia, desplazamiento, etc. El color sale del rango min_value/max_value
   * que ya trae Fracttal por medidor; si Fracttal no lo tiene configurado, se
   * muestra sin color (gris) en vez de asumir que está normal.
   *
   * Excepción: si el medidor es de velocidad de vibración (ej. los "Eje
   * x/y/z" desarmados de la bomba de lodos), se muestra convertido a in/s y
   * con el MISMO semáforo de vibración del molino (0.2 / 0.3 in/s), no con
   * el rango genérico de Fracttal.
   */
  function datoGenerico(m: Meter): {
    texto: string;
    nivel: NivelSeveridad | null;
  } {
    const prom = promedios[m.id];
    if (!prom) return { texto: "—", nivel: null };
    if (esVelocidad(m)) {
      const enPulgadas = mmsAInsNumero(prom.avg);
      return {
        texto: `${enPulgadas} in/s`,
        nivel: nivelVelocidad(enPulgadas),
      };
    }
    const decimales = Math.abs(prom.avg) < 10 ? 2 : 1;
    const valor = Number(prom.avg.toFixed(decimales));
    const unidad = unidadDeMedidor(m);
    return {
      texto: unidad ? `${valor} ${unidad}` : String(valor),
      nivel: nivelDesdeRango(prom.avg, m.min_value, m.max_value),
    };
  }

  function manejarPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!modoOrganizar || !contenedorRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const contRect = contenedorRef.current.getBoundingClientRect();
    const labelRect = e.currentTarget.getBoundingClientRect();
    arrastreRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      xPercent: ((labelRect.left - contRect.left) / contRect.width) * 100,
      yPercent: ((labelRect.top - contRect.top) / contRect.height) * 100,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function manejarPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!arrastreRef.current || !contenedorRef.current) return;
    const contRect = contenedorRef.current.getBoundingClientRect();
    const dx =
      ((e.clientX - arrastreRef.current.clientX) / contRect.width) * 100;
    const dy =
      ((e.clientY - arrastreRef.current.clientY) / contRect.height) * 100;
    onMoverEtiqueta(
      sensor.id,
      arrastreRef.current.xPercent + dx,
      arrastreRef.current.yPercent + dy
    );
  }

  function manejarPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    arrastreRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  // Ancla el recuadro hacia el lado contrario del borde más cercano para
  // que se salga lo menos posible de la imagen (solo aplica a la posición
  // automática, antes de que el ingeniero la arrastre).
  const haciaIzquierda = sensor.pos_x > 65;
  const haciaArriba = sensor.pos_y > 75;

  const estiloEtiqueta: React.CSSProperties = posicionEtiqueta
    ? { left: `${posicionEtiqueta.x}%`, top: `${posicionEtiqueta.y}%` }
    : {
        left: `${sensor.pos_x}%`,
        top: `${sensor.pos_y}%`,
        transform: `translate(${
          haciaIzquierda ? "calc(-100% - 10px)" : "10px"
        }, ${haciaArriba ? "calc(-100% - 6px)" : "6px"})`,
      };

  return (
    <>
      {/* Punto exacto: siempre fijo, no se mueve al organizar etiquetas */}
      <div
        style={{ left: `${sensor.pos_x}%`, top: `${sensor.pos_y}%` }}
        className="absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand shadow"
      />
      {/* Recuadro de indicadores, siempre visible, arrastrable en modo organizar */}
      <div
        style={{ ...estiloEtiqueta, touchAction: "none" }}
        onPointerDown={manejarPointerDown}
        onPointerMove={manejarPointerMove}
        onPointerUp={manejarPointerUp}
        onPointerCancel={manejarPointerUp}
        className={`absolute z-20 w-max select-none rounded-md bg-slate-900/90 px-2 py-1.5 text-[11px] leading-tight text-white shadow-lg ${
          modoOrganizar
            ? "cursor-grab ring-2 ring-brand/70 active:cursor-grabbing"
            : ""
        }`}
      >
        <p className="mb-1 font-semibold text-slate-200">
          {sensor.sensor_code}
        </p>
        {cargando ? (
          <p className="text-slate-400">Cargando…</p>
        ) : !grupo ? (
          <p className="text-slate-400">Sin datos</p>
        ) : esPuntoDeVibracion ? (
          <div className="grid grid-cols-2 gap-1">
            <Pastilla etiqueta="H" dato={datoVelocidad(velocidades[0])} />
            <Pastilla etiqueta="V" dato={datoVelocidad(velocidades[1])} />
            <Pastilla etiqueta="A" dato={datoVelocidad(velocidades[2])} />
            <Pastilla
              etiqueta="T"
              dato={datoTemperatura(temperatura)}
              sufijo="°"
            />
          </div>
        ) : (
          <div className="min-w-[9rem] space-y-1">
            {medidoresGenericos.map((m) => (
              <PastillaGenerica
                key={m.id}
                etiqueta={
                  esVelocidad(m)
                    ? `${m.description} (${posicionDeMedidor(m)})`
                    : m.description
                }
                dato={datoGenerico(m)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Pastilla({
  etiqueta,
  dato,
  sufijo,
}: {
  etiqueta: string;
  dato: { texto: string; nivel: NivelSeveridad | null };
  sufijo?: string;
}) {
  const clase = dato.nivel ? CLASE_NIVEL[dato.nivel] : CLASE_SIN_DATO;
  return (
    <span className={`rounded px-1.5 py-0.5 font-medium ${clase}`}>
      {etiqueta} {dato.texto}
      {dato.nivel ? sufijo : ""}
    </span>
  );
}

/** Pastilla de un medidor genérico: etiqueta (descripción) + valor con unidad. */
function PastillaGenerica({
  etiqueta,
  dato,
}: {
  etiqueta: string;
  dato: { texto: string; nivel: NivelSeveridad | null };
}) {
  const clase = dato.nivel ? CLASE_NIVEL[dato.nivel] : CLASE_SIN_DATO;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-slate-300" title={etiqueta}>
        {etiqueta}
      </span>
      <span
        className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 font-medium ${clase}`}
      >
        {dato.texto}
      </span>
    </div>
  );
}
