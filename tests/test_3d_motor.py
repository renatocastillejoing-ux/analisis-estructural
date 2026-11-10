# -*- coding: utf-8 -*-
"""Pruebas del motor 3D: brazos rígidos, rótulas, cargas puntuales/trapezoidales,
tramos y sismo espectral, contra el motor 2D y soluciones exactas."""
import copy
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.analisis_3d import analizar_modelo3d, diagramas_portico, props_rect, resolver  # noqa: E402
from core.constructor import construir, extraer_resultados  # noqa: E402

E = 2.0e6


def _base2d():
    """Pórtico de 2 vanos con cargas variadas (formato del editor 2D)."""
    return {
        "nombre": "P", "unidad_fuerza": "tonf", "unidad_longitud": "m", "despreciar_axial": False,
        "material": {"modo": "E", "E": E},
        "secciones": [{"nombre": "C", "modo": "rect", "b": 0.4, "h": 0.4}, {"nombre": "V", "modo": "rect", "b": 0.3, "h": 0.6},
                      {"nombre": "W", "modo": "rect", "b": 0.3, "h": 0.9}],
        "nudos": [{"id": 1, "nombre": "N1", "x": 0, "y": 0, "apoyo": "empotrado"}, {"id": 2, "nombre": "N2", "x": 6, "y": 0, "apoyo": "empotrado"},
                  {"id": 3, "nombre": "N3", "x": 11, "y": 0, "apoyo": "empotrado"}, {"id": 4, "nombre": "N4", "x": 0, "y": 3.5},
                  {"id": 5, "nombre": "N5", "x": 6, "y": 3.5}, {"id": 6, "nombre": "N6", "x": 11, "y": 3.5}],
        "elementos": [{"id": 1, "nombre": "C1", "i": 1, "j": 4, "seccion": "C"}, {"id": 2, "nombre": "C2", "i": 2, "j": 5, "seccion": "C"},
                      {"id": 3, "nombre": "C3", "i": 3, "j": 6, "seccion": "C"},
                      {"id": 4, "nombre": "V1", "i": 4, "j": 5, "seccion": "V"}, {"id": 5, "nombre": "V2", "i": 5, "j": 6, "seccion": "V"}],
        "cargas_nodales": [{"nudo": 4, "Fx": 3.0, "Fy": 0, "M": 0}],
        "cargas_elementos": [],
    }


def _a3d(m2, cargas_barras):
    sec = {s["nombre"]: s for s in m2["secciones"]}
    return {
        "tipo": "3d", "nudos": [{"id": n["id"], "nombre": n["nombre"], "x": n["x"], "y": 0.0, "z": n["y"], "apoyo": n.get("apoyo", "libre")} for n in m2["nudos"]],
        "elementos": [{**{k: v for k, v in e.items() if k in ("id", "nombre", "i", "j", "seccion", "release_i", "release_j", "segmentos")}, "giro": 0} for e in m2["elementos"]],
        "secciones": [{"nombre": s["nombre"], "b": s["h"] if False else s["b"], "h": s["h"]} for s in m2["secciones"]],
        "materiales": [{"nombre": "M", "modo": "E", "E": E, "densidad": 0, "nu": 0.2}], "material": "M",
        "casos": [{"nombre": "G"}], "cargas_barras": cargas_barras,
        "cargas_nudos": [{"nudo": c["nudo"], "caso": "G", "F": [c["Fx"], 0, c["Fy"], 0, -c["M"], 0]} for c in m2["cargas_nodales"]],
        "peso_propio": False, "brazos_rigidos": {"modo": "ninguno"},
    }


def _comparar(m2, cargas3d, tol=2e-3):
    # columnas: en 2D el peralte h está en el plano; en 3D (giro 0) b está en X → se intercambian b y h
    m2c = copy.deepcopy(m2)
    est = construir(m2c); est.resolver()
    d2 = extraer_resultados(est)["diagramas"]["elementos"]
    m3 = _a3d(m2, cargas3d)
    for s in m3["secciones"]:
        if s["nombre"] == "C": s["b"], s["h"] = s["h"], s["b"]
    r = analizar_modelo3d(m3)
    dg = diagramas_portico(r["id_calculo"], "G", "x", 0.0)
    por = {}
    for e in dg["elementos"]:
        por.setdefault(e["elem"], []).append(e)
    for e2 in d2:
        partes = por[e2["elem"]]
        M3 = np.concatenate([p["M"] for p in partes]); s3 = np.concatenate([np.asarray(p["s"]) + sum(q["L"] for q in partes[:k]) for k, p in enumerate(partes)])
        M2 = np.asarray(e2["M"]); s2 = np.asarray(e2["s"])
        # compara en los extremos y en el máximo absoluto
        assert abs(M3[0] - M2[0]) < tol * max(1, abs(M2).max()), (e2["elem"], M3[0], M2[0])
        assert abs(M3[-1] - M2[-1]) < tol * max(1, abs(M2).max()), (e2["elem"], M3[-1], M2[-1])
        # en los mismos puntos de muestreo del 2D (el 3D además evalúa justo bajo las cargas puntuales)
        M3i = np.interp(s2, s3, M3)
        assert np.max(np.abs(M3i - M2)) < 5 * tol * max(1, abs(M2).max()), (e2["elem"], np.max(np.abs(M3i - M2)))


def test_puntual_y_trapezoidal_igual_que_2d():
    m2 = _base2d()
    m2["cargas_elementos"] = [{"elem": 4, "tipo": "puntual", "Py": -8, "Px": 0, "a": 2.0},
                              {"elem": 5, "tipo": "distribuida", "subtipo": "trapezoidal", "wy1": -1, "wy2": -4, "wx1": 0, "wx2": 0}]
    _comparar(m2, [{"elem": 4, "caso": "G", "tipo": "puntual", "Pz": -8, "a": 2.0},
                   {"elem": 5, "caso": "G", "tipo": "trapezoidal", "wz1": -1, "wz2": -4}])


def test_rotulas_igual_que_2d():
    m2 = _base2d()
    m2["elementos"][3]["release_j"] = True
    m2["cargas_elementos"] = [{"elem": 4, "tipo": "distribuida", "subtipo": "uniforme", "wy": -2, "wx": 0},
                              {"elem": 5, "tipo": "distribuida", "subtipo": "uniforme", "wy": -2, "wx": 0}]
    _comparar(m2, [{"elem": 4, "caso": "G", "wz": -2}, {"elem": 5, "caso": "G", "wz": -2}])


def test_tramos_igual_que_2d():
    m2 = _base2d()
    m2["elementos"][3]["segmentos"] = [{"L": 1.5, "seccion": "W"}, {"L": 3.0, "seccion": "V"}, {"L": 1.5, "seccion": "W"}]
    m2["cargas_elementos"] = [{"elem": 4, "tipo": "distribuida", "subtipo": "uniforme", "wy": -3, "wx": 0}]
    _comparar(m2, [{"elem": 4, "caso": "G", "wz": -3}])


def test_brazo_rigido_voladizo_exacto():
    # viga horizontal empotrada en i con brazo rígido b: δ = P (L − b)³ / (3 E I)
    L, b, P, w, d = 4.0, 1.0, 2.0, 0.6, 0.3
    m = {"nudos": [[0, 0, 0], [L, 0, 0]], "restr": [[1] * 6, None],
         "elementos": [{"i": 0, "j": 1, "E": E, "G": E / 2.4, "w": w, "d": d, "wdir": [0, 0, 1], "bi": b}]}
    r = resolver(m, {"P": {"nudos": {1: [0, 0, -P, 0, 0, 0]}}})
    _, _, Iz, _ = props_rect(w, d)
    assert math.isclose(r["U"][8, 0], -P * (L - b) ** 3 / (3 * E * Iz), rel_tol=1e-9)
    # el momento en la cara del brazo es P·(L − b)
    fe = r["fext"]["P"][0][0]
    assert math.isclose(abs(fe[5]), P * (L - b), rel_tol=1e-9)


def test_espectral_escalado_al_80_por_ciento():
    nudos, k = [], 1
    for z in (0, 3, 6):
        for y in (0, 5):
            for x in (0, 6):
                nudos.append({"id": k, "nombre": f"N{k}", "x": x, "y": y, "z": z, "apoyo": "empotrado" if z == 0 else "libre"}); k += 1
    pos = {(n["x"], n["y"], n["z"]): n["id"] for n in nudos}
    els, e = [], 1
    for z0, z1 in ((0, 3), (3, 6)):
        for y in (0, 5):
            for x in (0, 6):
                els.append({"id": e, "i": pos[(x, y, z0)], "j": pos[(x, y, z1)], "seccion": "C"}); e += 1
    for z in (3, 6):
        for a, b in (((0, 0), (6, 0)), ((0, 5), (6, 5)), ((0, 0), (0, 5)), ((6, 0), (6, 5))):
            els.append({"id": e, "i": pos[(a[0], a[1], z)], "j": pos[(b[0], b[1], z)], "seccion": "V"}); e += 1
    m = {"tipo": "3d", "nudos": nudos, "elementos": els,
         "secciones": [{"nombre": "C", "b": 0.4, "h": 0.4}, {"nombre": "V", "b": 0.3, "h": 0.5}],
         "materiales": [{"nombre": "M", "modo": "fc", "fc": 210, "densidad": 2.4}], "material": "M",
         "casos": [{"nombre": "CM"}, {"nombre": "CV"}],
         "cargas_area": [{"z": 3, "caso": "CM", "q": 0.5}, {"z": 6, "caso": "CM", "q": 0.5}, {"z": 3, "caso": "CV", "q": 0.2}],
         "peso_propio": True, "diafragma": True,
         "sismo": {"activo": True, "dinamico": True, "Z": 0.45, "U": 1, "S": 1.05, "R": 8, "TP": 0.6, "TL": 2.0, "CT": 35}}
    r = analizar_modelo3d(m)
    for d in ("X", "Y"):
        s = r["sismo"][d]
        assert s["V_dinamico"] >= 0.8 * s["V"] - 1e-9
        assert "dinamico" in r["derivas"][d] and max(r["derivas"][d]["dinamico"]) > 0
    assert "SDX" in r["barras"] and max(r["barras"]["SDX"]["M"]) > 0
    # equilibrio de gravedad con todo lo nuevo activo
    assert math.isclose(r["equilibrio"]["CM"]["Rz"], -r["aplicado"]["CM"]["Fz"], rel_tol=1e-9)


def test_mecanismo_3d_se_explica():
    m2 = _base2d()
    for n in m2["nudos"]:
        if n.get("apoyo"): n["apoyo"] = "articulado"
    for e in m2["elementos"][3:]:
        e["release_i"] = e["release_j"] = True
    m = _a3d(m2, [])
    try:
        analizar_modelo3d(m)
    except ValueError as ex:
        assert "inestable" in str(ex)
        return
    raise AssertionError("debía detectar el mecanismo")
