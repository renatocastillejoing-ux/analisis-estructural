import { useCallback, useEffect, useState } from "react";

// Cálculos guardados por el servidor (SQLite). Abrir uno recupera su modelo y sus resultados.
export default function Historial({ onAbrir, confirmar }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const leer = useCallback(() => {
    fetch("/api/historial").then((r) => r.json()).then((d) => setItems(d.items || [])).catch((e) => setError(String(e)));
  }, []);
  useEffect(leer, [leer]);

  const abrir = async (id) => {
    const d = await fetch(`/api/historial/${id}`).then((r) => r.json());
    if (d.ok === false) return setError(d.error || "No encontrado");
    onAbrir(d);
  };
  const borrar = (it) => confirmar({
    titulo: "Borrar cálculo", texto: `Se borrará «${it.nombre}» del ${it.fecha}. No se puede recuperar.`, accion: "Borrar", peligro: true,
    onAceptar: () => fetch(`/api/historial/${it.id}`, { method: "DELETE" }).then(leer),
  });
  const limpiar = () => confirmar({
    titulo: "Vaciar historial", texto: `Se borrarán los ${items.length} cálculos guardados. No se puede recuperar.`, accion: "Vaciar", peligro: true,
    onAceptar: () => fetch("/api/historial/limpiar", { method: "POST" }).then(leer),
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Historial de cálculos</h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">Cada vez que calculas, el servidor guarda el modelo y sus resultados.</p>
          </div>
          {items?.length > 0 && <button onClick={limpiar} className="rounded-md border border-rose-200 px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40">Vaciar historial</button>}
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {!items ? <p className="text-sm text-slate-500">Cargando…</p> : !items.length ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-ink-line">Aún no hay cálculos guardados.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-ink-line dark:bg-ink-2">
            <table className="min-w-full text-sm">
              <thead><tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-600 dark:border-ink-line dark:text-slate-300">
                {["#", "Fecha", "Modelo", "Nudos", "Elem.", "M máx.", "V máx.", "Desplaz. máx.", ""].map((c) => <th key={c} className="px-3 py-2 font-semibold">{c}</th>)}
              </tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-ink-line dark:hover:bg-ink-3">
                    <td className="px-3 py-2 tabular-nums text-slate-500">{it.id}</td>
                    <td className="px-3 py-2 tabular-nums">{it.fecha}</td>
                    <td className="px-3 py-2 font-medium">{it.nombre}</td>
                    <td className="px-3 py-2 tabular-nums">{it.modelo?.nudos?.length ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{it.modelo?.elementos?.length ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{f(it.resumen?.Mmax)}</td>
                    <td className="px-3 py-2 tabular-nums">{f(it.resumen?.Vmax)}</td>
                    <td className="px-3 py-2 tabular-nums">{f(it.resumen?.umax, 5)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button onClick={() => abrir(it.id)} className="rounded-md bg-teal px-3 py-1 text-xs font-semibold text-white hover:bg-teal-dark">Abrir</button>
                      <button onClick={() => borrar(it)} className="ml-1 rounded-md px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40" aria-label={`Borrar cálculo ${it.id}`}>Borrar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const f = (v, d = 3) => (v == null || Number.isNaN(+v) ? "—" : Math.abs(+v) < 1e-12 ? "0" : (+v).toFixed(d));
