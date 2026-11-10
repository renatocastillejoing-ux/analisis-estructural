import { useEffect, useRef, useState } from "react";

// Documentos abiertos del proyecto (pórticos 2D y modelos 3D). Cambiar de documento no pierde nada.
export default function Documentos({ docs, activo, onCambiar, onCerrar, onNuevo2d, onNuevo3d }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!abierto) return;
    const h = (e) => { if (!ref.current?.contains(e.target)) setAbierto(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [abierto]);
  const act = docs.find((d) => d.id === activo);
  const es3 = (d) => d.modelo?.tipo === "3d";
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setAbierto((a) => !a)} aria-haspopup="menu" aria-expanded={abierto} title="Documentos abiertos del proyecto"
        className="flex h-8 max-w-[9rem] items-center sm:max-w-[10rem] 2xl:max-w-[14rem] gap-1.5 rounded-md border border-slate-200 px-2 text-[13px] hover:bg-slate-100 dark:border-ink-line dark:hover:bg-ink-3">
        <span className={`rounded px-1 text-[10px] font-bold ${act && es3(act) ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" : "bg-teal/15 text-teal-dark dark:text-teal-soft"}`}>{act && es3(act) ? "3D" : "2D"}</span>
        <span className="truncate font-medium">{act?.modelo?.nombre || "Sin título"}</span>
        <span className="text-slate-400">▾</span>
        {docs.length > 1 && <span className="rounded-full bg-slate-200 px-1.5 text-[10px] tabular-nums dark:bg-ink-3">{docs.length}</span>}
      </button>
      {abierto && (
        <div role="menu" className="absolute left-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-ink-line dark:bg-ink-2">
          <div className="px-3 py-1 text-[11px] font-semibold uppercase text-slate-500">Documentos abiertos</div>
          {docs.map((d) => (
            <div key={d.id} className={`group flex items-center gap-2 px-3 py-1.5 text-[13px] ${d.id === activo ? "bg-teal/10" : "hover:bg-slate-100 dark:hover:bg-ink-3"}`}>
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => { onCambiar(d.id); setAbierto(false); }}>
                <span className={`rounded px-1 text-[10px] font-bold ${es3(d) ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" : "bg-teal/15 text-teal-dark dark:text-teal-soft"}`}>{es3(d) ? "3D" : "2D"}</span>
                <span className="truncate">{d.modelo?.nombre || "Sin título"}</span>
                <span className="ml-auto shrink-0 text-[11px] text-slate-500">{d.modelo?.nudos?.length} nudos</span>
              </button>
              {docs.length > 1 && <button onClick={() => onCerrar(d.id)} className="text-slate-400 opacity-0 hover:text-rose-600 group-hover:opacity-100" aria-label={`Cerrar ${d.modelo?.nombre}`}>✕</button>}
            </div>
          ))}
          <div className="my-1 border-t border-slate-200 dark:border-ink-line" />
          <button className="w-full px-3 py-1.5 text-left text-[13px] hover:bg-slate-100 dark:hover:bg-ink-3" onClick={() => { onNuevo2d(); setAbierto(false); }}>+ Nuevo pórtico 2D</button>
          <button className="w-full px-3 py-1.5 text-left text-[13px] hover:bg-slate-100 dark:hover:bg-ink-3" onClick={() => { onNuevo3d(); setAbierto(false); }}>+ Nuevo modelo 3D…</button>
        </div>
      )}
    </div>
  );
}
