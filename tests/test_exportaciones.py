# -*- coding: utf-8 -*-
"""Excel del profesor, PDF de pórticos de la torre y comparación con ETABS."""
import io
import json
import os
import sys

import numpy as np
import pytest
from openpyxl import Workbook, load_workbook

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as modapp
from app import MODELO_EJEMPLO, app
from core.constructor import construir
from core.etabs import comparar, fuerzas_sistema
from core.metodo_profesor import resolver_profesor

DATOS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "datos")
CSV = os.path.join(DATOS, "etabs_ejemplo.csv")


@pytest.fixture()
def cli():
    app.config["TESTING"] = True
    return app.test_client()


# ------------------------------------------------------------------ Excel
def test_excel_profesor(cli):
    r = cli.post("/api/exportar/excel", json=MODELO_EJEMPLO)
    assert r.status_code == 200
    assert "spreadsheetml" in r.mimetype
    wb = load_workbook(io.BytesIO(r.data))
    res = resolver_profesor(construir(MODELO_EJEMPLO))
    nb, nD = len(res["barras"]), len(res["labels"])
    assert wb.sheetnames[:2] == ["Datos", "A"] and "K total" in wb.sheetnames and "Q R D" in wb.sheetnames
    hojas_barra = [s for s in wb.sheetnames if s.startswith("Barra ")]
    assert len(hojas_barra) == nb
    # [A]: 4·nb filas × nD columnas, con rótulos de GDL y de d
    wa = wb["A"]
    A = np.array([[wa.cell(3 + r_, 2 + c).value for c in range(nD)] for r_ in range(4 * nb)], float)
    assert np.allclose(A, np.vstack([b["A"] for b in res["barras"]]))
    assert wa.cell(2, 2).value == res["labels"][0]
    assert wa.cell(3, 1).value == res["barras"][0]["def_labels"][0]
    # {D} sin redondear y con formato de 6 cifras significativas
    wq = wb["Q R D"]
    for k in range(nD):
        c = wq.cell(3 + k, 5)
        assert c.value == pytest.approx(res["D"][k], rel=1e-14, abs=0)
        assert c.number_format == "0.00000E+00"
    # [K] total
    wk = wb["K total"]
    K = np.array([[wk.cell(3 + i, 2 + j).value for j in range(nD)] for i in range(nD)], float)
    assert np.allclose(K, res["K"])
    # hoja de una barra: [K] 4×4 (título en la fila 4, encabezado en la 5, datos desde la 6)
    hoja = wb[hojas_barra[0]]
    Kb = np.array([[hoja.cell(6 + i, 2 + j).value for j in range(4)] for i in range(4)], float)
    assert np.allclose(Kb, res["barras"][0]["K"])


def test_excel_modelo_invalido(cli):
    r = cli.post("/api/exportar/excel", json={"nudos": []})
    assert r.status_code == 400 and r.get_json()["ok"] is False


# ------------------------------------------------------------------ ETABS
def _est():
    est = construir(MODELO_EJEMPLO)
    est.resolver()
    return est


def test_etabs_por_nombre_csv():
    res = comparar(_est(), open(CSV, "rb").read(), "etabs_ejemplo.csv")
    assert res["metodo"] == "nombre" and res["col_nombre"] == "Beam"
    assert res["resumen"]["barras"] == 5 and len(res["filas"]) == 10
    assert not res["sin_pareja_modelo"]
    # con los factores 1.0 / 1.03 / 1.10 / 0.80 del archivo hay verdes, ámbar y rojos
    todos = {f[m]["nivel"] for f in res["filas"] for m in "PVM"}
    assert {"ok", "medio", "alto"} <= todos
    f0 = res["filas"][0]
    assert f0["barra"] == "C1" and f0["extremo"] == "i"
    assert f0["P"]["dif"] == pytest.approx(0.0, abs=1e-2)       # factor 1.0 en P de C1


def test_etabs_modo_signo_detecta_inversion():
    res = comparar(_est(), open(CSV, "rb").read(), modo="signo")
    v1 = [f for f in res["filas"] if f["barra"] == "V1"][0]
    assert v1["M"]["dif"] > 100          # el archivo trae V1 con signo invertido


def test_etabs_por_coordenadas_con_xlsx():
    est = _est()
    sis = fuerzas_sistema(est)
    wb = Workbook()
    ws = wb.active
    ws.append(["Story", "Frame", "Station", "OutputCase", "P", "V2", "M3", "Xi", "Zi", "Xj", "Zj"])
    for k, (n, d) in enumerate(sis.items()):
        (x1, y1), (x2, y2) = d["p"]
        for ext, st in (("i", 0.0), ("j", d["L"])):
            P, V, M = d[ext]
            ws.append(["S1", f"F{100 + k}", st, "COMB", P, V, M, x1, y1, x2, y2])
    buf = io.BytesIO()
    wb.save(buf)
    res = comparar(est, buf.getvalue(), "x.xlsx")
    assert res["metodo"] == "coordenadas" and res["resumen"]["barras"] == 5
    assert res["resumen"]["peor"] == {"P": 0.0, "V": 0.0, "M": 0.0}


def test_etabs_sin_pareja_da_error():
    csv = b"Story,Beam,Station,P,V2,M3\nS,ZZ,0,1,1,1\nS,ZZ,1,1,1,1\n"
    with pytest.raises(ValueError, match="emparejar"):
        comparar(_est(), csv, "a.csv")


def test_etabs_endpoint(cli):
    r = cli.post("/api/comparar_etabs", data={"modelo": json.dumps(MODELO_EJEMPLO),
                 "archivo": (open(CSV, "rb"), "etabs_ejemplo.csv"), "modo": "abs"},
                 content_type="multipart/form-data")
    d = r.get_json()
    assert r.status_code == 200 and d["ok"] and d["resumen"]["barras"] == 5
    r = cli.post("/api/comparar_etabs", data={"modelo": "{}"}, content_type="multipart/form-data")
    assert r.status_code == 400


# ------------------------------------------------------------------ PDF
def test_pdf_pocos_porticos():
    from core.pdf_porticos import generar_pdf
    pdf, info = generar_pdf(limite=2)
    assert pdf[:5] == b"%PDF-" and info["porticos"] == 2 and info["paginas"] >= 5


def test_pdf_endpoint(cli, monkeypatch):
    import core.pdf_porticos as pp
    orig = pp.generar_pdf
    monkeypatch.setattr(pp, "generar_pdf", lambda progreso=None: orig(progreso, limite=1))
    modapp._PDF["bytes"] = None
    r = cli.get("/api/torre/pdf")
    assert r.status_code == 200 and r.mimetype == "application/pdf" and r.data[:5] == b"%PDF-"
    p = cli.get("/api/torre/pdf/progreso").get_json()
    assert p["estado"] == "listo" and p["i"] == p["n"] == 1
    modapp._PDF["bytes"] = None
