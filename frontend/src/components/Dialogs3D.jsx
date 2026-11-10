import { useState } from "react";
import { extruirPortico, generarEdificio } from "../model3d.js";
import { Campo, Modal, NumIn } from "./ui.jsx";

const btnP = "rounded-md bg-teal px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-dark disabled:opacity-50";
const btnS = "rounded-md border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100 dark:border-ink-line dark:hover:bg-ink-3";
const lista = (t) => String(t).split(/[;, ]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0);

export function DialogoEdificio({ onCerrar, onElegir }) {
  const [f, setF] = useState({ nombre: "Edificio", lx: "5, 5, 5", ly: "5, 5", pisos: 4, h: "3", cb: 0.4, ch: 0.4, vb: 0.3, vh: 0.5, fc: 210, cm: 0.4, cv: 0.25, sismo: true });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const ok = lista(f.lx).length && lista(f.ly).length && lista(f.h).length && f.pisos >= 1;
  const crear = () => onElegir(generarEdificio({
    nombre: f.nombre, lucesX: lista(f.lx), lucesY: lista(f.ly), alturas: lista(f.h), pisos: Math.round(f.pisos),
    col: { b: f.cb, h: f.ch }, viga: { b: f.vb, h: f.vh }, fc: f.fc, cm: f.cm, cv: f.cv, sismo: f.sismo,
  }));
  return (
    <Modal titulo="Nuevo modelo 3D · edificio en grilla" sub="Columnas en cada intersección y vigas en ambas direcciones. Luego puedes editar en planta, elevación o 3D." onCerrar={onCerrar} ancho="max-w-2xl"
      pie={<><button className={btnS} onClick={onCerrar}>Cancelar</button><button className={btnP} disabled={!ok} onClick={crear}>Crear modelo 3D</button></>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Campo label="Nombre"><input className="inp" value={f.nombre} onChange={(e) => set("nombre")(e.target.value)} /></Campo>
        <Campo label="Luces en X (m)" hint="separadas por coma"><input className="inp" value={f.lx} onChange={(e) => set("lx")(e.target.value)} /></Campo>
        <Campo label="Luces en Y (m)" hint="separadas por coma"><input className="inp" value={f.ly} onChange={(e) => set("ly")(e.target.value)} /></Campo>
        <Campo label="Pisos"><NumIn value={f.pisos} onChange={set("pisos")} /></Campo>
        <Campo label="Altura de piso (m)" hint="una o una por piso"><input className="inp" value={f.h} onChange={(e) => set("h")(e.target.value)} /></Campo>
        <Campo label="f'c (kgf/cm²)"><NumIn value={f.fc} onChange={set("fc")} /></Campo>
        <Campo label="Columna b × h (m)"><div className="flex gap-1"><NumIn value={f.cb} onChange={set("cb")} /><NumIn value={f.ch} onChange={set("ch")} /></div></Campo>
        <Campo label="Viga b × h (m)"><div className="flex gap-1"><NumIn value={f.vb} onChange={set("vb")} /><NumIn value={f.vh} onChange={set("vh")} /></div></Campo>
        <Campo label="CM / CV de losa (t/m²)"><div className="flex gap-1"><NumIn value={f.cm} onChange={set("cm")} /><NumIn value={f.cv} onChange={set("cv")} /></div></Campo>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.sismo} onChange={(e) => set("sismo")(e.target.checked)} className="accent-teal-600" /> Sismo estático E.030 en X e Y (diafragma rígido)</label>
    </Modal>
  );
}

export function DialogoExtruir({ modelo, onCerrar, onElegir }) {
  const [f, setF] = useState({ copias: 3, sep: 5, b: 0.3, h: 0.5, cm: 0.4, cv: 0.25 });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal titulo="Convertir el pórtico 2D en un modelo 3D" sub={`«${modelo.nombre}» se repite a lo largo de Y y las copias se unen con vigas transversales en cada nudo libre.`} onCerrar={onCerrar}
      pie={<><button className={btnS} onClick={onCerrar}>Cancelar</button><button className={btnP} onClick={() => onElegir(extruirPortico(modelo, { copias: Math.max(2, Math.round(f.copias)), separacion: f.sep, vigaT: { b: f.b, h: f.h }, cm: f.cm, cv: f.cv }))}>Crear modelo 3D</button></>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Campo label="Número de pórticos"><NumIn value={f.copias} onChange={set("copias")} /></Campo>
        <Campo label="Separación en Y (m)"><NumIn value={f.sep} onChange={set("sep")} /></Campo>
        <span />
        <Campo label="Viga transversal b (m)"><NumIn value={f.b} onChange={set("b")} /></Campo>
        <Campo label="Viga transversal h (m)"><NumIn value={f.h} onChange={set("h")} /></Campo>
        <span />
        <Campo label="CM de losa (t/m²)"><NumIn value={f.cm} onChange={set("cm")} /></Campo>
        <Campo label="CV de losa (t/m²)"><NumIn value={f.cv} onChange={set("cv")} /></Campo>
      </div>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Las cargas del pórtico 2D no se copian: en 3D las vigas reciben la losa por paños. Puedes agregar cargas en barras después.</p>
    </Modal>
  );
}

export function DialogoExtraer({ modelo, onCerrar, onElegir }) {
  const [fac, setFac] = useState("1.4CM+1.7CV");
  const op = { "1.4CM+1.7CV": { CM: 1.4, CV: 1.7 }, CM: { CM: 1 }, CV: { CV: 1 }, "CM+CV": { CM: 1, CV: 1 } };
  return (
    <Modal titulo="Extraer un pórtico al editor 2D" sub="Abre el pórtico plano con la carga de losa repartida igual que en 3D, para el paso a paso del método [A]." onCerrar={onCerrar}>
      <label className="mb-3 flex items-center gap-2 text-sm">Cargas <select className="inp" value={fac} onChange={(e) => setFac(e.target.value)}>{Object.keys(op).map((k) => <option key={k}>{k}</option>)}</select></label>
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase text-slate-500">Pórticos en X (ejes con letra)</div>
        <div className="flex flex-wrap gap-1">{(modelo.ejes?.y || []).map((e) => <button key={`x${e.c}`} onClick={() => onElegir("x", e.c, op[fac])} className="rounded-full border border-slate-200 px-3 py-1 text-xs hover:border-teal dark:border-ink-line">Eje {e.nombre}</button>)}</div>
        <div className="pt-2 text-xs font-semibold uppercase text-slate-500">Pórticos en Y (ejes numerados)</div>
        <div className="flex flex-wrap gap-1">{(modelo.ejes?.x || []).map((e) => <button key={`y${e.c}`} onClick={() => onElegir("y", e.c, op[fac])} className="rounded-full border border-slate-200 px-3 py-1 text-xs hover:border-teal dark:border-ink-line">Eje {e.nombre}</button>)}</div>
      </div>
    </Modal>
  );
}

/* ----------------------------- armado de pórticos ----------------------------- */
// Inserta un pórtico 2D en un modelo 3D: dirección (X, Y o ángulo), posición y cota base.
export function DialogoInsertar({ fuentes, fuenteFija, destinos, destino3d, onCerrar, onAplicar }) {
  const [fuente, setFuente] = useState(fuenteFija ? "fija" : fuentes[0]?.id);
  const [destino, setDestino] = useState(destino3d ? "actual" : destinos?.[0]?.id ?? "nuevo");
  const [dir, setDir] = useState("x");
  const [ang, setAng] = useState(45);
  const [pos, setPos] = useState(0);
  const [x0, setX0] = useState(0);
  const [y0, setY0] = useState(0);
  const [z0, setZ0] = useState(0);
  const m2 = fuente === "fija" ? fuenteFija : fuentes.find((f) => f.id === fuente)?.modelo;
  const m3 = destino3d || (destinos || []).find((d) => d.id === destino)?.modelo || null;
  const angulo = dir === "x" ? 0 : dir === "y" ? 90 : +ang;
  const origen = dir === "x" ? [+x0, +pos] : dir === "y" ? [+pos, +y0] : [+x0, +y0];
  const ejesSug = dir === "x" ? (m3?.ejes?.y || []) : dir === "y" ? (m3?.ejes?.x || []) : [];
  const largo = m2 ? Math.max(...m2.nudos.map((n) => +n.x)) - Math.min(...m2.nudos.map((n) => +n.x)) : 0;
  const u0 = m2 ? Math.min(...m2.nudos.map((n) => +n.x)) : 0;

  // vista previa en planta
  const t = (angulo * Math.PI) / 180;
  const a = [origen[0] + u0 * Math.cos(t), origen[1] + u0 * Math.sin(t)];
  const b = [a[0] + largo * Math.cos(t), a[1] + largo * Math.sin(t)];
  const pts = [...(m3?.nudos || []).map((n) => [n.x, n.y]), a, b];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const mnx = Math.min(...xs), mxx = Math.max(...xs), mny = Math.min(...ys), mxy = Math.max(...ys);
  const W = 300, H = 200, sc = Math.min((W - 40) / (mxx - mnx || 1), (H - 40) / (mxy - mny || 1));
  const X = (x) => 20 + (x - mnx) * sc + ((W - 40) - (mxx - mnx) * sc) / 2;
  const Y = (y) => H - 20 - (y - mny) * sc - ((H - 40) - (mxy - mny) * sc) / 2;
  const planta = m3 ? [...new Map(m3.nudos.map((n) => [`${n.x},${n.y}`, n])).values()] : [];

  return (
    <Modal titulo="Insertar un pórtico 2D en el modelo 3D" sub="Los nudos que coinciden con los existentes se unen solos: dos pórticos que se cruzan comparten sus columnas." onCerrar={onCerrar} ancho="max-w-3xl"
      pie={<><button className={btnS} onClick={onCerrar}>Cancelar</button><button className={btnP} disabled={!m2} onClick={() => onAplicar({ m2, destino, opciones: { angulo, x0: origen[0], y0: origen[1], z0: +z0 } })}>Insertar pórtico</button></>}>
      <div className="grid gap-4 md:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          {fuenteFija ? <p className="text-sm">Pórtico: <b>{fuenteFija.nombre}</b> ({fuenteFija.nudos.length} nudos, {fuenteFija.elementos.length} elementos)</p> : (
            <Campo label="Pórtico a insertar">
              <select className="inp" value={fuente} onChange={(e) => setFuente(e.target.value)}>
                {fuentes.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
              </select>
            </Campo>
          )}
          {!destino3d && (
            <Campo label="Modelo 3D de destino">
              <select className="inp" value={destino} onChange={(e) => setDestino(e.target.value)}>
                {(destinos || []).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                <option value="nuevo">Nuevo modelo 3D</option>
              </select>
            </Campo>
          )}
          <fieldset className="space-y-1 text-sm">
            <legend className="mb-1 text-xs text-slate-600 dark:text-slate-300">Dirección del pórtico en planta</legend>
            <label className="flex items-center gap-2"><input type="radio" checked={dir === "x"} onChange={() => setDir("x")} className="accent-teal-600" /> A lo largo de X (como los ejes con letra)</label>
            <label className="flex items-center gap-2"><input type="radio" checked={dir === "y"} onChange={() => setDir("y")} className="accent-teal-600" /> A lo largo de Y (girado 90°, como los ejes numerados)</label>
            <label className="flex items-center gap-2"><input type="radio" checked={dir === "a"} onChange={() => setDir("a")} className="accent-teal-600" /> Con otro ángulo: <span className="w-20"><NumIn value={ang} onChange={setAng} /></span> °</label>
          </fieldset>
          <div className="grid grid-cols-3 gap-2">
            {dir === "x" && <><Campo label="Posición y (m)"><NumIn value={pos} onChange={setPos} /></Campo><Campo label="Inicio en x (m)"><NumIn value={x0} onChange={setX0} /></Campo></>}
            {dir === "y" && <><Campo label="Posición x (m)"><NumIn value={pos} onChange={setPos} /></Campo><Campo label="Inicio en y (m)"><NumIn value={y0} onChange={setY0} /></Campo></>}
            {dir === "a" && <><Campo label="Origen x (m)"><NumIn value={x0} onChange={setX0} /></Campo><Campo label="Origen y (m)"><NumIn value={y0} onChange={setY0} /></Campo></>}
            <Campo label="Cota de la base z (m)"><NumIn value={z0} onChange={setZ0} /></Campo>
          </div>
          {ejesSug.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-slate-500">Ejes existentes:</span>
              {ejesSug.map((e) => <button key={e.c} onClick={() => setPos(e.c)} className={`rounded-full border px-2 py-0.5 ${Math.abs(e.c - pos) < 1e-6 ? "border-teal bg-teal text-white" : "border-slate-200 dark:border-ink-line"}`}>{e.nombre} ({e.c})</button>)}
              <button onClick={() => setPos(Math.max(...ejesSug.map((e) => e.c)) + 5)} className="rounded-full border border-dashed border-slate-300 px-2 py-0.5">+5 m después del último</button>
            </div>
          )}
        </div>
        <div>
          <div className="mb-1 text-xs text-slate-500">Vista previa en planta</div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-slate-200 bg-slate-50 dark:border-ink-line dark:bg-ink">
            {planta.map((n) => <circle key={n.id} cx={X(n.x)} cy={Y(n.y)} r={2.5} className="fill-slate-400" />)}
            <line x1={X(a[0])} y1={Y(a[1])} x2={X(b[0])} y2={Y(b[1])} stroke="#F59E0B" strokeWidth={4} strokeLinecap="round" />
            <text x={X(b[0]) + 4} y={Y(b[1]) - 4} className="fill-amber-600 text-[10px] font-semibold">nuevo</text>
            <text x={6} y={H - 6} className="fill-slate-500 text-[9px]">x → · y ↑</text>
          </svg>
        </div>
      </div>
    </Modal>
  );
}

export function DialogoUnir({ modelo, onCerrar, onAplicar }) {
  const [dir, setDir] = useState("x");
  const ejes = dir === "x" ? modelo.ejes?.y || [] : modelo.ejes?.x || [];
  const [c1, setC1] = useState(ejes[0]?.c ?? 0);
  const [c2, setC2] = useState(ejes[1]?.c ?? 0);
  const [todos, setTodos] = useState(true);
  const [sec, setSec] = useState(modelo.secc_viga || modelo.secciones[0]?.nombre);
  const cambiar = (d) => { setDir(d); const l = d === "x" ? modelo.ejes?.y || [] : modelo.ejes?.x || []; setC1(l[0]?.c ?? 0); setC2(l[1]?.c ?? 0); };
  return (
    <Modal titulo="Unir pórticos con vigas" sub="Crea vigas entre pórticos paralelos en cada nudo libre que tenga su par (misma posición y altura)." onCerrar={onCerrar}
      pie={<><button className={btnS} onClick={onCerrar}>Cancelar</button><button className={btnP} onClick={() => onAplicar({ dir, c1: +c1, c2: +c2, todos, sec })}>Unir</button></>}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2"><input type="radio" checked={dir === "x"} onChange={() => cambiar("x")} className="accent-teal-600" /> Pórticos en X (vigas en Y)</label>
          <label className="flex items-center gap-2"><input type="radio" checked={dir === "y"} onChange={() => cambiar("y")} className="accent-teal-600" /> Pórticos en Y (vigas en X)</label>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} className="accent-teal-600" /> Unir todos los pórticos consecutivos de esa dirección</label>
        {!todos && (
          <div className="grid grid-cols-2 gap-2">
            <Campo label="Pórtico 1"><select className="inp" value={c1} onChange={(e) => setC1(+e.target.value)}>{ejes.map((e) => <option key={e.c} value={e.c}>Eje {e.nombre} ({e.c} m)</option>)}</select></Campo>
            <Campo label="Pórtico 2"><select className="inp" value={c2} onChange={(e) => setC2(+e.target.value)}>{ejes.map((e) => <option key={e.c} value={e.c}>Eje {e.nombre} ({e.c} m)</option>)}</select></Campo>
          </div>
        )}
        <Campo label="Sección de las vigas"><select className="inp" value={sec} onChange={(e) => setSec(e.target.value)}>{modelo.secciones.map((s) => <option key={s.nombre}>{s.nombre}</option>)}</select></Campo>
      </div>
    </Modal>
  );
}

export function DialogoCopiar({ modelo, onCerrar, onAplicar }) {
  const opciones = [...(modelo.ejes?.y || []).map((e) => ({ dir: "x", c: e.c, n: `Eje ${e.nombre} (pórtico en X, y = ${e.c})` })), ...(modelo.ejes?.x || []).map((e) => ({ dir: "y", c: e.c, n: `Eje ${e.nombre} (pórtico en Y, x = ${e.c})` }))];
  const [k, setK] = useState(0);
  const [paso, setPaso] = useState(5);
  const [veces, setVeces] = useState(1);
  const [unir, setUnir] = useState(true);
  const o = opciones[k];
  return (
    <Modal titulo="Copiar un pórtico" sub="Repite el pórtico elegido a la distancia indicada (crea los ejes que falten)." onCerrar={onCerrar}
      pie={<><button className={btnS} onClick={onCerrar}>Cancelar</button><button className={btnP} disabled={!o} onClick={() => onAplicar({ ...o, destinos: Array.from({ length: Math.max(1, Math.round(veces)) }, (_, i) => o.c + (i + 1) * paso), unir })}>Copiar</button></>}>
      {!o ? <p className="text-sm">El modelo no tiene ejes.</p> : (
        <div className="space-y-3 text-sm">
          <Campo label="Pórtico"><select className="inp" value={k} onChange={(e) => setK(+e.target.value)}>{opciones.map((x, i) => <option key={i} value={i}>{x.n}</option>)}</select></Campo>
          <div className="grid grid-cols-2 gap-2">
            <Campo label="Separación (m)" hint="negativa = hacia atrás"><NumIn value={paso} onChange={setPaso} /></Campo>
            <Campo label="Número de copias"><NumIn value={veces} onChange={setVeces} /></Campo>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={unir} onChange={(e) => setUnir(e.target.checked)} className="accent-teal-600" /> Unir cada copia con vigas al pórtico anterior</label>
        </div>
      )}
    </Modal>
  );
}
