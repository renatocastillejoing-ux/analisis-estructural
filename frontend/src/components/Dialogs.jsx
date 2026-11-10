import { useEffect, useState } from "react";
import { torreLista, torreModelo } from "../api.js";
import { PLANTILLAS, generarPortico, modeloDesdeCasos } from "../model.js";
import { Campo, Modal, NumIn } from "./ui.jsx";

const btnP = "rounded-md bg-teal px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-dark disabled:opacity-50";
const btnS = "rounded-md border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100 dark:border-ink-line dark:hover:bg-ink-3";

export function DialogoPlantillas({ onCerrar, onElegir }) {
  return (
    <Modal titulo="Plantillas" sub="Reemplaza el modelo actual (puedes deshacer con Ctrl+Z)." onCerrar={onCerrar} ancho="max-w-2xl">
      <div className="grid gap-3 sm:grid-cols-2">
        {PLANTILLAS.map((p) => (
          <button key={p.id} type="button" onClick={() => onElegir(p.crear())}
            className="rounded-xl border border-slate-200 p-4 text-left hover:border-teal hover:bg-teal/5 dark:border-ink-line dark:hover:bg-ink-3">
            <div className="font-semibold">{p.nombre}</div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{p.desc}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function DialogoGenerador({ onCerrar, onElegir }) {
  const [f, setF] = useState({ pisos: 3, vanos: 2, luz: 5, altura: 3, apoyo: "empotrado", b_col: 0.4, h_col: 0.4, b_viga: 0.3, h_viga: 0.5, w: 2 });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const generar = () => onElegir(generarPortico({
    pisos: Math.max(1, Math.round(f.pisos)), luces: Array(Math.max(1, Math.round(f.vanos))).fill(f.luz), alturas: [f.altura],
    apoyo: f.apoyo, b_col: f.b_col, h_col: f.h_col, b_viga: f.b_viga, h_viga: f.h_viga, w: f.w,
  }));
  return (
    <Modal titulo="Generar pórtico regular" sub="Crea nudos, columnas, vigas y la carga uniforme en vigas." onCerrar={onCerrar}
      pie={<><button className={btnS} onClick={onCerrar}>Cancelar</button><button className={btnP} onClick={generar}>Generar</button></>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Campo label="Pisos"><NumIn value={f.pisos} onChange={set("pisos")} /></Campo>
        <Campo label="Vanos"><NumIn value={f.vanos} onChange={set("vanos")} /></Campo>
        <Campo label="Luz de vano (m)"><NumIn value={f.luz} onChange={set("luz")} /></Campo>
        <Campo label="Altura de piso (m)"><NumIn value={f.altura} onChange={set("altura")} /></Campo>
        <Campo label="Apoyo en la base">
          <select className="inp" value={f.apoyo} onChange={(e) => set("apoyo")(e.target.value)}>
            <option value="empotrado">Empotrado</option><option value="fijo">Articulado</option>
          </select>
        </Campo>
        <Campo label="wy en vigas (t/m)" hint="0 = sin carga"><NumIn value={f.w} onChange={set("w")} /></Campo>
        <Campo label="Columna b (m)"><NumIn value={f.b_col} onChange={set("b_col")} /></Campo>
        <Campo label="Columna h (m)"><NumIn value={f.h_col} onChange={set("h_col")} /></Campo>
        <span />
        <Campo label="Viga b (m)"><NumIn value={f.b_viga} onChange={set("b_viga")} /></Campo>
        <Campo label="Viga h (m)"><NumIn value={f.h_viga} onChange={set("h_viga")} /></Campo>
      </div>
    </Modal>
  );
}

export function DialogoTorre({ onCerrar, onElegir }) {
  const [items, setItems] = useState(null);
  const [k, setK] = useState(0);
  const [estado, setEstado] = useState("");
  const [conCasos, setConCasos] = useState(false);
  useEffect(() => {
    torreLista().then((r) => setItems(r.items || [])).catch((e) => setEstado("No se pudo leer la lista: " + e));
  }, []);
  const cargar = async () => {
    const it = items?.[k]; if (!it) return;
    setEstado("Cargando…");
    try {
      const d = await torreModelo(it.tipo, it.idx, conCasos);
      if (!d || d.ok === false) { setEstado(d?.error || "No se pudo cargar el pórtico."); return; }
      onElegir(conCasos ? modeloDesdeCasos(d) : d);
    } catch (e) { setEstado("Error al cargar: " + e); }
  };
  return (
    <Modal titulo="Torre de Arequipa" sub="10 pisos × 3.00 m · pórticos 2D por eje · combinación 1.4CM + 1.7CV." onCerrar={onCerrar}
      pie={<><button className={btnS} onClick={onCerrar}>Cancelar</button><button className={btnP} disabled={!items?.length} onClick={cargar}>Cargar pórtico</button></>}>
      {!items ? <p className="text-sm text-slate-500">{estado || "Leyendo pórticos…"}</p> : (
        <>
          <Campo label={`Pórtico (${items.length} disponibles)`}>
            <select className="inp" value={k} onChange={(e) => setK(+e.target.value)}>
              {items.map((it, i) => <option key={i} value={i}>{it.nombre} ({it.tipo === "letra" ? "dirección X" : "dirección Y"})</option>)}
            </select>
          </Campo>
          <fieldset className="mt-3 space-y-1 text-sm">
            <legend className="mb-1 text-xs text-slate-600 dark:text-slate-300">Cargas</legend>
            <label className="flex items-center gap-2"><input type="radio" checked={!conCasos} onChange={() => setConCasos(false)} className="accent-teal-600" /> Ya combinadas (1.4CM + 1.7CV): listo para calcular y para el paso a paso</label>
            <label className="flex items-center gap-2"><input type="radio" checked={conCasos} onChange={() => setConCasos(true)} className="accent-teal-600" /> Casos CM y CV separados, con la combinación 1.4CM + 1.7CV (envolventes)</label>
          </fieldset>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Supuestos: grilla 4.50 × 5.00 m, f'c 280/210, columnas 0.60/0.50/0.40, vigas 0.35×0.60 y 0.30×0.50. Placas 0.30 × 3.50 m: 12 en X (ejes A, E, I × 3, 6, 10, 13) y 10 en Y (ejes 1, 4, 8, 12, 15 × B, H). CM = 0.40 t/m², CV = 0.25 t/m², con la losa repartida en dos direcciones (igual que el modelo 3D).</p>
          {estado && <p className="mt-2 text-sm">{estado}</p>}
        </>
      )}
    </Modal>
  );
}

export function DialogoConfirmar({ titulo, texto, accion = "Aceptar", peligro, onCerrar, onAceptar }) {
  return (
    <Modal titulo={titulo} onCerrar={onCerrar} ancho="max-w-md"
      pie={<><button className={btnS} onClick={onCerrar}>Cancelar</button>
        <button className={peligro ? "rounded-md bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700" : btnP} onClick={() => { onAceptar(); onCerrar(); }}>{accion}</button></>}>
      <p className="text-sm text-slate-700 dark:text-slate-200">{texto}</p>
    </Modal>
  );
}

const ATAJOS = [
  ["Ctrl + Enter", "Calcular estructura"], ["Ctrl + K", "Buscar comando"], ["Ctrl + Z / Ctrl + Y", "Deshacer / rehacer"],
  ["Ctrl + S / Ctrl + O", "Exportar / importar JSON"], ["Supr", "Eliminar la selección"], ["Esc", "Deseleccionar / cerrar"],
  ["V · H · N · C · X", "Seleccionar · mano · nudo · conectar · eliminar"], ["F", "Ajustar vista"], ["G · L", "Grilla · etiquetas"],
  ["Espacio + arrastrar", "Desplazar la vista"], ["Rueda", "Zoom en el cursor"], ["1 · 2 · 3 · 4 · 5", "Modelo · 3D · Resultados · Paso a paso · Historial"],
];
export function DialogoAtajos({ onCerrar }) {
  return (
    <Modal titulo="Atajos de teclado" onCerrar={onCerrar}>
      <dl className="divide-y divide-slate-100 text-sm dark:divide-ink-line">
        {ATAJOS.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2"><dt><kbd className="rounded border border-slate-300 px-1.5 py-0.5 text-xs dark:border-ink-line">{k}</kbd></dt><dd className="text-right text-slate-700 dark:text-slate-200">{v}</dd></div>
        ))}
      </dl>
    </Modal>
  );
}
