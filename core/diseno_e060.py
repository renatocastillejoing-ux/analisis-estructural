# -*- coding: utf-8 -*-
"""
================================================================================
  DISEÑO EN CONCRETO ARMADO — Norma E.060 (Perú), nivel de curso
================================================================================
  Unidades internas: kgf y cm. Entradas: b, h en m; momentos en tonf·m; fuerzas en tonf.

  VIGAS (flexión simple y cortante)
    d = h − d'  (d' = 6 cm por defecto)
    As: Mu = φ·As·fy·(d − a/2),  a = As·fy/(0.85·f'c·b),  φ = 0.90
    As,mín = 0.7·√f'c/fy·b·d            (E.060 10.5.2)
    As,máx = 0.75·ρb·b·d,  ρb = 0.85·β1·f'c/fy · 6000/(6000+fy)
    Vc = 0.53·√f'c·b·d,  φ = 0.85,  Vs = Vu/φ − Vc ≤ 2.1·√f'c·b·d
    s = Av·fy·d/Vs,  smáx = d/2 ≤ 60 cm  (d/4 ≤ 30 cm si Vs > 1.1·√f'c·b·d)

  COLUMNAS Y PLACAS (flexocompresión biaxial y cortante)
    Diagrama de interacción por compatibilidad de deformaciones (εcu = 0.003,
    bloque de Whitney, acero repartido en las cuatro caras), φ = 0.70 (estribos)
    con transición a 0.90 para carga axial baja; φPn,máx = 0.80·φ·Po.
    Biaxial por contorno de carga (Bresler): (Mux/φMnx)^1.5 + (Muy/φMny)^1.5 ≤ 1.
    Se busca la cuantía mínima ρ entre 1 % y 6 %.
    Las placas se verifican como columnas (simplificación de curso: sin elementos
    de borde ni diseño por capacidad).
================================================================================
"""
import math

import numpy as np

FY = 4200.0          # kgf/cm²
ES = 2.0e6           # kgf/cm²
BARRAS = [("3/8\"", 0.71), ("1/2\"", 1.29), ("5/8\"", 1.99), ("3/4\"", 2.84), ("1\"", 5.10)]


def beta1(fc):
    return max(0.65, min(0.85, 0.85 - 0.05 * (fc - 280) / 70))


def _barras(As, minimo=2, opciones=BARRAS[1:]):
    """Combinación sencilla de barras iguales que cubre As (cm²)."""
    if As <= 0:
        return f"{minimo} ø1/2\""
    mejor = None
    for nom, ab in opciones:
        n = max(minimo, math.ceil(As / ab - 1e-9))
        if n > 8:
            continue
        exceso = n * ab - As
        if mejor is None or exceso < mejor[0] - 1e-9:
            mejor = (exceso, f"{n} ø{nom}", n * ab)
    return mejor[1] if mejor else f"{math.ceil(As / 5.10)} ø1\""


def as_flexion(Mu_tm, b_cm, d_cm, fc, fy=FY):
    """Acero a flexión para Mu (t·m). Devuelve (As cm², ok)."""
    Mu = abs(Mu_tm) * 1e5
    if Mu < 1e-6:
        return 0.0, True
    Ru = Mu / (0.9 * b_cm * d_cm ** 2)
    disc = 1 - 2 * Ru / (0.85 * fc)
    if disc < 0:
        return float("nan"), False
    rho = 0.85 * fc / fy * (1 - math.sqrt(disc))
    return rho * b_cm * d_cm, True


def diseno_viga(b, h, fc, Mneg, Mpos, Vu, fy=FY, recub=6.0):
    """Mneg y Mpos en t·m (valores absolutos de los máximos negativos y positivos)."""
    bc, hc = b * 100, h * 100
    d = hc - recub
    asmin = 0.7 * math.sqrt(fc) / fy * bc * d
    rhob = 0.85 * beta1(fc) * fc / fy * 6000 / (6000 + fy)
    asmax = 0.75 * rhob * bc * d
    out = {"d_cm": round(d, 1), "As_min": round(asmin, 2), "As_max": round(asmax, 2)}
    avisos = []
    comp = {}
    for clave, Mu in (("sup", Mneg), ("inf", Mpos)):
        As, ok = as_flexion(Mu, bc, d, fc, fy)
        out[f"Mu_{clave}"] = round(abs(Mu), 3)
        if not ok or As > asmax:
            # doble refuerzo: As1 = As,máx toma φMn1; el resto lo toma un par As' – As2
            a1 = asmax * fy / (0.85 * fc * bc)
            phiMn1 = 0.9 * asmax * fy * (d - a1 / 2)
            Mu2 = abs(Mu) * 1e5 - phiMn1
            dp = recub
            c = a1 / beta1(fc)
            fsp = min(fy, ES * 0.003 * (c - dp) / c) if c > dp else 0.0     # esfuerzo del acero en compresión
            if fsp <= 0:
                avisos.append(f"Acero {'superior' if clave == 'sup' else 'inferior'}: la sección no alcanza (aumenta el peralte)")
                out[f"As_{clave}"] = None; out[f"barras_{clave}"] = "—"
                continue
            As2 = Mu2 / (0.9 * fy * (d - dp))
            Asp = Mu2 / (0.9 * fsp * (d - dp))
            As = asmax + As2
            if As > 0.025 * bc * d:
                avisos.append(f"Acero {'superior' if clave == 'sup' else 'inferior'}: supera ρ = 2.5 % aun con doble refuerzo (aumenta la sección)")
                out[f"As_{clave}"] = None; out[f"barras_{clave}"] = "—"
                continue
            comp[clave] = Asp
            out[f"doble_{clave}"] = True
        As = max(As, asmin)
        out[f"As_{clave}"] = round(As, 2)
        out[f"barras_{clave}"] = _barras(As)
    # el acero en compresión de una cara se suma al mínimo de la otra (se reporta aparte)
    for clave, Asp in comp.items():
        otra = "inf" if clave == "sup" else "sup"
        out[f"As_comp_{otra}"] = round(Asp, 2)
        if out.get(f"As_{otra}") is not None and out[f"As_{otra}"] < Asp:
            out[f"As_{otra}"] = round(Asp, 2); out[f"barras_{otra}"] = _barras(Asp)
    if comp:
        out["doble_refuerzo"] = True
    # cortante
    Vu_k = abs(Vu) * 1000
    Vc = 0.53 * math.sqrt(fc) * bc * d
    Vs = max(0.0, Vu_k / 0.85 - Vc)
    vsmax = 2.1 * math.sqrt(fc) * bc * d
    Av = 2 * 0.71
    smax = min(d / 2, 60) if Vs <= 1.1 * math.sqrt(fc) * bc * d else min(d / 4, 30)
    if Vs > vsmax:
        avisos.append("Cortante: Vs supera 2.1·√f'c·b·d (aumenta la sección)")
        s = None
    else:
        s = min(smax, Av * fy * d / Vs) if Vs > 0 else smax
        s = math.floor(s / 2.5) * 2.5
    out.update({"Vu": round(abs(Vu), 3), "phiVc": round(0.85 * Vc / 1000, 3), "Vs": round(Vs / 1000, 3),
                "estribos": f"ø3/8\" @ {s:.1f} cm" if s else "—", "s_cm": s,
                "estado": "no cumple" if avisos else "cumple", "avisos": avisos})
    return out


def _interaccion(bw, h, fc, As_tot, fy=FY, recub=6.0, n=90):
    """Curva (φPn, φMn) en kgf y kgf·cm para flexión con peralte h y ancho bw.
    Acero: mitad en cada cara extrema más una capa central (si h > 40 cm)."""
    capas = [(recub, As_tot * 0.4), (h - recub, As_tot * 0.4), (h / 2, As_tot * 0.2)] if h > 40 else \
            [(recub, As_tot * 0.5), (h - recub, As_tot * 0.5)]
    b1 = beta1(fc); Ag = bw * h
    Po = 0.85 * fc * (Ag - As_tot) + fy * As_tot
    cs = np.concatenate([np.linspace(0.05 * h, h, n // 2), np.linspace(h, 4 * h, n // 2)])
    P, M = [], []
    for c in cs:
        a = min(b1 * c, h)
        Cc = 0.85 * fc * a * bw
        Pn = Cc; Mn = Cc * (h / 2 - a / 2)
        for di, Asi in capas:
            es = 0.003 * (c - di) / c
            fs = max(-fy, min(fy, es * ES))
            if di < a: fs -= 0.85 * fc
            Pn += Asi * fs; Mn += Asi * fs * (h / 2 - di)
        et = 0.003 * (c - (h - recub)) / c
        phi = 0.7 if et >= -0.002 else min(0.9, 0.7 + (abs(et) - 0.002) / 0.003 * 0.2)
        P.append(min(phi * Pn, 0.8 * 0.7 * Po)); M.append(phi * max(Mn, 0))
    # tracción pura
    P.append(-0.9 * fy * As_tot); M.append(0.0)
    return np.array(P), np.array(M), 0.8 * 0.7 * Po


def _phiMn_en(P, M, Pu):
    """Capacidad φMn al nivel de carga Pu (interpolando la curva, ordenada por P)."""
    o = np.argsort(P)
    Ps, Ms = P[o], M[o]
    if Pu > Ps[-1] or Pu < Ps[0]:
        return 0.0
    return float(np.interp(Pu, Ps, Ms))


def diseno_columna(b, h, fc, Pu, Mux, Muy, Vu=0.0, fy=FY, recub=6.0):
    """Pu en t (compresión +), Mux = momento con el peralte h (t·m), Muy con el peralte b."""
    bc, hc = b * 100, h * 100
    Ag = bc * hc
    Pk = Pu * 1000; mx = abs(Mux) * 1e5; my = abs(Muy) * 1e5
    resultado = None
    for rho in np.arange(0.01, 0.0601, 0.0025):
        As = rho * Ag
        Px, Mx, Pmax = _interaccion(bc, hc, fc, As, fy, recub)
        Py, My, _ = _interaccion(hc, bc, fc, As, fy, recub)
        if Pk > Pmax:
            continue
        cx = _phiMn_en(Px, Mx, Pk); cy = _phiMn_en(Py, My, Pk)
        if (mx > 0 and cx <= 0) or (my > 0 and cy <= 0):
            continue
        ratio = ((mx / cx) ** 1.5 if mx > 0 else 0) + ((my / cy) ** 1.5 if my > 0 else 0)
        if ratio <= 1.0:
            resultado = {"rho": round(float(rho) * 100, 2), "As": round(float(As), 2), "ratio": round(float(ratio), 3),
                         "phiMnx": round(float(cx) / 1e5, 2), "phiMny": round(float(cy) / 1e5, 2), "phiPn_max": round(float(Pmax) / 1000, 1)}
            break
    out = {"Pu": round(Pu, 2), "Mux": round(abs(Mux), 3), "Muy": round(abs(Muy), 3)}
    if resultado is None:
        out.update({"estado": "no cumple", "avisos": ["No alcanza ni con ρ = 6 %: aumenta la sección"], "rho": None, "barras": "—"})
    else:
        nb = max(4, 2 * math.ceil(resultado["As"] / 2 / 2.84))
        ab = resultado["As"] / nb
        nom = next((n for n, a in BARRAS[1:] if a >= ab), "1\"")
        out.update(resultado); out.update({"estado": "cumple", "avisos": [], "barras": f"{nb} ø{nom}"})
    # cortante
    d = max(bc, hc) - recub
    Vc = 0.53 * math.sqrt(fc) * (1 + max(Pk, 0) / (140 * Ag)) * min(bc, hc) * d
    Vs = max(0.0, abs(Vu) * 1000 / 0.85 - Vc)
    s = min(d / 2, 30.0, 16 * 1.59) if Vs <= 0 else min(2 * 0.71 * fy * d / Vs, d / 2, 30.0)
    out.update({"estribos": f"ø3/8\" @ {math.floor(s / 2.5) * 2.5:.1f} cm", "Vu": round(abs(Vu), 3)})
    return out


def disenar_3d(res, elementos_info):
    """Diseño de todas las barras de un resultado 3D con la envolvente de las combinaciones."""
    combos = [c for c in res["casos"] if c not in res.get("casos_base", [])] or res["casos"]
    out = []
    for k, e in enumerate(elementos_info):
        env = {key: max(abs(res["barras"][c][key][k]) for c in combos) for key in ("Mz", "My", "V")}
        Nmax = max(-res["barras"][c]["N"][k] for c in combos)          # compresión (+)
        Mpos = max(res["barras"][c].get("Mz_pos", [0] * (k + 1))[k] for c in combos)
        Mneg = max(res["barras"][c].get("Mz_neg", [0] * (k + 1))[k] for c in combos)
        fc = float(e.get("fc", 210) or 210)
        if e["tipo"] in ("columna", "placa"):
            # 3D: columnas con w = b en X; Mz usa el peralte w (= b sin giro), My el lado d
            # Mz flexiona con el peralte b (lado w de la sección) y My con el lado h
            dd = diseno_columna(e["b"], e["h"], fc, Nmax, env["My"], env["Mz"], env["V"])
        else:
            dd = diseno_viga(e["b"], e["h"], fc, Mneg or env["Mz"], Mpos or env["Mz"], env["V"])
        out.append({"id": e["id"], "nombre": e["nombre"], "tipo": e["tipo"], "sec": e["sec"], **dd})
    return out


def disenar_2d(elementos):
    """elementos: [{nombre, tipo: viga|columna, b, h, fc, M: [...], V: [...], N: [...]}] (convención del motor 2D:
    M > 0 tracción abajo en vigas; N > 0 tracción)."""
    out = []
    for e in elementos:
        M = np.asarray(e["M"], float); V = np.asarray(e["V"], float); N = np.asarray(e.get("N", [0]), float)
        fc = float(e.get("fc", 210) or 210)
        if e["tipo"] == "columna":
            dd = diseno_columna(e["b"], e["h"], fc, float(max(-N.min(), 0) if len(N) else 0), float(np.abs(M).max()), 0.0, float(np.abs(V).max()))
        else:
            dd = diseno_viga(e["b"], e["h"], fc, float(max(-M.min(), 0)), float(max(M.max(), 0)), float(np.abs(V).max()))
        out.append({"nombre": e["nombre"], "tipo": e["tipo"], "b": e["b"], "h": e["h"], **dd})
    return out
