"use client";

// Grid de activos monitoreados (Activos > Home) con opción de eliminar.
import { useState } from "react";
import Link from "next/link";
import type { ActivoMonitoreadoResumen } from "@/lib/db";

export default function ListaActivos({
  activosIniciales,
}: {
  activosIniciales: ActivoMonitoreadoResumen[];
}) {
  const [activos, setActivos] = useState(activosIniciales);
  const [eliminandoCode, setEliminandoCode] = useState<string | null>(null);

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

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {activos.map((a) => (
        <div
          key={a.activo_code}
          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          <Link href={`/activos/${encodeURIComponent(a.activo_code)}`}>
            {a.imagen_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={a.imagen_url}
                alt={a.activo_nombre ?? a.activo_code}
                className="h-40 w-full bg-slate-100 object-cover"
              />
            ) : (
              <div className="flex h-40 items-center justify-center bg-slate-100 text-xs text-slate-400">
                Sin imagen
              </div>
            )}
          </Link>
          <div className="p-4">
            <p className="truncate text-sm font-medium text-slate-800">
              {a.activo_nombre ?? a.activo_code}
            </p>
            <p className="text-xs text-slate-500">
              {a.activo_code} · {a.num_sensores} sensor(es)
            </p>
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
      ))}
    </div>
  );
}
