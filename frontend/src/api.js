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
export async function pdfTorre() {
  const r = await fetch("/api/torre/pdf");
  if (!r.ok) throw new Error(await errorDe(r));
  guardarBlob(await r.blob(), nombreDeCabecera(r, "torre_arequipa_porticos.pdf"));
}
export const pdfTorreProgreso = () => fetch("/api/torre/pdf/progreso").then((r) => r.json());
export async function compararEtabs(modelo, archivo, opciones = {}) {
  const fd = new FormData();
  fd.append("modelo", JSON.stringify(modelo));
  fd.append("archivo", archivo);
  Object.entries(opciones).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") fd.append(k, v); });
  const r = await fetch("/api/comparar_etabs", { method: "POST", body: fd });
  return r.json();
}
