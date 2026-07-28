# Informe de Condición — ArcelorMittal × Fracttal

App Next.js que digitaliza el reporte semanal de análisis de vibraciones. El ingeniero selecciona el activo en Fracttal, elige los sensores (sub-activos) a incluir y la app precarga lecturas, umbrales y datos del equipo vía API.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · Vercel. Fase 2: Neon Postgres + Prisma (historial), Vercel Blob (evidencias), `docx` + `@react-pdf/renderer` (salida PDF + Word).

## Configuración

1. Copia `.env.example` a `.env.local` y coloca las credenciales del consumidor OAuth (Fracttal One → Configuración → Conexiones API → Consumidores OAuth). **Nunca** las subas al repo.
2. `npm install`
3. `npm run dev` → http://localhost:3000

En Vercel, define `FRACTTAL_CLIENT_KEY` y `FRACTTAL_CLIENT_SECRET` en Project Settings → Environment Variables.

## Arquitectura

- `lib/fracttal.ts` — cliente API: token OAuth (client_credentials) con caché y retry en 401, endpoints de medidores, `getSensorsForAsset()` que agrupa medidores por sub-activo.
- `app/api/fracttal/*` — proxys de servidor; las credenciales nunca llegan al navegador.
- `app/informes/nuevo` — wizard (paso 1: activo → sensores).

## Jerarquía de activos

Los medidores cuelgan de los sub-activos (sensores), no del activo principal:

```
MOLINO 6-5A
├── CLL, CLC            (chumaceras)
├── REDUCTOR → RINT, RBAJ, RALT
└── MOTOR MOLINO → MLC, MLL
```

`getSensorsForAsset("MOLINO-6-5A")` usa `location_code` para traer los medidores de todas las hijas en una llamada y los agrupa por sensor.

## Roadmap

1. ✅ Paso 1: selección activo + sensores
2. Paso 2-3: datos de inspección + valores de vibración (precarga desde `/meters_reading/`)
3. Pasos 4-7: evidencias, diagnóstico, recomendaciones, generación PDF + Word
4. Historial en BD + comparativa semanal automática
5. Adjuntar PDF al activo en Fracttal al finalizar
