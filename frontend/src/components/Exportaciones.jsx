import { useState } from "react";
import { compararEtabs, excelProfesor, guardarBlob } from "../api.js";
import { Campo, Modal } from "./ui.jsx";

const btnS = "rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-ink-line dark:hover:bg-ink-3";
const btnP = "rounded-md bg-teal px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-dark disabled:opacity-50";

// Botón «Excel del profesor»: descarga el .xlsx con [A], [K] por barra, {Q}, {R} y {D}.
export function BotonExcel({ modelo, className = btnS }) {
  const [estado, setEstado] = useState("");
  const [msg, setMsg] = useState("");
  const ir = async () => {
    setEstado("busy"); setMsg("");
    try { await excelProfesor(modelo); setEstado(""); }
    catch (e) { setEstado("err"); setMsg(e.message || String(e)); }
  };
  return (
    <>
      <button onClick={ir} disabled={estado === "busy"} className={className} title="Excel con el formato del profesor: Datos, [A], una hoja por barra, [K] total y {Q}, {R}, {D}">
        {estado === "busy" ? "Generando Excel…" : "Excel del profesor"}
      </button>
      {estado === "err" && <span role="alert" className="text-xs text-rose-600 dark:text-rose-300">{msg}</span>}
    </>
  );
}

const COLOR = { ok: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100", medio: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100", alto: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100", sin: "" };
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const MAG = [["P", "P (axial)"], ["V", "V (cortante)"], ["M", "M (momento)"]];

export function csvEtabs(res) {
  const filas = [["Barra", "ETABS", "Extremo", ...MAG.flatMap(([m]) => [`${m} sistema`, `${m} ETABS`, `${m} dif %`])]];
  res.filas.forEach((f) => filas.push([f.barra, f.etabs, f.extremo, ...MAG.flatMap(([m]) => [f[m].sis, f[m].etabs, f[m].dif.toFixed(2)])]));
  return "﻿" + filas.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
}

// Diálogo «Comparar con ETABS»: sube la tabla «Element Forces - Frames» y muestra la diferencia por barra y extremo.
export function DialogoEtabs({ modelo, onCerrar }) {
  const [archivo, setArchivo] = useState(null);
  const [res, setRes] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [op, setOp] = useState({ col_nombre: "", caso: "", modo: "abs", factor_fuerza: "1", por_coordenadas: "" });

  const correr = async (arch = archivo, o = op) => {
    if (!arch) return;
    setBusy(true); setError("");
    try {
      const d = await compararEtabs(modelo, arch, o);
      if (!d.ok) { setError(d.error || "No se pudo comparar."); setRes(null); }
      else setRes(d);
    } catch (e) { setError("No hay conexión con el servidor: " + e); }
    setBusy(false);
  };
  const cambiar = (k) => (v) => { const o = { ...op, [k]: v }; setOp(o); if (archivo) correr(archivo, o); };
  const elegir = (e) => { const f = e.target.files?.[0]; if (f) { setArchivo(f); setRes(null); correr(f); } };
  const exportar = () => guardarBlob(new Blob([csvEtabs(res)], { type: "text/csv;charset=utf-8" }), "comparacion_etabs.csv");

  return (
    <Modal titulo="Comparar con ETABS" ancho="max-w-5xl" onCerrar={onCerrar}
      sub="Sube la tabla «Element Forces - Frames» exportada de ETABS (.xlsx o .csv: Story, nombre de barra, Station, P, V2, M3)."
      pie={<><button className={btnS} onClick={onCerrar}>Cerrar</button><button className={btnP} disabled={!res} onClick={exportar}>Exportar CSV</button></>}>
      <div className="space-y-3">
        <input type="file" accept=".xlsx,.csv,.txt" onChange={elegir} className="block w-full text-sm" aria-label="Archivo de ETABS" />
        {busy && <p className="text-sm text-slate-500">Comparando…</p>}
        {error && <p role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
        {archivo && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Campo label="Columna con el nombre de la barra">
              <select className="inp" value={op.col_nombre || res?.col_nombre || ""} onChange={(e) => cambiar("col_nombre")(e.target.value)}>
                {(res?.columnas || []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Campo>
            <Campo label="Caso / combinación">
              <select className="inp" value={op.caso || res?.caso || ""} onChange={(e) => cambiar("caso")(e.target.value)}>
                {(res?.casos || []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Campo>
            <Campo label="Comparar" hint="ETABS y este sistema no usan los mismos signos">
              <select className="inp" value={op.modo} onChange={(e) => cambiar("modo")(e.target.value)}>
                <option value="abs">Módulos (|valor|)</option><option value="signo">Con signo, tal cual</option>
              </select>
            </Campo>
            <Campo label="Emparejar por">
              <select className="inp" value={op.por_coordenadas} onChange={(e) => cambiar("por_coordenadas")(e.target.value)}>
                <option value="">Nombre (y coordenadas si no casa)</option><option value="1">Coordenadas</option>
              </select>
            </Campo>
            <Campo label="Factor de fuerza → tonf" hint="kN → tonf: 0.10197">
              <input className="inp" value={op.factor_fuerza} onChange={(e) => setOp({ ...op, factor_fuerza: e.target.value })} onBlur={() => correr()} inputMode="decimal" />
            </Campo>
          </div>
        )}
        {res && (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {res.resumen.barras} barras emparejadas por {res.metodo}. Peor diferencia: P {res.resumen.peor.P} % · V {res.resumen.peor.V} % · M {res.resumen.peor.M} %.
              {" "}<span className={`rounded px-1.5 ${COLOR.ok}`}>≤ 5 %</span> <span className={`rounded px-1.5 ${COLOR.medio}`}>≤ 15 %</span> <span className={`rounded px-1.5 ${COLOR.alto}`}>&gt; 15 %</span>
              {res.sin_pareja_modelo.length > 0 && <> Sin pareja en ETABS: {res.sin_pareja_modelo.join(", ")}.</>}
            </p>
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200 dark:border-ink-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs dark:bg-ink-3">
                  <tr><th className="px-2 py-1 text-left" rowSpan={2}>Barra</th><th className="px-2 py-1" rowSpan={2}>Ext.</th>
                    {MAG.map(([m, l]) => <th key={m} colSpan={3} className="border-l border-slate-200 px-2 py-1 dark:border-ink-line">{l}</th>)}</tr>
                  <tr>{MAG.flatMap(([m]) => ["Sistema", "ETABS", "Dif %"].map((t) => <th key={m + t} className="px-2 py-1 font-normal">{t}</th>))}</tr>
                </thead>
                <tbody>
                  {res.filas.map((f, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-ink-line">
                      <td className="px-2 py-1 font-medium">{f.barra}{f.etabs !== f.barra ? <span className="text-xs text-slate-500"> ({f.etabs})</span> : null}</td>
                      <td className="px-2 py-1 text-center">{f.extremo}</td>
                      {MAG.flatMap(([m]) => [
                        <td key={m + "s"} className={`px-2 py-1 text-right tabular-nums ${COLOR[f[m].nivel]}`}>{f2(f[m].sis)}</td>,
                        <td key={m + "e"} className={`px-2 py-1 text-right tabular-nums ${COLOR[f[m].nivel]}`}>{f2(f[m].etabs)}</td>,
                        <td key={m + "d"} className={`px-2 py-1 text-right font-semibold tabular-nums ${COLOR[f[m].nivel]}`}>{Number.isFinite(f[m].dif) ? f[m].dif.toFixed(1) + " %" : "—"}</td>])}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
