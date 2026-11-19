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
import time

import numpy as np
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.figure import Figure
from matplotlib.patches import Rectangle
from matplotlib.collections import LineCollection, PolyCollection

A3_H = (16.54, 11.69)        # horizontal
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


def _diagrama(ax, p, clave, titulo, lado):
    barras, nudos = p["barras"], p["nudos"]
    xs_all = [b[k] for b in barras for k in ("xi", "xj")]
    ys_all = [b[k] for b in barras for k in ("yi", "yj")]
    ext = max(max(xs_all) - min(xs_all), max(ys_all) - min(ys_all), 1.0)
    vmax = max(1e-9, max(float(np.max(np.abs(b[clave]))) for b in barras))
    k = 0.09 * ext / vmax
    ax.set_title(titulo, fontsize=9)
    ax.add_collection(LineCollection([[(b["xi"], b["yi"]), (b["xj"], b["yj"])] for b in barras],
                                     colors=GRIS, linewidths=0.9, zorder=3))
    _apoyos(ax, nudos, ext * 0.012)
    glob = max(barras, key=lambda b: np.max(np.abs(b[clave])))
    pos_p, neg_p, lineas, col_l, textos = [], [], [], [], []
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
        lineas.append(np.column_stack([px, py])); col_l.append(VERDE if np.sum(v) >= 0 else ROJO)
        q = int(np.argmax(np.abs(v)))
        if abs(v[q]) >= 0.15 * vmax:
            sg = np.sign(v[q]) or 1.0
            textos.append((px[q] + nx * ext * 0.012 * sg, py[q] + ny * ext * 0.012 * sg, v[q], b is glob))
    ax.add_collection(PolyCollection(pos_p, facecolors=VERDE, alpha=0.30, linewidths=0, zorder=2))
    ax.add_collection(PolyCollection(neg_p, facecolors=ROJO, alpha=0.30, linewidths=0, zorder=2))
    ax.add_collection(LineCollection(lineas, colors=col_l, linewidths=0.7, zorder=4))
    for x, y, val, g in textos:
        ax.text(x, y, f"{val:.1f}", fontsize=6.5 if g else 5, fontweight="bold" if g else "normal",
                ha="center", va="center", color=VERDE if val >= 0 else ROJO, zorder=5)
    m = 0.10 * ext
    ax.set_xlim(min(xs_all) - m, max(xs_all) + m)
    ax.set_ylim(min(ys_all) - m, max(ys_all) + m)
    ax.set_aspect("equal", adjustable="box")
    ax.tick_params(labelsize=6, labelbottom=False, labelleft=False, length=0)
    ax.grid(True, lw=0.2, alpha=0.5)
    ax.text(0.01, 0.01, f"máx |{clave}| = {vmax:.2f}", transform=ax.transAxes, fontsize=7, color=GRIS)


def pagina_portico(p, pagina):
    fig = Figure(figsize=A3_H)
    fig.suptitle(f"{p['nombre']}  ·  envolvente de diseño  1.4 CM + 1.7 CV", fontsize=14, fontweight="bold", y=0.98)
    ejes = fig.subplots(1, 3)
    for ax, (_, clave, titulo, lado) in zip(ejes, DIAGRAMAS):
        _diagrama(ax, p, clave, titulo, lado)
    fig.text(0.5, 0.015, f"Positivo en verde azulado, negativo en rojo. Se rotula el máximo de cada barra "
             f"(si pasa del 15 % del máximo del pórtico).   Página {pagina}", ha="center", fontsize=8, color=GRIS)
    fig.subplots_adjust(left=0.04, right=0.99, top=0.92, bottom=0.05, wspace=0.12)
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
        fig.text(0.5, 0.015, f"N, V y M: valor de mayor módulo en la barra, con su signo.   Tabla {n + 1}/{len(trozos)}   ·   Página {pagina0 + n}",
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
def generar_pdf(progreso=None, limite=None):
    """Devuelve (bytes del PDF, info). `progreso(i, n, nombre)` se llama tras cada
    pórtico resuelto. `limite` (solo para pruebas) corta la lista de pórticos."""
    from core.torre_arequipa import todos_los_pórticos
    t0 = time.time()
    lista = list(todos_los_pórticos())
    if limite:
        lista = lista[:limite]
    n = len(lista)
    res = []
    for i, (nombre, tipo, idx) in enumerate(lista):
        res.append(resolver_portico(nombre, tipo, idx))
        if progreso:
            progreso(i + 1, n, nombre)
    t_resolver = time.time() - t0
    # numeración de páginas (portada = 1)
    pag = 2; indice = []; plan = []
    for p in res:
        npag_tabla = max(1, -(-len(p["barras"]) // FILAS_TABLA))
        indice.append((p["nombre"], "dirección X (eje de letra)" if p["tipo"] == "letra" else "dirección Y (eje de número)", pag))
        plan.append((p, pag))
        pag += 1 + npag_tabla
    buf = io.BytesIO()
    with PdfPages(buf) as pdf:
        info = pdf.infodict()
        info["Title"] = "Torre de Arequipa - envolvente de diseño por eje"
        pdf.savefig(portada(indice))
        for p, pg in plan:
            pdf.savefig(pagina_portico(p, pg))
            for f in paginas_tabla(p, pg + 1):
                pdf.savefig(f)
    return buf.getvalue(), {"porticos": n, "paginas": pag - 1, "segundos_resolver": round(t_resolver, 1),
                            "segundos": round(time.time() - t0, 1)}
