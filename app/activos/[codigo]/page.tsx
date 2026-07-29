import Link from "next/link";
import { obtenerActivoMonitoreado } from "@/lib/db";
import VistaActivoVivo from "@/components/VistaActivoVivo";

export const dynamic = "force-dynamic";

export default async function ActivoDetallePage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  const detalle = await obtenerActivoMonitoreado(decodeURIComponent(codigo));

  if (!detalle) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Este activo todavía no ha sido configurado.
        </div>
        <Link
          href="/activos/nuevo"
          className="inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
        >
          + Configurar activo
        </Link>
      </div>
    );
  }

  return <VistaActivoVivo detalle={detalle} />;
}
