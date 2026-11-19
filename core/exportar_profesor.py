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

El libro es auditable: [k], [A_i]ᵀ, [A_i]ᵀ[k][A_i], {d}, {q}, {q}tot, [K] total, {Q} y {D} son
fórmulas de Excel reales (MMULT, MINVERSE, referencias entre hojas). Se mantienen en valores
los datos de entrada ({R}, {Q}nudos, [A]) y lo que no tiene fórmula cerrada (barras condensadas).

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
from openpyxl.worksheet.formula import ArrayFormula

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


# ---------------------------------------------------------------- fórmulas
_S_PERM = [(2, -1), (3, 1), (0, -1), (1, 1)]     # S_INV del método: fila r = s·e_p


def _cel(col, fila, abs_=False):
    c = get_column_letter(col)
    return f"${c}${fila}" if abs_ else f"{c}{fila}"


def _rango(c1, f1, c2, f2, abs_=True):
    return f"{_cel(c1, f1, abs_)}:{_cel(c2, f2, abs_)}"


def _k_base(EI, L, al):
    """[k] 4×4 del profesor (Δi, θi, Δj, θj) como texto de fórmulas."""
    c12 = f"12*{EI}/({L}^3*(1+{al}))"
    c6 = f"6*{EI}/({L}^2*(1+{al}))"
    c4 = f"(4+{al})*{EI}/({L}*(1+{al}))"
    c2 = f"(2-{al})*{EI}/({L}*(1+{al}))"
    n = lambda x: f"-{x}"
    return [[c12, c6, n(c12), c6], [c6, c4, n(c6), c2],
            [n(c12), n(c6), c12, n(c6)], [c6, c2, n(c6), c4]]


def _k_rotula(EI, L, lado):
    """[k] modificada 3EI/L³ para rótula en 'i' o en 'j'."""
    c = f"3*{EI}/{L}^3"
    def t(x):
        if x == "0":
            return "0"
        neg = x.startswith("-")
        e = {"1": c, "L": f"{c}*{L}", "L2": f"{c}*{L}^2"}[x.lstrip("-")]
        return f"-{e}" if neg else e
    if lado == "j":
        M = [["1", "L", "-1", "0"], ["L", "L2", "-L", "0"], ["-1", "-L", "1", "0"], ["0", "0", "0", "0"]]
    else:
        M = [["1", "0", "-1", "L"], ["0", "0", "0", "0"], ["-1", "0", "1", "-L"], ["L", "0", "-L", "L2"]]
    return [[t(x) for x in fila] for fila in M]


def _invertir(M):
    """S·M·Sᵀ sobre una matriz de textos."""
    out = []
    for pr, sr in _S_PERM:
        fila = []
        for pc, sc in _S_PERM:
            x = M[pr][pc]
            fila.append("0" if x == "0" else (f"-({x})" if sr * sc < 0 else f"({x})"))
        out.append(fila)
    return out


def _evaluar(M, EI, L, al):
    return np.array([[eval(x.replace("^", "**")) for x in fila] for fila in M], float)


def _formula_k(b, nombres):
    """Matriz 4×4 de fórmulas de [k] si reproduce exactamente el valor del motor; si no, None.
    Solo barras «exactas» (A=12EI/(L³(1+α))…) o con rótula (3EI/L³)."""
    if b["alfa"] is None or b["Lf"] <= 0:
        return None
    EI, L, al = nombres
    cands = []
    if b["exacta"]:
        cands.append(_k_base(EI, L, al))
    elif b.get("rotula"):
        if b["rotula"] == "ambos":
            cands.append([["0"] * 4 for _ in range(4)])
        else:
            cands += [_k_rotula(EI, L, "i"), _k_rotula(EI, L, "j")]
    num = (float(b["EI"]), float(b["Lf"]), float(b["alfa"]))
    for base in cands:
        for M in (base, _invertir(base)):
            try:
                v = _evaluar([[x.replace(EI, "EI").replace(L, "L").replace(al, "al") for x in f] for f in M], *num)
            except Exception:
                continue
            if np.allclose(v, b["K"], rtol=1e-9, atol=1e-9 * max(1.0, np.abs(b["K"]).max())):
                return M
    return None


def _array(ws, ref, texto, fmt):
    ws[ref.split(":")[0]] = ArrayFormula(ref, texto)
    for fila in ws[ref]:
        for c in (fila if isinstance(fila, tuple) else (fila,)):
            c.number_format = fmt



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
    completo = nD <= MAX_GDL_COMPLETO
    hojas = []                         # (nombre de hoja, primera fila de [A_i]ᵀ[K][A_i], columnas idx)
    QRD = "'Q R D'"
    for nb_, b in enumerate(barras):
        nombre_h = _nombre_hoja(b["elem"], usados)
        w = wb.create_sheet(nombre_h)
        w["A1"] = f"Barra {b['elem']} ({b['tipo']})   {b['i']} → {b['j']}"; w["A1"].font = Font(bold=True, size=14)
        w["A2"] = f"L = {b['L']:.4f} m   L flexible = {b['Lf']:.4f} m   EI = {b['EI']:.6g} tonf·m²" + \
                  (f"   α = {b['alfa']:.4f}" if b["alfa"] else "")
        dl = [f"{d} {LOC[k]}" for k, d in enumerate(b["dnum"])]
        # ---- datos de la barra (G4:K8): E, I, EI, L flexible, α, G, Ac, brazos
        w["G4"] = "Datos de la barra"; w["G4"].font = TIT
        w["J4"] = "Cortante y brazos"; w["J4"].font = TIT
        datos = [(7, 5, "E (tonf/m²)", b["E"], "0.000E+00"), (7, 6, "I (m⁴)", b["I"], "0.000000"),
                 (7, 8, "L flexible (m)", b["Lf"], "0.0000"),
                 (10, 5, "G (tonf/m²)", b["G"], "0.000E+00"), (10, 6, "Ac (m²)", b["Ac"], "0.0000"),
                 (10, 7, "Brazo i (m)", b["brazo_ini"], "0.0000"), (10, 8, "Brazo j (m)", b["brazo_fin"], "0.0000")]
        for cl, fila_, tx, v, fm in datos:
            w.cell(fila_, cl, tx).font = NEG
            c = w.cell(fila_, cl + 1, None if v is None else float(v)); c.number_format = fm
        w["G7"] = "EI (tonf·m²)"; w["G7"].font = NEG
        w["H7"] = "=H5*H6"; w["H7"].number_format = "0.000E+00"
        w["G9"] = "α (corte)"; w["G9"].font = NEG
        if b["G"] is not None and b["Ac"] is not None and b["alfa"]:
            w["H9"] = "=12*H7/(H8^2*K5*K6)"
        else:
            w["H9"] = float(b["alfa"] or 0.0)
        w["H9"].number_format = "0.0000"
        Mk = _formula_k(b, ("$H$7", "$H$8", "$H$9"))
        f0K = 4
        f = _matriz(w, f0K, 1, b["K"] if Mk is None else np.zeros((4, 4)), dl, b["dnum"],
                    titulo="[K] de la barra (4×4)")
        if Mk is not None:
            for r in range(4):
                for c in range(4):
                    w.cell(f0K + 2 + r, 2 + c).value = "=" + Mk[r][c]
            tipo_k = ("k modificada con rótula, 3EI/L³" if b.get("rotula") and not b["exacta"]
                      else "A = 12EI/(L³(1+α)), B = 6EI/(L²(1+α)), …")
            w["A3"] = f"[k] con fórmulas desde E, I, L flexible y α ({tipo_k})."
        else:
            w["A3"] = ("[k] en valores: barra con tramos, brazos rígidos o rótulas — el motor la obtiene por "
                       "condensación, no hay fórmula cerrada.")
        w["A3"].font = Font(italic=True, color="666666")
        K_rng = _rango(2, f0K + 2, 5, f0K + 5)
        idx = list(range(nD)) if completo else [c for c in range(nD) if np.any(np.abs(b["A"][:, c]) > 1e-12)]
        nidx = len(idx)
        nota = "" if completo else "  (solo las columnas en que la barra participa)"
        # [A_i]: referencias a la hoja «A»
        fA = f
        f = _matriz(w, f, 1, np.zeros((4, nidx)), dl, [D_L[c] for c in idx], titulo="[A_i]" + nota)
        for r in range(4):
            for k, c in enumerate(idx):
                w.cell(fA + 2 + r, 2 + k).value = f"='A'!{get_column_letter(2 + c)}{3 + 4 * nb_ + r}"
        A_rng = _rango(2, fA + 2, 1 + nidx, fA + 5)
        # [A_i]ᵀ: referencias a [A_i]
        fT = f
        f = _matriz(w, f, 1, np.zeros((nidx, 4)), [D_L[c] for c in idx], dl, titulo="[A_i]ᵀ")
        for k in range(nidx):
            for r in range(4):
                w.cell(fT + 2 + k, 2 + r).value = f"={_cel(2 + k, fA + 2 + r)}"
        T_rng = _rango(2, fT + 2, 5, fT + 1 + nidx)
        # [A_i]ᵀ[K_i][A_i] = MMULT(MMULT([A_i]ᵀ,[K]),[A_i])
        fP = f
        f = _matriz(w, f, 1, np.zeros((nidx, nidx)), [D_L[c] for c in idx], [D_L[c] for c in idx],
                    titulo="[A_i]ᵀ[K_i][A_i]" + nota)
        _array(w, _rango(2, fP + 2, 1 + nidx, fP + 1 + nidx, False),
               f"=MMULT(MMULT({T_rng},{K_rng}),{A_rng})", FMT)
        hojas.append((nombre_h, fP + 2, idx))
        # vectores: r, d, q, q total lado a lado
        w.cell(f, 1, "Vectores de la barra").font = TIT
        brazo = bool(b["brazo_ini"] or b["brazo_fin"])
        cab = ["{r}", "{d} = [A_i]{D}", "{q} = [K]{d}", "{q}tot = {q} + {r}"] + (["{q} en el nudo (M + V·a)"] if brazo else [])
        _cab(w, f + 1, 2, cab)
        w.cell(f + 1, 1, "").fill = CAB
        r0 = f + 2
        for r in range(4):
            c0 = w.cell(r0 + r, 1, dl[r]); c0.font = NEG; c0.fill = CAB
            w.cell(r0 + r, 2, float(b["r"][r])).number_format = FMT
        # {d} = MMULT([A_i], {D}); con columnas parciales, suma de productos explícita
        if completo:
            _array(w, f"C{r0}:C{r0 + 3}", f"=MMULT({A_rng},{QRD}!$E$3:$E${2 + nD})", FMT_D)
        else:
            for r in range(4):
                tx = "+".join(f"{_cel(2 + k, fA + 2 + r)}*{QRD}!$E${3 + c}" for k, c in enumerate(idx))
                w.cell(r0 + r, 3, "=" + (tx or "0")).number_format = FMT_D
        # {q} = MMULT([K], {d}); {q}tot = {q} + {r}
        _array(w, f"D{r0}:D{r0 + 3}", f"=MMULT({K_rng},$C${r0}:$C${r0 + 3})", FMT)
        for r in range(4):
            w.cell(r0 + r, 5, f"=D{r0 + r}+B{r0 + r}").number_format = FMT
        if brazo:                         # [T]ᵀ: de la cara al nudo
            w.cell(r0, 6, f"=E{r0}")
            w.cell(r0 + 1, 6, f"=E{r0 + 1}+E{r0}*$K$7")
            w.cell(r0 + 2, 6, f"=E{r0 + 2}")
            w.cell(r0 + 3, 6, f"=E{r0 + 3}-E{r0 + 2}*$K$8")
            for r in range(4):
                w.cell(r0 + r, 6).number_format = FMT
        _ancho(w, n=max(nidx, 5) + 1, ancho=13, primero=18)
        w.column_dimensions["G"].width = 16; w.column_dimensions["J"].width = 16

    # ------------------------------------------------------------------ [K] total
    wk = wb.create_sheet("K total")
    wk["A1"] = "Rigidez de la estructura  [K] = Σ [A_i]ᵀ[K_i][A_i]"; wk["A1"].font = TIT
    _matriz(wk, 2, 1, res["K"], labels, labels)
    if completo and hojas and nD:
        suma = np.zeros((nD, nD))
        for b in barras:
            suma += b["AtKA"]
        extra = res["K"] - suma                       # apoyos elásticos (resortes)
        hay_extra = False
        for i in range(nD):
            for j in range(nD):
                partes = [f"'{h}'!{_cel(2 + j, f0 + i)}" for h, f0, _ in hojas]
                if abs(extra[i, j]) > 1e-12 * max(1.0, abs(res["K"][i, j])):
                    partes.append(repr(float(extra[i, j]))); hay_extra = True
                wk.cell(3 + i, 2 + j).value = "=" + "+".join(partes)
        wk.cell(4 + nD, 1, "Cada celda es la suma de los aportes de las hojas de barra"
                + (" más el aporte de los apoyos elásticos (resortes), escrito como valor." if hay_extra else "."))
    else:
        wk.cell(4 + nD, 1, f"[K] en valores: con más de {MAX_GDL_COMPLETO} GDL las hojas de barra solo guardan sus "
                "columnas participantes, así que la suma no se escribe como fórmula.")
    wk.row_dimensions[2].height = 45
    _ancho(wk, n=nD + 1, ancho=11, primero=26)
    wk.freeze_panes = "B3"

    # ------------------------------------------------------------------ Q, R, D
    wq = wb.create_sheet("Q R D")
    wq["A1"] = "{Q}nudos, {R}, {Q} = {Q}nudos − {R} y {D} = [K]⁻¹{Q}"; wq["A1"].font = TIT
    _cab(wq, 2, 1, ["GDL", "{Q}nudos", "{R}", "{Q} = {Q}nudos − {R}", "{D} (6 cifras significativas)"])
    for k in range(nD):
        c0 = wq.cell(3 + k, 1, labels[k]); c0.font = NEG; c0.fill = CAB
        wq.cell(3 + k, 2, float(res["Qn"][k])).number_format = FMT
        wq.cell(3 + k, 3, float(res["R"][k])).number_format = FMT
        wq.cell(3 + k, 4, f"=B{3 + k}-C{3 + k}").number_format = FMT
    if nD:
        _array(wq, f"E3:E{2 + nD}",
               f"=MMULT(MINVERSE('K total'!$B$3:${get_column_letter(1 + nD)}${2 + nD}),$D$3:$D${2 + nD})", FMT_D)
    wq.cell(4 + nD, 1, "{D} = MMULT(MINVERSE([K]), {Q}) como fórmula de matriz; el formato solo muestra 6 cifras "
            "significativas. {Q}nudos y {R} (empotramientos de las barras) son datos de entrada, en valores.")
    _ancho(wq, n=5, ancho=24, primero=34)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def exportar_excel(est):
    """Resuelve con el método del profesor y devuelve los bytes del .xlsx."""
    res = resolver_profesor(est)
    return excel_desde_resultado(res, est, est.nombre)
