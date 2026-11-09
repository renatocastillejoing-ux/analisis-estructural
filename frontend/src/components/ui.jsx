import { useEffect, useState } from "react";

// Campo numérico que permite escribir libremente ("-", "0.", vacío) y confirma
// el valor al salir del campo o con Enter.
export function NumIn({ value, onChange, className = "", ...p }) {
  const [txt, setTxt] = useState(value ?? "");
  useEffect(() => { setTxt(value ?? ""); }, [value]);
  const confirmar = () => {
    const v = parseFloat(String(txt).replace(",", "."));
    if (Number.isFinite(v) && v !== +value) onChange(v);
    else setTxt(value ?? "");
  };
  return (
    <input
      {...p}
      inputMode="decimal"
      value={txt}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className={`inp w-full tabular-nums ${className}`}
    />
  );
}

export function Campo({ label, children, hint }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
      <span>{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  );
}

// Bloque plegable del panel izquierdo.
export function Bloque({ titulo, cuenta, abierto = true, acciones, children }) {
  return (
    <details open={abierto} className="group border-b border-slate-200 dark:border-ink-line">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-ink-3">
        <span className="text-[10px] text-slate-500 transition group-open:rotate-90">▶</span>
        {titulo}
        {cuenta != null && <span className="rounded-full bg-teal/15 px-2 text-[11px] font-bold text-teal-dark dark:text-teal-soft">{cuenta}</span>}
        <span className="ml-auto flex gap-1" onClick={(e) => e.preventDefault()}>{acciones}</span>
      </summary>
      <div className="space-y-2 px-4 pb-4 pt-1">{children}</div>
    </details>
  );
}

export function BtnIcon({ children, title, onClick, peligro }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border text-sm ${
        peligro
          ? "border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
          : "border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-ink-line dark:text-slate-300 dark:hover:bg-ink-3"
      }`}
    >
      {children}
    </button>
  );
}

export function BtnAgregar({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-md border border-dashed border-slate-300 py-1.5 text-sm text-slate-600 hover:border-teal hover:text-teal-dark dark:border-ink-line dark:text-slate-300 dark:hover:text-teal-soft"
    >
      {children}
    </button>
  );
}

export function Modal({ titulo, sub, onCerrar, children, pie, ancho = "max-w-xl" }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className={`flex max-h-[85vh] w-full ${ancho} flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-ink-line dark:bg-ink-2`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-ink-line">
          <div>
            <h2 className="text-base font-semibold">{titulo}</h2>
            {sub && <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{sub}</p>}
          </div>
          <BtnIcon title="Cerrar" onClick={onCerrar}>✕</BtnIcon>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {pie && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-ink-line">{pie}</div>}
      </div>
    </div>
  );
}
