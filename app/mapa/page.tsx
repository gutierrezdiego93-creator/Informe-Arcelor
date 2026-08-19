import {
  listarMapa,
  listarActivosMonitoreados,
  SLOTS_MAPA,
  type SlotMapa,
} from "@/lib/db";
import MapaMolinos from "@/components/MapaMolinos";

export const dynamic = "force-dynamic";

/** Si la BD no responde, se pintan los slots vacíos para no tumbar la página. */
const SLOTS_VACIOS: SlotMapa[] = Array.from({ length: SLOTS_MAPA }, (_, i) => ({
  slot: i + 1,
  activo_code: null,
  activo_nombre: null,
  sensores: [],
}));

export default async function MapaPage() {
  const [slots, monitoreados] = await Promise.all([
    listarMapa().catch(() => SLOTS_VACIOS),
    listarActivosMonitoreados().catch(() => []),
  ]);
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold">Mapa de planta</h2>
        <p className="mt-2 text-sm text-slate-600">
          Estado de los equipos sobre el plano de vista superior: un punto de
          color por sensor y el color global del activo, sin valores numéricos.
          Usa el mismo criterio ISO que las cartillas de activos monitoreados y
          se refresca cada 60 segundos. Las posiciones sin activo asignado se
          muestran como &ldquo;sin información&rdquo;.
        </p>
      </section>

      <MapaMolinos
        slotsIniciales={slots}
        codigosMonitoreados={monitoreados.map((a) => a.activo_code)}
      />
    </div>
  );
}
