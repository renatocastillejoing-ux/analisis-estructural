import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

// Barra de menús estilo ETABS: clic abre un menú; con uno abierto, pasar el mouse cambia de menú.
export function MenuBar({ menus }) {
  const [abierto, setAbierto] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e) => { if (!ref.current?.contains(e.target)) setAbierto(null); };
    const esc = (e) => { if (e.key === "Escape") setAbierto(null); };
    window.addEventListener("mousedown", fuera);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", fuera); window.removeEventListener("keydown", esc); };
  }, [abierto]);

  return (
    <nav ref={ref} className="flex items-center" aria-label="Menú principal">
      {menus.map((m) => (
        <div key={m.id} className="relative">
          <button type="button" aria-haspopup="menu" aria-expanded={abierto === m.id}
            onClick={() => setAbierto((a) => (a === m.id ? null : m.id))}
            onMouseEnter={() => abierto && setAbierto(m.id)}
            className={`rounded-md px-2 py-1.5 text-[13px] ${abierto === m.id ? "bg-slate-200 dark:bg-ink-3" : "hover:bg-slate-100 dark:hover:bg-ink-3"}`}>
            {m.label}
          </button>
          {abierto === m.id && (
            <div role="menu" className="absolute left-0 top-full z-40 mt-1 min-w-[260px] rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-ink-line dark:bg-ink-2">
              {m.items.map((it, k) => it === "sep" ? (
                <div key={k} className="my-1 border-t border-slate-200 dark:border-ink-line" />
              ) : (
                <button key={it.id} role="menuitem" type="button" disabled={it.disabled}
                  onClick={() => { setAbierto(null); it.accion(); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-teal/10 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-ink-3">
                  <span className="w-4 text-center text-teal-dark dark:text-teal-soft">{it.check ? "✓" : it.icono || ""}</span>
                  <span className="flex-1">{it.label}</span>
                  {it.atajo && <kbd className="text-[11px] text-slate-500 dark:text-slate-400">{it.atajo}</kbd>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

const normal = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Buscador de comandos de la cabecera (Ctrl+K): filtra todos los comandos de los menús.
export const BuscadorComandos = forwardRef(function BuscadorComandos({ comandos }, ref) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [k, setK] = useState(0);
  const input = useRef(null);
  const caja = useRef(null);
  useImperativeHandle(ref, () => ({ enfocar: () => { input.current?.focus(); input.current?.select(); } }));

  const lista = useMemo(() => {
    const t = normal(q.trim());
    const xs = comandos.filter((c) => !c.disabled);
    if (!t) return xs.slice(0, 12);
    const palabras = t.split(/\s+/);
    return xs.filter((c) => { const h = normal(`${c.grupo} ${c.label} ${c.claves || ""}`); return palabras.every((p) => h.includes(p)); }).slice(0, 14);
  }, [q, comandos]);
  useEffect(() => setK(0), [q]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e) => { if (!caja.current?.contains(e.target)) setAbierto(false); };
    window.addEventListener("mousedown", fuera);
    return () => window.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const ejecutar = (c) => { setAbierto(false); setQ(""); input.current?.blur(); c.accion(); };

  return (
    <div ref={caja} className="relative w-36 xl:w-52 2xl:w-64">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">⌕</span>
      <input ref={input} value={q} placeholder="Buscar comando…" aria-label="Buscar comando" role="combobox" aria-expanded={abierto}
        onFocus={() => setAbierto(true)}
        onChange={(e) => { setQ(e.target.value); setAbierto(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setK((x) => Math.min(lista.length - 1, x + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setK((x) => Math.max(0, x - 1)); }
          else if (e.key === "Enter" && lista[k]) { e.preventDefault(); ejecutar(lista[k]); }
          else if (e.key === "Escape") { setAbierto(false); e.currentTarget.blur(); }
        }}
        className="inp h-8 w-full !pl-7 !pr-14" />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-300 px-1 text-[10px] text-slate-500 dark:border-ink-line dark:text-slate-400">Ctrl K</kbd>
      {abierto && (
        <div role="listbox" className="absolute right-0 top-full z-40 mt-1 max-h-[70vh] w-[360px] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-ink-line dark:bg-ink-2">
          {lista.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">Ningún comando coincide.</p>}
          {lista.map((c, i) => (
            <button key={c.id} type="button" role="option" aria-selected={i === k}
              onMouseEnter={() => setK(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => ejecutar(c)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${i === k ? "bg-teal/10 dark:bg-ink-3" : ""}`}>
              <span className="w-20 shrink-0 truncate text-[11px] uppercase text-slate-500 dark:text-slate-400">{c.grupo}</span>
              <span className="flex-1">{c.label}</span>
              {c.atajo && <kbd className="text-[11px] text-slate-500 dark:text-slate-400">{c.atajo}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
