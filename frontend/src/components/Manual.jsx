import { Fragment, useMemo, useRef, useState } from "react";
import { MANUAL } from "../manual.js";

const negritas = (txt) => String(txt).split(/(\*\*[^*]+\*\*)/g).map((p, k) =>
  p.startsWith("**") ? <strong key={k}>{p.slice(2, -2)}</strong> : <Fragment key={k}>{p}</Fragment>);

const plano = (b) => (Array.isArray(b.x) ? b.x.join(" ") : b.x || "") + (b.filas ? b.filas.flat().join(" ") : "");

function Bloque({ b }) {
  switch (b.t) {
    case "h": return <h3 className="mt-5 text-base font-semibold text-teal-dark dark:text-teal-soft">{b.x}</h3>;
    case "p": return <p className="leading-relaxed text-slate-700 dark:text-slate-200">{negritas(b.x)}</p>;
    case "l": return <ul className="list-disc space-y-1.5 pl-5 leading-relaxed text-slate-700 dark:text-slate-200">{b.x.map((x, k) => <li key={k}>{negritas(x)}</li>)}</ul>;
    case "n": return <ol className="list-decimal space-y-1.5 pl-6 leading-relaxed text-slate-700 dark:text-slate-200">{b.x.map((x, k) => <li key={k}>{negritas(x)}</li>)}</ol>;
    case "f": return <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-100 px-4 py-3 font-mono text-[13px] text-slate-800 dark:bg-ink-3 dark:text-slate-100">{b.x}</pre>;
    case "nota": return <div className="rounded-lg border-l-4 border-teal bg-teal/10 px-4 py-3 text-slate-800 dark:text-slate-100">{negritas(b.x)}</div>;
    case "aviso": return <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{negritas(b.x)}</div>;
    case "t": return (
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-ink-line">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-ink-3"><tr>{b.cols.map((c) => <th key={c} className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-600 dark:text-slate-300">{c}</th>)}</tr></thead>
          <tbody>{b.filas.map((f, i) => <tr key={i} className="border-t border-slate-100 dark:border-ink-line">{f.map((c, j) => <td key={j} className="px-3 py-2 align-top text-slate-700 dark:text-slate-200">{negritas(c)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
    default: return null;
  }
}

// Manual de uso: índice, buscador y secciones (vista «manual»).
export default function Manual({ onVolver }) {
  const [q, setQ] = useState("");
  const cont = useRef(null);
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const secciones = useMemo(() => {
    const t = norm(q.trim());
    if (!t) return MANUAL;
    return MANUAL.filter((s) => norm(s.titulo + " " + s.bloques.map(plano).join(" ")).includes(t));
  }, [q]);
  const ir = (id) => document.getElementById(`man-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <aside className="shrink-0 border-b border-slate-200 bg-white p-4 md:w-72 md:overflow-y-auto md:border-b-0 md:border-r dark:border-ink-line dark:bg-ink-2">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Manual de uso</h1>
          <button onClick={onVolver} className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-ink-line">← Volver</button>
        </div>
        <input className="inp mb-3 w-full" placeholder="Buscar en el manual…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar en el manual" />
        <select className="inp w-full md:hidden" onChange={(e) => ir(e.target.value)} defaultValue="" aria-label="Ir a la sección">
          <option value="" disabled>Ir a la sección…</option>
          {secciones.map((s) => <option key={s.id} value={s.id}>{s.titulo}</option>)}
        </select>
        <nav className="hidden space-y-0.5 md:block" aria-label="Índice del manual">
          {secciones.map((s) => (
            <button key={s.id} onClick={() => ir(s.id)} className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-ink-3">{s.titulo}</button>
          ))}
        </nav>
      </aside>
      <main ref={cont} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-10 p-4 sm:p-8">
          {secciones.length === 0 && <p className="text-sm text-slate-500">Nada coincide con «{q}».</p>}
          {secciones.map((s) => (
            <section key={s.id} id={`man-${s.id}`} className="scroll-mt-4 space-y-3">
              <h2 className="border-b border-slate-200 pb-2 text-xl font-semibold dark:border-ink-line">{s.titulo}</h2>
              {s.bloques.map((b, k) => <Bloque key={k} b={b} />)}
            </section>
          ))}
          <p className="pb-8 text-xs text-slate-500">Proyecto estudiantil · Análisis Estructural II. Si algo del manual no coincide con lo que ves, la referencia es el método del profesor y la Norma E.060 / E.030 vigente.</p>
        </div>
      </main>
    </div>
  );
}
