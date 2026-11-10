import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Canvas, { HERRAMIENTAS } from "./components/Canvas.jsx";
import { Arbol, PANELES, PanelEditor, udlTodasLasVigas } from "./components/Editor.jsx";
import Props from "./components/Props.jsx";
import Results from "./components/Results.jsx";
import Paso from "./components/Paso.jsx";
import Historial from "./components/Historial.jsx";
const Vista3D = lazy(() => import("./components/Vista3D.jsx"));
const Visor2D3D = lazy(() => import("./components/Visor2D3D.jsx"));
const Manual = lazy(() => import("./components/Manual.jsx"));
import { Arbol3D, PANELES3D, PanelEditor3D, Props3D } from "./components/Editor3D.jsx";
import Lienzo3D, { HERR3D } from "./components/Lienzo3D.jsx";
import Results3D from "./components/Results3D.jsx";
import { DialogoCopiar, DialogoEdificio, DialogoExtraer, DialogoExtruir, DialogoInsertar, DialogoUnir } from "./components/Dialogs3D.jsx";
import { a3d, borrarBarra, borrarNudo3d, borrarSeleccion, sumarSel, copiarPlano, es3d, insertarPortico, limpiarNudos, modelo3dVacio, unirPlanos, validar3d } from "./model3d.js";
import Documentos from "./components/Documentos.jsx";
import { registrarPedir } from "./pedir.js";
import MenuMovil from "./components/MenuMovil.jsx";
import { PasoPortico3D } from "./components/PorticoDe3D.jsx";
import { PLANTILLAS } from "./model.js";
import { BuscadorComandos, MenuBar } from "./components/MenuBar.jsx";
import { DialogoAtajos, DialogoPedir, DialogoConfirmar, DialogoGenerador, DialogoPlantillas, DialogoTorre } from "./components/Dialogs.jsx";
import { calcular, calcular3d, combinaciones, extraerPortico, torre3dModelo, torreModelo } from "./api.js";
import { agregarElemento, agregarNudo, borrarElemento, borrarNudo, modeloEjemplo, modeloVacio, nextId } from "./model.js";

const CLAVE = "ae_react_modelo";
const VISTAS = [["modelo", "Modelo"], ["3d", "3D"], ["resultados", "Resultados"], ["paso", "Paso a paso"], ["historial", "Historial"]];
const SNAPS = [[0, "Libre"], [0.05, "0.05 m"], [0.1, "0.10 m"], [0.25, "0.25 m"], [0.5, "0.50 m"], [1, "1.00 m"]];

const CLAVE_PROY = "ae_react_proyecto";
const uid = () => Math.random().toString(36).slice(2, 10);
function proyectoInicial() {
  try { const s = localStorage.getItem(CLAVE_PROY); if (s) { const p = JSON.parse(s); if (p?.docs?.length && p.docs.some((d) => d.id === p.activo)) return p; } } catch { /* sin almacenamiento */ }
  const id = uid();
  return { docs: [{ id, modelo: modeloInicial() }], activo: id };
}

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
  const porN = Object.fromEntries(m.nudos.map((n) => [n.id, n]));
  m.cargas_elementos.forEach((c) => {
    if (!["puntual", "momento"].includes(c.tipo) || c.a == null || c.a === "") return;
    const e = m.elementos.find((x) => x.id === c.elem); if (!e || !porN[e.i] || !porN[e.j]) return;
    const L = Math.hypot(porN[e.j].x - porN[e.i].x, porN[e.j].y - porN[e.i].y);
    if (+c.a < 0 || +c.a > L + 1e-9) errores.push(`La carga ${c.tipo} de ${e.nombre} está en a = ${c.a} m, fuera de la barra (0 a ${L.toFixed(2)} m).`);
  });
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
  const [proyecto, setProyecto] = useState(proyectoInicial);
  const [hist, setHist] = useState(() => ({ past: [], present: proyecto.docs.find((d) => d.id === proyecto.activo).modelo, future: [], pl: [], fl: [] }));
  const modelo = hist.present;
  // pl / fl: nombre de cada paso del historial (para la lista «Historial de cambios»)
  const commit = useCallback((fn, etiqueta) => setHist((h) => {
    const m = structuredClone(h.present); fn(m);
    return { past: [...h.past.slice(-99), h.present], present: m, future: [], pl: [...(h.pl || []).slice(-99), etiqueta || describirCambio(h.present, m)], fl: [] };
  }), []);
  const [fitKey, setFitKey] = useState(0);
  const reemplazar = useCallback((m) => {
    setHist((h) => ({ past: [...h.past.slice(-99), h.present], present: m, future: [], pl: [...(h.pl || []).slice(-99), "Reemplazar modelo"], fl: [] }));
    setSel(null); setFitKey((k) => k + 1);
  }, []);
  const deshacer = useCallback((n = 1) => setHist((h) => {
    let x = h;
    for (let k = 0; k < (+n || 1) && x.past.length; k++) {
      const pl = x.pl || [], et = pl[pl.length - 1] || "Cambio";
      x = { past: x.past.slice(0, -1), present: x.past[x.past.length - 1], future: [x.present, ...x.future], pl: pl.slice(0, -1), fl: [et, ...(x.fl || [])] };
    }
    return x;
  }), []);
  const rehacer = useCallback((n = 1) => setHist((h) => {
    let x = h;
    for (let k = 0; k < (+n || 1) && x.future.length; k++) {
      const fl = x.fl || [];
      x = { past: [...x.past, x.present], present: x.future[0], future: x.future.slice(1), pl: [...(x.pl || []), fl[0] || "Cambio"], fl: fl.slice(1) };
    }
    return x;
  }), []);
  const beginDrag = useCallback(() => setHist((h) => ({ past: [...h.past.slice(-99), h.present], present: h.present, future: [], pl: [...(h.pl || []).slice(-99), "Mover nudo"], fl: [] })), []);
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
  const [pregunta, setPregunta] = useState(null);
  useEffect(() => { registrarPedir(setPregunta); }, []);
  const [toast, setToast] = useState(null);
  const [tema, setTema] = useState(() => { try { return localStorage.getItem("ae_tema") || "dark"; } catch { return "dark"; } });
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  const [calculando, setCalculando] = useState(false);
  const [modeloCalculado, setModeloCalculado] = useState(null);
  const [combos, setCombos] = useState(null);
  const [guardado, setGuardado] = useState(true);
  const [res3d, setRes3d] = useState(null);
  const [err3d, setErr3d] = useState(null);
  const [vista3d, setVista3d] = useState({ modo: "3d" });
  const [ver3d, setVer3d] = useState(false);              // pórtico 2D visto en 3D
  const [paso3d, setPaso3d] = useState(null);             // pórtico del 3D elegido para el paso a paso
  const resRef = useRef({});                              // resultados guardados por documento
  const [menuMovil, setMenuMovil] = useState(false);
  const [arbolMovil, setArbolMovil] = useState(false);     // panel izquierdo en pantallas chicas
  useEffect(() => { if (sel && window.innerWidth < 768) setArbolMovil(false); }, [sel]);
  const tridim = es3d(modelo);
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
    setProyecto((p) => ({ ...p, docs: p.docs.map((d) => (d.id === p.activo ? { ...d, modelo } : d)) }));
  }, [modelo]);
  useEffect(() => {
    setGuardado(false);
    const t = setTimeout(() => { try { localStorage.setItem(CLAVE_PROY, JSON.stringify(proyecto)); setGuardado(true); } catch { /* lleno o bloqueado */ } }, 500);
    return () => clearTimeout(t);
  }, [proyecto]);

  // si la selección deja de existir (deshacer, borrar), se limpia
  useEffect(() => {
    if (!sel) return;
    if (sel.tipo === "varios") {
      const elems = sel.elems.filter((id) => modelo.elementos.some((e) => e.id === id)), nudos = sel.nudos.filter((id) => modelo.nudos.some((n) => n.id === id));
      if (elems.length !== sel.elems.length || nudos.length !== sel.nudos.length) setSel(sumarSel(null, { tipo: "varios", elems, nudos }, false));
      return;
    }
    const existe = sel.tipo === "nudo" ? modelo.nudos.some((n) => n.id === sel.id) : modelo.elementos.some((e) => e.id === sel.id);
    if (!existe) setSel(null);
  }, [modelo, sel]);

  const validacion = useMemo(() => (tridim ? validar3d(modelo) : validar(modelo)), [modelo, tridim]);
  const desactualizado = (tridim ? res3d : resultado) && modeloCalculado !== modelo;

  // ---------- acciones ----------
  const ejecutarCalculo = useCallback(async () => {
    if (validacion.errores.length) { avisar(validacion.errores[0], "err"); return; }
    setCalculando(true); setError(null);
    if (tridim) {
      setErr3d(null);
      try {
        const { ok, data } = await calcular3d(modelo);
        if (!ok || !data.ok) { setErr3d(data.error || "No se pudo calcular el modelo 3D"); setRes3d(null); }
        else { setRes3d(data); setModeloCalculado(modelo); avisar(`Modelo 3D resuelto: ${data.resumen.n_resuelto} GDL en ${data.resumen.t_total} s.`); }
        setVista("resultados");
      } catch (e) { setErr3d("No hay conexión con el servidor de cálculo: " + e); setVista("resultados"); }
      finally { setCalculando(false); }
      return;
    }
    try {
      const { ok, data } = await calcular(modelo);
      if (!ok || !data.ok) { setError(data.error || "No se pudo calcular"); setResultado(null); }
      else { setResultado({ ...data, ...data.resultados }); setModeloCalculado(modelo); }
      setVista("resultados");
    } catch (e) { setError("No hay conexión con el servidor de cálculo: " + e); setVista("resultados"); }
    finally { setCalculando(false); }
  }, [modelo, validacion, avisar, tridim]);

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
    if (es3d(modelo)) commit((m) => borrarSeleccion(m, sel), sel.tipo === "varios" ? `Eliminar ${sel.elems.length + sel.nudos.length} objetos` : undefined);
    else commit((m) => (sel.tipo === "nudo" ? borrarNudo(m, sel.id) : borrarElemento(m, sel.id)));
    setSel(null);
  }, [sel, commit, modelo]);

  const abrirPanel = useCallback((p) => { setPanel(p); setVista("modelo"); }, []);
  const confirmar = useCallback((c) => setConfirmacion(c), []);

  const exportarJSON = () => { descargar(`${archivo(modelo)}.json`, JSON.stringify(modelo, null, 2)); avisar("Modelo exportado como JSON."); };
  const onImportar = (ev) => {
    const f = ev.target.files?.[0]; ev.target.value = "";
    if (!f) return;
    f.text().then((t) => {
      const m = JSON.parse(t);
      if (!Array.isArray(m.nudos) || !Array.isArray(m.elementos)) throw new Error("no tiene nudos y elementos");
      abrirDoc(m.tipo === "3d" ? m : { ...modeloVacio(), ...m }, `«${m.nombre || f.name}» importado como documento nuevo: ${m.nudos.length} nudos, ${m.elementos.length} elementos.`);
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
  // ---------- documentos del proyecto (pórticos 2D y modelos 3D abiertos a la vez) ----------
  const guardarRes = () => { resRef.current[proyecto.activo] = { resultado, error, combos, res3d, err3d, modeloCalculado }; };
  const restaurarRes = (id) => {
    const r = resRef.current[id] || {};
    setResultado(r.resultado || null); setError(r.error || null); setCombos(r.combos || null);
    setRes3d(r.res3d || null); setErr3d(r.err3d || null); setModeloCalculado(r.modeloCalculado || null);
  };
  const prepararVista = () => { setSel(null); setPanel(null); setDialogo(null); setVer3d(false); setVista3d({ modo: "3d" }); setPaso3d(null); setFitKey((k) => k + 1); setTool("select"); };
  const cambiarDoc = (id) => {
    if (id === proyecto.activo) return;
    const d = proyecto.docs.find((x) => x.id === id); if (!d) return;
    guardarRes();
    setProyecto((p) => ({ ...p, activo: id }));
    setHist({ past: [], present: d.modelo, future: [] });
    restaurarRes(id); prepararVista();
    if (vista === "historial") setVista("modelo");
  };
  const abrirDoc = (m0, msg) => {
    const id = uid();
    const usados = new Set(proyecto.docs.map((d) => d.modelo?.nombre));
    let m = m0;
    if (usados.has(m0.nombre)) { let k = 2; while (usados.has(`${m0.nombre} (${k})`)) k++; m = { ...m0, nombre: `${m0.nombre} (${k})` }; }
    guardarRes();
    setProyecto((p) => ({ docs: [...p.docs, { id, modelo: m }], activo: id }));
    setHist({ past: [], present: m, future: [] });
    restaurarRes(id); prepararVista(); setVista("modelo");
    avisar(msg || `«${m.nombre}» abierto como documento nuevo: ${m.nudos.length} nudos, ${m.elementos.length} elementos.`);
    return id;
  };
  const modificarDoc = (id, fn, msg) => {
    const d = proyecto.docs.find((x) => x.id === id); if (!d) return;
    const m = structuredClone(d.modelo); fn(m);
    guardarRes();
    setProyecto((p) => ({ ...p, docs: p.docs.map((x) => (x.id === id ? { ...x, modelo: m } : x)), activo: id }));
    setHist({ past: [d.modelo], present: m, future: [] });
    restaurarRes(id); prepararVista(); setVista("modelo");
    if (msg) avisar(msg);
  };
  const cerrarDoc = (id) => {
    const d = proyecto.docs.find((x) => x.id === id);
    confirmar({ titulo: "Cerrar documento", texto: `Se cerrará «${d?.modelo?.nombre}». Si no lo exportaste (Ctrl+S), se pierde.`, accion: "Cerrar", peligro: true, onAceptar: () => {
      const resto = proyecto.docs.filter((x) => x.id !== id);
      delete resRef.current[id];
      if (id === proyecto.activo) {
        const sig = resto[resto.length - 1];
        setProyecto({ docs: resto, activo: sig.id });
        setHist({ past: [], present: sig.modelo, future: [] });
        restaurarRes(sig.id); prepararVista();
      } else setProyecto((p) => ({ ...p, docs: p.docs.filter((x) => x.id !== id) }));
    } });
  };
  // Convierte el documento 2D actual en un modelo 3D (Ctrl+Z vuelve al 2D) y abre la planta para dibujar.
  const pasarA3d = () => {
    if (tridim) return;
    const m3 = a3d(modelo);
    reemplazar(m3);
    const zs = m3.niveles.map((n) => n.z);
    setVer3d(false); setPanel(null); setVista("modelo");
    setVista3d({ modo: "planta", z: Math.max(...zs), eje: "x", c: 0 });
    setTool("barra");
    avisar("Ahora es un modelo 3D: dibuja en planta con Barra (B) haciendo clic de punto a punto. Ctrl+Z vuelve al 2D.");
  };
  const nuevoModelo = () => abrirDoc(modeloVacio(), "Pórtico 2D nuevo (documento aparte; los demás siguen abiertos).");
  const cargarModelo = (m, msg) => abrirDoc(m, msg);
  const docs2d = proyecto.docs.filter((d) => !es3d(d.modelo));
  const docs3d = proyecto.docs.filter((d) => es3d(d.modelo));
  const fuentesPortico = [
    ...docs2d.filter((d) => d.id !== proyecto.activo || !tridim).map((d) => ({ id: d.id, nombre: `Documento: ${d.modelo.nombre}`, modelo: d.modelo })),
    ...PLANTILLAS.map((pl) => ({ id: `pl:${pl.id}`, nombre: `Plantilla: ${pl.nombre}`, modelo: pl.crear() })),
  ];
  const insertarEnActual = ({ m2, opciones }) => {
    const prueba = insertarPortico(structuredClone(modelo), m2, opciones);
    commit((m) => { insertarPortico(m, m2, opciones); });
    setDialogo(null);
    avisar(`Pórtico «${m2.nombre}» insertado: ${prueba.barras} ${prueba.barras === 1 ? "barra nueva" : "barras nuevas"}${prueba.omitidas ? ` (${prueba.omitidas} ${prueba.omitidas === 1 ? "carga no se trasladó" : "cargas no se trasladaron"})` : ""}.`);
  };
  const insertarDesde2d = ({ destino, opciones }) => {
    if (destino === "nuevo") {
      const m3 = modelo3dVacio(`Modelo 3D de ${modelo.nombre}`);
      m3.ejes = { x: [], y: [] }; m3.niveles = [{ nombre: "Base", z: 0 }];
      m3.secciones = []; m3.materiales = [];
      const r = insertarPortico(m3, modelo, opciones);
      m3.material = m3.materiales[0]?.nombre;
      m3.secc_col = modelo.secciones[0]?.nombre; m3.secc_viga = modelo.secciones[modelo.secciones.length - 1]?.nombre;
      abrirDoc(m3, `Modelo 3D creado con «${modelo.nombre}» (${r.barras} barras). Inserta más pórticos desde Dibujar › Insertar pórtico 2D.`);
    } else {
      modificarDoc(destino, (m) => { insertarPortico(m, modelo, opciones); }, `«${modelo.nombre}» insertado en el modelo 3D. El pórtico 2D sigue abierto como documento.`);
    }
  };

  async function abrirTorre3d() {
    avisar("Cargando la torre (1 485 nudos, 3 810 barras)…");
    try { cargarModelo(await torre3dModelo(), "Torre de Arequipa cargada como modelo 3D. Pulsa Calcular estructura para el análisis espacial."); }
    catch (e) { avisar("No se pudo cargar la torre: " + e, "err"); }
  }
  async function extraer(eje, valor, factores) {
    const { ok, data } = await extraerPortico(modelo, eje, valor, factores);
    if (!ok || data.ok === false) { avisar(data.error || "No se pudo extraer el pórtico.", "err"); return; }
    abrirDoc({ ...modeloVacio(), ...data }, `${data.nombre} abierto como documento 2D. El modelo 3D sigue abierto en el selector de documentos.`);
  }

  // ---------- menús (también alimentan el buscador de comandos) ----------
  const menus = [
    { id: "archivo", label: "Archivo", items: [
      { id: "nuevo", label: "Nuevo pórtico 2D", accion: nuevoModelo, claves: "modelo documento" },
      ...proyecto.docs.filter((d) => d.id !== proyecto.activo).map((d) => ({ id: `doc-${d.id}`, label: `Ir a: ${d.modelo.nombre} (${es3d(d.modelo) ? "3D" : "2D"})`, accion: () => cambiarDoc(d.id), claves: "documento cambiar abrir" })),
      { id: "plantillas", label: "Plantillas (EJ 1, EJ 2, …)…", accion: () => setDialogo("plantillas"), claves: "ejemplo ejercicio" },
      { id: "generar", label: "Generar pórtico regular…", accion: () => setDialogo("generador"), claves: "pisos vanos" },
      { id: "torre", label: "Torre de Arequipa (pórtico 2D)…", accion: () => setDialogo("torre"), claves: "edificio portico eje" },
      "sep",
      { id: "nuevo3d", label: "Nuevo modelo 3D (edificio en grilla)…", accion: () => setDialogo("edificio"), claves: "tridimensional espacial" },
      { id: "insertar2d", label: "Insertar este pórtico en un modelo 3D…", accion: () => setDialogo("insertar2d"), disabled: tridim, claves: "rotar girar armar unir portico 3d" },
      { id: "extruir", label: "Convertir este pórtico 2D en 3D (repetirlo en Y)…", accion: () => setDialogo("extruir"), disabled: tridim, claves: "extruir tridimensional" },
      { id: "extraer", label: "Extraer un pórtico 3D al editor 2D…", accion: () => setDialogo("extraer"), disabled: !tridim, claves: "portico plano eje" },
      { id: "torre3d", label: "Torre de Arequipa (modelo 3D completo)", accion: abrirTorre3d, claves: "edificio tridimensional" },
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
    { id: "definir", label: "Definir", items: tridim ? [
      { id: "p3-proyecto", label: "Proyecto y opciones…", accion: () => abrirPanel("proyecto") },
      { id: "p3-ejes", label: "Ejes y niveles…", accion: () => abrirPanel("ejes"), claves: "grilla pisos" },
      { id: "p3-material", label: "Materiales…", accion: () => abrirPanel("material") },
      { id: "p3-secciones", label: "Secciones…", accion: () => abrirPanel("secciones"), claves: "viga columna placa" },
    ] : [
      { id: "p-proyecto", label: "Proyecto y unidades…", accion: () => abrirPanel("proyecto") },
      { id: "p-material", label: "Materiales…", accion: () => abrirPanel("material"), claves: "concreto fc modulo elasticidad" },
      { id: "p-secciones", label: "Secciones…", accion: () => abrirPanel("secciones"), claves: "viga columna placa" },
      { id: "p-casos", label: "Casos de carga y combinaciones…", accion: () => abrirPanel("casos"), claves: "cm cv cs envolvente" },
    ] },
    { id: "dibujar", label: "Dibujar", items: tridim ? [
      ...HERR3D.map((h) => ({ id: `t3-${h.id}`, label: h.label, atajo: h.kbd, icono: h.icon, check: tool === h.id, accion: () => { setTool(h.id); setVista("modelo"); } })),
      "sep",
      { id: "insertar3d", label: "Insertar pórtico 2D (en X, en Y o con ángulo)…", accion: () => setDialogo("insertar3d"), claves: "armar portico rotar girar agregar" },
      { id: "unir", label: "Unir pórticos con vigas…", accion: () => setDialogo("unir"), claves: "conectar vigas transversales" },
      { id: "copiar", label: "Copiar un pórtico a otro eje…", accion: () => setDialogo("copiar"), claves: "replicar repetir" },
      "sep",
      { id: "v3-3d", label: "Vista 3D", check: vista3d.modo === "3d", accion: () => { setVista3d((v) => ({ ...v, modo: "3d" })); setVista("modelo"); } },
      { id: "v3-planta", label: "Vista en planta", check: vista3d.modo === "planta", accion: () => { setVista3d((v) => ({ ...v, modo: "planta", z: v.z ?? Math.max(...modelo.niveles.map((n) => n.z)) })); setVista("modelo"); } },
      { id: "v3-elev", label: "Vista en elevación", check: vista3d.modo === "elevacion", accion: () => { setVista3d((v) => ({ ...v, modo: "elevacion", eje: v.eje || "x", c: v.c ?? modelo.ejes?.y?.[0]?.c ?? 0 })); setVista("modelo"); } },
    ] : [
      { id: "a3d", label: "Dibujar en 3D (convertir a modelo 3D y seguir dibujando)", accion: pasarA3d, claves: "cuadrado conectar unir vigas planta 3d" },
      { id: "t-3d", label: ver3d ? "Volver al dibujo 2D" : "Ver el pórtico en 3D (girar)", accion: () => { setVer3d((v) => !v); setVista("modelo"); }, claves: "rotar orbitar" },
      "sep",
      ...HERRAMIENTAS.map((h) => ({ id: `t-${h.id}`, label: h.label, atajo: h.kbd, icono: h.icon, check: tool === h.id, accion: () => { setTool(h.id); setVista("modelo"); } })),
      "sep",
      { id: "p-nudos", label: "Tabla de nudos…", accion: () => abrirPanel("nudos") },
      { id: "p-elementos", label: "Tabla de elementos…", accion: () => abrirPanel("elementos"), claves: "barras" },
    ] },
    { id: "asignar", label: "Asignar", items: tridim ? [
      { id: "p3-cargas", label: "Cargas (losa, barras y nudos)…", accion: () => abrirPanel("cargas"), claves: "cm cv losa" },
      { id: "p3-sismo", label: "Sismo E.030…", accion: () => abrirPanel("sismo"), claves: "sismico deriva" },
      { id: "p3-combos", label: "Combinaciones…", accion: () => abrirPanel("combinaciones") },
      "sep",
      { id: "limpiar", label: "Limpiar nudos sueltos", accion: () => commit(limpiarNudos) },
    ] : [
      { id: "p-cnudos", label: "Cargas en nudos…", accion: () => abrirPanel("cargas_nudos"), claves: "fuerza puntual" },
      { id: "p-celems", label: "Cargas en elementos…", accion: () => abrirPanel("cargas_elementos"), claves: "distribuida uniforme trapezoidal" },
      { id: "udl", label: "UDL a todas las vigas…", accion: () => udlTodasLasVigas(commit), disabled: !modelo.elementos.length },
      "sep",
      { id: "empotrar", label: "Empotrar los nudos de la base", accion: () => apoyarBase("empotrado"), disabled: !modelo.nudos.length, claves: "apoyo" },
      { id: "articular", label: "Articular los nudos de la base", accion: () => apoyarBase("fijo"), disabled: !modelo.nudos.length, claves: "apoyo" },
    ] },
    { id: "analizar", label: "Analizar", items: [
      { id: "calcular", label: "Calcular estructura", atajo: "Ctrl+Enter", accion: ejecutarCalculo, claves: "resolver correr" },
      { id: "combos", label: "Calcular combinaciones y envolventes", accion: ejecutarCombos, disabled: tridim, claves: "casos envolvente cm cv" },
      { id: "pasoapaso", label: "Resolver paso a paso (método [A])", accion: () => setVista("paso"), claves: "sistematizado matriz" },
      { id: "opciones", label: "Opciones de análisis…", accion: () => abrirPanel("proyecto"), claves: "pdelta modal timoshenko" },
    ] },
    { id: "ayuda", label: "Ayuda", items: [
      { id: "atajos", label: "Atajos de teclado", atajo: "?", accion: () => setDialogo("atajos") },
      { id: "manual", label: "Manual de uso", atajo: "F1", accion: () => setVista("manual"), claves: "ayuda guia tutorial explicacion" },
    ] },
  ];
  const comandos = menus.flatMap((m) => m.items.filter((i) => i !== "sep").map((i) => ({ ...i, grupo: m.label })));

  // ---------- teclado ----------
  const teclas = useRef({});
  teclas.current = { ejecutarCalculo, deshacer, rehacer, borrarSel, exportarJSON, sel, tool, vista, tridim };
  useEffect(() => {
    const h = (e) => {
      const t = teclas.current;
      const enCampo = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "Enter") { e.preventDefault(); t.ejecutarCalculo(); return; }
      if (e.key === "F1") { e.preventDefault(); setVista("manual"); return; }
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
      const herr = (t.tridim ? HERR3D : HERRAMIENTAS).find((x) => x.kbd.toLowerCase() === e.key.toLowerCase());
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

  const herramienta = (tridim ? HERR3D : HERRAMIENTAS).find((h) => h.id === tool);
  useEffect(() => { if (!(tridim ? HERR3D : HERRAMIENTAS).some((h) => h.id === tool)) setTool("select"); }, [tridim, tool]);

  return (
    <div className="flex h-full flex-col bg-slate-50 text-slate-900 dark:bg-ink dark:text-slate-100">
      {/* ===== cabecera única ===== */}
      <header className="flex h-12 min-w-0 shrink-0 items-center gap-1.5 border-b border-slate-200 bg-white px-3 dark:border-ink-line dark:bg-ink-2">
        <div className="flex shrink-0 items-center gap-2 pr-1">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-teal text-xs font-bold text-white">AE</span>
          <span className="hidden text-sm font-semibold 2xl:inline">Análisis Estructural</span>
        </div>
        <Documentos docs={proyecto.docs} activo={proyecto.activo} onCambiar={cambiarDoc} onCerrar={cerrarDoc} onNuevo2d={nuevoModelo} onNuevo3d={() => setDialogo("edificio")} />
        <div className="hidden lg:block"><MenuBar menus={menus} /></div>
        <div className="flex-1" />
        <div className="hidden xl:block"><BuscadorComandos ref={buscador} comandos={comandos} /></div>
        <button onClick={ejecutarCalculo} disabled={calculando} title={validacion.errores[0] || "Calcular estructura (Ctrl+Enter)"}
          className="flex h-8 shrink-0 items-center gap-2 rounded-md bg-teal px-3 text-sm font-semibold text-white hover:bg-teal-dark disabled:opacity-60">
          {calculando ? "…" : <>▶ <span className="hidden 2xl:inline">Calcular estructura</span><span className="hidden sm:inline 2xl:hidden">Calcular</span></>}
        </button>
        <div className="mx-0.5 hidden h-6 w-px bg-slate-200 xl:block dark:bg-ink-line" />
        <div className="hidden shrink-0 rounded-lg bg-slate-100 p-0.5 xl:flex dark:bg-ink-3" role="tablist" aria-label="Vistas">
          {VISTAS.map(([id, l]) => (
            <button key={id} role="tab" aria-selected={vista === id} onClick={() => setVista(id)}
              className={`whitespace-nowrap rounded-md px-1.5 py-1 text-[12px] 2xl:px-2 2xl:text-[13px] ${vista === id ? "bg-white font-semibold text-teal-dark shadow-sm dark:bg-ink-line dark:text-teal-soft" : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"}`}>
              {l}{id === "resultados" && desactualizado && <span className="ml-1 text-amber-500" title="El modelo cambió después del último cálculo">•</span>}
            </button>
          ))}
        </div>
        <button onClick={() => setTema((t) => (t === "dark" ? "light" : "dark"))} title={tema === "dark" ? "Tema claro" : "Tema oscuro"} aria-label="Cambiar tema"
          className="hidden h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-slate-100 xl:grid dark:hover:bg-ink-3">{tema === "dark" ? "☀" : "☾"}</button>
        <button onClick={() => setMenuMovil(true)} aria-label="Abrir menú" className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 xl:hidden dark:border-ink-line">☰</button>
      </header>
      <MenuMovil abierto={menuMovil} onCerrar={() => setMenuMovil(false)} menus={menus} comandos={comandos} vistas={VISTAS} vista={vista} setVista={setVista} tema={tema} setTema={setTema} />
      <input ref={importar} type="file" accept=".json,application/json" className="hidden" onChange={onImportar} />

      {/* ===== cuerpo ===== */}
      <div className="flex min-h-0 flex-1">
        {vista === "modelo" && tridim && (
          <>
            <aside className={`${arbolMovil ? "fixed inset-y-0 left-0 z-40 flex w-[86vw] max-w-sm shadow-2xl" : "hidden"} shrink-0 flex-col border-r border-slate-200 bg-white md:static md:z-auto md:flex md:w-80 md:max-w-none md:shadow-none dark:border-ink-line dark:bg-ink-2`}>
              <button onClick={() => setArbolMovil(false)} className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-md border border-slate-200 bg-white md:hidden dark:border-ink-line dark:bg-ink-2" aria-label="Cerrar panel">✕</button>
              <div className="flex h-10 shrink-0 items-center gap-2 border-b border-slate-200 px-3 dark:border-ink-line">
                {panel ? (<>
                  <button onClick={() => setPanel(null)} className="rounded-md px-1.5 py-0.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-3" aria-label="Volver al árbol del modelo">←</button>
                  <h2 className="truncate text-sm font-semibold">{PANELES3D[panel]}</h2>
                  <button onClick={() => setPanel(null)} className="ml-auto rounded-md px-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-3" aria-label="Cerrar panel">✕</button>
                </>) : <h2 className="text-sm font-semibold">Árbol del modelo 3D</h2>}
              </div>
              {panel && PANELES3D[panel]
                ? <PanelEditor3D key={panel} panel={panel} modelo={modelo} commit={commit} sel={sel} setSel={setSel} />
                : <Arbol3D modelo={modelo} sel={sel} setSel={setSel} abrirPanel={abrirPanel} irA={(v) => setVista3d((x) => ({ ...x, ...v }))} />}
            </aside>
            <main className="relative min-w-0 flex-1 overflow-hidden bg-slate-50 dark:bg-ink">
              <Lienzo3D modelo={modelo} commit={commit} sel={sel} setSel={setSel} tool={tool} setTool={setTool} vista={vista3d} setVista={setVista3d} avisar={avisar} ajusteKey={fitKey} />
              <BarraHerramientas3D tool={tool} setTool={setTool} deshacer={deshacer} rehacer={rehacer} puedeDeshacer={!!hist.past.length} puedeRehacer={!!hist.future.length} modo3d={vista3d.modo === "3d"} pasado={hist.pl || []} futuro={hist.fl || []} />
            </main>
            <div className={`${sel ? "fixed inset-x-0 bottom-0 z-30 flex max-h-[55vh] shadow-2xl" : "hidden"} lg:static lg:z-auto lg:flex lg:max-h-none lg:shadow-none`}>
              <Props3D modelo={modelo} sel={sel} setSel={setSel} commit={commit} abrirPanel={abrirPanel} />
            </div>
          </>
        )}
        {vista === "modelo" && !tridim && (
          <>
            <aside className={`${arbolMovil ? "fixed inset-y-0 left-0 z-40 flex w-[86vw] max-w-sm shadow-2xl" : "hidden"} shrink-0 flex-col border-r border-slate-200 bg-white md:static md:z-auto md:flex md:w-80 md:max-w-none md:shadow-none dark:border-ink-line dark:bg-ink-2`}>
              <button onClick={() => setArbolMovil(false)} className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-md border border-slate-200 bg-white md:hidden dark:border-ink-line dark:bg-ink-2" aria-label="Cerrar panel">✕</button>
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
              {ver3d ? (
                <Suspense fallback={<div className="p-6 text-sm text-slate-500">Cargando el visor 3D…</div>}>
                  <Visor2D3D modelo={modelo} sel={sel} setSel={setSel} />
                </Suspense>
              ) : (
                <Canvas modelo={modelo} sel={sel} setSel={setSel} tool={tool} commit={commit} beginDrag={beginDrag} moverNudo={moverNudo}
                  fitKey={fitKey} capas={capas} snap={snap} onCursor={setCursor} onAgregarNudo={onAgregarNudo} onConectar={onConectar}
                  onEliminar={onEliminar} onZoom={setZoom} />
              )}
              {!ver3d && <BarraHerramientas tool={tool} setTool={setTool} capas={capas} setCapas={setCapas} snap={snap} setSnap={setSnap}
                deshacer={deshacer} rehacer={rehacer} puedeDeshacer={!!hist.past.length} puedeRehacer={!!hist.future.length} />}
              <button onClick={pasarA3d} title="Convierte este pórtico en un modelo 3D para dibujar fuera del plano (vigas en planta, otros pórticos…). Ctrl+Z vuelve al 2D."
                className="absolute right-32 top-3 rounded-lg bg-teal px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-teal-dark">✎ Dibujar en 3D</button>
              <div className="absolute right-3 top-3 flex rounded-lg border border-slate-200 bg-white/95 p-0.5 text-xs shadow dark:border-ink-line dark:bg-ink-2/95" role="tablist" aria-label="Dibujo 2D o vista 3D">
                {[[false, "2D"], [true, "3D"]].map(([v, l]) => (
                  <button key={l} role="tab" aria-selected={ver3d === v} onClick={() => setVer3d(v)} className={`rounded-md px-3 py-1 ${ver3d === v ? "bg-teal font-semibold text-white" : ""}`}>{l}</button>
                ))}
              </div>
              {ver3d && <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-white/90 px-2 py-1 text-[11px] text-slate-600 shadow dark:bg-ink-2/90 dark:text-slate-300">Arrastrar: girar · clic derecho: desplazar · rueda: zoom · para dibujar fuera del plano pulsa «Dibujar en 3D»</div>}
            </main>

            <div className={`${sel ? "fixed inset-x-0 bottom-0 z-30 flex max-h-[55vh] shadow-2xl" : "hidden"} lg:static lg:z-auto lg:flex lg:max-h-none lg:shadow-none`}>
              <Props modelo={modelo} sel={sel} setSel={setSel} commit={commit} abrirPanel={abrirPanel} />
            </div>
          </>
        )}
        {vista === "resultados" && tridim && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {desactualizado && (
              <div className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                El modelo cambió después de este cálculo; los resultados pueden no corresponder.
                <button onClick={ejecutarCalculo} className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white">Recalcular</button>
              </div>
            )}
            <Results3D key={res3d?.resumen?.t_total} modelo={modeloCalculado && es3d(modeloCalculado) ? modeloCalculado : modelo} res={res3d} error={err3d} onVolver={() => setVista("modelo")} onExtraer={extraer} onPaso={(eje, c) => { setPaso3d({ eje, c }); setVista("paso"); }} />
          </div>
        )}
        {vista === "resultados" && !tridim && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {desactualizado && (
              <div className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                El modelo cambió después de este cálculo; los resultados pueden no corresponder.
                <button onClick={ejecutarCalculo} className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white">Recalcular</button>
              </div>
            )}
            <Results resultado={resultado} error={error} combos={combos} modelo={modeloCalculado || modelo} onVolver={() => setVista("modelo")}
              onExportar={(t) => (t === "csv" ? exportarCSV() : exportarMemoria())} />
          </div>
        )}
        {vista === "paso" && !tridim && <Paso modelo={modelo} onVolver={() => setVista("modelo")} />}
        {vista === "paso" && tridim && <PasoPortico3D key={proyecto.activo} modelo={modelo} inicial={paso3d} onVolver={() => setVista("modelo")} />}
        {vista === "3d" && (
          <Suspense fallback={<div className="m-auto text-sm text-slate-500">Cargando el visor 3D…</div>}>
          <Vista3D modelo={modelo} onAbrirTorre3d={abrirTorre3d} onAbrirPortico={async (tipo, idx) => {
            const d = await torreModelo(tipo, idx);
            if (!d || d.ok === false) { avisar(d?.error || "No se pudo cargar el pórtico.", "err"); return; }
            cargarModelo({ ...modeloVacio(), ...d });
          }} />
          </Suspense>
        )}
        {vista === "manual" && (
          <Suspense fallback={<div className="m-auto text-sm text-slate-500">Cargando el manual…</div>}>
            <Manual onVolver={() => setVista("modelo")} />
          </Suspense>
        )}
        {vista === "historial" && (
          <Historial confirmar={confirmar} onAbrir={(d) => {
            if (d.datos) cargarModelo({ ...modeloVacio(), ...d.datos }, `Cálculo #${d.id} abierto.`);
            setResultado({ ...d, ...d.resultados }); setModeloCalculado(null); setError(null); setVista("resultados");
          }} />
        )}
      </div>

      {vista === "modelo" && !arbolMovil && (
        <button onClick={() => setArbolMovil(true)} className="fixed bottom-10 left-3 z-20 rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white shadow-lg md:hidden">☰ Árbol y paneles</button>
      )}
      {/* ===== barra de estado ===== */}
      <footer className="flex h-7 shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap border-t border-slate-200 bg-white px-3 text-[11px] tabular-nums text-slate-600 dark:border-ink-line dark:bg-ink-2 dark:text-slate-300">
        <span className="hidden sm:inline">{herramienta?.icon} {herramienta?.label}</span>
        <span className={tridim ? "hidden" : "hidden md:inline"}>{cursor ? `x = ${cursor.x.toFixed(2)}  y = ${cursor.y.toFixed(2)} ${modelo.unidad_longitud}` : "—"}</span>
        <span className={tridim ? "hidden" : "hidden md:inline"}>Zoom {zoom.toFixed(0)} px/{modelo.unidad_longitud}</span>
        <span className="hidden lg:inline">{tridim ? `Modelo 3D · ${modelo.nudos.length} nudos · ${modelo.elementos.length} barras · ${modelo.niveles.length} niveles` : `${modelo.nudos.length} nudos · ${modelo.elementos.length} elementos · ${modelo.cargas_nodales.length + modelo.cargas_elementos.length} cargas`}</span>
        <span className="flex-1" />
        {validacion.errores.length > 0 ? (
          <span className="text-rose-600 dark:text-rose-400" title={validacion.errores.join("\n")}>⛔ {validacion.errores[0]}{validacion.errores.length > 1 ? ` (+${validacion.errores.length - 1})` : ""}</span>
        ) : validacion.avisos.length > 0 ? (
          <span className="text-amber-700 dark:text-amber-400" title={validacion.avisos.join("\n")}>⚠ {validacion.avisos.length} aviso{validacion.avisos.length > 1 ? "s" : ""}: {validacion.avisos[0]}</span>
        ) : <span className="text-emerald-700 dark:text-emerald-400">✓ Modelo listo para calcular</span>}
        <span className="hidden sm:inline">{guardado ? "Guardado en este navegador" : "Guardando…"}</span>
      </footer>

      {dialogo === "plantillas" && <DialogoPlantillas onCerrar={() => setDialogo(null)} onElegir={(m) => cargarModelo(m)} />}
      {dialogo === "generador" && <DialogoGenerador onCerrar={() => setDialogo(null)} onElegir={(m) => cargarModelo(m)} />}
      {dialogo === "torre" && <DialogoTorre onCerrar={() => setDialogo(null)} onElegir={(m) => cargarModelo({ ...modeloVacio(), ...m })} />}
      {dialogo === "atajos" && <DialogoAtajos onCerrar={() => setDialogo(null)} />}
      {dialogo === "edificio" && <DialogoEdificio onCerrar={() => setDialogo(null)} onElegir={(m) => cargarModelo(m, `Modelo 3D «${m.nombre}» creado: ${m.nudos.length} nudos, ${m.elementos.length} barras.`)} />}
      {dialogo === "extruir" && !tridim && <DialogoExtruir modelo={modelo} onCerrar={() => setDialogo(null)} onElegir={(m) => cargarModelo(m, `«${m.nombre}» creado: ${m.nudos.length} nudos, ${m.elementos.length} barras.`)} />}
      {dialogo === "extraer" && tridim && <DialogoExtraer modelo={modelo} onCerrar={() => setDialogo(null)} onElegir={extraer} />}
      {dialogo === "insertar3d" && tridim && <DialogoInsertar fuentes={fuentesPortico} destino3d={modelo} onCerrar={() => setDialogo(null)} onAplicar={insertarEnActual} />}
      {dialogo === "insertar2d" && !tridim && <DialogoInsertar fuenteFija={modelo} destinos={docs3d.map((d) => ({ id: d.id, nombre: d.modelo.nombre, modelo: d.modelo }))} onCerrar={() => setDialogo(null)} onAplicar={insertarDesde2d} />}
      {dialogo === "unir" && tridim && <DialogoUnir modelo={modelo} onCerrar={() => setDialogo(null)} onAplicar={({ dir, c1, c2, todos, sec }) => {
        const pares = todos ? (() => { const l = (dir === "x" ? modelo.ejes.y : modelo.ejes.x).map((e) => e.c).sort((a, b) => a - b); return l.slice(1).map((c, i) => [l[i], c]); })() : [[c1, c2]];
        const prueba = structuredClone(modelo); const n = pares.reduce((t, [a, b]) => t + unirPlanos(prueba, dir, a, b, sec), 0);
        commit((m) => { pares.forEach(([a, b]) => unirPlanos(m, dir, a, b, sec)); });
        setDialogo(null); avisar(n ? `${n} ${n === 1 ? "viga nueva" : "vigas nuevas"} entre pórticos.` : "No se agregaron vigas: los pórticos ya estaban unidos o sus nudos no coinciden en posición y altura.", n ? "ok" : "err");
      }} />}
      {dialogo === "copiar" && tridim && <DialogoCopiar modelo={modelo} onCerrar={() => setDialogo(null)} onAplicar={({ dir, c, destinos, unir }) => {
        const hacer = (m) => { let prev = c, t = 0; destinos.forEach((d) => { t += copiarPlano(m, dir, c, d); if (unir) unirPlanos(m, dir, prev, d, m.secc_viga); prev = d; }); return t; };
        const n = hacer(structuredClone(modelo));
        commit((m) => { hacer(m); });
        setDialogo(null); avisar(`${destinos.length} ${destinos.length === 1 ? "copia" : "copias"} del pórtico: ${n} ${n === 1 ? "barra nueva" : "barras nuevas"}.`);
      }} />}
      {pregunta && <DialogoPedir titulo={pregunta.titulo} campos={pregunta.campos} onCerrar={() => { pregunta.resolve(null); setPregunta(null); }} onAceptar={(v) => { pregunta.resolve(v); setPregunta(null); }} />}
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

// Barra del lienzo en planta / elevación del modelo 3D.
function BarraHerramientas3D({ tool, setTool, deshacer, rehacer, puedeDeshacer, puedeRehacer, modo3d, pasado = [], futuro = [] }) {
  const b = (activo) => `grid h-9 w-9 place-items-center rounded-md text-base ${activo ? "bg-teal text-white" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-ink-3"}`;
  const [verHist, setVerHist] = useState(false);
  const herr = modo3d ? HERR3D.filter((h) => ["select", "recuadro", "barra", "eliminar"].includes(h.id)) : HERR3D.filter((h) => h.id !== "recuadro");
  return (
    <div className="absolute left-3 top-14 flex flex-col gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow dark:border-ink-line dark:bg-ink-2/95" role="toolbar" aria-label="Herramientas de dibujo 3D">
      {verHist && (
        <div className="absolute left-12 top-0 z-20 max-h-80 w-60 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-xs shadow-lg dark:border-ink-line dark:bg-ink-2" role="list" aria-label="Historial de cambios">
          <div className="px-2 py-1 font-semibold">Historial de cambios</div>
          {futuro.slice().reverse().map((t, k) => (
            <button key={`f${k}`} onClick={() => rehacer(futuro.length - k)} className="block w-full truncate rounded px-2 py-1 text-left text-slate-400 hover:bg-slate-100 dark:hover:bg-ink-3" title="Rehacer hasta aquí">↷ {t}</button>
          ))}
          <div className="rounded bg-teal/15 px-2 py-1 font-semibold text-teal">● Estado actual</div>
          {pasado.slice().reverse().slice(0, 40).map((t, k) => (
            <button key={`p${k}`} onClick={() => deshacer(k + 1)} className="block w-full truncate rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-ink-3" title="Volver a antes de este cambio">{t}</button>
          ))}
          {!pasado.length && !futuro.length && <div className="px-2 py-1 text-slate-500">Aún no hay cambios.</div>}
        </div>
      )}
      {herr.map((h) => (
        <button key={h.id} className={b(tool === h.id)} title={`${h.label} (${h.kbd})`} aria-label={h.label} aria-pressed={tool === h.id} onClick={() => setTool(h.id)}>{h.icon}</button>
      ))}
      <div className="my-0.5 border-t border-slate-200 dark:border-ink-line" />
      <button className={b(false) + " disabled:opacity-30"} disabled={!puedeDeshacer} title="Deshacer (Ctrl+Z)" aria-label="Deshacer" onClick={deshacer}>↶</button>
      <button className={b(false) + " disabled:opacity-30"} disabled={!puedeRehacer} title="Rehacer (Ctrl+Y)" aria-label="Rehacer" onClick={() => rehacer()}>↷</button>
      <button className={b(verHist)} title="Historial de cambios" aria-label="Historial de cambios" aria-pressed={verHist} onClick={() => setVerHist((v) => !v)}>☰</button>
    </div>
  );
}

// Nombre automático de un cambio, para el historial.
function describirCambio(a, b) {
  const d = (k) => (b[k]?.length || 0) - (a[k]?.length || 0);
  const pl = (n, s, p) => `${Math.abs(n)} ${Math.abs(n) === 1 ? s : p}`;
  if (d("elementos") > 0) return `Agregar ${pl(d("elementos"), "barra", "barras")}`;
  if (d("elementos") < 0) return `Eliminar ${pl(d("elementos"), "barra", "barras")}`;
  if (d("nudos") > 0) return `Agregar ${pl(d("nudos"), "nudo", "nudos")}`;
  if (d("nudos") < 0) return `Eliminar ${pl(d("nudos"), "nudo", "nudos")}`;
  for (const k of ["cargas_barras", "cargas_nudos", "cargas_elementos", "cargas_nodales", "cargas_area"]) if (d(k)) return d(k) > 0 ? "Agregar carga" : "Quitar carga";
  if (JSON.stringify(a.nudos) !== JSON.stringify(b.nudos)) return "Mover o editar nudos";
  if (JSON.stringify(a.elementos) !== JSON.stringify(b.elementos)) return "Editar barras";
  if (JSON.stringify(a.secciones) !== JSON.stringify(b.secciones)) return "Editar secciones";
  if (JSON.stringify(a.niveles) !== JSON.stringify(b.niveles) || JSON.stringify(a.ejes) !== JSON.stringify(b.ejes)) return "Editar ejes o niveles";
  return "Editar modelo";
}
