import { useMemo, useState } from "react";
import { APOYOS, TIPOS_CARGA, borrarElemento, borrarNudo, nextId, propsSeccion } from "../model.js";
import { pedir } from "../pedir.js";
import { BtnAgregar, BtnIcon, Campo, NombreUnico, NumIn } from "./ui.jsx";

const MAX_FILAS = 200;

// Paneles que se abren uno a la vez en la columna izquierda (desde el menú, el árbol o el buscador).
export const PANELES = {
  proyecto: "Proyecto y opciones de análisis",
  material: "Materiales",
  secciones: "Secciones",
  nudos: "Nudos",
  elementos: "Elementos",
  cargas_nudos: "Cargas en nudos",
  cargas_elementos: "Cargas en elementos",
  casos: "Casos de carga y combinaciones",
};

export function PanelEditor({ panel, modelo, commit, sel, setSel }) {
  const [filtro, setFiltro] = useState("");
  const conFiltro = ["nudos", "elementos", "cargas_nudos", "cargas_elementos"].includes(panel);
  const p = { modelo, commit, sel, setSel, filtro };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {conFiltro && (
        <div className="border-b border-slate-200 p-3 dark:border-ink-line">
          <input className="inp w-full" placeholder="Filtrar por nombre…" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar" />
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {panel === "proyecto" && <Proyecto {...p} />}
        {panel === "material" && <Material {...p} />}
        {panel === "secciones" && <Secciones {...p} />}
        {panel === "nudos" && <Nudos {...p} />}
        {panel === "elementos" && <Elementos {...p} />}
        {panel === "cargas_nudos" && <CargasNudos {...p} />}
        {panel === "cargas_elementos" && <CargasElementos {...p} />}
        {panel === "casos" && <Casos {...p} />}
      </div>
    </div>
  );
}

/* ----------------------------- ÁRBOL DEL MODELO ----------------------------- */
// Vista por defecto de la columna izquierda: navegar el modelo. Clic en un grupo abre su panel;
// clic en un nudo o elemento lo selecciona en el lienzo.
export function Arbol({ modelo, sel, setSel, abrirPanel }) {
  const [abiertos, setAbiertos] = useState({ nudos: false, elementos: false, secciones: false });
  const [filtro, setFiltro] = useState("");
  const f = filtro.trim().toLowerCase();
  const toggle = (k) => setAbiertos((a) => ({ ...a, [k]: !a[k] }));
  const nudos = modelo.nudos.filter((n) => !f || n.nombre.toLowerCase().includes(f));
  const elems = modelo.elementos.filter((e) => !f || e.nombre.toLowerCase().includes(f) || (e.seccion || "").toLowerCase().includes(f));
  const secs = modelo.secciones.filter((s) => !f || s.nombre.toLowerCase().includes(f));
  const abierto = (k) => abiertos[k] || !!f;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-slate-200 p-3 dark:border-ink-line">
        <input className="inp w-full" placeholder="Buscar nudo, elemento o sección…" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Buscar en el modelo" />
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto py-2 text-sm" aria-label="Árbol del modelo">
        <div className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{modelo.nombre}</div>
        <Hoja icono="⚙" label="Proyecto y opciones" onClick={() => abrirPanel("proyecto")} />
        <Hoja icono="◧" label="Materiales" detalle={modelo.material?.modo === "fc" ? `f'c ${modelo.material.fc}` : "E global"} onClick={() => abrirPanel("material")} />
        <Grupo icono="▭" label="Secciones" cuenta={modelo.secciones.length} abierto={abierto("secciones")} onToggle={() => toggle("secciones")} onAbrir={() => abrirPanel("secciones")}>
          {secs.slice(0, MAX_FILAS).map((s) => {
            const p = propsSeccion(s);
            return <Item key={s.nombre} label={s.nombre} detalle={(s.modo || "rect") === "rect" ? `${s.b}×${s.h}` : `A ${p.A.toFixed(3)}`} onClick={() => abrirPanel("secciones")} />;
          })}
        </Grupo>
        <Grupo icono="•" label="Nudos" cuenta={modelo.nudos.length} abierto={abierto("nudos")} onToggle={() => toggle("nudos")} onAbrir={() => abrirPanel("nudos")}>
          {nudos.slice(0, MAX_FILAS).map((n) => (
            <Item key={n.id} label={n.nombre} detalle={`(${+n.x}, ${+n.y})${n.apoyo !== "libre" ? " · " + n.apoyo.replace("_", " ") : ""}`}
              activo={sel?.tipo === "nudo" && sel.id === n.id} onClick={() => setSel({ tipo: "nudo", id: n.id })} />
          ))}
          {nudos.length > MAX_FILAS && <Mas n={nudos.length - MAX_FILAS} />}
        </Grupo>
        <Grupo icono="╱" label="Elementos" cuenta={modelo.elementos.length} abierto={abierto("elementos")} onToggle={() => toggle("elementos")} onAbrir={() => abrirPanel("elementos")}>
          {elems.slice(0, MAX_FILAS).map((e) => (
            <Item key={e.id} label={e.nombre} detalle={e.seccion + ((e.segmentos || e.tramos || []).length >= 2 ? " · tramos" : "")}
              activo={sel?.tipo === "elemento" && sel.id === e.id} onClick={() => setSel({ tipo: "elemento", id: e.id })} />
          ))}
          {elems.length > MAX_FILAS && <Mas n={elems.length - MAX_FILAS} />}
        </Grupo>
        <Hoja icono="↓" label="Cargas en nudos" cuenta={modelo.cargas_nodales.length} onClick={() => abrirPanel("cargas_nudos")} />
        <Hoja icono="⇊" label="Cargas en elementos" cuenta={modelo.cargas_elementos.length} onClick={() => abrirPanel("cargas_elementos")} />
        <Hoja icono="Σ" label="Casos y combinaciones" cuenta={(modelo.combinaciones || []).length} detalle={(modelo.casos || []).length ? `${modelo.casos.length} casos` : "sin casos"} onClick={() => abrirPanel("casos")} />
      </nav>
    </div>
  );
}

const Cuenta = ({ n }) => <span className="ml-auto rounded-full bg-teal/15 px-2 text-[11px] font-bold tabular-nums text-teal-dark dark:text-teal-soft">{n}</span>;
const Mas = ({ n }) => <p className="py-1 pl-12 text-xs text-slate-500">… {n} más (usa el buscador)</p>;

function Hoja({ icono, label, detalle, cuenta, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-ink-3">
      <span className="w-4 shrink-0" />
      <span className="w-4 shrink-0 text-center text-slate-500 dark:text-slate-400">{icono}</span>
      <span className="font-medium">{label}</span>
      {detalle && <span className="ml-auto truncate text-xs text-slate-500 dark:text-slate-400">{detalle}</span>}
      {cuenta != null && <Cuenta n={cuenta} />}
    </button>
  );
}

function Grupo({ icono, label, cuenta, abierto, onToggle, onAbrir, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-1.5 hover:bg-slate-100 dark:hover:bg-ink-3">
        <button type="button" onClick={onToggle} aria-expanded={abierto} aria-label={`${abierto ? "Plegar" : "Desplegar"} ${label}`}
          className="grid w-4 shrink-0 place-items-center text-[10px] text-slate-500">
          <span className={`transition ${abierto ? "rotate-90" : ""}`}>▶</span>
        </button>
        <span className="w-4 shrink-0 text-center text-slate-500 dark:text-slate-400">{icono}</span>
        <button type="button" onClick={onAbrir} className="flex flex-1 items-center gap-2 text-left font-medium" title={`Abrir el panel de ${label.toLowerCase()}`}>
          {label}<Cuenta n={cuenta} />
        </button>
      </div>
      {abierto && <div className="pb-1">{children}</div>}
    </div>
  );
}

function Item({ label, detalle, activo, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-current={activo || undefined}
      className={`flex w-full items-center gap-2 py-1 pl-12 pr-4 text-left text-[13px] ${activo ? "bg-amber-100 dark:bg-amber-900/30" : "hover:bg-slate-100 dark:hover:bg-ink-3"}`}>
      <span className="font-medium">{label}</span>
      <span className="ml-auto truncate text-xs tabular-nums text-slate-500 dark:text-slate-400">{detalle}</span>
    </button>
  );
}

/* ----------------------------- DEFINIR ----------------------------- */
function Proyecto({ modelo, commit }) {
  return (
    <>
      <Campo label="Nombre del proyecto">
        <input className="inp" value={modelo.nombre} onChange={(e) => commit((m) => { m.nombre = e.target.value; })} />
      </Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo label="Unidad de fuerza">
          <select className="inp" value={modelo.unidad_fuerza} onChange={(e) => commit((m) => { m.unidad_fuerza = e.target.value; })}>
            {["tonf", "kgf", "kN", "N"].map((u) => <option key={u}>{u}</option>)}
          </select>
        </Campo>
        <Campo label="Unidad de longitud">
          <select className="inp" value={modelo.unidad_longitud} onChange={(e) => commit((m) => { m.unidad_longitud = e.target.value; })}>
            {["m", "cm", "mm"].map((u) => <option key={u}>{u}</option>)}
          </select>
        </Campo>
      </div>
      <h3 className="pt-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Opciones de análisis</h3>
      <Interruptor label="Despreciar deformaciones axiales (método a mano)" valor={!!modelo.despreciar_axial} onChange={(v) => commit((m) => { m.despreciar_axial = v; })} />
      <Interruptor label="Incluir peso propio" valor={!!modelo.peso_propio} onChange={(v) => commit((m) => { m.peso_propio = v; })} />
      <Interruptor label="Timoshenko (deformación por cortante)" valor={!!modelo.timoshenko} onChange={(v) => commit((m) => { m.timoshenko = v; })} />
      <Interruptor label="P-Delta (2.º orden)" valor={!!modelo.pdelta} onChange={(v) => commit((m) => { m.pdelta = v; })} />
      <Interruptor label="Análisis modal (frecuencias y modos)" valor={!!modelo.analisis_modal} onChange={(v) => commit((m) => { m.analisis_modal = v; })} />
      {modelo.analisis_modal && (
        <Campo label="Número de modos"><NumIn value={modelo.n_modos ?? 6} onChange={(v) => commit((m) => { m.n_modos = Math.max(1, Math.round(v)); })} /></Campo>
      )}
    </>
  );
}

function Material({ modelo, commit }) {
  const mat = modelo.material;
  const Ec = (fc) => 15000 * Math.sqrt(+fc || 0) * 10;
  const usados = useMemo(() => new Set(modelo.elementos.map((e) => e.material).filter(Boolean)), [modelo.elementos]);
  const mats = modelo.materiales || [];
  return (
    <>
      <h3 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Material por defecto</h3>
      <ModoMaterial valor={mat.modo} onChange={(k) => commit((m) => { m.material = k === "fc" ? { modo: "fc", fc: m.material.fc || 210 } : { modo: "E", E: m.material.E || 2e6 }; })} />
      {mat.modo === "fc" ? (
        <Campo label="f'c (kgf/cm²)" hint={`E = 15000·√f'c = ${Ec(mat.fc).toFixed(0)} tonf/m²`}>
          <NumIn value={mat.fc} onChange={(v) => commit((m) => { m.material.fc = v; })} />
        </Campo>
      ) : (
        <Campo label="E (tonf/m²)"><NumIn value={mat.E} onChange={(v) => commit((m) => { m.material.E = v; })} /></Campo>
      )}
      <Campo label="Densidad (t/m³)" hint="Necesaria para el peso propio y el análisis modal (concreto ≈ 2.4).">
        <NumIn value={mat.densidad ?? 0} onChange={(v) => commit((m) => { m.material.densidad = v; })} />
      </Campo>

      <h3 className="pt-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Materiales con nombre <span className="font-normal normal-case">(se asignan por elemento o por tramo)</span></h3>
      {mats.map((x, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-ink-line">
          <div className="flex items-center gap-2">
            <NombreUnico className="flex-1 font-medium" value={x.nombre} otros={(modelo.materiales || []).filter((_, k) => k !== i).map((q) => q.nombre)} aria-label="Nombre del material"
              onChange={(nuevoNombre) => commit((m) => {
                const viejo = m.materiales[i].nombre, nuevo = nuevoNombre;
                m.materiales[i].nombre = nuevo;
                m.elementos.forEach((el) => {
                  if (el.material === viejo) el.material = nuevo;
                  (el.segmentos || el.tramos || []).forEach((s) => { if (s.material === viejo) s.material = nuevo; });
                });
              })} />
            <BtnIcon peligro title={usados.has(x.nombre) ? "En uso: no se puede borrar" : "Borrar material"}
              onClick={() => { if (usados.has(x.nombre)) return alert(`El material ${x.nombre} está asignado a elementos.`); commit((m) => { m.materiales.splice(i, 1); }); }}>✕</BtnIcon>
          </div>
          <ModoMaterial valor={x.modo || "E"} onChange={(k) => commit((m) => { const o = m.materiales[i]; m.materiales[i] = k === "fc" ? { ...o, modo: "fc", fc: o.fc || 210 } : { ...o, modo: "E", E: o.E || 2e6 }; })} />
          {(x.modo || "E") === "fc"
            ? <Campo label="f'c (kgf/cm²)" hint={`E = ${Ec(x.fc).toFixed(0)} tonf/m²`}><NumIn value={x.fc} onChange={(v) => commit((m) => { m.materiales[i].fc = v; })} /></Campo>
            : <Campo label="E (tonf/m²)"><NumIn value={x.E} onChange={(v) => commit((m) => { m.materiales[i].E = v; })} /></Campo>}
        </div>
      ))}
      <BtnAgregar onClick={() => commit((m) => { m.materiales = m.materiales || []; m.materiales.push({ nombre: `MAT${m.materiales.length + 1}`, modo: "fc", fc: 210, densidad: 2.4, nu: 0.2 }); })}>+ Agregar material</BtnAgregar>
    </>
  );
}

function ModoMaterial({ valor, onChange }) {
  return (
    <div className="flex rounded-md border border-slate-200 p-0.5 text-xs dark:border-ink-line" role="radiogroup">
      {[["E", "Módulo E"], ["fc", "Por f'c (E.060)"]].map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={valor === k} onClick={() => onChange(k)}
          className={`flex-1 rounded px-2 py-1 ${valor === k ? "bg-teal text-white" : "text-slate-600 dark:text-slate-300"}`}>{l}</button>
      ))}
    </div>
  );
}

function Secciones({ modelo, commit }) {
  const usados = useMemo(() => {
    const s = new Set();
    modelo.elementos.forEach((e) => { s.add(e.seccion); (e.segmentos || e.tramos || []).forEach((t) => s.add(t.seccion)); });
    return s;
  }, [modelo.elementos]);
  return (
    <>
      {modelo.secciones.map((s, i) => {
        const p = propsSeccion(s);
        return (
          <div key={i} className="rounded-lg border border-slate-200 p-2 dark:border-ink-line">
            <div className="mb-2 flex items-center gap-2">
              <NombreUnico className="font-medium" value={s.nombre} otros={modelo.secciones.filter((_, k) => k !== i).map((q) => q.nombre)} aria-label="Nombre de la sección"
                onChange={(nuevoNombre) => commit((m) => {
                  const viejo = m.secciones[i].nombre, nuevo = nuevoNombre;
                  m.secciones[i].nombre = nuevo;
                  m.elementos.forEach((el) => {
                    if (el.seccion === viejo) el.seccion = nuevo;
                    (el.segmentos || el.tramos || []).forEach((t) => { if (t.seccion === viejo) t.seccion = nuevo; });
                  });
                })} />
              <select className="inp w-28" value={s.modo || "rect"} aria-label="Tipo de sección" onChange={(e) => commit((m) => {
                const x = m.secciones[i];
                if (e.target.value === "AI") { const q = propsSeccion(x); m.secciones[i] = { nombre: x.nombre, modo: "AI", A: +q.A.toFixed(5), I: +q.I.toExponential(4) }; }
                else m.secciones[i] = { nombre: x.nombre, modo: "rect", b: 0.3, h: 0.5 };
              })}>
                <option value="rect">Rectangular</option>
                <option value="AI">A e I directos</option>
              </select>
              <BtnIcon title="Duplicar sección" onClick={() => commit((m) => { m.secciones.splice(i + 1, 0, { ...m.secciones[i], nombre: m.secciones[i].nombre + "_2" }); })}>⧉</BtnIcon>
              <BtnIcon peligro title={usados.has(s.nombre) ? "En uso: no se puede borrar" : "Borrar sección"}
                onClick={() => { if (usados.has(s.nombre)) return alert(`La sección ${s.nombre} está asignada a elementos.`); commit((m) => { m.secciones.splice(i, 1); }); }}>✕</BtnIcon>
            </div>
            {(s.modo || "rect") === "rect" ? (
              <div className="grid grid-cols-2 gap-2">
                <Campo label="b (m) — ancho"><NumIn value={s.b} onChange={(v) => commit((m) => { m.secciones[i].b = v; })} /></Campo>
                <Campo label="h (m) — peralte"><NumIn value={s.h} onChange={(v) => commit((m) => { m.secciones[i].h = v; })} /></Campo>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Campo label="A (m²)"><NumIn value={s.A} onChange={(v) => commit((m) => { m.secciones[i].A = v; })} /></Campo>
                <Campo label="I (m⁴)"><NumIn value={s.I} onChange={(v) => commit((m) => { m.secciones[i].I = v; })} /></Campo>
              </div>
            )}
            <div className="mt-1.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">A = {p.A.toFixed(4)} m² · I = {p.I.toExponential(3)} m⁴ · {usados.has(s.nombre) ? "en uso" : "sin usar"}</div>
          </div>
        );
      })}
      <BtnAgregar onClick={() => commit((m) => { m.secciones.push({ nombre: `S${m.secciones.length + 1}`, modo: "rect", b: 0.3, h: 0.5 }); })}>+ Agregar sección</BtnAgregar>
    </>
  );
}

/* ----------------------------- MODELAR ----------------------------- */
function Nudos({ modelo, commit, sel, setSel, filtro }) {
  const f = filtro.trim().toLowerCase();
  const nudos = modelo.nudos.filter((n) => !f || n.nombre.toLowerCase().includes(f));
  return (
    <>
      <div className="grid grid-cols-[3.2rem_1fr_1fr_1.3fr_1.75rem] gap-1 px-1 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
        <span>Nudo</span><span>X</span><span>Y</span><span>Apoyo</span><span />
      </div>
      {nudos.slice(0, MAX_FILAS).map((n) => {
        const activo = sel?.tipo === "nudo" && sel.id === n.id;
        const set = (k, v) => commit((m) => { const x = m.nudos.find((q) => q.id === n.id); x[k] = v; });
        return (
          <div key={n.id} onClick={() => setSel({ tipo: "nudo", id: n.id })}
            className={`grid grid-cols-[3.2rem_1fr_1fr_1.3fr_1.75rem] items-center gap-1 rounded-md px-1 py-0.5 ${activo ? "bg-amber-100 ring-1 ring-amber-400 dark:bg-amber-900/30" : ""}`}>
            <span className="truncate text-sm font-medium">{n.nombre}</span>
            <NumIn value={n.x} onChange={(v) => set("x", v)} aria-label={`X de ${n.nombre}`} />
            <NumIn value={n.y} onChange={(v) => set("y", v)} aria-label={`Y de ${n.nombre}`} />
            <select className="inp" value={n.apoyo} onChange={(e) => set("apoyo", e.target.value)} aria-label={`Apoyo de ${n.nombre}`}>
              {APOYOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <BtnIcon peligro title={`Borrar ${n.nombre} (y sus barras)`} onClick={(e) => { e.stopPropagation(); commit((m) => borrarNudo(m, n.id)); }}>✕</BtnIcon>
          </div>
        );
      })}
      {nudos.length > MAX_FILAS && <p className="text-xs text-slate-500">… {nudos.length - MAX_FILAS} más (usa el filtro)</p>}
      <BtnAgregar onClick={() => {
        const id = nextId(modelo.nudos);
        commit((m) => {
          const u = m.nudos[m.nudos.length - 1];
          m.nudos.push({ id, nombre: `N${id}`, x: u ? +u.x + 1 : 0, y: u ? +u.y : 0, apoyo: "libre" });
        });
        setSel({ tipo: "nudo", id });
      }}>
        + Agregar nudo <span className="text-xs text-slate-500">(o herramienta Nudo, tecla N)</span>
      </BtnAgregar>
    </>
  );
}

function Elementos({ modelo, commit, sel, setSel, filtro }) {
  const f = filtro.trim().toLowerCase();
  const elems = modelo.elementos.filter((e) => !f || e.nombre.toLowerCase().includes(f) || (e.seccion || "").toLowerCase().includes(f));
  return (
    <>
      <div className="grid grid-cols-[3rem_1fr_1fr_1.4fr_1.75rem] gap-1 px-1 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
        <span>Elem.</span><span>Nudo i</span><span>Nudo j</span><span>Sección</span><span />
      </div>
      {elems.slice(0, MAX_FILAS).map((e) => {
        const activo = sel?.tipo === "elemento" && sel.id === e.id;
        const set = (k, v) => commit((m) => { const x = m.elementos.find((q) => q.id === e.id); x[k] = v; });
        return (
          <div key={e.id} onClick={() => setSel({ tipo: "elemento", id: e.id })}
            className={`grid grid-cols-[3rem_1fr_1fr_1.4fr_1.75rem] items-center gap-1 rounded-md px-1 py-0.5 ${activo ? "bg-amber-100 ring-1 ring-amber-400 dark:bg-amber-900/30" : ""}`}>
            <span className="truncate text-sm font-medium">{e.nombre}</span>
            <NudoSelect modelo={modelo} value={e.i} onChange={(v) => set("i", v)} etiqueta={`Nudo i de ${e.nombre}`} />
            <NudoSelect modelo={modelo} value={e.j} onChange={(v) => set("j", v)} etiqueta={`Nudo j de ${e.nombre}`} />
            <select className="inp" value={e.seccion} onChange={(ev) => set("seccion", ev.target.value)} aria-label={`Sección de ${e.nombre}`}>
              {modelo.secciones.map((s) => <option key={s.nombre}>{s.nombre}</option>)}
            </select>
            <BtnIcon peligro title={`Borrar ${e.nombre}`} onClick={(ev) => { ev.stopPropagation(); commit((m) => borrarElemento(m, e.id)); }}>✕</BtnIcon>
          </div>
        );
      })}
      {elems.length > MAX_FILAS && <p className="text-xs text-slate-500">… {elems.length - MAX_FILAS} más (usa el filtro)</p>}
      <p className="text-xs text-slate-500 dark:text-slate-400">Para crear barras usa la herramienta <b>Conectar (C)</b> en el lienzo: clic en un nudo y luego en otro.</p>
    </>
  );
}

// En modelos grandes, un select con cientos de opciones por fila es pesado: se usa el número.
export function NudoSelect({ modelo, value, onChange, etiqueta }) {
  const nombre = useMemo(() => Object.fromEntries(modelo.nudos.map((n) => [n.id, n.nombre])), [modelo.nudos]);
  if (modelo.nudos.length > 60)
    return <NumIn value={value} onChange={(v) => onChange(Math.round(v))} title={nombre[value] || "id de nudo"} aria-label={etiqueta} />;
  return (
    <select className="inp" value={value} onChange={(e) => onChange(+e.target.value)} aria-label={etiqueta}>
      {modelo.nudos.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
    </select>
  );
}

/* ----------------------------- CARGAS ----------------------------- */
const Convencion = ({ modelo }) => (
  <div className="rounded-md bg-slate-100 px-3 py-2 text-[11px] text-slate-600 dark:bg-ink-3 dark:text-slate-300">
    Convención: Fy/wy negativos = hacia abajo · Fx positivo = hacia la derecha · M positivo = antihorario. Unidades: {modelo.unidad_fuerza}, {modelo.unidad_longitud}.
  </div>
);

export function FilaCargaNudo({ modelo, c, i, commit, conNudo = true }) {
  return (
    <div className="space-y-1">
    <SelCaso modelo={modelo} valor={c.caso} onChange={(v) => commit((m) => { m.cargas_nodales[i].caso = v; })} />
    <div className={`grid ${conNudo ? "grid-cols-[1.3fr_1fr_1fr_1fr_1.75rem]" : "grid-cols-[1fr_1fr_1fr_1.75rem]"} items-end gap-1 rounded-lg border border-slate-200 p-2 dark:border-ink-line`}>
      {conNudo && (
        <Campo label="Nudo">
          <select className="inp" value={c.nudo} onChange={(e) => commit((m) => { m.cargas_nodales[i].nudo = +e.target.value; })}>
            {modelo.nudos.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
          </select>
        </Campo>
      )}
      <Campo label="Fx"><NumIn value={c.Fx ?? 0} onChange={(v) => commit((m) => { m.cargas_nodales[i].Fx = v; })} /></Campo>
      <Campo label="Fy"><NumIn value={c.Fy ?? 0} onChange={(v) => commit((m) => { m.cargas_nodales[i].Fy = v; })} /></Campo>
      <Campo label="M"><NumIn value={c.M ?? 0} onChange={(v) => commit((m) => { m.cargas_nodales[i].M = v; })} /></Campo>
      <BtnIcon peligro title="Borrar carga" onClick={() => commit((m) => { m.cargas_nodales.splice(i, 1); })}>✕</BtnIcon>
    </div>
    </div>
  );
}

export function FilaCargaElem({ modelo, c, i, commit, conElem = true }) {
  const st = c.tipo === "distribuida" ? c.subtipo || "uniforme" : c.tipo;
  const set = (k, v) => commit((m) => { m.cargas_elementos[i][k] = v; });
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-ink-line">
      <SelCaso modelo={modelo} valor={c.caso} onChange={(v) => set("caso", v)} />
      <div className={`grid ${conElem ? "grid-cols-[1fr_1.6fr_1.75rem]" : "grid-cols-[1fr_1.75rem]"} items-end gap-1`}>
        {conElem && (
          <Campo label="Elemento">
            <select className="inp" value={c.elem} onChange={(e) => set("elem", +e.target.value)}>
              {modelo.elementos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </Campo>
        )}
        <Campo label="Tipo">
          <select className="inp" value={st} onChange={(e) => commit((m) => {
            const v = e.target.value, el = m.cargas_elementos[i].elem;
            m.cargas_elementos[i] = v === "uniforme" ? { elem: el, tipo: "distribuida", subtipo: "uniforme", wy: -1, wx: 0 }
              : v === "trapezoidal" ? { elem: el, tipo: "distribuida", subtipo: "trapezoidal", wy1: 0, wy2: -1, wx1: 0, wx2: 0 }
              : v === "puntual" ? { elem: el, tipo: "puntual", Py: -1, Px: 0, a: null }
              : { elem: el, tipo: "momento", M: 1, a: null };
          })}>
            {TIPOS_CARGA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Campo>
        <BtnIcon peligro title="Borrar carga" onClick={() => commit((m) => { m.cargas_elementos.splice(i, 1); })}>✕</BtnIcon>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {st === "uniforme" && (<>
          <Campo label="wy (t/m)"><NumIn value={c.wy ?? 0} onChange={(v) => set("wy", v)} /></Campo>
          <Campo label="wx (t/m)"><NumIn value={c.wx ?? 0} onChange={(v) => set("wx", v)} /></Campo>
        </>)}
        {st === "trapezoidal" && (<>
          <Campo label="wy en i"><NumIn value={c.wy1 ?? 0} onChange={(v) => set("wy1", v)} /></Campo>
          <Campo label="wy en j"><NumIn value={c.wy2 ?? 0} onChange={(v) => set("wy2", v)} /></Campo>
        </>)}
        {st === "puntual" && (<>
          <Campo label="Py (t)"><NumIn value={c.Py ?? 0} onChange={(v) => set("Py", v)} /></Campo>
          <Campo label="Px (t)"><NumIn value={c.Px ?? 0} onChange={(v) => set("Px", v)} /></Campo>
          <Campo label="a desde i (m)" hint="vacío = centro"><NumIn value={c.a ?? ""} onChange={(v) => set("a", v)} /></Campo>
        </>)}
        {st === "momento" && (<>
          <Campo label="M (t·m)"><NumIn value={c.M ?? 0} onChange={(v) => set("M", v)} /></Campo>
          <Campo label="a desde i (m)" hint="vacío = centro"><NumIn value={c.a ?? ""} onChange={(v) => set("a", v)} /></Campo>
        </>)}
      </div>
    </div>
  );
}

function CargasNudos({ modelo, commit, sel, filtro }) {
  const f = filtro.trim().toLowerCase();
  const nNombre = Object.fromEntries(modelo.nudos.map((n) => [n.id, n.nombre]));
  const porDefecto = sel?.tipo === "nudo" ? sel.id : modelo.nudos[modelo.nudos.length - 1]?.id;
  return (
    <>
      <Convencion modelo={modelo} />
      {modelo.cargas_nodales.map((c, i) => ({ c, i })).filter(({ c }) => !f || (nNombre[c.nudo] || "").toLowerCase().includes(f)).map(({ c, i }) => (
        <FilaCargaNudo key={i} modelo={modelo} c={c} i={i} commit={commit} />
      ))}
      {modelo.nudos.length > 0 && (
        <BtnAgregar onClick={() => commit((m) => { m.cargas_nodales.push({ nudo: porDefecto, Fx: 0, Fy: -1, M: 0 }); })}>
          + Agregar carga en {nNombre[porDefecto]}
        </BtnAgregar>
      )}
    </>
  );
}

function CargasElementos({ modelo, commit, sel, filtro }) {
  const f = filtro.trim().toLowerCase();
  const eNombre = Object.fromEntries(modelo.elementos.map((e) => [e.id, e.nombre]));
  const porDefecto = sel?.tipo === "elemento" ? sel.id : modelo.elementos[modelo.elementos.length - 1]?.id;
  return (
    <>
      <Convencion modelo={modelo} />
      {modelo.cargas_elementos.map((c, i) => ({ c, i })).filter(({ c }) => !f || (eNombre[c.elem] || "").toLowerCase().includes(f)).map(({ c, i }) => (
        <FilaCargaElem key={i} modelo={modelo} c={c} i={i} commit={commit} />
      ))}
      {modelo.elementos.length > 0 && (<>
        <BtnAgregar onClick={() => commit((m) => { m.cargas_elementos.push({ elem: porDefecto, tipo: "distribuida", subtipo: "uniforme", wy: -1, wx: 0 }); })}>
          + Agregar carga en {eNombre[porDefecto]}
        </BtnAgregar>
        <BtnAgregar onClick={() => udlTodasLasVigas(commit)}>⚡ Asignar UDL a todas las vigas</BtnAgregar>
      </>)}
    </>
  );
}

// Asigna una UDL vertical a todas las barras horizontales (reemplaza las UDL previas de esas vigas).
export async function udlTodasLasVigas(commit) {
  const r = await pedir("Carga uniforme en todas las vigas", [{ clave: "w", label: "wy (t/m, negativo = hacia abajo)", valor: -2 }]);
  if (!r) return;
  const w = r.w;
  commit((m) => {
    const por = Object.fromEntries(m.nudos.map((n) => [n.id, n]));
    const vigas = new Set(m.elementos.filter((e) => por[e.i] && por[e.j] && Math.abs(por[e.i].y - por[e.j].y) < 1e-9).map((e) => e.id));
    m.cargas_elementos = m.cargas_elementos.filter((c) => !(vigas.has(c.elem) && c.tipo === "distribuida" && (c.subtipo || "uniforme") === "uniforme"));
    vigas.forEach((id) => m.cargas_elementos.push({ elem: id, tipo: "distribuida", subtipo: "uniforme", wy: w, wx: 0 }));
  });
}

export function Interruptor({ label, valor, onChange }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
      <input type="checkbox" checked={valor} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-teal-600" />
      {label}
    </label>
  );
}

// Caso de carga al que pertenece una carga (solo si el modelo tiene casos definidos).
function SelCaso({ modelo, valor, onChange }) {
  const casos = modelo.casos || [];
  if (!casos.length) return null;
  return (
    <label className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
      Caso
      <select className="inp !py-0.5 text-xs" value={valor || casos[0].nombre} onChange={(e) => onChange(e.target.value)}>
        {casos.map((x) => <option key={x.nombre}>{x.nombre}</option>)}
      </select>
    </label>
  );
}

/* ----------------------------- CASOS Y COMBINACIONES ----------------------------- */
const NORMA = [
  ["1.4CM + 1.7CV", { CM: 1.4, CV: 1.7 }],
  ["1.25(CM + CV) + CS", { CM: 1.25, CV: 1.25, CS: 1 }],
  ["1.25(CM + CV) − CS", { CM: 1.25, CV: 1.25, CS: -1 }],
  ["0.9CM + CS", { CM: 0.9, CS: 1 }],
  ["0.9CM − CS", { CM: 0.9, CS: -1 }],
];

function Casos({ modelo, commit }) {
  const casos = modelo.casos || [];
  const combos = modelo.combinaciones || [];
  const cuenta = (nom) => [...modelo.cargas_nodales, ...modelo.cargas_elementos].filter((c) => (c.caso || casos[0]?.nombre) === nom).length;
  return (
    <>
      <p className="text-xs text-slate-600 dark:text-slate-300">Cada carga pertenece a un caso (CM, CV, CS…). Las combinaciones suman los casos con sus factores y dan las <b>envolventes</b> (Analizar › Calcular combinaciones). Sin casos, todas las cargas se calculan juntas.</p>
      <h3 className="pt-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Casos de carga</h3>
      {casos.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <input className="inp flex-1 font-medium" value={c.nombre} aria-label="Nombre del caso" onChange={(e) => commit((m) => {
            const viejo = m.casos[i].nombre, nuevo = e.target.value;
            m.casos[i].nombre = nuevo;
            [...m.cargas_nodales, ...m.cargas_elementos].forEach((x) => { if (x.caso === viejo) x.caso = nuevo; });
            (m.combinaciones || []).forEach((cb) => { if (cb.factores && viejo in cb.factores) { cb.factores[nuevo] = cb.factores[viejo]; delete cb.factores[viejo]; } });
          })} />
          <span className="w-20 text-right text-xs text-slate-500">{cuenta(c.nombre)} cargas</span>
          <BtnIcon peligro title="Borrar caso (sus cargas pasan al primer caso)" onClick={() => commit((m) => {
            const nom = m.casos[i].nombre; m.casos.splice(i, 1);
            const dest = m.casos[0]?.nombre;
            [...m.cargas_nodales, ...m.cargas_elementos].forEach((x) => { if (x.caso === nom) { if (dest) x.caso = dest; else delete x.caso; } });
            (m.combinaciones || []).forEach((cb) => { if (cb.factores) delete cb.factores[nom]; });
          })}>✕</BtnIcon>
        </div>
      ))}
      <BtnAgregar onClick={() => commit((m) => {
        m.casos = m.casos || [];
        const nom = ["CM", "CV", "CS", "CW"].find((x) => !m.casos.some((c) => c.nombre === x)) || `Caso${m.casos.length + 1}`;
        if (!m.casos.length) [...m.cargas_nodales, ...m.cargas_elementos].forEach((x) => { x.caso = nom; });
        m.casos.push({ nombre: nom });
      })}>+ Agregar caso</BtnAgregar>

      <h3 className="pt-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Combinaciones</h3>
      {combos.map((cb, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-ink-line">
          <div className="flex items-center gap-2">
            <input className="inp flex-1 font-medium" value={cb.nombre} aria-label="Nombre de la combinación" onChange={(e) => commit((m) => { m.combinaciones[i].nombre = e.target.value; })} />
            <BtnIcon peligro title="Borrar combinación" onClick={() => commit((m) => { m.combinaciones.splice(i, 1); })}>✕</BtnIcon>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {casos.map((c) => (
              <Campo key={c.nombre} label={c.nombre}>
                <NumIn value={cb.factores?.[c.nombre] ?? 0} onChange={(v) => commit((m) => {
                  const x = m.combinaciones[i]; x.factores = x.factores || {};
                  if (v) x.factores[c.nombre] = v; else delete x.factores[c.nombre];
                })} />
              </Campo>
            ))}
          </div>
        </div>
      ))}
      {casos.length > 0 ? (<>
        <BtnAgregar onClick={() => commit((m) => { m.combinaciones = m.combinaciones || []; m.combinaciones.push({ nombre: `Comb${m.combinaciones.length + 1}`, factores: Object.fromEntries(m.casos.map((c) => [c.nombre, 1])) }); })}>+ Agregar combinación</BtnAgregar>
        <div className="flex flex-wrap gap-1">
          {NORMA.map(([nom, f]) => (
            <button key={nom} type="button" disabled={!Object.keys(f).every((k) => modelo.casos.some((c) => c.nombre === k))}
              title={Object.keys(f).every((k) => modelo.casos.some((c) => c.nombre === k)) ? "" : `Necesita los casos ${Object.keys(f).join(", ")}`}
              className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] hover:border-teal disabled:opacity-40 dark:border-ink-line"
              onClick={() => commit((m) => { m.combinaciones = m.combinaciones || []; m.combinaciones.push({ nombre: nom, factores: Object.fromEntries(Object.entries(f).filter(([k]) => m.casos.some((c) => c.nombre === k))) }); })}>
              + {nom}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">Atajos con los factores de la Norma E.060 (solo usan los casos que existan con ese nombre).</p>
      </>) : <p className="text-xs text-slate-500">Agrega casos primero.</p>}
    </>
  );
}
