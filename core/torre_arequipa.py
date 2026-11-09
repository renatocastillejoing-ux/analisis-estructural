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
    - Placas (muros) PL-1..PL-12: espesor 0.25 m, longitud 2.40 m en el plano del
      pórtico, en la base de los 3 pórticos de letra A, E, I a los ejes 3, 6, 10, 13.
      (Se modelan como un tramo de sección de muro en la columna, en todos los pisos.)
    - Cargas (solo gravedad, sin sismo):
        CM = 0.40 tonf/m² (losa aligerada e≈20 cm + acabados + tabiquería)
             + peso propio de la viga (2.40 tonf/m³ · b · h).
        CV = 0.25 tonf/m² (oficinas, E.020).
        Carga en vigas por área tributaria (mitad de la distancia a cada pórtico vecino).
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

PLACA_B, PLACA_H = 0.25, 2.40
# placas: (letra_idx, numero_idx) 0-based -> PL-1..PL-12
PLACAS = [(la, nk) for la in (0, 4, 8) for nk in (2, 5, 9, 12)]


def _materiales():
    return [
        {"nombre": "H280", "modo": "fc", "fc": 280, "densidad": GAMMA_HA, "nu": 0.2},
        {"nombre": "H210", "modo": "fc", "fc": 210, "densidad": GAMMA_HA, "nu": 0.2},
    ]


def _mat_piso(piso):
    return "H280" if _f_c(piso) == 280 else "H210"


def _secciones():
    secs = []
    for p in range(1, N_PISOS + 1):
        b = _col_b(p)
        secs.append({"nombre": f"C{p}", "modo": "rect", "b": b, "h": b})
        bv, hv = _viga_bh(p)
        secs.append({"nombre": f"V{p}", "modo": "rect", "b": bv, "h": hv})
        secs.append({"nombre": f"PL{p}", "modo": "rect", "b": PLACA_B, "h": PLACA_H})
    return secs


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
        placa_idx = [nk for (la, nk) in PLACAS if la == idx]
    else:                                   # pórtico vertical: ejes con letra
        ejes = list(range(N_Y)); coord = ys
        trib = _trib_numero(idx); lado_L = SY
        pos_fijo = xs[idx]
        etiqueta = str(idx + 1)
        placa_idx = []                      # las placas van en pórticos de letra
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
            es_placa = (tipo == "letra" and k in placa_idx)
            sec = f"PL{piso}" if es_placa else f"C{piso}"
            elementos.append({"id": eid, "nombre": f"C{eid}", "i": id_of[(k, lvl)],
                              "j": id_of[(k, lvl + 1)], "seccion": sec,
                              "material": _mat_piso(piso)})
            eid += 1
    # vigas (cada piso, tramos entre ejes consecutivos)
    cm_list, cv_list = [], []
    for lvl in range(1, N_PISOS + 1):
        piso = lvl
        bv, hv = _viga_bh(piso)
        peso = GAMMA_HA * bv * hv
        for k in range(len(ejes) - 1):
            elementos.append({"id": eid, "nombre": f"V{eid}", "i": id_of[(k, lvl)],
                              "j": id_of[(k + 1, lvl)], "seccion": f"V{piso}",
                              "material": _mat_piso(piso)})
            w_cm = CM_AREA * trib + peso
            w_cv = CV_AREA * trib
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
        "secciones": _secciones(),
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
    placas = set(PLACAS)
    columnas, vigas = [], []
    for lvl in range(N_PISOS):
        piso = lvl + 1
        z0, z1 = lvl * H_PISO, (lvl + 1) * H_PISO
        b = _col_b(piso)
        for m in range(N_Y):
            for k in range(N_X):
                es_placa = (m, k) in placas
                columnas.append({
                    "x": xs[k], "y": ys[m], "z0": z0, "z1": z1, "piso": piso,
                    "bx": PLACA_H if es_placa else b, "by": PLACA_B if es_placa else b,
                    "placa": es_placa, "letra": chr(ord("A") + m), "numero": k + 1,
                    "seccion": f"PL{piso}" if es_placa else f"C{piso}",
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
