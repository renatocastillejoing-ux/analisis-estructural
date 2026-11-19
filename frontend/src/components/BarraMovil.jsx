import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Piezas de la barra de reproducción del teléfono (Pizarra y Paso): una sola fila de ≤ 56 px.

// «Paso N/M ▾»: se ve como una cápsula corta; al tocarla abre el selector nativo con los títulos.
export function SelectorPaso({ actual, total, opciones, onElegir, vertical }) {
  return (
    <label className={`relative flex h-11 shrink-0 items-center justify-center rounded-full border border-slate-300 px-3 text-sm font-semibold tabular-nums dark:border-ink-line ${vertical ? "w-12 px-0 text-xs" : "min-w-[6.5rem]"}`}>
      <span aria-hidden="true">{vertical ? `${actual}/${total}` : `Paso ${actual}/${total} ▾`}</span>
      <select value={opciones.find((o) => o.actual)?.valor ?? ""} onChange={(e) => onElegir(e.target.value)} aria-label="Ir al paso"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
        {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
      </select>
    </label>
  );
}

// Hoja inferior para el menú ⋯: fondo que cierra con onPointerDown, respeta safe areas y teclado (--kb).
export function HojaInferior({ abierta, onCerrar, titulo = "Opciones", children }) {
  const caja = useRef(null);
  useEffect(() => {
    if (!abierta) return undefined;
    const h = (e) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [abierta, onCerrar]);
  if (!abierta) return null;
  return createPortal(
    <div className="fixed inset-0 z-[85] bg-slate-900/40" onPointerDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div ref={caja} role="dialog" aria-label={titulo}
        className="hoja-inferior pad-seguro-x absolute inset-x-0 bottom-0 mx-auto max-h-[80dvh] max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl bg-white pt-2 shadow-2xl dark:bg-ink-2">
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300 dark:bg-ink-line" />
        <div className="space-y-3 px-1 pb-3 text-sm">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// Control segmentado compacto
export function Segmentado({ valor, opciones, onCambiar, etiqueta }) {
  return (
    <div className="flex items-center gap-2">
      {etiqueta && <span className="w-16 shrink-0 text-xs text-slate-500 dark:text-slate-400">{etiqueta}</span>}
      <div className="flex flex-1 rounded-lg bg-slate-100 p-0.5 dark:bg-ink-3" role="radiogroup" aria-label={etiqueta}>
        {opciones.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={valor === v} onClick={() => onCambiar(v)}
            className={`flex-1 rounded-md px-2 text-sm ${valor === v ? "bg-white font-semibold text-teal-dark shadow-sm dark:bg-ink-line dark:text-teal-soft" : "text-slate-600 dark:text-slate-300"}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}

export const btnIcono = "grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg hover:bg-slate-100 dark:hover:bg-ink-3";
export const btnPlay = "grid h-11 w-11 shrink-0 place-items-center rounded-full bg-teal text-lg font-semibold text-white hover:bg-teal-dark";
