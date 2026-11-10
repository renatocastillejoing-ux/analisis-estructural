import { useEffect, useMemo, useState } from "react";
import Visor3D, { escenaModelo, escenaTorre } from "./Visor3D.jsx";
import { es3d, escena3d } from "../model3d.js";

// Vista 3D: el modelo actual extruido con sus secciones reales, o la Torre de Arequipa completa.
export default function Vista3D({ modelo, onAbrirPortico, onAbrirTorre3d }) {
  const [fuente, setFuente] = useState("modelo");
  const [torre, setTorre] = useState(null);
  const [error, setError] = useState("");
  const [eje, setEje] = useState("");
  const [pisoMax, setPisoMax] = useState(99);
  const [colorPor, setColorPor] = useState("tipo");
  const [losas, setLosas] = useState(true);
  const [etiquetas, setEtiquetas] = useState(true);
  const [elegido, setElegido] = useState(null);
  const [vista, setVista] = useState({ dir: "iso", k: 0 });

  useEffect(() => {
    if (fuente !== "torre" || torre) return;
    fetch("/api/torre/3d").then((r) => r.json()).then((d) => (d.ok ? setTorre(d) : setError(d.error || "No se pudo leer la torre."))).catch((e) => setError(String(e)));
  }, [fuente, torre]);

  const escena = useMemo(() => (fuente === "torre" ? (torre ? escenaTorre(torre) : null) : es3d(modelo) ? escena3d(modelo) : escenaModelo(modelo)), [fuente, torre, modelo]);
  useEffect(() => { setEje(""); setElegido(null); setPisoMax(99); }, [fuente]);

  const npisos = escena?.pisos || 0;
  const cuenta = useMemo(() => {
    if (!escena) return {};
    const c = {}; escena.miembros.forEach((m) => { c[m.tipo] = (c[m.tipo] || 0) + 1; }); return c;
  }, [escena]);
  const ver = (dir) => setVista((v) => ({ dir, k: v.k + 1 }));
  const portico = (g) => {
    if (!torre || !g) return null;
    const [t, v] = g.split(":");
    return t === "L" ? { tipo: "letra", idx: torre.ejes_y.indexOf(v), nombre: `Eje ${v}` } : { tipo: "numero", idx: +v - 1, nombre: `Eje ${v}` };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="flex max-h-[40vh] w-full shrink-0 flex-col gap-4 overflow-y-auto border-b md:max-h-none md:w-72 md:border-b-0 md:border-r border-slate-200 bg-white p-4 text-sm dark:border-ink-line dark:bg-ink-2">
        <div>
          <h2 className="mb-2 font-semibold">Vista 3D</h2>
          <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-ink-3">
            {[["modelo", "Modelo actual"], ["torre", "Torre de Arequipa"]].map(([k, l]) => (
              <button key={k} onClick={() => setFuente(k)} className={`flex-1 rounded-md px-2 py-1 text-xs ${fuente === k ? "bg-white font-semibold shadow dark:bg-ink-line" : "text-slate-600 dark:text-slate-300"}`}>{l}</button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {fuente === "torre" ? "10 pisos × 3.00 m, grilla 15 × 9 ejes. Cada barra con su sección real; en rojo, las placas." : "El pórtico 2D del editor, extruido con el ancho (b) y peralte (h) de cada sección. Los tramos de placa se ven con su sección."}
          </p>
        </div>

        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Cámara</h3>
          <div className="grid grid-cols-4 gap-1">
            {[["iso", "Iso"], ["planta", "Planta"], ["frente", "Frente"], ["lado", "Lado"]].map(([k, l]) => (
              <button key={k} onClick={() => ver(k)} className="rounded-md border border-slate-200 py-1 text-xs hover:bg-slate-100 dark:border-ink-line dark:hover:bg-ink-3">{l}</button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Arrastrar: girar · clic derecho o Shift+arrastrar: desplazar · rueda: zoom.</p>
        </div>

        {fuente === "torre" && (
          <button onClick={onAbrirTorre3d} className="rounded-md bg-teal px-3 py-2 text-xs font-semibold text-white hover:bg-teal-dark">Abrir la torre como modelo 3D editable y calcularla en 3D</button>
        )}
        {fuente === "torre" && torre && (<>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Resaltar pórtico</h3>
            <select className="inp w-full" value={eje} onChange={(e) => { setEje(e.target.value); setElegido(null); }}>
              <option value="">Todos (sin resaltar)</option>
              <optgroup label="Dirección X (ejes con letra)">{torre.ejes_y.map((l) => <option key={l} value={`L:${l}`}>Eje {l}</option>)}</optgroup>
              <optgroup label="Dirección Y (ejes numerados)">{torre.ejes_x.map((n) => <option key={n} value={`N:${n}`}>Eje {n}</option>)}</optgroup>
            </select>
            {eje && (
              <button onClick={() => { const p = portico(eje); onAbrirPortico(p.tipo, p.idx); }}
                className="mt-2 w-full rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-dark">Abrir el {portico(eje).nombre} en el editor 2D</button>
            )}
          </div>
          <div>
            <h3 className="mb-1 flex justify-between text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Pisos visibles <span className="tabular-nums">{Math.min(pisoMax, npisos)} / {npisos}</span></h3>
            <input type="range" min={1} max={npisos} value={Math.min(pisoMax, npisos)} onChange={(e) => setPisoMax(+e.target.value)} className="w-full accent-teal-600" aria-label="Pisos visibles" />
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Color</h3>
            <select className="inp w-full" value={colorPor} onChange={(e) => setColorPor(e.target.value)}>
              <option value="tipo">Por tipo de elemento</option>
              <option value="piso">Por piso</option>
              <option value="seccion">Por sección</option>
            </select>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={losas} onChange={(e) => setLosas(e.target.checked)} className="h-4 w-4 accent-teal-600" /> Losas</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={etiquetas} onChange={(e) => setEtiquetas(e.target.checked)} className="h-4 w-4 accent-teal-600" /> Ejes y pisos</label>
        </>)}

        {escena && fuente === "modelo" && (
          <div className="space-y-1 rounded-lg border border-slate-200 p-3 text-xs dark:border-ink-line">
            {modelo.secciones.map((s, i) => (
              <div key={s.nombre} className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ background: ["#508C9B", "#C1666B", "#6E9B54", "#B0894E", "#7E6C9B", "#3F7C8C", "#C98A3B", "#5E7BA6"][i % 8] }} />
                <span className="flex-1">{s.nombre}</span>
                <span className="tabular-nums text-slate-500">{(s.modo || "rect") === "rect" ? `${s.b} × ${s.h} m` : "A, I"}</span>
              </div>
            ))}
          </div>
        )}
        {escena && fuente === "torre" && (
          <div className="space-y-1 rounded-lg border border-slate-200 p-3 text-xs dark:border-ink-line">
            {Object.entries(cuenta).map(([t, n]) => (
              <div key={t} className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ background: { columna: "#5E7BA6", placa: "#C1666B", viga_x: "#6E9B54", viga_y: "#C98A3B", viga: "#6E9B54" }[t] }} />
                <span className="flex-1">{{ columna: "Columnas", placa: "Tramos de placa", viga_x: "Vigas en X", viga_y: "Vigas en Y", viga: "Vigas" }[t]}</span>
                <span className="tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        )}

        {elegido && (
          <div className="rounded-lg bg-amber-50 p-3 text-xs dark:bg-amber-900/20">
            <div className="mb-1 font-semibold">{elegido.info}</div>
            {elegido.eje && (
              <div className="mt-2 flex flex-wrap gap-1">
                {elegido.grupos.map((g) => (
                  <button key={g} onClick={() => setEje(g)} className="rounded-full border border-amber-300 px-2 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40">Resaltar {portico(g)?.nombre}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>

      <main className="relative min-h-[50vh] min-w-0 flex-1">
        {error && <p className="m-6 text-sm text-rose-600">{error}</p>}
        {!escena && !error && <p className="m-6 text-sm text-slate-500">Cargando la torre…</p>}
        {escena && escena.miembros.length === 0 && <p className="m-6 text-sm text-slate-500">El modelo no tiene elementos.</p>}
        {escena && escena.miembros.length > 0 && (
          <Visor3D escena={escena} resaltar={eje || null} pisoMax={pisoMax} colorPor={colorPor} verLosas={losas} verEtiquetas={etiquetas}
            onElegir={setElegido} vistaKey={vista} />
        )}
      </main>
    </div>
  );
}
