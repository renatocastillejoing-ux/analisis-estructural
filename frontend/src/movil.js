import { useEffect, useState } from "react";

// «Compacto» = teléfono (ancho < 768 px) o teléfono en horizontal (alto < 500 px); igual que index.css
export const CONSULTA_COMPACTO = "(max-width: 767px), (max-height: 500px)";
export const CONSULTA_HORIZONTAL = "(max-height: 499px) and (orientation: landscape)";   // = variante land:
export function useCompacto() { return useMedia(CONSULTA_COMPACTO); }
export function useHorizontal() { return useMedia(CONSULTA_HORIZONTAL); }
export function useMedia(q) {
  const mq = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q) : null);
  const [c, setC] = useState(() => !!mq()?.matches);
  useEffect(() => {
    const m = mq(); if (!m) return undefined;
    const h = () => setC(m.matches);
    m.addEventListener?.("change", h);
    return () => m.removeEventListener?.("change", h);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return c;
}

// Letra de un SVG con viewBox de ancho W, legible cuando se dibuja más angosto (p. ej. 343 px en un
// teléfono): mide el ancho real con ResizeObserver y devuelve el factor k para --k (1 en escritorio).
export function useEscalaTexto(ref, W) {
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = ref.current; if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([en]) => {
      const w = en.contentRect.width; if (!w) return;
      if (!window.matchMedia?.(CONSULTA_COMPACTO).matches) { setK(1); return; }   // escritorio: sin cambios
      const f = W / w;                                       // unidades de viewBox por píxel
      const nk = f <= 1.05 ? 1 : Math.min(2.2, Math.max(1, f * 0.85));
      setK((v) => (Math.abs(v - nk) < 0.05 ? v : +nk.toFixed(2)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, W]);
  return k > 1 ? { className: "fig-k", style: { "--k": k } } : { className: "", style: undefined };
}

// Mantiene la pantalla encendida mientras `activo` (Screen Wake Lock); se renueva al volver a la pestaña.
export function useWakeLock(activo) {
  useEffect(() => {
    if (!activo || !navigator.wakeLock?.request) return undefined;
    let lock = null, vivo = true;
    const pedir = () => navigator.wakeLock.request("screen").then((l) => { if (vivo) lock = l; else l.release(); }).catch(() => {});
    const alVer = () => { if (document.visibilityState === "visible") pedir(); };
    pedir();
    document.addEventListener("visibilitychange", alVer);
    return () => { vivo = false; document.removeEventListener("visibilitychange", alVer); lock?.release().catch(() => {}); };
  }, [activo]);
}
