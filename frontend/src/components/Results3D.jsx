import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
  // deformada animada: la amplificación oscila entre −1 y +1
  const [animar, setAnimar] = useState(false);
  const [fase, setFase] = useState(1);
  useEffect(() => {
    if (!animar || modo !== "deformada") { setFase(1); return; }
    let t = 0; const id = setInterval(() => { t += 0.18; setFase(Math.sin(t)); }, 60);
    return () => clearInterval(id);
  }, [animar, modo]);
  // diagramas de momento dibujados sobre cada barra
  const [diag, setDiag] = useState(null);
  const [verMy, setVerMy] = useState(false);
  useEffect(() => {
    if (modo !== "dM" || !res?.id_calculo || !caso) return;
    let vivo = true; setDiag({ cargando: true });
    fetch("/api/calcular3d/diagramas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id_calculo: res.id_calculo, caso }) })
      .then((r) => r.json()).then((d) => { if (vivo) setDiag(d.ok ? d : { error: d.error }); })
      .catch(() => { if (vivo) setDiag({ error: "No hay conexión con el servidor de cálculo." }); });
    return () => { vivo = false; };
  }, [modo, res, caso]);
  const escena = useMemo(() => {
    if (!res) return null;
    const esc = escena3d(modelo, { resultado: res, caso, modo: modo === "dM" ? "geometria" : modo, escala: escala * fase, sel: elegido ? { tipo: "elemento", id: elegido } : null });
    if (modo === "dM" && diag?.barras) {
      const xs = modelo.nudos.flatMap((n) => [n.x, n.y, n.z]);
      const span = Math.max(1, Math.max(...xs) - Math.min(...xs));
      const clave = verMy ? "My" : "Mz", eje = verMy ? "ez" : "ey";
      const mmax = Math.max(1e-9, ...diag.barras.flatMap((b) => b[clave].map(Math.abs)));
      const k = (0.15 * span / mmax) * escala;
      esc.diagramas = diag.barras.map((b) => {
        const base = b.s.map((x) => b.p0.map((v, i) => v + b.e1[i] * x));
        // dibujado del lado traccionado (M positivo hacia −y local)
        const pts = base.map((q, j) => q.map((v, i) => v - b[clave][j] * k * b[eje][i]));
        return { base, pts, colores: b[clave].map((v) => (v >= 0 ? "#3b82f6" : "#f43f5e")) };
      });
      esc.miembros = esc.miembros.map((m) => ({ ...m, color: "#cbd5e1" }));
      esc.mmax = mmax;
    }
    return esc;
  }, [modelo, res, caso, modo, escala, fase, elegido, diag, verMy]);

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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      <aside className="flex max-h-[45vh] w-full shrink-0 flex-col gap-3 overflow-y-auto border-b md:max-h-none md:w-72 md:border-b-0 md:border-r border-slate-200 bg-white p-4 text-sm dark:border-ink-line dark:bg-ink-2">
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
            {[["geometria", "Geometría"], ["deformada", "Deformada"], ["dM", "Diagrama de M"], ["M", "Mapa de |M|"], ["N", "Mapa de N"], ["V", "Mapa de |V|"], ["diseno", "Diseño E.060"]].map(([k, l]) => (
              <button key={k} onClick={() => setModo(k)} className={`rounded-md border px-2 py-1 text-xs ${modo === k ? "border-teal bg-teal text-white" : "border-slate-200 dark:border-ink-line"}`}>{l}</button>
            ))}
          </div>
        </div>
        {(modo === "deformada" || modo === "dM") && (
          <label className="text-xs">{modo === "dM" ? "Tamaño del diagrama" : "Amplificación"}
            <input type="range" min={0.2} max={4} step={0.1} value={escala} onChange={(e) => setEscala(+e.target.value)} className="w-full accent-teal-600" />
          </label>
        )}
        {modo === "deformada" && (
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={animar} onChange={(e) => setAnimar(e.target.checked)} className="accent-teal-600" /> Animar la deformada</label>
        )}
        {modo === "dM" && (
          <div className="space-y-1 text-xs">
            <div className="flex rounded-md bg-slate-100 p-0.5 dark:bg-ink-3">
              {[[false, "Mz (eje fuerte)"], [true, "My (eje débil)"]].map(([v, l]) => <button key={l} onClick={() => setVerMy(v)} className={`flex-1 rounded px-2 py-0.5 ${verMy === v ? "bg-white font-semibold shadow dark:bg-ink-line" : ""}`}>{l}</button>)}
            </div>
            {diag?.cargando && <p className="text-slate-500">Calculando diagramas…</p>}
            {diag?.error && <p className="text-rose-600 dark:text-rose-400">{diag.error}</p>}
            {diag?.barras && <div className="flex items-center gap-2"><span className="inline-block h-2 w-4 rounded bg-blue-600" /> positivo <span className="inline-block h-2 w-4 rounded bg-red-600" /> negativo <span className="ml-auto text-slate-500">máx. {f(escena?.mmax, 2)} t·m</span></div>}
            <p className="text-slate-500">Se dibuja del lado traccionado de cada barra.</p>
          </div>
        )}
        {modo === "diseno" && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-block h-2 w-4 rounded bg-green-600" /> cumple <span className="inline-block h-2 w-4 rounded bg-rose-600" /> no cumple <span className="inline-block h-2 w-4 rounded bg-slate-400" /> sin diseño
          </div>
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
        {elegido != null && res.diseno && (() => {
          const x = res.diseno[idx[elegido]];
          if (!x) return null;
          return (
            <div className={`rounded-lg p-3 text-xs ${x.estado === "cumple" ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-rose-50 dark:bg-rose-900/20"}`}>
              <div className="mb-1 font-semibold">Diseño E.060 · {x.estado}</div>
              {x.tipo.startsWith("viga") ? (<>
                <div>Acero superior: {x.As_sup ?? "—"} cm² → {x.barras_sup}</div>
                <div>Acero inferior: {x.As_inf ?? "—"} cm² → {x.barras_inf}</div>
                <div>As mín. {x.As_min} · As máx. (simple) {x.As_max} cm² · d = {x.d_cm} cm</div>
                {x.doble_refuerzo && <div className="font-semibold">Doble refuerzo: el momento supera la capacidad con refuerzo simple; se agrega acero en compresión (E.060).</div>}
              </>) : (<>
                <div>Pu = {x.Pu} t · Mux = {x.Mux} · Muy = {x.Muy} t·m</div>
                <div>ρ = {x.rho ?? "—"} % → {x.barras}{x.ratio != null ? ` · uso ${x.ratio}` : ""}</div>
              </>)}
              <div>Estribos: {x.estribos}</div>
              {(x.avisos || []).map((a, k) => <div key={k} className="text-rose-700 dark:text-rose-300">{a}</div>)}
            </div>
          );
        })()}
        <button onClick={onVolver} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-ink-line">← Editar modelo</button>
      </aside>

      <div className="flex min-h-[70vh] min-w-0 flex-1 flex-col md:min-h-0">
        <div className="relative min-h-[320px] flex-[3]">
          <Suspense fallback={<div className="p-6 text-sm text-slate-500">Cargando el visor 3D…</div>}>
            <Visor3D escena={escena} ajusteKey={res} onElegir={(m) => setElegido(m && !m._nudo ? m.id : null)} nombreImagen={`resultados-${modo}-${caso}`.replace(/[^\w.-]+/g, "_")} />
          </Suspense>
        </div>
        <div className="flex-[2] overflow-y-auto border-t border-slate-200 bg-slate-50 p-4 dark:border-ink-line dark:bg-ink">
          <div className="mb-3 flex gap-1" role="tablist">
            {[["resumen", "Resumen"], ["derivas", "Derivas"], ["modal", "Modos"], ["diseno", "Diseño E.060"], ["reacciones", "Reacciones"], ["porticos", "Pórtico por eje"]].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={pestaña === k} onClick={() => setPestaña(k)} className={`rounded-full px-3 py-1 text-sm ${pestaña === k ? "bg-teal font-semibold text-white" : "bg-white dark:bg-ink-2"}`}>{l}</button>
            ))}
          </div>
          {pestaña === "resumen" && <Resumen res={res} caso={caso} />}
          {pestaña === "derivas" && <Derivas res={res} />}
          {pestaña === "modal" && <Modal res={res} />}
          {pestaña === "reacciones" && <Reacciones res={res} caso={caso} />}
          {pestaña === "diseno" && <Diseno res={res} setElegido={setElegido} />}
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
          <h3 className="mb-2 font-semibold">Sismo E.030</h3>
          <Tabla cols={["Dir.", "T (s)", "C", "C/R", "V estático (t)", "V dinámico CQC (t)", "Escala", "V de diseño (t)", "R", "Sistema (placas)"]} filas={Object.entries(res.sismo).map(([d, s]) => [d, f(s.T), f(s.C), `${f(s.C_R, 3)}${s.C_R_ok === false ? " < 0.11" : ""}`, f(s.V, 1), s.V_dinamico != null ? f(s.V_dinamico / (s.escala_dinamica || 1), 1) : "—", s.escala_dinamica != null ? f(s.escala_dinamica, 2) : "—", s.V_dinamico != null ? f(s.V_dinamico, 1) : "—", s.R,
            res.cortante_base?.[d] ? `${res.cortante_base[d].sistema} (${(res.cortante_base[d].frac_placas * 100).toFixed(0)} %) → R0 ${res.cortante_base[d].R0_sugerido}` : "—"])} />
          {Object.entries(res.cortante_base || {}).some(([d, c]) => c.R0_sugerido !== res.sismo?.[d]?.R) && <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-400">El R usado no coincide con el sistema que resulta del reparto del cortante: ajústalo en Sismo E.030 (la deriva no cambia con R; las fuerzas sí).</p>}
          <p className="mt-2 text-xs text-slate-500">Peso sísmico total = {f(res.resumen.pesos_nivel.reduce((a, b) => a + b, 0), 1)} t (CM + 25 % CV por nivel). Fuerzas en el centro de masas con 5 % de excentricidad accidental.</p>
        </section>
      )}
      <p className="text-xs text-slate-500 xl:col-span-2">Caso mostrado en la vista 3D: <b>{caso}</b>. Haz clic en una barra para ver sus esfuerzos.</p>
    </div>
  );
}

function Derivas({ res }) {
  const d = res.derivas || {};
  const din = !!d.X?.dinamico;
  const [fuente, setFuente] = useState(din ? "dinamico" : "max");
  if (!d.X) return <p className="text-sm text-slate-500">Activa el sismo (Asignar › Sismo E.030) para calcular derivas.</p>;
  const serie = (dir) => d[dir][fuente] || d[dir].max;
  const n = d.X.max.length, lim = d.X.limite;
  const vmax = Math.max(lim * 1.2, ...serie("X"), ...serie("Y"));
  const W = 520, H = 30 + n * 26, x = (v) => 70 + (v / vmax) * (W - 90);
  const cumple = (dir) => Math.max(...serie(dir)) <= lim;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,560px)_1fr]">
      <section className={caja}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">Deriva inelástica por nivel ({f(d.X.factor ?? 0.75 * (res.sismo?.X?.R || 8), 2)}·Δ/h)</h3>
          <div className="ml-auto flex gap-1 rounded-full bg-slate-100 p-0.5 text-xs dark:bg-ink-3">
            {din && <button onClick={() => setFuente("dinamico")} className={`rounded-full px-2 py-0.5 ${fuente === "dinamico" ? "bg-white font-semibold shadow dark:bg-ink-line" : ""}`}>Dinámico (CQC)</button>}
            <button onClick={() => setFuente("max")} className={`rounded-full px-2 py-0.5 ${fuente === "max" ? "bg-white font-semibold shadow dark:bg-ink-line" : ""}`}>Estático</button>
          </div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {serie("X").map((_, k) => {
            const y = 14 + (n - 1 - k) * 26;
            return (
              <g key={k}>
                <text x={60} y={y + 13} textAnchor="end" className="fill-slate-500 text-[11px]">Nivel {k + 1}</text>
                <rect x={70} y={y + 2} width={x(serie("X")[k]) - 70} height={9} fill={serie("X")[k] > lim ? "#E11D48" : "#508C9B"} rx={2} />
                <rect x={70} y={y + 13} width={x(serie("Y")[k]) - 70} height={9} fill={serie("Y")[k] > lim ? "#F59E0B" : "#6E9B54"} rx={2} />
              </g>
            );
          })}
          <line x1={x(lim)} y1={6} x2={x(lim)} y2={H - 4} stroke="#E11D48" strokeDasharray="5 3" />
          <text x={x(lim) + 4} y={12} className="fill-rose-600 text-[11px] font-semibold">límite {lim}</text>
        </svg>
        <p className="text-xs text-slate-500">Barra superior: X · barra inferior: Y. {din ? "La E.030 controla la deriva con el análisis dinámico (los desplazamientos no se escalan al cortante mínimo)." : "Activa el análisis dinámico en Sismo E.030 para la deriva espectral."}</p>
      </section>
      <section className={caja}>
        <h3 className="mb-2 font-semibold">Valores</h3>
        <Tabla cols={din ? ["Nivel", "X din.", "X est.", "Y din.", "Y est."] : ["Nivel", "X máx.", "X prom.", "Y máx.", "Y prom."]}
          filas={d.X.max.map((_, k) => din ? [k + 1, f(d.X.dinamico[k], 5), f(d.X.max[k], 5), f(d.Y.dinamico[k], 5), f(d.Y.max[k], 5)] : [k + 1, f(d.X.max[k], 5), f(d.X.cm[k], 5), f(d.Y.max[k], 5), f(d.Y.cm[k], 5)]).reverse()} />
        <p className={`mt-2 text-sm font-semibold ${cumple("X") && cumple("Y") ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
          {fuente === "dinamico" ? "Dinámico" : "Estático"} · X: {cumple("X") ? "cumple" : "no cumple"} ({f(Math.max(...serie("X")), 4)}) · Y: {cumple("Y") ? "cumple" : "no cumple"} ({f(Math.max(...serie("Y")), 4)}) · límite {lim}
        </p>
      </section>
    </div>
  );
}

function Diseno({ res, setElegido }) {
  const [filtro, setFiltro] = useState("no cumple");
  const [tipo, setTipo] = useState("todos");
  const lista = (res.diseno || []).filter((x) => (filtro === "todos" || x.estado === filtro) && (tipo === "todos" || (tipo === "vigas" ? x.tipo.startsWith("viga") : x.tipo === tipo)));
  const cuenta = (est, t) => (res.diseno || []).filter((x) => x.estado === est && (t ? (t === "vigas" ? x.tipo.startsWith("viga") : x.tipo === t) : true)).length;
  if (!res.diseno) return <p className="text-sm text-slate-500">Sin diseño (el cálculo no lo incluyó).</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[["vigas", "Vigas"], ["columna", "Columnas"], ["placa", "Placas"]].map(([t, l]) => (
          <div key={t} className={caja}>
            <div className="text-xs text-slate-500">{l}</div>
            <div className="text-lg font-semibold"><span className="text-emerald-700 dark:text-emerald-400">{cuenta("cumple", t)} ✓</span> · <span className="text-rose-600 dark:text-rose-400">{cuenta("no cumple", t)} ✗</span></div>
          </div>
        ))}
        <div className={`${caja} text-xs text-slate-600 dark:text-slate-300`}>E.060 con la envolvente de las combinaciones. f'y = 4200 kgf/cm², d' = 6 cm. Columnas y placas por diagrama de interacción biaxial (Bresler); placas sin elementos de borde (simplificación de curso).</div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select className="inp" value={filtro} onChange={(e) => setFiltro(e.target.value)}><option value="no cumple">Solo las que no cumplen</option><option value="cumple">Solo las que cumplen</option><option value="todos">Todas</option></select>
        <select className="inp" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="todos">Todos los tipos</option><option value="vigas">Vigas</option><option value="columna">Columnas</option><option value="placa">Placas</option></select>
        <span className="text-xs text-slate-500">{lista.length} barras · clic en una fila para ubicarla en el 3D</span>
      </div>
      <section className={caja}>
        <div className="max-h-80 overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-white dark:bg-ink-2"><tr className="border-b border-slate-200 text-left uppercase text-slate-500 dark:border-ink-line">
              {["Barra", "Sección", "Estado", "Flexión", "Cortante / estribos", "Observación"].map((c) => <th key={c} className="px-2 py-1.5">{c}</th>)}
            </tr></thead>
            <tbody>{lista.slice(0, 400).map((x) => (
              <tr key={x.id} onClick={() => setElegido(x.id)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-ink-line dark:hover:bg-ink-3">
                <td className="px-2 py-1 font-medium">{x.nombre}</td>
                <td className="px-2 py-1">{x.sec}</td>
                <td className={`px-2 py-1 font-semibold ${x.estado === "cumple" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{x.estado}</td>
                <td className="px-2 py-1 tabular-nums">{x.tipo.startsWith("viga")
                  ? `sup ${x.As_sup ?? "—"} cm² (${x.barras_sup}) · inf ${x.As_inf ?? "—"} cm² (${x.barras_inf})${x.doble_refuerzo ? " · doble refuerzo" : ""}`
                  : `Pu ${x.Pu} t · ρ ${x.rho ?? "—"} % (${x.barras})${x.ratio != null ? ` · uso ${x.ratio}` : ""}`}</td>
                <td className="px-2 py-1">{x.estribos}</td>
                <td className="px-2 py-1 text-slate-500">{(x.avisos || []).join(" · ")}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
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
