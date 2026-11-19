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

// Pellizco de dos dedos para escalar un contenido (hoja, matriz ampliada) con eventos táctiles.
// Un dedo sigue desplazando de forma nativa; con dos dedos se cancela el zoom del navegador y se
// llama a set(escala). Devuelve la función para quitar los eventos.
export function pellizcoEscala(el, get, set, { min = 0.5, max = 3 } = {}) {
  if (!el) return () => {};
  let g = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
  const ini = (e) => { if (e.touches.length === 2) g = { d: dist(e.touches), s: get() }; };
  const mov = (e) => {
    if (!g || e.touches.length !== 2) return;
    e.preventDefault();
    set(Math.min(max, Math.max(min, +(g.s * dist(e.touches) / g.d).toFixed(3))));
  };
  const fin = (e) => { if (e.touches.length < 2) g = null; };
  el.addEventListener("touchstart", ini, { passive: true });
  el.addEventListener("touchmove", mov, { passive: false });
  el.addEventListener("touchend", fin); el.addEventListener("touchcancel", fin);
  return () => { el.removeEventListener("touchstart", ini); el.removeEventListener("touchmove", mov); el.removeEventListener("touchend", fin); el.removeEventListener("touchcancel", fin); };
}
