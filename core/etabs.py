# -*- coding: utf-8 -*-
"""
Comparación con ETABS.

Lee la tabla «Element Forces - Frames» exportada de ETABS (.xlsx o .csv; columnas
típicas Story, Beam/Column/Frame/Unique Name, Output Case, Station, P, V2, M3) y la
compara con las fuerzas de extremo de cada barra calculadas por el sistema.

Emparejamiento de barras:
  1. por NOMBRE: la columna de nombre se elige (por defecto la que más barras casa);
  2. si ningún nombre casa, por COORDENADAS: si el archivo trae las columnas de
     coordenadas (Xi/Yi/Zi, Xj/Yj/Zj de la barra, o X/Y/Z de cada estación), se
     empareja por los extremos (con tolerancia).

Extremo i = estación mínima de la barra en ETABS, extremo j = estación máxima.
En el sistema se normaliza igual que el método del profesor: columnas de abajo
hacia arriba y vigas de izquierda a derecha.

Signos: ETABS y este sistema no usan la misma convención. Por defecto se comparan
los MÓDULOS (|valor|); con modo="signo" se comparan tal cual.
Diferencia % = |sistema − ETABS| / max(|ETABS|, piso), donde piso = 1 % del mayor
|valor| de esa magnitud: así un valor casi nulo no dispara un porcentaje sin sentido.
"""
import csv
import io
import re
import unicodedata

import numpy as np

UMBRAL_VERDE = 5.0
UMBRAL_AMBAR = 15.0
MAGNITUDES = ("P", "V", "M")
ALIAS = {
    "P": ("p", "n", "axial", "fx", "f1"),
    "V": ("v2", "v", "v22", "fy", "f2"),
    "M": ("m3", "m", "m33", "mz"),
    "estacion": ("station", "estacion", "elemstation", "stationm"),
    "caso": ("outputcase", "case", "combo", "combination", "loadcase", "caso", "combinacion"),
    "paso": ("steptype",),
}
NOMBRES_TIPICOS = ("uniquename", "label", "frame", "beam", "column", "element", "elemento", "name", "nombre",
                   "beamcolumn", "framename", "frameelem", "unique name")
COORD = {"xi": "xi", "yi": "yi", "zi": "zi", "xj": "xj", "yj": "yj", "zj": "zj"}


def _norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float, np.floating)):
        return float(v)
    s = str(v).strip()
    s = s.replace(",", ".") if s.count(",") == 1 and "." not in s else s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


# ------------------------------------------------------------------ lectura
def _filas_csv(contenido):
    for cod in ("utf-8-sig", "latin-1"):
        try:
            texto = contenido.decode(cod); break
        except UnicodeDecodeError:
            continue
    muestra = "\n".join(texto.splitlines()[:5])
    delim = max(",;\t|", key=muestra.count)
    return [list(f) for f in csv.reader(io.StringIO(texto), delimiter=delim)]


def _filas_xlsx(contenido):
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
    mejor = None
    for ws in wb.worksheets:
        filas = [list(r) for r in ws.iter_rows(values_only=True)]
        if mejor is None:
            mejor = filas
        # preferir la hoja que parezca la tabla de fuerzas
        if any("station" in _norm(c) or "estacion" in _norm(c) for f in filas[:6] for c in f if c):
            return filas
    return mejor or []


def leer_tabla(contenido, nombre_archivo=""):
    """Devuelve (columnas, filas[dict]) a partir de un .xlsx o .csv de ETABS."""
    if nombre_archivo.lower().endswith((".xlsx", ".xlsm")) or contenido[:2] == b"PK":
        filas = _filas_xlsx(contenido)
    else:
        filas = _filas_csv(contenido)
    # fila de encabezado: la primera con «Station» / «Estación» o, si no, con P y V2/M3
    h = None
    for i, f in enumerate(filas[:15]):
        ns = {_norm(c) for c in f if c not in (None, "")}
        if ns & {"station", "estacion", "elemstation"} or ({"p", "v2", "m3"} <= ns):
            h = i; break
    if h is None:
        raise ValueError("No encuentro el encabezado de la tabla: debe traer al menos Station (o Estación), P, V2 y M3.")
    cab = [str(c).strip() if c not in (None, "") else f"col{j + 1}" for j, c in enumerate(filas[h])]
    cuerpo = filas[h + 1:]
    # fila de unidades (p. ej. «m», «kN», «kN-m»): la estación no es un número
    ie = next((j for j, c in enumerate(cab) if _norm(c) in ALIAS["estacion"]), None)
    if cuerpo and ie is not None and ie < len(cuerpo[0]) and _num(cuerpo[0][ie]) is None:
        cuerpo = cuerpo[1:]
    out = []
    for f in cuerpo:
        if not any(c not in (None, "") for c in f):
            continue
        out.append({cab[j]: (f[j] if j < len(f) else None) for j in range(len(cab))})
    if not out:
        raise ValueError("La tabla de ETABS no tiene filas de datos.")
    return cab, out


def _col(cab, clave):
    ali = ALIAS[clave]
    for a in ali:                                  # respeta el orden de preferencia
        for c in cab:
            if _norm(c) == a:
                return c
    return None


# ------------------------------------------------------------------ ETABS agrupado por barra
def _agrupar(cab, filas, col_nombre, caso, modo):
    cP, cV, cM = (_col(cab, k) for k in MAGNITUDES)
    cS, cC, cPaso = _col(cab, "estacion"), _col(cab, "caso"), _col(cab, "paso")
    faltan = [n for n, c in (("P", cP), ("V2", cV), ("M3", cM), ("Station", cS)) if c is None]
    if faltan:
        raise ValueError("Faltan columnas en el archivo de ETABS: " + ", ".join(faltan) + f". Columnas leídas: {', '.join(cab)}.")
    cn = {_norm(c): c for c in cab}
    cx = {k: cn.get(k) for k in COORD}
    cx1 = {k: next((c for c in cab if _norm(c) == k), None) for k in ("x", "y", "z")}
    casos = []
    if cC:
        for f in filas:
            c = str(f.get(cC)).strip()
            if c not in casos and f.get(cC) not in (None, ""):
                casos.append(c)
    caso_usado = caso if (caso in casos) else (casos[0] if casos else None)
    grupos = {}
    for f in filas:
        if cC and caso_usado is not None and str(f.get(cC)).strip() != caso_usado:
            continue
        nom = str(f.get(col_nombre)).strip() if col_nombre else ""
        if not nom or nom == "None":
            continue
        s = _num(f.get(cS))
        if s is None:
            continue
        g = grupos.setdefault(nom, {"est": {}, "coord": {}})
        v = (_num(f.get(cP)), _num(f.get(cV)), _num(f.get(cM)))
        if None in v:
            continue
        # varias filas en la misma estación (Max/Min): se queda el de mayor módulo en modo abs, el primero en signo
        previo = g["est"].get(s)
        if previo is None or (modo == "abs" and max(abs(x) for x in v) > max(abs(x) for x in previo)):
            g["est"][s] = v
        c = {k: _num(f.get(col)) for k, col in cx.items() if col}
        if all(c.get(k) is not None for k in ("xi", "xj")):
            g["coord"] = c
        elif any(cx1.values()):
            g["coord"].setdefault("est", {})[s] = {k: _num(f.get(col)) for k, col in cx1.items() if col}
    return grupos, casos, caso_usado


def _extremos_etabs(g):
    est = g["est"]
    if not est:
        return None
    ss = sorted(est)
    return {"i": est[ss[0]], "j": est[ss[-1]]}


def _puntos_etabs(g):
    """((x1,v1),(x2,v2)) en plano vertical (horizontal, vertical) o None."""
    c = g.get("coord") or {}
    if "xi" in c and "xj" in c:
        def hv(sf):
            x = c.get("x" + sf); y = c.get("y" + sf); z = c.get("z" + sf)
            return x, (z if z is not None else y)
        return hv("i"), hv("j")
    e = c.get("est")
    if e:
        ss = sorted(e)
        def hv2(d):
            return d.get("x"), (d.get("z") if d.get("z") is not None else d.get("y"))
        return hv2(e[ss[0]]), hv2(e[ss[-1]])
    return None


# ------------------------------------------------------------------ sistema
def fuerzas_sistema(est):
    """{nombre: {"i":(P,V,M), "j":(P,V,M), "p":((x,y),(x,y)), "L":L}} en unidades del usuario,
    con el extremo i abajo (columnas) o a la izquierda (vigas)."""
    cf = getattr(est, "_conv_f", 1.0) or 1.0
    cl = getattr(est, "_conv_l", 1.0) or 1.0
    out = {}
    for e in est.elementos:
        xs, N, V, M = est.fuerzas_internas(e, 3)
        a = (float(N[0]) / cf, float(V[0]) / cf, float(M[0]) / (cf * cl))
        b = (float(N[-1]) / cf, float(V[-1]) / cf, float(M[-1]) / (cf * cl))
        pi, pj = (e.ni.x / cl, e.ni.y / cl), (e.nj.x / cl, e.nj.y / cl)
        vertical = abs(e.cos) < 1e-6
        invertida = (e.nj.y < e.ni.y) if vertical else (e.nj.x < e.ni.x)
        if invertida:
            a, b, pi, pj = b, a, pj, pi
        out[e.nombre] = {"i": a, "j": b, "p": (pi, pj), "L": float(e.L) / cl, "orig": e.nombre}
    return out


def _clasif(dif):
    if dif is None:
        return "sin"
    return "ok" if dif <= UMBRAL_VERDE else "medio" if dif <= UMBRAL_AMBAR else "alto"


def _emparejar_coords(sis, grupos, tol):
    """Empareja por extremos (en cualquier orden). Devuelve {nombre_sis: nombre_etabs}."""
    par = {}
    libres = dict(grupos)
    for ns, d in sis.items():
        (x1, y1), (x2, y2) = d["p"]
        for ne, g in list(libres.items()):
            pe = _puntos_etabs(g)
            if not pe:
                continue
            (a1, b1), (a2, b2) = pe
            if None in (a1, b1, a2, b2):
                continue
            if (abs(a1 - x1) < tol and abs(b1 - y1) < tol and abs(a2 - x2) < tol and abs(b2 - y2) < tol) or \
               (abs(a1 - x2) < tol and abs(b1 - y2) < tol and abs(a2 - x1) < tol and abs(b2 - y1) < tol):
                par[ns] = ne; libres.pop(ne); break
    return par


def comparar(est, contenido, nombre_archivo="", col_nombre=None, caso=None, modo="abs",
             factor_fuerza=1.0, factor_momento=None, forzar_coordenadas=False, tol=0.05):
    """Compara el modelo resuelto `est` con la tabla de ETABS. Devuelve un dict JSON."""
    modo = "signo" if modo == "signo" else "abs"
    ff = float(factor_fuerza or 1.0)
    fm = float(factor_momento) if factor_momento not in (None, "", 0) else ff
    cab, filas = leer_tabla(contenido, nombre_archivo)
    sis = fuerzas_sistema(est)
    norm_sis = {_norm(n): n for n in sis}

    # columnas candidatas para el nombre; la que más barras casa gana si el usuario no elige
    candidatas = [c for c in cab if _norm(c) in NOMBRES_TIPICOS or _norm(c).startswith(("uniquename", "label", "frame", "beam"))]
    candidatas += [c for c in cab if c not in candidatas and _num(next((f.get(c) for f in filas if f.get(c) not in (None, "")), None)) is None
                   and _norm(c) not in ("story", "outputcase", "casetype", "steptype", "piso", "case")]
    def aciertos(c):
        return len({_norm(f.get(c)) for f in filas} & set(norm_sis))
    if col_nombre not in cab:
        col_nombre = max(candidatas, key=aciertos) if candidatas else None
    n_nombre = aciertos(col_nombre) if col_nombre else 0

    grupos, casos, caso_usado = _agrupar(cab, filas, col_nombre, caso, modo)
    metodo = "nombre"
    par = {}
    if n_nombre and not forzar_coordenadas:
        gn = {_norm(k): k for k in grupos}
        par = {ns: gn[_norm(ns)] for ns in sis if _norm(ns) in gn}
    if not par:
        # por coordenadas: probar con cada columna candidata como nombre de barra
        for c in ([col_nombre] if col_nombre else []) + [x for x in candidatas if x != col_nombre]:
            g2, casos2, cu2 = _agrupar(cab, filas, c, caso, modo)
            p2 = _emparejar_coords(sis, g2, tol)
            if p2:
                grupos, par, metodo, col_nombre, caso_usado, casos = g2, p2, "coordenadas", c, cu2, casos2
                break
    if not par:
        raise ValueError("No pude emparejar ninguna barra. Ni los nombres de la columna "
                         f"«{col_nombre}» coinciden con los del modelo, ni el archivo trae coordenadas. "
                         "Elige otra columna de nombre o exporta la tabla con las barras nombradas como en el modelo "
                         f"({', '.join(list(sis)[:8])}…).")

    # valores y piso por magnitud
    valores = []
    for ns, ne in par.items():
        ex = _extremos_etabs(grupos[ne])
        if not ex:
            continue
        for extremo in ("i", "j"):
            s = sis[ns][extremo]
            e = ex[extremo]
            e = (e[0] * ff, e[1] * ff, e[2] * fm)
            valores.append((ns, ne, extremo, s, e))
    pisos = []
    for k in range(3):
        mx = max([max(abs(v[3][k]), abs(v[4][k])) for v in valores] + [1e-12])
        pisos.append(0.01 * mx)
    filas_out = []
    peor = {m: 0.0 for m in MAGNITUDES}
    cuenta = {"ok": 0, "medio": 0, "alto": 0}
    for ns, ne, extremo, s, e in valores:
        fila = {"barra": ns, "etabs": ne, "extremo": extremo}
        for k, m in enumerate(MAGNITUDES):
            sv, ev = (abs(s[k]), abs(e[k])) if modo == "abs" else (s[k], e[k])
            dif = abs(sv - ev) / max(abs(ev), pisos[k]) * 100.0
            niv = _clasif(dif)
            peor[m] = max(peor[m], dif); cuenta[niv] += 1
            fila[m] = {"sis": float(sv), "etabs": float(ev), "dif": float(dif), "nivel": niv}
        filas_out.append(fila)
    return {
        "ok": True, "metodo": metodo, "modo": modo, "col_nombre": col_nombre, "columnas": cab,
        "casos": casos, "caso": caso_usado, "filas": filas_out,
        "sin_pareja_modelo": [n for n in sis if n not in par],
        "sin_pareja_etabs": [n for n in grupos if n not in set(par.values())][:50],
        "resumen": {"barras": len(par), "peor": {m: round(v, 2) for m, v in peor.items()}, "celdas": cuenta,
                    "umbrales": [UMBRAL_VERDE, UMBRAL_AMBAR]},
    }
