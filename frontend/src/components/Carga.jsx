import { useEffect, useState } from "react";
import { estimar, suscribir, tareasEnCurso } from "../progreso.js";

const seg = (s) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);

// Indicador global: una tarjeta fija, visible en cualquier vista, por cada tarea en curso.
// Aparece a los 300 ms (las acciones instantáneas no parpadean) y se actualiza 4 veces por segundo.
export default function Carga() {
  const [, setTic] = useState(0);
  const [lista, setLista] = useState(tareasEnCurso());
  useEffect(() => suscribir(() => setLista(tareasEnCurso())), []);
  useEffect(() => {
    if (!lista.length) return undefined;
    const t = setInterval(() => setTic((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [lista.length]);
  const visibles = lista.filter((t) => Date.now() - t.inicio > 300);
  if (!visibles.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(3.25rem+env(safe-area-inset-top))] z-50 flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {visibles.map((t) => {
        const e = estimar(t);
        const pct = e.fraccion != null ? Math.round(100 * Math.min(1, Math.max(0, e.fraccion))) : null;
        return (
          <div key={t.id} className="pointer-events-auto w-full max-w-md rounded-xl border border-teal/40 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-teal-soft/30 dark:bg-ink-2/95">
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-teal border-t-transparent dark:border-teal-soft dark:border-t-transparent" aria-hidden />
              <span className="truncate text-sm font-semibold">{t.titulo}</span>
              {pct != null && <span className="ml-auto text-sm font-semibold tabular-nums text-teal-dark dark:text-teal-soft">{pct} %</span>}
            </div>
            {(t.etapa || t.paso) && (
              <p className="mt-1 truncate text-xs text-slate-600 dark:text-slate-300">
                {t.paso?.n ? `${t.paso.i} de ${t.paso.n}${t.paso.nombre ? ` · ${t.paso.nombre}` : ""}` : t.etapa}
              </p>
            )}
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-ink-line">
              {pct != null
                ? <div className="h-full rounded-full bg-teal transition-[width] duration-300 dark:bg-teal-soft" style={{ width: `${Math.max(3, pct)}%` }} />
                : <div className="h-full w-1/3 animate-[carga_1.2s_ease-in-out_infinite] rounded-full bg-teal dark:bg-teal-soft" />}
            </div>
            <p className="mt-1.5 flex justify-between text-xs tabular-nums text-slate-500 dark:text-slate-400">
              <span>Transcurrido {seg(e.trans)}</span>
              <span>{e.falta != null ? `Faltan ~${seg(e.falta)}` : e.trans > 2 ? "Calculando cuánto falta…" : ""}</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}
