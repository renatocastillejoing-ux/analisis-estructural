# -*- coding: utf-8 -*-
"""
Extrae la geometría estructural de la torre desde el plano DXF del curso
(«PLANO ACTUALIZADO ANALISIS.dxf») y la guarda en core/torre_plano.json.

Uso (desde analisis_estructural_web/):
    python tools/extraer_plano.py "ruta/al/PLANO ACTUALIZADO ANALISIS.dxf"

Qué lee (unidades del DXF = metros; los vanos acotados 4.80 + .50 lo confirman):
  - Dos plantas: «PRIMER AL TERCER PISO» (zona 1) y «TERCER PISO AL DÉCIMO» (zona 2,
    la misma retícula desplazada). La zona 1 vale para los pisos 1–3 y la zona 2
    para los pisos 4–10 (la reducción empieza en el 4.º piso).
  - Ejes: coordenadas fijas de la retícula (de los círculos de eje y del centro de
    las columnas). Origen: eje 1 (x = 0) y eje I (y = 0), y hacia el eje A.
  - Columnas: polilíneas de la capa COLUMNA, unidas por intersección de ejes
    (cada una se asigna al cruce más cercano; sección = su caja).
  - Placas: polilíneas de la capa PLACAS. Cada placa (recta, en L o en U) se parte
    en tramos de muro sobre los ejes que recorre (franja de ±0.6 m); un tramo vale
    si mide ≥ 1.0 m. Espesor = ancho medido en la franja.
  - Vigas: líneas de las capas VIGA/VIGAS sobre cada eje (franja de ±0.45 m). Una
    viga existe entre dos apoyos consecutivos si las líneas cubren ≥ 50 % del tramo.
    Sección: rótulo «Vxx-(bXh)» más cercano dentro del tramo; si no hay, 40×40.
"""
import json, math, os, re, sys
from collections import defaultdict

import ezdxf
from shapely.geometry import LineString, Polygon, box
from shapely.ops import polygonize, unary_union

# --- retícula, en el sistema de la planta de la zona 1 -------------------------
EJES_X = {"1": 1738.106, "2": 1744.606, "3": 1749.906, "4": 1755.206, "5": 1760.456,
          "6": 1761.256, "7": 1765.926, "8": 1766.806, "9": 1774.016, "10": 1779.316,
          "11": 1784.616, "12": 1789.916, "13": 1795.216, "14": 1800.516, "15": 1806.866}
EJES_Y = {"A": 1753.596, "B": 1742.326, "C": 1738.519, "D": 1737.446, "E": 1730.876,
          "F": 1729.326, "G": 1723.736, "H": 1718.886, "I": 1711.646}
X0, Y0 = EJES_X["1"], EJES_Y["I"]
ZONAS = [  # (nombre, pisos, desplazamiento de la planta respecto de la zona 1, ventana x)
    {"nombre": "Pisos 1–3", "pisos": [1, 3], "dx": 0.0, "dy": 0.0, "xmin": 1728, "xmax": 1815},
    {"nombre": "Pisos 4–10", "pisos": [4, 10], "dx": 92.277, "dy": 1.407, "xmin": 1828, "xmax": 1910},
]
YMIN = 1705.0
FRANJA_PLACA, FRANJA_VIGA = 1.1, 1.0
# líneas de VIGA que en el plano son borde del vacío central, no vigas (revisado a ojo con el plano)
SIN_VIGA = {("x", "F", "8", "12"), ("y", "12", "E", "F")}
RE_VIGA = re.compile(r"^(V\d+)\s*-?\s*\((\d+)\s*[Xx]\s*(\d+)\)")


def _cerca(v, ejes, tol):
    k = min(ejes, key=lambda n: abs(ejes[n] - v))
    return k if abs(ejes[k] - v) <= tol else None


def _texto(e):
    return e.dxf.text if e.dxftype() == "TEXT" else e.plain_text()


def extraer(ruta):
    doc = ezdxf.readfile(ruta)
    msp = doc.modelspace()
    salida = {"fuente": os.path.basename(ruta), "unidades": "m",
              "ejes_x": {k: round(v - X0, 3) for k, v in EJES_X.items()},
              "ejes_y": {k: round(v - Y0, 3) for k, v in EJES_Y.items()},
              "zonas": [], "avisos": []}
    for z in ZONAS:
        dx, dy = z["dx"], z["dy"]
        dentro = lambda x, y: z["xmin"] < x < z["xmax"] and y > YMIN
        loc = lambda x, y: (x - dx, y - dy)                    # → sistema de la zona 1

        # ---- columnas ----
        cajas = defaultdict(list)
        # columnas dibujadas como polilínea o como cuatro líneas sueltas: se cierran los
        # contornos de toda la capa y cada cara cerrada pequeña es una columna (o un trozo)
        trazos = []
        for e in msp.query('LWPOLYLINE[layer=="COLUMNA"]'):
            p = [loc(a, b) for a, b, *_ in e.get_points()]
            if dentro(p[0][0] + dx, p[0][1] + dy) and len(p) >= 2:
                trazos.append(LineString(p + ([p[0]] if e.closed else [])))
        for e in msp.query('LINE[layer=="COLUMNA"]'):
            s_, t_ = e.dxf.start, e.dxf.end
            if dentro(s_.x, s_.y):
                trazos.append(LineString([loc(s_.x, s_.y), loc(t_.x, t_.y)]))
        # (hay contornos que no cierran por 2 mm: se pegan los extremos a menos de 1 cm)
        ancla = []                                            # extremos casi iguales → el mismo punto
        def _pegar(q):
            for r in ancla:
                if abs(r[0] - q[0]) < 0.01 and abs(r[1] - q[1]) < 0.01:
                    return r
            ancla.append(q); return q
        trazos = [LineString([_pegar((a, b)) for a, b in t.coords]) for t in trazos]
        trazos = [t for t in trazos if t.length > 0]
        caras = [g.bounds for g in polygonize(unary_union(trazos)) if 0.03 < g.area < 3.0]
        # y además la caja de cada polilínea (las abiertas no forman cara cerrada)
        caras += [t.bounds for t in trazos if len(t.coords) > 2 and t.length < 8]
        for minx_, miny_, maxx_, maxy_ in caras:
            p = [(minx_, miny_), (maxx_, maxy_)]
            xs = [a for a, _ in p]; ys = [b for _, b in p]
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            nx, ny = _cerca(cx, EJES_X, 1.1), _cerca(cy, EJES_Y, 1.1)
            if nx is None or ny is None:
                salida["avisos"].append(f"{z['nombre']}: columna fuera de ejes en ({cx - X0:.2f}, {cy - Y0:.2f})")
                continue
            cajas[(nx, ny)].append((min(xs), max(xs), min(ys), max(ys)))
        columnas = []
        for (nx, ny), cs in sorted(cajas.items(), key=lambda t: (EJES_Y[t[0][1]], EJES_X[t[0][0]])):
            x0 = min(c[0] for c in cs); x1 = max(c[1] for c in cs)
            y0 = min(c[2] for c in cs); y1 = max(c[3] for c in cs)
            bx, by = round(x1 - x0, 2), round(y1 - y0, 2)
            if bx < 0.15 or by < 0.15:
                continue
            columnas.append({"x": nx, "y": ny, "bx": bx, "by": by})

        # ---- placas: tramos de muro sobre los ejes ----
        rotulos = []
        for e in msp.query("TEXT MTEXT"):
            p = e.dxf.insert
            if dentro(p.x, p.y):
                rotulos.append((loc(p.x, p.y), _texto(e).strip()))
        placas = []
        polis = []
        for e in msp.query('LWPOLYLINE[layer=="PLACAS"]'):
            p = [loc(a, b) for a, b, *_ in e.get_points()]
            if len(p) < 4 or not dentro(p[0][0] + dx, p[0][1] + dy):
                continue
            pg = Polygon(p).buffer(0)
            if pg.area > 0.3:
                polis.append(pg)
        muro = unary_union(polis)
        partes = list(muro.geoms) if hasattr(muro, "geoms") else [muro]
        for pg in partes:
            usadas = []
            minx, miny, maxx, maxy = pg.bounds
            nom = min(((math.hypot(q[0] - pg.centroid.x, q[1] - pg.centroid.y), t) for q, t in rotulos
                       if t.startswith("PL-")), default=(0, "PL"))[1]
            for dir_, ejes, c_fijo in (("x", EJES_Y, 1), ("y", EJES_X, 0)):
                for n, c in ejes.items():
                    franja = (box(minx - 1, c - FRANJA_PLACA, maxx + 1, c + FRANJA_PLACA) if dir_ == "x"
                              else box(c - FRANJA_PLACA, miny - 1, c + FRANJA_PLACA, maxy + 1))
                    cut = pg.intersection(franja)
                    for g in (cut.geoms if hasattr(cut, "geoms") else [cut]):
                        if g.is_empty or g.area <= 0:
                            continue
                        a0, b0, a1, b1 = g.bounds
                        largo = (a1 - a0) if dir_ == "x" else (b1 - b0)
                        if largo < 1.5:
                            continue
                        # espesor medido a media longitud (la caja incluye columnas de borde)
                        mid = ((a0 + a1) / 2) if dir_ == "x" else ((b0 + b1) / 2)
                        corte = (g.intersection(LineString([(mid, b0 - 1), (mid, b1 + 1)])) if dir_ == "x"
                                 else g.intersection(LineString([(a0 - 1, mid), (a1 + 1, mid)])))
                        t = corte.length if not corte.is_empty else g.area / largo
                        if t > 0.9 or t < 0.2:
                            continue
                        medio = (b0 + b1) / 2 if dir_ == "x" else (a0 + a1) / 2
                        if _cerca(medio, ejes, FRANJA_PLACA) != n:      # dos ejes juntos: vale el más cercano
                            continue
                        d0, d1 = (a0, a1) if dir_ == "x" else (b0, b1)
                        base = X0 if dir_ == "x" else Y0
                        placas.append({"nombre": nom, "dir": dir_, "eje": n, "desde": round(d0 - base, 3),
                                       "hasta": round(d1 - base, 3), "t": round(t, 2)})
                        usadas.append(g)
            resto = pg.difference(unary_union(usadas)) if usadas else pg
            if resto.area > 0.8:
                c = resto.centroid
                salida["avisos"].append(f"{z['nombre']}: {nom} tiene {resto.area:.1f} m² de muro fuera de los ejes "
                                        f"(cerca de x = {c.x - X0:.1f}, y = {c.y - Y0:.1f} m); no entra al modelo de pórticos")
        placas.sort(key=lambda p: (p["dir"], p["eje"], p["desde"]))

        # ---- vigas: cobertura de líneas por eje y rótulos ----
        cubre = defaultdict(list)                # (dir, eje) → [(a, b)]
        segs = {"x": [], "y": []}                # (posición fija, desde, hasta)
        for e in msp.query('LINE[layer=="VIGA" | layer=="VIGAS"]'):
            s, t_ = e.dxf.start, e.dxf.end
            if not (dentro(s.x, s.y) or dentro(t_.x, t_.y)):
                continue
            (sx, sy), (tx, ty) = loc(s.x, s.y), loc(t_.x, t_.y)
            if abs(sy - ty) < 1e-3 and abs(sx - tx) > 0.2:
                segs["x"].append((sy, min(sx, tx), max(sx, tx)))
            elif abs(sx - tx) < 1e-3 and abs(sy - ty) > 0.2:
                segs["y"].append((sx, min(sy, ty), max(sy, ty)))
        # cada viga se dibuja con sus dos bordes: el eje se elige por la línea media del
        # par (si no, con dos ejes juntos como C y D cada borde caía en un eje distinto)
        for dir_, ejes in (("x", EJES_Y), ("y", EJES_X)):
            L = segs[dir_]
            for c, a, b in L:
                pares = [c2 for c2, a2, b2 in L if 0.15 <= abs(c2 - c) <= 0.65
                         and min(b, b2) - max(a, a2) > 0.5 * min(b - a, b2 - a2)]
                medio = (c + min(pares, key=lambda c2: abs(c2 - c))) / 2 if pares else c
                # con dos ejes cerca (C y D, E y F…) gana el que tiene columnas a lo largo de la viga
                cand = [k for k, v in ejes.items() if abs(v - medio) <= 1.0]
                if not cand:
                    continue
                otros = EJES_X if dir_ == "x" else EJES_Y
                def n_cols(k):
                    return sum(1 for col in columnas if (col["y"] if dir_ == "x" else col["x"]) == k
                               and a - 0.8 <= otros[col["x"] if dir_ == "x" else col["y"]] <= b + 0.8)
                n = max(cand, key=lambda k: (n_cols(k), -abs(ejes[k] - medio)))
                cubre[(dir_, n)].append((a, b))
        etiquetas = []
        for (x, y), t in rotulos:
            m = RE_VIGA.match(t)
            if m:
                etiquetas.append((x, y, m.group(1), int(m.group(2)) / 100, int(m.group(3)) / 100))

        salida["zonas"].append({"nombre": z["nombre"], "pisos": z["pisos"], "columnas": columnas,
                                "placas": placas, "_cubre": {f"{d}|{n}": v for (d, n), v in cubre.items()},
                                "_etiquetas": etiquetas})
    return salida


def _union(iv):
    iv = sorted(tuple(x) for x in iv); out = []
    for a, b in iv:
        if out and a <= out[-1][1] + 0.05:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def _cobertura(iv, a, b):
    tot = 0.0
    for c, d in iv:
        tot += max(0.0, min(b, d) - max(a, c))
    return tot / max(b - a, 1e-9)


def armar_vigas(geo):
    """Vigas entre apoyos consecutivos de cada eje (columnas, cruces con placas y
    cruces con vigas del otro sentido)."""
    ex = {k: v + X0 for k, v in geo["ejes_x"].items()}
    ey = {k: v + Y0 for k, v in geo["ejes_y"].items()}
    for z in geo["zonas"]:
        cubre = {tuple(k.split("|")): _union(v) for k, v in z.pop("_cubre").items()}
        etq = z.pop("_etiquetas")
        cols = {(c["x"], c["y"]) for c in z["columnas"]}
        vigas = []
        for (dir_, n), iv in sorted(cubre.items()):
            ejes_otro = ex if dir_ == "x" else ey
            # apoyos posibles: cruces con ejes del otro sentido cubiertos por la viga
            pts = []
            for m, c in ejes_otro.items():
                if _cobertura(iv, c - 0.3, c + 0.3) <= 0 and not any(a - 1.6 <= c <= b + 1.6 for a, b in iv):
                    continue
                nx, ny = (m, n) if dir_ == "x" else (n, m)
                hay_col = (nx, ny) in cols
                hay_placa = any(_placa_en(p, nx, ny, geo) for p in z["placas"])
                cruza = (("y" if dir_ == "x" else "x"), m) in cubre and any(
                    a - 1.0 <= (ey[n] if dir_ == "x" else ex[n]) <= b + 1.0 for a, b in cubre[(("y" if dir_ == "x" else "x"), m)])
                if hay_col or hay_placa or cruza:
                    pts.append((c, m, hay_col or hay_placa))
            pts.sort()
            for (c0, m0, s0), (c1, m1, s1) in zip(pts, pts[1:]):
                base_ = X0 if dir_ == "x" else Y0
                muros = [(p["desde"] + base_, p["hasta"] + base_) for p in z["placas"] if p["dir"] == dir_ and p["eje"] == n]
                if _cobertura(_union(iv + muros), c0 + 0.3, c1 - 0.3) < 0.5:
                    continue
                if _dentro_de_placa(z, dir_, n, c0, c1, geo):
                    continue
                cfijo = ey[n] if dir_ == "x" else ex[n]
                cand = []
                for (x, y, cod, b, h) in etq:
                    a_, f_ = (x, y) if dir_ == "x" else (y, x)
                    if c0 - 0.2 <= a_ <= c1 + 0.2 and abs(f_ - cfijo) <= 1.1:
                        cand.append((abs(f_ - cfijo) + 0.1 * abs(a_ - (c0 + c1) / 2) / max(c1 - c0, 1), cod, b, h))
                cod, b, h = (min(cand)[1:] if cand else ("V01", 0.40, 0.40))
                if not cand and (dir_, n, m0, m1) in SIN_VIGA:
                    continue
                vigas.append({"dir": dir_, "eje": n, "desde": m0, "hasta": m1, "codigo": cod, "b": b, "h": h,
                              "rotulo": bool(cand)})
        z["vigas"] = vigas
    return geo


def _placa_en(p, nx, ny, geo):
    ex, ey = geo["ejes_x"], geo["ejes_y"]
    if p["dir"] == "x":
        return p["eje"] == ny and p["desde"] - 0.3 <= ex[nx] <= p["hasta"] + 0.3
    return p["eje"] == nx and p["desde"] - 0.3 <= ey[ny] <= p["hasta"] + 0.3


def _dentro_de_placa(z, dir_, n, c0, c1, geo):
    """El tramo entero está ocupado por una placa del mismo eje (no hay viga, hay muro)."""
    base = X0 if dir_ == "x" else Y0
    a, b = c0 - base, c1 - base
    return any(p["dir"] == dir_ and p["eje"] == n and p["desde"] <= a + 0.6 and p["hasta"] >= b - 0.6
               for p in z["placas"])


if __name__ == "__main__":
    ruta = sys.argv[1]
    geo = armar_vigas(extraer(ruta))
    dest = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "core", "torre_plano.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(geo, f, ensure_ascii=False, indent=1)
    for z in geo["zonas"]:
        print(z["nombre"], "columnas", len(z["columnas"]), "placas", len(z["placas"]), "vigas", len(z["vigas"]),
              "sin rótulo", sum(1 for v in z["vigas"] if not v["rotulo"]))
    for a in geo["avisos"]:
        print("AVISO", a)
    print("->", dest)
