# -*- coding: utf-8 -*-
"""El método [A] del profesor cubre resortes, asentamientos, rótulas (k modificada 3EI/L³)
y da N y reacciones por equilibrio de nudos; todo igual al motor de verificación."""
import os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.metodo_rigidez import CargaDistribuida, Elemento, Estructura, Material, Nudo, Seccion
from core.metodo_profesor import resolver_profesor


def _viga():
    est = Estructura(despreciar_axial=True)
    m = Material(2.1e6); s = Seccion.rectangular(0.3, 0.5)
    a = est.agregar_nudo(Nudo(1, 0, 0, (1, 1, 1)))
    b = est.agregar_nudo(Nudo(2, 5, 0, (0, 1, 0)))
    c = est.agregar_nudo(Nudo(3, 10, 0, (0, 1, 0)))
    b.aplicar_resorte(kg=500.0)
    c.aplicar_asentamiento(dy=-0.01)
    for i, (p, q) in enumerate(((a, b), (b, c))):
        est.agregar_elemento(Elemento(i + 1, p, q, m, s)).agregar_carga(CargaDistribuida(wy=-2.0))
    return est


def _portico(ri, rj):
    est = Estructura(despreciar_axial=True)
    m = Material(2.1e6); s = Seccion.rectangular(0.3, 0.5)
    a = est.agregar_nudo(Nudo(1, 0, 0, (1, 1, 1))); b = est.agregar_nudo(Nudo(2, 0, 3))
    c = est.agregar_nudo(Nudo(3, 5, 3)); d = est.agregar_nudo(Nudo(4, 5, 0, (1, 1, 1)))
    est.agregar_elemento(Elemento(1, a, b, m, s))
    e = est.agregar_elemento(Elemento(2, b, c, m, s))
    est.agregar_elemento(Elemento(3, d, c, m, s))
    e.release_i, e.release_j = ri, rj
    e.agregar_carga(CargaDistribuida(wy=-2.0)); b.aplicar_carga(Fx=5)
    return est


def _igual(arm):
    r = resolver_profesor(arm()); est = arm(); est.resolver()
    for b in r["barras"]:
        f = est.fuerzas_elem[b["e"].id]
        assert np.allclose(b["qT"], f[[1, 2, 4, 5]], atol=1e-3), b["elem"]
        assert abs(b["N"] + f[0]) < 1e-3, b["elem"]
    return r, est


def test_resorte_y_asentamiento():
    _igual(_viga)


def test_rotulas_con_k_modificada():
    for ri, rj in ((1, 0), (0, 1)):
        r, _ = _igual(lambda: _portico(ri, rj))
        assert any(b["rotula"] for b in r["barras"])


def test_reacciones_por_equilibrio_de_nudos():
    r, est = _igual(lambda: _portico(0, 0))
    calc = [v for x in r["reacciones"] for v in (x["Rx"], x["Ry"], x["M"])]
    assert np.allclose(calc, est.R, atol=1e-3)
    assert r["residuo_equilibrio"] < 1e-8
