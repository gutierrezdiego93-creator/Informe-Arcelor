"use client";

// Pestañas de navegación del header (resalta la pestaña activa según la URL)
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Informes" },
  { href: "/activos", label: "Activos monitoreados" },
];

export default function NavTabs() {
  const pathname = usePathname();
  return (
    <nav className="mx-auto flex max-w-5xl gap-1 px-4">
      {TABS.map((tab) => {
        const activo =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              activo
                ? "bg-white text-brand"
                : "text-white/80 hover:bg-white/10 hover:text-white"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
