// Fondo del plano DXF (static/plano/*.json vía /api/torre/plano) para el modelador y el visor 3D.
// Formato: { capas: { CAPA: [[x1, y1, x2, y2, ...], ...] }, textos: [{ capa, t, x, y, h, r }] } en metros,
// ya en el sistema del modelo (origen en el eje 1 y el eje I).

export const NOMBRE_TORRE = "Torre de Arequipa (plano)";
// abrirDoc puede añadir « (2)» al nombre si ya hay otro documento igual
export const esTorre = (modelo) => String(modelo?.nombre || "").startsWith(NOMBRE_TORRE);

// pisos 1–3 → planta 1; pisos 4–10 → planta 2. El nivel «Piso N» (z = N·h) cierra el piso N; la base cuenta como piso 1.
export function plantaDeNivel(niveles, z) {
  const orden = [...niveles].sort((a, b) => a.z - b.z);
  const k = orden.findIndex((n) => Math.abs(n.z - z) < 1e-6);
  return Math.max(1, k) <= 3 ? 1 : 2;
}

const cache = new Map();
export function cargarPlanta(planta) {
  if (!cache.has(planta)) {
    cache.set(planta, fetch(`/api/torre/plano?planta=${planta}`).then((r) => { if (!r.ok) throw new Error("No se pudo cargar el plano"); return r.json(); })
      .catch((e) => { cache.delete(planta); throw e; }));
  }
  return cache.get(planta);
}

export function validarFondo(d) {
  return !!d && typeof d === "object" && !!d.capas && typeof d.capas === "object"
    && Object.values(d.capas).every((l) => Array.isArray(l) && l.every((p) => Array.isArray(p) && p.length >= 4 && p.every(Number.isFinite)));
}
