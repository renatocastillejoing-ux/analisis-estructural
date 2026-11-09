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
