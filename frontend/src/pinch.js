// Gesto de pellizco (dos dedos) para los lienzos SVG: zoom centrado entre los dedos
// y desplazamiento a la vez. Devuelve funciones para llamar desde los eventos de puntero.
export function crearPinch(getView, setView, { min = 2, max = 5000 } = {}) {
  const ptrs = new Map();
  let g = null;
  const punto = (e, el) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const medidas = () => {
    const [a, b] = [...ptrs.values()];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };
  return {
    // true si hay un pellizco en curso (el llamador debe cancelar su acción de un dedo)
    down(e, el) {
      if (e.pointerType === "mouse") return false;
      ptrs.set(e.pointerId, punto(e, el));
      if (ptrs.size === 2) g = { ...medidas(), v: getView() };
      return !!g;
    },
    move(e, el) {
      if (!ptrs.has(e.pointerId)) return !!g;
      ptrs.set(e.pointerId, punto(e, el));
      if (g && ptrs.size === 2) {
        const m = medidas();
        const s = Math.min(max, Math.max(min, g.v.s * (m.d / g.d))), k = s / g.v.s;
        setView({ ...g.v, s, tx: m.cx - (g.cx - g.v.tx) * k, ty: m.cy - (g.cy - g.v.ty) * k });
      }
      return !!g;
    },
    up(e) {
      ptrs.delete(e.pointerId);
      const estaba = !!g;
      if (ptrs.size < 2) g = null;
      return estaba;
    },
    activo: () => !!g,
  };
}
