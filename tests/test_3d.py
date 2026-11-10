# -*- coding: utf-8 -*-
"""Pruebas del análisis 3D (pórtico espacial, 6 GDL por nudo)."""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.analisis_3d import analizar_modelo3d, internas, props_rect, resolver  # noqa: E402

E, G = 2.0e6, 2.0e6 / 2.4


def _voladizo(w=0.6, d=0.3, H=3.0):
    return {"nudos": [[0, 0, 0], [0, 0, H]], "restr": [[1] * 6, None],
            "elementos": [{"i": 0, "j": 1, "E": E, "G": G, "w": w, "d": d, "wdir": [1, 0, 0]}]}


def test_voladizo_flexion_torsion_axial():
    w, d, H, P, T = 0.6, 0.3, 3.0, 5.0, 2.0
    A, Iy, Iz, J = props_rect(w, d)
    r = resolver(_voladizo(w, d, H), {
        "PX": {"nudos": {1: [P, 0, 0, 0, 0, 0]}}, "PY": {"nudos": {1: [0, P, 0, 0, 0, 0]}},
        "PZ": {"nudos": {1: [0, 0, -P, 0, 0, 0]}}, "T": {"nudos": {1: [0, 0, 0, 0, 0, T]}}})
    U = {n: r["U"][:, c] for c, n in enumerate(r["nombres"])}
    assert math.isclose(U["PX"][6], P * H ** 3 / (3 * E * Iz), rel_tol=1e-9)
    assert math.isclose(U["PY"][7], P * H ** 3 / (3 * E * Iy), rel_tol=1e-9)
    assert math.isclose(U["PZ"][8], -P * H / (E * A), rel_tol=1e-9)
    assert math.isclose(U["T"][11], T * H / (G * J), rel_tol=1e-9)


def test_carga_uniforme_momento_en_base():
    q, H = 2.0, 3.0
    r = resolver(_voladizo(H=H), {"W": {"barras": {0: (q, 0, 0)}}})
    fe, qq = r["fext"]["W"]
    s, N, Vy, Vz, Mz, My = internas(fe[0], qq[0], H)
    assert math.isclose(max(abs(Mz).max(), abs(My).max()), q * H ** 2 / 2, rel_tol=1e-9)


def _portico_3d(diafragma=False, sismo=False):
    """Pórtico de 1 vano × 1 vano × 1 piso en formato del editor 3D."""
    nudos, k = [], 1
    for z in (0, 3):
        for y in (0, 5):
            for x in (0, 6):
                nudos.append({"id": k, "nombre": f"N{k}", "x": x, "y": y, "z": z, "apoyo": "empotrado" if z == 0 else "libre"}); k += 1
    els = [{"id": i + 1, "i": i + 1, "j": i + 5, "seccion": "C"} for i in range(4)]
    els += [{"id": 5, "i": 5, "j": 6, "seccion": "V"}, {"id": 6, "i": 7, "j": 8, "seccion": "V"},
            {"id": 7, "i": 5, "j": 7, "seccion": "V"}, {"id": 8, "i": 6, "j": 8, "seccion": "V"}]
    return {"tipo": "3d", "nudos": nudos, "elementos": els,
            "secciones": [{"nombre": "C", "b": 0.4, "h": 0.4}, {"nombre": "V", "b": 0.3, "h": 0.5}],
            "materiales": [{"nombre": "M", "modo": "E", "E": E, "densidad": 2.4, "nu": 0.2}], "material": "M",
            "casos": [{"nombre": "CM"}, {"nombre": "CV"}],
            "cargas_area": [{"z": 3, "caso": "CM", "q": 0.4}, {"z": 3, "caso": "CV", "q": 0.2}],
            "peso_propio": True, "diafragma": diafragma,
            "sismo": {"activo": sismo, "Z": 0.35, "U": 1, "S": 1.15, "R": 8, "TP": 0.6, "CT": 35}}


def test_losa_y_equilibrio():
    r = analizar_modelo3d(_portico_3d())
    # la losa (6 × 5 m) se reparte una sola vez: CM de losa = 0.4·30 = 12 t, más peso propio
    pp = 2.4 * (4 * 0.16 * 3 + 0.15 * (2 * 6 + 2 * 5))
    assert math.isclose(-r["aplicado"]["CM"]["Fz"], 12 + pp, rel_tol=1e-9)
    assert math.isclose(-r["aplicado"]["CV"]["Fz"], 6.0, rel_tol=1e-9)
    for c in ("CM", "CV"):
        assert math.isclose(r["equilibrio"][c]["Rz"], -r["aplicado"][c]["Fz"], rel_tol=1e-9)


def test_diafragma_y_sismo():
    r = analizar_modelo3d(_portico_3d(diafragma=True, sismo=True))
    for d, k in (("X", "Rx"), ("Y", "Ry")):
        V = r["sismo"][d]["V"]
        assert V > 0
        assert math.isclose(-r["equilibrio"]["S" + d][k], V, rel_tol=1e-7)
    # con diafragma rígido los 4 nudos del techo tienen el mismo desplazamiento en X (sin torsión neta salvo la excentricidad)
    ux = [r["desp"]["SX"][k][0] for k in range(4, 8)]
    assert max(ux) > 0 and np.std(ux) / np.mean(ux) < 0.2
    assert r["modal"] and r["modal"][0]["T"] > 0
