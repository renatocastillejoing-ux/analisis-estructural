import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Canvas, { HERRAMIENTAS } from "./components/Canvas.jsx";
import { Arbol, PANELES, PanelEditor, udlTodasLasVigas } from "./components/Editor.jsx";
import Props from "./components/Props.jsx";
import Results from "./components/Results.jsx";
import Paso from "./components/Paso.jsx";
import Historial from "./components/Historial.jsx";
const Vista3D = lazy(() => import("./components/Vista3D.jsx"));
import { BuscadorComandos, MenuBar } from "./components/MenuBar.jsx";
import { DialogoAtajos, DialogoConfirmar, DialogoGenerador, DialogoPlantillas, DialogoTorre } from "./components/Dialogs.jsx";
import { calcular, combinaciones, torreModelo } from "./api.js";
import { agregarElemento, agregarNudo, borrarElemento, borrarNudo, modeloEjemplo, modeloVacio, nextId } from "./model.js";

const CLAVE = "ae_react_modelo";
const VISTAS = [["modelo", "Modelo"], ["3d", "3D"], ["resultados", "Resultados"], ["paso", "Paso a paso"], ["historial", "Historial"]];
const SNAPS = [[0, "Libre"], [0.05, "0.05 m"], [0.1, "0.10 m"], [0.25, "0.25 m"], [0.5, "0.50 m"], [1, "1.00 m"]];

function modeloInicial() {
  try { const s = localStorage.getItem(CLAVE); if (s) { const m = JSON.parse(s); if (m?.nudos) return m; } } catch { /* sin almacenamiento */ }
  return modeloEjemplo();
}

// Revisión rápida antes de calcular: errores bloquean, avisos solo informan.
function validar(m) {
  const errores = [], avisos = [];
  if (!m.nudos.length) errores.push("El modelo no tiene nudos.");
  if (!m.elementos.length) errores.push("El modelo no tiene elementos.");
  if (m.nudos.length && !m.nudos.some((n) => n.apoyo !== "libre")) errores.push("No hay apoyos: la estructura es inestable.");
  const ids = new Set(m.nudos.map((n) => n.id));
  m.elementos.forEach((e) => { if (!ids.has(e.i) || !ids.has(e.j)) errores.push(`${e.nombre} apunta a un nudo que no existe.`); else if (e.i === e.j) errores.push(`${e.nombre} une un nudo consigo mismo.`); });
  const secs = new Set(m.secciones.map((s) => s.nombre));
  m.elementos.forEach((e) => { if (!secs.has(e.seccion)) errores.push(`${e.nombre} usa la sección «${e.seccion}», que no existe.`); });
  const pos = {};
  m.nudos.forEach((n) => { const k = `${(+n.x).toFixed(4)},${(+n.y).toFixed(4)}`; if (pos[k]) avisos.push(`${n.nombre} coincide con ${pos[k]}.`); else pos[k] = n.nombre; });
  const usados = new Set(m.elementos.flatMap((e) => [e.i, e.j]));
  m.nudos.forEach((n) => { if (!usados.has(n.id)) avisos.push(`${n.nombre} está suelto (sin barras).`); });
  if (!m.cargas_nodales.length && !m.cargas_elementos.length && !m.peso_propio) avisos.push("No hay cargas aplicadas.");
  return { errores, avisos };
}

function descargar(nombre, texto, tipo = "application/json") {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const archivo = (m) => (m.nombre || "modelo").replace(/[^\wáéíóúñ\- ]+/gi, "").trim().replace(/\s+/g, "_") || "modelo";

export default function App() {
  // ---------- modelo con deshacer / rehacer ----------
  const [hist, setHist] = useState(() => ({ past: [], present: modeloInicial(), future: [] }));
  const modelo = hist.present;
  const commit = useCallback((fn) => setHist((h) => {
    const m = structuredClone(h.present); fn(m);
    return { past: [...h.past.slice(-99), h.present], present: m, future: [] };
  }), []);
  const [fitKey, setFitKey] = useState(0);
  const reemplazar = useCallback((m) => {
    setHist((h) => ({ past: [...h.past.slice(-99), h.present], present: m, future: [] }));
    setSel(null); setFitKey((k) => k + 1);
  }, []);
  const deshacer = useCallback(() => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h)), []);
  const rehacer = useCallback(() => setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)), []);
  const beginDrag = useCallback(() => setHist((h) => ({ past: [...h.past.slice(-99), h.present], present: h.present, future: [] })), []);
  const moverNudo = useCallback((id, x, y) => setHist((h) => ({
    ...h, present: { ...h.present, nudos: h.present.nudos.map((n) => (n.id === id ? { ...n, x: +x.toFixed(4), y: +y.toFixed(4) } : n)) },
  })), []);

  // ---------- estado de interfaz ----------
  const [sel, setSel] = useState(null);
  const [vista, setVista] = useState("modelo");
  const [panel, setPanel] = useState(null);            // null = árbol del modelo
  const [tool, setTool] = useState("select");
  const [capas, setCapas] = useState({ grilla: true, etiquetas: true, cargas: true });
  const [snap, setSnap] = useState(0.25);
  const [cursor, setCursor] = useState(null);
  const [zoom, setZoom] = useState(60);
  const [dialogo, setDialogo] = useState(null);
  const [confirmacion, setConfirmacion] = useState(null);
  const [toast, setToast] = useState(null);
  const [tema, setTema] = useState(() => { try { return localStorage.getItem("ae_tema") || "dark"; } catch { return "dark"; } });
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  const [calculando, setCalculando] = useState(false);
  const [modeloCalculado, setModeloCalculado] = useState(null);
  const [combos, setCombos] = useState(null);
  const [guardado, setGuardado] = useState(true);
  const buscador = useRef(null);
  const importar = useRef(null);

  const avisar = useCallback((texto, tipo = "ok") => { setToast({ texto, tipo, k: Date.now() }); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", tema === "dark");
    try { localStorage.setItem("ae_tema", tema); } catch { /* sin almacenamiento */ }
  }, [tema]);

  // autoguardado en este navegador
  useEffect(() => {
    setGuardado(false);
    const t = setTimeout(() => { try { localStorage.setItem(CLAVE, JSON.stringify(modelo)); setGuardado(true); } catch { /* lleno o bloqueado */ } }, 400);
    return () => clearTimeout(t);
  }, [modelo]);

  // si la selección deja de existir (deshacer, borrar), se limpia
  useEffect(() => {
    if (!sel) return;
    const existe = sel.tipo === "nudo" ? modelo.nudos.some((n) => n.id === sel.id) : modelo.elementos.some((e) => e.id === sel.id);
    if (!existe) setSel(null);
  }, [modelo, sel]);

  const validacion = useMemo(() => validar(modelo), [modelo]);
  const desactualizado = resultado && modeloCalculado !== modelo;

  // ---------- acciones ----------
  const ejecutarCalculo = useCallback(async () => {
    if (validacion.errores.length) { avisar(validacion.errores[0], "err"); return; }
    setCalculando(true); setError(null);
    try {
      const { ok, data } = await calcular(modelo);
      if (!ok || !data.ok) { setError(data.error || "No se pudo calcular"); setResultado(null); }
      else { setResultado({ ...data, ...data.resultados }); setModeloCalculado(modelo); }
      setVista("resultados");
    } catch (e) { setError("No hay conexión con el servidor de cálculo: " + e); setVista("resultados"); }
    finally { setCalculando(false); }
  }, [modelo, validacion, avisar]);

  const ejecutarCombos = useCallback(async () => {
    const casos = modelo.casos || [];
    if (!casos.length) { avisar("Define al menos un caso de carga (Definir › Casos de carga y combinaciones).", "err"); setPanel("casos"); setVista("modelo"); return; }
    if (validacion.errores.length) { avisar(validacion.errores[0], "err"); return; }
    const def = casos[0].nombre;
    const payload = {
      ...modelo,
      casos: casos.map((c) => ({
        nombre: c.nombre,
        cargas_nodales: modelo.cargas_nodales.filter((x) => (x.caso || def) === c.nombre),
        cargas_elementos: modelo.cargas_elementos.filter((x) => (x.caso || def) === c.nombre),
      })),
      combinaciones: (modelo.combinaciones || []).map((c) => ({ nombre: c.nombre, factores: c.factores || {} })),
    };
    setCalculando(true);
    try {
      const { ok, data } = await combinaciones(payload);
      if (!ok || !data.ok) { avisar(data.error || "No se pudieron calcular las combinaciones.", "err"); return; }
      setCombos(data); setVista("resultados"); avisar(`Envolventes de ${data.resumen.n_combinaciones} combinaciones calculadas.`);
    } catch (e) { avisar("No hay conexión con el servidor de cálculo.", "err"); }
    finally { setCalculando(false); }
  }, [modelo, validacion, avisar]);

  const borrarSel = useCallback(() => {
    if (!sel) return;
    commit((m) => (sel.tipo === "nudo" ? borrarNudo(m, sel.id) : borrarElemento(m, sel.id)));
    setSel(null);
  }, [sel, commit]);

  const abrirPanel = useCallback((p) => { setPanel(p); setVista("modelo"); }, []);
  const confirmar = useCallback((c) => setConfirmacion(c), []);

  const exportarJSON = () => { descargar(`${archivo(modelo)}.json`, JSON.stringify(modelo, null, 2)); avisar("Modelo exportado como JSON."); };
  const onImportar = (ev) => {
    const f = ev.target.files?.[0]; ev.target.value = "";
    if (!f) return;
    f.text().then((t) => {
      const m = JSON.parse(t);
      if (!Array.isArray(m.nudos) || !Array.isArray(m.elementos)) throw new Error("no tiene nudos y elementos");
      reemplazar({ ...modeloVacio(), ...m });
      avisar(`«${m.nombre || f.name}» importado: ${m.nudos.length} nudos, ${m.elementos.length} elementos.`);
    }).catch((e) => avisar("El archivo no es un modelo válido: " + e.message, "err"));
  };
  const exportarMemoria = () => {
    if (!resultado?.reporte) return;
    const r = resultado.reporte;
    descargar(`${archivo(modelo)}_memoria.txt`, typeof r === "string" ? r : JSON.stringify(r, null, 2), "text/plain");
  };
  const exportarCSV = () => {
    if (!resultado) return;
    const L = ["Desplazamientos", "Nudo,ux,uy,giro", ...(resultado.desplazamientos || []).map((d) => [d.nudo, d.ux, d.uy, d.giro].join(",")),
      "", "Reacciones", "Nudo,Rx,Ry,M", ...(resultado.reacciones || []).map((x) => [x.nudo, x.Rx, x.Ry, x.M].join(",")),
      "", "Fuerzas en extremos", "Elem,Ni,Vi,Mi,Nj,Vj,Mj", ...(resultado.fuerzas || []).map((x) => [x.elem, x.Ni, x.Vi, x.Mi, x.Nj, x.Vj, x.Mj].join(","))];
    descargar(`${archivo(modelo)}_resultados.csv`, "﻿" + L.join("\n"), "text/csv");
  };
  const apoyarBase = (tipo) => commit((m) => {
    const y0 = Math.min(...m.nudos.map((n) => +n.y));
    m.nudos.forEach((n) => { if (Math.abs(n.y - y0) < 1e-9) n.apoyo = tipo; });
  });
  const nuevoModelo = () => confirmar({ titulo: "Nuevo modelo", texto: "Se vaciará el modelo actual. Puedes recuperarlo con Deshacer (Ctrl+Z) o exportarlo antes.", accion: "Empezar vacío", onAceptar: () => { reemplazar(modeloVacio()); setPanel(null); } });
  const cargarModelo = (m, msg) => { reemplazar(m); setDialogo(null); setVista("modelo"); setResultado(null); setCombos(null); avisar(msg || `«${m.nombre}» cargado: ${m.nudos.length} nudos, ${m.elementos.length} elementos.`); };

  // ---------- menús (también alimentan el buscador de comandos) ----------
  const menus = [
    { id: "archivo", label: "Archivo", items: [
      { id: "nuevo", label: "Nuevo modelo", accion: nuevoModelo },
      { id: "plantillas", label: "Plantillas (EJ 1, EJ 2, …)…", accion: () => setDialogo("plantillas"), claves: "ejemplo ejercicio" },
      { id: "generar", label: "Generar pórtico regular…", accion: () => setDialogo("generador"), claves: "pisos vanos" },
      { id: "torre", label: "Torre de Arequipa (pórtico 2D)…", accion: () => setDialogo("torre"), claves: "edificio portico eje" },
      { id: "torre3d", label: "Torre de Arequipa en 3D", accion: () => setVista("3d"), claves: "edificio tridimensional" },
      "sep",
      { id: "importar", label: "Importar modelo (JSON)…", atajo: "Ctrl+O", accion: () => importar.current?.click(), claves: "abrir" },
      { id: "exportar", label: "Exportar modelo (JSON)", atajo: "Ctrl+S", accion: exportarJSON, claves: "guardar descargar" },
      "sep",
      { id: "memoria", label: "Exportar memoria de cálculo (.txt)", accion: exportarMemoria, disabled: !resultado?.reporte, claves: "reporte" },
      { id: "csv", label: "Exportar resultados (CSV)", accion: exportarCSV, disabled: !resultado, claves: "excel" },
      { id: "imprimir", label: "Imprimir / PDF", accion: () => window.print() },
    ] },
    { id: "editar", label: "Editar", items: [
      { id: "deshacer", label: "Deshacer", atajo: "Ctrl+Z", accion: deshacer, disabled: !hist.past.length },
      { id: "rehacer", label: "Rehacer", atajo: "Ctrl+Y", accion: rehacer, disabled: !hist.future.length },
      "sep",
      { id: "borrar", label: "Eliminar selección", atajo: "Supr", accion: borrarSel, disabled: !sel },
      { id: "deseleccionar", label: "Deseleccionar", atajo: "Esc", accion: () => setSel(null), disabled: !sel },
      "sep",
      { id: "buscar", label: "Buscar comando", atajo: "Ctrl+K", accion: () => buscador.current?.enfocar() },
    ] },
    { id: "vista", label: "Vista", items: [
      { id: "ajustar", label: "Ajustar vista al modelo", atajo: "F", accion: () => setFitKey((k) => k + 1), claves: "zoom encuadrar" },
      { id: "grilla", label: "Grilla", atajo: "G", check: capas.grilla, accion: () => setCapas((c) => ({ ...c, grilla: !c.grilla })) },
      { id: "etiquetas", label: "Etiquetas de nudos y barras", atajo: "L", check: capas.etiquetas, accion: () => setCapas((c) => ({ ...c, etiquetas: !c.etiquetas })) },
      { id: "vercargas", label: "Cargas en el lienzo", check: capas.cargas, accion: () => setCapas((c) => ({ ...c, cargas: !c.cargas })) },
      { id: "snap", label: `Ajuste a la grilla (${snap ? snap + " m" : "libre"})`, check: !!snap, accion: () => setSnap((s) => (s ? 0 : 0.25)) },
      "sep",
      ...VISTAS.map(([id, l], i) => ({ id: `v-${id}`, label: l, atajo: String(i + 1), check: vista === id, accion: () => setVista(id) })),
      "sep",
      { id: "tema", label: tema === "dark" ? "Tema claro" : "Tema oscuro", accion: () => setTema((t) => (t === "dark" ? "light" : "dark")) },
    ] },
    { id: "definir", label: "Definir", items: [
      { id: "p-proyecto", label: "Proyecto y unidades…", accion: () => abrirPanel("proyecto") },
      { id: "p-material", label: "Materiales…", accion: () => abrirPanel("material"), claves: "concreto fc modulo elasticidad" },
      { id: "p-secciones", label: "Secciones…", accion: () => abrirPanel("secciones"), claves: "viga columna placa" },
      { id: "p-casos", label: "Casos de carga y combinaciones…", accion: () => abrirPanel("casos"), claves: "cm cv cs envolvente" },
    ] },
    { id: "dibujar", label: "Dibujar", items: [
      ...HERRAMIENTAS.map((h) => ({ id: `t-${h.id}`, label: h.label, atajo: h.kbd, icono: h.icon, check: tool === h.id, accion: () => { setTool(h.id); setVista("modelo"); } })),
      "sep",
      { id: "p-nudos", label: "Tabla de nudos…", accion: () => abrirPanel("nudos") },
      { id: "p-elementos", label: "Tabla de elementos…", accion: () => abrirPanel("elementos"), claves: "barras" },
    ] },
    { id: "asignar", label: "Asignar", items: [
      { id: "p-cnudos", label: "Cargas en nudos…", accion: () => abrirPanel("cargas_nudos"), claves: "fuerza puntual" },
      { id: "p-celems", label: "Cargas en elementos…", accion: () => abrirPanel("cargas_elementos"), claves: "distribuida uniforme trapezoidal" },
      { id: "udl", label: "UDL a todas las vigas…", accion: () => udlTodasLasVigas(commit), disabled: !modelo.elementos.length },
      "sep",
      { id: "empotrar", label: "Empotrar los nudos de la base", accion: () => apoyarBase("empotrado"), disabled: !modelo.nudos.length, claves: "apoyo" },
      { id: "articular", label: "Articular los nudos de la base", accion: () => apoyarBase("fijo"), disabled: !modelo.nudos.length, claves: "apoyo" },
    ] },
    { id: "analizar", label: "Analizar", items: [
      { id: "calcular", label: "Calcular estructura", atajo: "Ctrl+Enter", accion: ejecutarCalculo, claves: "resolver correr" },
      { id: "combos", label: "Calcular combinaciones y envolventes", accion: ejecutarCombos, claves: "casos envolvente cm cv" },
      { id: "pasoapaso", label: "Resolver paso a paso (método [A])", accion: () => setVista("paso"), claves: "sistematizado matriz" },
      { id: "opciones", label: "Opciones de análisis…", accion: () => abrirPanel("proyecto"), claves: "pdelta modal timoshenko" },
    ] },
    { id: "ayuda", label: "Ayuda", items: [
      { id: "atajos", label: "Atajos de teclado", atajo: "?", accion: () => setDialogo("atajos") },
      { id: "clasica", label: "Abrir la interfaz clásica", accion: () => window.open("/", "_blank") },
    ] },
  ];
  const comandos = menus.flatMap((m) => m.items.filter((i) => i !== "sep").map((i) => ({ ...i, grupo: m.label })));

  // ---------- teclado ----------
  const teclas = useRef({});
  teclas.current = { ejecutarCalculo, deshacer, rehacer, borrarSel, exportarJSON, sel, tool, vista };
  useEffect(() => {
    const h = (e) => {
      const t = teclas.current;
      const enCampo = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "Enter") { e.preventDefault(); t.ejecutarCalculo(); return; }
      if (ctrl && e.key.toLowerCase() === "k") { e.preventDefault(); buscador.current?.enfocar(); return; }
      if (ctrl && e.key.toLowerCase() === "s") { e.preventDefault(); t.exportarJSON(); return; }
      if (ctrl && e.key.toLowerCase() === "o") { e.preventDefault(); importar.current?.click(); return; }
      if (enCampo) return;
      if (ctrl && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? t.rehacer() : t.deshacer(); return; }
      if (ctrl && e.key.toLowerCase() === "y") { e.preventDefault(); t.rehacer(); return; }
      if (ctrl || e.altKey) return;
      if (e.key === "Delete" || e.key === "Backspace") { if (t.sel) { e.preventDefault(); t.borrarSel(); } return; }
      if (e.key === "Escape") { if (t.tool !== "select") setTool("select"); else setSel(null); return; }
      if (e.key === "?") { setDialogo("atajos"); return; }
      const v = { 1: "modelo", 2: "3d", 3: "resultados", 4: "paso", 5: "historial" }[e.key];
      if (v) { setVista(v); return; }
      if (t.vista !== "modelo") return;
      const herr = HERRAMIENTAS.find((x) => x.kbd.toLowerCase() === e.key.toLowerCase());
      if (herr) { setTool(herr.id); return; }
      if (e.key.toLowerCase() === "f") setFitKey((k) => k + 1);
      else if (e.key.toLowerCase() === "g") setCapas((c) => ({ ...c, grilla: !c.grilla }));
      else if (e.key.toLowerCase() === "l") setCapas((c) => ({ ...c, etiquetas: !c.etiquetas }));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ---------- callbacks del lienzo ----------
  const onAgregarNudo = useCallback((x, y) => {
    const id = nextId(modelo.nudos);
    commit((m) => { agregarNudo(m, x, y); });
    setSel({ tipo: "nudo", id });
  }, [modelo.nudos, commit]);
  const onConectar = useCallback((i, j) => {
    const dup = modelo.elementos.some((e) => (e.i === i && e.j === j) || (e.i === j && e.j === i));
    if (i === j || dup) { if (dup) avisar("Esos nudos ya están conectados.", "err"); return; }
    const sec = sel?.tipo === "elemento" ? modelo.elementos.find((e) => e.id === sel.id)?.seccion : undefined;
    commit((m) => { agregarElemento(m, i, j, sec); });
  }, [modelo.elementos, sel, commit, avisar]);
  const onEliminar = useCallback((tipo, id) => { commit((m) => (tipo === "nudo" ? borrarNudo(m, id) : borrarElemento(m, id))); }, [commit]);

  const herramienta = HERRAMIENTAS.find((h) => h.id === tool);

  return (
    <div className="flex h-full flex-col bg-slate-50 text-slate-900 dark:bg-ink dark:text-slate-100">
      {/* ===== cabecera única ===== */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 dark:border-ink-line dark:bg-ink-2">
        <div className="flex shrink-0 items-center gap-2 pr-1">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-teal text-xs font-bold text-white">AE</span>
          <span className="hidden text-sm font-semibold 2xl:inline">Análisis Estructural</span>
        </div>
        <div className="hidden lg:block"><MenuBar menus={menus} /></div>
        <div className="flex-1" />
        <BuscadorComandos ref={buscador} comandos={comandos} />
        <button onClick={ejecutarCalculo} disabled={calculando} title={validacion.errores[0] || "Calcular estructura (Ctrl+Enter)"}
          className="flex h-8 shrink-0 items-center gap-2 rounded-md bg-teal px-3 text-sm font-semibold text-white hover:bg-teal-dark disabled:opacity-60">
          {calculando ? "Calculando…" : "▶ Calcular estructura"}
        </button>
        <div className="mx-1 h-6 w-px bg-slate-200 dark:bg-ink-line" />
        <div className="flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-ink-3" role="tablist" aria-label="Vistas">
          {VISTAS.map(([id, l]) => (
            <button key={id} role="tab" aria-selected={vista === id} onClick={() => setVista(id)}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[13px] ${vista === id ? "bg-white font-semibold text-teal-dark shadow-sm dark:bg-ink-line dark:text-teal-soft" : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"}`}>
              {l}{id === "resultados" && desactualizado && <span className="ml-1 text-amber-500" title="El modelo cambió después del último cálculo">•</span>}
            </button>
          ))}
        </div>
        <button onClick={() => setTema((t) => (t === "dark" ? "light" : "dark"))} title={tema === "dark" ? "Tema claro" : "Tema oscuro"} aria-label="Cambiar tema"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-ink-3">{tema === "dark" ? "☀" : "☾"}</button>
      </header>
      <input ref={importar} type="file" accept=".json,application/json" className="hidden" onChange={onImportar} />

      {/* ===== cuerpo ===== */}
      <div className="flex min-h-0 flex-1">
        {vista === "modelo" && (
          <>
            <aside className="hidden w-80 shrink-0 flex-col border-r border-slate-200 bg-white md:flex dark:border-ink-line dark:bg-ink-2">
              <div className="flex h-10 shrink-0 items-center gap-2 border-b border-slate-200 px-3 dark:border-ink-line">
                {panel ? (
                  <>
                    <button onClick={() => setPanel(null)} className="rounded-md px-1.5 py-0.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-3" title="Volver al árbol del modelo" aria-label="Volver al árbol del modelo">←</button>
                    <h2 className="truncate text-sm font-semibold">{PANELES[panel]}</h2>
                    <button onClick={() => setPanel(null)} className="ml-auto rounded-md px-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-3" aria-label="Cerrar panel">✕</button>
                  </>
                ) : <h2 className="text-sm font-semibold">Árbol del modelo</h2>}
              </div>
              {panel
                ? <PanelEditor key={panel} panel={panel} modelo={modelo} commit={commit} sel={sel} setSel={setSel} />
                : <Arbol modelo={modelo} sel={sel} setSel={setSel} abrirPanel={abrirPanel} />}
            </aside>

            <main className="relative min-w-0 flex-1 overflow-hidden bg-slate-50 dark:bg-ink">
              <Canvas modelo={modelo} sel={sel} setSel={setSel} tool={tool} commit={commit} beginDrag={beginDrag} moverNudo={moverNudo}
                fitKey={fitKey} capas={capas} snap={snap} onCursor={setCursor} onAgregarNudo={onAgregarNudo} onConectar={onConectar}
                onEliminar={onEliminar} onZoom={setZoom} />
              <BarraHerramientas tool={tool} setTool={setTool} capas={capas} setCapas={setCapas} snap={snap} setSnap={setSnap}
                deshacer={deshacer} rehacer={rehacer} puedeDeshacer={!!hist.past.length} puedeRehacer={!!hist.future.length} />
            </main>

            <div className="hidden lg:flex">
              <Props modelo={modelo} sel={sel} setSel={setSel} commit={commit} abrirPanel={abrirPanel} />
            </div>
          </>
        )}
        {vista === "resultados" && (
          <div className="flex min-h-0 flex-1 flex-col">
            {desactualizado && (
              <div className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                El modelo cambió después de este cálculo; los resultados pueden no corresponder.
                <button onClick={ejecutarCalculo} className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white">Recalcular</button>
              </div>
            )}
            <Results resultado={resultado} error={error} combos={combos} onVolver={() => setVista("modelo")}
              onExportar={(t) => (t === "csv" ? exportarCSV() : exportarMemoria())} />
          </div>
        )}
        {vista === "paso" && <Paso modelo={modelo} onVolver={() => setVista("modelo")} />}
        {vista === "3d" && (
          <Suspense fallback={<div className="m-auto text-sm text-slate-500">Cargando el visor 3D…</div>}>
          <Vista3D modelo={modelo} onAbrirPortico={async (tipo, idx) => {
            const d = await torreModelo(tipo, idx);
            if (!d || d.ok === false) { avisar(d?.error || "No se pudo cargar el pórtico.", "err"); return; }
            cargarModelo({ ...modeloVacio(), ...d });
          }} />
          </Suspense>
        )}
        {vista === "historial" && (
          <Historial confirmar={confirmar} onAbrir={(d) => {
            if (d.datos) cargarModelo({ ...modeloVacio(), ...d.datos }, `Cálculo #${d.id} abierto.`);
            setResultado({ ...d, ...d.resultados }); setModeloCalculado(null); setError(null); setVista("resultados");
          }} />
        )}
      </div>

      {/* ===== barra de estado ===== */}
      <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-slate-200 bg-white px-3 text-[11px] tabular-nums text-slate-600 dark:border-ink-line dark:bg-ink-2 dark:text-slate-300">
        <span>{herramienta?.icon} {herramienta?.label}</span>
        <span>{cursor ? `x = ${cursor.x.toFixed(2)}  y = ${cursor.y.toFixed(2)} ${modelo.unidad_longitud}` : "—"}</span>
        <span>Zoom {zoom.toFixed(0)} px/{modelo.unidad_longitud}</span>
        <span>{modelo.nudos.length} nudos · {modelo.elementos.length} elementos · {modelo.cargas_nodales.length + modelo.cargas_elementos.length} cargas</span>
        <span className="flex-1" />
        {validacion.errores.length > 0 ? (
          <span className="text-rose-600 dark:text-rose-400" title={validacion.errores.join("\n")}>⛔ {validacion.errores[0]}{validacion.errores.length > 1 ? ` (+${validacion.errores.length - 1})` : ""}</span>
        ) : validacion.avisos.length > 0 ? (
          <span className="text-amber-700 dark:text-amber-400" title={validacion.avisos.join("\n")}>⚠ {validacion.avisos.length} aviso{validacion.avisos.length > 1 ? "s" : ""}: {validacion.avisos[0]}</span>
        ) : <span className="text-emerald-700 dark:text-emerald-400">✓ Modelo listo para calcular</span>}
        <span>{guardado ? "Guardado en este navegador" : "Guardando…"}</span>
      </footer>

      {dialogo === "plantillas" && <DialogoPlantillas onCerrar={() => setDialogo(null)} onElegir={(m) => cargarModelo(m)} />}
      {dialogo === "generador" && <DialogoGenerador onCerrar={() => setDialogo(null)} onElegir={(m) => cargarModelo(m)} />}
      {dialogo === "torre" && <DialogoTorre onCerrar={() => setDialogo(null)} onElegir={(m) => cargarModelo({ ...modeloVacio(), ...m })} />}
      {dialogo === "atajos" && <DialogoAtajos onCerrar={() => setDialogo(null)} />}
      {confirmacion && <DialogoConfirmar {...confirmacion} onCerrar={() => setConfirmacion(null)} />}

      {toast && (
        <div key={toast.k} role="status" className={`fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg ${toast.tipo === "err" ? "bg-rose-600" : "bg-slate-800 dark:bg-teal-dark"}`}>
          {toast.texto}
        </div>
      )}
    </div>
  );
}

// Barra flotante del lienzo: herramientas, capas, ajuste y deshacer.
function BarraHerramientas({ tool, setTool, capas, setCapas, snap, setSnap, deshacer, rehacer, puedeDeshacer, puedeRehacer }) {
  const b = (activo) => `grid h-9 w-9 place-items-center rounded-md text-base ${activo ? "bg-teal text-white" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-ink-3"}`;
  return (
    <div className="absolute left-3 top-3 flex flex-col gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow dark:border-ink-line dark:bg-ink-2/95" role="toolbar" aria-label="Herramientas del lienzo">
      {HERRAMIENTAS.map((h) => (
        <button key={h.id} className={b(tool === h.id)} title={`${h.label} (${h.kbd})`} aria-label={h.label} aria-pressed={tool === h.id} onClick={() => setTool(h.id)}>{h.icon}</button>
      ))}
      <div className="my-0.5 border-t border-slate-200 dark:border-ink-line" />
      <button className={b(capas.grilla)} title="Grilla (G)" aria-label="Grilla" aria-pressed={capas.grilla} onClick={() => setCapas((c) => ({ ...c, grilla: !c.grilla }))}>#</button>
      <button className={b(capas.etiquetas)} title="Etiquetas (L)" aria-label="Etiquetas" aria-pressed={capas.etiquetas} onClick={() => setCapas((c) => ({ ...c, etiquetas: !c.etiquetas }))}>A</button>
      <button className={b(capas.cargas)} title="Cargas" aria-label="Cargas" aria-pressed={capas.cargas} onClick={() => setCapas((c) => ({ ...c, cargas: !c.cargas }))}>↓</button>
      <select value={snap} onChange={(e) => setSnap(+e.target.value)} title="Ajuste a la grilla" aria-label="Ajuste a la grilla" className="!h-9 !w-9 cursor-pointer appearance-none !border-0 !bg-transparent !p-0 text-center text-[10px]">
        {SNAPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <div className="my-0.5 border-t border-slate-200 dark:border-ink-line" />
      <button className={b(false) + " disabled:opacity-30"} disabled={!puedeDeshacer} title="Deshacer (Ctrl+Z)" aria-label="Deshacer" onClick={deshacer}>↶</button>
      <button className={b(false) + " disabled:opacity-30"} disabled={!puedeRehacer} title="Rehacer (Ctrl+Y)" aria-label="Rehacer" onClick={rehacer}>↷</button>
    </div>
  );
}
