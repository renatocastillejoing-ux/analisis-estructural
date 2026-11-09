import { useMemo, useState } from "react";

const TIPOS = [
  { id: "M", label: "DMF", titulo: "Momento flector" },
  { id: "V", label: "DFC", titulo: "Fuerza cortante" },
  { id: "N", label: "DFN", titulo: "Fuerza normal" },
];

export default function Results({ resultado, error, onVolver }) {
  const [tipo, setTipo] = useState("M");

  if (error) {
    return (
      <div className="m-auto max-w-lg space-y-3 rounded-xl border border-rose-300 bg-rose-50 p-6 text-sm dark:border-rose-800 dark:bg-rose-950/40">
        <h2 className="font-semibold text-rose-700 dark:text-rose-300">No se pudo calcular</h2>
        <p className="text-rose-700 dark:text-rose-200">{error}</p>
        <button onClick={onVolver} className="rounded-md bg-teal px-3 py-1.5 text-white">Volver al modelo</button>
      </div>
    );
  }
  if (!resultado) {
    return (
      <div className="m-auto text-center text-slate-600 dark:text-slate-300">
        <p className="font-semibold">Aún no hay resultados.</p>
        <p className="mt-1 text-sm">Pulsa <strong>Calcular</strong> o Ctrl+Enter.</p>
        <button onClick={onVolver} className="mt-4 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-ink-line">Ir al modelo</button>
      </div>
    );
  }

  const r = resultado.resumen || {};
  const kpis = [
    ["Momento máx.", `${fmt(r.Mmax)}`, "tonf·m"],
    ["Cortante máx.", `${fmt(r.Vmax)}`, "tonf"],
    ["Normal máx.", `${fmt(r.Nmax)}`, "tonf"],
    ["Desplaz. máx.", `${fmt(r.umax, 6)}`, "m"],
  ];

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Resultados · {resultado.nombre || "Estructura"}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">{r.n_gdl} GDL · κ = {fmt(r.cond_Kff, 0, true)}</p>
        </div>
        <button onClick={onVolver} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-ink-line">← Editar modelo</button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(([label, valor, unidad]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-ink-line dark:bg-ink-2">
            <div className="text-xs text-slate-600 dark:text-slate-300">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{valor} <span className="text-sm font-normal text-slate-500 dark:text-slate-300">{unidad}</span></div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-ink-line dark:bg-ink-2">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Diagramas de fuerzas internas</h2>
          <div className="flex gap-1 rounded-full bg-slate-100 p-1 dark:bg-ink-3">
            {TIPOS.map((t) => (
              <button key={t.id} onClick={() => setTipo(t.id)}
                className={`rounded-full px-3 py-1 text-sm ${tipo === t.id ? "bg-white font-semibold text-teal-dark shadow dark:bg-ink-line dark:text-teal-soft" : "text-slate-600 dark:text-slate-300"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <Diagrama elementos={resultado.diagramas?.elementos || []} tipo={tipo} />
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{TIPOS.find((t) => t.id === tipo).titulo}. Positivo hacia el lado perpendicular a la barra.</p>
      </section>

      <Tabla titulo="Desplazamientos y giros" cols={["Nudo", "ux (m)", "uy (m)", "giro (rad)"]}
        filas={(resultado.desplazamientos || []).map((d) => [d.nudo, fmt(d.ux, 6), fmt(d.uy, 6), fmt(d.giro, 6)])} />
      <Tabla titulo="Reacciones" cols={["Nudo", "Rx (tonf)", "Ry (tonf)", "M (tonf·m)"]}
        filas={(resultado.reacciones || []).map((x) => [x.nudo, fmt(x.Rx), fmt(x.Ry), fmt(x.M)])} />
      <Tabla titulo="Fuerzas en extremos de elemento" cols={["Elem.", "N_i", "V_i", "M_i", "N_j", "V_j", "M_j"]}
        filas={(resultado.fuerzas || []).map((f) => [f.elem, fmt(f.Ni), fmt(f.Vi), fmt(f.Mi), fmt(f.Nj), fmt(f.Vj), fmt(f.Mj)])} />
    </div>
  );
}

// Dibuja el diagrama en SVG: cada barra se desplaza perpendicularmente según su valor.
function Diagrama({ elementos, tipo }) {
  const W = 900, H = 420, M = 60;
  const geom = useMemo(() => {
    if (!elementos.length) return null;
    const xs = elementos.flatMap((e) => [e.xi, e.xj]), ys = elementos.flatMap((e) => [e.yi, e.yj]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const escala = Math.min((W - 2 * M) / ((maxX - minX) || 1), (H - 2 * M) / ((maxY - minY) || 1));
    const ox = (W - (maxX - minX) * escala) / 2 - minX * escala, oy = (H - (maxY - minY) * escala) / 2 + maxY * escala;
    const vmax = Math.max(1e-9, ...elementos.flatMap((e) => (e[tipo] || []).map((v) => Math.abs(v))));
    return { X: (x) => ox + x * escala, Y: (y) => oy - y * escala, vmax, escala };
  }, [elementos, tipo]);

  if (!geom) return <p className="text-sm text-slate-500">Sin datos de diagrama.</p>;
  const { X, Y, vmax } = geom;
  const alto = 70; // px del máximo

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {elementos.map((e) => {
        const vals = e[tipo] || [], n = vals.length;
        if (!n) return null;
        const L = Math.hypot(e.xj - e.xi, e.yj - e.yi) || 1;
        const px = -(e.yj - e.yi) / L, py = (e.xj - e.xi) / L; // normal unitario (modelo)
        const pts = vals.map((v, k) => {
          const t = k / (n - 1);
          const x = e.xi + (e.xj - e.xi) * t, y = e.yi + (e.yj - e.yi) * t;
          const o = (v / vmax) * (alto / geom.escala);
          return [X(x + px * o), Y(y + py * o)];
        });
        const base = vals.map((_, k) => {
          const t = k / (n - 1);
          return [X(e.xi + (e.xj - e.xi) * t), Y(e.yi + (e.yj - e.yi) * t)];
        });
        const poly = [...base, ...pts.slice().reverse()].map((p) => p.join(",")).join(" ");
        const line = pts.map((p) => p.join(",")).join(" ");
        const extremos = [0, n - 1].map((k) => ({ k, v: vals[k], p: pts[k] }));
        return (
          <g key={e.elem}>
            <polygon points={poly} className="fill-teal/25 dark:fill-teal-soft/25" />
            <polyline points={line} fill="none" className="stroke-teal dark:stroke-teal-soft" strokeWidth={2} />
            <line x1={X(e.xi)} y1={Y(e.yi)} x2={X(e.xj)} y2={Y(e.yj)} className="stroke-slate-700 dark:stroke-slate-200" strokeWidth={2.5} />
            {extremos.map(({ k, v, p }) => (
              <text key={k} x={p[0]} y={p[1] - 4} textAnchor="middle" className="fill-slate-800 text-[10px] font-semibold tabular-nums dark:fill-slate-100">
                {Number(v).toFixed(2)}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function Tabla({ titulo, cols, filas }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-ink-line dark:bg-ink-2">
      <h2 className="mb-3 font-semibold">{titulo}</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-600 dark:border-ink-line dark:text-slate-300">
              {cols.map((c) => <th key={c} className="px-2 py-2 font-semibold">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} className="border-b border-slate-100 last:border-0 dark:border-ink-line">
                {f.map((c, j) => <td key={j} className="px-2 py-1.5 tabular-nums text-slate-800 dark:text-slate-100">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function fmt(v, dec = 3, entero = false) {
  if (v === undefined || v === null || Number.isNaN(+v)) return "—";
  const x = +v;
  if (entero) return x.toExponential(1);
  return Math.abs(x) < 1e-12 ? "0" : x.toFixed(dec);
}
