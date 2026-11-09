import { nextId } from "../model.js";

const bloque = "mt-2 w-full rounded-md border border-dashed border-slate-300 py-1.5 text-sm text-slate-600 hover:border-teal hover:text-teal dark:border-ink-line dark:text-slate-300";

// Numérico con validación: el valor se guarda al salir del campo, no a cada tecla.
function Num({ label, value, onChange }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
      {label}
      <input
        type="number"
        step="any"
        defaultValue={value ?? ""}
        key={value}
        onBlur={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </label>
  );
}

// Solo se renderiza el paso activo: definir, modelar o cargar.
export default function Editor({ paso, modelo, actualizar, onSel, sel }) {
  if (paso === "definir") {
    return (
      <Panel titulo="Definir · materiales y secciones">
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
          Nombre del proyecto
          <input value={modelo.nombre} onChange={(e) => actualizar((m) => ({ ...m, nombre: e.target.value }))} />
        </label>
        <Num
          label="Módulo de elasticidad E (tonf/m²)"
          value={modelo.material.E}
          onChange={(v) => actualizar((m) => ({ ...m, material: { ...m.material, E: v } }))}
        />
        <Seccion titulo={`Secciones (${modelo.secciones.length})`}>
          {modelo.secciones.map((s, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-2 dark:border-ink-line">
              <input
                className="mb-2 w-full"
                value={s.nombre}
                onChange={(e) => actualizar((m) => { m.secciones[i].nombre = e.target.value; return m; })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Num label="b (m)" value={s.b} onChange={(v) => actualizar((m) => { m.secciones[i].b = v; return m; })} />
                <Num label="h (m)" value={s.h} onChange={(v) => actualizar((m) => { m.secciones[i].h = v; return m; })} />
              </div>
            </div>
          ))}
          <button className={bloque} onClick={() => actualizar((m) => { m.secciones.push({ nombre: `S${m.secciones.length + 1}`, modo: "rect", b: 0.3, h: 0.5 }); return m; })}>
            + Agregar sección
          </button>
        </Seccion>
      </Panel>
    );
  }

  if (paso === "modelar") {
    return (
      <Panel titulo="Modelar · nudos y elementos">
        <Seccion titulo={`Nudos (${modelo.nudos.length})`}>
          <ul className="space-y-1">
            {modelo.nudos.map((n, i) => {
              const activo = sel?.tipo === "nudo" && sel.idx === i;
              return (
                <li key={n.id}>
                  <button
                    onClick={() => onSel({ tipo: "nudo", idx: i })}
                    className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm ${activo ? "border-teal bg-teal-soft/20" : "border-slate-200 hover:bg-slate-50 dark:border-ink-line dark:hover:bg-ink-3"}`}
                  >
                    <span className="font-medium">{n.nombre}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-300">({n.x}, {n.y}) · {n.apoyo}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            className={bloque}
            onClick={() => actualizar((m) => { const id = nextId(m.nudos); m.nudos.push({ id, nombre: `N${id}`, x: 0, y: 0, apoyo: "libre" }); return m; })}
          >
            + Agregar nudo
          </button>
        </Seccion>
        <Seccion titulo={`Elementos (${modelo.elementos.length})`}>
          <ul className="space-y-1">
            {modelo.elementos.map((e, i) => {
              const activo = sel?.tipo === "elemento" && sel.idx === i;
              return (
                <li key={e.id}>
                  <button
                    onClick={() => onSel({ tipo: "elemento", idx: i })}
                    className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm ${activo ? "border-teal bg-teal-soft/20" : "border-slate-200 hover:bg-slate-50 dark:border-ink-line dark:hover:bg-ink-3"}`}
                  >
                    <span className="font-medium">{e.nombre}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-300">{e.seccion}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            className={bloque}
            onClick={() => actualizar((m) => {
              const id = nextId(m.elementos);
              const ns = m.nudos;
              if (ns.length >= 2) m.elementos.push({ id, nombre: `E${id}`, i: ns[ns.length - 2].id, j: ns[ns.length - 1].id, seccion: m.secciones[0]?.nombre });
              return m;
            })}
          >
            + Agregar elemento (entre los dos últimos nudos)
          </button>
        </Seccion>
      </Panel>
    );
  }

  // cargar
  return (
    <Panel titulo="Cargar · nodales y en elementos">
      <Seccion titulo={`Cargas en nudos (${modelo.cargas_nodales.length})`}>
        {modelo.cargas_nodales.map((c, i) => (
          <div key={i} className="grid grid-cols-4 gap-2 rounded-lg border border-slate-200 p-2 dark:border-ink-line">
            <Num label="Nudo" value={c.nudo} onChange={(v) => actualizar((m) => { m.cargas_nodales[i].nudo = v; return m; })} />
            <Num label="Fx" value={c.Fx} onChange={(v) => actualizar((m) => { m.cargas_nodales[i].Fx = v; return m; })} />
            <Num label="Fy" value={c.Fy} onChange={(v) => actualizar((m) => { m.cargas_nodales[i].Fy = v; return m; })} />
            <Num label="M" value={c.M} onChange={(v) => actualizar((m) => { m.cargas_nodales[i].M = v; return m; })} />
          </div>
        ))}
        <button className={bloque} onClick={() => actualizar((m) => { m.cargas_nodales.push({ nudo: m.nudos[0]?.id, Fx: 0, Fy: 0, M: 0 }); return m; })}>
          + Agregar carga nodal
        </button>
      </Seccion>
      <Seccion titulo={`Cargas en elementos (${modelo.cargas_elementos.length})`}>
        {modelo.cargas_elementos.map((c, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-2 dark:border-ink-line">
            <Num label="Elemento (id)" value={c.elem} onChange={(v) => actualizar((m) => { m.cargas_elementos[i].elem = v; return m; })} />
            <Num label="wy (tonf/m, negativo = ↓)" value={c.wy} onChange={(v) => actualizar((m) => { m.cargas_elementos[i].wy = v; return m; })} />
          </div>
        ))}
        <button className={bloque} onClick={() => actualizar((m) => { m.cargas_elementos.push({ elem: m.elementos[0]?.id, tipo: "distribuida", subtipo: "uniforme", wy: -1, wx: 0 }); return m; })}>
          + Agregar carga distribuida
        </button>
      </Seccion>
    </Panel>
  );
}

function Panel({ titulo, children }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold dark:border-ink-line">{titulo}</h2>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">{children}</div>
    </div>
  );
}

function Seccion({ titulo, children }) {
  return (
    <section>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{titulo}</div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
