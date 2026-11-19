import { useRef, useState } from "react";
import Canvas from "./Canvas.jsx";
import { NumIn } from "./ui.jsx";
import { APOYOS } from "../model.js";
import { leerEjercicio } from "../api.js";

// Ejercicio desde foto: cámara o galería → compresión en el navegador → la IA lee el pórtico →
// el usuario revisa el dibujo, los supuestos y las dudas, corrige si hace falta y acepta.
// Mobile-first: pantalla completa en el teléfono, botones grandes, el teclado nunca es obligatorio.

const LADO_MAX = 1600, CALIDAD = 0.85;
const btnG = "flex min-h-[3.25rem] items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold";
const btnP = `${btnG} bg-teal text-white hover:bg-teal-dark disabled:opacity-50`;
const btnS = `${btnG} border border-slate-300 hover:bg-slate-100 dark:border-ink-line dark:hover:bg-ink-3`;

// Redimensiona en un canvas (lado mayor ≤ 1600 px) y devuelve un data URL JPEG 0,85.
export function comprimirImagen(archivo) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);   // PNG con transparencia → fondo blanco
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL("image/jpeg", CALIDAD));
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error("No se pudo abrir la imagen. Prueba con otra foto (JPG o PNG).")); };
    img.src = url;
  });
}

export default function FotoEjercicio({ onCerrar, onAceptar }) {
  const camara = useRef(null), galeria = useRef(null);
  const [foto, setFoto] = useState(null);         // data URL comprimido
  const [estado, setEstado] = useState("elegir"); // elegir · leyendo · revisar
  const [error, setError] = useState(null);
  const [leido, setLeido] = useState(null);       // { modelo, supuestos, dudas }
  const [corregir, setCorregir] = useState(false);
  const [sel, setSel] = useState(null);

  async function alElegir(ev) {
    const f = ev.target.files?.[0]; ev.target.value = "";
    if (!f) return;
    setError(null);
    try { setFoto(await comprimirImagen(f)); setEstado("elegir"); } catch (e) { setError(String(e.message || e)); }
  }
  async function leer() {
    setEstado("leyendo"); setError(null);
    try {
      const { ok, data } = await leerEjercicio(foto);
      if (!ok || !data.ok) { setError(data.error || "No se pudo leer el ejercicio."); setEstado("elegir"); return; }
      setLeido({ modelo: data.modelo, supuestos: data.supuestos || [], dudas: data.dudas || [] });
      setEstado("revisar");
    } catch (e) { setError("No hay conexión con el servidor: " + e); setEstado("elegir"); }
  }
  const cambiar = (fn) => setLeido((l) => { const m = structuredClone(l.modelo); fn(m); return { ...l, modelo: m }; });
  const m = leido?.modelo;
  const u = m ? `${m.unidad_fuerza}, ${m.unidad_longitud}` : "";

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 md:grid md:place-items-center md:p-4" role="dialog" aria-modal="true" aria-label="Ejercicio desde foto">
      <div className="flex h-full w-full flex-col overflow-hidden bg-white md:h-[90vh] md:max-w-5xl md:rounded-xl md:shadow-2xl dark:bg-ink-2">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3 pt-[max(.75rem,env(safe-area-inset-top))] dark:border-ink-line">
          <h2 className="flex-1 text-base font-semibold">📷 Ejercicio desde foto</h2>
          <button onClick={onCerrar} className="grid h-11 w-11 place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-ink-3" aria-label="Cerrar">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={alElegir} />
          <input ref={galeria} type="file" accept="image/jpeg,image/png,image/webp,image/*" className="hidden" onChange={alElegir} />

          {estado !== "revisar" && (
            <div className="mx-auto flex max-w-xl flex-col gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">Toma la foto del ejercicio de frente, con buena luz y con todas las cotas, apoyos y cargas a la vista. La IA arma el modelo y tú lo revisas antes de usarlo.</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button className={btnP} onClick={() => camara.current?.click()} disabled={estado === "leyendo"}>📷 Tomar foto</button>
                <button className={btnS} onClick={() => galeria.current?.click()} disabled={estado === "leyendo"}>🖼 Elegir de la galería</button>
              </div>
              {foto && <img src={foto} alt="Vista previa del ejercicio" className="max-h-[50dvh] w-full rounded-lg border border-slate-200 object-contain dark:border-ink-line" />}
              {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}
              {estado === "leyendo" && <p className="text-center text-sm text-slate-500">Leyendo el ejercicio con IA… puede tardar unos segundos.</p>}
            </div>
          )}

          {estado === "revisar" && m && (
            <div className="flex flex-col gap-4 lg:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-sm font-semibold">{m.nombre} · {m.nudos.length} nudos · {m.elementos.length} barras · {m.cargas_nodales.length + m.cargas_elementos.length} cargas ({u})</p>
                <div className="relative h-[45dvh] min-h-[16rem] overflow-hidden rounded-lg border border-slate-200 dark:border-ink-line">
                  <Canvas modelo={m} sel={sel} setSel={setSel} tool="pan" commit={() => {}} beginDrag={() => {}} moverNudo={() => {}}
                    fitKey={m.nudos.map((n) => `${n.x},${n.y}`).join(";")} capas={{ grilla: true, etiquetas: true, cargas: true }} snap={0} onCursor={() => {}}
                    onAgregarNudo={() => {}} onConectar={() => {}} onEliminar={() => {}} onZoom={() => {}} />
                </div>
                {foto && <details className="rounded-lg border border-slate-200 dark:border-ink-line"><summary className="cursor-pointer px-3 py-2 text-sm">Ver la foto original</summary><img src={foto} alt="Foto del ejercicio" className="w-full object-contain" /></details>}
              </div>
              <div className="flex w-full shrink-0 flex-col gap-3 lg:w-96">
                <Lista titulo="Lo que asumió la IA" items={leido.supuestos} vacio="Ningún supuesto declarado." tono="amber" />
                <Lista titulo="Dudas para revisar" items={leido.dudas} vacio="Sin dudas declaradas." tono="rose" />
                <button className={btnS} onClick={() => setCorregir((c) => !c)} aria-expanded={corregir}>{corregir ? "Ocultar corrección" : "✎ Corregir datos"}</button>
                {corregir && <Corregir m={m} cambiar={cambiar} />}
              </div>
            </div>
          )}
        </div>

        <div className="pie-seguro flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 px-4 pt-3 sm:flex-row sm:justify-end dark:border-ink-line">
          {estado === "revisar" ? (<>
            <button className={btnS} onClick={() => { setLeido(null); setEstado("elegir"); }}>↺ Otra foto</button>
            <button className={btnP} onClick={() => onAceptar(m)}>✓ Usar este modelo y resolver</button>
          </>) : (<>
            <button className={btnS} onClick={onCerrar}>Cancelar</button>
            <button className={btnP} onClick={leer} disabled={!foto || estado === "leyendo"}>{estado === "leyendo" ? "Leyendo…" : "Leer con IA"}</button>
          </>)}
        </div>
      </div>
    </div>
  );
}

function Lista({ titulo, items, vacio, tono }) {
  const c = tono === "amber" ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30" : "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30";
  return (
    <section className={`rounded-lg border p-3 ${c}`}>
      <h3 className="mb-1 text-sm font-semibold">{titulo}</h3>
      {items.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((s, k) => <li key={k}>{s}</li>)}</ul> : <p className="text-sm text-slate-500">{vacio}</p>}
    </section>
  );
}

// Corrección rápida: apoyos con botones (sin teclado), coordenadas, secciones y cargas con campos numéricos.
function Corregir({ m, cambiar }) {
  const fila = "grid grid-cols-[3rem_1fr_1fr] items-center gap-2";
  return (
    <div className="flex flex-col gap-3 text-sm">
      <section>
        <h3 className="mb-1 font-semibold">Nudos (x, y) y apoyos</h3>
        {m.nudos.map((n, k) => (
          <div key={n.id} className="mb-2 rounded-lg border border-slate-200 p-2 dark:border-ink-line">
            <div className={fila}><span>N{n.id}</span>
              <NumIn aria-label={`x del nudo ${n.id}`} value={n.x} onChange={(v) => cambiar((mm) => { mm.nudos[k].x = v; })} />
              <NumIn aria-label={`y del nudo ${n.id}`} value={n.y} onChange={(v) => cambiar((mm) => { mm.nudos[k].y = v; })} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {APOYOS.map(([id, l]) => (
                <button key={id} onClick={() => cambiar((mm) => { mm.nudos[k].apoyo = id; })} aria-pressed={n.apoyo === id}
                  className={`min-h-[2.5rem] rounded-md border px-2 text-xs ${n.apoyo === id ? "border-teal bg-teal text-white" : "border-slate-300 dark:border-ink-line"}`}>{l}</button>
              ))}
            </div>
          </div>
        ))}
      </section>
      <section>
        <h3 className="mb-1 font-semibold">Secciones</h3>
        {m.secciones.map((s, k) => (
          <div key={s.nombre} className={`${fila} mb-1`}><span className="truncate">{s.nombre}</span>
            {s.modo === "AI" ? (<>
              <NumIn aria-label={`A de ${s.nombre}`} value={s.A} onChange={(v) => v > 0 && cambiar((mm) => { mm.secciones[k].A = v; })} />
              <NumIn aria-label={`I de ${s.nombre}`} value={s.I} onChange={(v) => v > 0 && cambiar((mm) => { mm.secciones[k].I = v; })} />
            </>) : (<>
              <NumIn aria-label={`b de ${s.nombre}`} value={s.b} onChange={(v) => v > 0 && cambiar((mm) => { mm.secciones[k].b = v; })} />
              <NumIn aria-label={`h de ${s.nombre}`} value={s.h} onChange={(v) => v > 0 && cambiar((mm) => { mm.secciones[k].h = v; })} />
            </>)}
          </div>
        ))}
      </section>
      <section>
        <h3 className="mb-1 font-semibold">Cargas</h3>
        {m.cargas_nodales.map((c, k) => (
          <div key={`n${k}`} className="mb-1 grid grid-cols-[4rem_1fr_1fr_1fr] items-center gap-1"><span>N{c.nudo}</span>
            {["Fx", "Fy", "M"].map((p) => <NumIn key={p} aria-label={`${p} en N${c.nudo}`} placeholder={p} value={c[p]} onChange={(v) => cambiar((mm) => { mm.cargas_nodales[k][p] = v; })} />)}
          </div>
        ))}
        {m.cargas_elementos.map((c, k) => {
          const ps = c.tipo === "puntual" ? ["Px", "Py", "a"] : c.tipo === "momento" ? ["M", "a"] : c.subtipo === "trapezoidal" ? ["wy1", "wy2"] : ["wx", "wy"];
          const el = m.elementos.find((e) => e.id === c.elem);
          return (
            <div key={`e${k}`} className="mb-1 grid grid-cols-[4rem_1fr_1fr_1fr] items-center gap-1"><span className="truncate">{el?.nombre || `E${c.elem}`}</span>
              {ps.map((p) => <NumIn key={p} aria-label={`${p} en ${el?.nombre}`} placeholder={p} value={c[p]} onChange={(v) => cambiar((mm) => { mm.cargas_elementos[k][p] = v; })} />)}
            </div>
          );
        })}
        <p className="mt-1 text-xs text-slate-500">Abajo es negativo (wy, Py, Fy &lt; 0). Lo demás se ajusta en el editor después de aceptar.</p>
      </section>
    </div>
  );
}
