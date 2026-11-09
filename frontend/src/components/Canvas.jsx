import { useMemo } from "react";

const PALETA = ["#508C9B", "#C1666B", "#6E9B54", "#B0894E", "#7E6C9B", "#3F7C8C", "#C98A3B", "#5E7BA6"];

// Grosor de trazo proporcional al peralte h (más alto = más grueso).
function grosores(secciones) {
  const hs = secciones.map((s) => s.h || 0.3);
  const min = Math.min(...hs), max = Math.max(...hs);
  return Object.fromEntries(secciones.map((s, i) => {
    const t = max > min ? (hs[i] - min) / (max - min) : 0.5;
    return [s.nombre, { color: PALETA[i % PALETA.length], ancho: 4 + 8 * t }];
  }));
}

export default function Canvas({ modelo, sel, onSel }) {
  const W = 900, H = 600, M = 70;

  const { draw, estilos } = useMemo(() => {
    const xs = modelo.nudos.map((n) => n.x), ys = modelo.nudos.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const rx = maxX - minX || 1, ry = maxY - minY || 1;
    const escala = Math.min((W - 2 * M) / rx, (H - 2 * M) / ry);
    const ox = (W - rx * escala) / 2 - minX * escala;
    const oy = (H - ry * escala) / 2 + maxY * escala;
    const X = (x) => ox + x * escala, Y = (y) => oy - y * escala;
    const est = grosores(modelo.secciones);
    const porId = Object.fromEntries(modelo.nudos.map((n) => [n.id, n]));
    return { draw: { X, Y, porId, escala }, estilos: est };
  }, [modelo]);

  const { X, Y, porId } = draw;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full select-none" role="img" aria-label="Modelo estructural">
      <defs>
        <pattern id="puntos" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" className="fill-slate-300 dark:fill-slate-600" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#puntos)" onClick={() => onSel(null)} />

      {/* elementos */}
      {modelo.elementos.map((e, idx) => {
        const a = porId[e.i], b = porId[e.j];
        if (!a || !b) return null;
        const est = estilos[e.seccion] || { color: "#888", ancho: 5 };
        const activo = sel?.tipo === "elemento" && sel.idx === idx;
        return (
          <g key={e.id} onClick={(ev) => { ev.stopPropagation(); onSel({ tipo: "elemento", idx }); }} className="cursor-pointer">
            <line x1={X(a.x)} y1={Y(a.y)} x2={X(b.x)} y2={Y(b.y)} stroke="transparent" strokeWidth={18} />
            <line x1={X(a.x)} y1={Y(a.y)} x2={X(b.x)} y2={Y(b.y)} stroke={est.color}
              strokeWidth={est.ancho} strokeLinecap="round" opacity={activo ? 1 : 0.85} />
            {activo && <line x1={X(a.x)} y1={Y(a.y)} x2={X(b.x)} y2={Y(b.y)} stroke="#F2B35B" strokeWidth={est.ancho + 6} strokeOpacity={0.35} strokeLinecap="round" />}
            <text x={(X(a.x) + X(b.x)) / 2} y={(Y(a.y) + Y(b.y)) / 2 - 10} textAnchor="middle"
              className="fill-slate-700 text-[11px] font-semibold dark:fill-slate-200">{e.nombre}</text>
          </g>
        );
      })}

      {/* cargas distribuidas (flechas hacia abajo sobre la barra) */}
      {modelo.cargas_elementos.map((c, k) => {
        const e = modelo.elementos.find((x) => x.id === c.elem);
        const a = e && porId[e.i], b = e && porId[e.j];
        if (!a || !b) return null;
        const n = 6;
        return (
          <g key={`cd${k}`} className="text-rose-500">
            {Array.from({ length: n + 1 }).map((_, t) => {
              const f = t / n, x = X(a.x) + (X(b.x) - X(a.x)) * f, y = Y(a.y) + (Y(b.y) - Y(a.y)) * f;
              return <line key={t} x1={x} y1={y - 26} x2={x} y2={y - 4} stroke="currentColor" strokeWidth={1.4} markerEnd="" />;
            })}
            <text x={(X(a.x) + X(b.x)) / 2} y={(Y(a.y) + Y(b.y)) / 2 - 34} textAnchor="middle" className="fill-rose-500 text-[11px] font-bold">
              {Math.abs(c.wy)} tonf/m
            </text>
          </g>
        );
      })}

      {/* nudos y apoyos */}
      {modelo.nudos.map((n, idx) => {
        const activo = sel?.tipo === "nudo" && sel.idx === idx;
        return (
          <g key={n.id} onClick={(ev) => { ev.stopPropagation(); onSel({ tipo: "nudo", idx }); }} className="cursor-pointer">
            <circle cx={X(n.x)} cy={Y(n.y)} r={activo ? 9 : 6} className={activo ? "fill-amber-400" : "fill-slate-900 dark:fill-slate-100"} />
            {n.apoyo !== "libre" && (
              <rect x={X(n.x) - 10} y={Y(n.y) + 8} width={20} height={5} rx={1} className="fill-slate-500" />
            )}
            <text x={X(n.x) + 9} y={Y(n.y) - 8} className="fill-slate-600 text-[11px] dark:fill-slate-300">{n.nombre}</text>
          </g>
        );
      })}

      {/* cargas nodales */}
      {modelo.cargas_nodales.map((c, k) => {
        const n = porId[c.nudo];
        if (!n || !c.Fx) return null;
        const dir = Math.sign(c.Fx);
        return (
          <g key={`cn${k}`} className="text-rose-600">
            <line x1={X(n.x) - 46 * dir} y1={Y(n.y)} x2={X(n.x) - 8 * dir} y2={Y(n.y)} stroke="currentColor" strokeWidth={2.4} />
            <text x={X(n.x) - 50 * dir} y={Y(n.y) - 6} textAnchor={dir > 0 ? "end" : "start"} className="fill-rose-600 text-[11px] font-bold">
              {Math.abs(c.Fx)} tonf
            </text>
          </g>
        );
      })}
    </svg>
  );
}
