# -*- coding: utf-8 -*-
"""
Prepara el plano DXF del curso como fondo liviano para el visor de la app.

Uso (desde analisis_estructural_web/):
    python tools/plano_fondo.py "ruta/al/PLANO ACTUALIZADO ANALISIS.dxf"

Escribe static/plano/planta_1a3.json (pisos 1–3) y static/plano/planta_4a10.json (pisos 4–10).
Los puntos ya están en el sistema del modelo: x − X0 − dx, y − Y0 − dy (m, redondeo a 2 decimales),
con el origen en el eje 1 (x = 0) y el eje I (y = 0), igual que core/torre_plano.json.

Formato:
  {"planta": 1, "nombre": "...", "unidades": "m",
   "capas": {"EJES": [[x1, y1, x2, y2, ...], ...], ...},          # polilíneas planas x,y,x,y…
   "textos": [{"capa": "TEXTO", "t": "7", "x": 0.0, "y": 0.0, "h": 0.35, "r": 0}]}
"""
import json, math, os, sys

import ezdxf
from shapely.geometry import LineString
from shapely.ops import linemerge, unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extraer_plano import X0, Y0, YMIN, ZONAS     # constantes únicas: no se duplican

CAPAS = ["EJES", "COLUMNA", "PLACAS", "VIGA", "VIGAS", "MURO"]
CAPAS_TEXTO = {"EJES", "EJES_NOMBRES", "TEXTO", "TEXTO_1", "TEXTO_COLUMNAS", "JUNTA_SISMICA"}
SALIDA = {1: "planta_1a3.json", 2: "planta_4a10.json"}
TOL_SIMPLE = 0.02            # m: simplificación de las polilíneas
LADOS_CIRCULO = 12


def _pts_hatch(e):
    for r in e.paths:
        if r.__class__.__name__ == "PolylinePath":
            yield [(v[0], v[1]) for v in r.vertices]
        else:
            p = []
            for ed in r.edges:
                if ed.type == "LineEdge":
                    p += [tuple(ed.start), tuple(ed.end)]
            if p:
                yield p


def _trazos(e):
    t = e.dxftype()
    if t == "LINE":
        yield [(e.dxf.start.x, e.dxf.start.y), (e.dxf.end.x, e.dxf.end.y)]
    elif t == "LWPOLYLINE":
        p = [(a, b) for a, b, *_ in e.get_points()]
        if e.closed and p:
            p.append(p[0])
        yield p
    elif t == "CIRCLE":
        c, r = e.dxf.center, e.dxf.radius
        yield [(c.x + r * math.cos(2 * math.pi * k / LADOS_CIRCULO), c.y + r * math.sin(2 * math.pi * k / LADOS_CIRCULO))
               for k in range(LADOS_CIRCULO + 1)]
    elif t == "HATCH":
        for p in _pts_hatch(e):
            if len(p) > 1:
                yield p + [p[0]]


def construir(ruta):
    msp = ezdxf.readfile(ruta).modelspace()
    salidas = {}
    for i, z in enumerate(ZONAS, 1):
        dx, dy = z["dx"], z["dy"]
        dentro = lambda x, y: z["xmin"] < x < z["xmax"] and y > YMIN
        sis = lambda x, y: (round(x - X0 - dx, 2), round(y - Y0 - dy, 2))
        lineas = {c: [] for c in CAPAS}
        for c in CAPAS:
            for e in msp.query(f'*[layer=="{c}"]'):
                for p in _trazos(e):
                    if len(p) >= 2 and dentro(*p[0]):
                        lineas[c].append(LineString([sis(a, b) for a, b in p]))
        capas = {}
        for c, ls in lineas.items():
            ls = [l for l in ls if l.length > 0]
            if not ls:
                continue
            m = unary_union(ls)
            m = linemerge(m) if m.geom_type == "MultiLineString" else m
            geoms = list(m.geoms) if hasattr(m, "geoms") else [m]
            capas[c] = []
            for g in geoms:
                g = g.simplify(TOL_SIMPLE)
                if g.length < 0.03:
                    continue
                capas[c].append([round(v, 2) for xy in g.coords for v in xy])
        textos = []
        for e in msp.query("TEXT MTEXT"):
            if e.dxf.layer not in CAPAS_TEXTO:
                continue
            p = e.dxf.insert
            if not dentro(p.x, p.y):
                continue
            t = (e.dxf.text if e.dxftype() == "TEXT" else e.plain_text()).strip().replace("\n", " ")
            if not t:
                continue
            h = e.dxf.height if e.dxftype() == "TEXT" else e.dxf.char_height
            x, y = sis(p.x, p.y)
            textos.append({"capa": e.dxf.layer, "t": t[:40], "x": x, "y": y, "h": round(h or 0.15, 2),
                           "r": round(getattr(e.dxf, "rotation", 0) or 0)})
        salidas[i] = {"planta": i, "nombre": z["nombre"], "unidades": "m", "origen": "eje 1 (x=0), eje I (y=0)",
                      "capas": capas, "textos": textos}
    return salidas


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    carpeta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static", "plano")
    os.makedirs(carpeta, exist_ok=True)
    for i, datos in construir(sys.argv[1]).items():
        ruta = os.path.join(carpeta, SALIDA[i])
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump(datos, f, ensure_ascii=False, separators=(",", ":"))
        n = sum(len(v) for v in datos["capas"].values())
        print(f"{SALIDA[i]}: {os.path.getsize(ruta) / 1024:.0f} KB · {n} polilíneas · {len(datos['textos'])} textos")
