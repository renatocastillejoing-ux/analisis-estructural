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
from core.exportar_profesor import excel_desde_resultado
from core.metodo_profesor import resolver_profesor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xl_eval import Libro

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
    # {D}: fórmula de matriz con formato de 6 cifras significativas
    wq = wb["Q R D"]
    assert "MINVERSE" in wq["E3"].value.text
    for k in range(nD):
        assert wq.cell(3 + k, 5).number_format == "0.00000E+00"
    # los números que dan las fórmulas son los del motor
    L = Libro(wb)
    for k in range(nD):
        assert L.valor("Q R D", 3 + k, 5) == pytest.approx(res["D"][k], rel=1e-9, abs=1e-12)
    # [K] total: suma de los aportes de las hojas de barra
    wk = wb["K total"]
    assert str(wk["B3"].value).startswith("='Barra")
    K = L.hoja("K total", 3, 2, nD, nD)
    assert np.allclose(K, res["K"], rtol=1e-9, atol=1e-8)
    # hoja de una barra: [K] 4×4 (título en la fila 4, encabezado en la 5, datos desde la 6)
    hoja = wb[hojas_barra[0]]
    assert str(hoja.cell(6, 2).value).startswith("=")
    Kb = L.hoja(hojas_barra[0], 6, 2, 4, 4)
    assert np.allclose(Kb, res["barras"][0]["K"], rtol=1e-9, atol=1e-9)


def _recalcular_y_comparar(est):
    """Genera el Excel, lo recalcula con el evaluador y compara cada hoja con el motor."""
    res = resolver_profesor(est)
    wb = load_workbook(io.BytesIO(excel_desde_resultado(res, est, "t")))
    L = Libro(wb)
    nD = len(res["labels"])
    for k in range(nD):
        assert L.valor("Q R D", 3 + k, 4) == pytest.approx(res["Q"][k], abs=1e-9)
        assert L.valor("Q R D", 3 + k, 5) == pytest.approx(res["D"][k], rel=1e-8, abs=1e-12)
    assert np.allclose(L.hoja("K total", 3, 2, nD, nD), res["K"], rtol=1e-9, atol=1e-8)
    nombres = [s for s in wb.sheetnames if s.startswith("Barra ")]
    formulas_k = 0
    for h, b in zip(nombres, res["barras"]):
        ws = wb[h]
        assert np.allclose(L.hoja(h, 6, 2, 4, 4), b["K"], rtol=1e-9, atol=1e-9), h
        formulas_k += str(ws.cell(6, 2).value).startswith("=")
        col1 = {ws.cell(r, 1).value: r for r in range(1, ws.max_row + 1) if ws.cell(r, 1).value}
        fP = col1["[A_i]ᵀ[K_i][A_i]"] + 2
        assert np.allclose(L.hoja(h, fP, 2, nD, nD), b["AtKA"], rtol=1e-8, atol=1e-8), h
        r0 = col1["Vectores de la barra"] + 2
        assert np.allclose(L.hoja(h, r0, 2, 4, 1)[:, 0], b["r"], atol=1e-9)
        assert np.allclose(L.hoja(h, r0, 3, 4, 1)[:, 0], b["d"], rtol=1e-8, atol=1e-10), h
        assert np.allclose(L.hoja(h, r0, 4, 4, 1)[:, 0], b["q"], rtol=1e-8, atol=1e-8), h
        assert np.allclose(L.hoja(h, r0, 5, 4, 1)[:, 0], b["qT"], rtol=1e-8, atol=1e-8), h
        if b["brazo_ini"] or b["brazo_fin"]:
            qn = np.array(b["qT"], float)
            qn[1] += qn[0] * b["brazo_ini"]; qn[3] -= qn[2] * b["brazo_fin"]
            assert np.allclose(L.hoja(h, r0, 6, 4, 1)[:, 0], qn, rtol=1e-8, atol=1e-8), h
    return formulas_k, len(nombres)


def test_excel_formulas_recalculan_a_los_valores_del_motor():
    fk, n = _recalcular_y_comparar(construir(MODELO_EJEMPLO))
    assert fk == n


def test_excel_formulas_placa_con_corte_y_brazo():
    from test_metodo_profesor import EJ71
    fk, n = _recalcular_y_comparar(construir(EJ71))
    assert fk >= 2                    # placa (α) y columna con fórmula; viga con brazo rígido en valores


def test_excel_formulas_rotula_resorte_y_asentamiento():
    from test_profesor_completo import _portico, _viga
    for ri, rj in ((1, 0), (0, 1)):
        fk, n = _recalcular_y_comparar(_portico(ri, rj))
        assert fk == n                # la rótula también sale con fórmula (3EI/L³)
    _recalcular_y_comparar(_viga())   # resorte (valor en [K] total) y asentamiento


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
