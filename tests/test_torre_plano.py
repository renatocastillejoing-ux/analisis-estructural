# -*- coding: utf-8 -*-
"""Torre armada desde el plano del curso (core/torre_plano.json)."""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.analisis_3d import portico_desde_3d
from core.constructor import construir
from core.torre_arequipa import modelo3d_torre, portico, todos_los_pórticos
from core.torre_resultados import carga_combinada


def _idx(nombre):
    L = todos_los_pórticos()
    _, tipo, i = next(x for x in L if x[0] == nombre)
    return tipo, [j for _, t, j in L if t == tipo].index(i)


def test_modelo_sin_avisos():
    m = modelo3d_torre()
    assert not m["avisos"]
    assert len(m["nudos"]) > 500 and len(m["elementos"]) > 1000


def test_eje_9_partido_y_reducido_desde_el_piso_4():
    nombres = [n for n, _, _ in todos_los_pórticos()]
    assert "Eje 9 (I–H)" in nombres and "Eje 9 (E–A)" in nombres
    d = portico(*_idx("Eje 9 (E–A)"))
    yC = max(n["x"] for n in d["nudos"] if n["y"] == 30.0)     # hasta dónde llega el último piso
    yA = max(n["x"] for n in d["nudos"])
    assert yA > yC + 10                                         # el tramo C–A solo existe abajo
    assert max(n["y"] for n in d["nudos"] if n["x"] == yA) == 9.0   # tramo A: pisos 1–3


def test_todos_los_porticos_en_equilibrio():
    for nombre, _, _ in todos_los_pórticos():
        est = construir(carga_combinada(portico(*_idx(nombre))))
        est.resolver()
        eq = est.verificar_equilibrio()
        assert max(abs(eq["residuo_Fx"]), abs(eq["residuo_Fy"]), abs(eq["residuo_M"])) < 1e-2, nombre


def test_pórtico_desde_3d_gira_la_placa():
    m = {"nudos": [{"id": 1, "x": 0, "y": 0, "z": 0, "apoyo": "empotrado"}, {"id": 2, "x": 0, "y": 0, "z": 3}],
         "elementos": [{"id": 1, "i": 1, "j": 2, "seccion": "PL"}],
         "secciones": [{"nombre": "PL", "b": 4.0, "h": 0.25}], "materiales": [], "casos": [{"nombre": "CM"}]}
    en_x = portico_desde_3d(m, "x", 0.0)          # pórtico a lo largo de X: la placa trabaja con su largo
    en_y = portico_desde_3d(m, "y", 0.0)          # a lo largo de Y: con su espesor
    sx = {s["nombre"]: s for s in en_x["secciones"]}[en_x["elementos"][0]["seccion"]]
    sy = {s["nombre"]: s for s in en_y["secciones"]}[en_y["elementos"][0]["seccion"]]
    assert sx["h"] == 4.0 and sy["h"] == 0.25
