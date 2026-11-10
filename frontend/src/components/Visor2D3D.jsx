import { useMemo } from "react";
import Visor3D, { escenaModelo } from "./Visor3D.jsx";

// El pórtico 2D del editor visto en 3D (girable), con sus secciones reales.
export default function Visor2D3D({ modelo, sel, setSel }) {
  const escena = useMemo(() => {
    const e = escenaModelo(modelo);
    e.miembros.forEach((m) => { m.sel = sel?.tipo === "elemento" && sel.id === m.id; });
    return e;
  }, [modelo, sel]);
  return <Visor3D escena={escena} ajusteKey={modelo.nombre} onElegir={(m) => setSel(m?.id ? { tipo: "elemento", id: m.id } : null)} />;
}
