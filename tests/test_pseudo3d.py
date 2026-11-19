# -*- coding: utf-8 -*-
"""Pseudo-tridimensional: pórticos con [A] + diafragma; la suma de cortantes cierra."""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.pseudo3d import analizar_pseudo3d


def test_pseudo3d_torre_cierra_el_cortante():
    r = analizar_pseudo3d()
    assert r["bloques"] == 2 and r["n_porticos"] >= 30
    for d, v in r["direcciones"].items():
        assert abs(v["V_aplicado"] - v["V_porticos"]) < 1e-6 * v["V_aplicado"], d
        assert 0 < v["deriva_max_inelastica"] < 0.1
