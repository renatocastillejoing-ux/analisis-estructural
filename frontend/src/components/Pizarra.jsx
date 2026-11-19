import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { pellizcoEscala } from "../pinch.js";
import { useCompacto, useHorizontal, useWakeLock } from "../movil.js";
import { HojaInferior, SelectorPaso, Segmentado, btnIcono, btnPlay } from "./BarraMovil.jsx";
import { Coordenadas, DiagramaPaso, LocalesGDL, Matriz, Vector } from "./Paso.jsx";

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
  add(2, { bloque: "coords", nota: `Se numeran ${data.labels.length} GDL globales {D}: primero los desplazamientos laterales y luego los giros de nudo.` });
  const nAct = B.reduce((s, b) => s + (b.act?.length ?? 4), 0);
  add(2, { bloque: "locales", nota: `Cada barra tiene 4 GDL locales: Δ y θ en su extremo i y en su extremo j (antihorario positivo). Con este gráfico se ve qué desplazamiento o giro de la barra se activa con cada D (ahí va el 1 en [A]). Los que nunca se mueven (empotramiento en la base, Δ de las vigas con EA = ∞) valen 0 y no se numeran: quedan ${nAct} GDL locales, d1 … d${nAct}. En columnas y placas (i abajo), Δ es positivo hacia la izquierda: por eso un desplazamiento lateral D hacia la derecha entra con −1 en [A], como en la hoja del profesor.` });

  // 3 · [A]
  add(3, { titulo: "Matriz de compatibilidad [A]: {d} = [A]{D}" });
  const DL = data.labels.map((l) => l.replace(/\(.*/, ""));
  const completa = Array.isArray(data.A) && data.A.length > 0;
  if (completa) {
    const filasA = B.flatMap((b) => (b.act ?? [0, 1, 2, 3]).map((k) => `${b.dnum[k]} ${LOC[k]} ${b.elem}`));
    add(3, { bloque: "M", M: data.A, filas: filasA, cols: DL, titulo: `[A] (${data.A.length}×${DL.length})`, ancho: true,
      nota: `Una sola matriz para toda la estructura: una fila por GDL local activo (d1 … d${data.A.length}) y una columna por GDL global (D1 … D${DL.length}). Cada columna se llena activando su D = 1 con los demás en 0 y leyendo cuánto se mueve cada d. Las filas de cada barra (de dos en dos aquí) forman su [Aᵢ].` });
    let fila = 0;
    B.forEach((b) => {
      const act = b.act ?? [0, 1, 2, 3];
      const M = data.A.slice(fila, fila + act.length); fila += act.length;
      const filas = act.map((k) => `${b.dnum[k]} ${LOC[k]}`);
      const expl = act.map((k, r) => {
        const partes = M[r].map((v, c) => (Math.abs(v) < 1e-12 ? null : `${Math.abs(v - 1) < 1e-9 ? "" : Math.abs(v + 1) < 1e-9 ? "−" : g(v) + "·"}${DL[c]}`)).filter(Boolean);
        return `${b.dnum[k]} (${LOC[k]}) = ${partes.join(" + ").replace(/\+ −/g, "− ")}`;
      });
      b._A = M; b._filasA = filas;
      add(3, { bloque: "M", M, filas, cols: DL, titulo: `[A${B.indexOf(b) + 1}] ${b.elem} (${act.length}×${DL.length})`,
        nota: `${nombre(b)}: ${expl.join(" · ")}.${act.length < 4 ? ` ${LOC.filter((_, k) => !act.includes(k)).join(" y ")} = 0 siempre, por eso no tiene fila.` : ""}` });
    });
  }
  if (!completa) B.forEach((b) => {
    const filas = (b.dnum || ["d1", "d2", "d3", "d4"]).map((d, k) => `${d} ${LOC[k]}`);
    const cols = b.Aidx.map((c) => data.labels[c].replace(/\(.*/, ""));
    const expl = [];
    b.Asub.forEach((f, r) => {
      const dn = b.dnum?.[r] || "d" + (r + 1);
      const partes = [];
      f.forEach((v, c) => {
        if (Math.abs(v) < 1e-12) return;
        const D = cols[c];
        const giro = /^D\d+\(θ/.test(data.labels[b.Aidx[c]] || "");
        const sg = v < 0 ? "−" : "";
        const av = Math.abs(v);
        if (r % 2 === 0) {
          if (giro) partes.push(`${g(v)}·${D} (brazo rígido de ${g(av)} m: el giro ${D} desplaza el borde de la parte flexible)`);
          else if (Math.abs(av - 1) < 1e-9) partes.push(`${sg}${D} (el extremo se desplaza con el piso${v < 0 ? "; signo − por el sentido local de la barra" : ""})`);
          else partes.push(`${g(v)}·${D} (proyección: factor cos/sen del ángulo de la barra respecto al desplazamiento ${D}, no es un brazo)`);
        } else if (giro) partes.push(`${sg}${D} (el extremo gira con el nudo)`);
        else partes.push(`${g(v)}·${D} (rotación de cuerda: la barra gira al desplazarse ${D}, factor sen/cos α dividido por L)`);
      });
      if (partes.length) expl.push(`${dn} (${LOC[r]}) = ${partes.join(" + ")}.`);
    });
    add(3, { bloque: "A", b, filas, cols, M: b.Asub, nota: `[A] de ${nombre(b)}: cada fila dice cuánto se mueve ese GDL local cuando se activa un GDL global (y los demás quedan fijos). ${expl.join(" ")}` });
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
    add(8, { pasos: [`${b.elem}:  L = ${g(c.L)} m, α = ${g(c.a)}${c.a ? "" : ` (${b.tipo}: no se considera la deformación por corte)`}${brazo}`,
      `A = 12·${n6(c.EI)} / (${g(c.L)}³·${g(1 + c.a)}) = ${n6(c.A)}     B = 6·${n6(c.EI)} / (${g(c.L)}²·${g(1 + c.a)}) = ${n6(c.B)}`,
      `C = ${g(4 + c.a)}·${n6(c.EI)} / (${g(c.L)}·${g(1 + c.a)}) = ${n6(c.C)}     D = ${g(2 - c.a)}·${n6(c.EI)} / (${g(c.L)}·${g(1 + c.a)}) = ${n6(c.D)}`],
      nota: b.exacta === false ? "Barra con tramos o rótulas: el sistema la condensa; la [k] de abajo es la que entra al cálculo." : c.a ? "Placa: α ≠ 0 porque se incluye la deformación por corte." : "Es la fórmula general con α = 0: en vigas y columnas no se considera la deformación por corte, así que quedan 12EI/L³, 6EI/L², 4EI/L y 2EI/L." });
    add(8, { bloque: "M", M: b.K, filas: LOC, cols: LOC, titulo: `[k] ${b.elem}`, nota: "" });
  });

  // 9 · Aᵀ y aporte
  add(9, { titulo: "Aporte de cada barra: [k]T = [A]ᵀ[k][A]" });
  B.forEach((b) => {
    const cols = b.Aidx.map((c) => data.labels[c].replace(/\(.*/, ""));
    if (b._A) {
      const act = b.act ?? [0, 1, 2, 3];
      const At = DL.map((_, c) => b._A.map((f) => f[c]));
      add(9, { bloque: "M", M: At, filas: DL, cols: b._filasA, titulo: `[A${B.indexOf(b) + 1}]ᵀ ${b.elem}`, nota: "La transpuesta de las filas de la barra en [A]: filas y columnas intercambiadas." });
      if (act.length < 4) add(9, { bloque: "M", M: act.map((r) => act.map((c) => b.K[r][c])), filas: b._filasA, cols: b._filasA, titulo: `[k] ${b.elem} en sus GDL activos`,
        nota: `De la [k] 4×4 solo entran las filas y columnas de ${b._filasA.join(", ")}; las de los GDL que valen 0 se multiplican por cero.` });
    } else {
      const At = b.Asub[0].map((_, c) => b.Asub.map((f) => f[c]));
      add(9, { bloque: "M", M: At, filas: cols, cols: LOC, titulo: `[A]ᵀ ${b.elem}`, nota: "La transpuesta: filas y columnas de [A] intercambiadas." });
    }
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

  // 15 · N y reacciones (equilibrio de nudos)
  if (data.reacciones?.length) {
    add(15, { titulo: "Fuerza normal y reacciones: equilibrio de nudos" });
    add(15, { pasos: ["ΣFx = 0   ΣFy = 0   ΣM = 0  en cada nudo", "Con EA = ∞ el método no da N: se despeja del equilibrio con los cortantes {q} ya conocidos"], nota: "Es lo que se hace a mano después de {q}: cada nudo en equilibrio entre las fuerzas de las barras, las cargas y los apoyos." });
    add(15, { bloque: "V", v: B.map((b) => +b.N || 0), labels: B.map((b) => `N ${b.elem}`), titulo: "Fuerza normal N (tracción +)", nota: "" });
    data.reacciones.forEach((r) => add(15, { pasos: [`Apoyo ${r.nudo}`, ["Rx", "Ry", "M"].filter((c) => r[c] != null).map((c) => `${c} = ${n6(r[c])}`).join("    ")], nota: "" }));
    if (data.residuo_equilibrio != null) add(15, { pasos: [`Residuo del equilibrio = ${Number(data.residuo_equilibrio).toExponential(1)}`], nota: "Prácticamente cero: las fuerzas de {q} cierran el equilibrio de todos los nudos." });
  }

  // 16 · gráficos
  if (data.diagramas?.elementos?.length) {
    add(16, { titulo: "Gráficos" });
    add(16, { bloque: "DMF", nota: "DMF: con los momentos de extremo y las cargas de tramo, del lado traccionado." });
    add(16, { bloque: "DFC", nota: "DFC: cortante a lo largo de cada barra." });
    add(16, { bloque: "DFN", nota: "DFN: fuerza normal de cada barra (del equilibrio de nudos)." });
  }
  // numeración continua (los pasos 5–7 solo existen si hay placas)
  const orden = [...new Set(R.map((r) => r.sec))];
  R.forEach((r) => { r.sec = orden.indexOf(r.sec) + 1; });
  return R;
}

// Reproductor de la hoja: una PÁGINA que se escribe sola. Los renglones se ordenan de izquierda a
// derecha y bajan de fila al llegar al borde (como en la hoja de ejercicios); cada paso empieza
// una fila nueva con su título. La animación es una línea de tiempo GSAP pausada con un «clip»
// por renglón (enfoque de HyperFrames: tiempo explícito y seek a cualquier punto): las fórmulas se
// escriben de izquierda a derecha, las matrices aparecen celda a celda y la explicación entra al
// lado. La cámara sigue lo que se está escribiendo.
export default function Pizarra({ data, menuExtra }) {
  const R = useMemo(() => guion(data), [data]);
  const raiz = useRef(null), hoja = useRef(null), tl = useRef(null);
  const [play, setPlay] = useState(true);
  const [ritmo, setRitmo] = useState(1);
  const [prog, setProg] = useState(0);
  const [secAct, setSecAct] = useState(1);
  const [completa, setCompleta] = useState(false);
  const compacto = useCompacto(), horizontal = useHorizontal();
  const [lista, setLista] = useState(false);          // línea de tiempo armada (antes: silueta)
  const [menu, setMenu] = useState(false);
  const [escala, setEscala] = useState(1);            // zoom de la hoja (pellizco o A−/A+)
  const escalaRef = useRef(1); escalaRef.current = escala;
  const [verCtrl, setVerCtrl] = useState(true);       // controles visibles en modo inmersivo
  const pausaCam = useRef(0);                         // la cámara no se mueve hasta este instante
  const lienzo = useRef(null);
  const compactoRef = useRef(compacto); compactoRef.current = compacto;
  const etiquetas = useRef({});
  const base = useRef(1);
  const secs = useMemo(() => [...new Set(R.map((r) => r.sec))], [R]);
  // la hoja se dibuja una sola vez; la animación solo cambia estilos con GSAP
  const filas = useMemo(() => R.map((r, i) => <Renglon key={i} i={i} r={r} data={data} />), [R, data]);

  // ---- línea de tiempo ----
  // se arma después de pintar la silueta (armarla tarda ~1.5 s en una hoja grande)
  useEffect(() => {
    const el = hoja.current;
    if (!el) return undefined;
    setLista(false);
    let t = null;
    const id = setTimeout(() => {
      const antes = tl.current?.progress?.() || 0;       // al pasar de escritorio a teléfono se rearma sin perder el avance
      t = armar(el);
      if (antes > 0 && antes < 1) t.progress(antes); else if (antes >= 1) t.progress(1);
      setLista(true);
    }, 30);
    return () => { clearTimeout(id); t?.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [R, compacto]);
  const armar = (el) => {
    const reducir = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // la barra de tiempo se refresca ~10 veces por segundo (no en cada cuadro: re-renderizar
    // React 60 veces por segundo con cientos de matrices bajaba la animación a 7 fps)
    let ultimoProg = 0;
    const t = gsap.timeline({ paused: true, onUpdate: () => { const a = performance.now(); if (a - ultimoProg > 100 || t.progress() >= 1) { ultimoProg = a; setProg(t.progress()); } } });
    let ultimaCam = -1;
    const camara = (nodo) => {
      const ahora = performance.now();
      if (ahora - ultimaCam < 250) return;              // sin sacudidas al hacer seek rápido
      if (ahora < pausaCam.current) return;             // el usuario está leyendo o desplazando
      ultimaCam = ahora;
      // en el teléfono el renglón en curso queda al centro (con nearest quedaba pegado al borde)
      nodo.scrollIntoView({ behavior: reducir ? "auto" : "smooth", block: compactoRef.current ? "center" : "nearest", inline: "nearest" });
    };
    etiquetas.current = {};
    const nodos = [...el.querySelectorAll("[data-renglon]")];
    // Solo opacidad y recorte (clip-path): animar y/x/scale obliga a GSAP a leer el estilo
    // calculado de cada elemento entre escrituras y, con 400 renglones y 3000 celdas, armar la
    // línea de tiempo tardaba 13 s (1.5 s así). Posiciones con un cursor propio.
    let c = 0;
    nodos.forEach((n) => {
      const i = +n.dataset.renglon, r = R[i];
      const pos = c;
      if (r.titulo && !r.bloque && !r.pasos && etiquetas.current[r.sec] == null) etiquetas.current[r.sec] = pos;
      t.call(() => { setSecAct(r.sec); camara(n); }, null, pos);
      t.fromTo(n, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, ease: "power2.out" }, pos);
      c = pos + 0.35;
      n.querySelectorAll("[data-escribe]").forEach((ln) => {
        const d = Math.min(1.2, 0.2 + (ln.textContent || "").length * 0.012);
        t.fromTo(ln, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: d, ease: "none" }, c);
        c += d;
      });
      const celdas = n.querySelectorAll("td, [data-celda]");
      if (celdas.length > 300) {
        // matriz grande: se revela entera de izquierda a derecha (celda a celda sería muy pesado)
        t.fromTo(n.firstElementChild, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 1.2, ease: "power1.inOut" }, c);
        c += 1.2;
      } else if (celdas.length) {
        const total = Math.min(1.2, 0.3 + celdas.length * 0.008);
        t.fromTo(celdas, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.18, stagger: { amount: total }, ease: "power1.out" }, c - 0.1);
        c += total + 0.08;
      }
      const nota = n.querySelector("[data-nota]");
      if (nota) { t.fromTo(nota, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, c - 0.15); c += 0.25; }
      c += r.titulo && !r.bloque && !r.pasos ? 0.15 : 0.3;      // respiro entre renglones
    });
    tl.current = t;
    // ritmo adaptado al tamaño: una hoja larga se acelera sola hasta durar ~2.5 min (máx. ×4)
    base.current = Math.min(4, Math.max(1, t.duration() / 150));
    t.timeScale(ritmo * base.current);
    if (reducir) { t.progress(1); setPlay(false); } else if (play) t.play();
    return t;
  };

  useEffect(() => { tl.current?.timeScale(ritmo * base.current); }, [ritmo]);
  useEffect(() => { const t = tl.current; if (!t) return; if (play) { if (t.progress() >= 1) t.restart(); else t.play(); } else t.pause(); }, [play]);
  useEffect(() => { if (prog >= 1) setPlay(false); }, [prog]);
  useWakeLock(play && lista);                           // la pantalla no se apaga mientras se escribe

  // pellizco sobre la hoja (teléfono y tablet)
  useEffect(() => pellizcoEscala(lienzo.current, () => escalaRef.current, setEscala, { min: 0.5, max: 2.5 }), [compacto]);
  // tocar, arrastrar o girar la rueda sobre la hoja pausa la cámara automática ~4 s
  const pausarCamara = () => { if (compacto) pausaCam.current = performance.now() + 4000; };

  // modo inmersivo (teléfono en pantalla completa): fuera cabecera, pie y selector; controles en
  // cápsula flotante que se esconde sola a los 3 s mientras reproduce
  const inmersivo = completa && compacto;
  useEffect(() => {
    if (!inmersivo) return undefined;
    document.documentElement.classList.add("inmersivo");
    return () => document.documentElement.classList.remove("inmersivo");
  }, [inmersivo]);
  useEffect(() => { if (!inmersivo) setVerCtrl(true); }, [inmersivo]);
  useEffect(() => {
    if (!inmersivo || !verCtrl || !play || menu) return undefined;
    const t = setTimeout(() => setVerCtrl(false), 3000);
    return () => clearTimeout(t);
  }, [inmersivo, verCtrl, play, menu]);

  // ---- teclado y pantalla completa ----
  const irA = (sec) => { const p = etiquetas.current[sec]; if (p == null) return; setPlay(false); tl.current?.seek(p + 0.01); };
  useEffect(() => {
    const h = (e) => {
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if (e.key === " ") { e.preventDefault(); setPlay((p) => !p); }
      else if (e.key === "ArrowRight") { e.preventDefault(); irA(Math.min(secs[secs.length - 1], secAct + 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); irA(Math.max(1, secAct - 1)); }
      else if (e.key === "f" || e.key === "F") alternarCompleta();
      else if (e.key === "Escape" && completa && !document.fullscreenElement) setCompleta(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  useEffect(() => {
    const h = () => setCompleta(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);
  const alternarCompleta = () => {
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    if (completa) { setCompleta(false); return; }
    // en el teléfono se pide la pantalla completa de toda la página (así el menú ⋯ sigue visible)
    const p = (compacto ? document.documentElement : raiz.current)?.requestFullscreen?.();
    if (p?.catch) p.catch(() => setCompleta(true)); else if (!p) setCompleta(true);   // sin API (iPhone): ocupa la ventana
  };

  const total = tl.current?.duration() || 1;
  const fondoHoja = "bg-[linear-gradient(#e2e8f0_1px,transparent_1px),linear-gradient(90deg,#e2e8f0_1px,transparent_1px)] bg-[size:22px_22px] dark:bg-[linear-gradient(#1e293b_1px,transparent_1px),linear-gradient(90deg,#1e293b_1px,transparent_1px)]";
  const hojaNodo = (
    <div ref={hoja} className="hoja-gsap flex flex-wrap content-start items-start gap-3" style={escala !== 1 ? { zoom: escala } : undefined}>
      {filas}
    </div>
  );
  const silueta = !lista && (
    <div className="silueta pointer-events-none absolute inset-x-3 top-3 space-y-3 sm:inset-x-6 sm:top-6" aria-hidden="true">
      <div className="h-7 w-2/3 max-w-md rounded-md bg-slate-200 dark:bg-ink-3" />
      <div className="h-24 rounded-lg bg-slate-200 dark:bg-ink-3" />
      <div className="h-40 rounded-lg bg-slate-200 dark:bg-ink-3" />
    </div>
  );
  const tiempo = (
    <input type="range" min={0} max={1000} value={Math.round(prog * 1000)} aria-label="Avance de la resolución" disabled={!lista}
      onChange={(e) => { setPlay(false); tl.current?.progress(+e.target.value / 1000); }}
      className="tiempo w-full" style={{ "--p": `${prog * 100}%` }} />
  );

  if (compacto) {
    const titulos = Object.fromEntries(R.filter((r) => r.titulo && !r.bloque && !r.pasos).map((r) => [r.sec, r.titulo]));
    const ultimo = secs[secs.length - 1];
    const vertical = horizontal && !inmersivo;            // teléfono en horizontal: franja de controles a la izquierda
    const controles = (
      <div className={vertical ? "flex h-full w-16 shrink-0 flex-col items-center justify-center gap-1.5 border-r border-slate-200 bg-white py-2 pl-[env(safe-area-inset-left)] dark:border-ink-line dark:bg-ink-2"
        : "flex h-14 items-center gap-1 px-2"}>
        <button onClick={() => setPlay((p) => !p)} className={btnPlay} disabled={!lista} aria-label={play ? "Pausa" : prog >= 1 ? "Repetir" : "Reproducir"}>{play ? "⏸" : prog >= 1 ? "↺" : "▶"}</button>
        <button onClick={() => irA(Math.max(1, secAct - 1))} className={btnIcono} aria-label="Paso anterior">◀</button>
        <SelectorPaso actual={secAct} total={ultimo} vertical={vertical} onElegir={(v) => irA(+v)}
          opciones={secs.map((x) => ({ valor: x, actual: x === secAct, texto: `Paso ${x} · ${titulos[x] || ""}` }))} />
        <button onClick={() => irA(Math.min(ultimo, secAct + 1))} className={btnIcono} aria-label="Paso siguiente">▶</button>
        <button onClick={() => setMenu(true)} className={`${btnIcono} ${vertical ? "" : "ml-auto"}`} aria-label="Más opciones">⋯</button>
      </div>
    );
    return (
      <div ref={raiz} className={`flex min-h-0 flex-1 bg-slate-50 dark:bg-ink ${vertical ? "flex-row" : "flex-col"} ${completa ? "fixed inset-0 z-[60]" : ""}`}>
        {!inmersivo && vertical && controles}
        {!inmersivo && !vertical && (
          <div className="relative shrink-0 border-b border-slate-200 bg-white dark:border-ink-line dark:bg-ink-2">
            {controles}
            <div className="absolute inset-x-0 -bottom-3 z-10 px-1">{tiempo}</div>
          </div>
        )}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {!inmersivo && vertical && <div className="shrink-0 border-b border-slate-200 bg-white px-2 dark:border-ink-line dark:bg-ink-2">{tiempo}</div>}
          <div ref={lienzo} onPointerDown={pausarCamara} onWheel={pausarCamara} onTouchMove={pausarCamara}
            onClick={() => { if (inmersivo) setVerCtrl((v) => !v); }}
            className={`relative min-h-0 flex-1 overflow-auto overscroll-contain p-3 ${inmersivo ? "pb-28 pt-[max(.75rem,env(safe-area-inset-top))]" : ""} ${fondoHoja}`}>
            {silueta}
            {hojaNodo}
          </div>
        </div>
        {inmersivo && (
          <div className={`capsula pad-seguro-x fixed inset-x-0 bottom-0 z-[65] ${verCtrl ? "" : "capsula-oculta"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white/95 px-1 pt-1 shadow-xl backdrop-blur dark:border-ink-line dark:bg-ink-2/95">
              <div className="px-2">{tiempo}</div>
              {controles}
            </div>
          </div>
        )}
        <HojaInferior abierta={menu} onCerrar={() => setMenu(false)} titulo="Opciones de la hoja">
          {menuExtra}
          <Segmentado etiqueta="Ritmo" valor={ritmo} onCambiar={setRitmo} opciones={[[0.6, "Lento"], [1, "Normal"], [1.8, "Rápido"], [3.5, "Muy r."], [8, "×8"]]} />
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-slate-500 dark:text-slate-400">Letra</span>
            <button onClick={() => setEscala((e) => Math.max(0.5, +(e - 0.15).toFixed(2)))} className={btn} aria-label="Hoja más chica">A−</button>
            <span className="w-12 text-center text-xs tabular-nums">{Math.round(escala * 100)} %</span>
            <button onClick={() => setEscala((e) => Math.min(2.5, +(e + 0.15).toFixed(2)))} className={btn} aria-label="Hoja más grande">A+</button>
            <span className="ml-auto text-xs text-slate-500">o pellizca la hoja</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { setMenu(false); setPlay(false); tl.current?.progress(1); }} className={btn}>Ver todo</button>
            <button onClick={() => { setMenu(false); alternarCompleta(); }} className={btn}>{completa ? "⤡ Salir de pantalla completa" : "⛶ Pantalla completa"}</button>
          </div>
          <p className="text-center text-xs tabular-nums text-slate-500">{Math.round(prog * 100)} % · faltan {Math.max(0, Math.round((1 - prog) * total / (ritmo * base.current)))} s</p>
        </HojaInferior>
      </div>
    );
  }

  return (
    <div ref={raiz} className={`flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-ink ${completa ? "fixed inset-0 z-[60]" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-6 dark:border-ink-line dark:bg-ink-2">
        <button onClick={() => setPlay((p) => !p)} className="min-h-9 min-w-28 rounded-md bg-teal px-4 text-sm font-semibold text-white hover:bg-teal-dark" title="Reproducir / pausar (espacio)">{play ? "⏸ Pausa" : prog >= 1 ? "↺ Repetir" : "▶ Seguir"}</button>
        <button onClick={() => { setPlay(false); tl.current?.progress(1); }} className={btn}>Ver todo</button>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">Ritmo
          <select value={ritmo} onChange={(e) => setRitmo(+e.target.value)} className="inp !py-0.5 text-xs">
            {[["Lento", 0.6], ["Normal", 1], ["Rápido", 1.8], ["Muy rápido", 3.5], ["×8", 8]].map(([l, v]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <button onClick={alternarCompleta} className={btn} title="Pantalla completa (F)">{completa ? "⤡ Salir" : "⛶ Pantalla completa"}</button>
        <div className="ml-auto flex flex-wrap gap-1">
          {secs.map((s) => <button key={s} onClick={() => irA(s)} className={`min-h-7 min-w-7 rounded-full border px-2 text-xs tabular-nums ${s === secAct ? "border-teal bg-teal font-semibold text-white" : s < secAct ? "border-teal/40 bg-teal/10" : "border-slate-200 text-slate-500 dark:border-ink-line"}`}>{s}</button>)}
        </div>
      </div>
      {/* barra de tiempo: se puede arrastrar hacia atrás y hacia adelante */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-1 sm:px-6 dark:border-ink-line dark:bg-ink-2">
        <input type="range" min={0} max={1000} value={Math.round(prog * 1000)} aria-label="Avance de la resolución"
          onChange={(e) => { setPlay(false); tl.current?.progress(+e.target.value / 1000); }} className="h-2 flex-1 accent-teal-600" />
        <span className="w-24 text-right text-xs tabular-nums text-slate-500">{Math.round(prog * 100)} % · {Math.max(0, Math.round((1 - prog) * total / (ritmo * base.current)))} s</span>
      </div>
      <div ref={lienzo} onPointerDown={pausarCamara} onWheel={pausarCamara} onTouchMove={pausarCamara} className={`relative min-h-0 flex-1 overflow-auto p-3 sm:p-6 ${fondoHoja}`}>
        {silueta}
        {hojaNodo}
      </div>
    </div>
  );
}

function Renglon({ r, data, i }) {
  if (r.titulo && !r.bloque && !r.pasos) return (
    <h3 data-renglon={i} style={{ visibility: "hidden" }} className="basis-full pt-3 text-lg font-semibold text-rose-700 dark:text-rose-400">
      <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-rose-700 text-sm dark:border-rose-400">{r.sec}</span>
      <span data-escribe className="inline-block">{r.titulo}</span>
    </h3>
  );
  const cuerpo = () => {
    if (r.pasos) return (
      <div className="space-y-1 font-mono text-[13px]">
        {r.pasos.map((t, j) => (
          <div key={j} data-escribe className={`whitespace-pre-wrap ${j === r.pasos.length - 1 && r.pasos.length > 1 ? "font-semibold text-teal-dark dark:text-teal-soft" : "text-slate-800 dark:text-slate-100"}`}>{t}</div>
        ))}
      </div>
    );
    if (r.bloque === "coords") return <Coordenadas data={data} />;
    if (r.bloque === "locales") return <LocalesGDL data={data} />;
    if (r.bloque === "A") return <Matriz M={r.M} filas={r.filas} columnas={r.cols} titulo={`[A] ${r.b.elem}`} />;
    if (r.bloque === "M") return <Matriz M={r.M} filas={r.filas} columnas={r.cols} titulo={r.titulo} max={30} />;
    if (r.bloque === "V") return <Vector v={r.v} labels={r.labels} titulo={r.titulo} />;
    if (r.bloque === "V6") return <V6 v={r.v} labels={r.labels} titulo={r.titulo} />;
    if (r.bloque === "DMF") return <DiagramaPaso data={data} tipo="M" />;
    if (r.bloque === "DFC") return <DiagramaPaso data={data} tipo="V" />;
    if (r.bloque === "DFN") return <DiagramaPaso data={data} tipo="N" />;
    return null;
  };
  const ancho = r.bloque === "DMF" || r.bloque === "DFC" || r.bloque === "DFN" || r.bloque === "coords" || r.bloque === "locales" ? "basis-full" : "max-w-full";
  return (
    <div data-renglon={i} style={{ visibility: "hidden" }} className={`${ancho} flex min-w-0 flex-col gap-3 rounded-lg border border-slate-200 bg-white/90 p-3 shadow-sm sm:flex-row dark:border-ink-line dark:bg-ink-2/90`}>
      <div className="min-w-0 overflow-x-auto">{cuerpo()}</div>
      {r.nota && <p data-nota className="max-w-[240px] text-xs leading-relaxed text-slate-600 sm:border-l sm:border-slate-200 sm:pl-3 dark:text-slate-300 dark:sm:border-ink-line">{r.nota}</p>}
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
