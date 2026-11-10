import { useMemo, useState } from "react";
import { Diagrama } from "./Paso.jsx";
import { propsSeccion } from "../model.js";

const TIPOS = [
  { id: "M", label: "DMF", titulo: "Momento flector, del lado traccionado" },
  { id: "V", label: "DFC", titulo: "Fuerza cortante" },
  { id: "N", label: "DFN", titulo: "Fuerza normal (positivo = tracción)" },
  { id: "def", label: "Deformada", titulo: "Deformada amplificada" },
];

export default function Results({ resultado, error, onVolver, combos, onExportar, modelo }) {
  const [tipo, setTipo] = useState("M");
  const [seccion, setSeccion] = useState("simple");

  if (error) {
    return (
      <div className="m-auto max-w-lg space-y-3 rounded-xl border border-rose-300 bg-rose-50 p-6 text-sm dark:border-rose-800 dark:bg-rose-950/40">
        <h2 className="font-semibold text-rose-700 dark:text-rose-300">No se pudo calcular</h2>
        <p className="text-rose-700 dark:text-rose-200">{error}</p>
        <button onClick={onVolver} className="rounded-md bg-teal px-3 py-1.5 text-white">Volver al modelo</button>
      </div>
    );
  }
  if (!resultado && !combos) {
    return (
      <div className="m-auto text-center text-slate-600 dark:text-slate-300">
        <p className="font-semibold">Aún no hay resultados.</p>
        <p className="mt-1 text-sm">Pulsa <strong>Calcular estructura</strong> o Ctrl+Enter.</p>
        <button onClick={onVolver} className="mt-4 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-ink-line">Ir al modelo</button>
      </div>
    );
  }
  const verCombos = !!combos && (seccion === "combos" || !resultado);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-lg font-semibold">Resultados · {(resultado || {}).nombre || "Estructura"}</h1>
            {resultado && !verCombos && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {resultado.resumen?.n_gdl} grados de libertad ({resultado.resumen?.n_libres} libres) · número de condición de K = {fmt(resultado.resumen?.cond_Kff, 0, true)}{" "}
                <span title="Mide qué tan sensible es la solución a errores de redondeo; por debajo de 1e12 es confiable." className="cursor-help">ⓘ</span>
              </p>
            )}
          </div>
          {resultado && combos && (
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm dark:bg-ink-3">
              {[["simple", "Análisis"], ["combos", "Combinaciones"]].map(([k, l]) => (
                <button key={k} onClick={() => setSeccion(k)} className={`rounded-md px-3 py-1 ${(k === "combos") === verCombos ? "bg-white font-semibold shadow dark:bg-ink-line" : ""}`}>{l}</button>
              ))}
            </div>
          )}
          {resultado && !verCombos && (<>
            <button onClick={() => onExportar("csv")} className={btnS}>CSV</button>
            <button onClick={() => onExportar("memoria")} className={btnS}>Memoria .txt</button>
            <button onClick={() => window.print()} className={btnS}>Imprimir</button>
          </>)}
          <button onClick={onVolver} className={btnS}>← Editar modelo</button>
        </div>

        {verCombos ? <Combinaciones data={combos} /> : <Simple resultado={resultado} tipo={tipo} setTipo={setTipo} />}
        {!verCombos && resultado && modelo && <Diseno2D resultado={resultado} modelo={modelo} />}
      </div>
    </div>
  );
}

const btnS = "rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-ink-line dark:hover:bg-ink-3";
const caja = "rounded-xl border border-slate-200 bg-white p-4 dark:border-ink-line dark:bg-ink-2";

function Simple({ resultado, tipo, setTipo }) {
  const r = resultado.resumen || {};
  const kpis = [
    ["Momento máx.", fmt(r.Mmax), "tonf·m"],
    ["Cortante máx.", fmt(r.Vmax), "tonf"],
    ["Normal máx.", fmt(r.Nmax), "tonf"],
    ["Desplaz. máx.", fmtChico(r.umax), "m"],
  ];
  const diag = resultado.diagramas || {};
  return (
    <>
      {(r.cond_warning || r.cond_msg) && <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{r.cond_warning || r.cond_msg}</div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(([label, valor, unidad]) => (
          <div key={label} className={caja}>
            <div className="text-xs text-slate-600 dark:text-slate-300">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{valor} <span className="text-sm font-normal text-slate-500 dark:text-slate-300">{unidad}</span></div>
          </div>
        ))}
      </div>

      <section className={caja}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Diagramas</h2>
          <div className="flex gap-1 rounded-full bg-slate-100 p-1 dark:bg-ink-3" role="tablist">
            {TIPOS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tipo === t.id} onClick={() => setTipo(t.id)}
                className={`rounded-full px-3 py-1 text-sm ${tipo === t.id ? "bg-white font-semibold text-teal-dark shadow dark:bg-ink-line dark:text-teal-soft" : "text-slate-600 dark:text-slate-300"}`}>{t.label}</button>
            ))}
          </div>
        </div>
        {tipo === "def"
          ? <DeformadaRes diag={diag} />
          : <Diagrama key={tipo} elementos={diag.elementos || []} nudos={diag.nudos || []} tipo={tipo} animado />}
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{TIPOS.find((t) => t.id === tipo).titulo}.{tipo !== "def" && " Positivos en verde azulado, negativos en rojo."}</p>
      </section>

      <Equilibrio eq={resultado.equilibrio} porElem={resultado.equilibrio_elem} />
      {resultado.modal && <Modal modal={resultado.modal} />}

      <Tabla titulo="Desplazamientos y giros" cols={["Nudo", "ux (m)", "uy (m)", "giro (rad)"]}
        filas={(resultado.desplazamientos || []).map((d) => [d.nudo, fmtChico(d.ux), fmtChico(d.uy), fmtChico(d.giro)])} />
      <Tabla titulo="Reacciones" cols={["Nudo", "Rx (tonf)", "Ry (tonf)", "M (tonf·m)"]}
        filas={(resultado.reacciones || []).map((x) => [x.nudo, fmt(x.Rx), fmt(x.Ry), fmt(x.M)])} />
      <Tabla titulo="Fuerzas en extremos de elemento" cols={["Elem.", "N i", "V i", "M i", "N j", "V j", "M j"]}
        filas={(resultado.fuerzas || []).map((f) => [f.elem, fmt(f.Ni), fmt(f.Vi), fmt(f.Mi), fmt(f.Nj), fmt(f.Vj), fmt(f.Mj)])} />

      {resultado.reporte && (
        <details className={caja}>
          <summary className="cursor-pointer font-semibold">Memoria de cálculo</summary>
          <pre className="mt-3 max-h-[60vh] overflow-auto whitespace-pre text-xs leading-relaxed">{resultado.reporte}</pre>
        </details>
      )}
    </>
  );
}

function DeformadaRes({ diag }) {
  const els = diag.elementos || [];
  const W = 900, H = 440, M = 90;
  const [esc, setEsc] = useState(1);
  const g = useMemo(() => {
    if (!els.length) return null;
    const xs = els.flatMap((e) => [e.xi, e.xj]), ys = els.flatMap((e) => [e.yi, e.yj]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const sx = maxX - minX || 1, sy = maxY - minY || 1, s = Math.min((W - 2 * M) / sx, (H - 2 * M) / sy);
    const ox = (W - sx * s) / 2 - minX * s, oy = (H - sy * s) / 2 + maxY * s;
    const dmax = Math.max(1e-12, ...els.flatMap((e) => (e.defx || []).map((v, k) => Math.hypot(v, e.defy?.[k] || 0))));
    return { X: (x) => ox + x * s, Y: (y) => oy - y * s, f: (0.08 * Math.max(sx, sy)) / dmax };
  }, [els]);
  if (!g) return <p className="text-sm text-slate-500">Sin datos.</p>;
  const f = g.f * esc;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-auto max-h-[460px] w-full">
        {els.map((e, k) => <line key={k} x1={g.X(e.xi)} y1={g.Y(e.yi)} x2={g.X(e.xj)} y2={g.Y(e.yj)} className="stroke-slate-300 dark:stroke-ink-line" strokeWidth={3} />)}
        {els.map((e, k) => {
          const n = e.s.length, L = e.s[n - 1] || 1;
          return <polyline key={`d${k}`} fill="none" stroke="#E11D48" strokeWidth={2.2}
            points={e.s.map((s, q) => `${g.X(e.xi + (e.xj - e.xi) * s / L + e.defx[q] * f)},${g.Y(e.yi + (e.yj - e.yi) * s / L + e.defy[q] * f)}`).join(" ")} />;
        })}
      </svg>
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        Amplificación ×{f.toExponential(1)}
        <input type="range" min={0.2} max={3} step={0.1} value={esc} onChange={(e) => setEsc(+e.target.value)} className="w-40 accent-teal-600" aria-label="Amplificación de la deformada" />
      </label>
    </div>
  );
}

function Equilibrio({ eq, porElem }) {
  if (!eq) return null;
  const ok = [eq.residuo_Fx, eq.residuo_Fy, eq.residuo_M].every((v) => Math.abs(v || 0) < 1e-3);
  const malos = (porElem || []).filter((e) => !e.ok);
  const fila = (t, ap, re, res) => (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-ink-line">
      <div className="mb-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">{t}</div>
      <div className="flex justify-between text-sm"><span>Cargas aplicadas</span><span className="tabular-nums">{fmt(ap)}</span></div>
      <div className="flex justify-between text-sm"><span>Reacciones</span><span className="tabular-nums">{fmt(re)}</span></div>
      <div className="flex justify-between text-sm font-semibold"><span>Residuo</span><span className="tabular-nums">{(+res || 0).toExponential(1)}</span></div>
    </div>
  );
  return (
    <section className={caja}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">Verificación de equilibrio</h2>
        <span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${ok ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"}`}>
          {ok ? "Σ = 0 ✓ equilibrio global verificado" : "⚠ Σ ≠ 0: revisar el modelo"}
        </span>
        {porElem && <span className="text-xs text-slate-600 dark:text-slate-300">{malos.length ? `${malos.length} barras no cierran: ${malos.map((e) => e.elem).join(", ")}` : `Las ${porElem.length} barras cierran su equilibrio local.`}</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {fila("Fuerza horizontal ΣFx", eq.sumFx_aplicado, eq.sumFx_reaccion, eq.residuo_Fx)}
        {fila("Fuerza vertical ΣFy", eq.sumFy_aplicado, eq.sumFy_reaccion, eq.residuo_Fy)}
        {fila("Momento ΣM (origen)", eq.sumM_aplicado, eq.sumM_reaccion, eq.residuo_M)}
      </div>
    </section>
  );
}

function Modal({ modal }) {
  if (modal.error) return <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Análisis modal: {modal.error}</div>;
  return <Tabla titulo="Análisis modal" cols={["Modo", "Periodo T (s)", "Frecuencia (Hz)", "ω (rad/s)"]}
    filas={(modal.modos || []).map((m) => [m.modo, fmt(m.periodo_s, 4), fmt(m.frecuencia_hz, 3), fmt(m.omega, 3)])} />;
}

function Combinaciones({ data }) {
  const [tipo, setTipo] = useState("M");
  const r = data.resumen;
  const els = data.envolvente.elementos;
  const rango = (o) => `${fmt(o.min)} / ${fmt(o.max)}`;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["|M| máx. envolvente", fmt(r.Mmax), "tonf·m"], ["|V| máx. envolvente", fmt(r.Vmax), "tonf"], ["|N| máx. envolvente", fmt(r.Nmax), "tonf"], ["Casos · combinaciones", `${r.n_casos} · ${r.n_combinaciones}`, ""]].map(([l, v, u]) => (
          <div key={l} className={caja}>
            <div className="text-xs text-slate-600 dark:text-slate-300">{l}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{v} <span className="text-sm font-normal text-slate-500">{u}</span></div>
          </div>
        ))}
      </div>
      <section className={caja}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Envolvente (máximos y mínimos de todas las combinaciones)</h2>
          <div className="flex gap-1 rounded-full bg-slate-100 p-1 dark:bg-ink-3">
            {["M", "V", "N"].map((t) => <button key={t} onClick={() => setTipo(t)} className={`rounded-full px-3 py-1 text-sm ${tipo === t ? "bg-white font-semibold shadow dark:bg-ink-line" : ""}`}>{{ M: "DMF", V: "DFC", N: "DFN" }[t]}</button>)}
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div><div className="text-xs font-semibold uppercase text-slate-500">Máximos</div><Diagrama key={`max${tipo}`} elementos={els.map((e) => ({ ...e, [tipo]: e[`${tipo}max`] }))} nudos={data.envolvente.nudos} tipo={tipo} animado /></div>
          <div><div className="text-xs font-semibold uppercase text-slate-500">Mínimos</div><Diagrama key={`min${tipo}`} elementos={els.map((e) => ({ ...e, [tipo]: e[`${tipo}min`] }))} nudos={data.envolvente.nudos} tipo={tipo} animado /></div>
        </div>
      </section>
      <Tabla titulo="Máximos por combinación" cols={["Combinación", "|M| máx.", "|V| máx.", "|N| máx."]}
        filas={data.combinaciones.map((c) => [c.nombre, fmt(c.Mmax), fmt(c.Vmax), fmt(c.Nmax)])} />
      <Tabla titulo="Reacciones envolventes (mín. / máx.)" cols={["Nudo", "Rx", "Ry", "M"]}
        filas={(data.reacciones_envolvente || []).map((x) => [x.nudo, rango(x.Rx), rango(x.Ry), rango(x.M)])} />
    </>
  );
}

function Tabla({ titulo, cols, filas }) {
  return (
    <section className={caja}>
      <h2 className="mb-3 font-semibold">{titulo}</h2>
      <div className="max-h-[420px] overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-white dark:bg-ink-2">
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
  const s = x.toFixed(dec);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

function fmtChico(v) {
  if (v === undefined || v === null || Number.isNaN(+v)) return "—";
  const x = Math.abs(+v);
  if (x < 1e-14) return "0";
  return x < 1e-3 ? (+v).toExponential(3) : fmt(v, 5);
}

// Diseño E.060 de las barras del pórtico con los diagramas del cálculo.
function Diseno2D({ resultado, modelo }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const disenar = async () => {
    const secs = Object.fromEntries(modelo.secciones.map((s) => [s.nombre, s]));
    const mats = Object.fromEntries((modelo.materiales || []).map((m) => [m.nombre, m]));
    const fcDef = modelo.material?.modo === "fc" ? +modelo.material.fc : 210;
    const porNombre = Object.fromEntries(modelo.elementos.map((e) => [e.nombre, e]));
    const nud = Object.fromEntries(modelo.nudos.map((n) => [n.id, n]));
    const elementos = (resultado.diagramas?.elementos || []).map((d) => {
      const e = porNombre[d.elem]; if (!e) return null;
      const s = secs[e.seccion]; if (!s) return null;
      const p = propsSeccion(s);
      const b = (s.modo || "rect") === "rect" ? +s.b : p.A / (p.h || 1);
      const vertical = Math.abs(nud[e.i].x - nud[e.j].x) < 1e-6;
      const mat = mats[e.material];
      return { nombre: e.nombre, tipo: vertical ? "columna" : "viga", b, h: p.h, fc: mat?.modo === "fc" ? +mat.fc : fcDef, M: d.M, V: d.V, N: d.N };
    }).filter(Boolean);
    setCargando(true); setError("");
    try {
      const r = await fetch("/api/diseno", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ elementos }) }).then((x) => x.json());
      if (r.ok === false) setError(r.error); else setData(r.diseno);
    } catch (e) { setError(String(e)); } finally { setCargando(false); }
  };
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-ink-line dark:bg-ink-2">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">Diseño en concreto armado (E.060)</h2>
        <button onClick={disenar} disabled={cargando} className="rounded-md bg-teal px-3 py-1 text-sm font-semibold text-white disabled:opacity-60">{cargando ? "Diseñando…" : data ? "Volver a diseñar" : "Diseñar barras"}</button>
        <span className="text-xs text-slate-500">Con los diagramas de este cálculo · f'y = 4200 kgf/cm² · d' = 6 cm. Si el modelo usa combinaciones, calcula primero con las cargas ya factoradas.</span>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {data && (
        <div className="max-h-96 overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-white dark:bg-ink-2"><tr className="border-b border-slate-200 text-left uppercase text-slate-500 dark:border-ink-line">{["Barra", "b × h", "Estado", "Flexión", "Cortante", "Observación"].map((c) => <th key={c} className="px-2 py-1.5">{c}</th>)}</tr></thead>
            <tbody>{data.map((x) => (
              <tr key={x.nombre} className="border-b border-slate-100 dark:border-ink-line">
                <td className="px-2 py-1 font-medium">{x.nombre}</td>
                <td className="px-2 py-1 tabular-nums">{fmt(x.b, 2)} × {fmt(x.h, 2)}</td>
                <td className={`px-2 py-1 font-semibold ${x.estado === "cumple" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{x.estado}</td>
                <td className="px-2 py-1 tabular-nums">{x.tipo === "viga" ? `M− ${x.Mu_sup ?? 0} t·m → ${x.As_sup ?? "—"} cm² (${x.barras_sup}) · M+ ${x.Mu_inf ?? 0} → ${x.As_inf ?? "—"} cm² (${x.barras_inf})` : `Pu ${x.Pu} t · Mu ${x.Mux} t·m → ρ ${x.rho ?? "—"} % (${x.barras})`}</td>
                <td className="px-2 py-1">{x.estribos}{x.tipo === "viga" ? ` · φVc ${x.phiVc} t` : ""}</td>
                <td className="px-2 py-1 text-slate-500">{(x.avisos || []).join(" · ")}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
