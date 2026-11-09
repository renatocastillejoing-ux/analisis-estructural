import { useEffect, useMemo, useRef, useState } from "react";
import { metodoA } from "../api.js";

// Reproductor del Método Sistematizado de Rigidez (matriz [A], K = AᵀkA):
// cada paso trae su figura animada y sus matrices, cálculo a cálculo.

const VELOCIDADES = [["Lento", 4200], ["Normal", 2600], ["Rápido", 1500]];
const T_GDL = 1500, T_ENS = 1300, T_BARRA = 850;

export default function Paso({ modelo, onVolver }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [i, setI] = useState(0);
  const [play, setPlay] = useState(false);
  const [vel, setVel] = useState(2600);

  useEffect(() => {
    let vivo = true;
    setData(null); setError(null);
    metodoA(modelo).then(({ ok, data }) => {
      if (!vivo) return;
      if (!ok || !data.ok) { setError(mensajeError(data.error)); return; }
      const pasos = [...data.pasos];
      if (data.diagramas?.elementos?.length) {
        pasos.push({ id: "DMF", n: 13, titulo: "Diagrama de Momento Flector (DMF)", desc: "Con las fuerzas de extremo {qᵢ} y las cargas de tramo se traza el momento a lo largo de cada barra, del lado traccionado." });
        pasos.push({ id: "DFC", n: 14, titulo: "Diagrama de Fuerza Cortante (DFC)", desc: "La cortante V a lo largo de cada barra: su pendiente es la carga distribuida y sus saltos, las cargas puntuales." });
      }
      setData({ ...data, pasos }); setI(0);
    }).catch((e) => vivo && setError(`No hay conexión con el servidor de cálculo (${e}).`));
    return () => { vivo = false; };
  }, [modelo]);

  const n = data?.pasos.length || 0;
  const paso = data?.pasos[i];

  // reproducción automática: cada paso dura lo que su animación (mín. la velocidad elegida)
  useEffect(() => {
    if (!play || !data) return;
    if (i >= n - 1) { setPlay(false); return; }
    const t = setTimeout(() => setI((k) => k + 1), Math.max(vel, duracion(paso, data) + 700));
    return () => clearTimeout(t);
  }, [play, i, data, vel, n, paso]);

  // teclado: ← → para avanzar, P para reproducir
  useEffect(() => {
    const h = (e) => {
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight") { setPlay(false); setI((k) => Math.min(n - 1, k + 1)); }
      else if (e.key === "ArrowLeft") { setPlay(false); setI((k) => Math.max(0, k - 1)); }
      else if (e.key.toLowerCase() === "p") setPlay((p) => !p);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [n]);

  if (error) {
    return (
      <div className="m-auto max-w-lg space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm dark:border-amber-800 dark:bg-amber-950/40">
        <p className="font-semibold">Este modelo aún no se puede resolver paso a paso</p>
        <p>{error}</p>
        <p className="text-xs text-slate-600 dark:text-slate-300">El método sistematizado admite pórticos ortogonales 2D (columnas verticales y vigas horizontales), con o sin varios pisos y cargas en vigas o columnas.</p>
        <button onClick={onVolver} className="rounded-md bg-teal px-3 py-1.5 text-white">Volver al modelo</button>
      </div>
    );
  }
  if (!data) return <div className="m-auto text-sm text-slate-600 dark:text-slate-300">Resolviendo con el método [A]…</div>;

  const ir = (k) => { setPlay(false); setI(Math.max(0, Math.min(n - 1, k))); };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-6 py-2.5 dark:border-ink-line dark:bg-ink-2">
        <button onClick={() => ir(0)} className={btn} title="Primer paso" aria-label="Primer paso">⏮</button>
        <button onClick={() => ir(i - 1)} className={btn} title="Paso anterior (←)" aria-label="Paso anterior">◀</button>
        <button onClick={() => { if (i >= n - 1) setI(0); setPlay((p) => !p); }} className="min-w-28 rounded-md bg-teal px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-dark" title="Reproducir / pausar (P)">
          {play ? "⏸ Pausa" : "▶ Reproducir"}
        </button>
        <button onClick={() => ir(i + 1)} className={btn} title="Paso siguiente (→)" aria-label="Paso siguiente">▶</button>
        <button onClick={() => ir(n - 1)} className={btn} title="Último paso" aria-label="Último paso">⏭</button>
        <label className="ml-2 flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          Velocidad
          <select value={vel} onChange={(e) => setVel(+e.target.value)} className="inp !py-0.5 text-xs">
            {VELOCIDADES.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{data.n_gdl} GDL · {data.barras.length} barras · K = Σ AᵀkA</span>
        <span className="text-sm font-semibold tabular-nums">Paso {i + 1} / {n}</span>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-6 py-2 dark:border-ink-line dark:bg-ink-2" role="tablist" aria-label="Pasos">
        {data.pasos.map((p, k) => (
          <button key={k} role="tab" aria-selected={k === i} onClick={() => ir(k)} title={p.titulo}
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs tabular-nums transition ${k === i ? "border-teal bg-teal font-semibold text-white" : k < i ? "border-teal/40 bg-teal/10 text-teal-dark dark:text-teal-soft" : "border-slate-200 text-slate-500 dark:border-ink-line dark:text-slate-400"}`}>
            {etiquetaPaso(p)}
          </button>
        ))}
      </div>
      <div className="h-1 bg-slate-200 dark:bg-ink-3"><div className="h-1 bg-teal transition-all duration-500" style={{ width: `${((i + 1) / n) * 100}%` }} /></div>

      <div key={i} className="paso-in min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-teal-dark dark:text-teal-soft">Paso {etiquetaPaso(paso)}</div>
          <h2 className="text-lg font-semibold">{paso.titulo}</h2>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">{paso.desc}</p>
        </div>
        <PasoCuerpo paso={paso} data={data} />
      </div>
    </div>
  );
}

const btn = "rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-ink-line dark:hover:bg-ink-3";
const etiquetaPaso = (p) => (p.id === "ensamble" ? "4b" : String(p.n));

function mensajeError(e = "") {
  if (/inclinad/i.test(e)) return "Hay barras inclinadas. El método sistematizado [A] todavía no las resuelve; el cálculo normal (Calcular estructura) sí las admite.";
  return e.replace(/^Caso aun no soportado por el metodo \[A\]:\s*/i, "Caso que el método [A] aún no admite: ") || "No se pudo resolver con el método sistematizado.";
}

function duracion(p, data) {
  if (!p) return 0;
  if (p.id === "activar") return Math.min(p.labels?.length || 0, 12) * T_GDL;
  if (p.id === "ensamble") return Math.min(p.barras?.length || 0, 12) * T_ENS;
  if (["A", "Ki", "AtKA", "r", "d", "q", "qT"].includes(p.id)) return Math.min(data.barras.length, 12) * T_BARRA;
  if (p.id === "DMF" || p.id === "DFC") return 1400;
  return 0;
}

/* ============================== cuerpo de cada paso ============================== */
function PasoCuerpo({ paso, data }) {
  const DL = data.labels.map((_, k) => `D${k + 1}`);
  switch (paso.id) {
    case "activar": return <Activar paso={paso} data={data} />;
    case "coords": return <Coordenadas data={data} />;
    case "A": return <PasoBarras data={data} render={(b) => { const nz = colsNoCero(b.A); return <Matriz M={b.A.map((f) => nz.map((c) => f[c]))} filas={["i", "j"]} columnas={nz.map((c) => DL[c])} />; }}
      arriba={(foco) => <Matriz M={data.A} filas={data.def_labels} columnas={DL} max={16} titulo={`[A] (${data.def_labels.length}×${DL.length}) · {d} = [A]{D}`} resaltarFilas={(r) => foco != null && data.def_labels[r].startsWith(data.barras[foco].elem + "·")} />}
      pie="En cada barra solo se muestran las columnas de [A] distintas de cero: los GDL que la deforman." />;
    case "Ki": return <PasoBarras data={data} render={(b) => <><Nota>EI = {fmt(b.EI)} · L = {fmt(b.L)} · {b.tipo === "viga" ? "Kv = (EI/L)[4 2; 2 4]" : "columna"}</Nota><Matriz M={b.K} /></>} />;
    case "AtKA": return <PasoBarras data={data} render={(b) => { const nz = idxNoCero(b.AtKA); return <Matriz M={nz.map((r) => nz.map((c) => b.AtKA[r][c]))} filas={nz.map((c) => DL[c])} columnas={nz.map((c) => DL[c])} resaltarCeldas />; }}
      pie="Se muestra la submatriz de los GDL de cada barra; el resto de [Aᵢ]ᵀ[Kᵢ][Aᵢ] es cero." />;
    case "ensamble": return <Ensamble paso={paso} data={data} />;
    case "K": return <Matriz M={paso.K} filas={DL} columnas={DL} titulo={`[K] = Σ [Aᵢ]ᵀ[Kᵢ][Aᵢ] (${DL.length}×${DL.length})`} grande max={16} />;
    case "r": return <PasoBarras data={data} render={(b) => <Vector v={b.r} labels={["i", "j"]} />} />;
    case "R": return <Vector v={paso.R} labels={DL} titulo="{R} = Σ [Aᵢ]ᵀ{rᵢ}" />;
    case "Q": return (
      <div className="flex flex-wrap items-center gap-4">
        <Vector v={paso.Qn} labels={DL} titulo="{Q} nudos" /><Op>−</Op>
        <Vector v={paso.R} labels={DL} titulo="{R}" /><Op>=</Op>
        <Vector v={paso.Q} labels={DL} titulo="{Q}" resaltado />
      </div>
    );
    case "D": return <Solucion paso={paso} data={data} />;
    case "d": return <PasoBarras data={data} render={(b) => <Vector v={b.d} labels={b.def_labels || ["i", "j"]} />} />;
    case "q": return <PasoBarras data={data} render={(b) => <Vector v={b.q} labels={["i", "j"]} />} />;
    case "qT": return <PasoBarras data={data} render={(b) => <Vector v={b.qT} labels={["Mi", "Mj"]} resaltado />} pie="Con estos momentos de extremo y las cargas de cada tramo se trazan el DMF y el DFC (pasos siguientes)." />;
    case "DMF": return <DiagramaPaso data={data} tipo="M" />;
    case "DFC": return <DiagramaPaso data={data} tipo="V" />;
    default: return null;
  }
}

/* ---------- geometría común del pórtico ---------- */
function useGeom(barras, W, H, pad) {
  return useMemo(() => {
    const xs = barras.flatMap((b) => [b.xi, b.xj]), ys = barras.flatMap((b) => [b.yi, b.yj]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const sx = maxX - minX || 1, sy = maxY - minY || 1;
    const s = Math.min((W - 2 * pad) / sx, (H - 2 * pad) / sy);
    const ox = (W - sx * s) / 2 - minX * s, oy = (H - sy * s) / 2 + maxY * s;
    return { X: (x) => ox + x * s, Y: (y) => oy - y * s, s, span: Math.max(sx, sy) };
  }, [barras, W, H, pad]);
}

// progreso 0→1 animado cada vez que cambia `clave`
function useProgreso(clave, ms = 600) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf, t0;
    const f = (t) => { t0 ??= t; const x = Math.min(1, (t - t0) / ms); setP(1 - (1 - x) ** 3); if (x < 1) raf = requestAnimationFrame(f); };
    setP(0); raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [clave, ms]);
  return p;
}

// ciclo automático por índices 0..n-1; `fijo` detiene el ciclo
function useCiclo(n, ms, unaVez = false) {
  const [k, setK] = useState(0);
  const [fijo, setFijo] = useState(false);
  useEffect(() => {
    if (fijo || n <= 1) return;
    if (unaVez && k >= n - 1) return;
    const t = setTimeout(() => setK((x) => (x + 1) % n), ms);
    return () => clearTimeout(t);
  }, [k, n, ms, fijo, unaVez]);
  return [k, (x) => { setFijo(true); setK(x); }, fijo, () => setFijo(false)];
}

function Apoyos({ nudos, X, Y }) {
  return nudos.filter((nd) => nd.restr?.some(Boolean)).map((nd) => {
    const x = X(nd.x), y = Y(nd.y);
    const emp = nd.restr[0] && nd.restr[1] && nd.restr[2];
    return emp ? (
      <g key={nd.nombre} className="stroke-slate-500 dark:stroke-slate-400">
        <line x1={x - 13} y1={y} x2={x + 13} y2={y} strokeWidth={3} />
        {[-10, -4, 2, 8].map((d) => <line key={d} x1={x + d} y1={y} x2={x + d - 6} y2={y + 8} strokeWidth={1.2} />)}
      </g>
    ) : (
      <path key={nd.nombre} d={`M${x},${y} l-9,13 h18 z`} className="fill-transparent stroke-slate-500 dark:stroke-slate-400" strokeWidth={1.6} />
    );
  });
}

// Desplazamientos de nudo (ux, uy, θ) para un vector de GDL del método [A].
function despNudos(data, coef) {
  const out = Object.fromEntries(data.nudos.map((nd) => [nd.nombre, { ux: 0, uy: 0, th: 0 }]));
  data.labels.forEach((lab, g) => {
    const c = coef[g] || 0; if (!c) return;
    const t = lab.replace(/^D\d+\(/, "").replace(/\)$/, "");
    const mY = t.match(/^Δ\s*y=(.+)$/), mT = t.match(/^θ\s*(.+)$/);
    if (mY) data.nudos.forEach((nd) => { if (Math.abs(nd.y - +mY[1]) < 1e-6 && !nd.restr?.[0]) out[nd.nombre].ux += c; });
    else if (mT && out[mT[1]]) out[mT[1]].th += c;
  });
  return out;
}

// Barra deformada por interpolación de Hermite (cúbica) con los desplazamientos de sus extremos.
function curvaBarra(b, d, amp, X, Y) {
  const L = Math.hypot(b.xj - b.xi, b.yj - b.yi) || 1, c = (b.xj - b.xi) / L, s = (b.yj - b.yi) / L;
  const a = d[b.i] || { ux: 0, uy: 0, th: 0 }, z = d[b.j] || { ux: 0, uy: 0, th: 0 };
  const ui = c * a.ux + s * a.uy, uj = c * z.ux + s * z.uy;
  const vi = -s * a.ux + c * a.uy, vj = -s * z.ux + c * z.uy;
  const pts = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16, N1 = 1 - 3 * t * t + 2 * t ** 3, N2 = L * (t - 2 * t * t + t ** 3), N3 = 3 * t * t - 2 * t ** 3, N4 = L * (-t * t + t ** 3);
    const v = (N1 * vi + N2 * a.th + N3 * vj + N4 * z.th) * amp, u = (ui + (uj - ui) * t) * amp;
    pts.push(`${X(b.xi + (b.xj - b.xi) * t + c * u - s * v)},${Y(b.yi + (b.yj - b.yi) * t + s * u + c * v)}`);
  }
  return pts.join(" ");
}

function Figura({ data, W = 720, H = 400, pad = 70, foco, tenue, children, deformada, amp = 0 }) {
  const barras = data.barras;
  const G = useGeom(barras, W, H, pad);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto max-h-[440px] w-full rounded-xl border border-slate-200 bg-white dark:border-ink-line dark:bg-ink-2">
      <Apoyos nudos={data.nudos} X={G.X} Y={G.Y} />
      {barras.map((b, k) => {
        const on = foco == null ? !tenue?.(k) : foco === k;
        return (
          <g key={k}>
            <line x1={G.X(b.xi)} y1={G.Y(b.yi)} x2={G.X(b.xj)} y2={G.Y(b.yj)} strokeLinecap="round"
              className={`transition-all duration-500 ${on ? "stroke-teal" : "stroke-slate-300 dark:stroke-ink-line"}`} strokeWidth={on ? 6 : 4} />
            {(barras.length <= 40 || foco === k) && <text x={(G.X(b.xi) + G.X(b.xj)) / 2 + (b.xi === b.xj ? 10 : 0)} y={(G.Y(b.yi) + G.Y(b.yj)) / 2 - (b.xi === b.xj ? 0 : 9)}
              textAnchor={b.xi === b.xj ? "start" : "middle"} className={`text-[12px] font-semibold transition-opacity ${on ? "fill-slate-800 dark:fill-slate-100" : "fill-slate-400 opacity-60"}`}>{b.elem}</text>}
            {foco === k && <>
              <text x={G.X(b.xi)} y={G.Y(b.yi) + 18} textAnchor="middle" className="fill-amber-600 text-[11px] font-bold dark:fill-amber-400">i</text>
              <text x={G.X(b.xj)} y={G.Y(b.yj) - 10} textAnchor="middle" className="fill-amber-600 text-[11px] font-bold dark:fill-amber-400">j</text>
            </>}
          </g>
        );
      })}
      {deformada && amp > 0 && barras.map((b, k) => (
        <polyline key={`d${k}`} points={curvaBarra(b, deformada, amp, G.X, G.Y)} fill="none" stroke="#E11D48" strokeWidth={2.2} strokeDasharray="6 4" />
      ))}
      {data.nudos.map((nd) => <circle key={nd.nombre} cx={G.X(nd.x)} cy={G.Y(nd.y)} r={3.5} className="fill-slate-800 dark:fill-slate-200" />)}
      {children?.(G)}
    </svg>
  );
}

/* ---------- paso 0: activación de GDL ---------- */
function Activar({ paso, data }) {
  const labels = paso.labels || data.labels;
  const [g, elegir, fijo, soltar] = useCiclo(labels.length, T_GDL);
  const p = useProgreso(g, 700);
  const barrasA = paso.barras || data.barras;
  const afecta = (k) => (barrasA[k]?.A || []).some((r) => Math.abs(r[g] || 0) > 1e-12);
  const unit = useMemo(() => { const c = labels.map((_, k) => (k === g ? 1 : 0)); return despNudos(data, c); }, [g, labels, data]);
  const G0 = data.barras;
  const span = useMemo(() => Math.max(...G0.flatMap((b) => [b.xi, b.xj])) - Math.min(...G0.flatMap((b) => [b.xi, b.xj])) || 1, [G0]);
  const Lm = useMemo(() => G0.reduce((s, b) => s + Math.hypot(b.xj - b.xi, b.yj - b.yi), 0) / G0.length, [G0]);
  const corto = labels[g]?.replace(/^D\d+\(/, "").replace(/\)$/, "") || "";
  const esGiro = corto.startsWith("θ");
  const amp = (esGiro ? 0.22 * Lm : 0.06 * span) * p;
  const nodoGiro = esGiro ? data.nudos.find((nd) => nd.nombre === corto.replace(/^θ\s*/, "")) : null;
  const yPiso = !esGiro ? +corto.replace(/^Δ\s*y=/, "") : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <div className="space-y-2">
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
          {labels.map((l, k) => (
            <button key={k} onClick={() => elegir(k)} title={l}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${k === g ? "scale-105 border-teal bg-teal text-white shadow" : "border-slate-200 text-slate-600 dark:border-ink-line dark:text-slate-300"}`}>D{k + 1}</button>
          ))}
          {fijo && <button onClick={soltar} className="ml-2 text-xs text-teal-dark underline dark:text-teal-soft">reanudar ciclo</button>}
        </div>
        <Figura data={data} tenue={(k) => !afecta(k)} deformada={unit} amp={amp}>
          {(G) => (<>
            <text x={360} y={26} textAnchor="middle" className="fill-slate-800 text-[15px] font-semibold dark:fill-slate-100">D{g + 1} = 1 · {corto}</text>
            {nodoGiro && (
              <path d={`M${G.X(nodoGiro.x) + 18},${G.Y(nodoGiro.y)} A18,18 0 1,0 ${G.X(nodoGiro.x)},${G.Y(nodoGiro.y) - 18}`} fill="none" stroke="#F59E0B" strokeWidth={2.5} markerEnd="url(#fl-gdl)" style={{ opacity: p }} />
            )}
            {yPiso != null && Number.isFinite(yPiso) && (() => {
              const xs = data.nudos.filter((nd) => Math.abs(nd.y - yPiso) < 1e-6).map((nd) => nd.x);
              const x0 = Math.min(...xs);
              return <line x1={G.X(x0) - 60} y1={G.Y(yPiso) - 22} x2={G.X(x0) - 60 + 45 * p} y2={G.Y(yPiso) - 22} stroke="#F59E0B" strokeWidth={3} markerEnd="url(#fl-gdl)" />;
            })()}
            <defs><marker id="fl-gdl" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#F59E0B" /></marker></defs>
          </>)}
        </Figura>
      </div>
      <aside className="space-y-2 text-sm">
        <h3 className="font-semibold">Qué se ve</h3>
        <p className="text-slate-600 dark:text-slate-300">Se impone <b>D{g + 1} = 1</b> y los demás GDL en cero. La línea roja discontinua es la deformada que produce ese GDL; en verde, las barras que se deforman (columna D{g + 1} de [A] distinta de cero).</p>
        <ul className="space-y-1">
          {data.barras.map((b, k) => ({ b, k })).filter(({ k }) => data.barras.length <= 30 || afecta(k)).map(({ b, k }) => (
            <li key={k} className={`flex justify-between rounded-md px-2 py-1 transition ${afecta(k) ? "bg-teal/10 font-medium" : "text-slate-400"}`}>
              <span>{b.elem}</span><span className="tabular-nums">[{(barrasA[k]?.A || []).map((r) => fmt(r[g])).join(", ")}]</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/* ---------- paso 1: sistemas Q–D y q–d ---------- */
function Coordenadas({ data }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <Figura data={data}>
        {(G) => data.labels.map((l, k) => {
          const t = l.replace(/^D\d+\(/, "").replace(/\)$/, "");
          const nd = t.startsWith("θ") ? data.nudos.find((x) => x.nombre === t.replace(/^θ\s*/, "")) : null;
          if (nd) return <text key={k} x={G.X(nd.x) + 8} y={G.Y(nd.y) - 10} className="celda-in fill-amber-600 text-[12px] font-bold dark:fill-amber-400" style={{ animationDelay: `${k * 120}ms` }}>D{k + 1}↺</text>;
          const y = +t.replace(/^Δ\s*y=/, ""); const xs = data.nudos.filter((x) => Math.abs(x.y - y) < 1e-6).map((x) => x.x);
          return xs.length ? <text key={k} x={G.X(Math.min(...xs)) - 52} y={G.Y(y) + 4} className="celda-in fill-amber-600 text-[12px] font-bold dark:fill-amber-400" style={{ animationDelay: `${k * 120}ms` }}>D{k + 1}→</text> : null;
        })}
      </Figura>
      <div className="space-y-3 text-sm">
        <div>
          <h3 className="mb-1 font-semibold">GDL globales {"{D}"} (sistema Q–D)</h3>
          <ul className="space-y-1">{data.labels.map((l, k) => <li key={k} className="celda-in rounded-md border border-slate-200 px-3 py-1 dark:border-ink-line" style={{ animationDelay: `${k * 80}ms` }}><b>D{k + 1}</b> = {l.replace(/^D\d+\(/, "").replace(/\)$/, "")}</li>)}</ul>
        </div>
        <div>
          <h3 className="mb-1 font-semibold">Deformaciones de barra {"{d}"} (sistema q–d)</h3>
          <div className="flex flex-wrap gap-1">{data.def_labels.map((l, k) => <span key={k} className="celda-in rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-ink-3" style={{ animationDelay: `${k * 50}ms` }}>d{k + 1} · {l}</span>)}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- pasos por barra: figura con foco + tarjetas ---------- */
function PasoBarras({ data, render, arriba, pie }) {
  const nb = data.barras.length;
  const [foco, elegir, fijo, soltar] = useCiclo(nb, T_BARRA, true);
  const refs = useRef([]);
  useEffect(() => { refs.current[foco]?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [foco]);
  return (
    <div className="space-y-4">
      {arriba && arriba(foco)}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
        <div className="xl:sticky xl:top-0 xl:self-start">
          <Figura data={data} W={520} H={360} pad={55} foco={foco} />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Barra {foco + 1} de {nb}. {fijo ? <button className="underline" onClick={soltar}>recorrer todas</button> : "Clic en una tarjeta para fijarla."}</p>
        </div>
        <div className="grid content-start gap-3 sm:grid-cols-2">
          {data.barras.map((b, k) => (
            <button type="button" key={k} ref={(el) => (refs.current[k] = el)} onClick={() => elegir(k)}
              className={`celda-in rounded-xl border p-3 text-left transition ${k === foco ? "border-amber-400 bg-amber-50 shadow ring-2 ring-amber-300 dark:bg-amber-900/20" : "border-slate-200 bg-white dark:border-ink-line dark:bg-ink-2"}`}
              style={{ animationDelay: `${k * 60}ms` }}>
              <div className="mb-2 flex items-center gap-2 text-sm">
                <b>{b.elem}</b><span className="rounded-full bg-slate-100 px-2 text-[11px] dark:bg-ink-3">{b.tipo}</span>
                <span className="ml-auto text-[11px] text-slate-500">{b.i} → {b.j}</span>
              </div>
              {render(b, k === foco)}
            </button>
          ))}
        </div>
      </div>
      {pie && <p className="text-sm text-slate-600 dark:text-slate-300">{pie}</p>}
    </div>
  );
}

/* ---------- paso 4b: ensamblaje barra a barra ---------- */
function Ensamble({ paso, data }) {
  const bars = paso.barras || data.barras;
  const n = data.labels.length;
  const [k, elegir, , soltar] = useCiclo(bars.length + 1, T_ENS, true);   // k = barras ya sumadas
  const acc = useMemo(() => {
    const m = Array.from({ length: n }, () => Array(n).fill(0));
    bars.slice(0, k).forEach((b) => b.AtKA.forEach((f, r) => f.forEach((v, c) => { m[r][c] += v; })));
    return m;
  }, [k, bars, n]);
  const ultima = k > 0 ? bars[k - 1] : null;
  const toca = (r, c) => ultima && Math.abs(ultima.AtKA[r][c]) > 1e-12;
  const DL = data.labels.map((_, x) => `D${x + 1}`);
  const idxBarra = ultima ? data.barras.findIndex((b) => b.elem === ultima.elem) : null;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
      <div className="space-y-2">
        <Figura data={data} W={520} H={360} pad={55} foco={idxBarra} />
        <div className="flex flex-wrap gap-1">
          {bars.map((b, x) => (
            <button key={x} onClick={() => elegir(x + 1)} className={`rounded-full border px-2.5 py-0.5 text-xs ${x < k ? "border-teal bg-teal/10 text-teal-dark dark:text-teal-soft" : "border-slate-200 text-slate-500 dark:border-ink-line"}`}>{x < k ? "✓ " : ""}{b.elem}</button>
          ))}
          <button onClick={() => { elegir(0); soltar(); }} className="text-xs underline">repetir</button>
        </div>
      </div>
      <div className="space-y-3">
        <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-ink-3">
          {k === 0 ? "[K] empieza en cero." : k < bars.length ? <>Se suma <b>{ultima.elem}</b>: [K] ← [K] + [A]ᵀ[k][A]</> : <><b>[K] completa</b> = Σ [Aᵢ]ᵀ[Kᵢ][Aᵢ] ({bars.length} barras)</>}
        </div>
        <div className="overflow-x-auto">
          <table className="text-sm tabular-nums">
            <thead><tr><th />{DL.map((d) => <th key={d} className="px-2 py-1 text-xs text-slate-500">{d}</th>)}</tr></thead>
            <tbody>
              {acc.map((f, r) => (
                <tr key={r}>
                  <th className="px-2 text-xs text-slate-500">{DL[r]}</th>
                  {f.map((v, c) => (
                    <td key={`${c}-${toca(r, c) ? k : 0}`} className={`min-w-20 border border-slate-200 px-2 py-1.5 text-right dark:border-ink-line ${toca(r, c) ? "flash font-semibold" : ""} ${Math.abs(v) < 1e-12 ? "text-slate-400" : ""}`}>{fmt(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ultima && k <= bars.length && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Aporte de {ultima.elem}</div>
            <Matriz M={ultima.AtKA} filas={DL} columnas={DL} resaltarCeldas />
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- paso 9: solución {D} y deformada ---------- */
function Solucion({ paso, data }) {
  const p = useProgreso("D", 1200);
  const els = data.diagramas?.elementos || [];
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      {els.length ? <Deformada data={data} p={p} /> : <Figura data={data} />}
      <div className="space-y-3">
        <Vector v={paso.D} labels={data.labels} titulo="{D} = [K]⁻¹{Q}" resaltado />
        <p className="text-xs text-slate-500 dark:text-slate-400">La deformada (roja) se dibuja con los desplazamientos reales, amplificados para que se vean.</p>
      </div>
    </div>
  );
}

function Deformada({ data, p }) {
  const els = data.diagramas.elementos;
  const W = 720, H = 400;
  const G = useGeom(els, W, H, 70);
  const dmax = Math.max(1e-12, ...els.flatMap((e) => (e.defx || []).map((v, k) => Math.hypot(v, e.defy?.[k] || 0))));
  const f = (0.08 * G.span) / dmax * p;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto max-h-[440px] w-full rounded-xl border border-slate-200 bg-white dark:border-ink-line dark:bg-ink-2">
      <Apoyos nudos={data.nudos} X={G.X} Y={G.Y} />
      {els.map((e, k) => <line key={k} x1={G.X(e.xi)} y1={G.Y(e.yi)} x2={G.X(e.xj)} y2={G.Y(e.yj)} className="stroke-slate-300 dark:stroke-ink-line" strokeWidth={4} />)}
      {els.map((e, k) => {
        const n = e.s.length, L = e.s[n - 1] || 1;
        const pts = e.s.map((s, q) => `${G.X(e.xi + (e.xj - e.xi) * s / L + e.defx[q] * f)},${G.Y(e.yi + (e.yj - e.yi) * s / L + e.defy[q] * f)}`).join(" ");
        return <polyline key={`d${k}`} points={pts} fill="none" stroke="#E11D48" strokeWidth={2.4} />;
      })}
      <text x={W / 2} y={24} textAnchor="middle" className="fill-slate-700 text-[13px] font-semibold dark:fill-slate-200">Deformada (×{(0.08 * G.span / dmax).toExponential(1)})</text>
    </svg>
  );
}

/* ---------- pasos 13 y 14: DMF y DFC dibujados ---------- */
export function DiagramaPaso({ data, tipo }) {
  const els = data.diagramas?.elementos || [];
  return (
    <div className="space-y-2">
      <Diagrama elementos={els} nudos={data.diagramas?.nudos || data.nudos} tipo={tipo} animado />
      <p className="text-xs text-slate-500 dark:text-slate-400">{tipo === "M" ? "DMF dibujado del lado traccionado. Positivos en verde azulado, negativos en rojo." : "DFC con la convención de signos de la barra (i → j). Positivos en verde azulado, negativos en rojo."}</p>
    </div>
  );
}

// Diagrama N/V/M sobre el pórtico (se usa también en Resultados).
export function Diagrama({ elementos, nudos = [], tipo, animado, W = 900, H = 440 }) {
  const G = useGeom(elementos.length ? elementos : [{ xi: 0, yi: 0, xj: 1, yj: 1 }], W, H, 90);
  if (!elementos.length) return <p className="text-sm text-slate-500">Sin datos de diagrama.</p>;
  const vmax = Math.max(1e-9, ...elementos.flatMap((e) => (e[tipo] || []).map(Math.abs)));
  const k = 70 / vmax;
  const etiquetas = [];
  const usadas = [];
  const libre = (x, y) => !usadas.some(([a, b]) => Math.abs(a - x) < 34 && Math.abs(b - y) < 14);
  const lado = tipo === "M" ? 1 : -1;   // DMF hacia el lado traccionado; DFC y DFN positivos hacia arriba
  const formas = elementos.map((e, idx) => {
    const vals = e[tipo] || [], n = vals.length, s = e.s || vals.map((_, q) => q / (n - 1));
    if (!n) return null;
    const L = s[n - 1] || 1;
    const ax = G.X(e.xi), ay = G.Y(e.yi), bx = G.X(e.xj), by = G.Y(e.yj);
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * lado, py = (dx / len) * lado;
    const base = s.map((t) => [ax + dx * t / L, ay + dy * t / L]);
    const pts = base.map(([x, y], q) => [x + px * vals[q] * k, y + py * vals[q] * k]);
    const quads = [];
    for (let q = 0; q < n - 1; q++) {
      const pos = vals[q] + vals[q + 1] >= 0;
      quads.push(<polygon key={q} points={[base[q], base[q + 1], pts[q + 1], pts[q]].map((p) => p.join(",")).join(" ")}
        className={`${pos ? "fill-teal/30" : "fill-rose-500/25"} ${animado ? "aparece" : ""}`} style={animado ? { animationDelay: `${300 + idx * 120}ms` } : undefined} />);
    }
    // extremos y máximo interior, sin pisarse
    let qa = 0, qb = 0; vals.forEach((v, q) => { if (v > vals[qa]) qa = q; if (v < vals[qb]) qb = q; });
    [0, n - 1, qa, qb].forEach((q, z) => {
      if (z >= 2 && (q === 0 || q === n - 1 || Math.abs(vals[q]) < 1e-6)) return;
      const [x, y] = pts[q], v = vals[q];
      if (Math.abs(v) < 1e-9) return;
      const tx = x + px * 13 * Math.sign(v || 1), ty = y + py * 13 * Math.sign(v || 1) + 4;
      if (!libre(tx, ty)) return;
      usadas.push([tx, ty]);
      etiquetas.push(<text key={`${idx}-${q}`} x={tx} y={ty} textAnchor="middle"
        className={`text-[11px] font-semibold tabular-nums ${v >= 0 ? "fill-teal-dark dark:fill-teal-soft" : "fill-rose-700 dark:fill-rose-400"} ${animado ? "aparece" : ""}`}
        style={animado ? { animationDelay: `${700 + idx * 80}ms` } : undefined}>{fmt2(v)}</text>);
    });
    return (
      <g key={idx}>
        {quads}
        <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" pathLength={1}
          className={`${animado ? "trazo" : ""} stroke-teal-dark dark:stroke-teal-soft`} strokeWidth={2} style={animado ? { animationDelay: `${idx * 120}ms` } : undefined} />
      </g>
    );
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-auto max-h-[460px] w-full">
      {elementos.map((e, q) => <line key={q} x1={G.X(e.xi)} y1={G.Y(e.yi)} x2={G.X(e.xj)} y2={G.Y(e.yj)} className="stroke-slate-700 dark:stroke-slate-300" strokeWidth={2.5} strokeLinecap="round" />)}
      <Apoyos nudos={nudos} X={G.X} Y={G.Y} />
      {formas}
      {etiquetas}
    </svg>
  );
}

/* ---------- piezas de matrices ---------- */
function Matriz({ M: M0, filas: f0, columnas: c0, titulo, resaltarFilas, resaltarCols, resaltarCeldas, grande, max = 60 }) {
  if (!M0 || !M0.length) return null;
  const nr = M0.length, nc = Array.isArray(M0[0]) ? M0[0].length : 1;
  const recorte = nr > max || nc > max;
  const M = recorte ? M0.slice(0, max).map((f) => (Array.isArray(f) ? f.slice(0, max) : f)) : M0;
  const filas = f0 && recorte ? f0.slice(0, max) : f0;
  const columnas = c0 && recorte ? c0.slice(0, max) : c0;
  let seq = 0;
  return (
    <div>
      {titulo && <div className="mb-2 text-sm font-semibold text-teal-dark dark:text-teal-soft">{titulo}</div>}
      {recorte && <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">Matriz de {nr}×{nc}: se muestran las primeras {Math.min(nr, max)} filas y {Math.min(nc, max)} columnas. La matriz completa entra en el cálculo y en la memoria.</p>}
      <div className="overflow-x-auto">
        <table className={`tabular-nums ${grande ? "text-sm" : "text-xs"}`}>
          {columnas && (
            <thead><tr><th />{columnas.map((c, j) => <th key={j} className={`px-2 py-1 font-semibold ${resaltarCols?.includes(j) ? "text-amber-600 dark:text-amber-400" : "text-slate-500 dark:text-slate-400"}`}>{c}</th>)}</tr></thead>
          )}
          <tbody>
            {M.map((fila, r) => {
              const rf = resaltarFilas?.(r);
              return (
                <tr key={r} className={rf ? "bg-amber-100 dark:bg-amber-900/30" : ""}>
                  {filas && <th className="whitespace-nowrap px-2 py-1 text-left font-semibold text-slate-500 dark:text-slate-400">{filas[r]}</th>}
                  {(Array.isArray(fila) ? fila : [fila]).map((v, c) => {
                    const cero = Math.abs(+v) < 1e-12;
                    return (
                      <td key={c} className={`celda-in border border-slate-200 px-2 py-1 text-right dark:border-ink-line ${grande ? "min-w-20" : "min-w-14"} ${cero ? "text-slate-400" : resaltarCeldas ? "bg-teal/10 font-semibold" : ""} ${resaltarCols?.includes(c) && !cero ? "bg-amber-100 font-semibold dark:bg-amber-900/30" : ""}`}
                        style={{ animationDelay: `${Math.min(seq++ * 25, 1400)}ms` }}>{fmt(v)}</td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Vector({ v, labels, titulo, resaltado }) {
  return (
    <div>
      {titulo && <div className="mb-2 text-sm font-semibold text-teal-dark dark:text-teal-soft">{titulo}</div>}
      <table className="text-sm tabular-nums">
        <tbody>
          {(v || []).map((x, k) => (
            <tr key={k}>
              <th className="whitespace-nowrap px-2 py-1 text-left text-xs text-slate-500 dark:text-slate-400">{labels ? labels[k] : `D${k + 1}`}</th>
              <td className={`celda-in min-w-24 border border-slate-200 px-3 py-1 text-right dark:border-ink-line ${resaltado ? "bg-teal/10 font-semibold" : ""}`} style={{ animationDelay: `${k * 90}ms` }}>{fmt(x)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Op = ({ children }) => <span className="text-2xl font-light text-slate-400">{children}</span>;
const Nota = ({ children }) => <div className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">{children}</div>;
const colsNoCero = (A) => (A[0] || []).map((_, c) => c).filter((c) => A.some((f) => Math.abs(f[c]) > 1e-12));
const idxNoCero = (M) => M.map((_, k) => k).filter((k) => M[k].some((v) => Math.abs(v) > 1e-12) || M.some((f) => Math.abs(f[k]) > 1e-12));

function fmt(x) {
  x = +x;
  if (!Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  if (a < 1e-9) return "0";
  if (a >= 1e5) return x.toExponential(3);
  if (a >= 100) return x.toFixed(1);
  if (a >= 1) return x.toFixed(3);
  if (a >= 1e-3) return x.toFixed(5);
  return x.toExponential(2);
}
function fmt2(v) { const s = (+v).toFixed(2); return /^-0\.00$/.test(s) ? "0.00" : s; }
