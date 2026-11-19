// Datos del modelo: mismo formato que espera el backend Flask (/api/calcular).

export const APOYOS = [
  ["libre", "Libre"],
  ["empotrado", "Empotrado"],
  ["fijo", "Articulado (fijo)"],
  ["rodillo_y", "Rodillo (móvil en X)"],
  ["rodillo_x", "Rodillo (móvil en Y)"],
];

export const TIPOS_CARGA = [
  ["uniforme", "Distribuida uniforme"],
  ["trapezoidal", "Distribuida trapezoidal"],
  ["puntual", "Puntual"],
  ["momento", "Momento concentrado"],
];

export const nextId = (arr) => (arr.length ? Math.max(...arr.map((x) => x.id || 0)) + 1 : 1);

// Propiedades A e I de una sección (para mostrarlas y para el grosor en el lienzo).
export function propsSeccion(s) {
  if ((s.modo || "rect") === "AI") return { A: +s.A || 0, I: +s.I || 0, h: Math.sqrt((12 * (+s.I || 0)) / Math.max(+s.A || 1e-9, 1e-9)) };
  const b = +s.b || 0, h = +s.h || 0;
  return { A: b * h, I: (b * h ** 3) / 12, h };
}

// Borrar un nudo arrastra sus elementos y cargas, para no dejar referencias rotas.
export function borrarNudo(m, id) {
  const elems = m.elementos.filter((e) => e.i === id || e.j === id).map((e) => e.id);
  m.nudos = m.nudos.filter((n) => n.id !== id);
  m.elementos = m.elementos.filter((e) => !elems.includes(e.id));
  m.cargas_nodales = m.cargas_nodales.filter((c) => c.nudo !== id);
  m.cargas_elementos = m.cargas_elementos.filter((c) => !elems.includes(c.elem));
  return m;
}

export function borrarElemento(m, id) {
  m.elementos = m.elementos.filter((e) => e.id !== id);
  m.cargas_elementos = m.cargas_elementos.filter((c) => c.elem !== id);
  return m;
}

export function agregarNudo(m, x, y) {
  const id = nextId(m.nudos);
  m.nudos.push({ id, nombre: `N${id}`, x: +x.toFixed(4), y: +y.toFixed(4), apoyo: y <= 1e-9 ? "empotrado" : "libre" });
  return id;
}

export function agregarElemento(m, i, j, seccion) {
  if (i === j) return null;
  if (m.elementos.some((e) => (e.i === i && e.j === j) || (e.i === j && e.j === i))) return null;
  const id = nextId(m.elementos);
  m.elementos.push({ id, nombre: `E${id}`, i, j, seccion: seccion || m.secciones[0]?.nombre });
  return id;
}

const base = (nombre, extra) => ({
  nombre,
  unidad_fuerza: "tonf",
  unidad_longitud: "m",
  despreciar_axial: true,
  peso_propio: false,
  material: { modo: "E", E: 2.0e6 },
  materiales: [],
  secciones: [{ nombre: "S1", modo: "rect", b: 0.3, h: 0.5 }],
  nudos: [],
  elementos: [],
  cargas_nodales: [],
  cargas_elementos: [],
  ...extra,
});
const n = (id, x, y, apoyo = "libre") => ({ id, nombre: `N${id}`, x, y, apoyo });
const e = (id, i, j, seccion = "S1", nombre) => ({ id, nombre: nombre || `E${id}`, i, j, seccion });
const udl = (elem, wy) => ({ elem, tipo: "distribuida", subtipo: "uniforme", wy, wx: 0 });

export function modeloVacio() {
  return base("Nueva estructura");
}

export function modeloEjemplo() {
  return PLANTILLAS[0].crear();
}

export const PLANTILLAS = [
  {
    id: "ej1", nombre: "EJ 1 · Pórtico 1 nivel, 2 vanos", desc: "Ejercicio del curso: w = 2 tonf/m, E = 2×10⁶",
    crear: () => base("EJ 1 · Pórtico de 2 vanos", {
      secciones: [
        { nombre: "C40", modo: "rect", b: 0.4, h: 0.4 },
        { nombre: "C30", modo: "rect", b: 0.3, h: 0.3 },
        { nombre: "V25", modo: "rect", b: 0.25, h: 0.5 },
      ],
      nudos: [n(1, 0, 0, "empotrado"), n(2, 4, 0, "empotrado"), n(3, 8, 0, "empotrado"), n(4, 0, 3), n(5, 4, 3), n(6, 8, 3)],
      elementos: [e(1, 1, 4, "C40", "C1"), e(2, 2, 5, "C30", "C2"), e(3, 3, 6, "C40", "C3"), e(4, 4, 5, "V25", "V1"), e(5, 5, 6, "V25", "V2")],
      cargas_elementos: [udl(4, -2), udl(5, -2)],
    }),
  },
  {
    id: "ej2", nombre: "EJ 2 · Viga continua de 5 tramos", desc: "Ejercicio del curso: f'c = 210, puntuales, UDL y triangular",
    crear: () => base("EJ 2 · Viga continua", {
      material: { modo: "fc", fc: 210 },
      secciones: [
        { nombre: "V25x40", modo: "rect", b: 0.25, h: 0.4 },
        { nombre: "V40x60", modo: "rect", b: 0.4, h: 0.6 },
        { nombre: "V30x60", modo: "rect", b: 0.3, h: 0.6 },
      ],
      nudos: [n(1, 0, 0, "empotrado"), n(2, 4, 0, "rodillo_y"), n(3, 9, 0, "rodillo_y"), n(4, 12, 0, "rodillo_y"), n(5, 16, 0, "rodillo_y"), n(6, 22, 0, "empotrado")],
      elementos: [e(1, 1, 2, "V25x40", "V1"), e(2, 2, 3, "V25x40", "V2"), e(3, 3, 4, "V40x60", "V3"), e(4, 4, 5, "V40x60", "V4"), e(5, 5, 6, "V30x60", "V5")],
      cargas_elementos: [
        { elem: 1, tipo: "puntual", Py: -15, Px: 0, a: 2 },
        udl(2, -7),
        { elem: 2, tipo: "puntual", Py: -10, Px: 0, a: 2 },
        { elem: 3, tipo: "distribuida", subtipo: "trapezoidal", wy1: 0, wy2: -3, wx1: 0, wx2: 0 },
        udl(4, -3),
        udl(5, -2),
      ],
    }),
  },
  {
    id: "voladizo", nombre: "Voladizo", desc: "Empotrado con carga en la punta",
    crear: () => base("Voladizo", { nudos: [n(1, 0, 0, "empotrado"), n(2, 3, 0)], elementos: [e(1, 1, 2)], cargas_nodales: [{ nudo: 2, Fx: 0, Fy: -5, M: 0 }] }),
  },
  {
    id: "simple", nombre: "Viga simplemente apoyada", desc: "UDL de 2 tonf/m",
    crear: () => base("Viga simplemente apoyada", { nudos: [n(1, 0, 0, "fijo"), n(2, 6, 0, "rodillo_y")], elementos: [e(1, 1, 2)], cargas_elementos: [udl(1, -2)] }),
  },
  {
    id: "portico", nombre: "Pórtico simple", desc: "Carga lateral y gravitacional",
    crear: () => base("Pórtico simple", {
      nudos: [n(1, 0, 0, "empotrado"), n(2, 0, 3), n(3, 5, 3), n(4, 5, 0, "empotrado")],
      elementos: [e(1, 1, 2), e(2, 2, 3), e(3, 4, 3)],
      cargas_nodales: [{ nudo: 2, Fx: 4, Fy: 0, M: 0 }],
      cargas_elementos: [udl(2, -2.5)],
    }),
  },
];

// Pórtico regular de N pisos y M vanos.
export function generarPortico({ pisos, luces, alturas, apoyo, b_col, h_col, b_viga, h_viga, w }) {
  const xs = [0];
  luces.forEach((l) => xs.push(xs[xs.length - 1] + l));
  const ys = [0];
  for (let p = 0; p < pisos; p++) ys.push(ys[ys.length - 1] + (alturas[p] ?? alturas[alturas.length - 1]));
  const m = base(`Pórtico ${pisos} pisos × ${luces.length} vanos`, {
    secciones: [
      { nombre: "COL", modo: "rect", b: b_col, h: h_col },
      { nombre: "VIGA", modo: "rect", b: b_viga, h: h_viga },
    ],
  });
  const idAt = {};
  ys.forEach((y, lv) => xs.forEach((x, cx) => {
    const id = m.nudos.length + 1;
    m.nudos.push(n(id, +x.toFixed(4), +y.toFixed(4), lv === 0 ? apoyo : "libre"));
    idAt[`${cx},${lv}`] = id;
  }));
  let nc = 0, nv = 0;
  for (let cx = 0; cx < xs.length; cx++)
    for (let lv = 0; lv < pisos; lv++) m.elementos.push(e(m.elementos.length + 1, idAt[`${cx},${lv}`], idAt[`${cx},${lv + 1}`], "COL", `C${++nc}`));
  for (let lv = 1; lv <= pisos; lv++)
    for (let cx = 0; cx < luces.length; cx++) {
      const id = m.elementos.length + 1;
      m.elementos.push(e(id, idAt[`${cx},${lv}`], idAt[`${cx + 1},${lv}`], "VIGA", `V${++nv}`));
      if (w) m.cargas_elementos.push(udl(id, -Math.abs(w)));
    }
  return m;
}

// Pórtico de la torre con casos CM/CV (formato del backend) → modelo del editor con cada carga etiquetada.
export function modeloDesdeCasos(d) {
  const { casos = [], combinaciones = [], ...resto } = d;
  const tag = (lista, caso) => (lista || []).map((c) => ({ ...c, caso }));
  return {
    ...modeloVacio(), ...resto,
    cargas_nodales: casos.flatMap((c) => tag(c.cargas_nodales, c.nombre)),
    cargas_elementos: casos.flatMap((c) => tag(c.cargas_elementos, c.nombre)),
    casos: casos.map((c) => ({ nombre: c.nombre })),
    combinaciones,
  };
}

/* ------------------------- mover columnas (2D) ------------------------- */
const TOL = 1e-6;
const r6 = (v) => Math.round(+v * 1e6) / 1e6;

// Una columna es una barra vertical (mismo x en sus dos nudos, distinta y).
export function esColumna2d(m, e) {
  const a = m.nudos.find((n) => n.id === e.i), b = m.nudos.find((n) => n.id === e.j);
  return !!a && !!b && Math.abs(a.x - b.x) < TOL && Math.abs(a.y - b.y) > TOL;
}

// Ids de todas las barras verticales que están en la misma x que la columna dada (la columna entera, de piso a piso).
export function columnaEntera2d(m, elemId) {
  const e = m.elementos.find((q) => q.id === elemId);
  if (!e || !esColumna2d(m, e)) return [];
  const x = m.nudos.find((n) => n.id === e.i).x;
  return m.elementos.filter((q) => esColumna2d(m, q) && Math.abs(m.nudos.find((n) => n.id === q.i).x - x) < TOL).map((q) => q.id);
}

// Parte la lista de tramos (barra no prismática) en el punto s medido desde i; L = longitud de la barra.
function partirTramos(tramos, s, L) {
  const suma = tramos.reduce((t, q) => t + (+q.L || 0), 0) || L;
  const k = L / suma;                                    // el cálculo ya los escala si no suman L
  const a = [], b = [];
  let acum = 0;
  tramos.forEach((t) => {
    const l = (+t.L || 0) * k, ini = acum, fin = acum + l;
    acum = fin;
    if (ini < s - TOL) a.push({ ...t, L: r6(Math.min(fin, s) - ini) });
    if (fin > s + TOL) b.push({ ...t, L: r6(fin - Math.max(ini, s)) });
  });
  return [a, b];
}

// Devuelve el nudo en (x, y): el que ya existe o uno nuevo, cortando la barra no vertical que pase por ahí
// (crea el nudo, parte la barra en dos y reparte sus cargas). cuenta.cortes suma las barras partidas.
function nudoEnBarras2d(m, x, y, apoyo, cuenta) {
  const ya = m.nudos.find((n) => Math.abs(n.x - x) < TOL && Math.abs(n.y - y) < TOL);
  if (ya) return ya.id;
  const id = nextId(m.nudos);
  m.nudos.push({ id, nombre: `N${id}`, x: r6(x), y: r6(y), apoyo: apoyo || "libre" });
  const porId = Object.fromEntries(m.nudos.map((n) => [n.id, n]));
  const pasa = m.elementos.find((e) => {
    const a = porId[e.i], b = porId[e.j];
    if (!a || !b || esColumna2d(m, e)) return false;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < TOL) return false;
    const t = ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (L * L);
    const dist = Math.abs((x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x)) / L;
    return t > 1e-6 && t < 1 - 1e-6 && dist < 1e-4;
  });
  if (!pasa) return id;
  const a = porId[pasa.i], b = porId[pasa.j];
  const L = Math.hypot(b.x - a.x, b.y - a.y), s = Math.hypot(x - a.x, y - a.y);
  const jOrig = pasa.j, relJ = pasa.release_j;
  const nid = nextId(m.elementos);
  const copia = { ...structuredClone(pasa), id: nid, nombre: `${pasa.nombre}b`, i: id, j: jOrig, release_i: undefined, release_j: relJ };
  pasa.j = id; pasa.release_j = undefined;
  const tr = pasa.segmentos || pasa.tramos;
  if (tr && tr.length) {
    const [t1, t2] = partirTramos(tr, s, L);
    delete pasa.tramos; delete pasa.segmentos; delete copia.tramos; delete copia.segmentos;
    if (t1.length) pasa.segmentos = t1;
    if (t2.length) copia.segmentos = t2;
  }
  m.elementos.push(copia);
  const nuevas = [];
  m.cargas_elementos.filter((c) => c.elem === pasa.id).forEach((c) => {
    if (c.tipo === "puntual" || c.tipo === "momento") {
      const p = c.a === undefined || c.a === null || c.a === "" ? L / 2 : +c.a;
      if (p > s) { c.elem = nid; c.a = r6(p - s); } else c.a = r6(p);   // «a» explícito: el centro cambia al partir
    } else if (c.tipo === "distribuida" && c.subtipo === "trapezoidal") {
      const k = (v1, v2) => (+v1 || 0) + ((+v2 || 0) - (+v1 || 0)) * s / L;
      const wy = k(c.wy1, c.wy2), wx = k(c.wx1, c.wx2);
      nuevas.push({ ...structuredClone(c), elem: nid, wy1: wy, wx1: wx });
      c.wy2 = wy; c.wx2 = wx;
    } else {
      nuevas.push({ ...structuredClone(c), elem: nid });
    }
  });
  m.cargas_elementos.push(...nuevas);
  cuenta.cortes++;
  return id;
}

// Traslada columnas (todas sus barras) dx en X. Las vigas NO se arrastran: quedan donde estaban; en el destino la
// columna se conecta a un nudo existente o corta la viga que pase por ahí. Los apoyos viajan con la columna y las
// cargas en nudos que quedan sueltos también. Devuelve { movidas, cortes, omitidas }.
export function trasladarColumnas2d(m, elemIds, dx) {
  const cuenta = { movidas: 0, cortes: 0, omitidas: 0 };
  if (Math.abs(dx) < TOL) return cuenta;
  const origenes = new Map();                              // nudo viejo → nudo nuevo (para cargas y limpieza)
  elemIds.forEach((id) => {
    const e = m.elementos.find((q) => q.id === id);
    if (!e || !esColumna2d(m, e)) return;
    const P = Object.fromEntries(m.nudos.map((n) => [n.id, n]));
    const nuevos = ["i", "j"].map((k) => {
      const n = P[e[k]];
      return [k, n.id, nudoEnBarras2d(m, n.x + dx, n.y, n.apoyo !== "libre" ? n.apoyo : undefined, cuenta)];
    });
    const ni = nuevos[0][2], nj = nuevos[1][2];
    if (m.elementos.some((q) => q.id !== e.id && ((q.i === ni && q.j === nj) || (q.i === nj && q.j === ni)))) { cuenta.omitidas++; return; }
    nuevos.forEach(([k, viejo, d]) => { e[k] = d; origenes.set(viejo, d); });
    cuenta.movidas++;
  });
  const usados = new Set(m.elementos.flatMap((e) => [e.i, e.j]));
  origenes.forEach((d, viejo) => {
    if (usados.has(viejo)) return;
    m.cargas_nodales.forEach((c) => { if (c.nudo === viejo) c.nudo = d; });
    m.nudos = m.nudos.filter((n) => n.id !== viejo);
  });
  return cuenta;
}
