// Promedio de las últimas N lecturas de cada medidor de un sensor
//   /api/fracttal/averages?code=CLC&n=10
//   /api/fracttal/averages?code=M-002&serial=M-002-VOLT-L1&n=5  (medidor
//   individual "desarmado": code = activo real dueño del medidor, serial =
//   identifica al medidor exacto dentro de ese activo)
// Respuesta: { success, data: { [id_meter]: { avg, count, min, max, last } } }
import { NextRequest, NextResponse } from "next/server";
import { getMeterReadings, type MeterReading } from "@/lib/fracttal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DIAS_VENTANA = 45; // buscar lecturas de los últimos 45 días
const MAX_PAGES = 6; // tope de seguridad (600 lecturas por sensor)

export interface PromedioMedidor {
  avg: number;
  count: number;
  min: number;
  max: number;
  last: string; // fecha de la lectura más reciente usada
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const code = p.get("code")?.trim();
  const serial = p.get("serial")?.trim() || undefined;
  const n = Math.min(Math.max(parseInt(p.get("n") ?? "10", 10) || 10, 1), 50);
  if (!code) {
    return NextResponse.json(
      { success: false, message: "Falta el parámetro ?code=" },
      { status: 400 }
    );
  }

  try {
    const since = new Date(Date.now() - DIAS_VENTANA * 86_400_000)
      .toISOString()
      .slice(0, 10);

    // Traer el historial del sensor completo (todos sus medidores)
    const todas: MeterReading[] = [];
    let start = 0;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await getMeterReadings({
        code,
        serial,
        type_date: "date_reading",
        since,
        start,
        limit: 100,
      });
      todas.push(...(page.data ?? []));
      if (!page.data || page.data.length < 100) break;
      start += 100;
    }

    // Agrupar por medidor
    const porMedidor = new Map<number, MeterReading[]>();
    for (const r of todas) {
      if (!r.data || typeof r.data.value !== "number") continue;
      const lista = porMedidor.get(r.id_meter) ?? [];
      lista.push(r);
      porMedidor.set(r.id_meter, lista);
    }

    // Últimas N lecturas de cada medidor → promedio, mín, máx
    const data: Record<number, PromedioMedidor> = {};
    for (const [idMeter, lecturas] of porMedidor) {
      lecturas.sort(
        (a, b) =>
          new Date(a.date_reading ?? a.date).getTime() -
          new Date(b.date_reading ?? b.date).getTime()
      );
      const ultimas = lecturas.slice(-n);
      const valoresNum = ultimas.map((r) => r.data.value);
      const suma = valoresNum.reduce((acc, v) => acc + v, 0);
      data[idMeter] = {
        avg: Number((suma / valoresNum.length).toFixed(4)),
        count: valoresNum.length,
        min: Number(Math.min(...valoresNum).toFixed(2)),
        max: Number(Math.max(...valoresNum).toFixed(2)),
        last:
          ultimas[ultimas.length - 1].date_reading ??
          ultimas[ultimas.length - 1].date,
      };
    }

    return NextResponse.json({ success: true, code, n, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
