// Tareas en curso (cálculos, descargas, cargas de modelos) para el indicador global de carga.
// Cada tarea tiene: título, etapa, fracción 0–1 (si el servidor la informa), inicio y una
// duración esperada (la de las veces anteriores, guardada en este navegador).
const tareas = new Map();
const oyentes = new Set();
let siguiente = 1;
const CLAVE = "ae_duraciones";

function leerDuraciones() {
  try { return JSON.parse(localStorage.getItem(CLAVE) || "{}"); } catch { return {}; }
}
function guardarDuracion(clave, seg) {
  try {
    const d = leerDuraciones();
    // media móvil: la última pesa más, sin olvidar las anteriores
    d[clave] = d[clave] ? 0.6 * seg + 0.4 * d[clave] : seg;
    localStorage.setItem(CLAVE, JSON.stringify(d));
  } catch { /* sin almacenamiento: solo no se recuerda */ }
}
const avisar = () => oyentes.forEach((f) => f());

export function suscribir(f) { oyentes.add(f); return () => oyentes.delete(f); }
export function tareasEnCurso() { return [...tareas.values()]; }

export function iniciarTarea(clave, titulo, etapa = "") {
  const id = siguiente++;
  tareas.set(id, { id, clave, titulo, etapa, fraccion: null, paso: null, inicio: Date.now(), esperado: leerDuraciones()[clave] || null });
  avisar();
  return id;
}
export function actualizarTarea(id, cambios) {
  const t = tareas.get(id);
  if (!t) return;
  Object.assign(t, cambios);
  avisar();
}
export function terminarTarea(id, ok = true) {
  const t = tareas.get(id);
  if (!t) return;
  if (ok) guardarDuracion(t.clave, (Date.now() - t.inicio) / 1000);
  tareas.delete(id);
  avisar();
}

// Envuelve una promesa: muestra la tarea mientras dura. `fn` recibe la función para actualizar.
export async function conCarga(clave, titulo, fn, etapa = "") {
  const id = iniciarTarea(clave, titulo, etapa);
  let ok = false;
  try {
    const r = await fn((c) => actualizarTarea(id, c));
    ok = !(r && r.ok === false);
    return r;
  } finally {
    terminarTarea(id, ok);
  }
}

// Cuánto falta (s) y qué fracción dibujar. Con fracción del servidor: tiempo transcurrido
// proyectado; si no, la duración de las veces anteriores; si no hay nada, indeterminado.
export function estimar(t, ahora = Date.now()) {
  const trans = (ahora - t.inicio) / 1000;
  if (t.paso && t.paso.n) {
    const f = t.paso.i / t.paso.n;
    return { trans, fraccion: f, falta: f > 0.05 ? (trans * (1 - f)) / f : t.esperado ? Math.max(1, t.esperado - trans) : null };
  }
  if (t.fraccion != null && (t.fraccion >= 0.1 || t.esperado)) {
    // dentro de una etapa larga la fracción del servidor no se mueve: se avanza con el tiempo
    // esperado (la duración de la vez anterior) sin pasar del 97 %
    const f = t.esperado ? Math.max(t.fraccion, Math.min(0.97, trans / t.esperado)) : t.fraccion;
    const falta = f >= 0.1 ? (trans * (1 - f)) / f : t.esperado - trans;
    return { trans, fraccion: f, falta: Math.max(1, falta) };
  }
  if (t.esperado) {
    const f = Math.min(0.95, trans / t.esperado);
    return { trans, fraccion: Math.max(f, t.fraccion || 0), falta: trans < t.esperado ? t.esperado - trans : null };
  }
  return { trans, fraccion: t.fraccion, falta: null };
}
