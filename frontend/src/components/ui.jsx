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
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-md border text-sm md:h-7 md:w-7 ${
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
      className="w-full rounded-md border border-dashed border-slate-300 py-2.5 text-sm md:py-1.5 text-slate-600 hover:border-teal hover:text-teal-dark dark:border-ink-line dark:text-slate-300 dark:hover:text-teal-soft"
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
    // En móvil: pantalla completa, cabecera y botones de acción fijos (con zona segura); desde md: ventana centrada.
    <div className="fixed inset-0 z-50 bg-slate-900/40 md:grid md:place-items-center md:p-4 md:backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className={`modal-caja flex h-full w-full flex-col overflow-hidden bg-white dark:bg-ink-2 md:h-auto md:max-h-[85vh] ${ancho} md:rounded-xl md:border md:border-slate-200 md:shadow-2xl md:dark:border-ink-line`} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 pt-[max(.75rem,env(safe-area-inset-top))] md:px-5 md:py-4 dark:border-ink-line">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{titulo}</h2>
            {sub && <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{sub}</p>}
          </div>
          <BtnIcon title="Cerrar" onClick={onCerrar}>✕</BtnIcon>
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4 md:p-5">{children}</div>
        {pie && <div className="pie-seguro pad-seguro-x flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 bg-white px-4 pt-3 md:px-5 dark:border-ink-line dark:bg-ink-2">{pie}</div>}
      </div>
    </div>
  );
}

// Nombre que debe ser único (secciones, materiales…): se confirma al salir del campo;
// si está vacío o repetido, vuelve al anterior y avisa.
export function NombreUnico({ value, otros, onChange, className = "", ...p }) {
  const [txt, setTxt] = useState(value);
  const [error, setError] = useState("");
  useEffect(() => { setTxt(value); }, [value]);
  const confirmar = () => {
    const t = String(txt).trim();
    if (t === value) { setError(""); return; }
    if (!t) { setError("El nombre no puede quedar vacío."); setTxt(value); return; }
    if (otros.includes(t)) { setError(`Ya existe «${t}»: usa otro nombre.`); setTxt(value); return; }
    setError(""); onChange(t);
  };
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <input {...p} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={confirmar}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        className={`inp ${error ? "border-rose-500" : ""} ${className}`} />
      {error && <span className="mt-0.5 text-[11px] text-rose-600">{error}</span>}
    </span>
  );
}
