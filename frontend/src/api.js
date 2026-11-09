// Cliente de la API Flask (mismo backend que la interfaz clásica).
const post = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => ({ ok: r.ok, data: await r.json() }));

export const calcular = (modelo) => post("/api/calcular", modelo);
export const metodoA = (modelo) => post("/api/metodo_a", modelo);
export const torreLista = () => fetch("/api/torre/lista").then((r) => r.json());
export const torreModelo = (tipo, idx) =>
  fetch(`/api/torre?tipo=${tipo}&idx=${idx}`).then((r) => r.json());
