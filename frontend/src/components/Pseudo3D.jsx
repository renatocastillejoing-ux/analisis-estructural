import { useEffect, useState } from "react";
import { torrePseudo3d } from "../api.js";

const caja = "rounded-xl border border-slate-200 bg-white p-4 dark:border-ink-line dark:bg-ink-2";
const f = (v, d = 2) => (v == null || Number.isNaN(+v) ? "—" : (+v).toFixed(d));
const e = (v) => (Math.abs(+v) < 1e-3 ? (+v).toExponential(3) : (+v).toFixed(5));

// Sismo por el método pseudo-tridimensional del profesor (pórticos con [A] + diafragma).
export default function Pseudo3D() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [dir, setDir] = useState("X");
  useEffect(() => {
    torrePseudo3d().then((r) => (r.ok ? setD(r) : setErr(r.error))).catch((x) => setErr(String(x)));
  }, []);
  if (err) return <p className="text-sm text-rose-600">{err}</p>;
  if (!d) return (
    <div className="space-y-2">
      {[0, 1, 2].map((k) => <div key={k} className="h-10 animate-pulse rounded-lg bg-slate-200 dark:bg-ink-line" />)}
      <p className="text-xs text-slate-500">Armando la rigidez lateral de los {""}pórticos (unos segundos)…</p>
    </div>
  );
  const v = d.direcciones[dir];
  const propios = v.porticos.filter((p) => p.eje === (dir === "X" ? "x" : "y")).sort((a, b) => b.V - a.V);
  const der = 0.75 * (d.sismo?.[dir]?.R || 6);
  return (
    <div className="space-y-3">
      <div className={caja}>
        <h3 className="mb-1 font-semibold">Análisis pseudo-tridimensional (método del profesor)</h3>
        <ol className="list-decimal space-y-0.5 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>[K] de cada pórtico con el método sistematizado: Σ[A]ᵀ[k][A] (barras 4×4, EA = ∞).</li>
          <li>Rigidez lateral por condensación de los giros: [KL] = [Ktt] − [Kto][Koo]⁻¹[Kot].</li>
          <li>Compatibilidad con el diafragma: pórtico en X → u = Dx − θ·(y − yc); en Y → u = Dy + θ·(x − xc).</li>
          <li>[K]edificio = Σ[r]ᵀ[KL][r] ({d.K_edificio_orden}×{d.K_edificio_orden}: 3 GDL por piso y bloque); {"{D}"} = [K]⁻¹{"{F}"} con las fuerzas E.030.</li>
          <li>De vuelta en cada pórtico: {"{Dt}"} = [r]{"{D}"}, giros por la condensación y {"{q}"} = [k][A]{"{D}"}.</li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">Torre de los supuestos (core/torre_supuestos.json): {d.n_porticos} pórticos, {d.bloques} bloque(s), {d.segundos} s. Los muros que no están sobre un eje no entran en este método.</p>
      </div>
      <div className="flex gap-1">
        {["X", "Y"].map((k) => <button key={k} onClick={() => setDir(k)} className={`min-h-9 rounded-full px-4 text-sm ${dir === k ? "bg-teal font-semibold text-white" : "bg-white dark:bg-ink-2"}`}>Sismo {k}</button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={caja}><div className="text-xs text-slate-500">Cortante aplicado</div><div className="text-lg font-semibold">{f(v.V_aplicado, 1)} tonf</div></div>
        <div className={caja}><div className="text-xs text-slate-500">Σ cortante de los pórticos en {dir}</div><div className="text-lg font-semibold">{f(v.V_porticos, 1)} tonf</div></div>
        <div className={caja}><div className="text-xs text-slate-500">Deriva máx. (×0.75R = {f(der, 2)})</div>
          <div className={`text-lg font-semibold ${v.deriva_max_inelastica > v.limite ? "text-rose-600" : "text-teal-dark dark:text-teal-soft"}`}>{e(v.deriva_max_inelastica)} {v.deriva_max_inelastica > v.limite ? "> 0.007" : "≤ 0.007"}</div></div>
      </div>
      <div className={`${caja} overflow-x-auto`}>
        <h4 className="mb-2 text-sm font-semibold">Cortante que toma cada pórtico en {dir}</h4>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Pórtico</th><th>V (tonf)</th><th>%</th><th>Deriva máx. ×0.75R</th></tr></thead>
          <tbody>
            {propios.map((p) => {
              const dm = Math.max(...p.deriva_elastica.map(Math.abs)) * der;
              return (
                <tr key={p.nombre} className="border-t border-slate-100 dark:border-ink-line">
                  <td className="py-1">{p.nombre}</td><td>{f(p.V, 1)}</td><td>{f((100 * p.V) / v.V_aplicado, 1)}</td>
                  <td className={dm > 0.007 ? "text-rose-600" : ""}>{e(dm)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={`${caja} overflow-x-auto`}>
        <h4 className="mb-2 text-sm font-semibold">Desplazamientos del diafragma {"{D}"} (centro de cada piso)</h4>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">z (m)</th><th>Bloque</th><th>Dx (m)</th><th>Dy (m)</th><th>θ (rad)</th></tr></thead>
          <tbody>
            {v.D_diafragma.map((r) => (
              <tr key={`${r.z}-${r.bloque}`} className="border-t border-slate-100 dark:border-ink-line">
                <td className="py-1">{f(r.z, 1)}</td><td>{r.bloque}</td><td>{e(r.Dx)}</td><td>{e(r.Dy)}</td><td>{e(r.giro)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
