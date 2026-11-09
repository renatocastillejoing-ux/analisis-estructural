import { useEffect, useMemo, useState } from "react";
import Topbar from "./components/Topbar.jsx";
import Editor from "./components/Editor.jsx";
import Canvas from "./components/Canvas.jsx";
import Props from "./components/Props.jsx";
import Results from "./components/Results.jsx";
import Paso from "./components/Paso.jsx";
import { calcular } from "./api.js";
import { modeloEjemplo } from "./model.js";

const PASOS = [
  { id: "definir", label: "Definir", sub: "Materiales · Secciones" },
  { id: "modelar", label: "Modelar", sub: "Nudos · Elementos" },
  { id: "cargar", label: "Cargar", sub: "Nodales · Elementos" },
];

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem("ae_theme") !== "light");
  const [modelo, setModelo] = useState(modeloEjemplo);
  const [paso, setPaso] = useState("modelar");
  const [vista, setVista] = useState("modelo");
  const [sel, setSel] = useState(null);           // {tipo:'nudo'|'elemento', idx}
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("ae_theme", dark ? "dark" : "light");
  }, [dark]);

  const actualizar = (fn) => setModelo((m) => fn(structuredClone(m)));

  const correr = async () => {
    setCargando(true); setError(null);
    const { ok, data } = await calcular(modelo);
    setCargando(false);
    if (!ok || !data.ok) { setError(data.error || "No se pudo calcular"); setVista("resultados"); return; }
    setResultado(data.resultados ? { ...data, ...data.resultados } : data);
    setVista("resultados");
  };

  // atajo Ctrl+Enter = calcular
  useEffect(() => {
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); correr(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const resumen = useMemo(() => ({
    nudos: modelo.nudos.length, elementos: modelo.elementos.length,
    cargas: modelo.cargas_nodales.length + modelo.cargas_elementos.length,
  }), [modelo]);

  return (
    <div className="flex h-full flex-col">
      <Topbar
        dark={dark} onTheme={() => setDark((d) => !d)}
        vista={vista} onVista={setVista}
        paso={paso} onPaso={(p) => { setPaso(p); setVista("modelo"); }}
        onCalcular={correr} cargando={cargando}
      />
      <main className="flex min-h-0 flex-1">
        {vista === "modelo" && (
          <>
            <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white dark:border-ink-line dark:bg-ink-2">
              <Editor paso={paso} modelo={modelo} actualizar={actualizar} onSel={setSel} sel={sel} />
            </aside>
            <section className="relative min-w-0 flex-1 bg-slate-50 dark:bg-ink">
              <Canvas modelo={modelo} sel={sel} onSel={setSel} />
              <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-4 py-1 text-xs text-slate-600 shadow dark:bg-ink-3 dark:text-slate-300">
                {resumen.nudos} nudos · {resumen.elementos} elementos · {resumen.cargas} cargas · {modelo.unidad_fuerza}/{modelo.unidad_longitud}
              </div>
            </section>
            <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white dark:border-ink-line dark:bg-ink-2">
              <Props modelo={modelo} sel={sel} actualizar={actualizar} onCerrar={() => setSel(null)} />
            </aside>
          </>
        )}
        {vista === "resultados" && (
          <Results resultado={resultado} error={error} onVolver={() => setVista("modelo")} />
        )}
        {vista === "pasoapaso" && <Paso modelo={modelo} onVolver={() => setVista("modelo")} />}
      </main>
    </div>
  );
}
