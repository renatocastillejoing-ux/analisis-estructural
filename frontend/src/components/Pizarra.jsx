import { useEffect, useMemo, useRef, useState } from "react";
import { Coordenadas, DiagramaPaso, Matriz, Vector } from "./Paso.jsx";

// «Como el profesor»: la solución escrita renglón a renglón, en el mismo orden de su hoja
// (FIJA PC3 / ejemplo 7-1): datos → GDL → [A] → EI → G, Ac, α → A, B, C, D → [k] → Aᵀ →
// [A]ᵀ[k][A] → [K] → {Q} → {D} → {d} → {q} → gráficos. Cada renglón aparece primero como
// fórmula, luego con los valores reemplazados y al final con el resultado, y lleva al lado
// la explicación de por qué se hace. La hoja se va llenando hacia abajo, sin saltos.

const VEL = [["Lento", 3200], ["Normal", 1900], ["Rápido", 900], ["Muy rápido", 350]];
const n6 = (x) => {                         // 6 cifras significativas (el {D} NO se redondea)
  x = +x;
  if (!Number.isFinite(x)) return "—";
  if (Math.abs(x) < 1e-14) return "0";
  const a = Math.abs(x);
  if (a >= 1e3) return x.toFixed(2);                       // 2 509 980.08 como en la hoja
  return a >= 1e-3 ? (+x.toPrecision(6)).toString() : x.toExponential(5);
};
const g = (x, p = 4) => (+(+x).toPrecision(p)).toString();
const LOC = ["Δi", "θi", "Δj", "θj"];

function coef(b) {
  const L = +b.Lf || +b.L, a = +b.alfa || 0, EI = +b.EI, f = 1 + a;
  return { L, a, EI, A: (12 * EI) / (L ** 3 * f), B: (6 * EI) / (L ** 2 * f), C: ((4 + a) * EI) / (L * f), D: ((2 - a) * EI) / (L * f) };
}

// guion: lista de renglones {sec, titulo?, pasos:[texto…] (fórmula → reemplazo → resultado), nota, bloque}
export function guion(data) {
  const R = [];
  const add = (sec, o) => R.push({ sec, ...o });
  const B = data.barras;
  const nombre = (b) => `${b.elem} (${b.tipo})`;

  // 1 · datos
  const E = B[0]?.E;
  add(1, { titulo: "Datos de los materiales y las secciones" });
  add(1, { pasos: ["E = 15 000·√f'c  (kgf/cm²)", `E = 15 000·√f'c × 10 (a tonf/m²)`, `E = ${n6(E)} tonf/m²`], nota: "El módulo de elasticidad sale de la resistencia del concreto (E.060). Se multiplica por 10 para pasar de kgf/cm² a tonf/m²." });
  const vistas = new Set();
  B.forEach((b) => {
    if (!b.b || !b.h) return;
    const k = `${b.b}x${b.h}`;
    if (vistas.has(k)) return;
    vistas.add(k);
    add(1, { pasos: [`I = b·h³ / 12`, `I = ${g(b.b, 3)}·${g(b.h, 3)}³ / 12`, `I = ${n6(b.I)} m⁴`], nota: `Inercia de la sección ${g(b.b, 3)}×${g(b.h, 3)} (h es el peralte en el plano del pórtico).` });
  });

  // 2 · GDL
  add(2, { titulo: "Grados de libertad: global (Q–D) y local (q–d)" });
  add(2, { bloque: "coords", nota: `Se numeran ${data.labels.length} GDL globales {D}: primero los desplazamientos laterales y luego los giros de nudo. Cada barra tiene 4 GDL locales: Δ y θ en su extremo i y en su extremo j (antihorario positivo).` });

  // 3 · [A]
  add(3, { titulo: "Matriz de compatibilidad [A]: {d} = [A]{D}" });
  B.forEach((b) => {
    const filas = (b.dnum || ["d1", "d2", "d3", "d4"]).map((d, k) => `${d} ${LOC[k]}`);
    const cols = b.Aidx.map((c) => data.labels[c].replace(/\(.*/, ""));
    const expl = [];
    b.Asub.forEach((f, r) => f.forEach((v, c) => {
      if (Math.abs(v) < 1e-12) return;
      const D = cols[c];
      if (r % 2 === 0 && Math.abs(Math.abs(v) - 1) > 1e-9) expl.push(`${b.dnum?.[r] || "d" + (r + 1)} = ${g(v)}·${D}: brazo rígido de ${g(Math.abs(v))} m, el giro ${D} desplaza el borde de la parte flexible.`);
      else if (r % 2 === 0) expl.push(`${b.dnum?.[r] || "d" + (r + 1)} = ${v > 0 ? "" : "−"}${D}: el extremo se desplaza con el piso${v < 0 ? " (signo − por el sentido local de la barra)" : ""}.`);
      else expl.push(`${b.dnum?.[r] || "d" + (r + 1)} = ${D}: el extremo gira con el nudo.`);
    }));
    add(3, { bloque: "A", b, filas, cols, M: b.Asub, nota: `[A] de ${nombre(b)}: cada fila dice cuánto se mueve ese GDL local cuando se activa un GDL global (y los demás quedan fijos). ${expl.slice(0, 3).join(" ")}` });
  });

  // 4–7 · EI, G, Ac, α
  add(4, { titulo: "Rigidez a flexión EI de cada barra" });
  B.forEach((b) => add(4, { pasos: ["EI = E·I", `EI = ${n6(b.E)} × ${n6(b.I)}`, `EI = ${n6(b.EI)} tonf·m²`], nota: `${nombre(b)}.` }));
  const placas = B.filter((b) => +b.alfa > 0);
  if (placas.length) {
    add(5, { titulo: "Placas: deformación por corte" });
    placas.forEach((b) => {
      const nu = +b.E / (2 * +b.G) - 1;
      add(5, { pasos: ["G = E / 2(1+ν)", `G = ${n6(b.E)} / 2(1+${g(nu, 3)})`, `G = ${n6(b.G)} tonf/m²`], nota: `${nombre(b)}: módulo de corte con ν = 0.15 (siempre, en placas).` });
      add(6, { pasos: ["Ac = A / f = 5/6·(b·h)", `Ac = 5/6·(${g(b.b, 3)}·${g(b.h, 3)})`, `Ac = ${n6(b.Ac)} m²`], nota: "Área efectiva de corte de una sección rectangular." });
      add(7, { pasos: ["α = 12·EI / (L²·G·Ac)", `α = 12·${n6(b.EI)} / (${g(b.Lf)}²·${n6(b.G)}·${n6(b.Ac)})`, `α = ${g(b.alfa, 4)}`], nota: "α mide cuánto se deforma la placa por corte frente a la flexión. En vigas y columnas α = 0." });
    });
  }

  // 8 · coeficientes y [k]
  add(8, { titulo: "Matriz de rigidez de cada barra [k] (4×4)" });
  add(8, { pasos: ["[k] = | A  B −A  B |\n      | B  C −B  D |\n      |−A −B  A −B |\n      | B  D −B  C |",
    "A = 12EI / L³(1+α)   B = 6EI / L²(1+α)\nC = (4+α)EI / L(1+α)   D = (2−α)EI / L(1+α)"], nota: "Orden local: Δi, θi, Δj, θj. Con α = 0 son los coeficientes clásicos 12EI/L³, 6EI/L², 4EI/L y 2EI/L." });
  B.forEach((b) => {
    const c = coef(b);
    const brazo = (+b.brazo_ini || +b.brazo_fin) ? ` (L flexible = ${g(b.L)} − ${g(+b.brazo_ini + +b.brazo_fin)} = ${g(c.L)} m: el brazo rígido no se deforma)` : "";
    add(8, { pasos: [`${b.elem}:  L = ${g(c.L)} m, α = ${g(c.a)}${brazo}`,
      `A = 12·${n6(c.EI)} / (${g(c.L)}³·${g(1 + c.a)}) = ${n6(c.A)}     B = 6·${n6(c.EI)} / (${g(c.L)}²·${g(1 + c.a)}) = ${n6(c.B)}`,
      `C = ${g(4 + c.a)}·${n6(c.EI)} / (${g(c.L)}·${g(1 + c.a)}) = ${n6(c.C)}     D = ${g(2 - c.a)}·${n6(c.EI)} / (${g(c.L)}·${g(1 + c.a)}) = ${n6(c.D)}`],
      nota: b.exacta === false ? "Barra con tramos o rótulas: el sistema la condensa; la [k] de abajo es la que entra al cálculo." : "Se reemplazan los valores de la barra en las cuatro fórmulas." });
    add(8, { bloque: "M", M: b.K, filas: LOC, cols: LOC, titulo: `[k] ${b.elem}`, nota: "" });
  });

  // 9 · Aᵀ y aporte
  add(9, { titulo: "Aporte de cada barra: [k]T = [A]ᵀ[k][A]" });
  B.forEach((b) => {
    const cols = b.Aidx.map((c) => data.labels[c].replace(/\(.*/, ""));
    const At = b.Asub[0].map((_, c) => b.Asub.map((f) => f[c]));
    add(9, { bloque: "M", M: At, filas: cols, cols: LOC, titulo: `[A]ᵀ ${b.elem}`, nota: "La transpuesta: filas y columnas de [A] intercambiadas." });
    add(9, { bloque: "M", M: b.AtKAsub, filas: cols, cols, titulo: `[A]ᵀ[k][A] ${b.elem}`, nota: `Rigidez que ${b.elem} aporta a los GDL ${cols.join(", ")}.` });
  });

  // 10 · K
  add(10, { titulo: "Matriz de rigidez total [K] = Σ [A]ᵀ[k][A]" });
  add(10, { bloque: "M", M: data.K, filas: data.labels.map((l) => l.replace(/\(.*/, "")), cols: data.labels.map((l) => l.replace(/\(.*/, "")), nota: "Se suman en cada casilla los aportes de las barras que comparten ese par de GDL. Es simétrica." });

  // 11 · Q
  add(11, { titulo: "Vector de cargas {Q}" });
  const hayR = (data.R || []).some((v) => Math.abs(v) > 1e-12);
  if (hayR) {
    B.filter((b) => b.r.some((v) => Math.abs(v) > 1e-12)).forEach((b) => add(11, { bloque: "V", v: b.r, labels: LOC, titulo: `{r} ${b.elem}`, nota: "Fuerzas de empotramiento de la carga en la barra (antihorario +)." }));
    add(11, { bloque: "V", v: data.R, labels: data.labels, titulo: "{R} = Σ[A]ᵀ{r}", nota: "Las fuerzas de empotramiento llevadas a los GDL globales." });
  }
  add(11, { bloque: "V", v: data.Q, labels: data.labels, titulo: hayR ? "{Q} = {Q}nudos − {R}" : "{Q} = {Q}nudos", nota: "Las cargas en la dirección de cada GDL global." });

  // 12 · D
  add(12, { titulo: "Desplazamientos {D} = [K]⁻¹{Q}" });
  add(12, { bloque: "V6", v: data.D, labels: data.labels, nota: "Se resuelve el sistema. Importante: {D} se lleva con 6 cifras significativas; si se redondea (p. ej. 0.00078), las fuerzas dejan de cumplir el equilibrio." });

  // 13 · d
  add(13, { titulo: "Desplazamientos de extremo {d} = [A]{D}" });
  B.forEach((b) => add(13, { bloque: "V6", v: b.d, labels: LOC, titulo: `{d} ${b.elem}`, nota: "" }));

  // 14 · q
  add(14, { titulo: "Fuerzas de extremo {q} = [k]{d} (+ {r})" });
  B.forEach((b) => add(14, { bloque: "V", v: b.qT, labels: ["V i", "M i", "V j", "M j"], titulo: `{q} ${b.elem}`, nota: hayR ? "Fuerzas del estado complementario más las de empotramiento." : "Cortantes y momentos en los extremos (antihorario +)." }));
  // comprobación de equilibrio de cortantes en la base (lo que en FIJA PC3 no cerraba)
  const Fx = (data.Q || [])[0];
  add(14, { pasos: ["Comprobación: Σ cortantes de base = carga lateral", `Σ V = ${B.filter((b) => b.tipo !== "viga").filter((b) => Math.min(b.yi, b.yj) < 1e-9).map((b) => n6(b.qT[0])).join(" + ") || "—"}`,
    `Σ V = ${n6(B.filter((b) => b.tipo !== "viga" && Math.min(b.yi, b.yj) < 1e-9).reduce((s, b) => s + +b.qT[0], 0))}  (Q = ${n6(Fx)})`], nota: "Si estos números no coinciden, revisa el redondeo de {D} o la longitud flexible de las vigas con brazo rígido." });

  // 15 · gráficos
  if (data.diagramas?.elementos?.length) {
    add(15, { titulo: "Gráficos" });
    add(15, { bloque: "DMF", nota: "DMF: con los momentos de extremo y las cargas de tramo, del lado traccionado." });
    add(15, { bloque: "DFC", nota: "DFC: cortante a lo largo de cada barra." });
  }
  return R;
}

export default function Pizarra({ data }) {
  const R = useMemo(() => guion(data), [data]);
  const [k, setK] = useState(0);            // renglones visibles
  const [fase, setFase] = useState(0);      // 0 fórmula, 1 reemplazo, 2 resultado del renglón k
  const [play, setPlay] = useState(true);
  const [vel, setVel] = useState(1900);
  const fin = useRef(null);
  const total = R.length;

  useEffect(() => {
    if (!play) return;
    if (k >= total - 1 && fase >= 2) { setPlay(false); return; }
    const r = R[k];
    const nf = r?.pasos ? r.pasos.length : 1;
    const t = setTimeout(() => {
      if (fase < nf - 1) setFase(fase + 1);
      else { setK(Math.min(total - 1, k + 1)); setFase(0); }
    }, r?.titulo && !r?.bloque ? vel * 0.5 : r?.bloque ? vel * 1.4 : vel);
    return () => clearTimeout(t);
  }, [play, k, fase, vel, total, R]);

  useEffect(() => { fin.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [k, fase]);
  useEffect(() => {
    const h = (e) => {
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if (e.key === " ") { e.preventDefault(); setPlay((p) => !p); }
      else if (e.key === "ArrowRight") { setPlay(false); setK((x) => Math.min(total - 1, x + 1)); setFase(9); }
      else if (e.key === "ArrowLeft") { setPlay(false); setK((x) => Math.max(0, x - 1)); setFase(9); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [total]);

  const secActual = R[k]?.sec;
  const saltar = (sec) => { setPlay(false); const i = R.findIndex((r) => r.sec === sec); if (i >= 0) { setK(i); setFase(9); } };
  const secs = [...new Set(R.map((r) => r.sec))];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-6 dark:border-ink-line dark:bg-ink-2">
        <button onClick={() => { if (k >= total - 1) { setK(0); setFase(0); } setPlay((p) => !p); }} className="min-w-28 rounded-md bg-teal px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-dark" title="Reproducir / pausar (espacio)">{play ? "⏸ Pausa" : "▶ Seguir"}</button>
        <button onClick={() => { setPlay(false); setK(total - 1); setFase(9); }} className={btn}>Ver todo</button>
        <button onClick={() => { setK(0); setFase(0); setPlay(true); }} className={btn}>Desde el inicio</button>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">Ritmo
          <select value={vel} onChange={(e) => setVel(+e.target.value)} className="inp !py-0.5 text-xs">{VEL.map(([l, v]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <div className="ml-auto flex flex-wrap gap-1">
          {secs.map((s) => <button key={s} onClick={() => saltar(s)} className={`rounded-full border px-2 py-0.5 text-xs tabular-nums ${s === secActual ? "border-teal bg-teal font-semibold text-white" : s < secActual ? "border-teal/40 bg-teal/10" : "border-slate-200 text-slate-500 dark:border-ink-line"}`}>{s}</button>)}
        </div>
      </div>
      <div className="h-1 bg-slate-200 dark:bg-ink-3"><div className="h-1 bg-teal transition-all duration-500" style={{ width: `${((k + 1) / total) * 100}%` }} /></div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(#e2e8f0_1px,transparent_1px),linear-gradient(90deg,#e2e8f0_1px,transparent_1px)] bg-[size:22px_22px] p-3 sm:p-6 dark:bg-[linear-gradient(#1e293b_1px,transparent_1px),linear-gradient(90deg,#1e293b_1px,transparent_1px)]">
        <div className="mx-auto max-w-5xl space-y-3">
          {R.slice(0, k + 1).map((r, i) => <Renglon key={i} r={r} data={data} fase={i < k ? 9 : fase} />)}
          <div ref={fin} />
        </div>
      </div>
    </div>
  );
}

function Renglon({ r, data, fase }) {
  if (r.titulo && !r.bloque && !r.pasos) return <h3 className="paso-in pt-3 text-lg font-semibold text-rose-700 dark:text-rose-400"><span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-rose-700 text-sm dark:border-rose-400">{r.sec}</span>{r.titulo}</h3>;
  const cuerpo = () => {
    if (r.pasos) return (
      <div className="space-y-1 font-mono text-[13px]">
        {r.pasos.slice(0, Math.min(r.pasos.length, fase + 1)).map((t, j) => (
          <div key={j} className={`paso-in whitespace-pre-wrap ${j === r.pasos.length - 1 && r.pasos.length > 1 ? "font-semibold text-teal-dark dark:text-teal-soft" : "text-slate-800 dark:text-slate-100"}`}>{t}</div>
        ))}
      </div>
    );
    if (r.bloque === "coords") return <Coordenadas data={data} />;
    if (r.bloque === "A") return <Matriz M={r.M} filas={r.filas} columnas={r.cols} titulo={`[A] ${r.b.elem}`} />;
    if (r.bloque === "M") return <Matriz M={r.M} filas={r.filas} columnas={r.cols} titulo={r.titulo} max={30} />;
    if (r.bloque === "V") return <Vector v={r.v} labels={r.labels} titulo={r.titulo} />;
    if (r.bloque === "V6") return <V6 v={r.v} labels={r.labels} titulo={r.titulo} />;
    if (r.bloque === "DMF") return <DiagramaPaso data={data} tipo="M" />;
    if (r.bloque === "DFC") return <DiagramaPaso data={data} tipo="V" />;
    return null;
  };
  return (
    <div className="paso-in grid gap-3 rounded-lg border border-slate-200 bg-white/90 p-3 md:grid-cols-[1fr_260px] dark:border-ink-line dark:bg-ink-2/90">
      <div className="min-w-0 overflow-x-auto">{cuerpo()}</div>
      {r.nota && <p className="text-xs leading-relaxed text-slate-600 md:border-l md:border-slate-200 md:pl-3 dark:text-slate-300 dark:md:border-ink-line">{r.nota}</p>}
    </div>
  );
}

function V6({ v, labels, titulo }) {
  return (
    <div>
      {titulo && <div className="mb-2 text-sm font-semibold text-teal-dark dark:text-teal-soft">{titulo}</div>}
      <table className="text-sm tabular-nums"><tbody>
        {(v || []).map((x, k) => <tr key={k}><th className="px-2 py-1 text-left text-xs text-slate-500">{labels?.[k] ?? `D${k + 1}`}</th><td className="celda-in min-w-32 border border-slate-200 px-3 py-1 text-right font-mono dark:border-ink-line">{n6(x)}</td></tr>)}
      </tbody></table>
    </div>
  );
}

const btn = "rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-ink-line dark:hover:bg-ink-3";
