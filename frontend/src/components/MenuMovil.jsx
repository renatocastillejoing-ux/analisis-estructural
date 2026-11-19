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
  const [sub, setSub] = useState(null);           // menú abierto (pantalla 2) o null (inicio)
  useEffect(() => { if (abierto) setSub(null); }, [abierto]);
  if (!abierto) return null;
  const ICV = { modelo: "✎", "3d": "⬚", resultados: "▤", paso: "≡", historial: "↺" };
  const ICM = { archivo: "📁", editar: "✂", vista: "👁", definir: "⚙", dibujar: "✏", asignar: "⇣", analizar: "▶", ayuda: "?" };
  const m = sub && menus.find((x) => x.id === sub);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40" onPointerDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <aside className="absolute inset-y-0 right-0 flex w-[88vw] max-w-sm flex-col bg-white pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] shadow-2xl dark:bg-ink-2" aria-label="Menú"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: g.current ? "none" : "transform .2s ease" }}
        onTouchStart={ini} onTouchMove={mov} onTouchEnd={fin} onTouchCancel={fin}>
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-slate-200 px-2 dark:border-ink-line">
          {m ? <button onClick={() => setSub(null)} className="grid h-11 w-11 place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-ink-3" aria-label="Volver">←</button> : null}
          <span className="px-2 font-semibold">{m ? m.label : "Menú"}</span>
          <button onClick={() => setTema((t) => (t === "dark" ? "light" : "dark"))} className="ml-auto grid h-11 w-11 place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-ink-3" aria-label={tema === "dark" ? "Tema claro" : "Tema oscuro"}>{tema === "dark" ? "☀" : "☾"}</button>
          <button onClick={onCerrar} className="grid h-11 w-11 place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-ink-3" aria-label="Cerrar menú">✕</button>
        </div>
        {m ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm">
            {m.items.map((it, k) => it === "sep"
              ? <div key={`s${k}`} className="my-1 border-t border-slate-200 dark:border-ink-line" />
              : (
                <button key={it.id} disabled={it.disabled} onClick={() => { onCerrar(); it.accion(); }}
                  className="flex min-h-12 w-full items-center gap-3 px-4 text-left hover:bg-slate-50 disabled:opacity-40 dark:hover:bg-ink-3">
                  <span className="w-5 text-center text-teal-dark dark:text-teal-soft">{it.check ? "✓" : it.icono || ""}</span>
                  <span className="flex-1">{it.label}</span>
                </button>
              ))}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm">
            <BuscadorComandos comandos={comandos.map((c) => ({ ...c, accion: () => { onCerrar(); c.accion(); } }))} ancho="w-full" />
            {onFoto && (
              <button onClick={() => { onCerrar(); onFoto(); }} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal px-4 font-semibold text-white hover:bg-teal-dark">📷 Ejercicio desde foto</button>
            )}
            <div>
              <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vistas</div>
              <div className="grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-ink-3">
                {vistas.map(([id, l]) => (
                  <button key={id} onClick={() => { setVista(id); onCerrar(); }} aria-pressed={vista === id}
                    className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 text-[11px] leading-tight ${vista === id ? "bg-teal font-semibold text-white shadow" : "text-slate-600 dark:text-slate-300"}`}>
                    <span className="text-base leading-none">{ICV[id] || "•"}</span><span className="text-center">{l}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Menús</div>
              <div className="grid grid-cols-2 gap-2">
                {menus.map((x) => (
                  <button key={x.id} onClick={() => setSub(x.id)}
                    className="flex min-h-14 items-center gap-2 rounded-xl border border-slate-200 px-3 text-left font-semibold hover:bg-slate-50 dark:border-ink-line dark:hover:bg-ink-3">
                    <span className="text-lg leading-none">{ICM[x.id] || "•"}</span><span className="flex-1">{x.label}</span><span className="text-slate-400">›</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
