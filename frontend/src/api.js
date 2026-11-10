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
