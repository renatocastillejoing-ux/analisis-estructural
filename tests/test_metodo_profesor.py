# -*- coding: utf-8 -*-
"""Método sistematizado con barras 4×4: ejemplo 7-1 del profesor (placa con
deformación por corte, columna y viga con brazo rígido de 0.75 m)."""
import os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.constructor import construir
from core.metodo_profesor import resolver_profesor, memoria_profesor

EJ71 = {"nombre": "Ej 7-1", "despreciar_axial": True, "material": {"modo": "fc", "fc": 210},
        "secciones": [{"nombre": "placa", "b": 0.25, "h": 1.5}, {"nombre": "col", "b": 0.25, "h": 0.5},
                      {"nombre": "viga", "b": 0.25, "h": 0.5}],
        "nudos": [{"id": 1, "x": 0, "y": 0, "apoyo": "empotrado"}, {"id": 2, "x": 4.75, "y": 0, "apoyo": "empotrado"},
                  {"id": 3, "x": 0, "y": 3}, {"id": 4, "x": 4.75, "y": 3}],
        "elementos": [{"id": 1, "i": 1, "j": 3, "seccion": "placa", "nombre": "Placa"},
                      {"id": 2, "i": 2, "j": 4, "seccion": "col", "nombre": "Col"},
                      {"id": 3, "i": 3, "j": 4, "seccion": "viga", "nombre": "Viga"}],
        "cargas_nodales": [{"nudo": 3, "Fx": 20}]}


def _res():
    return resolver_profesor(construir(EJ71))


def test_placa_y_brazo_se_detectan_solos():
    est = construir(EJ71)
    pl, col, vg = est.elementos
    assert pl.placa and not col.placa
    assert abs(vg.brazo_i - 0.75) < 1e-12 and vg.brazo_j == 0


def test_matrices_del_profesor():
    r = _res()
    pl, col, vg = r["barras"]
    assert abs(pl["alfa"] - 0.69) < 1e-3
    np.testing.assert_allclose(pl["K"][0], [40194.2772, 60291.4158, -40194.2772, 60291.4158], rtol=1e-6)
    np.testing.assert_allclose(pl["K"][1, 3], 39490.8774, rtol=1e-6)
    np.testing.assert_allclose(col["K"][0], [2515.8640, 3773.7960, -2515.8640, 3773.7960], rtol=1e-6)
    np.testing.assert_allclose(vg["K"][0], [1061.3801, 2122.7603, -1061.3801, 2122.7603], rtol=1e-6)
    np.testing.assert_allclose(vg["A"][0], [0, 0.75, 0])          # Δ en el borde del brazo = 0.75·θ3


def test_fuerzas_finales():
    r = _res()
    pl, col, vg = r["barras"]
    np.testing.assert_allclose(pl["qT"], [17.8832, 48.8300, -17.8832, 4.8195], atol=5e-4)
    np.testing.assert_allclose(vg["qT"], [-1.6165, -3.6071, 1.6165, -2.8589], atol=5e-4)
    # equilibrio de momentos en el nudo 4: viga + columna = 0
    assert abs(vg["qT"][3] + col["qT"][3]) < 1e-9


def test_coincide_con_metodo_directo():
    est = construir(EJ71)
    r = resolver_profesor(est)
    est.resolver()
    for b in r["barras"]:
        # [A] da las fuerzas en el borde del brazo; el motor, en el nudo: q_nudo = Tᵀ·q
        a, c = b["brazo_i"], b["brazo_j"]
        T = np.array([[1, a, 0, 0], [0, 1, 0, 0], [0, 0, 1, -c], [0, 0, 0, 1]], float)
        np.testing.assert_allclose(T.T @ b["qT"], est.fuerzas_elem[b["e"].id][[1, 2, 4, 5]], atol=5e-3)


def test_memoria_es_la_del_profesor():
    txt = memoria_profesor(_res(), "Ej 7-1")
    assert "MÉTODO SISTEMATIZADO" in txt and "α = 12EI" in txt and "PASO 13" in txt
