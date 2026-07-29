import type { Metadata } from "next";
import "./globals.css";
import NavTabs from "@/components/NavTabs";

export const metadata: Metadata = {
  title: "Informe de Condición — ArcelorMittal",
  description:
    "Generador de reportes de condición de análisis de vibraciones conectado a Fracttal",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <header className="bg-brand text-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <h1 className="text-lg font-semibold">Informe de Condición</h1>
            <span className="text-sm opacity-80">
              ArcelorMittal · Fracttal API
            </span>
          </div>
          <NavTabs />
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
