// Modelo de ejemplo en el mismo formato que espera el backend.
export function modeloEjemplo() {
  return {
    nombre: "Pórtico de 2 tramos",
    unidad_fuerza: "tonf",
    unidad_longitud: "m",
    despreciar_axial: true,
    material: { modo: "E", E: 2.0e6 },
    materiales: [],
    secciones: [
      { nombre: "C40", modo: "rect", b: 0.4, h: 0.4 },
      { nombre: "C30", modo: "rect", b: 0.3, h: 0.3 },
      { nombre: "V25", modo: "rect", b: 0.25, h: 0.5 },
    ],
    nudos: [
      { id: 1, nombre: "N1", x: 0, y: 0, apoyo: "empotrado" },
      { id: 2, nombre: "N2", x: 4, y: 0, apoyo: "empotrado" },
      { id: 3, nombre: "N3", x: 8, y: 0, apoyo: "empotrado" },
      { id: 4, nombre: "N4", x: 0, y: 3, apoyo: "libre" },
      { id: 5, nombre: "N5", x: 4, y: 3, apoyo: "libre" },
      { id: 6, nombre: "N6", x: 8, y: 3, apoyo: "libre" },
    ],
    elementos: [
      { id: 1, nombre: "C1", i: 1, j: 4, seccion: "C40" },
      { id: 2, nombre: "C2", i: 2, j: 5, seccion: "C30" },
      { id: 3, nombre: "C3", i: 3, j: 6, seccion: "C40" },
      { id: 4, nombre: "V1", i: 4, j: 5, seccion: "V25" },
      { id: 5, nombre: "V2", i: 5, j: 6, seccion: "V25" },
    ],
    cargas_nodales: [{ nudo: 4, Fx: 4, Fy: 0, M: 0 }],
    cargas_elementos: [
      { elem: 4, tipo: "distribuida", subtipo: "uniforme", wy: -2 },
      { elem: 5, tipo: "distribuida", subtipo: "uniforme", wy: -2 },
    ],
  };
}

// Nuevo ID / nombre para un elemento agregado a una colección.
export const nextId = (arr) => (arr.length ? Math.max(...arr.map((x) => x.id || 0)) + 1 : 1);
