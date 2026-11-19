# -*- coding: utf-8 -*-
"""
Exportación a Excel (.xlsx) del cálculo en el formato del profesor.

Hojas:
  «Datos»      materiales, secciones, EI y α de placas por barra
  «A»          matriz de compatibilidad [A] completa (filas = d de cada barra,
               columnas = GDL globales) con sus rótulos
  «Barra …»    una por barra: [K] 4×4, [A_i], [A_i]ᵀ[K_i][A_i], {r}, {d}, {q}, {q}tot
  «K total»    [K] = Σ[A_i]ᵀ[K_i][A_i]
  «Q R D»      {Q}nudos, {R}, {Q} = {Q}nudos − {R} y {D}

Excel no admite corchetes ni «:» en el nombre de una hoja, por eso «[A]» se
llama «A» y «{Q}, {R}, {D}» se llama «Q R D». {D} se guarda SIN redondear
(el valor completo de doble precisión) y se muestra con 6 cifras
significativas (formato 0.00000E+00).
"""
import io
import re

import numpy as np
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from core.metodo_profesor import LOC, resolver_profesor

FMT = "0.0000"
FMT_D = "0.00000E+00"            # 6 cifras significativas
NEG = Font(bold=True)
CAB = PatternFill("solid", fgColor="DDEBF0")
TIT = Font(bold=True, size=12)
# por encima de este nº de GDL, [A_i]ᵀ[K_i][A_i] se escribe solo con las columnas en que la barra participa
MAX_GDL_COMPLETO = 60


def _nombre_hoja(base, usados):
    t = re.sub(r"[\\/?*\[\]:]", "-", str(base)).strip() or "Barra"
    t = ("Barra " + t)[:31]
    k, orig = 2, t
    while t.lower() in usados:
        suf = f" ({k})"
        t = orig[:31 - len(suf)] + suf
        k += 1
    usados.add(t.lower())
    return t


def _cab(ws, fila, col, textos):
    for k, t in enumerate(textos):
        c = ws.cell(fila, col + k, t)
        c.font = NEG; c.fill = CAB; c.alignment = Alignment(horizontal="center", wrap_text=True)


def _matriz(ws, fila, col, M, filas, cols, fmt=FMT, titulo=None):
    """Escribe una matriz con rótulos; devuelve la siguiente fila libre."""
    M = np.atleast_2d(np.asarray(M, float))
    if titulo:
        ws.cell(fila, col, titulo).font = TIT
        fila += 1
    _cab(ws, fila, col + 1, cols)
    ws.cell(fila, col, "").fill = CAB
    for r in range(M.shape[0]):
        c0 = ws.cell(fila + 1 + r, col, filas[r]); c0.font = NEG; c0.fill = CAB
        for c in range(M.shape[1]):
            v = float(M[r, c])
            cel = ws.cell(fila + 1 + r, col + 1 + c, 0.0 if v == 0 else v)
            cel.number_format = fmt
    return fila + M.shape[0] + 2


def _ancho(ws, c0=1, n=None, ancho=13, primero=22):
    n = n or ws.max_column
    ws.column_dimensions[get_column_letter(c0)].width = primero
    for c in range(c0 + 1, c0 + n):
        ws.column_dimensions[get_column_letter(c)].width = ancho


def _fmt_dato(v):
    return None if v is None else float(v)


def excel_desde_resultado(res, est=None, nombre="Pórtico"):
    """Libro de Excel (bytes) a partir del resultado de resolver_profesor()."""
    labels = res["labels"]; nD = len(labels)
    barras = res["barras"]
    D_L = [f"D{k + 1}" for k in range(nD)]
    wb = Workbook()
    usados = {"datos", "a", "k total", "q r d"}

    # ------------------------------------------------------------------ Datos
    ws = wb.active; ws.title = "Datos"
    ws["A1"] = f"Datos del modelo — {nombre}"; ws["A1"].font = Font(bold=True, size=14)
    ws["A2"] = "Unidades: tonf, m, rad. Giros y momentos antihorarios positivos. Deformación axial despreciada (EA = ∞)."
    ws["A3"] = f"GDL globales: {nD}   ·   Barras: {len(barras)}   ·   GDL locales: {4 * len(barras)}"
    fila = 5
    # materiales
    mats = {}
    for b in barras:
        e = b["e"]
        m = e.mat
        mats.setdefault((getattr(m, "nombre", "material"), b["E"]),
                        (getattr(m, "nu", None), getattr(m, "densidad", None), getattr(m, "fc", None)))
    ws.cell(fila, 1, "Materiales").font = TIT; fila += 1
    _cab(ws, fila, 1, ["Material", "E (tonf/m²)", "ν", "Peso específico (tonf/m³)", "f'c (kgf/cm²)"]); fila += 1
    for (nom, E), (nu, dens, fc) in mats.items():
        for k, v in enumerate([nom, E, nu, dens, fc]):
            ws.cell(fila, 1 + k, v)
        ws.cell(fila, 2).number_format = "0.000E+00"
        fila += 1
    fila += 1
    # secciones
    secs = {}
    for b in barras:
        s = b["e"].sec
        secs.setdefault(getattr(s, "nombre", "sección"), (getattr(s, "b", None), getattr(s, "h", None), b["Asec"], b["I"]))
    ws.cell(fila, 1, "Secciones").font = TIT; fila += 1
    _cab(ws, fila, 1, ["Sección", "b (m)", "h (m)", "A (m²)", "I (m⁴)"]); fila += 1
    for nom, vals in secs.items():
        ws.cell(fila, 1, nom)
        for k, v in enumerate(vals):
            c = ws.cell(fila, 2 + k, _fmt_dato(v))
            c.number_format = "0.000000" if k == 3 else "0.0000"
        fila += 1
    fila += 1
    # barras: EI, α
    ws.cell(fila, 1, "Barras: rigidez a flexión y deformación por corte (α de placas)").font = TIT; fila += 1
    cols = ["Barra", "Tipo", "i", "j", "L (m)", "Brazo i (m)", "Brazo j (m)", "L flexible (m)",
            "E (tonf/m²)", "I (m⁴)", "EI (tonf·m²)", "ν", "G (tonf/m²)", "Ac (m²)", "α",
            "d1", "d2", "d3", "d4"]
    _cab(ws, fila, 1, cols); fila += 1
    for b in barras:
        vals = [b["elem"], b["tipo"], b["i"], b["j"], b["L"], b["brazo_ini"], b["brazo_fin"], b["Lf"],
                b["E"], b["I"], b["EI"], b["nu"], b["G"], b["Ac"], b["alfa"]] + list(b["dnum"])
        for k, v in enumerate(vals):
            c = ws.cell(fila, 1 + k, _fmt_dato(v) if isinstance(v, (int, float, np.floating)) else v)
            if k in (4, 5, 6, 7):
                c.number_format = "0.0000"
            elif k in (8, 10, 12):
                c.number_format = "0.000E+00"
            elif k == 9:
                c.number_format = "0.000000"
            elif k in (11, 13, 14):
                c.number_format = "0.0000"
        if not b["exacta"]:
            ws.cell(fila, len(vals) + 1, "barra con tramos o rótulas: [k] por condensación")
        fila += 1
    _ancho(ws, n=19)
    ws.column_dimensions["A"].width = 28

    # ------------------------------------------------------------------ [A]
    wa = wb.create_sheet("A")
    def_filas = [l for b in barras for l in b["def_labels"]]
    if barras:
        A = np.vstack([b["A"] for b in barras])
    else:
        A = np.zeros((0, nD))
    wa["A1"] = "Matriz de compatibilidad [A]   {d} = [A]{D}"; wa["A1"].font = TIT
    _matriz(wa, 2, 1, A, def_filas, labels)
    wa.row_dimensions[2].height = 45
    _ancho(wa, n=nD + 1, ancho=11, primero=26)
    wa.freeze_panes = "B3"

    # ------------------------------------------------------------------ una hoja por barra
    for b in barras:
        w = wb.create_sheet(_nombre_hoja(b["elem"], usados))
        w["A1"] = f"Barra {b['elem']} ({b['tipo']})   {b['i']} → {b['j']}"; w["A1"].font = Font(bold=True, size=14)
        w["A2"] = f"L = {b['L']:.4f} m   L flexible = {b['Lf']:.4f} m   EI = {b['EI']:.6g} tonf·m²" + \
                  (f"   α = {b['alfa']:.4f}" if b["alfa"] else "")
        dl = [f"{d} {LOC[k]}" for k, d in enumerate(b["dnum"])]
        f = 4
        f = _matriz(w, f, 1, b["K"], dl, b["dnum"], titulo="[K] de la barra (4×4)")
        completo = nD <= MAX_GDL_COMPLETO
        idx = list(range(nD)) if completo else [c for c in range(nD) if np.any(np.abs(b["A"][:, c]) > 1e-12)]
        nota = "" if completo else "  (solo las columnas en que la barra participa)"
        f = _matriz(w, f, 1, b["A"][:, idx], dl, [D_L[c] for c in idx], titulo="[A_i]" + nota)
        f = _matriz(w, f, 1, b["A"][:, idx].T, [D_L[c] for c in idx], dl, titulo="[A_i]ᵀ")
        f = _matriz(w, f, 1, b["AtKA"][np.ix_(idx, idx)], [D_L[c] for c in idx], [D_L[c] for c in idx],
                    titulo="[A_i]ᵀ[K_i][A_i]" + nota)
        # vectores: r, d, q, q total lado a lado
        w.cell(f, 1, "Vectores de la barra").font = TIT
        brazo = bool(b["brazo_ini"] or b["brazo_fin"])
        qn = np.array(b["qT"], float)
        qn[1] += qn[0] * b["brazo_ini"]; qn[3] -= qn[2] * b["brazo_fin"]   # [T]ᵀ: de la cara al nudo
        cab = ["{r}", "{d}", "{q} = [K]{d}", "{q}tot = {q} + {r}"] + (["{q} en el nudo (M + V·a)"] if brazo else [])
        _cab(w, f + 1, 2, cab)
        w.cell(f + 1, 1, "").fill = CAB
        for r in range(4):
            c0 = w.cell(f + 2 + r, 1, dl[r]); c0.font = NEG; c0.fill = CAB
            for k, v in enumerate((b["r"][r], b["d"][r], b["q"][r], b["qT"][r]) + ((qn[r],) if brazo else ())):
                c = w.cell(f + 2 + r, 2 + k, float(v))
                c.number_format = FMT_D if k == 1 else FMT      # {d} sin redondear, 6 cifras
        _ancho(w, n=max(len(idx), 5) + 1, ancho=13, primero=18)

    # ------------------------------------------------------------------ [K] total
    wk = wb.create_sheet("K total")
    wk["A1"] = "Rigidez de la estructura  [K] = Σ [A_i]ᵀ[K_i][A_i]"; wk["A1"].font = TIT
    _matriz(wk, 2, 1, res["K"], labels, labels)
    wk.row_dimensions[2].height = 45
    _ancho(wk, n=nD + 1, ancho=11, primero=26)
    wk.freeze_panes = "B3"

    # ------------------------------------------------------------------ Q, R, D
    wq = wb.create_sheet("Q R D")
    wq["A1"] = "{Q}nudos, {R}, {Q} = {Q}nudos − {R} y {D} = [K]⁻¹{Q}"; wq["A1"].font = TIT
    _cab(wq, 2, 1, ["GDL", "{Q}nudos", "{R}", "{Q} = {Q}nudos − {R}", "{D} (6 cifras significativas)"])
    for k in range(nD):
        c0 = wq.cell(3 + k, 1, labels[k]); c0.font = NEG; c0.fill = CAB
        for j, key in enumerate(("Qn", "R", "Q", "D")):
            c = wq.cell(3 + k, 2 + j, float(res[key][k]))
            c.number_format = FMT_D if key == "D" else FMT
    wq.cell(4 + nD, 1, "{D} está guardado con toda su precisión; el formato solo muestra 6 cifras significativas.")
    _ancho(wq, n=5, ancho=24, primero=34)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def exportar_excel(est):
    """Resuelve con el método del profesor y devuelve los bytes del .xlsx."""
    res = resolver_profesor(est)
    return excel_desde_resultado(res, est, est.nombre)
