import { useEffect, useState } from "react";
import Paso, { Diagrama } from "./Paso.jsx";
import { extraerPortico } from "../api.js";
import { porticosDe } from "../model3d.js";

const caja = "rounded-xl border border-slate-200 bg-white p-4 dark:border-ink-line dark:bg-ink-2";
const f = (v, d = 3) => (v == null || Number.isNaN(+v) ? "—" : Math.abs(+v) < 5e-4 ? "0" : (+v).toFixed(d));

// Esfuerzos de un pórtico tomados del análisis 3D, sin salir del modelo.
export default function PorticoDe3D({ modelo, res, caso, onPaso, onAbrir2d }) {
  const lista = porticosDe(modelo);
  const [k, setK] = useState(0);
  const [tipo, setTipo] = useState("M");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const p = lista[k];

  useEffect(() => {
    if (!p || !res?.id_calculo) return;
    let vivo = true;
    setData(null); setError("");
    fetch("/api/calcular3d/portico", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id_calculo: res.id_calculo, caso, eje: p.eje, valor: p.c }) })
      .then((r) => r.json()).then((d) => { if (!vivo) return; if (d.ok === false) setError(d.error); else setData(d); })
      .catch((e) => vivo && setError(String(e)));
    return () => { vivo = false; };
  }, [p?.eje, p?.c, caso, res?.id_calculo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lista.length) return <p className="text-sm text-slate-500">El modelo no tiene ejes definidos (Definir › Ejes y niveles).</p>;
  const els = data?.elementos || [];
  const fuera = els.filter((e) => e.fuera_plano > 1e-3).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="inp" value={k} onChange={(e) => setK(+e.target.value)} aria-label="Pórtico">
          {lista.map((x, i) => <option key={i} value={i}>{x.nombre} · {x.det}</option>)}
        </select>
        <div className="flex gap-1 rounded-full bg-white p-1 dark:bg-ink-2">
          {[["M", "DMF"], ["V", "DFC"], ["N", "DFN"]].map(([t, l]) => <button key={t} onClick={() => setTipo(t)} className={`rounded-full px-3 py-0.5 text-sm ${tipo === t ? "bg-teal font-semibold text-white" : ""}`}>{l}</button>)}
        </div>
        <span className="text-xs text-slate-500">Caso: <b>{caso}</b> (cámbialo a la izquierda)</span>
        <div className="ml-auto flex gap-1">
          <button onClick={() => onPaso(p.eje, p.c)} className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100 dark:border-ink-line dark:hover:bg-ink-3">Paso a paso de este pórtico</button>
          <button onClick={() => onAbrir2d(p.eje, p.c)} className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100 dark:border-ink-line dark:hover:bg-ink-3">Abrir como documento 2D</button>
        </div>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-500">Leyendo los esfuerzos del pórtico…</p>}
      {data && (
        <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
          <section className={caja}>
            {els.length ? <Diagrama key={`${k}${tipo}${caso}`} elementos={els} nudos={[]} tipo={tipo} animado H={360} /> : <p className="text-sm text-slate-500">Ninguna barra está en el plano de este eje.</p>}
            <p className="mt-1 text-xs text-slate-500">Esfuerzos del análisis 3D en el plano del pórtico (la losa, el diafragma y los pórticos transversales ya están incluidos).{fuera > 0 && ` ${fuera} barras también trabajan fuera del plano.`}</p>
          </section>
          <section className={caja}>
            <h3 className="mb-2 text-sm font-semibold">Extremos de las barras</h3>
            <div className="max-h-80 overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-white dark:bg-ink-2"><tr className="border-b border-slate-200 text-left uppercase text-slate-500 dark:border-ink-line">{["Barra", "N i", "V i", "M i", "M j", "|M| máx."].map((c) => <th key={c} className="px-2 py-1">{c}</th>)}</tr></thead>
                <tbody>{els.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 dark:border-ink-line">
                    <td className="px-2 py-1 font-medium">{e.elem}</td><td className="px-2 py-1 tabular-nums">{f(e.N[0], 2)}</td><td className="px-2 py-1 tabular-nums">{f(e.V[0], 2)}</td>
                    <td className="px-2 py-1 tabular-nums">{f(e.M[0], 2)}</td><td className="px-2 py-1 tabular-nums">{f(e.M[e.M.length - 1], 2)}</td><td className="px-2 py-1 font-semibold tabular-nums">{f(Math.max(...e.M.map(Math.abs)), 2)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// Paso a paso del método [A] para un pórtico del modelo 3D, sin salir del modelo.
export function PasoPortico3D({ modelo, inicial, onVolver }) {
  const lista = porticosDe(modelo);
  const idx0 = Math.max(0, lista.findIndex((x) => inicial && x.eje === inicial.eje && Math.abs(x.c - inicial.c) < 1e-6));
  const [k, setK] = useState(idx0);
  const [fac, setFac] = useState("1.4CM+1.7CV");
  const [m2, setM2] = useState(null);
  const [error, setError] = useState("");
  const op = { "1.4CM+1.7CV": { CM: 1.4, CV: 1.7 }, CM: { CM: 1 }, CV: { CV: 1 }, "CM+CV": { CM: 1, CV: 1 } };
  const p = lista[k];
  useEffect(() => {
    if (!p) return;
    let vivo = true;
    setM2(null); setError("");
    extraerPortico(modelo, p.eje, p.c, op[fac]).then(({ ok, data }) => {
      if (!vivo) return;
      if (!ok || data.ok === false) setError(data.error || "No se pudo extraer el pórtico."); else setM2({ despreciar_axial: true, ...data });
    });
    return () => { vivo = false; };
  }, [k, fac, modelo]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!lista.length) return <p className="m-auto text-sm text-slate-500">El modelo no tiene ejes definidos.</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-6 py-2 text-sm dark:border-ink-line dark:bg-ink-2">
        <span className="font-semibold">Pórtico del modelo 3D:</span>
        <select className="inp" value={k} onChange={(e) => setK(+e.target.value)}>{lista.map((x, i) => <option key={i} value={i}>{x.nombre} · {x.det}</option>)}</select>
        <span>Cargas</span>
        <select className="inp" value={fac} onChange={(e) => setFac(e.target.value)}>{Object.keys(op).map((x) => <option key={x}>{x}</option>)}</select>
        <span className="text-xs text-slate-500">La losa se reparte igual que en el 3D. El modelo 3D no se modifica.</span>
      </div>
      {error && <p className="m-6 text-sm text-rose-600">{error}</p>}
      {!m2 && !error && <p className="m-auto text-sm text-slate-500">Preparando el pórtico…</p>}
      {m2 && <Paso modelo={m2} onVolver={onVolver} />}
    </div>
  );
}
