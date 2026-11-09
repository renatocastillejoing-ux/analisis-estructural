import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { propsSeccion } from "../model.js";

const PALETA = ["#508C9B", "#C1666B", "#6E9B54", "#B0894E", "#7E6C9B", "#3F7C8C", "#C98A3B", "#5E7BA6"];
const PASOS_GRILLA = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];

export const HERRAMIENTAS = [
  { id: "select", label: "Seleccionar / mover nudos", icon: "↖", kbd: "V" },
  { id: "pan", label: "Mano: desplazar la vista", icon: "✋", kbd: "H" },
  { id: "nudo", label: "Dibujar nudo (clic en el lienzo)", icon: "＋", kbd: "N" },
  { id: "conectar", label: "Conectar elementos (clic en 2 nudos)", icon: "⟋", kbd: "C" },
  { id: "eliminar", label: "Eliminar (clic en nudo o barra)", icon: "✕", kbd: "X" },
];

export default function Canvas({
  modelo, sel, setSel, tool, commit, beginDrag, moverNudo, fitKey, capas, snap,
  onCursor, onAgregarNudo, onConectar, onEliminar, onZoom,
}) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [view, setView] = useState({ s: 60, tx: 100, ty: 500 });
  const [cursor, setCursor] = useState(null);       // coordenadas de modelo
  const [pendiente, setPendiente] = useState(null); // nudo inicial al conectar
  const accion = useRef(null);                      // {tipo:'pan'|'drag', ...}
  const espacio = useRef(false);
  const modeloRef = useRef(modelo);
  modeloRef.current = modelo;

  // tamaño real del contenedor: 1 unidad del viewBox = 1 px
  useEffect(() => {
    const ro = new ResizeObserver(([en]) => {
      const r = en.contentRect;
      setSize({ w: Math.max(200, r.width), h: Math.max(200, r.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const ajustar = useCallback(() => {
    const ns = modeloRef.current.nudos;
    if (!ns.length) { setView({ s: 60, tx: size.w * 0.2, ty: size.h * 0.8 }); return; }
    const xs = ns.map((n) => +n.x), ys = ns.map((n) => +n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const M = 70;
    const rx = Math.max(maxX - minX, 1), ry = Math.max(maxY - minY, 1);
    const s = Math.min((size.w - 2 * M) / rx, (size.h - 2 * M) / ry);
    setView({ s, tx: (size.w - rx * s) / 2 - minX * s, ty: (size.h - ry * s) / 2 + maxY * s });
  }, [size.w, size.h]);

  useEffect(() => { ajustar(); }, [fitKey, ajustar]);
  useEffect(() => { onZoom?.(view.s); }, [view.s, onZoom]);

  const X = (x) => view.tx + x * view.s;
  const Y = (y) => view.ty - y * view.s;
  const aModelo = (sx, sy) => ({ x: (sx - view.tx) / view.s, y: (view.ty - sy) / view.s });
  const redondear = (v) => (snap ? Math.round(v / snap) * snap : v);
  const local = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  // zoom con la rueda, centrado en el cursor (listener no pasivo para poder cancelar el scroll)
  useEffect(() => {
    const el = svgRef.current;
    const h = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.0015);
      setView((v) => {
        const s = Math.min(5000, Math.max(2, v.s * f));
        const k = s / v.s;
        return { s, tx: sx - (sx - v.tx) * k, ty: sy - (sy - v.ty) * k };
      });
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  // barra espaciadora = mano temporal
  useEffect(() => {
    const d = (e) => { if (e.code === "Space" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) { espacio.current = true; e.preventDefault(); } };
    const u = (e) => { if (e.code === "Space") espacio.current = false; };
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", u);
    return () => { window.removeEventListener("keydown", d); window.removeEventListener("keyup", u); };
  }, []);

  useEffect(() => { if (tool !== "conectar") setPendiente(null); }, [tool]);

  const zoomCentro = (f) => setView((v) => {
    const sx = size.w / 2, sy = size.h / 2;
    const s = Math.min(5000, Math.max(2, v.s * f)), k = s / v.s;
    return { s, tx: sx - (sx - v.tx) * k, ty: sy - (sy - v.ty) * k };
  });

  const onDown = (e) => {
    const { sx, sy } = local(e);
    const nudoId = e.target.closest?.("[data-nudo]")?.dataset.nudo;
    const elemId = e.target.closest?.("[data-elem]")?.dataset.elem;
    const panear = e.button === 1 || tool === "pan" || espacio.current;
    svgRef.current.setPointerCapture(e.pointerId);

    if (panear) { accion.current = { tipo: "pan", sx, sy, v: view }; return; }
    if (e.button !== 0) return;

    if (nudoId) {
      const id = +nudoId;
      if (tool === "eliminar") return onEliminar("nudo", id);
      if (tool === "conectar") {
        if (pendiente == null) setPendiente(id);
        else { onConectar(pendiente, id); setPendiente(id); }
        return;
      }
      setSel({ tipo: "nudo", id });
      if (tool === "select") { beginDrag(); accion.current = { tipo: "drag", id, movido: false }; }
      return;
    }
    if (elemId) {
      const id = +elemId;
      if (tool === "eliminar") return onEliminar("elemento", id);
      setSel({ tipo: "elemento", id });
      return;
    }
    // lienzo vacío
    const p = aModelo(sx, sy);
    if (tool === "nudo") { onAgregarNudo(redondear(p.x), redondear(p.y)); return; }
    if (tool === "conectar") { setPendiente(null); return; }
    setSel(null);
    accion.current = { tipo: "pan", sx, sy, v: view };   // arrastrar el fondo también desplaza
  };

  const onMove = (e) => {
    const { sx, sy } = local(e);
    const p = aModelo(sx, sy);
    setCursor(p);
    onCursor?.({ x: redondear(p.x), y: redondear(p.y) });
    const a = accion.current;
    if (!a) return;
    if (a.tipo === "pan") setView({ ...a.v, tx: a.v.tx + (sx - a.sx), ty: a.v.ty + (sy - a.sy) });
    else if (a.tipo === "drag") { a.movido = true; moverNudo(a.id, redondear(p.x), redondear(p.y)); }
  };

  const onUp = (e) => {
    accion.current = null;
    try { svgRef.current.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }
  };

  // ---------- geometría derivada ----------
  const porId = useMemo(() => Object.fromEntries(modelo.nudos.map((n) => [n.id, n])), [modelo.nudos]);
  const estilos = useMemo(() => {
    const secs = modelo.secciones;
    const hs = secs.map((s) => propsSeccion(s).h || 0.3);
    const mn = Math.min(...hs), mx = Math.max(...hs);
    return Object.fromEntries(secs.map((s, i) => {
      const t = mx > mn ? (hs[i] - mn) / (mx - mn) : 0.5;
      return [s.nombre, { color: PALETA[i % PALETA.length], ancho: 3 + 7 * t }];
    }));
  }, [modelo.secciones]);

  const grandes = modelo.nudos.length > 60;
  const verEtiquetas = capas.etiquetas && (!grandes || view.s > 45);

  // grilla adaptativa (mín. ~28 px entre líneas)
  const grilla = useMemo(() => {
    if (!capas.grilla) return null;
    const paso = PASOS_GRILLA.find((g) => g * view.s >= 28) || 100;
    const x0 = Math.floor((0 - view.tx) / view.s / paso) * paso;
    const x1 = (size.w - view.tx) / view.s;
    const y0 = Math.floor((view.ty - size.h) / view.s / paso) * paso;
    const y1 = view.ty / view.s;
    const v = [], h = [];
    for (let x = x0; x <= x1 && v.length < 400; x += paso) v.push(x);
    for (let y = y0; y <= y1 && h.length < 400; y += paso) h.push(y);
    return { paso, v, h };
  }, [capas.grilla, view, size]);

  const cursorStyle = tool === "pan" || espacio.current ? "grab" : tool === "nudo" ? "crosshair" : tool === "eliminar" ? "not-allowed" : "default";

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        className="block select-none touch-none"
        style={{ cursor: accion.current?.tipo === "pan" ? "grabbing" : cursorStyle }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => onCursor?.(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <marker id="flecha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#E11D48" />
          </marker>
        </defs>

        {grilla && (
          <g>
            {grilla.v.map((x) => (
              <line key={`v${x}`} x1={X(x)} y1={0} x2={X(x)} y2={size.h}
                className={Math.abs(x) < 1e-9 ? "stroke-slate-400 dark:stroke-slate-500" : "stroke-slate-200 dark:stroke-ink-3"} strokeWidth={1} />
            ))}
            {grilla.h.map((y) => (
              <line key={`h${y}`} x1={0} y1={Y(y)} x2={size.w} y2={Y(y)}
                className={Math.abs(y) < 1e-9 ? "stroke-slate-400 dark:stroke-slate-500" : "stroke-slate-200 dark:stroke-ink-3"} strokeWidth={1} />
            ))}
          </g>
        )}

        {/* elementos */}
        {modelo.elementos.map((e) => {
          const a = porId[e.i], b = porId[e.j];
          if (!a || !b) return null;
          const est = estilos[e.seccion] || { color: "#888", ancho: 4 };
          const activo = sel?.tipo === "elemento" && sel.id === e.id;
          return (
            <g key={e.id} data-elem={e.id} className={tool === "nudo" ? "" : "cursor-pointer"}>
              {activo && <line x1={X(a.x)} y1={Y(a.y)} x2={X(b.x)} y2={Y(b.y)} stroke="#F59E0B" strokeOpacity={0.45} strokeWidth={est.ancho + 10} strokeLinecap="round" />}
              <line x1={X(a.x)} y1={Y(a.y)} x2={X(b.x)} y2={Y(b.y)} stroke={est.color} strokeWidth={est.ancho} strokeLinecap="round" />
              <line x1={X(a.x)} y1={Y(a.y)} x2={X(b.x)} y2={Y(b.y)} stroke="transparent" strokeWidth={16} />
              {(e.release_i || e.release_j) && [[e.release_i, a, b], [e.release_j, b, a]].map(([r, p, q], k) => r ? (
                <circle key={k} cx={X(p.x) + (X(q.x) - X(p.x)) * 0.08} cy={Y(p.y) + (Y(q.y) - Y(p.y)) * 0.08} r={4} className="fill-white stroke-slate-800" strokeWidth={1.5} />
              ) : null)}
              {verEtiquetas && (
                <text x={(X(a.x) + X(b.x)) / 2 + 6} y={(Y(a.y) + Y(b.y)) / 2 - 6} className="pointer-events-none fill-slate-700 text-[11px] font-semibold dark:fill-slate-200">{e.nombre}</text>
              )}
            </g>
          );
        })}

        {/* cargas */}
        {capas.cargas && <Cargas modelo={modelo} porId={porId} X={X} Y={Y} valores={verEtiquetas} />}

        {/* línea elástica al conectar */}
        {tool === "conectar" && pendiente != null && cursor && porId[pendiente] && (
          <line x1={X(porId[pendiente].x)} y1={Y(porId[pendiente].y)} x2={X(cursor.x)} y2={Y(cursor.y)}
            stroke="#508C9B" strokeWidth={2} strokeDasharray="6 4" className="pointer-events-none" />
        )}

        {/* nudos y apoyos */}
        {modelo.nudos.map((n) => {
          const activo = (sel?.tipo === "nudo" && sel.id === n.id) || pendiente === n.id;
          return (
            <g key={n.id} data-nudo={n.id} className="cursor-pointer">
              <Apoyo tipo={n.apoyo} x={X(n.x)} y={Y(n.y)} />
              <circle cx={X(n.x)} cy={Y(n.y)} r={12} fill="transparent" />
              <circle cx={X(n.x)} cy={Y(n.y)} r={activo ? 7 : 4.5} className={activo ? "fill-amber-400 stroke-amber-600" : "fill-slate-900 dark:fill-slate-100"} strokeWidth={activo ? 2 : 0} />
              {verEtiquetas && <text x={X(n.x) + 8} y={Y(n.y) - 8} className="pointer-events-none fill-slate-600 text-[11px] dark:fill-slate-300">{n.nombre}</text>}
            </g>
          );
        })}

        {/* nudo fantasma para la herramienta nudo */}
        {tool === "nudo" && cursor && (
          <circle cx={X(redondear(cursor.x))} cy={Y(redondear(cursor.y))} r={5} fill="none" stroke="#508C9B" strokeWidth={2} className="pointer-events-none" />
        )}
      </svg>

      {/* controles de vista */}
      <div className="absolute bottom-12 right-3 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow dark:border-ink-line dark:bg-ink-2/95">
        <BotonVista onClick={() => zoomCentro(1.25)} title="Acercar">＋</BotonVista>
        <BotonVista onClick={() => zoomCentro(0.8)} title="Alejar">－</BotonVista>
        <BotonVista onClick={ajustar} title="Ajustar vista al modelo (F)">⤢</BotonVista>
      </div>
      {tool === "conectar" && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-teal px-3 py-1 text-xs font-semibold text-white shadow">
          {pendiente == null ? "Clic en el nudo inicial" : "Clic en el nudo final (Esc para terminar)"}
        </div>
      )}
    </div>
  );
}

function BotonVista({ children, ...p }) {
  return <button {...p} className="grid h-9 w-9 place-items-center text-base text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-ink-3">{children}</button>;
}

function Apoyo({ tipo, x, y }) {
  const c = "stroke-slate-600 dark:stroke-slate-300";
  if (tipo === "empotrado") return (
    <g className="pointer-events-none">
      <line x1={x - 14} y1={y} x2={x + 14} y2={y} className={c} strokeWidth={3} />
      {[-12, -6, 0, 6, 12].map((d) => <line key={d} x1={x + d} y1={y} x2={x + d - 6} y2={y + 8} className={c} strokeWidth={1.2} />)}
    </g>
  );
  if (tipo === "fijo" || tipo === "rodillo_y") return (
    <g className="pointer-events-none">
      <path d={`M${x},${y} L${x - 9},${y + 13} L${x + 9},${y + 13} Z`} className={`${c} fill-transparent`} strokeWidth={1.6} />
      {tipo === "rodillo_y" ? <line x1={x - 12} y1={y + 18} x2={x + 12} y2={y + 18} className={c} strokeWidth={2} />
        : [-8, -2, 4].map((d) => <line key={d} x1={x + d} y1={y + 13} x2={x + d - 5} y2={y + 19} className={c} strokeWidth={1.2} />)}
    </g>
  );
  if (tipo === "rodillo_x") return (
    <g className="pointer-events-none">
      <path d={`M${x},${y} L${x - 13},${y - 9} L${x - 13},${y + 9} Z`} className={`${c} fill-transparent`} strokeWidth={1.6} />
      <line x1={x - 18} y1={y - 12} x2={x - 18} y2={y + 12} className={c} strokeWidth={2} />
    </g>
  );
  return null;
}

function Cargas({ modelo, porId, X, Y, valores }) {
  const elem = Object.fromEntries(modelo.elementos.map((e) => [e.id, e]));
  const out = [];
  modelo.cargas_elementos.forEach((c, k) => {
    const e = elem[c.elem]; const a = e && porId[e.i], b = e && porId[e.j];
    if (!a || !b) return;
    const ax = X(a.x), ay = Y(a.y), bx = X(b.x), by = Y(b.y);
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    if (c.tipo === "distribuida") {
      const w1 = c.subtipo === "trapezoidal" ? +c.wy1 || 0 : +c.wy || 0;
      const w2 = c.subtipo === "trapezoidal" ? +c.wy2 || 0 : +c.wy || 0;
      const wm = Math.max(Math.abs(w1), Math.abs(w2), 1e-9);
      const pts = [];
      for (let t = 0; t <= 6; t++) {
        const f = t / 6, x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
        const w = w1 + (w2 - w1) * f, h = 8 + 24 * Math.abs(w) / wm;
        const dir = w <= 0 ? 1 : -1;
        pts.push([x, y - h * dir]);
        if (Math.abs(w) > 1e-9) out.push(<line key={`d${k}-${t}`} x1={x} y1={y - h * dir} x2={x} y2={y - 3 * dir} stroke="#E11D48" strokeWidth={1.2} markerEnd="url(#flecha)" />);
      }
      out.push(<polyline key={`dl${k}`} points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#E11D48" strokeWidth={1.2} />);
      if (valores) out.push(
        <text key={`dt${k}`} x={(ax + bx) / 2} y={Math.min(...pts.map((p) => p[1])) - 5} textAnchor="middle" className="fill-rose-600 text-[11px] font-bold dark:fill-rose-400">
          {c.subtipo === "trapezoidal" ? `${Math.abs(w1)}→${Math.abs(w2)}` : Math.abs(w1)} t/m
        </text>);
    } else if (c.tipo === "puntual") {
      const t = Math.min(Math.max((c.a ?? L / 2) / L, 0), 1);
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, dir = (+c.Py || 0) <= 0 ? 1 : -1;
      out.push(<line key={`p${k}`} x1={x} y1={y - 40 * dir} x2={x} y2={y - 4 * dir} stroke="#E11D48" strokeWidth={2.2} markerEnd="url(#flecha)" />);
      if (valores) out.push(<text key={`pt${k}`} x={x + 5} y={y - 42 * dir} className="fill-rose-600 text-[11px] font-bold dark:fill-rose-400">{Math.abs(+c.Py || 0)} t</text>);
    } else if (c.tipo === "momento") {
      const t = Math.min(Math.max((c.a ?? L / 2) / L, 0), 1);
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      out.push(<path key={`m${k}`} d={`M${x + 12},${y} A12,12 0 1,0 ${x},${y - 12}`} fill="none" stroke="#C2410C" strokeWidth={1.8} markerEnd="url(#flecha)" />);
      if (valores) out.push(<text key={`mt${k}`} x={x + 14} y={y - 14} className="fill-orange-700 text-[11px] font-bold dark:fill-orange-400">M={c.M}</text>);
    }
  });
  modelo.cargas_nodales.forEach((c, k) => {
    const nd = porId[c.nudo]; if (!nd) return;
    const x = X(nd.x), y = Y(nd.y);
    if (+c.Fx) { const d = Math.sign(+c.Fx); out.push(<line key={`nx${k}`} x1={x - 46 * d} y1={y} x2={x - 6 * d} y2={y} stroke="#E11D48" strokeWidth={2.4} markerEnd="url(#flecha)" />);
      if (valores) out.push(<text key={`nxt${k}`} x={x - 50 * d} y={y - 6} textAnchor={d > 0 ? "end" : "start"} className="fill-rose-600 text-[11px] font-bold dark:fill-rose-400">{Math.abs(+c.Fx)} t</text>); }
    if (+c.Fy) { const d = Math.sign(+c.Fy); out.push(<line key={`ny${k}`} x1={x} y1={y + 46 * d} x2={x} y2={y + 6 * d} stroke="#E11D48" strokeWidth={2.4} markerEnd="url(#flecha)" />);
      if (valores) out.push(<text key={`nyt${k}`} x={x + 6} y={y + 50 * d} className="fill-rose-600 text-[11px] font-bold dark:fill-rose-400">{Math.abs(+c.Fy)} t</text>); }
  });
  return <g className="pointer-events-none">{out}</g>;
}
