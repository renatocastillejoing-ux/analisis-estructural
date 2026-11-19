// Cliente de la API Flask (mismo backend que la interfaz clásica).
// Cada acción que puede tardar se envuelve en conCarga(): el indicador global (Carga.jsx)
// muestra qué se está haciendo, la etapa, el porcentaje y cuánto falta.
import { conCarga } from "./progreso.js";
const post = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => ({ ok: r.ok, data: await r.json() }));

const tam = (m) => (m?.elementos?.length > 200 ? "g" : m?.elementos?.length > 30 ? "m" : "p");   // para recordar duraciones por tamaño
export const calcular = (modelo) => conCarga(`calc2d-${tam(modelo)}`, "Calculando el pórtico (método [A])", () => post("/api/calcular", modelo), "Armando [A], [K] y resolviendo {D}");
export const metodoA = (modelo) => conCarga(`pasos-${tam(modelo)}`, "Preparando la resolución paso a paso", () => post("/api/metodo_a", modelo), "Matrices de cada barra");
export const torrePseudo3d = () => conCarga("pseudo3d", "Análisis pseudo-tridimensional", () => fetch("/api/torre/pseudo3d").then((r) => r.json()), "Rigidez lateral de cada pórtico y diafragmas");
export const torreLista = () => conCarga("torre-lista", "Leyendo los pórticos de la torre", () => fetch("/api/torre/lista").then((r) => r.json()), "Armando la torre desde el plano");
export const torreModelo = (tipo, idx, casos = false) =>
  conCarga("torre-portico", "Cargando el pórtico de la torre", () => fetch(`/api/torre?tipo=${tipo}&idx=${idx}${casos ? "&casos=1" : ""}`).then((r) => r.json()), "Extrayendo el pórtico y sus cargas");
export const combinaciones = (modelo) => conCarga(`combos-${tam(modelo)}`, "Calculando combinaciones y envolventes", () => post("/api/combinaciones", modelo), "Un cálculo por combinación");
// Cálculo 3D en segundo plano: se inicia y se consulta cada segundo (la torre puede tardar
// más que el límite de una petición en el servidor en línea). Devuelve { ok, data } como post().
export const calcular3d = (modelo, opciones = {}) =>
  conCarga(`calc3d-${tam(modelo)}`, `Calculando el modelo 3D (${modelo?.elementos?.length || 0} barras)`, (act) => _calcular3d(modelo, opciones, act), "Enviando el modelo");
async function _calcular3d(modelo, { onProgreso } = {}, act) {
  const ini = await post("/api/calcular3d/iniciar", modelo);
  if (!ini.ok || !ini.data.ok) return ini;
  for (let fallos = 0; ;) {
    await new Promise((r) => setTimeout(r, 1000));
    let r;
    try { r = await fetch(`/api/calcular3d/estado/${ini.data.id}`); } catch (e) {
      if (++fallos >= 5) return { ok: false, data: { error: `Se perdió la conexión con el servidor durante el cálculo (${e}). Vuelve a calcular.` } };
      continue;
    }
    let d;
    try { d = await r.json(); } catch { if (++fallos >= 5) return { ok: false, data: { error: `Respuesta inesperada del servidor (${r.status}). Vuelve a calcular.` } }; continue; }
    fallos = 0;
    if (d.estado === "listo") return { ok: true, data: d.resultado };
    if (d.estado !== "calculando") return { ok: false, data: { error: d.error || "No se pudo calcular el modelo 3D." } };
    act?.({ etapa: d.etapa, fraccion: d.fraccion });
    onProgreso?.(d.segundos);
  }
}
export const extraerPortico = (modelo, eje, valor, factores) => conCarga("extraer", "Extrayendo el pórtico del modelo 3D", () => post("/api/modelo3d/portico", { modelo, eje, valor, factores }), "Reparto de cargas de losa");
export const torre3dModelo = () => conCarga("torre-3d", "Cargando la Torre de Arequipa (3D)", () => fetch("/api/torre/modelo3d").then((r) => r.json()), "Columnas, placas, vigas y losa desde el plano");
// Memoria de cálculo (texto): el servidor la genera solo cuando se pide.
export const memoria = (modelo) => conCarga("memoria", "Generando la memoria de cálculo", () => post("/api/memoria", modelo));

// ---- exportaciones: Excel del profesor, PDF de la torre y comparación con ETABS ----
export function guardarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const nombreDeCabecera = (r, otro) => /filename="?([^";]+)"?/.exec(r.headers.get("Content-Disposition") || "")?.[1] || otro;
const errorDe = async (r) => { try { return (await r.json()).error || `Error ${r.status}`; } catch { return `Error ${r.status}`; } };

export const excelProfesor = (modelo) => conCarga("excel", "Generando el Excel del profesor", () => _excelProfesor(modelo), "Hojas, matrices y fórmulas");
// «Failed to fetch» = el servidor no respondió (apagado, reiniciándose o sin red): se reintenta
// una vez y, si sigue sin responder, se explica en español.
const SIN_SERVIDOR = "No hay conexión con el servidor de cálculo (está apagado, reiniciándose o sin red). Espera unos segundos y vuelve a intentarlo.";
async function fetchConReintento(url, opciones) {
  try { return await fetch(url, opciones); }
  catch {
    await new Promise((r) => setTimeout(r, 2500));
    try { return await fetch(url, opciones); } catch { throw new Error(SIN_SERVIDOR); }
  }
}
async function _excelProfesor(modelo) {
  const r = await fetchConReintento("/api/exportar/excel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(modelo) });
  if (!r.ok) throw new Error(await errorDe(r));
  guardarBlob(await r.blob(), nombreDeCabecera(r, "portico_profesor.xlsx"));
}
// PDF de todos los pórticos: se genera en segundo plano en el servidor (puede tardar más que el
// tiempo máximo de una petición). Se pide el inicio, se consulta el avance cada segundo y, al
// terminar, se descarga. Si el servidor se reinicia (pierde el trabajo) o se corta la conexión
// varias veces seguidas, falla con error.reintentar = true para ofrecer «Reintentar».
const pdfJson = (url, opciones) => fetch(url, opciones).then((r) => r.json());
export const pdfTorreProgreso = () => pdfJson("/api/torre/pdf/progreso");
export const pdfTorre = (opciones = {}) => conCarga("pdf-torre", "Generando el PDF de todos los pórticos", (act) =>
  _pdfTorre({ ...opciones, onProgreso: (p) => { act({ paso: { i: p.i || 0, n: p.n || 0, nombre: p.nombre } }); opciones.onProgreso?.(p); } }), "Iniciando");
async function _pdfTorre({ onProgreso, forzar = false, cada = 1000 } = {}) {
  const falla = (msg, reintentar) => Object.assign(new Error(msg), { reintentar });
  let p;
  try { p = await pdfJson("/api/torre/pdf/iniciar" + (forzar ? "?forzar=1" : ""), { method: "POST" }); }
  catch { throw falla(SIN_SERVIDOR, true); }
  const arranque = p.arranque;
  let cortes = 0;
  while (p.estado !== "listo") {
    if (p.estado === "error") throw falla(p.error || "El servidor no pudo generar el PDF.", true);
    if (p.estado === "libre") throw falla("El servidor se reinició y perdió el PDF en curso.", true);
    onProgreso?.(p);
    await new Promise((r) => setTimeout(r, cada));
    try { p = await pdfTorreProgreso(); cortes = 0; }
    catch { if (++cortes >= 5) throw falla("Se perdió la conexión con el servidor.", true); continue; }
    if (p.arranque && arranque && p.arranque !== arranque) throw falla("El servidor se reinició mientras se generaba el PDF.", true);
  }
  onProgreso?.(p);
  let r;
  try { r = await fetch("/api/torre/pdf"); } catch { throw falla("No se pudo descargar el PDF: sin conexión.", true); }
  if (r.status === 409) throw falla("El servidor se reinició y ya no tiene el PDF.", true);
  if (!r.ok) throw falla(await errorDe(r), true);
  guardarBlob(await r.blob(), nombreDeCabecera(r, "torre_arequipa_porticos.pdf"));
  return p;
}
export const compararEtabs = (modelo, archivo, opciones = {}) => conCarga("etabs", "Comparando con ETABS", () => _compararEtabs(modelo, archivo, opciones), "Leyendo la tabla y emparejando barras");
async function _compararEtabs(modelo, archivo, opciones = {}) {
  const fd = new FormData();
  fd.append("modelo", JSON.stringify(modelo));
  fd.append("archivo", archivo);
  Object.entries(opciones).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") fd.append(k, v); });
  const r = await fetchConReintento("/api/comparar_etabs", { method: "POST", body: fd });
  return r.json();
}
// Ejercicio desde foto: la IA con visión del servidor lee el pórtico (AE_IA_URL / AE_IA_LLAVE en el servidor).
export const leerEjercicio = (imagen) => conCarga("ia-foto", "Leyendo el ejercicio con IA", () => post("/api/ia/leer_ejercicio", { imagen }), "La IA interpreta el dibujo, las cotas y las cargas");
