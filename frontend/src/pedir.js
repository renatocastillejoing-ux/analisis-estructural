// Diálogo propio para pedir valores numéricos (reemplaza window.prompt, que el navegador puede bloquear).
let oyente = null;
export const registrarPedir = (f) => { oyente = f; };

// campos: [{ clave, label, valor }] → Promise<{ clave: número } | null>
export const pedir = (titulo, campos) => new Promise((resolve) => {
  if (oyente) oyente({ titulo, campos, resolve });
  else resolve(null);
});
