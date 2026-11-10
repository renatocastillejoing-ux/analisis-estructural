# -*- coding: utf-8 -*-
"""Método sistematizado [A] con barras inclinadas contra el motor directo."""
import copy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.constructor import construir, extraer_resultados  # noqa: E402
from core.metodo_matricial_A import resolver_sistematizado  # noqa: E402

DOS_AGUAS = {
    "nombre": "Dos aguas", "unidad_fuerza": "tonf", "unidad_longitud": "m", "despreciar_axial": True,
    "material": {"modo": "E", "E": 2e6}, "secciones": [{"nombre": "S", "modo": "rect", "b": 0.3, "h": 0.5}],
    "nudos": [{"id": 1, "nombre": "N1", "x": 0, "y": 0, "apoyo": "empotrado"}, {"id": 2, "nombre": "N2", "x": 0, "y": 4},
              {"id": 3, "nombre": "N3", "x": 5, "y": 6}, {"id": 4, "nombre": "N4", "x": 10, "y": 4},
              {"id": 5, "nombre": "N5", "x": 10, "y": 0, "apoyo": "empotrado"}],
    "elementos": [{"id": 1, "nombre": "C1", "i": 1, "j": 2, "seccion": "S"}, {"id": 2, "nombre": "R1", "i": 2, "j": 3, "seccion": "S"},
                  {"id": 3, "nombre": "R2", "i": 3, "j": 4, "seccion": "S"}, {"id": 4, "nombre": "C2", "i": 5, "j": 4, "seccion": "S"}],
    "cargas_nodales": [{"nudo": 2, "Fx": 3, "Fy": 0, "M": 0}],
    "cargas_elementos": [{"elem": 2, "tipo": "distribuida", "subtipo": "uniforme", "wy": -2, "wx": 0},
                         {"elem": 3, "tipo": "distribuida", "subtipo": "uniforme", "wy": -2, "wx": 0},
                         {"elem": 1, "tipo": "puntual", "Px": 1.5, "Py": 0, "a": 2}],
}


def test_dos_aguas_igual_que_directo():
    est = construir(copy.deepcopy(DOS_AGUAS)); est.resolver()
    d = {f["elem"]: (f["Mi"], f["Mj"]) for f in extraer_resultados(est)["fuerzas"]}
    r = resolver_sistematizado(construir(copy.deepcopy(DOS_AGUAS)))
    assert r["general"] and r["n_gdl"] == 5 and sum("Δ" in l for l in r["labels"]) == 2
    for b in r["barras"]:
        mi, mj = d[b["elem"]]
        assert abs(abs(b["qT"][0]) - abs(mi)) < 1e-3 and abs(abs(b["qT"][1]) - abs(mj)) < 1e-3
