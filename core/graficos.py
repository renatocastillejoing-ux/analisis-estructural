# -*- coding: utf-8 -*-
"""
Graficos del metodo matricial de rigidez.
Cada figura puede guardarse en archivo o devolverse como PNG en base64
para embeberla directamente en la interfaz web.
Paleta: Museo Larco (teal/navy/canvas + estados).
"""
import io
import base64
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPolygon, FancyArrowPatch

# Paleta Museo Larco
C_BARRA = "#201E43"     # navy
C_NUDO  = "#201E43"
C_POS   = "#508C9B"     # teal  (positivos)
C_NEG   = "#D4855A"     # warning/amber (negativos)
C_DEF   = "#508C9B"
C_CARGA = "#3A6B78"     # teal-dark
C_APOYO = "#3A3A3A"
C_GRID  = "#EBF3F5"


def fig_to_base64(fig, dpi=140):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return "data:image/png;base64," + base64.b64encode(buf.read()).decode("ascii")


def _salida(fig, archivo):
    if archivo:
        fig.savefig(archivo, dpi=140, bbox_inches="tight")
        plt.close(fig)
        return archivo
    return fig_to_base64(fig)


def _limites(est, margen=0.20):
    xs = [n.x for n in est.nudos]; ys = [n.y for n in est.nudos]
    dx = max(xs)-min(xs) or 1.0; dy = max(ys)-min(ys) or 1.0
    d = max(dx, dy)
    return (min(xs)-margen*d, max(xs)+margen*d,
            min(ys)-margen*d, max(ys)+margen*d, d)


def _formato(ax, x0, x1, y0, y1):
    ax.set_xlim(x0, x1); ax.set_ylim(y0, y1)
    ax.set_aspect("equal", adjustable="box")
    ax.grid(True, ls=":", lw=0.6, color=C_GRID, alpha=1)
    ax.set_xlabel("X [m]", fontsize=9, color=C_BARRA)
    ax.set_ylabel("Y [m]", fontsize=9, color=C_BARRA)
    ax.tick_params(colors="#888", labelsize=8)
    for sp in ["top", "right"]:
        ax.spines[sp].set_visible(False)
    for sp in ["left", "bottom"]:
        ax.spines[sp].set_color("#CBDDE1")


def _dibujar_apoyo(ax, nudo, tam):
    r = nudo.restriccion; x, y = nudo.x, nudo.y
    if r == (1, 1, 1):
        ax.plot([x-tam, x+tam], [y, y], color=C_APOYO, lw=2.5)
        for k in np.linspace(-tam, tam, 5):
            ax.plot([x+k, x+k-0.4*tam], [y, y-0.5*tam], color=C_APOYO, lw=1.1)
    elif r == (1, 1, 0):
        ax.plot([x, x-0.7*tam, x+0.7*tam, x], [y, y-tam, y-tam, y], color=C_APOYO, lw=2)
        ax.plot([x-tam, x+tam], [y-tam, y-tam], color=C_APOYO, lw=2.5)
    elif r in [(0, 1, 0), (0, 1, 1)]:
        ax.plot([x, x-0.7*tam, x+0.7*tam, x], [y, y-tam, y-tam, y], color=C_APOYO, lw=2)
        ax.plot([x-tam, x+tam], [y-1.35*tam, y-1.35*tam], color=C_APOYO, lw=2.5)
    elif r in [(1, 0, 0), (1, 0, 1)]:
        ax.plot([x, x-tam, x-tam, x], [y, y-0.7*tam, y+0.7*tam, y], color=C_APOYO, lw=2)


def _dibujar_geometria(ax, est, tam, etiquetas=True):
    for e in est.elementos:
        ax.plot([e.ni.x, e.nj.x], [e.ni.y, e.nj.y], color=C_BARRA, lw=3,
                solid_capstyle="round", zorder=2)
        # marca de rotulas
        if e.release_i:
            ax.plot(e.ni.x + 0.12*tam, e.ni.y, "o", mfc="white", mec=C_BARRA,
                    ms=6, mew=1.5, zorder=6)
        if e.release_j:
            ax.plot(e.nj.x - 0.12*tam, e.nj.y, "o", mfc="white", mec=C_BARRA,
                    ms=6, mew=1.5, zorder=6)
        if etiquetas:
            xm = (e.ni.x+e.nj.x)/2; ym = (e.ni.y+e.nj.y)/2
            ax.annotate(e.nombre, (xm, ym), color=C_BARRA, fontsize=8.5,
                        fontweight="bold", ha="center", va="center",
                        bbox=dict(boxstyle="round,pad=0.18", fc="white",
                                  ec="#CBDDE1", lw=0.9), zorder=4)
    for n in est.nudos:
        ax.plot(n.x, n.y, "o", color=C_NUDO, ms=6.5, zorder=5)
        if etiquetas:
            ax.annotate(n.nombre, (n.x, n.y), color="#3A6B78", fontsize=8,
                        ha="left", va="bottom", xytext=(5, 5),
                        textcoords="offset points", zorder=5)
        _dibujar_apoyo(ax, n, tam)


def _dibujar_cargas(ax, est, d):
    tam = 0.05*d
    for e in est.elementos:
        L = e.L; c, s = e.cos, e.sin
        for carga in e.cargas:
            if carga.tipo == "distribuida":
                # respetar tramos parciales a, b
                a0 = 0.0 if carga.a is None else max(0.0, carga.a)
                b0 = L if carga.b is None else min(L, carga.b)
                if b0 <= a0:
                    continue
                npts = 9
                ts = np.linspace(0, 1, npts)
                # positions along the loaded portion
                xs = e.ni.x + ((a0 + ts*(b0 - a0))/L)*(e.nj.x - e.ni.x)
                ys = e.ni.y + ((a0 + ts*(b0 - a0))/L)*(e.nj.y - e.ni.y)
                # interpolate wx and wy across the loaded portion
                wxa = carga.wx1 + (carga.wx2 - carga.wx1)*(a0/L)
                wxb = carga.wx1 + (carga.wx2 - carga.wx1)*(b0/L)
                wya = carga.wy1 + (carga.wy2 - carga.wy1)*(a0/L)
                wyb = carga.wy1 + (carga.wy2 - carga.wy1)*(b0/L)
                wxv = wxa + ts*(wxb - wxa)
                wyv = wya + ts*(wyb - wya)
                wmag = np.hypot(wxv, wyv)
                wmax = max(np.max(wmag), 1e-9)
                hbase = 0.10*d
                # direction of each arrow (global components)
                uxv = np.where(wmag > 1e-9, wxv / wmag, 0)
                uyv = np.where(wmag > 1e-9, wyv / wmag, -1)
                hh = hbase * (wmag / wmax)
                # tail positions (away from element in load direction)
                tx = xs + uxv * hh
                ty = ys + uyv * hh
                # top line connecting tails
                ax.plot(tx, ty, color=C_CARGA, lw=1.1)
                for xx, yy, ttx, tty in zip(xs, ys, tx, ty):
                    dist = np.hypot(ttx - xx, tty - yy)
                    if dist > 1e-9:
                        ax.annotate("", xy=(xx, yy), xytext=(ttx, tty),
                                    arrowprops=dict(arrowstyle="->", color=C_CARGA, lw=0.9))
                # label
                if carga.uniforme:
                    w_ref = np.hypot(carga.wx1 or 0, carga.wy1 or 0)
                    etq = f"w={w_ref:g}"
                else:
                    w1m = np.hypot(carga.wx1 or 0, carga.wy1 or 0)
                    w2m = np.hypot(carga.wx2 or 0, carga.wy2 or 0)
                    etq = f"{w1m:g}~{w2m:g}"
                midx = (e.ni.x + e.nj.x) / 2
                midy = (e.ni.y + e.nj.y) / 2
                # label offset: use average load direction
                avg_wx = float(np.mean(wxv))
                avg_wy = float(np.mean(wyv))
                avg_mag = np.hypot(avg_wx, avg_wy) or 1
                ax.annotate(etq, (midx - avg_wx/avg_mag * hbase * 1.5,
                                  midy - avg_wy/avg_mag * hbase * 1.5),
                            color=C_CARGA, ha="center", fontsize=8, fontweight="bold")
            elif carga.tipo == "puntual":
                a = carga.a if carga.a is not None else L/2
                bx = e.ni.x + (a/L)*(e.nj.x-e.ni.x)
                by = e.ni.y + (a/L)*(e.nj.y-e.ni.y)
                P = np.hypot(carga.Px, carga.Py)
                ux = carga.Px/P if P else 0; uy = carga.Py/P if P else -1
                ax.annotate("", xy=(bx, by), xytext=(bx-0.13*d*ux, by-0.13*d*uy),
                            arrowprops=dict(arrowstyle="->", color=C_CARGA, lw=2))
                ax.annotate(f"{P:g}", (bx-0.13*d*ux, by-0.13*d*uy), color=C_CARGA,
                            fontsize=8, fontweight="bold", ha="center")
            elif carga.tipo == "momento":
                a = carga.a if carga.a is not None else L/2
                bx = e.ni.x + (a/L)*(e.nj.x-e.ni.x)
                by = e.ni.y + (a/L)*(e.nj.y-e.ni.y)
                rr = 0.05*d
                if carga.M >= 0:
                    th = np.linspace(0.3, 2.2*np.pi, 40)  # CCW
                else:
                    th = np.linspace(2.2*np.pi, 0.3, 40)  # CW
                ax.plot(bx+rr*np.cos(th), by+rr*np.sin(th), color=C_CARGA, lw=1.6)
                ax.annotate("", xy=(bx+rr*np.cos(th[-1]), by+rr*np.sin(th[-1])),
                            xytext=(bx+rr*np.cos(th[-3]), by+rr*np.sin(th[-3])),
                            arrowprops=dict(arrowstyle="->", color=C_CARGA, lw=1.6))
                ax.annotate(f"M={carga.M:g}", (bx, by+rr*1.6), color=C_CARGA,
                            fontsize=8, fontweight="bold", ha="center")
    # cargas nodales
    for n in est.nudos:
        Fx, Fy = n.carga[0], n.carga[1]
        if Fx != 0:
            dx = 0.13*d*np.sign(Fx)
            ax.annotate("", xy=(n.x, n.y), xytext=(n.x-dx, n.y),
                        arrowprops=dict(arrowstyle="->", color="#B23A2E", lw=2.4))
            ax.annotate(f"{abs(Fx):g}", (n.x-dx, n.y), color="#B23A2E",
                        fontsize=8.5, fontweight="bold", ha="center", va="bottom")
        if Fy != 0:
            dy = 0.13*d*np.sign(Fy)
            ax.annotate("", xy=(n.x, n.y), xytext=(n.x, n.y-dy),
                        arrowprops=dict(arrowstyle="->", color="#B23A2E", lw=2.4))
            ax.annotate(f"{abs(Fy):g}", (n.x, n.y-dy), color="#B23A2E",
                        fontsize=8.5, fontweight="bold", ha="left")


# ============================== FIGURAS ======================================
def plot_modelo(est, archivo=None):
    x0, x1, y0, y1, d = _limites(est)
    fig, ax = plt.subplots(figsize=(8.4, 6.0))
    _dibujar_geometria(ax, est, 0.05*d)
    _dibujar_cargas(ax, est, d)
    ax.set_title("Modelo estructural", fontsize=12, fontweight="bold", color=C_BARRA)
    _formato(ax, x0, x1, y0, y1)
    return _salida(fig, archivo)


def plot_deformada(est, archivo=None, factor=None):
    x0, x1, y0, y1, d = _limites(est)
    tam = 0.05*d
    dmax = max((abs(est.D[n.gdl[k]]) for n in est.nudos for k in (0, 1)), default=0)
    if factor is None:
        factor = (0.12*d/dmax) if dmax > 0 else 1.0
    fig, ax = plt.subplots(figsize=(8.4, 6.0))
    for e in est.elementos:
        ax.plot([e.ni.x, e.nj.x], [e.ni.y, e.nj.y], color="#C9CFD8", lw=1.5, zorder=1)
    for n in est.nudos:
        _dibujar_apoyo(ax, n, tam)
    for e in est.elementos:
        dofs = est._dofs_elemento(e)
        dl = e.matriz_T() @ est.D[dofs]
        ui, vi, ti, uj, vj, tj = dl
        L = e.L; c, s = e.cos, e.sin
        xi = np.linspace(0, 1, 30); x = xi*L
        u = (1-xi)*ui + xi*uj
        N1 = 1-3*xi**2+2*xi**3; N2 = L*(xi-2*xi**2+xi**3)
        N3 = 3*xi**2-2*xi**3;   N4 = L*(-xi**2+xi**3)
        v = N1*vi + N2*ti + N3*vj + N4*tj
        gx = c*u - s*v; gy = s*u + c*v
        px = e.ni.x + xi*(e.nj.x-e.ni.x) + factor*gx
        py = e.ni.y + xi*(e.nj.y-e.ni.y) + factor*gy
        ax.plot(px, py, color=C_DEF, lw=2.6, zorder=3)
    for n in est.nudos:
        ax.plot(n.x+factor*est.D[n.gdl[0]], n.y+factor*est.D[n.gdl[1]],
                "o", color=C_DEF, ms=5, zorder=4)
    ax.set_title(f"Deformada (factor x{factor:.0f})", fontsize=12,
                 fontweight="bold", color=C_BARRA)
    _formato(ax, x0, x1, y0, y1)
    return _salida(fig, archivo)


def _plot_diagrama(est, magnitud, archivo, titulo, signo_traccion=False):
    x0, x1, y0, y1, d = _limites(est)
    tam = 0.05*d
    vmax = 1e-12; datos = {}
    for e in est.elementos:
        xs, N, V, M = est.fuerzas_internas(e, 61)
        arr = {"N": N, "V": V, "M": M}[magnitud]
        datos[e.id] = (xs, arr); vmax = max(vmax, np.max(np.abs(arr)))
    escala = 0.16*d/vmax
    fig, ax = plt.subplots(figsize=(8.4, 6.0))
    for n in est.nudos:
        _dibujar_apoyo(ax, n, tam)
    for e in est.elementos:
        ax.plot([e.ni.x, e.nj.x], [e.ni.y, e.nj.y], color=C_BARRA, lw=2.5, zorder=4)
    for e in est.elementos:
        xs, arr = datos[e.id]; L = e.L; c, s = e.cos, e.sin
        pdx, pdy = (-s, c)
        if signo_traccion:
            pdx, pdy = (s, -c)
        ax_px = e.ni.x + (xs/L)*(e.nj.x-e.ni.x)
        ax_py = e.ni.y + (xs/L)*(e.nj.y-e.ni.y)
        dg_px = ax_px + escala*arr*pdx; dg_py = ax_py + escala*arr*pdy
        for k in range(len(xs)-1):
            poly = np.array([[ax_px[k], ax_py[k]], [ax_px[k+1], ax_py[k+1]],
                             [dg_px[k+1], dg_py[k+1]], [dg_px[k], dg_py[k]]])
            val = 0.5*(arr[k]+arr[k+1])
            ax.add_patch(MplPolygon(poly, closed=True,
                                    fc=(C_POS if val >= 0 else C_NEG),
                                    ec="none", alpha=0.42, zorder=2))
        ax.plot(dg_px, dg_py, color="#444", lw=1.2, zorder=3)
        ax.plot([ax_px[0], dg_px[0]], [ax_py[0], dg_py[0]], color="#444", lw=1)
        ax.plot([ax_px[-1], dg_px[-1]], [ax_py[-1], dg_py[-1]], color="#444", lw=1)
        for k in [0, -1]:
            ax.annotate(f"{arr[k]:.2f}", (dg_px[k], dg_py[k]), fontsize=7.5,
                        color="#201E43", fontweight="bold", ha="center", va="center",
                        zorder=6, bbox=dict(boxstyle="round,pad=0.12", fc="white",
                                            ec="#CBDDE1", lw=0.6, alpha=0.95))
        im = np.argmax(np.abs(arr))
        if im not in (0, len(xs)-1):
            ax.annotate(f"{arr[im]:.2f}", (dg_px[im], dg_py[im]), fontsize=7.5,
                        color="#201E43", fontweight="bold", ha="center", va="center",
                        zorder=6, bbox=dict(boxstyle="round,pad=0.12", fc="#FBF0E6",
                                            ec="#D4855A", lw=0.7))
    for n in est.nudos:
        ax.plot(n.x, n.y, "o", color=C_NUDO, ms=5, zorder=5)
    ax.set_title(titulo, fontsize=12, fontweight="bold", color=C_BARRA)
    _formato(ax, x0, x1, y0, y1)
    return _salida(fig, archivo)


def plot_DMF(est, archivo=None):
    return _plot_diagrama(est, "M", archivo,
                          "DMF - Momento Flector  [lado traccionado]", signo_traccion=True)


def plot_DFC(est, archivo=None):
    return _plot_diagrama(est, "V", archivo, "DFC / DMC - Fuerza Cortante")


def plot_DFN(est, archivo=None):
    return _plot_diagrama(est, "N", archivo, "DFN - Fuerza Normal (Axial)")


def generar_todas_base64(est):
    """Devuelve dict con las 5 figuras en base64 para la interfaz web."""
    return {
        "modelo":    plot_modelo(est),
        "deformada": plot_deformada(est),
        "dmf":       plot_DMF(est),
        "dfc":       plot_DFC(est),
        "dfn":       plot_DFN(est),
    }
