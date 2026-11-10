# -*- coding: utf-8 -*-
"""
================================================================================
  TORRE AREQUIPA - modelo de 24 pórticos planos (análisis 2D por eje)
================================================================================
  SUPUESTOS (definidos por el equipo; cambiar aquí, todo lo demás se recalcula):
    - Grilla: 15 ejes numerados (1..15, separación X) y 9 ejes con letra (A..I,
      separación Y). Vanos X = 4.50 m (14 vanos), vanos Y = 5.00 m (8 vanos).
    - 10 pisos, altura de entrepiso 3.00 m. Base empotrada (sótano rígido).
    - Columna en cada intersección de la grilla; viga en cada tramo entre ellas.
    - f'c: pisos 1-3 = 280 kgf/cm²; pisos 4-10 = 210 kgf/cm² (E = 15000·√f'c).
    - Columnas: pisos 1-3 = 0.60×0.60 m ; 4-7 = 0.50×0.50 ; 8-10 = 0.40×0.40.
    - Vigas: pisos 1-3 = 0.35×0.60 m ; 4-10 = 0.30×0.50 m.
    - Placas (muros) de 0.30 m de espesor y 3.50 m de longitud, en todos los pisos
      (estudio de deriva 2026-11-10, configuración «D»):
        · 12 a lo largo de X: ejes con letra A, E, I × ejes numerados 3, 6, 10, 13.
        · 10 a lo largo de Y: ejes numerados 1, 4, 8, 12, 15 × ejes con letra B, H.
      Se modelan como columnas anchas centradas en el nudo; las vigas que llegan a
      ellas tienen brazos rígidos de media longitud de placa.
      Resultado 3D (espectral E.030, CQC): deriva X 0.0056, Y 0.0062 ≤ 0.007; las
      placas toman ≈ 75 % del cortante → sistema de muros estructurales (R0 = 6).
    - Cargas (gravedad):
        CM = 0.40 tonf/m² (losa aligerada e≈20 cm + acabados + tabiquería)
             + peso propio de vigas y columnas (2.40 tonf/m³).
        CV = 0.25 tonf/m² (oficinas, E.020).
        La losa se reparte en DOS direcciones (líneas a 45°) a las vigas de cada paño,
        una sola vez; los pórticos 2D usan exactamente esas cargas (antes cada pórtico
        tomaba el ancho tributario completo en ambas direcciones y la losa se contaba
        dos veces).
    - Combinación de diseño: 1.4·CM + 1.7·CV (E.060). Se reporta también CM y CV.
    - Hipótesis de cálculo: deformación axial despreciada (método a mano del curso).
    - Cada columna pertenece a dos pórticos (el de su letra y el de su número);
      cada pórtico se resuelve por separado (análisis 2D por eje).
================================================================================
"""
import numpy as np

N_X = 15                 # ejes numerados 1..15
N_Y = 9                  # ejes con letra A..I
SX = [4.5] * (N_X - 1)   # separación entre ejes numerados (m)
SY = [5.0] * (N_Y - 1)   # separación entre ejes con letra (m)
N_PISOS = 10
H_PISO = 3.0
GAMMA_HA = 2.4           # tonf/m³
CM_AREA = 0.40           # tonf/m²
CV_AREA = 0.25           # tonf/m²
COMBO = {"nombre": "1.4CM+1.7CV", "factores": {"CM": 1.4, "CV": 1.7}}

# secciones de vigas y columnas por piso
def _f_c(piso):                          # piso 1-based
    return 280 if piso <= 3 else 210

def _col_b(piso):
    if piso <= 3: return 0.60
    if piso <= 7: return 0.50
    return 0.40

def _viga_bh(piso):
    return (0.35, 0.60) if piso <= 3 else (0.30, 0.50)

PLACA_B, PLACA_H = 0.30, 3.50          # espesor y longitud de las placas en X
PLACA_HY = 3.50                         # longitud de las placas en Y
# placas: (letra_idx, numero_idx) 0-based
PLACAS = [(la, nk) for la in (0, 4, 8) for nk in (2, 5, 9, 12)]                 # a lo largo de X
PLACAS_Y = [(la, nk) for nk in (0, 3, 7, 11, 14) for la in (1, 7)]              # a lo largo de Y


def _materiales():
    return [
        {"nombre": "H280", "modo": "fc", "fc": 280, "densidad": GAMMA_HA, "nu": 0.2},
        {"nombre": "H210", "modo": "fc", "fc": 210, "densidad": GAMMA_HA, "nu": 0.2},
    ]


def _mat_piso(piso):
    return "H280" if _f_c(piso) == 280 else "H210"


def _secciones(tipo="letra"):
    """Secciones 2D: h es el peralte EN EL PLANO del pórtico. Una placa en X trabaja
    con su longitud en los pórticos con letra y con su espesor en los numerados."""
    secs = []
    for p in range(1, N_PISOS + 1):
        b = _col_b(p)
        secs.append({"nombre": f"C{p}", "modo": "rect", "b": b, "h": b})
        bv, hv = _viga_bh(p)
        secs.append({"nombre": f"V{p}", "modo": "rect", "b": bv, "h": hv})
        if tipo == "letra":
            secs.append({"nombre": f"PL{p}", "modo": "rect", "b": PLACA_B, "h": PLACA_H})
            secs.append({"nombre": f"PLY{p}", "modo": "rect", "b": PLACA_HY, "h": PLACA_B})
        else:
            secs.append({"nombre": f"PL{p}", "modo": "rect", "b": PLACA_H, "h": PLACA_B})
            secs.append({"nombre": f"PLY{p}", "modo": "rect", "b": PLACA_B, "h": PLACA_HY})
    return secs


_CARGAS_3D = None


def _cargas_3d():
    """Carga uniforme equivalente (t/m) de cada viga por caso, con el reparto en dos
    direcciones del modelo 3D (una sola vez para toda la torre)."""
    global _CARGAS_3D
    if _CARGAS_3D is None:
        from core.analisis_3d import analizar_cargas_barras
        m = modelo3d_torre()
        w = analizar_cargas_barras(m)
        nombre = {e["id"]: e["nombre"] for e in m["elementos"]}
        _CARGAS_3D = {caso: {nombre[i]: v for i, v in d.items()} for caso, d in w.items()}
    return _CARGAS_3D


def _coords_X():
    xs = [0.0]
    for s in SX: xs.append(xs[-1] + s)
    return xs


def _coords_Y():
    ys = [0.0]
    for s in SY: ys.append(ys[-1] + s)
    return ys


def _trib_letra(m):
    """Ancho tributario (m) de la losa para el pórtico de la letra m."""
    t = 0.0
    if m > 0: t += SY[m - 1] / 2.0
    if m < N_Y - 1: t += SY[m] / 2.0
    return t


def _trib_numero(k):
    t = 0.0
    if k > 0: t += SX[k - 1] / 2.0
    if k < N_X - 1: t += SX[k] / 2.0
    return t


def construir_portico(tipo, idx):
    """Devuelve el diccionario de datos (formato de constructor.construir) del
    pórtico `tipo` ('letra' o 'numero') con índice `idx` (0-based).
    Las cargas se dan en dos casos: 'CM' y 'CV' (para la combinación)."""
    xs, ys = _coords_X(), _coords_Y()
    if tipo == "letra":                     # pórtico horizontal: ejes numerados
        ejes = list(range(N_X)); coord = xs
        trib = _trib_letra(idx); lado_L = SX
        pos_fijo = ys[idx]                 # y del pórtico
        etiqueta = chr(ord("A") + idx)
        placa_x = {nk for (la, nk) in PLACAS if la == idx}
        placa_y = {nk for (la, nk) in PLACAS_Y if la == idx}
    else:                                   # pórtico vertical: ejes con letra
        ejes = list(range(N_Y)); coord = ys
        trib = _trib_numero(idx); lado_L = SY
        pos_fijo = xs[idx]
        etiqueta = str(idx + 1)
        placa_x = {la for (la, nk) in PLACAS if nk == idx}
        placa_y = {la for (la, nk) in PLACAS_Y if nk == idx}
    nombre = f"Pórtico {etiqueta}"

    nudos, id_of = [], {}
    nid = 1
    for lvl in range(N_PISOS + 1):
        for k in range(len(ejes)):
            # 2D: x = posición horizontal del eje (coordenada de planta), y = altura
            x = float(coord[k])
            y = float(lvl * H_PISO)
            ap = "empotrado" if lvl == 0 else "libre"
            nudos.append({"id": nid, "nombre": f"N{nid}", "x": x, "y": y, "apoyo": ap})
            id_of[(k, lvl)] = nid; nid += 1

    elementos, ce_list = [], []
    eid = 1
    # columnas
    for k in range(len(ejes)):
        for lvl in range(N_PISOS):
            piso = lvl + 1
            sec = f"PL{piso}" if k in placa_x else f"PLY{piso}" if k in placa_y else f"C{piso}"
            elementos.append({"id": eid, "nombre": f"C{eid}", "i": id_of[(k, lvl)],
                              "j": id_of[(k, lvl + 1)], "seccion": sec,
                              "material": _mat_piso(piso)})
            eid += 1
    # vigas (cada piso, tramos entre ejes consecutivos)
    cm_list, cv_list = [], []
    c3 = _cargas_3d()
    for lvl in range(1, N_PISOS + 1):
        piso = lvl
        for k in range(len(ejes) - 1):
            elementos.append({"id": eid, "nombre": f"V{eid}", "i": id_of[(k, lvl)],
                              "j": id_of[(k + 1, lvl)], "seccion": f"V{piso}",
                              "material": _mat_piso(piso)})
            n3 = (f"V{chr(65 + idx)}{k + 1}-{k + 2}-{lvl}" if tipo == "letra"
                  else f"V{idx + 1}{chr(65 + k)}-{chr(66 + k)}-{lvl}")
            w_cm = -c3.get("CM", {}).get(n3, 0.0)
            w_cv = -c3.get("CV", {}).get(n3, 0.0)
            cm_list.append({"elem": eid, "tipo": "distribuida", "subtipo": "uniforme",
                            "wy": -w_cm, "wx": 0.0})
            cv_list.append({"elem": eid, "tipo": "distribuida", "subtipo": "uniforme",
                            "wy": -w_cv, "wx": 0.0})
            eid += 1

    datos = {
        "nombre": nombre, "unidad_fuerza": "tonf", "unidad_longitud": "m",
        "despreciar_axial": True,
        "material": {"modo": "fc", "fc": 280},
        "materiales": _materiales(),
        "secciones": _secciones(tipo),
        "nudos": nudos, "elementos": elementos,
        "cargas_nodales": [],
        "cargas_elementos": [],
        "casos": [{"nombre": "CM", "cargas_nodales": [], "cargas_elementos": cm_list},
                  {"nombre": "CV", "cargas_nodales": [], "cargas_elementos": cv_list}],
        "combinaciones": [COMBO],
    }
    return datos


def portico(tipo, idx):
    return construir_portico(tipo, idx)


def todos_los_pórticos():
    """Lista de (nombre, tipo, idx) de los 24 pórticos de la torre."""
    out = []
    for m in range(N_Y):
        out.append((f"Eje {chr(ord('A')+m)}", "letra", m))
    for k in range(N_X):
        out.append((f"Eje {k+1}", "numero", k))
    return out


def geometria_3d():
    """Geometría completa de la torre para el visor 3D (misma fuente que los
    pórticos 2D). Coordenadas: x = ejes numerados, y = ejes con letra, z = altura."""
    xs, ys = _coords_X(), _coords_Y()
    placas = set(PLACAS); placas_y = set(PLACAS_Y)
    columnas, vigas = [], []
    for lvl in range(N_PISOS):
        piso = lvl + 1
        z0, z1 = lvl * H_PISO, (lvl + 1) * H_PISO
        b = _col_b(piso)
        for m in range(N_Y):
            for k in range(N_X):
                px_, py_ = (m, k) in placas, (m, k) in placas_y
                columnas.append({
                    "x": xs[k], "y": ys[m], "z0": z0, "z1": z1, "piso": piso,
                    "bx": PLACA_H if px_ else PLACA_B if py_ else b, "by": PLACA_B if px_ else PLACA_HY if py_ else b,
                    "placa": px_ or py_, "letra": chr(ord("A") + m), "numero": k + 1,
                    "seccion": f"PL{piso}" if px_ else f"PLY{piso}" if py_ else f"C{piso}",
                })
        bv, hv = _viga_bh(piso)
        for m in range(N_Y):                 # vigas en dirección X (pórticos de letra)
            for k in range(N_X - 1):
                vigas.append({"x0": xs[k], "y0": ys[m], "x1": xs[k + 1], "y1": ys[m], "z": z1,
                              "b": bv, "h": hv, "piso": piso, "dir": "x",
                              "letra": chr(ord("A") + m), "numero": None, "seccion": f"V{piso}"})
        for k in range(N_X):                 # vigas en dirección Y (pórticos numerados)
            for m in range(N_Y - 1):
                vigas.append({"x0": xs[k], "y0": ys[m], "x1": xs[k], "y1": ys[m + 1], "z": z1,
                              "b": bv, "h": hv, "piso": piso, "dir": "y",
                              "letra": None, "numero": k + 1, "seccion": f"V{piso}"})
    return {
        "xs": xs, "ys": ys, "n_pisos": N_PISOS, "h_piso": H_PISO,
        "ejes_x": [str(k + 1) for k in range(N_X)],
        "ejes_y": [chr(ord("A") + m) for m in range(N_Y)],
        "columnas": columnas, "vigas": vigas,
        "supuestos": {"cm": CM_AREA, "cv": CV_AREA, "placa": [PLACA_B, PLACA_H]},
    }


def modelo3d_torre(placas_x=None, placas_y=None, L_x=None, L_y=None, t=None, dinamico=True):
    """La torre completa en el formato del editor 3D (core/analisis_3d.py).
    placas_x: [(letra_idx, numero_idx)] placas con su longitud a lo largo de X (en pórticos con letra);
    placas_y: [(letra_idx, numero_idx)] placas a lo largo de Y (en pórticos numerados)."""
    from core.torre_sismo import Z, S, TP, TL, U, R, CT
    xs, ys = _coords_X(), _coords_Y()
    px = set(PLACAS if placas_x is None else placas_x)
    py = set(PLACAS_Y if placas_y is None else placas_y)
    Lx = PLACA_H if L_x is None else L_x; Ly = PLACA_HY if L_y is None else L_y; tp = PLACA_B if t is None else t
    secs = []
    for p in range(1, N_PISOS + 1):
        b = _col_b(p); bv, hv = _viga_bh(p)
        secs += [{"nombre": f"C{p}", "b": b, "h": b}, {"nombre": f"V{p}", "b": bv, "h": hv}]
        if px: secs.append({"nombre": f"PL{p}", "b": Lx, "h": tp})          # b a lo largo de X
        if py: secs.append({"nombre": f"PLY{p}", "b": tp, "h": Ly})         # h a lo largo de Y
    secs_u = list({s["nombre"]: s for s in secs}.values())
    nudos, nid = [], {}
    for lv in range(N_PISOS + 1):
        for m in range(N_Y):
            for k in range(N_X):
                i = len(nudos) + 1
                nid[(k, m, lv)] = i
                nudos.append({"id": i, "nombre": f"{chr(65+m)}{k+1}-{lv}", "x": xs[k], "y": ys[m], "z": lv * H_PISO,
                              "apoyo": "empotrado" if lv == 0 else "libre"})
    els = []
    def add(i, j, sec, mat, nombre):
        els.append({"id": len(els) + 1, "nombre": nombre, "i": i, "j": j, "seccion": sec, "material": mat})
    for lv in range(N_PISOS):
        p = lv + 1
        for m in range(N_Y):
            for k in range(N_X):
                if (m, k) in px: sec, pre = f"PL{p}", "PL"
                elif (m, k) in py: sec, pre = f"PLY{p}", "PLY"
                else: sec, pre = f"C{p}", "C"
                add(nid[(k, m, lv)], nid[(k, m, lv + 1)], sec, _mat_piso(p), f"{pre}{chr(65+m)}{k+1}-{p}")
    for lv in range(1, N_PISOS + 1):
        for m in range(N_Y):
            for k in range(N_X - 1):
                add(nid[(k, m, lv)], nid[(k + 1, m, lv)], f"V{lv}", _mat_piso(lv), f"V{chr(65+m)}{k+1}-{k+2}-{lv}")
        for k in range(N_X):
            for m in range(N_Y - 1):
                add(nid[(k, m, lv)], nid[(k, m + 1, lv)], f"V{lv}", _mat_piso(lv), f"V{k+1}{chr(65+m)}-{chr(66+m)}-{lv}")
    return {
        "tipo": "3d", "nombre": "Torre de Arequipa", "unidad_fuerza": "tonf", "unidad_longitud": "m",
        "ejes": {"x": [{"nombre": str(k + 1), "c": xs[k]} for k in range(N_X)],
                 "y": [{"nombre": chr(65 + m), "c": ys[m]} for m in range(N_Y)]},
        "niveles": [{"nombre": "Base" if lv == 0 else f"Piso {lv}", "z": lv * H_PISO} for lv in range(N_PISOS + 1)],
        "materiales": _materiales(), "material": "H280",
        "secciones": secs_u, "nudos": nudos, "elementos": els,
        "casos": [{"nombre": "CM"}, {"nombre": "CV"}],
        "cargas_area": [c for lv in range(1, N_PISOS + 1) for c in
                        ({"z": lv * H_PISO, "caso": "CM", "q": CM_AREA}, {"z": lv * H_PISO, "caso": "CV", "q": CV_AREA})],
        "cargas_barras": [], "cargas_nudos": [],
        "peso_propio": True, "caso_peso_propio": "CM", "diafragma": True,
        "brazos_rigidos": {"modo": "placas", "factor": 1.0},
        "sismo": {"activo": True, "dinamico": bool(dinamico), "Z": Z, "U": U, "S": S, "R": R, "TP": TP, "TL": TL, "CT": CT,
                  "periodo": "norma", "caso_masa": {"CM": 1.0, "CV": 0.25}},
        "combinaciones": [],
    }
