const TABS = [
  { id: "modelo", label: "Modelo" },
  { id: "resultados", label: "Resultados" },
  { id: "pasoapaso", label: "Paso a paso" },
];

const PASOS = [
  { id: "definir", n: 1, label: "Definir" },
  { id: "modelar", n: 2, label: "Modelar" },
  { id: "cargar", n: 3, label: "Cargar" },
];

export default function Topbar({ dark, onTheme, vista, onVista, paso, onPaso, onCalcular, cargando }) {
  return (
    <header className="border-b border-slate-200 bg-white dark:border-ink-line dark:bg-ink-2">
      <div className="flex h-14 items-center gap-4 px-4">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-teal text-white">▲</div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Análisis Estructural</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Método matricial de rigidez</div>
          </div>
        </div>

        {/* Pasos horizontales: el contenido de la izquierda corresponde solo al paso activo */}
        {vista === "modelo" ? (
          <nav className="mx-auto flex items-center gap-1 rounded-full bg-slate-100 p-1 dark:bg-ink-3" aria-label="Pasos">
            {PASOS.map((p) => {
              const activo = paso === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => onPaso(p.id)}
                  aria-current={activo ? "step" : undefined}
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition ${
                    activo
                      ? "bg-white font-semibold text-teal-dark shadow dark:bg-ink-line dark:text-teal-soft"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  }`}
                >
                  <span className={`grid h-5 w-5 place-items-center rounded-full text-xs font-bold ${activo ? "bg-teal text-white" : "bg-slate-300 text-slate-700 dark:bg-ink-line dark:text-slate-200"}`}>
                    {p.n}
                  </span>
                  {p.label}
                </button>
              );
            })}
          </nav>
        ) : (
          <div className="mx-auto" />
        )}

        <nav className="flex gap-1" aria-label="Vistas">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onVista(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                vista === t.id
                  ? "bg-teal-soft/30 font-semibold text-teal-dark dark:text-teal-soft"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <button
          onClick={onTheme}
          title="Tema claro / oscuro"
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-ink-line dark:text-slate-200 dark:hover:bg-ink-3"
        >
          {dark ? "Claro" : "Oscuro"}
        </button>
        <button
          onClick={onCalcular}
          disabled={cargando}
          className="rounded-md bg-teal px-4 py-1.5 text-sm font-semibold text-white shadow hover:bg-teal-dark disabled:opacity-60"
        >
          {cargando ? "Calculando…" : "Calcular  (Ctrl+Enter)"}
        </button>
      </div>
    </header>
  );
}
