# -*- coding: utf-8 -*-
"""
Torre Arequipa - sismo estático E.030 (Perú) y deriva por pórtico (2D por eje).
SUPUESTOS (asumidos por el equipo; cambiar aquí):
  Z = 0.35 (zona 3, Arequipa), S = 1.15 (suelo S2), TP = 0.6 s, TL = 2.0 s,
  U = 1.00 (edificación común), R = 8 (sistema dual, con placas), CT = 60 (muros).
  Peso sísmico = CM + 25 % CV de todos los pisos (E.030, categoría C).
  Fuerzas laterales por piso: Fi = (V − Ft)·Pi·hi^k / Σ Pj·hj^k.
  Reparto a los pórticos por área tributaria (mitad de la distancia a cada eje).
  Deriva inelástica = 0.75·R·Δelástica / h  ≤ 0.007 (concreto armado).
"""
import math
import numpy as np
from core.torre_arequipa import (N_X, N_Y, N_PISOS, H_PISO, SX, SY,
                                 CM_AREA, CV_AREA, GAMMA_HA, _viga_bh)

Z, S, TP, TL, U, R, CT = 0.35, 1.15, 0.6, 2.0, 1.0, 8.0, 60.0
LIMITE_DERIVA = 0.007
G_REF = 9.81


def _area_planta():
    return sum(SX) * sum(SY)


def periodo():
    hn = N_PISOS * H_PISO
    return hn / CT


def C_factor(T):
    C = 2.5 * (TP / T) if T > TP else 2.5
    return min(C, 2.5)


def k_exponente(T):
    return 1.0 if T <= 0.5 else (0.75 + 0.5 * T)


def peso_piso(piso):
    """Peso sísmico (tonf) de un piso: CM (losa+acabados+peso de vigas) + 25 % CV."""
    A = _area_planta()
    bv, hv = _viga_bh(piso)
    # vigas: aprox. longitud total de vigas por piso en el plano (ambas direcciones)
    L_vigas = sum(SX) * N_Y + sum(SY) * N_X
    cm = CM_AREA * A + GAMMA_HA * bv * hv * L_vigas
    cv = CV_AREA * A
    return cm + 0.25 * cv


def fuerzas_piso(direccion="X"):
    """Fuerzas laterales Fi por piso (tonf) para el sismo en la dirección dada.
    Devuelve (lista de Fi por piso 1..10, V basal, T, C)."""
    T = periodo(); C = C_factor(T); k = k_exponente(T)
    P = [peso_piso(p) for p in range(1, N_PISOS + 1)]
    h = [H_PISO * p for p in range(1, N_PISOS + 1)]
    V = Z * U * C * S / R * sum(P)           # cortante basal (E.030)
    Ft = 0.07 * T * V if T > 0.7 else 0.0
    den = sum(Pi * hi ** k for Pi, hi in zip(P, h))
    F = [(V - Ft) * Pi * hi ** k / den for Pi, hi in zip(P, h)]
    F[-1] += Ft
    return F, V, T, C


def reparto_pórtico(tipo, idx):
    """Fracción del cortante que toma el pórtico `tipo` (letra o número), por
    área tributaria en la dirección de la carga."""
    if tipo == "letra":                      # pórtico horizontal (sismo en X)
        t = 0.0
        if idx > 0: t += SY[idx - 1] / 2.0
        if idx < N_Y - 1: t += SY[idx] / 2.0
        return t / sum(SY)
    t = 0.0
    if idx > 0: t += SX[idx - 1] / 2.0
    if idx < N_X - 1: t += SX[idx] / 2.0
    return t / sum(SX)


def cargas_sismo_pórtico(datos, tipo, idx, direccion="X"):
    """Añade al modelo del pórtico las fuerzas sísmicas (elásticas, sin /R)
    repartidas a los nudos de cada piso. Devuelve el diccionario modificado."""
    F, V, T, C = fuerzas_piso(direccion)
    frac = reparto_pórtico(tipo, idx)
    # Sismo en X actúa sobre pórticos horizontales (letra); en Y sobre los de número.
    if (direccion == "X") != (tipo == "letra"):
        return datos
    nudos_piso = {}
    for nd in datos["nudos"]:
        lvl = int(round(nd["y"] / H_PISO))
        if lvl >= 1:
            nudos_piso.setdefault(lvl, []).append(nd["id"])
    cn = []
    for lvl, ids in nudos_piso.items():
        Fp = F[lvl - 1] * frac / len(ids)
        for nid in ids:
            cn.append({"nudo": nid, "Fx": Fp, "Fy": 0.0, "M": 0.0})
    datos = dict(datos)
    datos["cargas_nodales"] = cn
    return datos


def info_sismo():
    F, V, T, C = fuerzas_piso("X")
    return {"T": round(T, 3), "C": round(C, 3), "k": round(k_exponente(T), 3),
            "V_basal_tonf": round(V, 2), "peso_total_tonf": round(sum(peso_piso(p) for p in range(1, N_PISOS+1)), 1),
            "Fi_tonf": [round(f, 2) for f in F]}


def derivas(direccion_sismo="X"):
    """Resuelve, para cada pórtico que recibe el sismo, el caso sísmico elástico y
    devuelve la deriva inelástica máxima por pórtico (0.75·R·Δe/h)."""
    from core.torre_arequipa import portico, todos_los_pórticos
    from core.constructor import construir
    out = []
    for nombre, tipo, idx in todos_los_pórticos():
        if (direccion_sismo == "X") != (tipo == "letra"):
            continue
        d = portico(tipo, idx)
        d.pop("casos", None); d.pop("combinaciones", None)
        d["cargas_elementos"] = []
        d = cargas_sismo_pórtico(d, tipo, idx, direccion_sismo)
        est = construir(d); est.resolver()
        niveles = {}
        for nd in est.nudos:
            ux = float(est.D[nd.gdl[0]]) if nd.restriccion[0] == 0 else 0.0
            niveles.setdefault(round(nd.y, 6), []).append(ux)
        ys = sorted(niveles)
        dr = []
        for a, b in zip(ys[:-1], ys[1:]):
            de = abs(np.mean(niveles[b]) - np.mean(niveles[a]))
            dr.append(0.75 * R * de / (b - a))
        out.append({"pórtico": nombre, "deriva_inelastica_max": max(dr),
                    "piso_critico": int(np.argmax(dr)) + 1,
                    "cumple": max(dr) <= LIMITE_DERIVA})
    return out


if __name__ == "__main__":
    print("sismo:", info_sismo())
    for direc in ("X", "Y"):
        rs = derivas(direc)
        worst = max(rs, key=lambda r: r["deriva_inelastica_max"])
        print("dir %s: %d pórticos | deriva máx %.5f en %s, piso %d | cumplen: %d/%d" % (
            direc, len(rs), worst["deriva_inelastica_max"], worst["pórtico"], worst["piso_critico"],
            sum(r["cumple"] for r in rs), len(rs)))
