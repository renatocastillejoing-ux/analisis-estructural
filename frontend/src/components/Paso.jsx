import { useEffect, useState } from "react";
import { metodoA } from "../api.js";

// Reproductor del método sistematizado: un paso a la vez, con avance manual o automático.
export default function Paso({ modelo, onVolver }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [i, setI] = useState(0);
  const [play, setPlay] = useState(false);

  useEffect(() => {
    metodoA(modelo).then(({ ok, data }) => {
      if (!ok || !data.ok) setError(data.error || "No se pudo resolver con el método sistematizado.");
      else { setData(data); setI(0); }
    });
  }, [modelo]);

  useEffect(() => {
    if (!play || !data) return;
    const t = setInterval(() => setI((k) => {
      if (k >= data.pasos.length - 1) { setPlay(false); return k; }
      return k + 1;
    }), 1600);
    return () => clearInterval(t);
  }, [play, data]);

  if (error) {
    return (
      <div className="m-auto max-w-lg space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm dark:border-amber-800 dark:bg-amber-950/40">
        <p className="font-semibold">Este modelo aún no se puede resolver paso a paso</p>
        <p>{error}</p>
        <button onClick={onVolver} className="rounded-md bg-teal px-3 py-1.5 text-white">Volver al modelo</button>
      </div>
    );
  }
  if (!data) return <div className="m-auto text-sm text-slate-600 dark:text-slate-300">Resolviendo…</div>;

  const paso = data.pasos[i];
  const n = data.pasos.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-6 py-3 dark:border-ink-line">
        <button onClick={() => { setPlay(false); setI(0); }} className={btn}>⏮</button>
        <button onClick={() => { setPlay(false); setI((k) => Math.max(0, k - 1)); }} className={btn}>◀</button>
        <button onClick={() => setPlay((p) => !p)} className="rounded-md bg-teal px-4 py-1.5 font-semibold text-white">{play ? "Pausa" : "Reproducir"}</button>
        <button onClick={() => { setPlay(false); setI((k) => Math.min(n - 1, k + 1)); }} className={btn}>▶</button>
        <button onClick={() => { setPlay(false); setI(n - 1); }} className={btn}>⏭</button>
        <span className="ml-auto text-sm font-semibold tabular-nums text-slate-600 dark:text-slate-300">Paso {i + 1} / {n}</span>
      </div>
      <div className="h-1 bg-slate-200 dark:bg-ink-3"><div className="h-1 bg-teal transition-all" style={{ width: `${((i + 1) / n) * 100}%` }} /></div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
        <div>
          <h2 className="text-lg font-semibold">{paso.titulo}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">{paso.desc}</p>
        </div>
        <PasoCuerpo paso={paso} data={data} />
      </div>
    </div>
  );
}

const btn = "rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-ink-line dark:hover:bg-ink-3";

function PasoCuerpo({ paso, data }) {
  switch (paso.id) {
    case "coords":
      return (
        <ul className="grid grid-cols-2 gap-2 text-sm">
          {data.labels.map((l, k) => <li key={k} className="rounded-md border border-slate-200 px-3 py-1.5 dark:border-ink-line">D{k + 1} · {l}</li>)}
        </ul>
      );
    case "A":
      return <Matriz M={paso.A} filas={paso.rows} columnas={paso.cols} titulo="[A] matriz de compatibilidad" />;
    case "Ki":
      return <Lista items={paso.barras.map((b) => ({ titulo: `${b.elem} · ${b.tipo}`, M: b.K }))} />;
    case "AtKA":
      return <Lista items={paso.barras.map((b) => ({ titulo: `Aporte ${b.elem}`, M: b.AtKA, filas: paso.cols, columnas: paso.cols }))} />;
    case "ensamble":
    case "K":
      return <Matriz M={paso.K} filas={paso.rows} columnas={paso.cols} titulo="[K] = Σ [A]ᵀ[K][A]" />;
    case "r":
      return <Lista items={paso.barras.map((b) => ({ titulo: `{r} ${b.elem}`, v: b.r }))} />;
    case "R":
      return <Vector v={paso.R} labels={paso.labels} titulo="{R} = Σ [A]ᵀ{r}" />;
    case "Q":
      return (
        <div className="grid gap-4 md:grid-cols-3">
          <Vector v={paso.Qn} labels={paso.labels} titulo="{Q} nudos" />
          <Vector v={paso.R} labels={paso.labels} titulo="{R}" />
          <Vector v={paso.Q} labels={paso.labels} titulo="{Q} = {Q}nudos − {R}" />
        </div>
      );
    case "D":
      return <Vector v={paso.D} labels={paso.labels} titulo="{D} = [K]⁻¹{Q}" />;
    case "d":
      return <Lista items={paso.barras.map((b) => ({ titulo: `{d} ${b.elem}`, v: b.d }))} />;
    case "q":
      return <Lista items={paso.barras.map((b) => ({ titulo: `{q} ${b.elem}`, v: b.q }))} />;
    case "qT":
      return <Lista items={paso.barras.map((b) => ({ titulo: `{q} total ${b.elem}`, v: b.qT }))} />;
    default:
      return null;
  }
}

function Matriz({ M, filas, columnas, titulo }) {
  if (!M || !M.length) return null;
  return (
    <div>
      {titulo && <div className="mb-2 text-sm font-semibold text-teal-dark dark:text-teal-soft">{titulo}</div>}
      <div className="overflow-x-auto">
        <table className="text-sm tabular-nums">
          {columnas && (
            <thead><tr><th className="px-2" />{columnas.map((c, j) => <th key={j} className="px-2 py-1 text-xs text-slate-600 dark:text-slate-300">{c}</th>)}</tr></thead>
          )}
          <tbody>
            {M.map((fila, r) => (
              <tr key={r}>
                {filas && <th className="px-2 py-1 text-xs text-slate-600 dark:text-slate-300">{filas[r]}</th>}
                {(Array.isArray(fila) ? fila : [fila]).map((v, c) => (
                  <td key={c} className="min-w-16 border border-slate-200 px-2 py-1 text-right dark:border-ink-line">{fmtM(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Vector({ v, labels, titulo }) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-teal-dark dark:text-teal-soft">{titulo}</div>
      <table className="text-sm tabular-nums">
        <tbody>
          {(v || []).map((x, k) => (
            <tr key={k}>
              <th className="px-2 py-1 text-left text-xs text-slate-600 dark:text-slate-300">{labels ? labels[k] : `D${k + 1}`}</th>
              <td className="border border-slate-200 px-3 py-1 text-right dark:border-ink-line">{fmtM(x)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Lista({ items }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {items.map((it, k) => (
        <div key={k} className="rounded-xl border border-slate-200 p-3 dark:border-ink-line">
          <div className="mb-2 text-xs font-semibold uppercase text-slate-600 dark:text-slate-300">{it.titulo}</div>
          {it.M ? <Matriz M={it.M} filas={it.filas} columnas={it.columnas} /> : <div className="text-sm tabular-nums">[{(it.v || []).map(fmtM).join(", ")}]</div>}
        </div>
      ))}
    </div>
  );
}

function fmtM(x) {
  const a = Math.abs(+x);
  if (!Number.isFinite(a) || a < 1e-12) return "0";
  if (a >= 1e4 || a < 1e-3) return (+x).toExponential(2);
  return (+x).toFixed(3);
}
