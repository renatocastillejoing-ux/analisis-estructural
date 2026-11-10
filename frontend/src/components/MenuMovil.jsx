import { useEffect } from "react";
import { BuscadorComandos } from "./MenuBar.jsx";

// Menú de pantallas chicas: vistas, buscador, todos los menús y el tema en un panel lateral.
export default function MenuMovil({ abierto, onCerrar, menus, comandos, vistas, vista, setVista, tema, setTema }) {
  useEffect(() => {
    if (!abierto) return;
    const h = (e) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [abierto, onCerrar]);
  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <aside className="absolute inset-y-0 right-0 flex w-[86vw] max-w-sm flex-col bg-white shadow-2xl dark:bg-ink-2" aria-label="Menú">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-4 dark:border-ink-line">
          <span className="font-semibold">Menú</span>
          <button onClick={onCerrar} className="ml-auto grid h-8 w-8 place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-ink-3" aria-label="Cerrar menú">✕</button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          <BuscadorComandos comandos={comandos.map((c) => ({ ...c, accion: () => { onCerrar(); c.accion(); } }))} ancho="w-full" />
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase text-slate-500">Vistas</div>
            <div className="grid grid-cols-2 gap-1">
              {vistas.map(([id, l]) => (
                <button key={id} onClick={() => { setVista(id); onCerrar(); }} className={`rounded-md border px-3 py-2 text-left ${vista === id ? "border-teal bg-teal text-white" : "border-slate-200 dark:border-ink-line"}`}>{l}</button>
              ))}
            </div>
          </div>
          {menus.map((m) => (
            <details key={m.id} className="rounded-lg border border-slate-200 dark:border-ink-line">
              <summary className="cursor-pointer list-none px-3 py-2 font-semibold">{m.label}</summary>
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
