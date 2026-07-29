import Link from "next/link";
import { listarInformes } from "@/lib/db";
import ListaInformes from "@/components/ListaInformes";

export const dynamic = "force-dynamic";

export default async function Home() {
  const informes = await listarInformes().catch(() => []);
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold">
          Reporte de condición — Análisis de vibraciones
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Genera el informe semanal paso a paso: selecciona el activo en
          Fracttal, elige los sensores a incluir y la app precarga las
          lecturas, umbrales y datos del equipo automáticamente.
        </p>
        <Link
          href="/informes/nuevo"
          className="mt-4 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
        >
          + Nuevo informe
        </Link>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="font-semibold">Informes anteriores</h3>
        <ListaInformes informesIniciales={informes} />
      </section>
    </div>
  );
}
