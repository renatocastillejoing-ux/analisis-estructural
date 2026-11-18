# -*- coding: utf-8 -*-
"""
================================================================================
  TORRE AREQUIPA — modelo armado desde el plano del curso (core/torre_plano.json)
================================================================================
  La geometría sale del DXF «PLANO ACTUALIZADO ANALISIS» con tools/extraer_plano.py:
  ejes reales (vanos acotados), columnas C-1/C-2/C-3 con su caja, placas PL-1…PL-12
  partidas en tramos de muro sobre los ejes y vigas con la sección de su rótulo.

  Dos plantas: pisos 1–3 (planta completa) y pisos 4–10 (planta reducida: salen el
  eje 1 y el bloque A–B). Así, por ejemplo, el eje 9 queda partido por el vacío
  central (tramo A–E y tramo H–I) y pierde el tramo A–C desde el 4.º piso.

  Cómo se modela cada cosa (pórticos por eje, como en el curso):
    - Nudo en cada cruce de ejes con columna, en el centro de cada tramo de placa y
      en cada cruce con una viga del otro sentido.
    - Placa = columna ancha en el centro del tramo (sección largo × espesor). Las
      vigas de su eje llegan a ese centro con brazo rígido de medio largo de placa.
      Si una viga del otro sentido llega a la placa lejos de su centro, ahí va una
      columna de borde de espesor × espesor (el ala que la recibe).
    - Vigas entre nudos consecutivos del eje, con la sección del plano (40×40 si
      el tramo no tiene rótulo).
    - Losa: CM 0.40 t/m² y CV 0.25 t/m², repartida en dos direcciones a las vigas
      del paño que la encierra; el vacío central no lleva losa.
  Supuestos que el plano no trae (los mismos que antes): 3.00 m por piso, f'c 280
  en pisos 1–3 y 210 en 4–10, base empotrada, 1.4CM + 1.7CV.
================================================================================
"""
import json, os
from collections import defaultdict

H_PISO = 3.0
N_PISOS = 10
CM_AREA = 0.40
CV_AREA = 0.25
GAMMA_HA = 2.4
COMBO = {"nombre": "1.4CM+1.7CV", "factores": {"CM": 1.4, "CV": 1.7}}
# vacío central (sin losa), en nombres de ejes: x desde/hasta, y desde/hasta
VACIOS = [("8", "14", "H", "F")]
_RUTA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "torre_plano.json")
_GEO = None
_TOL = 1e-6
BORDE = 0.30          # un cruce a menos de esto del extremo de una placa es parte de la placa


def geo():
    global _GEO
    if _GEO is None:
        with open(_RUTA, encoding="utf-8") as f:
            _GEO = json.load(f)
    return _GEO


def _mat(piso):
    return "H280" if piso <= 3 else "H210"


def _zona(piso):
    for z in geo()["zonas"]:
        if z["pisos"][0] <= piso <= z["pisos"][1]:
            return z
    raise ValueError(f"El piso {piso} no tiene planta en el plano")


def _r(v):
    return round(float(v), 3)


def planta(z):
    """Planta de una zona: puntos (x, y) → info, barras horizontales y elementos verticales."""
    G = geo(); ex, ey = G["ejes_x"], G["ejes_y"]
    pts = {}                       # (x, y) → {"nombre", "ejes": (num, letra) o None}

    def punto(x, y, nombre):
        k = (_r(x), _r(y))
        pts.setdefault(k, nombre)
        return k

    verticales = []                # (punto, sección dict, prefijo, giro)
    cols = {(c["x"], c["y"]): c for c in z["columnas"]}
    muros = defaultdict(list)      # (dir, eje) → [(desde, hasta, placa)]
    for p in z["placas"]:
        muros[(p["dir"], p["eje"])].append((p["desde"], p["hasta"], p))

    def en_muro(dir_, eje, s):
        return next((pl for a, b, pl in muros.get((dir_, eje), []) if a - BORDE <= s <= b + BORDE), None)

    # vigas por eje: intervalos (s0, s1, sección)
    vig = defaultdict(list)
    for v in z["vigas"]:
        ejes_s = ex if v["dir"] == "x" else ey
        vig[(v["dir"], v["eje"])].append((ejes_s[v["desde"]], ejes_s[v["hasta"]], v))

    vig_todas = defaultdict(list)
    for zz in G["zonas"]:
        for v in zz["vigas"]:
            ejes_s = ex if v["dir"] == "x" else ey
            vig_todas[(v["dir"], v["eje"])].append((ejes_s[v["desde"]], ejes_s[v["hasta"]], v))

    # 1) columnas en cruces (salvo que caigan dentro de una placa: la placa manda)
    for (nx, ny), c in cols.items():
        if en_muro("x", ny, ex[nx]) or en_muro("y", nx, ey[ny]):
            continue
        k = punto(ex[nx], ey[ny], f"{ny}{nx}")
        verticales.append((k, {"b": c["bx"], "h": c["by"]}, "C", 0, f"{ny}{nx}"))
    huerfanas = []
    # 2) placas: nudo en el centro del tramo. Si ninguna viga de su propio eje llega a
    #    la placa (p. ej. las del borde en el eje 15), el nudo va en el cruce donde
    #    llega la viga perpendicular más cercana al centro.
    for (dir_, eje), lst in muros.items():
        for a, b, p in lst:
            s = (a + b) / 2
            # se decide con las vigas de TODAS las plantas, para que la placa quede en el
            # mismo nudo en todos los pisos (si no, se cortaría al cambiar de planta)
            propias = any(min(v1, b + BORDE) - max(v0, a - BORDE) >= 0 for v0, v1, _ in vig_todas.get((dir_, eje), []))
            if not propias:
                otro = "y" if dir_ == "x" else "x"
                ejes_otro = ex if dir_ == "x" else ey
                c_eje = ey[eje] if dir_ == "x" else ex[eje]
                cruces = [ejes_otro[n] for (d2, n), l2 in vig_todas.items() if d2 == otro and a - BORDE <= ejes_otro[n] <= b + BORDE
                          and any(v0 - BORDE <= c_eje <= v1 + BORDE for v0, v1, _ in l2)]
                if cruces:
                    s = min(cruces, key=lambda c: abs(c - (a + b) / 2))
                else:
                    huerfanas.append((dir_, eje, a, b, p))
                    continue
            x, y = (s, ey[eje]) if dir_ == "x" else (ex[eje], s)
            k = punto(x, y, f"{p['nombre']}·{eje}")
            verticales.append((k, {"b": round(b - a, 3), "h": p["t"]}, "PL", 0 if dir_ == "x" else 90,
                               f"{p['nombre']}({eje} {a:.1f}–{b:.1f})"))
    # 2b) tramo de placa sin ninguna viga (p. ej. el ala de una placa en L en el borde):
    #     trabaja junto con el otro tramo de la misma placa, en su mismo nudo.
    for dir_, eje, a, b, p in huerfanas:
        socio = next((v for v in verticales if v[2] == "PL" and v[4].startswith(p["nombre"] + "(")), None)
        if socio is None:
            continue
        verticales.append((socio[0], {"b": round(b - a, 3), "h": p["t"]}, "PL", 0 if dir_ == "x" else 90,
                           f"{p['nombre']}({eje} {a:.1f}–{b:.1f}, ala)"))
    # 3) cruces de vigas del otro sentido (y bordes de placa con viga perpendicular)
    for (dir_, eje), lst in vig.items():
        for s0, s1, v in lst:
            for nombre_eje, s in ((v["desde"], s0), (v["hasta"], s1)):
                x, y = (s, ey[eje]) if dir_ == "x" else (ex[eje], s)
                k = punto(x, y, f"{eje}{nombre_eje}" if dir_ == "x" else f"{nombre_eje}{eje}")
                # ¿el extremo cae dentro de una placa del otro sentido? → columna de borde
                otro = "y" if dir_ == "x" else "x"
                eje_otro = nombre_eje
                pl = en_muro(otro, eje_otro, ey[eje] if dir_ == "x" else ex[eje])
                if pl and not any(vv[0] == k for vv in verticales):
                    centro = (pl["desde"] + pl["hasta"]) / 2
                    if abs(centro - (ey[eje] if dir_ == "x" else ex[eje])) > 0.3:
                        verticales.append((k, {"b": pl["t"], "h": pl["t"]}, "BP", 0, f"borde {pl['nombre']} {pts[k]}"))
    # 4) vigas por eje: entre puntos consecutivos de la línea. Los cruces que quedan
    #    dentro de una placa no cortan la línea: la viga llega al centro de la placa y
    #    el motor le pone un brazo rígido de medio largo de placa.
    centros = {v[0] for v in verticales if v[2] == "PL"}
    horizontales = []
    for dir_, ejes_fijos in (("x", ey), ("y", ex)):
        for eje, c in ejes_fijos.items():
            sk = (lambda k: k[0]) if dir_ == "x" else (lambda k: k[1])
            muros_l = muros.get((dir_, eje), [])
            linea = sorted([k for k in pts if abs((k[1] if dir_ == "x" else k[0]) - c) < _TOL
                            and (k in centros or not any(a - BORDE <= sk(k) <= b + BORDE for a, b, _ in muros_l))], key=sk)
            for k1, k2 in zip(linea, linea[1:]):
                s1, s2 = sk(k1), sk(k2)
                libres = [(s1, s2)]
                for a, b, _ in muros_l:                     # parte del tramo fuera de placas
                    nuevo = []
                    for u, w in libres:
                        if b <= u or a >= w: nuevo.append((u, w)); continue
                        if a > u: nuevo.append((u, a))
                        if b < w: nuevo.append((b, w))
                    libres = nuevo
                libres = [t for t in libres if t[1] - t[0] > 0.05]
                if not libres:
                    continue
                mid = sum((u + w) / 2 * (w - u) for u, w in libres) / sum(w - u for u, w in libres)
                v = next((vv for a, b, vv in vig.get((dir_, eje), []) if a - 0.05 <= mid <= b + 0.05), None)
                if v:
                    horizontales.append((k1, k2, {"b": v["b"], "h": v["h"]}, f"V{eje}"))
    lineas_muro = [(d_, (ey[e_] if d_ == "x" else ex[e_]), a, b) for (d_, e_), l in muros.items() for a, b, _ in l]
    return {"pts": pts, "verticales": verticales, "horizontales": horizontales, "muros": lineas_muro}


def _sec_nombre(pref, d, piso=None):
    return f"{pref}{int(round(d['b'] * 100))}x{int(round(d['h'] * 100))}"


def modelo3d_torre(dinamico=True):
    """La torre real en el formato del editor 3D (core/analisis_3d.py)."""
    from core.torre_sismo import Z, S, TP, TL, U, R, CT
    G = geo(); ex, ey = G["ejes_x"], G["ejes_y"]
    plantas = {z["nombre"]: planta(z) for z in G["zonas"]}
    pl_piso = {p: plantas[_zona(p)["nombre"]] for p in range(1, N_PISOS + 1)}
    secs = {}
    nudos, nid = [], {}

    def nudo(k, lv, nombre):
        key = (k, lv)
        if key not in nid:
            nid[key] = len(nudos) + 1
            nudos.append({"id": nid[key], "nombre": f"{nombre}-{lv}", "x": k[0], "y": k[1], "z": lv * H_PISO,
                          "apoyo": "empotrado" if lv == 0 else "libre"})
        return nid[key]

    els, avisos = [], []

    def add(i, j, sec, mat, nombre, giro=0):
        e = {"id": len(els) + 1, "nombre": nombre, "i": i, "j": j, "seccion": sec, "material": mat}
        if giro: e["giro"] = giro
        els.append(e)

    # vigas y enlaces por nivel (losa del piso lv)
    for lv in range(1, N_PISOS + 1):
        P = pl_piso[lv]
        for k1, k2, sec, nombre in P["horizontales"]:
            i = nudo(k1, lv, P["pts"][k1]); j = nudo(k2, lv, P["pts"][k2])
            n = _sec_nombre("V", sec); secs.setdefault(n, {"nombre": n, "b": sec["b"], "h": sec["h"]})
            add(i, j, n, _mat(lv), f"{nombre}·{P['pts'][k1]}–{P['pts'][k2]}-{lv}")
    # columnas y placas por piso. Una columna o placa sigue la de abajo: si en la planta
    # de arriba su nudo cambió de sitio (p. ej. la placa ya no recibe la misma viga),
    # se mantiene donde estaba; si arriba no le llega viga, su nudo queda libre y lo
    # mueve el diafragma.
    ubic = {}
    for p in range(1, N_PISOS + 1):
        P = pl_piso[p]
        nuevo = {}
        for k, sec, pref, giro, nombre in P["verticales"]:
            if nombre in ubic:                       # sigue sobre la de abajo
                k = ubic[nombre]
            if p > 1 and (k, p - 1) not in nid:
                if True:
                    if pref != "BP":
                        avisos.append(f"Piso {p}: {nombre} nace sobre un punto sin vigas abajo; se omite")
                    continue
            if (k, p) not in nid and pref == "BP":
                continue
            nombre_n = P["pts"].get(k) or pl_piso[p - 1]["pts"].get(k, nombre) if p > 1 else P["pts"].get(k, nombre)
            n = _sec_nombre(pref, sec); secs.setdefault(n, {"nombre": n, "b": sec["b"], "h": sec["h"]})
            add(nudo(k, p - 1, nombre_n), nudo(k, p, nombre_n), n, _mat(p), f"{pref} {nombre}-{p}", giro)
            nuevo[nombre] = k
        ubic = nuevo

    muros_z = {round(lv * H_PISO, 6): pl_piso[lv]["muros"] for lv in range(1, N_PISOS + 1)}
    cb, cn = cargas_losa(nudos, els, muros_z)
    m = {
        "tipo": "3d", "nombre": "Torre de Arequipa (plano)", "unidad_fuerza": "tonf", "unidad_longitud": "m",
        "ejes": {"x": [{"nombre": n, "c": c} for n, c in ex.items()],
                 "y": [{"nombre": n, "c": c} for n, c in sorted(ey.items(), key=lambda t: t[1])]},
        "niveles": [{"nombre": "Base" if lv == 0 else f"Piso {lv}", "z": lv * H_PISO} for lv in range(N_PISOS + 1)],
        "materiales": [{"nombre": "H280", "modo": "fc", "fc": 280, "densidad": GAMMA_HA, "nu": 0.2},
                       {"nombre": "H210", "modo": "fc", "fc": 210, "densidad": GAMMA_HA, "nu": 0.2}],
        "material": "H280", "secciones": list(secs.values()), "nudos": nudos, "elementos": els,
        "casos": [{"nombre": "CM"}, {"nombre": "CV"}],
        "cargas_area": [], "cargas_barras": cb, "cargas_nudos": cn,
        "peso_propio": True, "caso_peso_propio": "CM", "diafragma": True,
        "brazos_rigidos": {"modo": "placas", "factor": 1.0},
        "sismo": {"activo": True, "dinamico": bool(dinamico), "Z": Z, "U": U, "S": S, "R": R, "TP": TP, "TL": TL,
                  "CT": CT, "periodo": "norma", "caso_masa": {"CM": 1.0, "CV": 0.25}},
        "combinaciones": [], "avisos": avisos,
    }
    return m


def _en_vacio(x, y):
    G = geo(); ex, ey = G["ejes_x"], G["ejes_y"]
    for x0, x1, y0, y1 in VACIOS:
        if min(ex[x0], ex[x1]) < x < max(ex[x0], ex[x1]) and min(ey[y0], ey[y1]) < y < max(ey[y0], ey[y1]):
            return True
    return False


def cargas_losa(nudos, els, muros_z=None):
    """Losa en dos direcciones: cada celda de la retícula se asigna al paño de vigas
    que la encierra; cada paño reparte su carga (triángulos y trapecios) a las barras
    de sus cuatro bordes, como el reparto del motor 3D."""
    pos = {n["id"]: (n["x"], n["y"], n["z"]) for n in nudos}
    por_z = defaultdict(list)
    for e in els:
        a, b = pos[e["i"]], pos[e["j"]]
        if abs(a[2] - b[2]) < _TOL:
            por_z[round(a[2], 6)].append(e)
    out, out_n, nod = [], [], defaultdict(float)
    for z, lst in sorted(por_z.items()):
        lin_x = defaultdict(list); lin_y = defaultdict(list)         # y → [(x0,x1,e)], x → [(y0,y1,e)]
        # las placas también cierran paños: su parte de losa baja por la placa (carga en su nudo)
        nudos_z = [n for n in nudos if abs(n["z"] - z) < _TOL]
        for d_, c, a, b in (muros_z or {}).get(z, []):
            cerca = min(nudos_z, key=lambda n: (abs((n["y"] if d_ == "x" else n["x"]) - c)
                                                + max(0.0, a - (n["x"] if d_ == "x" else n["y"]))
                                                + max(0.0, (n["x"] if d_ == "x" else n["y"]) - b)))
            muro = {"id": None, "nudo": cerca["id"], "largo": b - a}
            (lin_x if d_ == "x" else lin_y)[round(c, 3)].append((a, b, muro))
        for e in lst:
            (x0, y0, _), (x1, y1, _) = pos[e["i"]], pos[e["j"]]
            if abs(y0 - y1) < _TOL: lin_x[round(y0, 3)].append((min(x0, x1), max(x0, x1), e))
            elif abs(x0 - x1) < _TOL: lin_y[round(x0, 3)].append((min(y0, y1), max(y0, y1), e))
        xs = sorted({round(p[0], 3) for e in lst for p in (pos[e["i"]], pos[e["j"]])}
                    | {round(v, 3) for l in lin_y.values() for t in l if t[2]["id"] is None for v in (t[0], t[1])}
                    | {c for c, l in lin_y.items() if any(t[2]["id"] is None for t in l)})
        ys = sorted({round(p[1], 3) for e in lst for p in (pos[e["i"]], pos[e["j"]])}
                    | {round(v, 3) for l in lin_x.values() for t in l if t[2]["id"] is None for v in (t[0], t[1])}
                    | {c for c, l in lin_x.items() if any(t[2]["id"] is None for t in l)})

        def lin_len(e):
            (x0, y0, _), (x1, y1, _) = pos[e["i"]], pos[e["j"]]
            return ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5

        def cubierto(lin, c, a, b):
            tot = sum(max(0.0, min(b, s1) - max(a, s0)) for s0, s1, _ in lin.get(c, []))
            return tot >= 0.9 * (b - a)
        acum = defaultdict(float)                     # (elem, caso) → wz
        for i in range(len(xs) - 1):
            for j in range(len(ys) - 1):
                xa, xb, ya, yb = xs[i], xs[i + 1], ys[j], ys[j + 1]
                if _en_vacio((xa + xb) / 2, (ya + yb) / 2):
                    continue
                l = i
                while l >= 0 and not cubierto(lin_y, xs[l], ya, yb): l -= 1
                r = i + 1
                while r < len(xs) and not cubierto(lin_y, xs[r], ya, yb): r += 1
                d = j
                while d >= 0 and not cubierto(lin_x, ys[d], xa, xb): d -= 1
                u = j + 1
                while u < len(ys) and not cubierto(lin_x, ys[u], xa, xb): u += 1
                if l < 0 or r >= len(xs) or d < 0 or u >= len(ys):
                    continue                          # celda sin vigas alrededor (borde libre)
                x0, x1, y0, y1 = xs[l], xs[r], ys[d], ys[u]
                # la celda reparte SU área con las fracciones del paño que la encierra
                # (triángulos y trapecios, dos direcciones): cada m² se cuenta una vez
                lx, ly = x1 - x0, y1 - y0
                a_, bb = min(lx, ly), max(lx, ly)
                tri = a_ * a_ / 4.0; trap = (a_ * bb - 2 * tri) / 2.0
                fx = (tri if lx <= ly else trap) / (lx * ly)      # a cada borde en X
                fy = (trap if lx <= ly else tri) / (lx * ly)      # a cada borde en Y
                area = (xb - xa) * (yb - ya)
                for lin, cs, f, s0_, s1_ in ((lin_x, (y0, y1), fx, x0, x1), (lin_y, (x0, x1), fy, y0, y1)):
                    for c in cs:
                        tramo = [(max(s0_, u0), min(s1_, u1), e) for u0, u1, e in lin.get(c, []) if min(s1_, u1) - max(s0_, u0) > _TOL]
                        largo = sum(t1 - t0 for t0, t1, _ in tramo)
                        if largo <= 0: continue
                        for t0, t1, e in tramo:
                            if e["id"] is None:               # tramo de placa: carga al nudo de la placa
                                for caso, q in (("CM", CM_AREA), ("CV", CV_AREA)):
                                    nod[(e["nudo"], caso)] += q * area * f * (t1 - t0) / largo
                                continue
                            Le = abs(lin_len(e))
                            for caso, q in (("CM", CM_AREA), ("CV", CV_AREA)):
                                # fuerza que toca a este tramo, repartida en toda la barra
                                acum[(e["id"], caso)] += q * area * f * (t1 - t0) / largo / Le
        for (eid, caso), w in sorted(acum.items()):
            out.append({"elem": eid, "caso": caso, "tipo": "uniforme", "wz": -round(w, 5)})
    for (nid_, caso), P in sorted(nod.items()):
        out_n.append({"nudo": nid_, "caso": caso, "F": [0, 0, -round(P, 4), 0, 0, 0]})
    return out, out_n


# ------------------------------------------------------------------ pórticos 2D

def _componentes(d):
    """Partes conexas (sin contar la base) de un pórtico 2D."""
    padre = {n["id"]: n["id"] for n in d["nudos"]}
    def f(a):
        while padre[a] != a:
            padre[a] = padre[padre[a]]; a = padre[a]
        return a
    for e in d["elementos"]:
        padre[f(e["i"])] = f(e["j"])
    grupos = defaultdict(list)
    for n in d["nudos"]:
        grupos[f(n["id"])].append(n["id"])
    return sorted(grupos.values(), key=lambda ids: min(next(n["x"] for n in d["nudos"] if n["id"] == i) for i in ids))


_PORTICOS = None


def todos_los_pórticos():
    """[(nombre, tipo, idx)]: un pórtico por eje y por tramo conexo (el eje 9, por
    ejemplo, sale en dos partes: A–E y H–I)."""
    global _PORTICOS
    if _PORTICOS is None:
        from core.analisis_3d import portico_desde_3d
        G = geo(); m = _modelo_base()
        out = []
        for tipo, eje3d, ejes, otros in (("letra", "x", G["ejes_y"], G["ejes_x"]), ("numero", "y", G["ejes_x"], G["ejes_y"])):
            orden = sorted(ejes.items(), key=lambda t: -t[1]) if tipo == "letra" else sorted(ejes.items(), key=lambda t: t[1])
            for nombre, c in orden:
                d = portico_desde_3d(m, eje3d, c)
                if not d["elementos"]:
                    continue
                comps = _componentes(d)
                for k, ids in enumerate(comps):
                    g = set(ids)
                    y_de = {n["id"]: n["y"] for n in d["nudos"]}
                    if not any(e["i"] in g and abs(y_de[e["i"]] - y_de[e["j"]]) < _TOL for e in d["elementos"]):
                        continue                    # columna suelta (sus vigas van en el otro sentido)
                    xs = sorted(n["x"] for n in d["nudos"] if n["id"] in g)
                    tramo = (_eje_de(xs[0], otros, -1), _eje_de(xs[-1], otros, +1))
                    etq = f"Eje {nombre}" + (f" ({tramo[0]}–{tramo[1]})" if len(comps) > 1 else "")
                    out.append((etq, tipo, (nombre, k)))
        _PORTICOS = out
    return _PORTICOS


def _eje_de(c, ejes, lado):
    """Eje en c; si c es el centro de una placa, el eje anterior (lado −1) o siguiente (+1)."""
    n, v = min(ejes.items(), key=lambda t: abs(t[1] - c))
    if abs(v - c) < 0.05:
        return n
    cand = [(t[1], t[0]) for t in ejes.items() if (t[1] < c if lado < 0 else t[1] > c)]
    if not cand:
        return n
    return (max(cand) if lado < 0 else min(cand))[1]


_BASE = None


def _modelo_base():
    global _BASE
    if _BASE is None:
        _BASE = modelo3d_torre()
    return _BASE


def portico(tipo, idx):
    """Pórtico 2D (formato de constructor.construir) con casos CM y CV separados."""
    from core.analisis_3d import portico_desde_3d
    G = geo(); m = _modelo_base()
    if isinstance(idx, int):                                # compatibilidad: índice en la lista
        idx = next(i for (_, t, i) in todos_los_pórticos() if t == tipo and False) if False else \
            [i for (_, t, i) in todos_los_pórticos() if t == tipo][idx]
    nombre, parte = idx
    eje3d, c = ("x", G["ejes_y"][nombre]) if tipo == "letra" else ("y", G["ejes_x"][nombre])
    casos = []
    base = None
    for caso in ("CM", "CV"):
        d = portico_desde_3d(m, eje3d, c, {caso: 1.0})
        ids = set(_componentes(d)[parte]) if len(_componentes(d)) > parte else {n["id"] for n in d["nudos"]}
        d["nudos"] = [n for n in d["nudos"] if n["id"] in ids]
        d["elementos"] = [e for e in d["elementos"] if e["i"] in ids]
        eids = {e["id"] for e in d["elementos"]}
        ce = [x for x in d["cargas_elementos"] if x["elem"] in eids]
        casos.append({"nombre": caso, "cargas_nodales": [], "cargas_elementos": ce})
        base = d
    etq = next(n for (n, t, i) in todos_los_pórticos() if t == tipo and i == (nombre, parte))
    base["nombre"] = f"Torre · {etq}"
    base["cargas_elementos"] = []
    base["casos"] = casos
    base["combinaciones"] = [COMBO]
    return base


def geometria_3d():
    """Geometría para el visor 3D (columnas, placas y vigas con su caja)."""
    m = _modelo_base()
    pos = {n["id"]: n for n in m["nudos"]}
    secs = {s["nombre"]: s for s in m["secciones"]}
    columnas, vigas = [], []
    for e in m["elementos"]:
        a, b = pos[e["i"]], pos[e["j"]]
        s = secs[e["seccion"]]
        if abs(a["x"] - b["x"]) < _TOL and abs(a["y"] - b["y"]) < _TOL:
            giro = e.get("giro", 0)
            bx, by = (s["b"], s["h"]) if not giro else (s["h"], s["b"])
            columnas.append({"x": a["x"], "y": a["y"], "z0": a["z"], "z1": b["z"], "piso": int(round(b["z"] / H_PISO)),
                             "bx": bx, "by": by, "placa": e["seccion"].startswith("PL"), "seccion": e["seccion"],
                             "letra": None, "numero": None})
        else:
            vigas.append({"x0": a["x"], "y0": a["y"], "x1": b["x"], "y1": b["y"], "z": a["z"], "b": s["b"], "h": s["h"],
                          "piso": int(round(a["z"] / H_PISO)), "dir": "x" if abs(a["y"] - b["y"]) < _TOL else "y",
                          "seccion": e["seccion"], "letra": None, "numero": None})
    G = geo()
    return {"xs": sorted(G["ejes_x"].values()), "ys": sorted(G["ejes_y"].values()), "n_pisos": N_PISOS, "h_piso": H_PISO,
            "ejes_x": [n for n, _ in sorted(G["ejes_x"].items(), key=lambda t: t[1])],
            "ejes_y": [n for n, _ in sorted(G["ejes_y"].items(), key=lambda t: t[1])],
            "columnas": columnas, "vigas": vigas,
            "supuestos": {"cm": CM_AREA, "cv": CV_AREA, "fuente": G.get("fuente")}}
