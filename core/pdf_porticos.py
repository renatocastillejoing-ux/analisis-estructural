# -*- coding: utf-8 -*-
"""
PDF con la envolvente de diseño de TODOS los pórticos de la torre.

Se resuelve cada pórtico con la combinación 1.4·CM + 1.7·CV y se dibuja, sobre su
geometría, el DFN, el DFC y el DMF (valores máximos rotulados) más una tabla
resumen de máximos por barra. Portada con índice y número de página.

Las figuras usan matplotlib.figure.Figure (sin pyplot): no dependen del estado
global de matplotlib ni de ninguna ventana.
"""
import datetime
import io
import os
import sys
import time

import numpy as np
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.figure import Figure
from matplotlib.patches import PathPatch
from matplotlib.path import Path
from matplotlib.collections import LineCollection, PolyCollection

A3_H = (16.54, 11.69)        # horizontal
A3_V = (11.69, 16.54)        # vertical: cada diagrama usa todo el ancho
A4_V = (8.27, 11.69)         # vertical
FILAS_TABLA = 46
NL = chr(10)
VERDE = "#1f7a8c"
ROJO = "#c0392b"
GRIS = "#2d3a45"

DIAGRAMAS = (
    ("DFN", "N", "Fuerza axial N (tonf)  ·  tracción +", -1),
    ("DFC", "V", "Fuerza cortante V (tonf)", -1),
    ("DMF", "M", "Momento flector M (tonf·m)  ·  del lado traccionado", 1),
)


# ------------------------------------------------------------------ datos
def resolver_portico(nombre, tipo, idx, npts=11):
    """Resuelve un pórtico de la torre (1.4CM + 1.7CV). Devuelve un dict con la
    geometría, los diagramas por barra y los máximos."""
    from core.constructor import construir
    from core.torre_arequipa import portico
    from core.torre_resultados import carga_combinada
    est = construir(carga_combinada(portico(tipo, idx)))
    est.resolver()
    barras = []
    for e in est.elementos:
        xs, N, V, M = est.fuerzas_internas(e, npts)
        barras.append({
            "nombre": e.nombre, "L": float(e.L),
            "tipo": "columna" if abs(e.cos) < 1e-6 else "viga" if abs(e.sin) < 1e-6 else "inclinada",
            "xi": float(e.ni.x), "yi": float(e.ni.y), "xj": float(e.nj.x), "yj": float(e.nj.y),
            "s": xs, "N": N, "V": V, "M": M,
        })
    nudos = [{"x": float(n.x), "y": float(n.y), "restr": tuple(n.restriccion)} for n in est.nudos]
    return {"nombre": nombre, "tipo": tipo, "barras": barras, "nudos": nudos}


def _extremo(v):
    """Valor de mayor módulo (con su signo)."""
    return float(v[int(np.argmax(np.abs(v)))])


def tabla_maximos(p):
    filas = []
    for b in p["barras"]:
        filas.append([b["nombre"], b["tipo"], f"{b['L']:.2f}",
                      f"{_extremo(b['N']):.2f}", f"{_extremo(b['V']):.2f}", f"{_extremo(b['M']):.2f}",
                      f"{float(np.max(b['M'])):.2f}", f"{float(np.min(b['M'])):.2f}"])
    return filas


COLS_TABLA = ["Barra", "Tipo", "L (m)", "N máx (tonf)", "V máx (tonf)", "M máx (tonf·m)", "M+ (tonf·m)", "M− (tonf·m)"]


# ------------------------------------------------------------------ dibujo
def _apoyos(ax, nudos, tam):
    tri = []
    for n in nudos:
        if n["restr"][0] and n["restr"][1]:
            x, y = n["x"], n["y"]
            tri.append([[x, y], [x - tam, y - tam * 1.4], [x + tam, y - tam * 1.4]])
    if tri:
        ax.add_collection(PolyCollection(tri, facecolors="#9aa5ad", edgecolors=GRIS, linewidths=0.5, zorder=1))


def _compuesto(polis, cerrar):
    """Un solo Path con todos los polígonos / polilíneas: matplotlib lo escribe como UN
    trazo en el PDF (en vez de uno por barra, que es lo que lo hacía lento)."""
    if not polis:
        return None
    return Path.make_compound_path(*[Path(np.asarray(q, float), closed=cerrar) for q in polis])


def _diagrama(ax, p, clave, titulo, lado):
    barras, nudos = p["barras"], p["nudos"]
    xs_all = [b[k] for b in barras for k in ("xi", "xj")]
    ys_all = [b[k] for b in barras for k in ("yi", "yj")]
    ext = max(max(xs_all) - min(xs_all), max(ys_all) - min(ys_all), 1.0)
    vmax = max(1e-9, max(float(np.max(np.abs(b[clave]))) for b in barras))
    k = 0.09 * ext / vmax
    ax.set_title(titulo, fontsize=10, loc="left")
    ax.add_collection(LineCollection([[(b["xi"], b["yi"]), (b["xj"], b["yj"])] for b in barras],
                                     colors=GRIS, linewidths=0.9, zorder=3))
    _apoyos(ax, nudos, ext * 0.012)
    glob = max(barras, key=lambda b: np.max(np.abs(b[clave])))
    pos_p, neg_p, lin_p, lin_n, cand = [], [], [], [], []
    for b in barras:
        v = b[clave]; s = b["s"]
        dx, dy = b["xj"] - b["xi"], b["yj"] - b["yi"]
        L = float(np.hypot(dx, dy)) or 1.0
        ux, uy = dx / L, dy / L
        # normal: igual que el visor (DMF hacia el lado traccionado; N y V al lado contrario)
        nx, ny = lado * uy, -lado * ux
        t = s / (s[-1] or 1.0)
        bx = b["xi"] + dx * t; by = b["yi"] + dy * t
        px = bx + nx * v * k; py = by + ny * v * k
        sg = [(v[q] + v[q + 1]) >= 0 for q in range(len(v) - 1)]
        q0 = 0
        for q in range(1, len(sg) + 1):                 # un polígono por tramo de igual signo
            if q == len(sg) or sg[q] != sg[q0]:
                idx = list(range(q0, q + 1))
                poli = [[bx[i], by[i]] for i in idx] + [[px[i], py[i]] for i in reversed(idx)]
                (pos_p if sg[q0] else neg_p).append(poli)
                q0 = q
        (lin_p if np.sum(v) >= 0 else lin_n).append(np.column_stack([px, py]))
        q = int(np.argmax(np.abs(v)))
        if abs(v[q]) >= 0.15 * vmax:
            sg1 = np.sign(v[q]) or 1.0
            cand.append((px[q] + nx * ext * 0.012 * sg1, py[q] + ny * ext * 0.012 * sg1, v[q], b is glob))
    for polis, col in ((pos_p, VERDE), (neg_p, ROJO)):
        c = _compuesto(polis, True)
        if c is not None:
            ax.add_patch(PathPatch(c, facecolor=col, alpha=0.30, linewidth=0, zorder=2, rasterized=False))
    for lins, col in ((lin_p, VERDE), (lin_n, ROJO)):
        c = _compuesto(lins, False)
        if c is not None:
            ax.add_patch(PathPatch(c, facecolor="none", edgecolor=col, linewidth=0.8, zorder=4))
    # etiquetas: sin amontonar (el global siempre; las demás si no pisan a otra ya puesta)
    ymax = max(ys_all) - min(ys_all)
    sep = ext * 0.028
    puestos = []
    for x, y, val, g in sorted(cand, key=lambda c: (not c[3], -abs(c[2]))):
        if not g and any(abs(x - a) < sep * 1.6 and abs(y - b2) < sep for a, b2 in puestos):
            continue
        puestos.append((x, y))
        ax.text(x, y, f"{val:.1f}", fontsize=8 if g else 6.5, fontweight="bold" if g else "normal",
                ha="center", va="center", color=VERDE if val >= 0 else ROJO, zorder=5,
                bbox=dict(boxstyle="square,pad=0.08", fc="white", ec="none", alpha=0.75))
    m = 0.13 * ext
    ax.set_xlim(min(xs_all) - m, max(xs_all) + m)
    ax.set_ylim(min(ys_all) - m, max(ys_all) + m)
    ax.set_aspect("equal", adjustable="box")
    ax.set_xticks([]); ax.set_yticks([])                # sin marcas: crearlas cuesta y no aportan
    for sp in ax.spines.values():
        sp.set_linewidth(0.4); sp.set_color("#9aa5ad")
    ax.text(0.995, 0.012, f"máx |{clave}| = {vmax:.2f}", transform=ax.transAxes, fontsize=8, color=GRIS, ha="right")


def pagina_portico(p, pagina):
    """Página A3 del pórtico. Pórticos anchos: vertical, con DFN, DFC y DMF a todo el ancho,
    uno debajo de otro. Pórticos altos y angostos (relación ancho/alto < 0.9): horizontal con
    los tres lado a lado, porque a todo el ancho quedarían diminutos entre dos franjas vacías."""
    xs = [b[k] for b in p["barras"] for k in ("xi", "xj")]
    ys = [b[k] for b in p["barras"] for k in ("yi", "yj")]
    ancho = (max(xs) - min(xs)) / max(max(ys) - min(ys), 1e-9)
    filas = ancho >= 0.9
    fig = Figure(figsize=A3_V if filas else A3_H)
    fig.suptitle(f"{p['nombre']}  ·  envolvente de diseño  1.4 CM + 1.7 CV", fontsize=14, fontweight="bold", y=0.985)
    ejes = fig.subplots(3, 1) if filas else fig.subplots(1, 3)
    for ax, (_, clave, titulo, lado) in zip(ejes, DIAGRAMAS):
        _diagrama(ax, p, clave, titulo, lado)
    fig.text(0.5, 0.012, f"Positivo en verde azulado, negativo en rojo. Se rotula el máximo de cada barra "
             f"(si pasa del 15 % del máximo del pórtico)." + (f"   Página {pagina}" if pagina else ""), ha="center", fontsize=8, color=GRIS)
    if filas:
        fig.subplots_adjust(left=0.03, right=0.97, top=0.95, bottom=0.03, hspace=0.12)
    else:
        fig.subplots_adjust(left=0.02, right=0.98, top=0.93, bottom=0.04, wspace=0.06)
    return fig


def paginas_tabla(p, pagina0):
    filas = tabla_maximos(p)
    trozos = [filas[i:i + FILAS_TABLA] for i in range(0, len(filas), FILAS_TABLA)] or [[]]
    figs = []
    for n, tr in enumerate(trozos):
        fig = Figure(figsize=A4_V)
        fig.suptitle(f"{p['nombre']} — máximos por barra", fontsize=12, fontweight="bold", y=0.97)
        ax = fig.add_axes([0.04, 0.04, 0.92, 0.88]); ax.axis("off")
        anch = [27, 9, 7, 13, 13, 15, 13, 13]
        fila = lambda xs: "".join((str(x)[:26].ljust(w) if i == 0 else str(x).center(w)) for i, (x, w) in enumerate(zip(xs, anch)))
        enc = fila(COLS_TABLA)
        lineas = [enc, "-" * len(enc)] + [fila(f) for f in tr]
        # un solo texto monoespaciado por página (cientos de textos sueltos hacen lento el PDF)
        ax.text(0.5, 1.0, NL.join(lineas), transform=ax.transAxes, ha="center", va="top",
                fontsize=6.6, family="monospace", linespacing=1.45)
        fig.text(0.5, 0.015, f"N, V y M: valor de mayor módulo en la barra, con su signo.   Tabla {n + 1}/{len(trozos)}" + (f"   ·   Página {pagina0 + n}" if pagina0 else ""),
                 ha="center", fontsize=8, color=GRIS)
        figs.append(fig)
    return figs


def portada(indice, segundos_estimados=None):
    fig = Figure(figsize=A4_V)
    ax = fig.add_axes([0, 0, 1, 1]); ax.axis("off")
    ax.text(0.5, 0.94, "Torre de Arequipa", ha="center", fontsize=24, fontweight="bold", color=GRIS)
    ax.text(0.5, 0.905, "Envolvente de diseño por eje", ha="center", fontsize=14, color=GRIS)
    ax.text(0.5, 0.88, "Combinación 1.4 CM + 1.7 CV  ·  tonf, m  ·  DFN, DFC y DMF por pórtico",
            ha="center", fontsize=9, color="#555")
    ax.text(0.5, 0.87, "Método sistematizado del profesor: matriz [A], barras 4×4, EA = ∞; N y reacciones por equilibrio de nudos",
            ha="center", fontsize=8, color="#555")
    ax.text(0.5, 0.85, datetime.date.today().strftime("%d/%m/%Y"), ha="center", fontsize=9, color="#555")
    ax.text(0.08, 0.82, "Índice", fontsize=13, fontweight="bold", color=GRIS)
    y = 0.79
    paso = min(0.0215, 0.75 / max(1, len(indice)))
    for nombre, dire, pag in indice:
        ax.text(0.08, y, nombre, fontsize=9)
        ax.text(0.50, y, dire, fontsize=9, color="#555")
        ax.text(0.92, y, str(pag), fontsize=9, ha="right")
        y -= paso
    return fig


# ------------------------------------------------------------------ principal
def _paginas_de(p, pdf):
    """Dibuja y guarda en `pdf` la página del pórtico y sus tablas. Devuelve cuántas páginas puso."""
    pdf.savefig(pagina_portico(p, None))
    figs = paginas_tabla(p, None)
    for f in figs:
        pdf.savefig(f)
    return 1 + len(figs)


def _precalentar():
    """Inicializador de cada proceso hijo: solo importa lo pesado (matplotlib, scipy, el
    constructor) mientras el padre arma el modelo base, para que no se sume en serie."""
    import core.constructor, core.torre_arequipa, core.torre_resultados  # noqa: F401


def _tarea_portico(base, lista, nombre, tipo, idx):
    """Proceso hijo, fase 1: resuelve el pórtico y dibuja su página. Recibe el modelo base y la
    lista de pórticos ya construidos por el padre (reconstruirlos cuesta unos 4 s por proceso).
    Devuelve (pórtico resuelto, bytes de un PDF de una página)."""
    from core import torre_plano
    if base is not None and torre_plano._BASE is None:
        torre_plano._BASE = base
        torre_plano._PORTICOS = lista
    p = resolver_portico(nombre, tipo, idx)
    buf = io.BytesIO()
    with PdfPages(buf) as pdf:
        pdf.savefig(pagina_portico(p, None))
    return p, buf.getvalue()


def _pdf_crudo_tablas(p):
    """Páginas de tabla escritas directo en PDF (Courier y Helvetica estándar, sin incrustar
    fuentes): matplotlib tardaba ~0.5 s por página de texto; esto, milisegundos.
    Devuelve (nº de páginas, bytes)."""
    filas = tabla_maximos(p)
    trozos = [filas[i:i + FILAS_TABLA] for i in range(0, len(filas), FILAS_TABLA)] or [[]]
    anch = [27, 9, 7, 13, 13, 15, 13, 13]
    cols = [c.replace("−", "-") for c in COLS_TABLA]
    fila = lambda xs: "".join((str(x)[:26].ljust(w) if i == 0 else str(x).center(w)) for i, (x, w) in enumerate(zip(xs, anch)))

    def esc(t):
        return t.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    def lin(font, size, x, y, texto, centro=False):
        b = esc(texto).encode("cp1252", "replace")
        if centro:                                      # ancho aproximado de Helvetica: 0.52 em
            x = x - 0.5 * 0.52 * size * len(texto)
        return b"BT /%s %.1f Tf %.1f %.1f Td (%s) Tj ET\n" % (font.encode(), size, x, y, b)

    W, H = 595.28, 841.89
    n = len(trozos)
    kids = " ".join(f"{4 + 2 * k} 0 R" for k in range(n))
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>",
            f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode(),
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"]
    for k, tr in enumerate(trozos):
        c = lin("F2", 12, W / 2, H - 38, f"{p['nombre']} — máximos por barra", centro=True)
        y = H - 62
        enc = fila(cols)
        for t in [enc, "-" * len(enc)] + [fila(f) for f in tr]:
            c += lin("F1", 8.0, 33, y, t); y -= 12.4
        c += lin("F3", 8, W / 2, 14, f"N, V y M: valor de mayor módulo en la barra, con su signo.   Tabla {k + 1}/{n}", centro=True)
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] /Contents {5 + 2 * k} 0 R "
                    f"/Resources << /Font << /F1 3 0 R /F2 {4 + 2 * n} 0 R /F3 {5 + 2 * n} 0 R >> >> >>".encode())
        objs.append(b"<< /Length %d >>\nstream\n" % len(c) + c + b"endstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    out = bytearray(b"%PDF-1.4\n"); offs = []
    for i, o in enumerate(objs):
        offs.append(len(out)); out += b"%d 0 obj\n" % (i + 1) + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for o in offs:
        out += b"%010d 00000 n \n" % o
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return n, bytes(out)


def _tarea_tablas(p):
    """Proceso hijo, fase 2: las páginas de tabla de un pórtico ya resuelto."""
    return _pdf_crudo_tablas(p)


def _unir_pdfs(trozos):
    """Une varios PDF (bytes) en uno. Devuelve None si no hay ninguna librería para unirlos."""
    try:
        from pypdf import PdfWriter, PdfReader
        w = PdfWriter()
        for t in trozos:
            w.append(PdfReader(io.BytesIO(t)))
        out = io.BytesIO(); w.write(out)
        return out.getvalue()
    except ImportError:
        pass
    try:
        import pymupdf as fitz                         # PyMuPDF
        doc = fitz.open()
        for t in trozos:
            with fitz.open(stream=t, filetype="pdf") as d:
                doc.insert_pdf(d)
        return doc.tobytes(garbage=4, deflate=True)
    except ImportError:
        return None


def _hay_unir():
    for m in ("pypdf", "pymupdf"):
        try:
            __import__(m)
            return True
        except ImportError:
            pass
    return False


def _hijos_posibles():
    """Procesos hijo a usar: 0 = todo en este proceso, pero con las páginas de tabla crudas."""
    return min(os.cpu_count() or 1, 8) if (os.cpu_count() or 1) > 1 else 0


def _info(n, paginas, t0, t_resolver, hijos):
    return {"porticos": n, "paginas": paginas, "segundos_resolver": round(t_resolver, 1),
            "segundos": round(time.time() - t0, 1), "procesos": hijos}


def _indice(datos):
    """datos: [(nombre, tipo, npag)] -> (índice de la portada, total de páginas)."""
    pag = 2; indice = []
    for nombre, tipo, npag in datos:
        indice.append((nombre, "dirección X (eje de letra)" if tipo == "letra" else "dirección Y (eje de número)", pag))
        pag += npag
    return indice, pag - 1


def _generar_paralelo(lista, progreso, hijos, t0):
    from concurrent.futures import ProcessPoolExecutor, wait, FIRST_COMPLETED
    import multiprocessing
    from core import torre_plano
    n = len(lista)
    paginas = [None] * n; tablas = [None] * n; datos = [None] * n
    if hijos == 0:                                     # un solo CPU: en este proceso, sin pool
        for i, x in enumerate(lista):
            datos[i], paginas[i] = _tarea_portico(None, None, *x)
            tablas[i] = _tarea_tablas(datos[i])
            if progreso:
                progreso(i + 1, n, datos[i]["nombre"])
    else:
        ctx = multiprocessing.get_context("spawn")     # seguro dentro de un servidor con hilos
        ex = ProcessPoolExecutor(max_workers=min(hijos, 2 * n), mp_context=ctx, initializer=_precalentar)
        try:
            # los hijos arrancan e importan mientras el padre arma el modelo base (una sola vez)
            # (sin la ruta del script principal en los hijos: si no, reimportan app.py entero)
            principal = sys.modules.get("__main__")
            guardado = {k: getattr(principal, k) for k in ("__file__", "__spec__") if hasattr(principal, k)}
            if principal is not None and "__file__" in guardado:
                del principal.__file__
                principal.__spec__ = None
            try:
                for _ in range(ex._max_workers):
                    ex.submit(int, 0)
            finally:
                for k, v in guardado.items():
                    setattr(principal, k, v)
            if progreso:
                progreso(0, n, "")
            base = torre_plano._modelo_base()
            lpor = torre_plano.todos_los_pórticos()
            fut = {ex.submit(_tarea_portico, base, lpor, *x): ("p", i) for i, x in enumerate(lista)}
            hechos = 0
            while fut:
                lis, _ = wait(list(fut), return_when=FIRST_COMPLETED)
                for f in lis:
                    tipo_t, i = fut.pop(f)
                    r = f.result()
                    hechos += 1                          # cada pórtico son dos tareas: dibujo y tablas
                    if tipo_t == "p":
                        datos[i], paginas[i] = r
                        fut[ex.submit(_tarea_tablas, datos[i])] = ("t", i)
                    else:
                        tablas[i] = r
                    if progreso:
                        progreso(hechos // 2, n, datos[i]["nombre"])
        finally:
            ex.shutdown(wait=False, cancel_futures=True)
    t_res = time.time() - t0
    indice, total = _indice([(d["nombre"], d["tipo"], 1 + tablas[i][0]) for i, d in enumerate(datos)])
    buf = io.BytesIO()
    with PdfPages(buf) as pdf:
        pdf.infodict()["Title"] = "Torre de Arequipa - envolvente de diseño por eje"
        pdf.savefig(portada(indice))
    trozos = [buf.getvalue()]
    for i in range(n):
        trozos += [paginas[i], tablas[i][1]]
    unido = _unir_pdfs(trozos)
    if unido is None:
        return None
    return unido, _info(n, total, t0, t_res, min(hijos, n))


def _generar_serie(lista, progreso, t0):
    n = len(lista)
    res = []
    for i, (nombre, tipo, idx) in enumerate(lista):
        res.append(resolver_portico(nombre, tipo, idx))
        if progreso:
            progreso(i + 1, n, nombre)
    t_res = time.time() - t0
    indice, total = _indice([(p["nombre"], p["tipo"], 1 + max(1, -(-len(p["barras"]) // FILAS_TABLA))) for p in res])
    buf = io.BytesIO()
    with PdfPages(buf) as pdf:
        pdf.infodict()["Title"] = "Torre de Arequipa - envolvente de diseño por eje"
        pdf.savefig(portada(indice))
        for p in res:
            _paginas_de(p, pdf)
    return buf.getvalue(), _info(n, total, t0, t_res, 0)


def generar_pdf(progreso=None, limite=None, procesos=None):
    """Devuelve (bytes del PDF, info). `progreso(i, n, nombre)` se llama tras cada
    pórtico terminado. `limite` (solo para pruebas) corta la lista de pórticos.
    `procesos`: nº de procesos hijos (0 = en este proceso; None = automático según CPU)."""
    from core.torre_arequipa import todos_los_pórticos
    t0 = time.time()
    lista = list(todos_los_pórticos())
    if limite:
        lista = lista[:limite]
    hijos = _hijos_posibles() if procesos is None else procesos
    if len(lista) < 3:
        hijos = 0                                      # no vale arrancar procesos por tan poco
    if _hay_unir():
        try:
            r = _generar_paralelo(lista, progreso, hijos, t0)
            if r is not None:
                return r
        except Exception:                              # sin procesos o sin permisos: se hace en serie
            import traceback; traceback.print_exc()
            pass
    return _generar_serie(lista, progreso, t0)

