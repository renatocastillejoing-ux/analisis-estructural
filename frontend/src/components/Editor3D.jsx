import { useMemo, useState } from "react";
import { APOYOS3D, borrarBarra, borrarNudo3d, tipoBarra } from "../model3d.js";
import { BtnAgregar, BtnIcon, Campo, NumIn } from "./ui.jsx";
import { Interruptor } from "./Editor.jsx";

const MAX = 200;

export const PANELES3D = {
  proyecto: "Proyecto y opciones",
  ejes: "Ejes y niveles",
  material: "Materiales",
  secciones: "Secciones",
  nudos: "Nudos",
  elementos: "Barras",
  cargas: "Cargas",
  sismo: "Sismo (E.030)",
  combinaciones: "Combinaciones",
};

export function PanelEditor3D({ panel, modelo, commit, sel, setSel }) {
  const [filtro, setFiltro] = useState("");
  const p = { modelo, commit, sel, setSel, filtro };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {["nudos", "elementos"].includes(panel) && (
        <div className="border-b border-slate-200 p-3 dark:border-ink-line">
          <input className="inp w-full" placeholder="Filtrar por nombre…" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar" />
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {panel === "proyecto" && <Proyecto {...p} />}
        {panel === "ejes" && <Ejes {...p} />}
        {panel === "material" && <Materiales {...p} />}
        {panel === "secciones" && <Secciones {...p} />}
        {panel === "nudos" && <Nudos {...p} />}
        {panel === "elementos" && <Barras {...p} />}
        {panel === "cargas" && <Cargas {...p} />}
        {panel === "sismo" && <Sismo {...p} />}
        {panel === "combinaciones" && <Combinaciones {...p} />}
      </div>
    </div>
  );
}

/* ----------------------------- árbol ----------------------------- */
export function Arbol3D({ modelo, sel, setSel, abrirPanel, irA }) {
  const [abierto, setAbierto] = useState({ niveles: true });
  const t = (k) => setAbierto((a) => ({ ...a, [k]: !a[k] }));
  const cuenta = useMemo(() => {
    const c = {}; modelo.elementos.forEach((e) => { const k = tipoBarra(modelo, e); c[k] = (c[k] || 0) + 1; }); return c;
  }, [modelo]);
  const fila = "flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-ink-3";
  const N = ({ n }) => <span className="ml-auto rounded-full bg-teal/15 px-2 text-[11px] font-bold tabular-nums text-teal-dark dark:text-teal-soft">{n}</span>;
  return (
    <nav className="min-h-0 flex-1 overflow-y-auto py-2 text-sm" aria-label="Árbol del modelo 3D">
      <div className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{modelo.nombre} · 3D</div>
      <button className={fila} onClick={() => abrirPanel("proyecto")}><span className="w-4 text-center">⚙</span><span className="font-medium">Proyecto y opciones</span></button>
      <button className={fila} onClick={() => abrirPanel("ejes")}><span className="w-4 text-center">#</span><span className="font-medium">Ejes</span><span className="ml-auto text-xs text-slate-500">{modelo.ejes?.x?.length || 0} × {modelo.ejes?.y?.length || 0}</span></button>
      <div>
        <div className={fila}>
          <button onClick={() => t("niveles")} className="w-4 text-[10px] text-slate-500" aria-label="Desplegar niveles"><span className={`inline-block transition ${abierto.niveles ? "rotate-90" : ""}`}>▶</span></button>
          <button onClick={() => abrirPanel("ejes")} className="flex flex-1 items-center gap-2 font-medium">Niveles <N n={modelo.niveles.length} /></button>
        </div>
        {abierto.niveles && [...modelo.niveles].sort((a, b) => b.z - a.z).map((nv) => (
          <button key={nv.z} onClick={() => irA({ modo: "planta", z: nv.z })} className="flex w-full items-center gap-2 py-1 pl-12 pr-4 text-left text-[13px] hover:bg-slate-100 dark:hover:bg-ink-3" title="Ver en planta">
            <span className="font-medium">{nv.nombre}</span><span className="ml-auto text-xs tabular-nums text-slate-500">z = {nv.z} m</span>
          </button>
        ))}
      </div>
      <div>
        <div className={fila}>
          <button onClick={() => t("elev")} className="w-4 text-[10px] text-slate-500" aria-label="Desplegar elevaciones"><span className={`inline-block transition ${abierto.elev ? "rotate-90" : ""}`}>▶</span></button>
          <span className="flex-1 font-medium">Elevaciones (pórticos)</span>
        </div>
        {abierto.elev && [...(modelo.ejes?.y || []).map((e) => ({ ...e, eje: "x" })), ...(modelo.ejes?.x || []).map((e) => ({ ...e, eje: "y" }))].map((e) => (
          <button key={`${e.eje}${e.c}`} onClick={() => irA({ modo: "elevacion", eje: e.eje, c: e.c })} className="flex w-full items-center gap-2 py-1 pl-12 pr-4 text-left text-[13px] hover:bg-slate-100 dark:hover:bg-ink-3">
            <span className="font-medium">Eje {e.nombre}</span><span className="ml-auto text-xs text-slate-500">{e.eje === "x" ? `y = ${e.c}` : `x = ${e.c}`}</span>
          </button>
        ))}
      </div>
      <button className={fila} onClick={() => abrirPanel("material")}><span className="w-4 text-center">◧</span><span className="font-medium">Materiales</span><N n={(modelo.materiales || []).length} /></button>
      <button className={fila} onClick={() => abrirPanel("secciones")}><span className="w-4 text-center">▭</span><span className="font-medium">Secciones</span><N n={modelo.secciones.length} /></button>
      <button className={fila} onClick={() => abrirPanel("nudos")}><span className="w-4 text-center">•</span><span className="font-medium">Nudos</span><N n={modelo.nudos.length} /></button>
      <button className={fila} onClick={() => abrirPanel("elementos")}><span className="w-4 text-center">╱</span><span className="font-medium">Barras</span><N n={modelo.elementos.length} /></button>
      <div className="pb-1 pl-12 pr-4 text-[11px] text-slate-500 dark:text-slate-400">
        {[["columna", "columnas"], ["viga_x", "vigas en X"], ["viga_y", "vigas en Y"], ["viga", "vigas oblicuas"], ["diagonal", "diagonales"]].filter(([k]) => cuenta[k]).map(([k, l]) => `${cuenta[k]} ${l}`).join(" · ")}
      </div>
      <button className={fila} onClick={() => abrirPanel("cargas")}><span className="w-4 text-center">↓</span><span className="font-medium">Cargas</span><N n={(modelo.cargas_area || []).length + (modelo.cargas_barras || []).length + (modelo.cargas_nudos || []).length} /></button>
      <button className={fila} onClick={() => abrirPanel("sismo")}><span className="w-4 text-center">≈</span><span className="font-medium">Sismo E.030</span><span className="ml-auto text-xs text-slate-500">{modelo.sismo?.activo ? "activo" : "apagado"}</span></button>
      <button className={fila} onClick={() => abrirPanel("combinaciones")}><span className="w-4 text-center">Σ</span><span className="font-medium">Combinaciones</span><N n={(modelo.combinaciones || []).length} /></button>
    </nav>
  );
}

/* ----------------------------- paneles ----------------------------- */
function Proyecto({ modelo, commit }) {
  return (
    <>
      <Campo label="Nombre"><input className="inp" value={modelo.nombre} onChange={(e) => commit((m) => { m.nombre = e.target.value; })} /></Campo>
      <p className="text-xs text-slate-500 dark:text-slate-400">Unidades: tonf y m. Pórtico espacial con 6 GDL por nudo (deformación axial, flexión en dos planos y torsión).</p>
      <Interruptor label="Diafragma rígido en cada nivel (losa)" valor={!!modelo.diafragma} onChange={(v) => commit((m) => { m.diafragma = v; })} />
      <Interruptor label="Incluir peso propio de las barras" valor={!!modelo.peso_propio} onChange={(v) => commit((m) => { m.peso_propio = v; })} />
      {modelo.peso_propio && (
        <Campo label="Caso del peso propio">
          <select className="inp" value={modelo.caso_peso_propio || "CM"} onChange={(e) => commit((m) => { m.caso_peso_propio = e.target.value; })}>
            {(modelo.casos || []).map((c) => <option key={c.nombre}>{c.nombre}</option>)}
          </select>
        </Campo>
      )}
      <Campo label="Sección por defecto de columnas">
        <select className="inp" value={modelo.secc_col || ""} onChange={(e) => commit((m) => { m.secc_col = e.target.value; })}>{modelo.secciones.map((s) => <option key={s.nombre}>{s.nombre}</option>)}</select>
      </Campo>
      <Campo label="Sección por defecto de vigas">
        <select className="inp" value={modelo.secc_viga || ""} onChange={(e) => commit((m) => { m.secc_viga = e.target.value; })}>{modelo.secciones.map((s) => <option key={s.nombre}>{s.nombre}</option>)}</select>
      </Campo>
    </>
  );
}

function ListaCoord({ titulo, items, onSet, onAdd, onDel, etiqueta }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">{titulo}</h3>
      {items.map((e, k) => (
        <div key={k} className="grid grid-cols-[1fr_1fr_1.75rem] items-center gap-1">
          <input className="inp" value={e.nombre} aria-label="Nombre" onChange={(ev) => onSet(k, "nombre", ev.target.value)} />
          <NumIn value={e[etiqueta]} onChange={(v) => onSet(k, etiqueta, v)} aria-label={etiqueta} />
          <BtnIcon peligro title="Quitar" onClick={() => onDel(k)}>✕</BtnIcon>
        </div>
      ))}
      <BtnAgregar onClick={onAdd}>+ Agregar</BtnAgregar>
    </div>
  );
}

function Ejes({ modelo, commit }) {
  const lista = (clave, etiqueta, gen) => ({
    items: clave === "niveles" ? modelo.niveles : modelo.ejes[clave],
    etiqueta,
    onSet: (k, campo, v) => commit((m) => { (clave === "niveles" ? m.niveles : m.ejes[clave])[k][campo] = v; }),
    onDel: (k) => commit((m) => { (clave === "niveles" ? m.niveles : m.ejes[clave]).splice(k, 1); }),
    onAdd: () => commit((m) => { const arr = clave === "niveles" ? m.niveles : m.ejes[clave]; const u = arr[arr.length - 1]; arr.push(gen(arr.length, u)); }),
  });
  return (
    <>
      <p className="text-xs text-slate-500 dark:text-slate-400">Los ejes y niveles forman la grilla de dibujo (como en ETABS). Mover un eje no mueve los nudos ya dibujados.</p>
      <ListaCoord titulo="Ejes en X (posición x, m)" {...lista("x", "c", (n, u) => ({ nombre: String(n + 1), c: (u?.c ?? -5) + 5 }))} />
      <ListaCoord titulo="Ejes en Y (posición y, m)" {...lista("y", "c", (n, u) => ({ nombre: String.fromCharCode(65 + n), c: (u?.c ?? -5) + 5 }))} />
      <ListaCoord titulo="Niveles (altura z, m)" {...lista("niveles", "z", (n, u) => ({ nombre: `Piso ${n}`, z: (u?.z ?? -3) + 3 }))} />
    </>
  );
}

function Materiales({ modelo, commit }) {
  const mats = modelo.materiales || [];
  const Ec = (fc) => 15000 * Math.sqrt(+fc || 0) * 10;
  return (
    <>
      {mats.map((x, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-ink-line">
          <div className="flex items-center gap-2">
            <input className="inp flex-1 font-medium" value={x.nombre} aria-label="Nombre" onChange={(e) => commit((m) => {
              const viejo = m.materiales[i].nombre, nuevo = e.target.value; m.materiales[i].nombre = nuevo;
              if (m.material === viejo) m.material = nuevo;
              m.elementos.forEach((el) => { if (el.material === viejo) el.material = nuevo; });
            })} />
            <label className="flex items-center gap-1 text-xs"><input type="radio" checked={modelo.material === x.nombre} onChange={() => commit((m) => { m.material = x.nombre; })} className="accent-teal-600" />por defecto</label>
            <BtnIcon peligro title="Borrar material" onClick={() => commit((m) => { m.materiales.splice(i, 1); })}>✕</BtnIcon>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(x.modo || "fc") === "fc"
              ? <Campo label="f'c (kgf/cm²)" hint={`E = ${Ec(x.fc).toFixed(0)}`}><NumIn value={x.fc} onChange={(v) => commit((m) => { m.materiales[i].fc = v; })} /></Campo>
              : <Campo label="E (tonf/m²)"><NumIn value={x.E} onChange={(v) => commit((m) => { m.materiales[i].E = v; })} /></Campo>}
            <Campo label="Densidad (t/m³)"><NumIn value={x.densidad ?? 2.4} onChange={(v) => commit((m) => { m.materiales[i].densidad = v; })} /></Campo>
            <Campo label="ν (Poisson)"><NumIn value={x.nu ?? 0.2} onChange={(v) => commit((m) => { m.materiales[i].nu = v; })} /></Campo>
          </div>
          <button type="button" className="text-xs text-teal-dark underline dark:text-teal-soft" onClick={() => commit((m) => { const o = m.materiales[i]; m.materiales[i] = (o.modo || "fc") === "fc" ? { ...o, modo: "E", E: Ec(o.fc) } : { ...o, modo: "fc", fc: o.fc || 210 }; })}>
            {(x.modo || "fc") === "fc" ? "Dar E directo" : "Calcular E con f'c"}
          </button>
        </div>
      ))}
      <BtnAgregar onClick={() => commit((m) => { m.materiales = m.materiales || []; m.materiales.push({ nombre: `C${280}`, modo: "fc", fc: 280, densidad: 2.4, nu: 0.2 }); })}>+ Agregar material</BtnAgregar>
    </>
  );
}

function Secciones({ modelo, commit }) {
  const usados = useMemo(() => new Set(modelo.elementos.map((e) => e.seccion)), [modelo.elementos]);
  return (
    <>
      <p className="text-xs text-slate-500 dark:text-slate-400">Columnas: b en X y h en Y (el giro de 90° las intercambia). Vigas: b = ancho, h = peralte. Una sección muy alargada (2.40×0.25) funciona como placa.</p>
      {modelo.secciones.map((s, i) => (
        <div key={i} className="grid grid-cols-[1fr_4.5rem_4.5rem_1.75rem] items-end gap-1">
          <Campo label="Nombre"><input className="inp" value={s.nombre} onChange={(e) => commit((m) => {
            const viejo = m.secciones[i].nombre, nuevo = e.target.value; m.secciones[i].nombre = nuevo;
            m.elementos.forEach((el) => { if (el.seccion === viejo) el.seccion = nuevo; });
            if (m.secc_col === viejo) m.secc_col = nuevo; if (m.secc_viga === viejo) m.secc_viga = nuevo;
          })} /></Campo>
          <Campo label="b (m)"><NumIn value={s.b} onChange={(v) => commit((m) => { m.secciones[i].b = v; })} /></Campo>
          <Campo label="h (m)"><NumIn value={s.h} onChange={(v) => commit((m) => { m.secciones[i].h = v; })} /></Campo>
          <BtnIcon peligro title={usados.has(s.nombre) ? "En uso" : "Borrar"} onClick={() => { if (usados.has(s.nombre)) return alert(`La sección ${s.nombre} está asignada.`); commit((m) => { m.secciones.splice(i, 1); }); }}>✕</BtnIcon>
        </div>
      ))}
      <BtnAgregar onClick={() => commit((m) => { m.secciones.push({ nombre: `S${m.secciones.length + 1}`, b: 0.3, h: 0.5 }); })}>+ Agregar sección</BtnAgregar>
    </>
  );
}

function Nudos({ modelo, commit, sel, setSel, filtro }) {
  const f = filtro.trim().toLowerCase();
  const lista = modelo.nudos.filter((n) => !f || n.nombre.toLowerCase().includes(f));
  return (
    <>
      <div className="grid grid-cols-[3.5rem_1fr_1fr_1fr_1.3fr_1.75rem] gap-1 text-[11px] font-semibold uppercase text-slate-500"><span>Nudo</span><span>x</span><span>y</span><span>z</span><span>Apoyo</span><span /></div>
      {lista.slice(0, MAX).map((n) => {
        const set = (k, v) => commit((m) => { m.nudos.find((q) => q.id === n.id)[k] = v; });
        return (
          <div key={n.id} onClick={() => setSel({ tipo: "nudo", id: n.id })} className={`grid grid-cols-[3.5rem_1fr_1fr_1fr_1.3fr_1.75rem] items-center gap-1 rounded px-0.5 ${sel?.tipo === "nudo" && sel.id === n.id ? "bg-amber-100 dark:bg-amber-900/30" : ""}`}>
            <span className="truncate text-xs font-medium">{n.nombre}</span>
            <NumIn value={n.x} onChange={(v) => set("x", v)} /><NumIn value={n.y} onChange={(v) => set("y", v)} /><NumIn value={n.z} onChange={(v) => set("z", v)} />
            <select className="inp" value={n.apoyo} onChange={(e) => set("apoyo", e.target.value)}>{APOYOS3D.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <BtnIcon peligro title="Borrar nudo" onClick={(e) => { e.stopPropagation(); commit((m) => borrarNudo3d(m, n.id)); }}>✕</BtnIcon>
          </div>
        );
      })}
      {lista.length > MAX && <p className="text-xs text-slate-500">… {lista.length - MAX} más (usa el filtro)</p>}
    </>
  );
}

function Barras({ modelo, commit, sel, setSel, filtro }) {
  const f = filtro.trim().toLowerCase();
  const lista = modelo.elementos.filter((e) => !f || e.nombre.toLowerCase().includes(f) || e.seccion.toLowerCase().includes(f));
  const nom = Object.fromEntries(modelo.nudos.map((n) => [n.id, n.nombre]));
  return (
    <>
      <div className="grid grid-cols-[4rem_1fr_1fr_1.3fr_1.75rem] gap-1 text-[11px] font-semibold uppercase text-slate-500"><span>Barra</span><span>i</span><span>j</span><span>Sección</span><span /></div>
      {lista.slice(0, MAX).map((e) => (
        <div key={e.id} onClick={() => setSel({ tipo: "elemento", id: e.id })} className={`grid grid-cols-[4rem_1fr_1fr_1.3fr_1.75rem] items-center gap-1 rounded px-0.5 text-xs ${sel?.tipo === "elemento" && sel.id === e.id ? "bg-amber-100 dark:bg-amber-900/30" : ""}`}>
          <span className="truncate font-medium">{e.nombre}</span><span className="truncate">{nom[e.i]}</span><span className="truncate">{nom[e.j]}</span>
          <select className="inp" value={e.seccion} onChange={(ev) => commit((m) => { m.elementos.find((q) => q.id === e.id).seccion = ev.target.value; })}>{modelo.secciones.map((s) => <option key={s.nombre}>{s.nombre}</option>)}</select>
          <BtnIcon peligro title="Borrar barra" onClick={(ev) => { ev.stopPropagation(); commit((m) => borrarBarra(m, e.id)); }}>✕</BtnIcon>
        </div>
      ))}
      {lista.length > MAX && <p className="text-xs text-slate-500">… {lista.length - MAX} más (usa el filtro)</p>}
      <p className="text-xs text-slate-500 dark:text-slate-400">Dibuja barras en planta o en elevación con las herramientas Columna (C) y Barra (B).</p>
    </>
  );
}

function Cargas({ modelo, commit, sel }) {
  const casos = modelo.casos || [];
  const nivs = [...modelo.niveles].filter((n) => n.z > Math.min(...modelo.niveles.map((q) => q.z))).sort((a, b) => a.z - b.z);
  const selCaso = (v, on) => <select className="inp" value={v} onChange={(e) => on(e.target.value)}>{casos.map((c) => <option key={c.nombre}>{c.nombre}</option>)}</select>;
  return (
    <>
      <h3 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Casos de carga</h3>
      <div className="flex flex-wrap items-center gap-1">
        {casos.map((c, i) => (
          <span key={i} className="flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-xs dark:border-ink-line">
            <input className="w-14 bg-transparent font-semibold outline-none" value={c.nombre} onChange={(e) => commit((m) => {
              const viejo = m.casos[i].nombre, nuevo = e.target.value; m.casos[i].nombre = nuevo;
              [...(m.cargas_area || []), ...(m.cargas_barras || []), ...(m.cargas_nudos || [])].forEach((x) => { if (x.caso === viejo) x.caso = nuevo; });
            })} aria-label="Nombre del caso" />
            <button onClick={() => commit((m) => { m.casos.splice(i, 1); })} aria-label="Quitar caso" className="text-rose-500">✕</button>
          </span>
        ))}
        <button className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs" onClick={() => commit((m) => { m.casos.push({ nombre: ["CM", "CV", "CVT", "CW"].find((x) => !m.casos.some((c) => c.nombre === x)) || `C${m.casos.length + 1}` }); })}>+ caso</button>
      </div>

      <h3 className="pt-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Cargas de losa por nivel (tonf/m²)</h3>
      <p className="text-[11px] text-slate-500">Se reparten en dos direcciones (líneas a 45°) a las vigas de cada paño cerrado del nivel.</p>
      {(modelo.cargas_area || []).map((c, i) => (
        <div key={i} className="grid grid-cols-[1.3fr_1fr_1fr_1.75rem] items-end gap-1">
          <Campo label="Nivel"><select className="inp" value={c.z} onChange={(e) => commit((m) => { m.cargas_area[i].z = +e.target.value; })}>{nivs.map((n) => <option key={n.z} value={n.z}>{n.nombre}</option>)}</select></Campo>
          <Campo label="Caso">{selCaso(c.caso, (v) => commit((m) => { m.cargas_area[i].caso = v; }))}</Campo>
          <Campo label="q"><NumIn value={c.q} onChange={(v) => commit((m) => { m.cargas_area[i].q = v; })} /></Campo>
          <BtnIcon peligro title="Quitar" onClick={() => commit((m) => { m.cargas_area.splice(i, 1); })}>✕</BtnIcon>
        </div>
      ))}
      <BtnAgregar onClick={() => commit((m) => { m.cargas_area = m.cargas_area || []; m.cargas_area.push({ z: nivs[nivs.length - 1]?.z ?? 3, caso: casos[0]?.nombre || "CM", q: 0.4 }); })}>+ Carga de losa</BtnAgregar>
      <BtnAgregar onClick={() => {
        const qcm = parseFloat(prompt("CM en todos los niveles (tonf/m²):", "0.40")); if (!Number.isFinite(qcm)) return;
        const qcv = parseFloat(prompt("CV en todos los niveles (tonf/m²):", "0.25")); if (!Number.isFinite(qcv)) return;
        commit((m) => { m.cargas_area = nivs.flatMap((n) => [{ z: n.z, caso: "CM", q: qcm }, { z: n.z, caso: "CV", q: qcv }]); if (!m.casos.some((c) => c.nombre === "CV")) m.casos.push({ nombre: "CV" }); });
      }}>⚡ CM y CV en todos los niveles</BtnAgregar>

      <h3 className="pt-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Cargas en barras (wz, tonf/m; negativo = abajo)</h3>
      {(modelo.cargas_barras || []).map((c, i) => (
        <div key={i} className="grid grid-cols-[1.3fr_1fr_1fr_1.75rem] items-end gap-1">
          <Campo label="Barra"><span className="truncate py-1 text-sm">{modelo.elementos.find((e) => e.id === c.elem)?.nombre ?? "—"}</span></Campo>
          <Campo label="Caso">{selCaso(c.caso, (v) => commit((m) => { m.cargas_barras[i].caso = v; }))}</Campo>
          <Campo label="wz"><NumIn value={c.wz} onChange={(v) => commit((m) => { m.cargas_barras[i].wz = v; })} /></Campo>
          <BtnIcon peligro title="Quitar" onClick={() => commit((m) => { m.cargas_barras.splice(i, 1); })}>✕</BtnIcon>
        </div>
      ))}
      <p className="text-[11px] text-slate-500">Para cargar una barra o un nudo, selecciónalo y usa su panel de propiedades.</p>

      <h3 className="pt-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Cargas en nudos</h3>
      {(modelo.cargas_nudos || []).map((c, i) => (
        <div key={i} className="space-y-1 rounded-lg border border-slate-200 p-2 dark:border-ink-line">
          <div className="flex items-center gap-2 text-xs"><b>{modelo.nudos.find((n) => n.id === c.nudo)?.nombre}</b>{selCaso(c.caso, (v) => commit((m) => { m.cargas_nudos[i].caso = v; }))}<BtnIcon peligro title="Quitar" onClick={() => commit((m) => { m.cargas_nudos.splice(i, 1); })}>✕</BtnIcon></div>
          <div className="grid grid-cols-6 gap-1">
            {["Fx", "Fy", "Fz", "Mx", "My", "Mz"].map((l, k) => <Campo key={l} label={l}><NumIn value={c.F?.[k] ?? 0} onChange={(v) => commit((m) => { const F = m.cargas_nudos[i].F || [0, 0, 0, 0, 0, 0]; F[k] = v; m.cargas_nudos[i].F = F; })} /></Campo>)}
          </div>
        </div>
      ))}
      {sel && <p className="text-[11px] text-slate-500">Selección actual: {sel.tipo} {sel.id}.</p>}
    </>
  );
}

function Sismo({ modelo, commit }) {
  const s = modelo.sismo || {};
  const set = (k, v) => commit((m) => { m.sismo = { ...(m.sismo || {}), [k]: v }; });
  return (
    <>
      <Interruptor label="Sismo estático E.030 en X e Y" valor={!!s.activo} onChange={(v) => commit((m) => { m.sismo = { ...(m.sismo || {}), activo: v }; if (v) m.diafragma = true; })} />
      <p className="text-[11px] text-slate-500">Fuerzas por nivel en el centro de masas, con 5 % de excentricidad accidental. Peso sísmico = CM + 25 % CV. Requiere diafragma rígido.</p>
      <div className="grid grid-cols-3 gap-1">
        {[["Z", "Z"], ["U", "U"], ["S", "S"], ["R", "R"], ["TP", "TP (s)"], ["CT", "CT"]].map(([k, l]) => <Campo key={k} label={l}><NumIn value={s[k]} onChange={(v) => set(k, v)} /></Campo>)}
      </div>
      <Campo label="Periodo para las fuerzas">
        <select className="inp" value={s.periodo || "norma"} onChange={(e) => set("periodo", e.target.value)}>
          <option value="norma">T = hn / CT (norma)</option>
          <option value="modal">T del análisis modal 3D (por dirección)</option>
        </select>
      </Campo>
      <Campo label="Deriva límite"><NumIn value={s.limite_deriva ?? 0.007} onChange={(v) => set("limite_deriva", v)} /></Campo>
    </>
  );
}

function Combinaciones({ modelo, commit }) {
  const casos = [...(modelo.casos || []).map((c) => c.nombre), ...(modelo.sismo?.activo ? ["SX", "SY"] : [])];
  const combos = modelo.combinaciones || [];
  return (
    <>
      <p className="text-xs text-slate-500 dark:text-slate-400">Sin combinaciones definidas se usan las de la E.060: 1.4CM+1.7CV y, con sismo, 1.25(CM+CV)±S y 0.9CM±S.</p>
      {combos.map((cb, i) => (
        <div key={i} className="space-y-1 rounded-lg border border-slate-200 p-2 dark:border-ink-line">
          <div className="flex items-center gap-2">
            <input className="inp flex-1 font-medium" value={cb.nombre} onChange={(e) => commit((m) => { m.combinaciones[i].nombre = e.target.value; })} aria-label="Nombre" />
            <BtnIcon peligro title="Quitar" onClick={() => commit((m) => { m.combinaciones.splice(i, 1); })}>✕</BtnIcon>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {casos.map((c) => <Campo key={c} label={c}><NumIn value={cb.factores?.[c] ?? 0} onChange={(v) => commit((m) => { const f = (m.combinaciones[i].factores = m.combinaciones[i].factores || {}); if (v) f[c] = v; else delete f[c]; })} /></Campo>)}
          </div>
        </div>
      ))}
      <BtnAgregar onClick={() => commit((m) => { m.combinaciones = m.combinaciones || []; m.combinaciones.push({ nombre: `Comb${m.combinaciones.length + 1}`, factores: { CM: 1.4, CV: 1.7 } }); })}>+ Agregar combinación</BtnAgregar>
    </>
  );
}

/* ----------------------------- propiedades ----------------------------- */
export function Props3D({ modelo, sel, setSel, commit, abrirPanel }) {
  const nudo = sel?.tipo === "nudo" ? modelo.nudos.find((n) => n.id === sel.id) : null;
  const el = sel?.tipo === "elemento" ? modelo.elementos.find((e) => e.id === sel.id) : null;
  const casos = modelo.casos || [];
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white dark:border-ink-line dark:bg-ink-2" aria-label="Propiedades">
      <div className="flex h-10 shrink-0 items-center border-b border-slate-200 px-4 dark:border-ink-line">
        <h2 className="text-sm font-semibold">{nudo ? `Nudo ${nudo.nombre}` : el ? `Barra ${el.nombre}` : "Propiedades"}</h2>
        {(nudo || el) && <button className="ml-auto text-xs text-slate-500" onClick={() => setSel(null)}>Deseleccionar (Esc)</button>}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {nudo && (<>
          <div className="grid grid-cols-3 gap-1">
            {["x", "y", "z"].map((k) => <Campo key={k} label={`${k} (m)`}><NumIn value={nudo[k]} onChange={(v) => commit((m) => { m.nudos.find((q) => q.id === nudo.id)[k] = v; })} /></Campo>)}
          </div>
          <Campo label="Apoyo">
            <div className="grid grid-cols-3 gap-1">
              {APOYOS3D.map(([v, l]) => <button key={v} onClick={() => commit((m) => { m.nudos.find((q) => q.id === nudo.id).apoyo = v; })} className={`rounded-md border px-2 py-1 text-xs ${nudo.apoyo === v ? "border-teal bg-teal text-white" : "border-slate-200 dark:border-ink-line"}`}>{l}</button>)}
            </div>
          </Campo>
          <BtnAgregar onClick={() => commit((m) => { m.cargas_nudos = m.cargas_nudos || []; m.cargas_nudos.push({ nudo: nudo.id, caso: casos[0]?.nombre || "CM", F: [0, 0, -1, 0, 0, 0] }); })}>+ Carga en este nudo</BtnAgregar>
          <button className="w-full rounded-md border border-rose-200 py-1.5 text-sm text-rose-600 dark:border-rose-900 dark:text-rose-400" onClick={() => { commit((m) => borrarNudo3d(m, nudo.id)); setSel(null); }}>🗑 Eliminar nudo y sus barras (Supr)</button>
        </>)}
        {el && (() => {
          const a = modelo.nudos.find((n) => n.id === el.i), b = modelo.nudos.find((n) => n.id === el.j);
          const L = a && b ? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) : 0;
          const tipo = tipoBarra(modelo, el);
          const cargas = (modelo.cargas_barras || []).map((c, i) => ({ c, i })).filter(({ c }) => c.elem === el.id);
          return (<>
            <Campo label="Nombre"><input className="inp" value={el.nombre} onChange={(e) => commit((m) => { m.elementos.find((q) => q.id === el.id).nombre = e.target.value; })} /></Campo>
            <div className="rounded-md bg-slate-100 px-3 py-2 text-xs dark:bg-ink-3">{{ columna: "Columna", viga_x: "Viga en X", viga_y: "Viga en Y", viga: "Viga oblicua", diagonal: "Diagonal" }[tipo] || "Barra"} · {a?.nombre} → {b?.nombre} · L = {L.toFixed(3)} m</div>
            <div className="grid grid-cols-2 gap-1">
              <Campo label="Sección"><select className="inp" value={el.seccion} onChange={(e) => commit((m) => { m.elementos.find((q) => q.id === el.id).seccion = e.target.value; })}>{modelo.secciones.map((s) => <option key={s.nombre}>{s.nombre}</option>)}</select></Campo>
              <Campo label="Material"><select className="inp" value={el.material || ""} onChange={(e) => commit((m) => { m.elementos.find((q) => q.id === el.id).material = e.target.value || undefined; })}><option value="">Por defecto</option>{(modelo.materiales || []).map((x) => <option key={x.nombre}>{x.nombre}</option>)}</select></Campo>
            </div>
            {tipo === "columna" && <Interruptor label="Girar la sección 90° (b en Y)" valor={(+el.giro || 0) % 180 === 90} onChange={(v) => commit((m) => { m.elementos.find((q) => q.id === el.id).giro = v ? 90 : 0; })} />}
            <h3 className="pt-2 text-xs font-semibold uppercase text-slate-500">Cargas en la barra</h3>
            {cargas.map(({ c, i }) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1.75rem] items-end gap-1">
                <Campo label="Caso"><select className="inp" value={c.caso} onChange={(e) => commit((m) => { m.cargas_barras[i].caso = e.target.value; })}>{casos.map((x) => <option key={x.nombre}>{x.nombre}</option>)}</select></Campo>
                <Campo label="wz (t/m)"><NumIn value={c.wz} onChange={(v) => commit((m) => { m.cargas_barras[i].wz = v; })} /></Campo>
                <BtnIcon peligro title="Quitar" onClick={() => commit((m) => { m.cargas_barras.splice(i, 1); })}>✕</BtnIcon>
              </div>
            ))}
            <BtnAgregar onClick={() => commit((m) => { m.cargas_barras = m.cargas_barras || []; m.cargas_barras.push({ elem: el.id, caso: casos[0]?.nombre || "CM", wz: -1 }); })}>+ Carga uniforme</BtnAgregar>
            <button className="w-full rounded-md border border-rose-200 py-1.5 text-sm text-rose-600 dark:border-rose-900 dark:text-rose-400" onClick={() => { commit((m) => borrarBarra(m, el.id)); setSel(null); }}>🗑 Eliminar barra (Supr)</button>
          </>);
        })()}
        {!nudo && !el && (<>
          <div className="font-semibold">{modelo.nombre}</div>
          <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-ink-line dark:border-ink-line">
            {[["Nudos", modelo.nudos.length, "nudos"], ["Barras", modelo.elementos.length, "elementos"], ["Niveles", modelo.niveles.length, "ejes"], ["Secciones", modelo.secciones.length, "secciones"], ["Cargas de losa", (modelo.cargas_area || []).length, "cargas"]].map(([k, v, p]) => (
              <button key={k} onClick={() => abrirPanel(p)} className="flex w-full justify-between px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-ink-3"><dt className="text-slate-600 dark:text-slate-300">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></button>
            ))}
            <div className="flex justify-between px-3 py-2"><dt className="text-slate-600 dark:text-slate-300">Diafragma rígido</dt><dd>{modelo.diafragma ? "sí" : "no"}</dd></div>
            <div className="flex justify-between px-3 py-2"><dt className="text-slate-600 dark:text-slate-300">Sismo</dt><dd>{modelo.sismo?.activo ? "E.030 X e Y" : "no"}</dd></div>
          </dl>
          <div className="rounded-lg bg-slate-100 p-3 text-xs leading-relaxed text-slate-600 dark:bg-ink-3 dark:text-slate-300">
            <p className="mb-1 font-semibold">Cómo dibujar</p>
            <p>En <b>Planta</b>: Columna (C) pone una columna bajo el punto, desde el nivel anterior; Barra (B) une dos puntos del nivel (vigas).</p>
            <p className="mt-1">En <b>Elevación</b>: Barra (B) une dos puntos del plano (columnas, vigas o diagonales).</p>
            <p className="mt-1">En <b>3D</b>: arrastra para girar y haz clic para seleccionar.</p>
          </div>
        </>)}
      </div>
    </aside>
  );
}
