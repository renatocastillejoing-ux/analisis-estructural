// Cliente de la API Flask (mismo backend que la interfaz clásica).
const post = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => ({ ok: r.ok, data: await r.json() }));

export const calcular = (modelo) => post("/api/calcular", modelo);
export const metodoA = (modelo) => post("/api/metodo_a", modelo);
export const torreLista = () => fetch("/api/torre/lista").then((r) => r.json());
export const torreModelo = (tipo, idx, casos = false) =>
  fetch(`/api/torre?tipo=${tipo}&idx=${idx}${casos ? "&casos=1" : ""}`).then((r) => r.json());
export const combinaciones = (modelo) => post("/api/combinaciones", modelo);
export const calcular3d = (modelo) => post("/api/calcular3d", modelo);
export const extraerPortico = (modelo, eje, valor, factores) => post("/api/modelo3d/portico", { modelo, eje, valor, factores });
export const torre3dModelo = () => fetch("/api/torre/modelo3d").then((r) => r.json());
// Memoria de cálculo (texto): el servidor la genera solo cuando se pide.
export const memoria = (modelo) => post("/api/memoria", modelo);

// ---- exportaciones: Excel del profesor, PDF de la torre y comparación con ETABS ----
export function guardarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const nombreDeCabecera = (r, otro) => /filename="?([^";]+)"?/.exec(r.headers.get("Content-Disposition") || "")?.[1] || otro;
const errorDe = async (r) => { try { return (await r.json()).error || `Error ${r.status}`; } catch { return `Error ${r.status}`; } };

export async function excelProfesor(modelo) {
  const r = await fetch("/api/exportar/excel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(modelo) });
  if (!r.ok) throw new Error(await errorDe(r));
  guardarBlob(await r.blob(), nombreDeCabecera(r, "portico_profesor.xlsx"));
}
// PDF de todos los pórticos: se genera en segundo plano en el servidor (puede tardar más que el
// tiempo máximo de una petición). Se pide el inicio, se consulta el avance cada segundo y, al
// terminar, se descarga. Si el servidor se reinicia (pierde el trabajo) o se corta la conexión
// varias veces seguidas, falla con error.reintentar = true para ofrecer «Reintentar».
const pdfJson = (url, opciones) => fetch(url, opciones).then((r) => r.json());
export const pdfTorreProgreso = () => pdfJson("/api/torre/pdf/progreso");
export async function pdfTorre({ onProgreso, forzar = false, cada = 1000 } = {}) {
  const falla = (msg, reintentar) => Object.assign(new Error(msg), { reintentar });
  let p;
  try { p = await pdfJson("/api/torre/pdf/iniciar" + (forzar ? "?forzar=1" : ""), { method: "POST" }); }
  catch { throw falla("No hay conexión con el servidor.", true); }
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
export async function compararEtabs(modelo, archivo, opciones = {}) {
  const fd = new FormData();
  fd.append("modelo", JSON.stringify(modelo));
  fd.append("archivo", archivo);
  Object.entries(opciones).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") fd.append(k, v); });
  const r = await fetch("/api/comparar_etabs", { method: "POST", body: fd });
  return r.json();
}
