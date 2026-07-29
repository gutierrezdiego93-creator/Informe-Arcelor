"use client";

// Editor de texto simple con formato básico (negrita, cursiva, tachado,
// listas y tamaño de letra). Guarda el contenido como HTML; ese HTML se
// convierte a elementos del PDF en components/InformePDF.tsx.
import { useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minRows?: number;
}

/** Normaliza las etiquetas <font size="X"> (execCommand legado) a <span
 *  style="font-size:...">, para que el conversor del PDF las entienda igual
 *  que cualquier otro estilo inline. */
function normalizarTamanos(root: HTMLElement) {
  const mapa: Record<string, string> = {
    "2": "11px",
    "3": "14px",
    "5": "18px",
  };
  root.querySelectorAll("font[size]").forEach((f) => {
    const tam = mapa[f.getAttribute("size") ?? "3"] ?? "14px";
    const span = document.createElement("span");
    span.style.fontSize = tam;
    span.innerHTML = f.innerHTML;
    f.replaceWith(span);
  });
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  minRows = 4,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Sincroniza el valor externo (ej. al volver a un paso anterior) sin
  // pelear con la posición del cursor mientras el usuario escribe.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || "")) {
      ref.current.innerHTML = value || "";
    }
  }, [value]);

  function emitirCambio() {
    onChange(ref.current?.innerHTML ?? "");
  }

  function ejecutar(comando: string, valor?: string) {
    ref.current?.focus();
    document.execCommand(comando, false, valor);
    if (comando === "fontSize" && ref.current) {
      normalizarTamanos(ref.current);
    }
    emitirCambio();
  }

  const botones: Array<{
    titulo: string;
    comando: string;
    etiqueta: string;
    clase?: string;
  }> = [
    { titulo: "Negrita", comando: "bold", etiqueta: "N", clase: "font-bold" },
    { titulo: "Cursiva", comando: "italic", etiqueta: "K", clase: "italic" },
    {
      titulo: "Tachado",
      comando: "strikeThrough",
      etiqueta: "S",
      clase: "line-through",
    },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 p-1.5">
        {botones.map((b) => (
          <button
            key={b.comando}
            type="button"
            title={b.titulo}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => ejecutar(b.comando)}
            className={`flex h-7 w-7 items-center justify-center rounded text-sm hover:bg-slate-200 ${b.clase ?? ""}`}
          >
            {b.etiqueta}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-slate-300" />
        <button
          type="button"
          title="Lista con viñetas"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => ejecutar("insertUnorderedList")}
          className="flex h-7 items-center rounded px-2 text-xs hover:bg-slate-200"
        >
          • Lista
        </button>
        <button
          type="button"
          title="Lista numerada"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => ejecutar("insertOrderedList")}
          className="flex h-7 items-center rounded px-2 text-xs hover:bg-slate-200"
        >
          1. Lista
        </button>
        <span className="mx-1 h-5 w-px bg-slate-300" />
        <select
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            if (e.target.value) ejecutar("fontSize", e.target.value);
            e.target.value = "";
          }}
          defaultValue=""
          title="Tamaño de letra"
          className="h-7 rounded border border-slate-300 bg-white px-1 text-xs text-slate-600"
        >
          <option value="" disabled>
            Tamaño
          </option>
          <option value="2">Pequeño</option>
          <option value="3">Normal</option>
          <option value="5">Grande</option>
        </select>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emitirCambio}
        onBlur={emitirCambio}
        data-placeholder={placeholder}
        style={{ minHeight: `${minRows * 1.6}em` }}
        className="rich-editor px-3 py-2 text-sm text-slate-800 outline-none"
      />
    </div>
  );
}
