import { useEffect, useRef, useState } from "react";
import { BuscadorComandos } from "./MenuBar.jsx";

// Menú de pantallas chicas: vistas, buscador, todos los menús y el tema en un panel lateral.
export default function MenuMovil({ abierto, onCerrar, menus, comandos, vistas, vista, setVista, tema, setTema, onFoto }) {
  // deslizar a la derecha para cerrar (el panel sigue al dedo; > 80 px o un gesto rápido lo cierra)
  const [dx, setDx] = useState(0);
  const g = useRef(null);
  useEffect(() => { if (abierto) setDx(0); }, [abierto]);
  const ini = (e) => { const t = e.touches[0]; g.current = { x: t.clientX, y: t.clientY, t: performance.now(), h: null }; };
  const mov = (e) => {
    const s = g.current; if (!s) return;
    const t = e.touches[0], ddx = t.clientX - s.x, ddy = t.clientY - s.y;
    if (s.h == null && Math.hypot(ddx, ddy) > 8) s.h = Math.abs(ddx) > Math.abs(ddy);
    if (s.h) setDx(Math.max(0, ddx));
  };
  const fin = () => {
    const s = g.current; g.current = null;
    if (!s?.h) { setDx(0); return; }
    const rapido = dx > 30 && dx / Math.max(1, performance.now() - s.t) > 0.5;
    if (dx > 80 || rapido) onCerrar(); else setDx(0);
  };
  useEffect(() => {
    if (!abierto) return;
    const h = (e) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [abierto, onCerrar]);
  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40" onPointerDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <aside className="absolute inset-y-0 right-0 flex w-[88vw] max-w-sm flex-col bg-white pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] shadow-2xl dark:bg-ink-2" aria-label="Menú"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: g.current ? "none" : "transform .2s ease" }}
        onTouchStart={ini} onTouchMove={mov} onTouchEnd={fin} onTouchCancel={fin}>
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-4 dark:border-ink-line">
          <span className="font-semibold">Menú</span>
          <button onClick={onCerrar} className="ml-auto grid h-11 w-11 place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-ink-3" aria-label="Cerrar menú">✕</button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm">
          <BuscadorComandos comandos={comandos.map((c) => ({ ...c, accion: () => { onCerrar(); c.accion(); } }))} ancho="w-full" />
          {onFoto && (
            <button onClick={() => { onCerrar(); onFoto(); }} className="flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-xl bg-teal px-4 text-base font-semibold text-white hover:bg-teal-dark">📷 Ejercicio desde foto</button>
          )}
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Vistas</div>
            <div className="grid grid-cols-2 gap-1">
              {vistas.map(([id, l]) => (
                <button key={id} onClick={() => { setVista(id); onCerrar(); }} className={`rounded-md border px-3 py-2 text-left ${vista === id ? "border-teal bg-teal text-white" : "border-slate-200 dark:border-ink-line"}`}>{l}</button>
              ))}
            </div>
          </div>
          {menus.map((m) => (
            <details key={m.id} className="rounded-lg border border-slate-200 dark:border-ink-line">
              <summary className="flex cursor-pointer list-none items-center px-3 py-2 font-semibold">{m.label}</summary>
              <div className="border-t border-slate-200 py-1 dark:border-ink-line">
                {m.items.filter((it) => it !== "sep").map((it) => (
                  <button key={it.id} disabled={it.disabled} onClick={() => { onCerrar(); it.accion(); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left disabled:opacity-40">
                    <span className="w-4 text-center text-teal-dark dark:text-teal-soft">{it.check ? "✓" : it.icono || ""}</span>
                    <span className="flex-1">{it.label}</span>
                  </button>
                ))}
              </div>
            </details>
          ))}
          <button onClick={() => setTema((t) => (t === "dark" ? "light" : "dark"))} className="w-full rounded-md border border-slate-200 px-3 py-2 text-left dark:border-ink-line">
            {tema === "dark" ? "☀ Tema claro" : "☾ Tema oscuro"}
          </button>
        </div>
      </aside>
    </div>
  );
}
