import { lazy, Suspense, useMemo, useState } from "react";
import { escena3d } from "../model3d.js";
import PorticoDe3D from "./PorticoDe3D.jsx";

const Visor3D = lazy(() => import("./Visor3D.jsx"));
const caja = "rounded-xl border border-slate-200 bg-white p-4 dark:border-ink-line dark:bg-ink-2";
const f = (v, d = 3) => (v == null || Number.isNaN(+v) ? "—" : Math.abs(+v) < 1e-12 ? "0" : (+v).toFixed(d));
const chico = (v) => (Math.abs(+v) < 1e-14 ? "0" : Math.abs(+v) < 1e-3 ? (+v).toExponential(3) : (+v).toFixed(5));

export default function Results3D({ modelo, res, error, onVolver, onExtraer, onPaso }) {
  const [caso, setCaso] = useState(() => res?.casos?.find((c) => c.startsWith("1.4")) || res?.casos?.[0]);
  const [modo, setModo] = useState("deformada");
  const [escala, setEscala] = useState(1);
  const [pestaña, setPestaña] = useState("resumen");
  const [elegido, setElegido] = useState(null);
  const escena = useMemo(() => (res ? escena3d(modelo, { resultado: res, caso, modo, escala, sel: elegido ? { tipo: "elemento", id: elegido } : null }) : null), [modelo, res, caso, modo, escala, elegido]);

  if (error) return (
    <div className="m-auto max-w-lg space-y-3 rounded-xl border border-rose-300 bg-rose-50 p-6 text-sm dark:border-rose-800 dark:bg-rose-950/40">
      <h2 className="font-semibold text-rose-700 dark:text-rose-300">No se pudo calcular el modelo 3D</h2><p>{error}</p>
      <button onClick={onVolver} className="rounded-md bg-teal px-3 py-1.5 text-white">Volver al modelo</button>
    </div>
  );
  if (!res) return (
    <div className="m-auto text-center text-slate-600 dark:text-slate-300">
      <p className="font-semibold">Aún no hay resultados del modelo 3D.</p>
      <p className="mt-1 text-sm">Pulsa <b>Calcular estructura</b> o Ctrl+Enter.</p>
      <button onClick={onVolver} className="mt-4 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-ink-line">Ir al modelo</button>
    </div>
  );

  const r = res.resumen;
  const idx = Object.fromEntries(res.elementos.map((e, k) => [e.id, k]));
  const b = res.barras[caso];
  const det = elegido != null ? { e: res.elementos[idx[elegido]], N: b.N[idx[elegido]], V: b.V[idx[elegido]], M: b.M[idx[elegido]], Mz: b.Mz[idx[elegido]], My: b.My[idx[elegido]], T: b.T[idx[elegido]] } : null;
  const max = (k) => Math.max(...b[k].map(Math.abs));
  const dmax = Math.max(...res.desp[caso].map((d) => Math.hypot(...d)));

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-200 bg-white p-4 text-sm dark:border-ink-line dark:bg-ink-2">
        <div>
          <h2 className="font-semibold">Resultados 3D</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{r.n_nudos} nudos · {r.n_elementos} barras · {r.n_resuelto} GDL resueltos{r.diafragma ? " (diafragma rígido)" : ""} · {r.t_total} s</p>
        </div>
        <label className="text-xs">Caso o combinación
          <select className="inp mt-1 w-full" value={caso} onChange={(e) => setCaso(e.target.value)}>{res.casos.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <div>
          <div className="mb-1 text-xs">Ver</div>
          <div className="grid grid-cols-2 gap-1">
            {[["geometria", "Geometría"], ["deformada", "Deformada"], ["M", "Mapa de |M|"], ["N", "Mapa de N"], ["V", "Mapa de |V|"]].map(([k, l]) => (
              <button key={k} onClick={() => setModo(k)} className={`rounded-md border px-2 py-1 text-xs ${modo === k ? "border-teal bg-teal text-white" : "border-slate-200 dark:border-ink-line"}`}>{l}</button>
            ))}
          </div>
        </div>
        {modo === "deformada" && (
          <label className="text-xs">Amplificación
            <input type="range" min={0.2} max={4} step={0.1} value={escala} onChange={(e) => setEscala(+e.target.value)} className="w-full accent-teal-600" />
          </label>
        )}
        {["M", "N", "V"].includes(modo) && (
          <div className="text-xs">
            <div className="h-2 rounded" style={{ background: modo === "N" ? "linear-gradient(90deg, hsl(220,70%,40%), hsl(220,70%,85%) 50%, hsl(0,70%,85%) 50%, hsl(0,70%,40%))" : "linear-gradient(90deg, hsl(200,75%,55%), hsl(100,75%,50%), hsl(0,75%,45%))" }} />
            <div className="mt-0.5 flex justify-between text-slate-500"><span>{modo === "N" ? `−${f(max("N"), 1)} (compresión)` : "0"}</span><span>{modo === "N" ? `+${f(max("N"), 1)} (tracción)` : f(max(modo), 2)}</span></div>
          </div>
        )}
        <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs dark:divide-ink-line dark:border-ink-line">
          {[["|M| máx.", `${f(max("M"))} t·m`], ["|V| máx.", `${f(max("V"))} t`], ["|N| máx.", `${f(max("N"))} t`], ["Desplaz. máx.", `${chico(dmax)} m`]].map(([k, v]) => <div key={k} className="flex justify-between px-3 py-1.5"><dt>{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>)}
        </dl>
        {det && (
          <div className="rounded-lg bg-amber-50 p-3 text-xs dark:bg-amber-900/20">
            <div className="mb-1 font-semibold">{det.e.nombre} · {det.e.sec} · L = {f(det.e.L, 2)} m</div>
            {[["N (+ tracción)", det.N, "t"], ["|V| máx.", det.V, "t"], ["|Mz| máx. (eje fuerte)", det.Mz, "t·m"], ["|My| máx.", det.My, "t·m"], ["Torsión", det.T, "t·m"]].map(([k, v, u]) => <div key={k} className="flex justify-between"><span>{k}</span><span className="tabular-nums">{f(v)} {u}</span></div>)}
          </div>
        )}
        <button onClick={onVolver} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-ink-line">← Editar modelo</button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-[320px] flex-[3]">
          <Suspense fallback={<div className="p-6 text-sm text-slate-500">Cargando el visor 3D…</div>}>
            <Visor3D escena={escena} ajusteKey={res} onElegir={(m) => setElegido(m ? m.id : null)} />
          </Suspense>
        </div>
        <div className="flex-[2] overflow-y-auto border-t border-slate-200 bg-slate-50 p-4 dark:border-ink-line dark:bg-ink">
          <div className="mb-3 flex gap-1" role="tablist">
            {[["resumen", "Resumen"], ["derivas", "Derivas"], ["modal", "Modos"], ["reacciones", "Reacciones"], ["porticos", "Pórtico por eje"]].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={pestaña === k} onClick={() => setPestaña(k)} className={`rounded-full px-3 py-1 text-sm ${pestaña === k ? "bg-teal font-semibold text-white" : "bg-white dark:bg-ink-2"}`}>{l}</button>
            ))}
          </div>
          {pestaña === "resumen" && <Resumen res={res} caso={caso} />}
          {pestaña === "derivas" && <Derivas res={res} />}
          {pestaña === "modal" && <Modal res={res} />}
          {pestaña === "reacciones" && <Reacciones res={res} caso={caso} />}
          {pestaña === "porticos" && <PorticoDe3D modelo={modelo} res={res} caso={caso} onPaso={onPaso} onAbrir2d={(e, c) => onExtraer(e, c, { CM: 1.4, CV: 1.7 })} />}
        </div>
      </div>
    </div>
  );
}

function Resumen({ res, caso }) {
  const ap = res.aplicado, eq = res.equilibrio;
  const filas = (res.casos_base || []).map((c) => {
    const a = ap[c] || {}, e = eq[c] || {};
    const ok = Math.abs((a.Fz || 0) + (e.Rz || 0)) < 1e-3 * Math.max(1, Math.abs(a.Fz || 0)) && Math.abs((a.Fx || 0) + (e.Rx || 0)) < 1e-3 * Math.max(1, Math.abs(a.Fx || 0)) && Math.abs((a.Fy || 0) + (e.Ry || 0)) < 1e-3 * Math.max(1, Math.abs(a.Fy || 0));
    return [c, f(a.Fx, 2), f(a.Fy, 2), f(a.Fz, 2), f(e.Rx, 2), f(e.Ry, 2), f(e.Rz, 2), ok ? "✓" : "⚠"];
  });
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className={caja}>
        <h3 className="mb-2 font-semibold">Equilibrio por caso (cargas aplicadas y reacciones)</h3>
        <Tabla cols={["Caso", "ΣFx", "ΣFy", "ΣFz", "Rx", "Ry", "Rz", ""]} filas={filas} />
      </section>
      {Object.keys(res.sismo || {}).length > 0 && (
        <section className={caja}>
          <h3 className="mb-2 font-semibold">Sismo estático E.030</h3>
          <Tabla cols={["Dirección", "T (s)", "C", "k", "V basal (t)", "R"]} filas={Object.entries(res.sismo).map(([d, s]) => [d, f(s.T), f(s.C), f(s.k), f(s.V, 1), s.R])} />
          <p className="mt-2 text-xs text-slate-500">Peso sísmico total = {f(res.resumen.pesos_nivel.reduce((a, b) => a + b, 0), 1)} t (CM + 25 % CV por nivel). Fuerzas en el centro de masas con 5 % de excentricidad accidental.</p>
        </section>
      )}
      <p className="text-xs text-slate-500 xl:col-span-2">Caso mostrado en la vista 3D: <b>{caso}</b>. Haz clic en una barra para ver sus esfuerzos.</p>
    </div>
  );
}

function Derivas({ res }) {
  const d = res.derivas || {};
  if (!d.X) return <p className="text-sm text-slate-500">Activa el sismo (Asignar › Sismo E.030) para calcular derivas.</p>;
  const n = d.X.max.length, lim = d.X.limite;
  const vmax = Math.max(lim * 1.2, ...d.X.max, ...d.Y.max);
  const W = 520, H = 30 + n * 26, x = (v) => 70 + (v / vmax) * (W - 90);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,560px)_1fr]">
      <section className={caja}>
        <h3 className="mb-2 font-semibold">Deriva inelástica por nivel (0.75·R·Δ/h)</h3>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {d.X.max.map((_, k) => {
            const y = 14 + (n - 1 - k) * 26;
            return (
              <g key={k}>
                <text x={60} y={y + 13} textAnchor="end" className="fill-slate-500 text-[11px]">Nivel {k + 1}</text>
                <rect x={70} y={y + 2} width={x(d.X.max[k]) - 70} height={9} fill={d.X.max[k] > lim ? "#E11D48" : "#508C9B"} rx={2} />
                <rect x={70} y={y + 13} width={x(d.Y.max[k]) - 70} height={9} fill={d.Y.max[k] > lim ? "#F59E0B" : "#6E9B54"} rx={2} />
              </g>
            );
          })}
          <line x1={x(lim)} y1={6} x2={x(lim)} y2={H - 4} stroke="#E11D48" strokeDasharray="5 3" />
          <text x={x(lim) + 4} y={12} className="fill-rose-600 text-[11px] font-semibold">límite {lim}</text>
        </svg>
        <p className="text-xs text-slate-500">Barra superior: X · barra inferior: Y. En color de alerta, los niveles que superan el límite.</p>
      </section>
      <section className={caja}>
        <h3 className="mb-2 font-semibold">Valores</h3>
        <Tabla cols={["Nivel", "X máx.", "X prom.", "Y máx.", "Y prom."]} filas={d.X.max.map((_, k) => [k + 1, f(d.X.max[k], 5), f(d.X.cm[k], 5), f(d.Y.max[k], 5), f(d.Y.cm[k], 5)]).reverse()} />
        <p className={`mt-2 text-sm font-semibold ${d.X.cumple && d.Y.cumple ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
          X: {d.X.cumple ? "cumple" : "no cumple"} · Y: {d.Y.cumple ? "cumple" : "no cumple"} (límite {lim})
        </p>
      </section>
    </div>
  );
}

function Modal({ res }) {
  if (!res.modal?.length) return <p className="text-sm text-slate-500">El análisis modal necesita diafragma rígido y cargas (masa) en los niveles.</p>;
  let ax = 0, ay = 0;
  return (
    <section className={caja}>
      <h3 className="mb-2 font-semibold">Modos de vibración (3 GDL por nivel: Ux, Uy, Rz)</h3>
      <Tabla cols={["Modo", "T (s)", "f (Hz)", "Masa X", "Masa Y", "Torsión", "Σ X", "Σ Y", "Tipo"]}
        filas={res.modal.map((m) => { ax += m.Mx; ay += m.My; const t = m.Mx > 0.5 * Math.max(m.Mx, m.My, m.Rz) && m.Mx >= m.My && m.Mx >= m.Rz ? "traslación X" : m.My >= m.Mx && m.My >= m.Rz ? "traslación Y" : "torsión"; return [m.modo, f(m.T, 3), f(m.f, 2), `${(m.Mx * 100).toFixed(1)} %`, `${(m.My * 100).toFixed(1)} %`, `${(m.Rz * 100).toFixed(1)} %`, `${(ax * 100).toFixed(0)} %`, `${(ay * 100).toFixed(0)} %`, t]; })} />
    </section>
  );
}

function Reacciones({ res, caso }) {
  const rs = res.reacciones?.[caso] || [];
  return (
    <section className={caja}>
      <h3 className="mb-2 font-semibold">Reacciones · {caso} ({rs.length} apoyos)</h3>
      <Tabla cols={["Nudo", "Rx", "Ry", "Rz", "Mx", "My", "Mz"]} filas={rs.map((x) => [x.nudo, ...x.R.map((v) => f(v, 2))])} />
    </section>
  );
}

function Tabla({ cols, filas }) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="min-w-full text-xs">
        <thead className="sticky top-0 bg-white dark:bg-ink-2"><tr className="border-b border-slate-200 text-left uppercase text-slate-500 dark:border-ink-line">{cols.map((c) => <th key={c} className="px-2 py-1.5 font-semibold">{c}</th>)}</tr></thead>
        <tbody>{filas.map((fl, i) => <tr key={i} className="border-b border-slate-100 last:border-0 dark:border-ink-line">{fl.map((c, j) => <td key={j} className="px-2 py-1 tabular-nums">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
