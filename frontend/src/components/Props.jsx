// Panel derecho: propiedades de lo seleccionado, o resumen del modelo si no hay selección.
export default function Props({ modelo, sel, actualizar, onCerrar }) {
  if (!sel) {
    return (
      <div className="space-y-3 p-4 text-sm">
        <h2 className="font-semibold">Propiedades</h2>
        <p className="text-slate-600 dark:text-slate-300">Selecciona un nudo o un elemento en el lienzo o en la lista para editarlo.</p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-slate-200 p-3 dark:border-ink-line">
          <dt className="text-slate-500 dark:text-slate-400">Nudos</dt><dd className="text-right font-medium">{modelo.nudos.length}</dd>
          <dt className="text-slate-500 dark:text-slate-400">Elementos</dt><dd className="text-right font-medium">{modelo.elementos.length}</dd>
          <dt className="text-slate-500 dark:text-slate-400">Secciones</dt><dd className="text-right font-medium">{modelo.secciones.length}</dd>
          <dt className="text-slate-500 dark:text-slate-400">Unidades</dt><dd className="text-right font-medium">{modelo.unidad_fuerza}·{modelo.unidad_longitud}</dd>
        </dl>
      </div>
    );
  }

  if (sel.tipo === "nudo") {
    const n = modelo.nudos[sel.idx];
    if (!n) return null;
    const set = (k, v) => actualizar((m) => { m.nudos[sel.idx][k] = v; return m; });
    return (
      <div className="space-y-3 p-4 text-sm">
        <Cabecera titulo={`Nudo ${n.nombre}`} onCerrar={onCerrar} />
        <Campo label="X (m)" value={n.x} onChange={(v) => set("x", v)} />
        <Campo label="Y (m)" value={n.y} onChange={(v) => set("y", v)} />
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
          Apoyo
          <select value={n.apoyo} onChange={(e) => set("apoyo", e.target.value)}>
            <option value="libre">Libre</option>
            <option value="empotrado">Empotrado</option>
            <option value="fijo">Articulado (fijo)</option>
            <option value="rodillo_y">Rodillo (móvil en X)</option>
            <option value="rodillo_x">Rodillo (móvil en Y)</option>
          </select>
        </label>
      </div>
    );
  }

  const e = modelo.elementos[sel.idx];
  if (!e) return null;
  const set = (k, v) => actualizar((m) => { m.elementos[sel.idx][k] = v; return m; });
  return (
    <div className="space-y-3 p-4 text-sm">
      <Cabecera titulo={`Elemento ${e.nombre}`} onCerrar={onCerrar} />
      <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
        Sección
        <select value={e.seccion} onChange={(ev) => set("seccion", ev.target.value)}>
          {modelo.secciones.map((s) => <option key={s.nombre} value={s.nombre}>{s.nombre}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={!!e.release_i} onChange={(ev) => set("release_i", ev.target.checked)} />
        Rótula en el nudo inicial (i)
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={!!e.release_j} onChange={(ev) => set("release_j", ev.target.checked)} />
        Rótula en el nudo final (j)
      </label>
    </div>
  );
}

function Cabecera({ titulo, onCerrar }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-semibold">{titulo}</h2>
      <button onClick={onCerrar} className="rounded px-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-3" aria-label="Cerrar propiedades">✕</button>
    </div>
  );
}

// Campo numérico: se confirma al salir del campo.
function Campo({ label, value, onChange }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
      {label}
      <input type="number" step="any" defaultValue={value} key={value} onBlur={(e) => onChange(parseFloat(e.target.value) || 0)} />
    </label>
  );
}
