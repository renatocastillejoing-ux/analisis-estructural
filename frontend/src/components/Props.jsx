import { APOYOS, borrarElemento, borrarNudo, propsSeccion } from "../model.js";
import { FilaCargaElem, FilaCargaNudo, Interruptor, NudoSelect } from "./Editor.jsx";
import { BtnAgregar, BtnIcon, Campo, NumIn } from "./ui.jsx";

// Panel derecho: propiedades del objeto seleccionado (o resumen del modelo).
export default function Props({ modelo, sel, setSel, commit, abrirPanel }) {
  const nudo = sel?.tipo === "nudo" ? modelo.nudos.find((n) => n.id === sel.id) : null;
  const elem = sel?.tipo === "elemento" ? modelo.elementos.find((e) => e.id === sel.id) : null;

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white dark:border-ink-line dark:bg-ink-2" aria-label="Propiedades">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-slate-200 px-4 dark:border-ink-line">
        <h2 className="text-sm font-semibold">{nudo ? `Nudo ${nudo.nombre}` : elem ? `Elemento ${elem.nombre}` : "Propiedades"}</h2>
        {(nudo || elem) && <button className="ml-auto text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" onClick={() => setSel(null)}>Deseleccionar (Esc)</button>}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {nudo ? <PropsNudo modelo={modelo} n={nudo} commit={commit} setSel={setSel} />
          : elem ? <PropsElem modelo={modelo} e={elem} commit={commit} setSel={setSel} />
          : <Resumen modelo={modelo} abrirPanel={abrirPanel} />}
      </div>
    </aside>
  );
}

function Resumen({ modelo, abrirPanel }) {
  const filas = [
    ["Nudos", modelo.nudos.length, "nudos"],
    ["Elementos", modelo.elementos.length, "elementos"],
    ["Secciones", modelo.secciones.length, "secciones"],
    ["Cargas en nudos", modelo.cargas_nodales.length, "cargas_nudos"],
    ["Cargas en elementos", modelo.cargas_elementos.length, "cargas_elementos"],
  ];
  const mat = modelo.material;
  return (
    <>
      <div className="text-sm font-semibold">{modelo.nombre}</div>
      <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-ink-line dark:border-ink-line">
        {filas.map(([k, v, p]) => (
          <button key={k} onClick={() => abrirPanel(p)} className="flex w-full justify-between px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-ink-3">
            <dt className="text-slate-600 dark:text-slate-300">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd>
          </button>
        ))}
        <div className="flex justify-between px-3 py-2"><dt className="text-slate-600 dark:text-slate-300">Unidades</dt><dd>{modelo.unidad_fuerza} · {modelo.unidad_longitud}</dd></div>
        <div className="flex justify-between px-3 py-2"><dt className="text-slate-600 dark:text-slate-300">Material</dt><dd>{mat.modo === "fc" ? `f'c = ${mat.fc}` : `E = ${mat.E}`}</dd></div>
      </dl>
      <div className="rounded-lg bg-slate-100 p-3 text-xs leading-relaxed text-slate-600 dark:bg-ink-3 dark:text-slate-300">
        <p className="mb-1 font-semibold">Cómo moverte</p>
        <p>Rueda: zoom · arrastrar el fondo, botón central o <kbd>Espacio</kbd>: desplazar · <kbd>F</kbd>: ajustar vista.</p>
        <p className="mt-1">Clic en un nudo o barra para ver sus propiedades. <kbd>Supr</kbd> borra la selección y <kbd>Ctrl+Z</kbd> deshace.</p>
      </div>
    </>
  );
}

function PropsNudo({ modelo, n, commit, setSel }) {
  const set = (k, v) => commit((m) => { m.nudos.find((q) => q.id === n.id)[k] = v; });
  const cargas = modelo.cargas_nodales.map((c, i) => ({ c, i })).filter(({ c }) => c.nudo === n.id);
  const barras = modelo.elementos.filter((e) => e.i === n.id || e.j === n.id);
  return (
    <>
      <Campo label="Nombre"><input className="inp" value={n.nombre} onChange={(e) => set("nombre", e.target.value)} /></Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo label={`X (${modelo.unidad_longitud})`}><NumIn value={n.x} onChange={(v) => set("x", v)} /></Campo>
        <Campo label={`Y (${modelo.unidad_longitud})`}><NumIn value={n.y} onChange={(v) => set("y", v)} /></Campo>
      </div>
      <Campo label="Apoyo">
        <div className="grid grid-cols-2 gap-1">
          {APOYOS.map(([v, l]) => (
            <button key={v} type="button" onClick={() => set("apoyo", v)} aria-pressed={n.apoyo === v}
              className={`rounded-md border px-2 py-1.5 text-xs ${n.apoyo === v ? "border-teal bg-teal text-white" : "border-slate-200 hover:bg-slate-100 dark:border-ink-line dark:hover:bg-ink-3"}`}>{l}</button>
          ))}
        </div>
      </Campo>
      <Seccion titulo={`Cargas en ${n.nombre}`} cuenta={cargas.length}>
        {cargas.map(({ c, i }) => <FilaCargaNudo key={i} modelo={modelo} c={c} i={i} commit={commit} conNudo={false} />)}
        <BtnAgregar onClick={() => commit((m) => { m.cargas_nodales.push({ nudo: n.id, Fx: 0, Fy: -1, M: 0 }); })}>+ Carga en este nudo</BtnAgregar>
      </Seccion>
      <Seccion titulo="Barras conectadas" cuenta={barras.length}>
        <div className="flex flex-wrap gap-1">
          {barras.map((e) => (
            <button key={e.id} onClick={() => setSel({ tipo: "elemento", id: e.id })} className="rounded-full border border-slate-200 px-2 py-0.5 text-xs hover:border-teal dark:border-ink-line">{e.nombre}</button>
          ))}
          {!barras.length && <span className="text-xs text-amber-700 dark:text-amber-400">Nudo suelto: conéctalo o bórralo.</span>}
        </div>
      </Seccion>
      <Eliminar onClick={() => { commit((m) => borrarNudo(m, n.id)); setSel(null); }}>Eliminar nudo{barras.length ? ` y sus ${barras.length} barras` : ""}</Eliminar>
    </>
  );
}

function PropsElem({ modelo, e, commit, setSel }) {
  const set = (k, v) => commit((m) => { m.elementos.find((q) => q.id === e.id)[k] = v; });
  const por = Object.fromEntries(modelo.nudos.map((n) => [n.id, n]));
  const a = por[e.i], b = por[e.j];
  const L = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  const sec = modelo.secciones.find((s) => s.nombre === e.seccion);
  const p = sec ? propsSeccion(sec) : null;
  const cargas = modelo.cargas_elementos.map((c, i) => ({ c, i })).filter(({ c }) => c.elem === e.id);
  const tramos = e.segmentos || e.tramos || [];
  const mats = modelo.materiales || [];
  const setTramos = (fn) => commit((m) => {
    const x = m.elementos.find((q) => q.id === e.id);
    const t = structuredClone(x.segmentos || x.tramos || []);
    fn(t);
    delete x.tramos;
    if (t.length) x.segmentos = t; else delete x.segmentos;
  });

  return (
    <>
      <Campo label="Nombre"><input className="inp" value={e.nombre} onChange={(ev) => set("nombre", ev.target.value)} /></Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo label="Nudo i"><NudoSelect modelo={modelo} value={e.i} onChange={(v) => set("i", v)} etiqueta="Nudo i" /></Campo>
        <Campo label="Nudo j"><NudoSelect modelo={modelo} value={e.j} onChange={(v) => set("j", v)} etiqueta="Nudo j" /></Campo>
      </div>
      <button type="button" className="text-xs text-teal-dark hover:underline dark:text-teal-soft" onClick={() => commit((m) => { const x = m.elementos.find((q) => q.id === e.id); [x.i, x.j] = [x.j, x.i]; })}>⇄ Invertir sentido i ↔ j</button>
      <div className="grid grid-cols-2 gap-2">
        <Campo label="Sección">
          <select className="inp" value={e.seccion} onChange={(ev) => set("seccion", ev.target.value)}>
            {modelo.secciones.map((s) => <option key={s.nombre}>{s.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Material">
          <select className="inp" value={e.material || ""} onChange={(ev) => set("material", ev.target.value || undefined)}>
            <option value="">Por defecto</option>
            {mats.map((x) => <option key={x.nombre}>{x.nombre}</option>)}
          </select>
        </Campo>
      </div>
      <div className="rounded-md bg-slate-100 px-3 py-2 text-xs tabular-nums text-slate-600 dark:bg-ink-3 dark:text-slate-300">
        L = {L.toFixed(3)} {modelo.unidad_longitud}{p && <> · A = {p.A.toFixed(4)} · I = {p.I.toExponential(3)}</>}
      </div>
      <div className="flex gap-4">
        <Interruptor label="Rótula en i" valor={!!e.release_i} onChange={(v) => set("release_i", v)} />
        <Interruptor label="Rótula en j" valor={!!e.release_j} onChange={(v) => set("release_j", v)} />
      </div>

      <Seccion titulo="Tramos (placas / barra no prismática)" cuenta={tramos.length}>
        {tramos.length < 2 && <p className="text-xs text-slate-500 dark:text-slate-400">Barra prismática. Divide la barra en 2 o más tramos con su propia sección o material (por ejemplo, el tramo de placa dentro de una viga).</p>}
        {tramos.map((t, k) => (
          <div key={k} className="grid grid-cols-[4.5rem_1fr_1fr_1.75rem] items-end gap-1">
            <Campo label="L (m)"><NumIn value={t.L} onChange={(v) => setTramos((ts) => { ts[k].L = v; })} /></Campo>
            <Campo label="Sección">
              <select className="inp" value={t.seccion || e.seccion} onChange={(ev) => setTramos((ts) => { ts[k].seccion = ev.target.value; })}>
                {modelo.secciones.map((s) => <option key={s.nombre}>{s.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Material">
              <select className="inp" value={t.material || ""} onChange={(ev) => setTramos((ts) => { ts[k].material = ev.target.value || undefined; })}>
                <option value="">Del elemento</option>
                {mats.map((x) => <option key={x.nombre}>{x.nombre}</option>)}
              </select>
            </Campo>
            <BtnIcon peligro title="Quitar tramo" onClick={() => setTramos((ts) => { ts.splice(k, 1); })}>✕</BtnIcon>
          </div>
        ))}
        {tramos.length >= 2 && (() => {
          const suma = tramos.reduce((s, t) => s + (+t.L || 0), 0);
          return Math.abs(suma - L) > 1e-6 && <p className="text-xs text-amber-700 dark:text-amber-400">Los tramos suman {suma.toFixed(3)} m y la barra mide {L.toFixed(3)} m: se escalan proporcionalmente al calcular.</p>;
        })()}
        <BtnAgregar onClick={() => setTramos((ts) => {
          if (!ts.length) { ts.push({ L: +(L / 2).toFixed(3), seccion: e.seccion }, { L: +(L / 2).toFixed(3), seccion: e.seccion }); return; }
          ts.push({ L: 1, seccion: e.seccion });
        })}>{tramos.length ? "+ Agregar tramo" : "+ Dividir en 2 tramos"}</BtnAgregar>
      </Seccion>

      <Seccion titulo={`Cargas en ${e.nombre}`} cuenta={cargas.length}>
        {cargas.map(({ c, i }) => <FilaCargaElem key={i} modelo={modelo} c={c} i={i} commit={commit} conElem={false} />)}
        <BtnAgregar onClick={() => commit((m) => { m.cargas_elementos.push({ elem: e.id, tipo: "distribuida", subtipo: "uniforme", wy: -1, wx: 0 }); })}>+ Carga en este elemento</BtnAgregar>
      </Seccion>
      <Eliminar onClick={() => { commit((m) => borrarElemento(m, e.id)); setSel(null); }}>Eliminar elemento</Eliminar>
    </>
  );
}

function Seccion({ titulo, cuenta, children }) {
  return (
    <section className="space-y-2 border-t border-slate-200 pt-3 dark:border-ink-line">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
        {titulo}{cuenta != null && <span className="rounded-full bg-teal/15 px-2 text-[11px] text-teal-dark dark:text-teal-soft">{cuenta}</span>}
      </h3>
      {children}
    </section>
  );
}

function Eliminar({ children, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full rounded-md border border-rose-200 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40">
      🗑 {children} <span className="text-xs opacity-70">(Supr)</span>
    </button>
  );
}
