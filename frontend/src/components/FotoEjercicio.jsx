import { useEffect, useRef, useState } from "react";
import Canvas from "./Canvas.jsx";
import { NumIn } from "./ui.jsx";
import { APOYOS } from "../model.js";
import { leerEjercicio, cuotaIA } from "../api.js";

// Ejercicio desde foto: cámara, galería, pegar (Ctrl+V) o arrastrar → recorte y giro →
// compresión en el navegador → la IA lee el esquema del pórtico y el servidor arma el modelo →
// el usuario revisa el dibujo, los supuestos, las dudas y la confianza de cada dato, y acepta.
// Mobile-first: pantalla completa en el teléfono, botones grandes, el teclado nunca es obligatorio.

const LADO_MAX = 1600, CALIDAD = 0.85, CALIDAD_BAJA = 0.75, MAX_BYTES = 1.5 * 1024 * 1024;
const LADO_FUENTE = 3200;                        // la fuente para recortar se limita (memoria del teléfono)
const ERR_DECODIFICAR = "No se pudo abrir la imagen. Si es una foto HEIC de iPhone, compártela como JPG (o haz una captura de pantalla) y vuelve a intentarlo.";
const btnG = "flex min-h-[3.25rem] items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold";
const btnP = `${btnG} bg-teal text-white hover:bg-teal-dark disabled:opacity-50`;
const btnS = `${btnG} border border-slate-300 hover:bg-slate-100 dark:border-ink-line dark:hover:bg-ink-3`;

const lienzo = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

// Archivo → canvas con la orientación EXIF ya aplicada (lado mayor ≤ 3200 px).
export async function decodificar(archivo) {
  let fuente = null;
  if (typeof createImageBitmap === "function") {
    try { fuente = await createImageBitmap(archivo, { imageOrientation: "from-image" }); }
    catch { try { fuente = await createImageBitmap(archivo); } catch { fuente = null; } }
  }
  if (!fuente) {
    fuente = await new Promise((ok) => {        // respaldo: <img> (los navegadores actuales ya respetan EXIF)
      const url = URL.createObjectURL(archivo), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); ok(img); };
      img.onerror = () => { URL.revokeObjectURL(url); ok(null); };
      img.src = url;
    });
  }
  const w = fuente?.width || fuente?.naturalWidth, h = fuente?.height || fuente?.naturalHeight;
  if (!fuente || !w || !h) throw new Error(ERR_DECODIFICAR);
  const k = Math.min(1, LADO_FUENTE / Math.max(w, h));
  const c = lienzo(w * k, h * k), g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);   // PNG con transparencia → fondo blanco
  g.drawImage(fuente, 0, 0, c.width, c.height);
  fuente.close?.();
  return c;
}

export function girar90(c) {
  const r = lienzo(c.height, c.width), g = r.getContext("2d");
  g.translate(r.width, 0); g.rotate(Math.PI / 2); g.drawImage(c, 0, 0);
  return r;
}

// Recorte (fracciones 0–1 de la fuente) → JPEG con lado mayor ≤ 1600 px; 0,75 si pesa más de 1,5 MB.
export function comprimir(c, rec = { x: 0, y: 0, w: 1, h: 1 }) {
  const sx = rec.x * c.width, sy = rec.y * c.height, sw = Math.max(1, rec.w * c.width), sh = Math.max(1, rec.h * c.height);
  const k = Math.min(1, LADO_MAX / Math.max(sw, sh));
  const o = lienzo(sw * k, sh * k), g = o.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, o.width, o.height);
  g.drawImage(c, sx, sy, sw, sh, 0, 0, o.width, o.height);
  let url = o.toDataURL("image/jpeg", CALIDAD);
  if (url.length * 0.75 > MAX_BYTES) url = o.toDataURL("image/jpeg", CALIDAD_BAJA);
  return url;
}

// Pantalla de recorte: rectángulo con cuatro asas (arrastrar una esquina) y arrastre del interior para moverlo.
function Recorte({ fuente, rec, setRec }) {
  const caja = useRef(null), img = useRef(null), arr = useRef(null);
  const [src, setSrc] = useState("");
  useEffect(() => { setSrc(fuente.toDataURL("image/jpeg", 0.8)); }, [fuente]);
  const MIN = 0.05, lim = (v) => Math.min(1, Math.max(0, v));
  const abajo = (modo) => (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    ev.currentTarget.setPointerCapture?.(ev.pointerId);
    arr.current = { modo, x0: ev.clientX, y0: ev.clientY, r0: rec };
  };
  const mover = (ev) => {
    const a = arr.current; if (!a || !img.current) return;
    const b = img.current.getBoundingClientRect();
    const dx = (ev.clientX - a.x0) / b.width, dy = (ev.clientY - a.y0) / b.height, r = a.r0;
    let { x, y, w, h } = r;
    if (a.modo === "mover") { x = Math.min(1 - w, Math.max(0, r.x + dx)); y = Math.min(1 - h, Math.max(0, r.y + dy)); }
    else {
      let x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
      if (a.modo.includes("o")) x1 = Math.min(lim(r.x + dx), x2 - MIN); else x2 = Math.max(lim(x2 + dx), x1 + MIN);
      if (a.modo.includes("n")) y1 = Math.min(lim(r.y + dy), y2 - MIN); else y2 = Math.max(lim(y2 + dy), y1 + MIN);
      x = x1; y = y1; w = x2 - x1; h = y2 - y1;
    }
    setRec({ x, y, w, h });
  };
  const fin = () => { arr.current = null; };
  const pct = (v) => `${v * 100}%`;
  const asa = (modo, estilo) => (
    <div onPointerDown={abajo(modo)} role="presentation"
      className="absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none" style={estilo}>
      <span className="absolute inset-3 rounded-full border-2 border-white bg-teal shadow" />
    </div>
  );
  return (
    <div ref={caja} className="relative mx-auto w-fit touch-none select-none" onPointerMove={mover} onPointerUp={fin} onPointerCancel={fin}>
      {src && <img ref={img} src={src} alt="Foto para recortar" draggable={false} className="block max-h-[55dvh] max-w-full" />}
      <div className="pointer-events-none absolute inset-0 bg-slate-900/45" style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${pct(rec.x)} ${pct(rec.y)},${pct(rec.x)} ${pct(rec.y + rec.h)},${pct(rec.x + rec.w)} ${pct(rec.y + rec.h)},${pct(rec.x + rec.w)} ${pct(rec.y)},${pct(rec.x)} ${pct(rec.y)})` }} />
      <div onPointerDown={abajo("mover")} aria-label="Zona recortada" className="absolute cursor-move border-2 border-white outline outline-1 outline-teal"
        style={{ left: pct(rec.x), top: pct(rec.y), width: pct(rec.w), height: pct(rec.h) }} />
      {asa("no", { left: pct(rec.x), top: pct(rec.y) })}
      {asa("ne", { left: pct(rec.x + rec.w), top: pct(rec.y) })}
      {asa("so", { left: pct(rec.x), top: pct(rec.y + rec.h) })}
      {asa("se", { left: pct(rec.x + rec.w), top: pct(rec.y + rec.h) })}
    </div>
  );
}

export default function FotoEjercicio({ onCerrar, onAceptar }) {
  const camara = useRef(null), galeria = useRef(null);
  const [fuente, setFuente] = useState(null);     // canvas decodificado (para recortar y girar)
  const [rec, setRec] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [foto, setFoto] = useState(null);         // data URL comprimido que se envía
  const [estado, setEstado] = useState("elegir"); // elegir · recortar · leyendo · revisar
  const [error, setError] = useState(null);
  const [leido, setLeido] = useState(null);       // { modelo, supuestos, dudas, confianza, … }
  const [corregir, setCorregir] = useState(false);
  const [sel, setSel] = useState(null);
  const [cuota, setCuota] = useState(null);
  const [encima, setEncima] = useState(false);

  useEffect(() => { cuotaIA().then((c) => c?.ok && setCuota(c)); }, []);

  async function tomar(f) {
    if (!f) return;
    if (f.type && !f.type.startsWith("image/")) { setError("Eso no es una imagen."); return; }
    setError(null);
    try {
      setFuente(await decodificar(f)); setRec({ x: 0, y: 0, w: 1, h: 1 }); setFoto(null); setEstado("recortar");
    } catch (e) { setError(String(e.message || e)); }
  }
  const alElegir = (ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; tomar(f); };

  // escritorio: pegar una captura con Ctrl+V
  useEffect(() => {
    const pegar = (ev) => {
      if (estado === "leyendo" || estado === "revisar") return;
      const it = [...(ev.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      if (it) { ev.preventDefault(); tomar(it.getAsFile()); }
    };
    window.addEventListener("paste", pegar);
    return () => window.removeEventListener("paste", pegar);
  }, [estado]);
  const soltar = (ev) => { ev.preventDefault(); setEncima(false); if (estado !== "leyendo" && estado !== "revisar") tomar(ev.dataTransfer?.files?.[0]); };

  function usarRecorte() {
    try { setFoto(comprimir(fuente, rec)); setEstado("elegir"); }
    catch { setError(ERR_DECODIFICAR); }
  }
  async function leer() {
    setEstado("leyendo"); setError(null);
    try {
      const { ok, data } = await leerEjercicio(foto);
      if (data && typeof data.quedan === "number") setCuota((c) => ({ ...(c || {}), quedan: data.quedan }));
      if (!ok || !data.ok) {
        setError(data.error || "No se pudo leer el ejercicio.");
        cuotaIA().then((c) => c?.ok && setCuota(c));
        setEstado("elegir"); return;
      }
      setLeido({ modelo: data.modelo, supuestos: data.supuestos || [], dudas: data.dudas || [], confianza: data.confianza || [],
        pide: data.pide || [], gdl: data.gdl || [], unidades_leidas: data.unidades_leidas || {}, formato: data.formato });
      setEstado("revisar");
    } catch (e) { setError("No hay conexión con el servidor: " + e); setEstado("elegir"); }
  }
  const cambiar = (fn) => setLeido((l) => { const m = structuredClone(l.modelo); fn(m); return { ...l, modelo: m }; });
  const m = leido?.modelo;
  const u = m ? `${m.unidad_fuerza}, ${m.unidad_longitud}` : "";
  const sinCuota = cuota && (cuota.quedan <= 0 || cuota.diario_agotado);
  const bajas = (leido?.confianza || []).filter((c) => c.nivel === "baja");

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 md:grid md:place-items-center md:p-4" role="dialog" aria-modal="true" aria-label="Ejercicio desde foto"
      onDragOver={(ev) => { ev.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)} onDrop={soltar}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-white md:h-[90vh] md:max-w-5xl md:rounded-xl md:shadow-2xl dark:bg-ink-2">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3 pt-[max(.75rem,env(safe-area-inset-top))] dark:border-ink-line">
          <h2 className="flex-1 text-base font-semibold">📷 Ejercicio desde foto</h2>
          {cuota && <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${sinCuota ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" : "bg-slate-100 text-slate-600 dark:bg-ink-3 dark:text-slate-300"}`}>
            {cuota.diario_agotado && cuota.quedan > 0 ? "Tope diario del servidor alcanzado" : `Te quedan ${cuota.quedan} de ${cuota.limite ?? 5} lecturas`}</span>}
          <button onClick={onCerrar} className="grid h-11 w-11 place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-ink-3" aria-label="Cerrar">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={alElegir} />
          <input ref={galeria} type="file" accept="image/*" className="hidden" onChange={alElegir} />

          {estado === "recortar" && fuente && (
            <div className="mx-auto flex max-w-3xl flex-col gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">Encuadra solo el ejercicio: arrastra las esquinas o mueve el recuadro. Gira la foto si quedó de lado.</p>
              <Recorte fuente={fuente} rec={rec} setRec={setRec} />
              {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}
            </div>
          )}

          {(estado === "elegir" || estado === "leyendo") && (
            <div className="mx-auto flex max-w-xl flex-col gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">Toma la foto del ejercicio de frente, con buena luz y con todas las cotas, apoyos y cargas a la vista. La IA lee el esquema, el servidor arma el modelo y tú lo revisas antes de usarlo.</p>
              <p className="hidden text-xs text-slate-500 md:block">En la computadora también puedes pegar una captura con <kbd className="rounded border px-1">Ctrl</kbd>+<kbd className="rounded border px-1">V</kbd> o arrastrar la imagen aquí.</p>
              {encima && <div className="rounded-xl border-2 border-dashed border-teal p-6 text-center text-sm text-teal">Suelta la imagen aquí</div>}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button className={btnP} onClick={() => camara.current?.click()} disabled={estado === "leyendo"}>📷 Tomar foto</button>
                <button className={btnS} onClick={() => galeria.current?.click()} disabled={estado === "leyendo"}>🖼 Elegir imagen</button>
              </div>
              {foto && <img src={foto} alt="Vista previa del ejercicio" className="max-h-[50dvh] w-full rounded-lg border border-slate-200 object-contain dark:border-ink-line" />}
              {foto && estado === "elegir" && <button className="self-start text-sm text-teal underline" onClick={() => setEstado("recortar")}>✂ Volver a recortar</button>}
              {sinCuota && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{cuota.quedan <= 0 ? `Ya usaste tus ${cuota.limite ?? 5} lecturas con IA.` : "Hoy ya se usaron todas las lecturas con IA del servidor."} Puedes armar el modelo a mano, con el generador o con una plantilla.</p>}
              {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}
              {estado === "leyendo" && <p className="text-center text-sm text-slate-500">Leyendo el ejercicio con IA… puede tardar unos segundos.</p>}
            </div>
          )}

          {estado === "revisar" && m && (
            <div className="flex flex-col gap-4 lg:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-sm font-semibold">{m.nombre} · {m.nudos.length} nudos · {m.elementos.length} barras · {m.cargas_nodales.length + m.cargas_elementos.length} cargas ({u})</p>
                <p className="text-xs text-slate-500">{leido.formato === "esquema" ? "Pórtico regular: la IA leyó vanos, alturas y apoyos y el servidor armó nudos y barras." : "Geometría no regular: la IA dio los nudos y barras uno por uno; revísalos con más cuidado."}
                  {(leido.unidades_leidas.fuerza || leido.unidades_leidas.longitud) && ` Unidades en la figura: ${[leido.unidades_leidas.fuerza, leido.unidades_leidas.longitud].filter(Boolean).join(", ")}.`}</p>
                <div className="relative h-[45dvh] min-h-[16rem] overflow-hidden rounded-lg border border-slate-200 dark:border-ink-line">
                  <Canvas modelo={m} sel={sel} setSel={setSel} tool="pan" commit={() => {}} beginDrag={() => {}} moverNudo={() => {}}
                    fitKey={m.nudos.map((n) => `${n.x},${n.y}`).join(";")} capas={{ grilla: true, etiquetas: true, cargas: true }} snap={0} onCursor={() => {}}
                    onAgregarNudo={() => {}} onConectar={() => {}} onEliminar={() => {}} onZoom={() => {}} />
                </div>
                {foto && <details className="rounded-lg border border-slate-200 dark:border-ink-line"><summary className="cursor-pointer px-3 py-2 text-sm">Ver la foto original</summary><img src={foto} alt="Foto del ejercicio" className="w-full object-contain" /></details>}
              </div>
              <div className="flex w-full shrink-0 flex-col gap-3 lg:w-96">
                {bajas.length > 0 && <Lista titulo="⚠ Datos con baja confianza: revísalos" items={bajas.map((c) => c.dato + (c.nota ? ` — ${c.nota}` : ""))} vacio="" tono="amber" />}
                <Lista titulo="Lo que asumió la IA" items={leido.supuestos} vacio="Ningún supuesto declarado." tono="amber" />
                <Lista titulo="Dudas para revisar" items={leido.dudas} vacio="Sin dudas declaradas." tono="rose" />
                <button className={btnS} onClick={() => setCorregir((c) => !c)} aria-expanded={corregir}>{corregir ? "Ocultar corrección" : "✎ Corregir datos"}</button>
                {leido.pide.length > 0 && <Lista titulo="Lo que pide el enunciado" items={leido.pide} vacio="" tono="neutro" />}
                {leido.gdl.length > 0 && <Lista titulo="Numeración de GDL de la figura" items={leido.gdl.map((g) => `N${g.nudo}: ${g.numeros.join(", ")}`)} vacio="" tono="neutro" />}
                {leido.confianza.length > 0 && (
                  <details className="rounded-lg border border-slate-200 p-3 text-sm dark:border-ink-line">
                    <summary className="cursor-pointer font-semibold">Confianza de cada dato ({leido.confianza.length})</summary>
                    <ul className="mt-2 space-y-1">{leido.confianza.map((c, k) => (
                      <li key={k} className={`rounded px-2 py-1 ${c.nivel === "baja" ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" : ""}`}>
                        <b>{c.dato}</b> · {c.nivel}{c.nota ? ` — ${c.nota}` : ""}</li>))}</ul>
                  </details>
                )}
                {corregir && <Corregir m={m} cambiar={cambiar} />}
              </div>
            </div>
          )}
        </div>

        <div className="pie-seguro flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 px-4 pt-3 sm:flex-row sm:justify-end dark:border-ink-line">
          {estado === "recortar" ? (<>
            <button className={btnS} onClick={() => { setFuente(girar90(fuente)); setRec({ x: 0, y: 0, w: 1, h: 1 }); }}>⟳ Girar 90°</button>
            <button className={btnS} onClick={() => setRec({ x: 0, y: 0, w: 1, h: 1 })}>Toda la foto</button>
            <button className={btnP} onClick={usarRecorte}>✓ Usar este recorte</button>
          </>) : estado === "revisar" ? (<>
            <button className={btnS} onClick={() => { setLeido(null); setEstado("elegir"); }}>↺ Otra foto</button>
            <button className={btnP} onClick={() => onAceptar(m)}>✓ Usar este modelo y resolver</button>
          </>) : (<>
            <button className={btnS} onClick={onCerrar}>Cancelar</button>
            <button className={btnP} onClick={leer} disabled={!foto || estado === "leyendo" || sinCuota}>{estado === "leyendo" ? "Leyendo…" : "Leer con IA"}</button>
          </>)}
        </div>
      </div>
    </div>
  );
}

function Lista({ titulo, items, vacio, tono }) {
  const c = tono === "amber" ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
    : tono === "neutro" ? "border-slate-200 dark:border-ink-line" : "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30";
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
