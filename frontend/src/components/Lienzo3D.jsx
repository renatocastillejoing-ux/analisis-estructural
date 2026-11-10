import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pedir } from "../pedir.js";
import { agregarBarra, agregarNudo3d, borrarBarra, borrarNudo3d, buscarNudo, escena3d, tipoBarra } from "../model3d.js";

const Visor3D = lazy(() => import("./Visor3D.jsx"));
const TOL = 1e-6;

export const HERR3D = [
  { id: "select", label: "Seleccionar", icon: "↖", kbd: "V" },
  { id: "pan", label: "Mano: desplazar", icon: "✋", kbd: "H" },
  { id: "columna", label: "Columna (en planta)", icon: "▮", kbd: "C" },
  { id: "barra", label: "Barra: viga, columna o diagonal", icon: "⟋", kbd: "B" },
  { id: "eliminar", label: "Eliminar", icon: "✕", kbd: "X" },
];

// Centro del modelo 3D: vista 3D, planta de un nivel o elevación de un eje.
export default function Lienzo3D({ modelo, commit, sel, setSel, tool, setTool, vista, setVista, avisar, ajusteKey }) {
  const niveles = useMemo(() => [...modelo.niveles].sort((a, b) => a.z - b.z), [modelo.niveles]);
  const escena = useMemo(() => (vista.modo === "3d" ? escena3d(modelo, { sel, nudos: true }) : null), [modelo, sel, vista.modo]);
  const enPlanoUlt = (m, q) => {
    if (!q) return false;
    if (q.modo === "planta") return Math.abs(m.a[2] - q.z) < 1e-6 && Math.abs(m.b[2] - q.z) < 1e-6 || (m.tipo === "columna" || m.tipo === "placa") && (Math.abs(Math.max(m.a[2], m.b[2]) - q.z) < 1e-6);
    const k = q.eje === "x" ? 1 : 0;
    return Math.abs(m.a[k] - q.c) < 1e-6 && Math.abs(m.b[k] - q.c) < 1e-6;
  };
  const [todos, setTodos] = useState(false);
  const [ajuste, setAjuste] = useState(0.25);
  const agregar = async (tipo) => {
    const t = tipo === "nivel" ? "Altura z del nuevo nivel (m)" : `Posición ${tipo === "x" ? "x" : "y"} del nuevo eje (m)`;
    const r = await pedir(tipo === "nivel" ? "Agregar nivel" : `Agregar eje en ${tipo.toUpperCase()}`, [{ clave: "v", label: t, valor: 5 }]);
    if (!r) return;
    const v = r.v;
    commit((m) => {
      if (tipo === "nivel") { if (!m.niveles.some((n) => Math.abs(n.z - v) < 1e-6)) { m.niveles.push({ nombre: `Nivel ${m.niveles.length}`, z: v }); m.niveles.sort((a, b) => a.z - b.z); } }
      else { const l = m.ejes[tipo]; if (!l.some((e) => Math.abs(e.c - v) < 1e-6)) { l.push({ nombre: tipo === "x" ? String(l.length + 1) : String.fromCharCode(65 + l.length), c: v }); l.sort((a, b) => a.c - b.c); } }
    });
  };
  // planos de trabajo 2D: elevaciones de cada eje y plantas de cada nivel
  const planos = useMemo(() => [
    ...(modelo.ejes?.y || []).map((e) => ({ grupo: "ex", modo: "elevacion", eje: "x", c: e.c, nombre: `Eje ${e.nombre}`, det: `y = ${e.c} m` })),
    ...(modelo.ejes?.x || []).map((e) => ({ grupo: "ey", modo: "elevacion", eje: "y", c: e.c, nombre: `Eje ${e.nombre}`, det: `x = ${e.c} m` })),
    ...[...niveles].reverse().map((n) => ({ grupo: "pl", modo: "planta", z: n.z, nombre: n.nombre, det: `z = ${n.z} m` })),
  ], [modelo.ejes, niveles]);
  const igual = (q, v) => q && v && q.modo === v.modo && (q.modo === "planta" ? Math.abs(q.z - v.z) < 1e-6 : q.eje === v.eje && Math.abs(q.c - v.c) < 1e-6);
  const idxPlano = Math.max(0, planos.findIndex((q) => igual(q, vista)));
  const ultimo2d = planos.find((q) => igual(q, vista.ultimo)) || planos.find((q) => igual(q, vista)) || planos[0];
  const irPlano = (q) => { if (q) setVista((v) => ({ ...v, modo: q.modo, z: q.z ?? v.z, eje: q.eje ?? v.eje, c: q.c ?? v.c, ultimo: q })); };
  const vecino = (d) => { const act = planos[idxPlano]; if (!act) return null; const mismos = planos.filter((q) => q.grupo === act.grupo); const k = mismos.findIndex((q) => igual(q, act)); return mismos[k + d] || null; };
  const mover = (d) => irPlano(vecino(d));
  const [resaltarPlano, setResaltarPlano] = useState(false);
  const moverRef = useRef(mover); moverRef.current = vista.modo !== "3d" ? mover : null;
  useEffect(() => {
    const h = (e) => {
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if (e.key === "PageUp") { e.preventDefault(); moverRef.current?.(-1); }
      if (e.key === "PageDown") { e.preventDefault(); moverRef.current?.(1); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const [pend3, setPend3] = useState(null);       // nudo inicial de la barra en 3D
  useEffect(() => { setPend3(null); }, [tool, vista.modo]);
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") setPend3(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const elegir3d = (m) => {
    if (tool === "eliminar") {
      if (m?._nudo) commit((x) => borrarNudo3d(x, m.id)); else if (m) commit((x) => borrarBarra(x, m.id));
      return;
    }
    if (tool === "barra") {
      if (!m?._nudo) { avisar("En 3D la barra se dibuja de nudo a nudo: haz clic sobre los puntos (nudos).", "err"); return; }
      if (pend3 == null) { setPend3(m.id); return; }
      if (pend3 !== m.id) commit((x) => { if (!agregarBarra(x, pend3, m.id)) avisar("Esos nudos ya están unidos.", "err"); });
      setPend3(m.id);
      return;
    }
    if (tool === "columna") { avisar("La herramienta Columna se usa en planta. En 3D usa Barra (B) de nudo a nudo.", "err"); return; }
    setSel(m ? (m._nudo ? { tipo: "nudo", id: m.id } : { tipo: "elemento", id: m.id }) : null);
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-ink-line dark:bg-ink-2">
        <div className="flex rounded-md bg-slate-100 p-0.5 dark:bg-ink-3" role="tablist" aria-label="Vista 2D o 3D">
          <button role="tab" aria-selected={vista.modo !== "3d"} onClick={() => irPlano(ultimo2d)} title="Trabajar un eje o un nivel en 2D"
            className={`rounded px-3 py-1 ${vista.modo !== "3d" ? "bg-white font-semibold shadow dark:bg-ink-line" : ""}`}>2D</button>
          <button role="tab" aria-selected={vista.modo === "3d"} onClick={() => setVista((v) => ({ ...v, modo: "3d", ultimo: v.modo !== "3d" ? planos[idxPlano] : v.ultimo }))} title="Ver toda la estructura en 3D"
            className={`rounded px-3 py-1 ${vista.modo === "3d" ? "bg-white font-semibold shadow dark:bg-ink-line" : ""}`}>3D</button>
        </div>
        {vista.modo !== "3d" ? (<>
          <button onClick={() => mover(-1)} disabled={!vecino(-1)} className="rounded border border-slate-200 px-1.5 py-0.5 disabled:opacity-30 dark:border-ink-line" title="Eje o nivel anterior (RePág)" aria-label="Anterior">◀</button>
          <select className="inp !py-0.5 text-xs font-semibold" value={idxPlano} onChange={(e) => irPlano(planos[+e.target.value])} aria-label="Eje o nivel en 2D">
            <optgroup label="Elevaciones · pórticos en X">{planos.map((q, i) => q.grupo === "ex" && <option key={i} value={i}>{q.nombre} · {q.det}</option>)}</optgroup>
            <optgroup label="Elevaciones · pórticos en Y">{planos.map((q, i) => q.grupo === "ey" && <option key={i} value={i}>{q.nombre} · {q.det}</option>)}</optgroup>
            <optgroup label="Plantas · niveles">{planos.map((q, i) => q.grupo === "pl" && <option key={i} value={i}>{q.nombre} · {q.det}</option>)}</optgroup>
          </select>
          <button onClick={() => mover(1)} disabled={!vecino(1)} className="rounded border border-slate-200 px-1.5 py-0.5 disabled:opacity-30 dark:border-ink-line" title="Eje o nivel siguiente (AvPág)" aria-label="Siguiente">▶</button>
          {vista.modo === "planta" && <label className="flex items-center gap-1"><input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} className="accent-teal-600" /> Dibujar en todos los niveles</label>}
        </>) : (
          <label className="flex items-center gap-1" title="Resalta en 3D el último eje o nivel que trabajaste en 2D">
            <input type="checkbox" checked={resaltarPlano} onChange={(e) => setResaltarPlano(e.target.checked)} className="accent-teal-600" /> Resaltar {ultimo2d?.nombre || "el plano 2D"}
          </label>
        )}
        {vista.modo !== "3d" && (<>
          <label className="flex items-center gap-1">Ajuste
            <select className="inp !py-0.5 text-xs" value={ajuste} onChange={(e) => setAjuste(+e.target.value)} aria-label="Ajuste fuera de la grilla">
              {[[0, "solo grilla"], [0.1, "0.10 m"], [0.25, "0.25 m"], [0.5, "0.50 m"], [1, "1.00 m"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <button onClick={() => agregar("x")} className="rounded border border-slate-200 px-1.5 py-0.5 dark:border-ink-line" title="Agregar un eje en X">+ Eje X</button>
          <button onClick={() => agregar("y")} className="rounded border border-slate-200 px-1.5 py-0.5 dark:border-ink-line" title="Agregar un eje en Y">+ Eje Y</button>
          <button onClick={() => agregar("nivel")} className="rounded border border-slate-200 px-1.5 py-0.5 dark:border-ink-line" title="Agregar un nivel">+ Nivel</button>
        </>)}
        <span className="ml-auto text-slate-500 dark:text-slate-400">
          {vista.modo === "3d" ? "Arrastrar o botón central: girar · clic derecho: desplazar · rueda: zoom · 1 3 7 vistas · 5 orto · F encuadrar · ? atajos" : "Rueda: zoom · arrastrar fondo o Espacio: desplazar · Esc: terminar"}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        {vista.modo === "3d" ? (
          <Suspense fallback={<div className="p-6 text-sm text-slate-500">Cargando el visor 3D…</div>}>
            <Visor3D escena={resaltarPlano && ultimo2d ? { ...escena, miembros: escena.miembros.map((m) => ({ ...m, grupos: enPlanoUlt(m, ultimo2d) ? ["plano"] : [] })) } : escena}
              resaltar={resaltarPlano && ultimo2d ? "plano" : null} ajusteKey={ajusteKey} onElegir={elegir3d} pendiente={pend3} />
            {tool === "barra" && (
              <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-teal px-3 py-1 text-xs font-semibold text-white shadow">
                {pend3 == null ? "Clic en el nudo inicial" : "Clic en el nudo final · Esc para terminar"}
              </div>
            )}
          </Suspense>
        ) : (
          <Plano modelo={modelo} commit={commit} sel={sel} setSel={setSel} tool={tool} setTool={setTool} vista={vista} niveles={niveles} todos={todos} avisar={avisar} ajuste={ajuste} />
        )}
      </div>
    </div>
  );
}

/* ----------------------------- planta / elevación ----------------------------- */
function Plano({ modelo, commit, sel, setSel, tool, vista, niveles, todos, avisar, ajuste = 0.25 }) {
  const wrap = useRef(null), svg = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ s: 20, tx: 60, ty: 500 });
  const [cursor, setCursor] = useState(null);
  const [pend, setPend] = useState(null);           // punto inicial de la barra [u, v]
  const accion = useRef(null);
  const espacio = useRef(false);

  // proyección: planta → (x, y); elevación eje x (y = c) → (x, z); eje y (x = c) → (y, z)
  const P = useMemo(() => {
    if (vista.modo === "planta") return {
      enPlano: (n) => Math.abs(n.z - vista.z) < TOL, uv: (n) => [n.x, n.y], mundo: (u, v) => [u, v, vista.z],
      us: (modelo.ejes?.x || []).map((e) => ({ c: e.c, nombre: e.nombre })), vs: (modelo.ejes?.y || []).map((e) => ({ c: e.c, nombre: e.nombre })),
    };
    const fijo = vista.eje === "x" ? "y" : "x", horiz = vista.eje === "x" ? "x" : "y";
    return {
      enPlano: (n) => Math.abs(n[fijo] - vista.c) < TOL, uv: (n) => [n[horiz], n.z],
      mundo: (u, v) => (vista.eje === "x" ? [u, vista.c, v] : [vista.c, u, v]),
      us: (modelo.ejes?.[horiz] || []).map((e) => ({ c: e.c, nombre: e.nombre })), vs: niveles.map((n) => ({ c: n.z, nombre: n.nombre })),
    };
  }, [vista, modelo.ejes, niveles]);

  useEffect(() => {
    const ro = new ResizeObserver(([en]) => setSize({ w: Math.max(200, en.contentRect.width), h: Math.max(200, en.contentRect.height) }));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const ajustar = useCallback(() => {
    const us = P.us.map((e) => e.c), vs = P.vs.map((e) => e.c);
    if (!us.length || !vs.length) return;
    const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
    const M = 70, izq = 60;    // margen extra a la izquierda para la barra de herramientas
    const s = Math.min((size.w - 2 * M - izq) / (u1 - u0 || 1), (size.h - 2 * M) / (v1 - v0 || 1));
    setView({ s, tx: izq + (size.w - izq - (u1 - u0) * s) / 2 - u0 * s, ty: (size.h - (v1 - v0) * s) / 2 + v1 * s });
  }, [P, size]);
  useEffect(() => { ajustar(); }, [vista.modo, vista.eje, vista.c, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = svg.current;
    const h = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015);
      setView((v) => { const s = Math.min(3000, Math.max(1, v.s * f)), k = s / v.s; return { s, tx: sx - (sx - v.tx) * k, ty: sy - (sy - v.ty) * k }; });
    };
    el.addEventListener("wheel", h, { passive: false });
    const d = (e) => { if (e.code === "Space" && !/INPUT|SELECT/.test(document.activeElement?.tagName)) { espacio.current = true; e.preventDefault(); } if (e.key === "Escape") setPend(null); };
    const u = (e) => { if (e.code === "Space") espacio.current = false; };
    window.addEventListener("keydown", d); window.addEventListener("keyup", u);
    return () => { el.removeEventListener("wheel", h); window.removeEventListener("keydown", d); window.removeEventListener("keyup", u); };
  }, []);
  useEffect(() => { setPend(null); }, [tool, vista]);

  const X = (u) => view.tx + u * view.s, Y = (v) => view.ty - v * view.s;
  const aModelo = (sx, sy) => [(sx - view.tx) / view.s, (view.ty - sy) / view.s];

  // puntos de enganche: intersecciones de la grilla y nudos del plano
  const nudosPlano = useMemo(() => modelo.nudos.filter(P.enPlano), [modelo.nudos, P]);
  const snap = (u, v) => {
    let best = null, d = 18 / view.s;
    const prueba = (a, b) => { const dd = Math.hypot(a - u, b - v); if (dd < d) { d = dd; best = [a, b]; } };
    P.us.forEach((a) => P.vs.forEach((b) => prueba(a.c, b.c)));
    nudosPlano.forEach((n) => { const [a, b] = P.uv(n); prueba(a, b); });
    if (!best && ajuste > 0) best = [Math.round(u / ajuste) * ajuste, Math.round(v / ajuste) * ajuste].map((q) => Math.round(q * 1e6) / 1e6);
    return best;
  };

  const nivelInferior = (z) => { const zs = niveles.map((n) => n.z).filter((q) => q < z - TOL); return zs.length ? Math.max(...zs) : null; };

  const crearColumna = (u, v) => {
    const zs = todos ? niveles.map((n) => n.z).filter((z) => nivelInferior(z) != null) : [vista.z];
    if (!zs.length || nivelInferior(zs[0]) == null) { avisar("La columna va desde el nivel inferior: elige un nivel por encima de la base.", "err"); return; }
    commit((m) => zs.forEach((z) => { const zb = nivelInferior(z); agregarBarra(m, agregarNudo3d(m, u, v, zb), agregarNudo3d(m, u, v, z), m.secc_col); }));
  };
  const crearBarra = (a, b) => {
    const zs = vista.modo === "planta" && todos ? niveles.map((n) => n.z).filter((z) => nivelInferior(z) != null) : [null];
    commit((m) => zs.forEach((z) => {
      const pa = P.mundo(...a), pb = P.mundo(...b);
      if (z != null) { pa[2] = z; pb[2] = z; }
      const ap = vista.modo === "planta" ? "libre" : undefined;   // en planta los nudos nuevos quedan libres (los apoyos se asignan aparte)
      agregarBarra(m, agregarNudo3d(m, ...pa, ap), agregarNudo3d(m, ...pb, ap));
    }));
  };

  const onDown = (e) => {
    const r = svg.current.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    svg.current.setPointerCapture(e.pointerId);
    const elemId = e.target.closest?.("[data-elem]")?.dataset.elem, nudoId = e.target.closest?.("[data-nudo]")?.dataset.nudo;
    if (e.button === 1 || tool === "pan" || espacio.current) { accion.current = { sx, sy, v: view }; return; }
    if (e.button !== 0) return;
    const [u, v] = aModelo(sx, sy), p = snap(u, v);
    if (tool === "eliminar") {
      if (elemId) commit((m) => borrarBarra(m, +elemId));
      else if (nudoId) commit((m) => borrarNudo3d(m, +nudoId));
      return;
    }
    if (tool === "columna") { if (vista.modo !== "planta") { avisar("La herramienta Columna se usa en planta; en elevación usa Barra (B).", "err"); return; } if (p) crearColumna(...p); return; }
    if (tool === "barra") {
      if (!p) return;
      if (!pend) setPend(p); else { if (Math.hypot(p[0] - pend[0], p[1] - pend[1]) > TOL) crearBarra(pend, p); setPend(p); }
      return;
    }
    if (elemId) setSel({ tipo: "elemento", id: +elemId });
    else if (nudoId) setSel({ tipo: "nudo", id: +nudoId });
    else { setSel(null); accion.current = { sx, sy, v: view }; }
  };
  const onMove = (e) => {
    const r = svg.current.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [u, v] = aModelo(sx, sy);
    setCursor(snap(u, v) || [u, v]);
    const a = accion.current;
    if (a) setView({ ...a.v, tx: a.v.tx + sx - a.sx, ty: a.v.ty + sy - a.sy });
  };

  // barras del plano y columnas que llegan al nivel (en planta)
  const porId = useMemo(() => Object.fromEntries(modelo.nudos.map((n) => [n.id, n])), [modelo.nudos]);
  const secs = useMemo(() => Object.fromEntries(modelo.secciones.map((s) => [s.nombre, s])), [modelo.secciones]);
  const enPlano = modelo.elementos.filter((e) => porId[e.i] && porId[e.j] && P.enPlano(porId[e.i]) && P.enPlano(porId[e.j]));
  const columnas = vista.modo === "planta" ? modelo.elementos.filter((e) => {
    const a = porId[e.i], b = porId[e.j];
    return a && b && tipoBarra(modelo, e) === "columna" && (Math.abs(Math.max(a.z, b.z) - vista.z) < TOL || Math.abs(Math.min(a.z, b.z) - vista.z) < TOL);
  }) : [];
  const cursorCss = tool === "pan" ? "grab" : tool === "eliminar" ? "not-allowed" : tool === "select" ? "default" : "crosshair";

  return (
    <div ref={wrap} className="absolute inset-0 bg-slate-50 dark:bg-ink">
      <svg ref={svg} width={size.w} height={size.h} className="block touch-none select-none" style={{ cursor: cursorCss }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { accion.current = null; }} onContextMenu={(e) => e.preventDefault()}>
        {/* grilla de ejes */}
        {P.us.map((a) => (
          <g key={`u${a.c}`}>
            <line x1={X(a.c)} y1={0} x2={X(a.c)} y2={size.h} className="stroke-slate-300 dark:stroke-ink-line" strokeDasharray="6 4" />
            <circle cx={X(a.c)} cy={16} r={11} className="fill-teal" /><text x={X(a.c)} y={20} textAnchor="middle" className="fill-white text-[11px] font-bold">{a.nombre}</text>
          </g>
        ))}
        {P.vs.map((b) => (
          <g key={`v${b.c}`}>
            <line x1={0} y1={Y(b.c)} x2={size.w} y2={Y(b.c)} className="stroke-slate-300 dark:stroke-ink-line" strokeDasharray="6 4" />
            {vista.modo === "planta"
              ? (<><circle cx={X(Math.min(...P.us.map((q) => q.c))) - 34} cy={Y(b.c)} r={11} className="fill-teal" /><text x={X(Math.min(...P.us.map((q) => q.c))) - 34} y={Y(b.c) + 4} textAnchor="middle" className="fill-white text-[11px] font-bold">{b.nombre}</text></>)
              : <text x={6} y={Y(b.c) - 4} className="fill-slate-500 text-[11px] font-semibold dark:fill-slate-400">{b.nombre} · {b.c} m</text>}
          </g>
        ))}
        {/* columnas vistas en planta */}
        {columnas.map((e) => {
          const n = Math.abs(porId[e.j].z - vista.z) < TOL ? porId[e.j] : porId[e.i];
          const s = secs[e.seccion] || { b: 0.3, h: 0.3 }, giro = (+e.giro || 0) % 180 === 90;
          const bx = Math.max(6, (giro ? s.h : s.b) * view.s), by = Math.max(6, (giro ? s.b : s.h) * view.s);
          const activo = sel?.tipo === "elemento" && sel.id === e.id;
          const debajo = Math.abs(Math.max(porId[e.i].z, porId[e.j].z) - vista.z) < TOL;
          return <rect key={e.id} data-elem={e.id} x={X(n.x) - bx / 2} y={Y(n.y) - by / 2} width={bx} height={by}
            className={`cursor-pointer ${activo ? "fill-amber-400" : debajo ? "fill-slate-600 dark:fill-slate-300" : "fill-transparent stroke-slate-400"}`} strokeWidth={1} strokeDasharray={debajo ? undefined : "3 2"} />;
        })}
        {/* barras en el plano */}
        {enPlano.map((e) => {
          const [u1, v1] = P.uv(porId[e.i]), [u2, v2] = P.uv(porId[e.j]);
          const s = secs[e.seccion] || { b: 0.3, h: 0.3 };
          const activo = sel?.tipo === "elemento" && sel.id === e.id;
          const t = tipoBarra(modelo, e);
          const ancho = Math.min(14, Math.max(2.5, (vista.modo === "planta" ? s.b : t === "columna" ? s.b : s.h) * view.s * 0.6));
          return (
            <g key={e.id} data-elem={e.id} className="cursor-pointer">
              <line x1={X(u1)} y1={Y(v1)} x2={X(u2)} y2={Y(v2)} stroke={activo ? "#F59E0B" : t === "columna" ? "#5E7BA6" : t === "diagonal" ? "#7E6C9B" : "#6E9B54"} strokeWidth={ancho} strokeLinecap="round" />
              <line x1={X(u1)} y1={Y(v1)} x2={X(u2)} y2={Y(v2)} stroke="transparent" strokeWidth={14} />
            </g>
          );
        })}
        {nudosPlano.map((n) => {
          const [u, v] = P.uv(n), activo = sel?.tipo === "nudo" && sel.id === n.id;
          return (
            <g key={n.id} data-nudo={n.id} className="cursor-pointer">
              <circle cx={X(u)} cy={Y(v)} r={10} fill="transparent" />
              <circle cx={X(u)} cy={Y(v)} r={activo ? 6 : 3.5} className={activo ? "fill-amber-400" : n.apoyo !== "libre" ? "fill-rose-600" : "fill-slate-900 dark:fill-slate-100"} />
            </g>
          );
        })}
        {/* ayudas de dibujo */}
        {cursor && ["columna", "barra"].includes(tool) && <circle cx={X(cursor[0])} cy={Y(cursor[1])} r={7} fill="none" stroke="#508C9B" strokeWidth={2} className="pointer-events-none" />}
        {pend && cursor && <line x1={X(pend[0])} y1={Y(pend[1])} x2={X(cursor[0])} y2={Y(cursor[1])} stroke="#508C9B" strokeWidth={2} strokeDasharray="6 4" className="pointer-events-none" />}
      </svg>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-white/90 px-2 py-1 text-[11px] tabular-nums text-slate-600 shadow dark:bg-ink-2/90 dark:text-slate-300">
        {vista.modo === "planta" ? `Planta z = ${vista.z} m` : `Elevación ${vista.eje === "x" ? `y = ${vista.c}` : `x = ${vista.c}`} m`}
        {cursor && ` · ${cursor[0].toFixed(2)}, ${cursor[1].toFixed(2)}`}
        {tool === "barra" && (pend ? " · clic en el punto final (Esc termina)" : " · clic en el punto inicial")}
      </div>
      <button onClick={ajustar} title="Ajustar vista" className="absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white shadow dark:border-ink-line dark:bg-ink-2">⤢</button>
    </div>
  );
}
