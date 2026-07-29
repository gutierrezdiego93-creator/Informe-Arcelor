"use client";

// Lista de informes anteriores (Home) con opción de eliminar.
import { useState } from "react";
import type { InformeResumen } from "@/lib/db";

const COLOR_NIVEL: Record<string, string> = {
  NORMAL: "bg-green-100 text-green-700",
  ALERTA: "bg-yellow-100 text-yellow-700",
  CRÍTICO: "bg-red-100 text-red-700",
};

export default function ListaInformes({
  informesIniciales,
}: {
  informesIniciales: InformeResumen[];
}) {
  const [informes, setInformes] = useState(informesIniciales);
  const [eliminandoId, setEliminandoId] = useState<number | null>(null);

  async function eliminar(id: number) {
    if (!confirm("¿Eliminar este informe del historial? Esta acción no se puede deshacer.")) {
      return;
    }
    setEliminandoId(id);
    try {
      const res = await fetch(`/api/informes/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Error desconocido");
      setInformes((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      alert(
        "No se pudo eliminar: " +
          (err instanceof Error ? err.message : "error desconocido")
      );
    } finally {
      setEliminandoId(null);
    }
  }

  if (informes.length === 0) {
    return (
      <p className="mt-2 text-sm text-slate-500">
        Todavía no hay informes generados.
      </p>
    );
  }

  return (
    <div className="mt-3 divide-y divide-slate-100">
      {informes.map((inf) => (
        <div
          key={inf.id}
          className="flex items-center justify-between gap-3 py-3"
        >
          <div>
            <p className="text-sm font-medium text-slate-800">
              {inf.activo_nombre ?? inf.activo_code ?? "Activo sin nombre"}{" "}
              <span className="font-normal text-slate-500">
                · Semana {inf.semana}
              </span>
            </p>
            <p className="text-xs text-slate-500">
              {inf.fecha} · {inf.analista ?? "—"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {inf.nivel_general && (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  COLOR_NIVEL[inf.nivel_general] ?? "bg-slate-100 text-slate-600"
                }`}
              >
                {inf.nivel_general}
              </span>
            )}
            <button
              onClick={() => eliminar(inf.id)}
              disabled={eliminandoId === inf.id}
              className="text-xs text-red-600 hover:underline disabled:opacity-50"
            >
              {eliminandoId === inf.id ? "Eliminando…" : "Eliminar"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
