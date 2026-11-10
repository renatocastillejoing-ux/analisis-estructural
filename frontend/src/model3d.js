// Modelo 3D (pórtico espacial): mismo formato que espera /api/calcular3d.
// Coordenadas: x, y en planta; z hacia arriba. Unidades tonf y m.

export const APOYOS3D = [["libre", "Libre"], ["empotrado", "Empotrado"], ["articulado", "Articulado"]];
const TOL = 1e-6;
const r6 = (v) => Math.round(+v * 1e6) / 1e6;
export const nextId = (arr) => (arr.length ? Math.max(...arr.map((x) => x.id || 0)) + 1 : 1);
export const es3d = (m) => m?.tipo === "3d";

export function modelo3dVacio(nombre = "Nuevo modelo 3D") {
  return {
    tipo: "3d", nombre, unidad_fuerza: "tonf", unidad_longitud: "m",
    ejes: { x: [{ nombre: "1", c: 0 }, { nombre: "2", c: 5 }], y: [{ nombre: "A", c: 0 }, { nombre: "B", c: 5 }] },
    niveles: [{ nombre: "Base", z: 0 }, { nombre: "Piso 1", z: 3 }],
    materiales: [{ nombre: "C210", modo: "fc", fc: 210, densidad: 2.4, nu: 0.2 }], material: "C210",
    secciones: [{ nombre: "C40", b: 0.4, h: 0.4 }, { nombre: "V30x50", b: 0.3, h: 0.5 }],
    nudos: [], elementos: [],
    casos: [{ nombre: "CM" }, { nombre: "CV" }],
    cargas_area: [], cargas_barras: [], cargas_nudos: [],
    peso_propio: true, caso_peso_propio: "CM", diafragma: true,
    sismo: { activo: false, Z: 0.35, U: 1, S: 1.15, R: 8, TP: 0.6, TL: 2, CT: 35, periodo: "norma", caso_masa: { CM: 1, CV: 0.25 } },
    combinaciones: [],
    secc_col: "C40", secc_viga: "V30x50",
  };
}

// Edificio regular en grilla: columnas en todas las intersecciones, vigas en ambas direcciones.
export function generarEdificio({ nombre = "Edificio", lucesX = [5, 5], lucesY = [5], alturas = [3], pisos = 3,
  col = { b: 0.4, h: 0.4 }, viga = { b: 0.3, h: 0.5 }, fc = 210, cm = 0.4, cv = 0.25, sismo = false }) {
  const m = modelo3dVacio(nombre);
  const acum = (ls) => ls.reduce((a, l) => [...a, r6(a[a.length - 1] + +l)], [0]);
  const xs = acum(lucesX), ys = acum(lucesY);
  const zs = [0]; for (let p = 0; p < pisos; p++) zs.push(r6(zs[p] + +(alturas[p] ?? alturas[alturas.length - 1])));
  m.ejes = { x: xs.map((c, k) => ({ nombre: String(k + 1), c })), y: ys.map((c, k) => ({ nombre: String.fromCharCode(65 + k), c })) };
  m.niveles = zs.map((z, k) => ({ nombre: k ? `Piso ${k}` : "Base", z }));
  m.materiales = [{ nombre: `C${fc}`, modo: "fc", fc, densidad: 2.4, nu: 0.2 }]; m.material = `C${fc}`;
  const cn = `C${Math.round(col.b * 100)}x${Math.round(col.h * 100)}`, vn = `V${Math.round(viga.b * 100)}x${Math.round(viga.h * 100)}`;
  m.secciones = [{ nombre: cn, ...col }, { nombre: vn, ...viga }]; m.secc_col = cn; m.secc_viga = vn;
  zs.forEach((z) => ys.forEach((y) => xs.forEach((x) => agregarNudo3d(m, x, y, z))));
  for (let p = 0; p < pisos; p++) ys.forEach((y) => xs.forEach((x) => agregarBarra(m, buscarNudo(m, x, y, zs[p]), buscarNudo(m, x, y, zs[p + 1]), cn)));
  zs.slice(1).forEach((z) => {
    ys.forEach((y) => xs.slice(0, -1).forEach((x, k) => agregarBarra(m, buscarNudo(m, x, y, z), buscarNudo(m, xs[k + 1], y, z), vn)));
    xs.forEach((x) => ys.slice(0, -1).forEach((y, k) => agregarBarra(m, buscarNudo(m, x, y, z), buscarNudo(m, x, ys[k + 1], z), vn)));
  });
  m.cargas_area = zs.slice(1).flatMap((z) => [{ z, caso: "CM", q: cm }, { z, caso: "CV", q: cv }]);
  m.sismo.activo = !!sismo;
  return m;
}

// Un pórtico 2D del editor, repetido a lo largo de Y y unido con vigas transversales.
export function extruirPortico(m2, { copias = 3, separacion = 5, vigaT = { b: 0.3, h: 0.5 }, cm = 0.4, cv = 0.25 }) {
  const m = modelo3dVacio(`${m2.nombre} (3D)`);
  const xs = [...new Set(m2.nudos.map((n) => r6(n.x)))].sort((a, b) => a - b);
  const zs = [...new Set(m2.nudos.map((n) => r6(n.y)))].sort((a, b) => a - b);
  const ys = Array.from({ length: copias }, (_, k) => r6(k * separacion));
  m.ejes = { x: xs.map((c, k) => ({ nombre: String(k + 1), c })), y: ys.map((c, k) => ({ nombre: String.fromCharCode(65 + k), c })) };
  m.niveles = zs.map((z, k) => ({ nombre: k ? `Nivel ${k}` : "Base", z }));
  const mat = m2.material?.modo === "E" ? { nombre: "MAT", modo: "E", E: m2.material.E, densidad: 2.4, nu: 0.2 } : { nombre: `C${m2.material?.fc || 210}`, modo: "fc", fc: m2.material?.fc || 210, densidad: 2.4, nu: 0.2 };
  m.materiales = [mat]; m.material = mat.nombre;
  m.secciones = m2.secciones.map((s) => (s.modo === "AI" ? { nombre: s.nombre, b: 0.3, h: Math.sqrt(12 * s.I / s.A) || 0.5 } : { nombre: s.nombre, b: +s.b, h: +s.h }));
  const vt = `VT${Math.round(vigaT.b * 100)}x${Math.round(vigaT.h * 100)}`;
  m.secciones.push({ nombre: vt, ...vigaT }); m.secc_viga = vt; m.secc_col = m2.secciones[0]?.nombre;
  const apoyo = (a) => (a === "empotrado" ? "empotrado" : a === "libre" ? "libre" : "articulado");
  const mapa = {};
  ys.forEach((y) => m2.nudos.forEach((n) => { mapa[`${n.id}|${y}`] = agregarNudo3d(m, +n.x, y, +n.y, apoyo(n.apoyo)); }));
  ys.forEach((y) => m2.elementos.forEach((e) => agregarBarra(m, mapa[`${e.i}|${y}`], mapa[`${e.j}|${y}`], e.seccion)));
  m2.nudos.filter((n) => n.apoyo === "libre").forEach((n) => ys.slice(0, -1).forEach((y, k) => agregarBarra(m, mapa[`${n.id}|${y}`], mapa[`${n.id}|${ys[k + 1]}`], vt)));
  m.cargas_area = zs.slice(1).flatMap((z) => [{ z, caso: "CM", q: cm }, { z, caso: "CV", q: cv }]);
  return m;
}

export function buscarNudo(m, x, y, z) {
  return m.nudos.find((n) => Math.abs(n.x - x) < TOL && Math.abs(n.y - y) < TOL && Math.abs(n.z - z) < TOL)?.id;
}

export function agregarNudo3d(m, x, y, z, apoyo) {
  const ya = buscarNudo(m, x, y, z);
  if (ya) return ya;
  const id = nextId(m.nudos);
  const zmin = Math.min(0, ...m.niveles.map((n) => +n.z));
  m.nudos.push({ id, nombre: `N${id}`, x: r6(x), y: r6(y), z: r6(z), apoyo: apoyo || (Math.abs(z - zmin) < TOL ? "empotrado" : "libre") });
  return id;
}

export function agregarBarra(m, i, j, seccion) {
  if (!i || !j || i === j) return null;
  if (m.elementos.some((e) => (e.i === i && e.j === j) || (e.i === j && e.j === i))) return null;
  const id = nextId(m.elementos);
  const a = m.nudos.find((n) => n.id === i), b = m.nudos.find((n) => n.id === j);
  const vertical = a && b && Math.abs(a.x - b.x) < TOL && Math.abs(a.y - b.y) < TOL;
  m.elementos.push({ id, nombre: `${vertical ? "C" : "V"}${id}`, i, j, seccion: seccion || (vertical ? m.secc_col : m.secc_viga) || m.secciones[0]?.nombre, giro: 0 });
  return id;
}

export function borrarNudo3d(m, id) {
  const els = new Set(m.elementos.filter((e) => e.i === id || e.j === id).map((e) => e.id));
  m.nudos = m.nudos.filter((n) => n.id !== id);
  m.elementos = m.elementos.filter((e) => !els.has(e.id));
  m.cargas_barras = (m.cargas_barras || []).filter((c) => !els.has(c.elem));
  m.cargas_nudos = (m.cargas_nudos || []).filter((c) => c.nudo !== id);
}

export function borrarBarra(m, id) {
  m.elementos = m.elementos.filter((e) => e.id !== id);
  m.cargas_barras = (m.cargas_barras || []).filter((c) => c.elem !== id);
}

// Quita nudos que quedaron sin barras (salvo los que tienen cargas).
export function limpiarNudos(m) {
  const usados = new Set(m.elementos.flatMap((e) => [e.i, e.j]));
  const conCarga = new Set((m.cargas_nudos || []).map((c) => c.nudo));
  m.nudos = m.nudos.filter((n) => usados.has(n.id) || conCarga.has(n.id));
}

export function tipoBarra(m, e) {
  const a = m.nudos.find((n) => n.id === e.i), b = m.nudos.find((n) => n.id === e.j);
  if (!a || !b) return "barra";
  if (Math.abs(a.x - b.x) < TOL && Math.abs(a.y - b.y) < TOL) return "columna";
  if (Math.abs(a.z - b.z) > TOL) return "diagonal";
  return Math.abs(a.y - b.y) < TOL ? "viga_x" : Math.abs(a.x - b.x) < TOL ? "viga_y" : "viga";
}

export function validar3d(m) {
  const errores = [], avisos = [];
  if (!m.nudos.length) errores.push("El modelo no tiene nudos.");
  if (!m.elementos.length) errores.push("El modelo no tiene barras.");
  if (m.nudos.length && !m.nudos.some((n) => n.apoyo !== "libre")) errores.push("No hay apoyos: la estructura es inestable.");
  const secs = new Set(m.secciones.map((s) => s.nombre));
  m.elementos.forEach((e) => { if (!secs.has(e.seccion)) errores.push(`${e.nombre} usa la sección «${e.seccion}», que no existe.`); });
  (m.cargas_barras || []).forEach((c) => {
    if (c.tipo !== "puntual" || c.a == null || c.a === "") return;
    const e = m.elementos.find((x) => x.id === c.elem); if (!e) return;
    const a = m.nudos.find((n) => n.id === e.i), b = m.nudos.find((n) => n.id === e.j); if (!a || !b) return;
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (+c.a < 0 || +c.a > L + 1e-9) errores.push(`La carga puntual de ${e.nombre} está en a = ${c.a} m, fuera de la barra (0 a ${L.toFixed(2)} m).`);
  });
  const usados = new Set(m.elementos.flatMap((e) => [e.i, e.j]));
  const sueltos = m.nudos.filter((n) => !usados.has(n.id)).length;
  if (sueltos) avisos.push(`${sueltos} nudos sin barras (Herramientas › Limpiar nudos sueltos).`);
  if (!(m.cargas_area || []).length && !(m.cargas_barras || []).length && !(m.cargas_nudos || []).length && !m.peso_propio && !m.sismo?.activo) avisos.push("No hay cargas aplicadas.");
  if (m.sismo?.activo && !m.diafragma) avisos.push("El sismo necesita el diafragma rígido activado.");
  return { errores, avisos };
}

// Modelo 2D → escena del visor: misma forma que escenaModelo pero desde el modelo 3D.
export function escena3d(m, { resultado, caso, modo = "geometria", escala = 1, sel, nudos: conNudos = false } = {}) {
  const por = Object.fromEntries(m.nudos.map((n, k) => [n.id, { n, k }]));
  const secs = Object.fromEntries(m.secciones.map((s) => [s.nombre, s]));
  const u = resultado && caso ? resultado.desp?.[caso] : null;
  let fx = 0;
  if (u && modo === "deformada") {
    const xs = m.nudos.map((n) => n.x), ys = m.nudos.map((n) => n.y), zs = m.nudos.map((n) => n.z);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs), 1);
    const dmax = Math.max(1e-12, ...u.map((d) => Math.hypot(d[0], d[1], d[2])));
    fx = (0.06 * span / dmax) * escala;
  }
  const pos = (id) => {
    const { n, k } = por[id];
    return u && fx ? [n.x + u[k][0] * fx, n.y + u[k][1] * fx, n.z + u[k][2] * fx] : [n.x, n.y, n.z];
  };
  const val = resultado && caso && ["M", "N", "V"].includes(modo) ? resultado.barras?.[caso]?.[modo] : null;
  const vmax = val ? Math.max(1e-9, ...val.map(Math.abs)) : 1;
  const idxRes = resultado ? Object.fromEntries((resultado.elementos || []).map((e, k) => [e.id, k])) : {};
  const miembros = [];
  m.elementos.forEach((e) => {
    if (!por[e.i] || !por[e.j]) return;
    const s = secs[e.seccion] || { b: 0.3, h: 0.3 };
    const t = tipoBarra(m, e);
    const vertical = t === "columna";
    let color;
    if (modo === "diseno" && resultado?.diseno) {
      const dd = resultado.diseno[idxRes[e.id]];
      color = !dd ? "#94a3b8" : dd.estado === "cumple" ? "#16a34a" : "#e11d48";
    } else if (val) {
      const v = val[idxRes[e.id]] ?? 0, f = Math.min(1, Math.abs(v) / vmax);
      color = modo === "N" ? (v < 0 ? `hsl(220, 70%, ${85 - 45 * f}%)` : `hsl(0, 70%, ${85 - 45 * f}%)`) : `hsl(${200 - 200 * f}, 75%, ${55 - 10 * f}%)`;
    }
    const a = pos(e.i), b = pos(e.j);
    miembros.push({
      id: e.id, a, b, w: vertical ? +s.b : +s.h, d: vertical ? +s.h : +s.b,
      wDir: vertical ? (((+e.giro || 0) % 180 === 90) ? [0, 1, 0] : [1, 0, 0]) : [0, 0, 1],
      tipo: vertical && Math.max(+s.b / +s.h, +s.h / +s.b) >= 4 ? "placa" : t, color, piso: null, grupos: [],
      info: `${e.nombre} · ${e.seccion}${val ? ` · ${modo} = ${(val[idxRes[e.id]] ?? 0).toFixed(2)}` : ""}${modo === "diseno" && resultado?.diseno?.[idxRes[e.id]] ? ` · ${resultado.diseno[idxRes[e.id]].estado}` : ""}`,
      sel: sel?.tipo === "elemento" && sel.id === e.id,
    });
  });
  const apoyos = m.nudos.filter((n) => n.apoyo !== "libre").map((n) => ({ p: [n.x, n.y, n.z], tipo: n.apoyo }));
  const etiquetas = [
    ...(m.ejes?.x || []).map((e) => ({ texto: e.nombre, p: [e.c, Math.min(...(m.ejes?.y || [{ c: 0 }]).map((q) => q.c)) - 2.5, 0], grupo: `X:${e.c}` })),
    ...(m.ejes?.y || []).map((e) => ({ texto: e.nombre, p: [Math.max(...(m.ejes?.x || [{ c: 0 }]).map((q) => q.c)) + 2.5, e.c, 0], grupo: `Y:${e.c}` })),
  ];
  const ejes = [
    ...(m.ejes?.x || []).map((e) => ({ a: [e.c, Math.min(...m.ejes.y.map((q) => q.c)) - 1, 0], b: [e.c, Math.max(...m.ejes.y.map((q) => q.c)) + 1, 0] })),
    ...(m.ejes?.y || []).map((e) => ({ a: [Math.min(...m.ejes.x.map((q) => q.c)) - 1, e.c, 0], b: [Math.max(...m.ejes.x.map((q) => q.c)) + 1, e.c, 0] })),
  ];
  const nudos = conNudos ? m.nudos.map((n) => ({ id: n.id, nombre: n.nombre, p: pos(n.id), apoyo: n.apoyo, sel: sel?.tipo === "nudo" && sel.id === n.id, info: `Nudo ${n.nombre} (${n.x}, ${n.y}, ${n.z})` })) : [];
  return { miembros, losas: [], apoyos, etiquetas, ejes, pisos: 0, nudos };
}

/* ----------------------------- armado con pórticos ----------------------------- */
const LETRA = (k) => (k < 26 ? String.fromCharCode(65 + k) : `A${k - 25}`);

function asegurarEje(m, dir, c) {
  const lista = m.ejes[dir];
  if (lista.some((e) => Math.abs(e.c - c) < 1e-6)) return;
  lista.push({ nombre: dir === "x" ? String(lista.length + 1) : LETRA(lista.length), c: r6(c) });
  lista.sort((a, b) => a.c - b.c);
}
function asegurarNivel(m, z) {
  if (m.niveles.some((n) => Math.abs(n.z - z) < 1e-6)) return;
  m.niveles.push({ nombre: `Nivel ${m.niveles.length}`, z: r6(z) });
  m.niveles.sort((a, b) => a.z - b.z);
}

// Coloca un pórtico 2D del editor en el modelo 3D: dirección por ángulo en planta
// (0° = a lo largo de X, 90° = a lo largo de Y), origen (x0, y0) y cota base z0.
// Los nudos coincidentes se unen solos, así que dos pórticos que se cruzan comparten columnas.
export function insertarPortico(m, m2, { angulo = 0, x0 = 0, y0 = 0, z0 = 0, caso = "CM" } = {}) {
  const t = (angulo * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const P = (u, v) => [r6(x0 + u * c), r6(y0 + u * s), r6(z0 + v)];
  // secciones
  m2.secciones.forEach((sc) => {
    if (m.secciones.some((q) => q.nombre === sc.nombre)) return;
    m.secciones.push(sc.modo === "AI" ? { nombre: sc.nombre, b: 0.3, h: Math.sqrt((12 * sc.I) / sc.A) || 0.5 } : { nombre: sc.nombre, b: +sc.b, h: +sc.h });
  });
  // material del pórtico (si no existe uno equivalente)
  const mat2 = m2.material || {};
  const nomMat = mat2.modo === "E" ? `E${Math.round(mat2.E)}` : `C${mat2.fc || 210}`;
  if (!(m.materiales || []).some((x) => x.nombre === nomMat)) (m.materiales ||= []).push(mat2.modo === "E" ? { nombre: nomMat, modo: "E", E: mat2.E, densidad: 2.4, nu: 0.2 } : { nombre: nomMat, modo: "fc", fc: mat2.fc || 210, densidad: 2.4, nu: 0.2 });
  (m2.materiales || []).forEach((x) => { if (x?.nombre && !m.materiales.some((q) => q.nombre === x.nombre)) m.materiales.push({ nombre: x.nombre, modo: x.modo || "fc", fc: x.fc, E: x.E, densidad: x.densidad ?? 2.4, nu: x.nu ?? 0.2 }); });
  // ejes y niveles
  const recto = Math.abs(s) < 1e-9 || Math.abs(c) < 1e-9;
  m2.nudos.forEach((n) => {
    const [x, y, z] = P(+n.x, +n.y);
    asegurarNivel(m, z);
    if (recto) { if (Math.abs(s) < 1e-9) { asegurarEje(m, "x", x); asegurarEje(m, "y", y); } else { asegurarEje(m, "y", y); asegurarEje(m, "x", x); } }
  });
  const zmin = Math.min(...m.niveles.map((q) => q.z));
  const apoyo = (a, z) => (a === "empotrado" ? "empotrado" : a === "libre" ? "libre" : "articulado");
  const mapa = {};
  m2.nudos.forEach((n) => {
    const [x, y, z] = P(+n.x, +n.y);
    const ya = buscarNudo(m, x, y, z);
    mapa[n.id] = agregarNudo3d(m, x, y, z, apoyo(n.apoyo, z));
    if (ya && n.apoyo !== "libre") m.nudos.find((q) => q.id === ya).apoyo = apoyo(n.apoyo, z);
  });
  const nuevos = [];
  m2.elementos.forEach((e) => {
    const id = agregarBarra(m, mapa[e.i], mapa[e.j], e.seccion);
    if (!id) return;
    const el = m.elementos.find((q) => q.id === id);
    el.nombre = e.nombre && !m.elementos.some((q) => q.id !== id && q.nombre === e.nombre) ? e.nombre : el.nombre;
    if (tipoBarra(m, el) === "columna") el.giro = Math.abs(s) > 0.7 ? 0 : 90;   // el peralte h queda en el plano del pórtico
    el.material = e.material || nomMat;
    if (e.release_i) el.release_i = true;
    if (e.release_j) el.release_j = true;
    if ((e.segmentos || e.tramos || []).length >= 2) el.segmentos = structuredClone(e.segmentos || e.tramos);
    nuevos.push({ id2: e.id, id });
  });
  // cargas: uniformes verticales y nodales (las puntuales en barra no se trasladan)
  let omitidas = 0;
  const id3 = Object.fromEntries(nuevos.map((x) => [x.id2, x.id]));
  (m2.cargas_elementos || []).forEach((q) => {
    const e3 = id3[q.elem];
    if (!e3) { omitidas++; return; }
    const cb = (m.cargas_barras ||= []);
    if (q.tipo === "distribuida" && (q.subtipo || "uniforme") === "uniforme" && !(+q.wx)) cb.push({ elem: e3, caso: q.caso || caso, tipo: "uniforme", wz: +q.wy });
    else if (q.tipo === "distribuida" && q.subtipo === "trapezoidal" && !(+q.wx1) && !(+q.wx2)) cb.push({ elem: e3, caso: q.caso || caso, tipo: "trapezoidal", wz1: +q.wy1, wz2: +q.wy2 });
    else if (q.tipo === "puntual" && !(+q.Px)) cb.push({ elem: e3, caso: q.caso || caso, tipo: "puntual", Pz: +q.Py, a: q.a });
    else omitidas++;
  });
  (m2.cargas_nodales || []).forEach((q) => {
    const w = [s, -c, 0];                               // normal del plano (u × z)
    (m.cargas_nudos ||= []).push({ nudo: mapa[q.nudo], caso: q.caso || caso, F: [+q.Fx * c, +q.Fx * s, +q.Fy || 0, (+q.M || 0) * w[0], (+q.M || 0) * w[1], 0] });
  });
  m.casos = m.casos || [];
  [...(m.cargas_barras || []), ...(m.cargas_nudos || [])].forEach((q) => { if (!m.casos.some((x) => x.nombre === q.caso)) m.casos.push({ nombre: q.caso }); });
  return { barras: nuevos.length, omitidas };
}

// Vigas entre dos planos paralelos (ejes de la misma dirección) en cada nudo libre que se corresponda.
export function unirPlanos(m, dir, c1, c2, seccion, soloNiveles = null) {
  const fijo = dir === "x" ? "y" : "x", lib = dir === "x" ? "x" : "y";
  const en = (c) => m.nudos.filter((n) => Math.abs(n[fijo] - c) < 1e-6 && n.apoyo === "libre" && (!soloNiveles || soloNiveles.includes(n.z)));
  let k = 0;
  en(c1).forEach((a) => {
    const b = m.nudos.find((n) => Math.abs(n[fijo] - c2) < 1e-6 && Math.abs(n[lib] - a[lib]) < 1e-6 && Math.abs(n.z - a.z) < 1e-6);
    if (b && agregarBarra(m, a.id, b.id, seccion)) k++;
  });
  return k;
}

// Copia todas las barras del plano (dir, c) a otra posición del mismo eje.
export function copiarPlano(m, dir, c, destino) {
  const fijo = dir === "x" ? "y" : "x";
  const por = Object.fromEntries(m.nudos.map((n) => [n.id, n]));
  const els = m.elementos.filter((e) => Math.abs(por[e.i][fijo] - c) < 1e-6 && Math.abs(por[e.j][fijo] - c) < 1e-6);
  const mov = (n) => ({ ...n, [fijo]: destino });
  let k = 0;
  if (dir === "x") asegurarEje(m, "y", destino); else asegurarEje(m, "x", destino);
  els.forEach((e) => {
    const a = mov(por[e.i]), b = mov(por[e.j]);
    const ia = agregarNudo3d(m, a.x, a.y, a.z, por[e.i].apoyo), ib = agregarNudo3d(m, b.x, b.y, b.z, por[e.j].apoyo);
    const id = agregarBarra(m, ia, ib, e.seccion);
    if (id) { const el = m.elementos.find((q) => q.id === id); el.giro = e.giro || 0; if (e.material) el.material = e.material; k++; }
  });
  return k;
}

// Ejes de pórtico disponibles (planos) con su etiqueta.
export function porticosDe(m) {
  return [
    ...(m.ejes?.y || []).map((e) => ({ eje: "x", c: e.c, nombre: `Eje ${e.nombre}`, det: `pórtico en X · y = ${e.c} m` })),
    ...(m.ejes?.x || []).map((e) => ({ eje: "y", c: e.c, nombre: `Eje ${e.nombre}`, det: `pórtico en Y · x = ${e.c} m` })),
  ];
}

// Convierte un pórtico 2D en un modelo 3D (mismo pórtico en el plano y = 0) para seguir dibujando fuera del plano.
export function a3d(m2) {
  const m = modelo3dVacio(m2.nombre);
  const zmin = Math.min(0, ...m2.nudos.map((n) => +n.y));
  m.ejes = { x: [], y: [] };
  m.niveles = [{ nombre: "Base", z: r6(zmin) }];
  m.secciones = []; m.materiales = [];
  insertarPortico(m, m2, { angulo: 0, x0: 0, y0: 0, z0: 0 });
  m.material = m.materiales[0]?.nombre;
  m.secc_col = m2.secciones[0]?.nombre;
  const usoSec = (vert) => {
    const por = Object.fromEntries(m2.nudos.map((n) => [n.id, n]));
    const e = m2.elementos.find((q) => por[q.i] && por[q.j] && (Math.abs(por[q.i].x - por[q.j].x) < 1e-9) === vert);
    return e?.seccion;
  };
  m.secc_col = usoSec(true) || m.secc_col;
  m.secc_viga = usoSec(false) || m2.secciones[m2.secciones.length - 1]?.nombre;
  if (m.ejes.y.length < 2) m.ejes.y.push({ nombre: LETRA(m.ejes.y.length), c: 5 });
  m.ejes.y.forEach((e, k) => { e.nombre = LETRA(k); });
  m.peso_propio = !!m2.peso_propio;
  m.diafragma = false;
  m.sismo.activo = false;
  m.cargas_area = [];
  return m;
}
