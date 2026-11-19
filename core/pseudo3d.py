# -*- coding: utf-8 -*-
"""
================================================================================
  ANÁLISIS PSEUDO-TRIDIMENSIONAL (método del profesor)
================================================================================
  1. Cada pórtico plano (un eje, un tramo) se resuelve con el método sistematizado:
       [K] = Σ [A]ᵀ[k][A]       (barras 4×4, EA = ∞)
  2. Rigidez lateral del pórtico: se condensan los giros (y toda traslación que no
     sea el desplazamiento lateral de un nudo de diafragma):
       [KL] = [Ktt] − [Kto][Koo]⁻¹[Kot]
  3. Compatibilidad pórtico–diafragma (3 GDL por diafragma: Dx, Dy, θ en su centro):
       pórtico en X (y = y₀):  u = Dx − θ·(y₀ − yc)
       pórtico en Y (x = x₀):  u = Dy + θ·(x₀ − xc)
     → fila de [r] por cada GDL lateral del pórtico.
  4. Rigidez del edificio:  [K]ed = Σ [r]ᵀ[KL][r]      {D}ed = [K]ed⁻¹{F}
  5. De vuelta en cada pórtico: {Dt} = [r]{D}ed, {Do} = −[Koo]⁻¹[Kot]{Dt}, y con [A]:
       {d} = [A]{D},  {q} = [k]{d}   (fuerzas de cada barra por el sismo)
  Las fuerzas {F} son las de la E.030 (estático, por bloque, con excentricidad
  accidental del 5 %), las mismas que usa el análisis 3D.
================================================================================
"""
import time

import numpy as np

from core.constructor import construir
from core.metodo_profesor import resolver_profesor

TOL = 1e-6


def _porticos(m):
    """[(nombre, eje3d, valor, modelo2d)] por eje y por tramo conexo, sin cargas."""
    from core.analisis_3d import portico_desde_3d
    from core.torre_plano import _componentes, _eje_de, geo
    G = geo()
    out = []
    for tipo, eje3d, ejes, otros in (("letra", "x", G["ejes_y"], G["ejes_x"]), ("numero", "y", G["ejes_x"], G["ejes_y"])):
        for nombre, c in ejes.items():
            d = portico_desde_3d(m, eje3d, c, {})
            if not d["elementos"]:
                continue
            comps = _componentes(d)
            for ids in comps:
                g = set(ids)
                y_de = {n["id"]: n["y"] for n in d["nudos"]}
                eg = [e for e in d["elementos"] if e["i"] in g]
                if not any(abs(y_de[e["i"]] - y_de[e["j"]]) > TOL for e in eg):
                    continue
                if not any(abs(y_de[e["i"]] - y_de[e["j"]]) < TOL and not e.get("enlace") for e in eg):
                    continue
                d2 = dict(d)
                d2["nudos"] = [n for n in d["nudos"] if n["id"] in g]
                d2["elementos"] = eg
                d2["cargas_elementos"] = []; d2["cargas_nodales"] = []; d2.pop("casos", None)
                xs = sorted(n["x"] for n in d2["nudos"])
                tramo = (_eje_de(xs[0], otros, -1), _eje_de(xs[-1], otros, +1))
                etq = f"Eje {nombre}" + (f" ({tramo[0]}–{tramo[1]})" if len(comps) > 1 else "")
                out.append((etq, eje3d, float(c), d2))
    return out


def analizar_pseudo3d(m=None):
    """Análisis sísmico pseudo-tridimensional de la torre (o de un modelo 3D del editor)."""
    t0 = time.time()
    if m is None:
        from core.torre_plano import modelo3d_torre
        m = modelo3d_torre(dinamico=False)
    from core.analisis_3d import analizar_modelo3d
    s = analizar_modelo3d({**m, "diafragma": True, "disenar": False, "_solo_sismo": True,
                           "sismo": {**(m.get("sismo") or {}), "activo": True, "dinamico": False}})
    claves = sorted(s["diaf"])
    col = {c: 3 * k for k, c in enumerate(claves)}
    nd = 3 * len(claves)
    xyz = {n["id"]: (float(n["x"]), float(n["y"]), float(n["z"])) for n in m["nudos"]}

    porticos = []
    Ked = np.zeros((nd, nd))
    for nombre, eje3d, valor, d2 in _porticos(m):
        est = construir(d2)
        res = resolver_profesor(est)
        K = res["K"]; nT = res["nT"]
        lat, filas = [], []
        for k, (nid, comp) in enumerate(res["pivotes"]):
            c = s["clave"].get(nid)
            if comp != 0 or c is None:
                continue
            x, y, _ = xyz[nid]; dc = s["diaf"][c]
            r = np.zeros(nd)
            if eje3d == "x":
                r[col[c]] = 1.0; r[col[c] + 2] = -(y - dc["yc"])
            else:
                r[col[c] + 1] = 1.0; r[col[c] + 2] = (x - dc["xc"])
            lat.append(k); filas.append(r)
        if not lat:
            continue
        otros = [k for k in range(K.shape[0]) if k not in lat]
        Ktt = K[np.ix_(lat, lat)]; Kto = K[np.ix_(lat, otros)]; Koo = K[np.ix_(otros, otros)]
        X = np.linalg.solve(Koo, Kto.T) if otros else np.zeros((0, len(lat)))
        KL = Ktt - Kto @ X                                 # rigidez lateral condensada
        r = np.array(filas)
        Ked += r.T @ KL @ r
        porticos.append({"nombre": nombre, "eje": eje3d, "valor": valor, "res": res, "lat": lat, "otros": otros,
                         "X": X, "KL": KL, "r": r,
                         "z": [xyz[res["pivotes"][k][0]][2] for k in lat]})

    out = {"metodo": "pseudo-tridimensional: [K] de cada pórtico con [A], [KL] por condensación, [K]ed = Σ[r]ᵀ[KL][r]",
           "diafragmas": [{"z": c[0], "bloque": c[1] + 1, **{k: float(v) for k, v in s["diaf"][c].items()}} for c in claves],
           "sismo": s["sismo"], "bloques": s["bloques"], "n_porticos": len(porticos), "direcciones": {}}
    for dname, F in s["fuerzas"].items():
        Fv = np.zeros(nd)
        for c, f in F.items():
            if c in col:
                Fv[col[c]: col[c] + 3] = f
        Ded = np.linalg.solve(Ked, Fv)
        filas_p = []
        for p in porticos:
            Dt = p["r"] @ Ded
            Fl = p["KL"] @ Dt                              # fuerza lateral que toma el pórtico
            res = p["res"]
            D = np.zeros(len(res["labels"]))
            D[p["lat"]] = Dt
            if p["otros"]:
                D[p["otros"]] = -p["X"] @ Dt
            barras = []
            for b in res["barras"]:
                q = b["K"] @ (b["A"] @ D)
                barras.append({"elem": b["elem"], "tipo": b["tipo"], "q": [float(v) for v in q]})
            # deriva por piso en la línea del pórtico
            por_z = {}
            for z, u in zip(p["z"], Dt):
                por_z.setdefault(round(z, 6), []).append(float(u))
            zs = sorted(por_z)
            u_z = [float(np.mean(por_z[z])) for z in zs]
            der = [(u_z[k] - (u_z[k - 1] if k else 0.0)) / (zs[k] - (zs[k - 1] if k else 0.0)) for k in range(len(zs))]
            filas_p.append({"nombre": p["nombre"], "eje": p["eje"], "V": float(abs(Fl.sum()) if (p["eje"] == "x") == (dname == "X") else Fl.sum()),
                            "F": [float(v) for v in Fl], "z": zs, "u": u_z, "deriva_elastica": der, "barras": barras})
        Vtot = float(sum(f[0 if dname == "X" else 1] for f in F.values()))
        Vpor = float(sum(fp["V"] for fp in filas_p if fp["eje"] == ("x" if dname == "X" else "y")))
        R = float((s["sismo"].get(dname) or {}).get("R", 6.0))
        der_max = max((abs(v) for fp in filas_p for v in fp["deriva_elastica"]), default=0.0)
        out["direcciones"][dname] = {
            "V_aplicado": Vtot, "V_porticos": Vpor,
            "D_diafragma": [{"z": c[0], "bloque": c[1] + 1, "Dx": float(Ded[col[c]]), "Dy": float(Ded[col[c] + 1]), "giro": float(Ded[col[c] + 2])} for c in claves],
            "deriva_max_elastica": der_max, "deriva_max_inelastica": 0.75 * R * der_max, "limite": 0.007,
            "porticos": filas_p}
    out["K_edificio_orden"] = nd
    out["segundos"] = round(time.time() - t0, 2)
    return out
