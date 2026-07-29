import Link from "next/link";
import { listarActivosMonitoreados } from "@/lib/db";
import ListaActivos from "@/components/ListaActivos";

export const dynamic = "force-dynamic";

export default async function ActivosPage() {
  const activos = await listarActivosMonitoreados().catch(() => []);
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold">Activos monitoreados</h2>
        <p className="mt-2 text-sm text-slate-600">
          Configura el diagrama de un activo una sola vez: sube la foto, ubica
          cada sensor sobre la imagen y luego consulta sus valores en vivo
          desde aquí (velocidad en 3 ejes + temperatura, con el promedio de
          las últimas 10 lecturas de Fracttal).
        </p>
        <Link
          href="/activos/nuevo"
          className="mt-4 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
        >
          + Configurar nuevo activo
        </Link>
      </section>

      <ListaActivos activosIniciales={activos} />
    </div>
  );
}
