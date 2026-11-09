# -*- coding: utf-8 -*-
"""
Resultados de la torre de Arequipa: resuelve los 24 pórticos con la combinación
1.4·CM + 1.7·CV, verifica el equilibrio y valida el método sistematizado contra el
motor directo. Genera un resumen por pórtico y un detalle por elemento (CSV).
Ejecutar desde analisis_estructural_web/:  python -m core.torre_resultados
"""
import copy, csv, os
import numpy as np
from core.torre_arequipa import portico, todos_los_pórticos, COMBO
from core.constructor import construir
from core.metodo_matricial_A import resolver_sistematizado

H_PISO = 3.0
LIMITE_DERIVA = 0.007   # E.030 concreto armado


def carga_combinada(d):
    """Convierte los casos CM/CV en cargas de elementos de la combinación."""
    fac = COMBO["factores"]
    casos = {c["nombre"]: {x["elem"]: x for x in c["cargas_elementos"]} for c in d["casos"]}
    ce = []
    for eid in casos["CM"]:
        w = sum(fac[n] * casos[n][eid]["wy"] for n in fac)
        ce.append({"elem": eid, "tipo": "distribuida", "subtipo": "uniforme",
                   "wy": w, "wx": 0.0})
    d2 = copy.deepcopy(d)
    d2.pop("casos"); d2.pop("combinaciones")
    d2["cargas_elementos"] = ce
    return d2


def resolver_pórtico(nombre, tipo, idx):
    d = carga_combinada(portico(tipo, idx))
    est = construir(d); est.resolver()
    eq = est.verificar_equilibrio()
    residuo = max(abs(eq["residuo_Fx"]), abs(eq["residuo_Fy"]), abs(eq["residuo_M"]))
    # diagnóstico con el método sistematizado (mismos datos)
    sis = resolver_sistematizado(est)
    dif = 0.0; ref = 1e-12
    for b, e in zip(sis["barras"], est.elementos):
        f = est.fuerzas_elem[e.id]
        dif = max(dif, abs(b["qT"][0] + f[2]), abs(b["qT"][1] + f[5]))
        ref = max(ref, abs(f[2]), abs(f[5]))
    # esfuerzos internos por elemento
    filas_el = []
    Mmax = Vmax = Nmax = 0.0
    for e in est.elementos:
        xs, N, V, M = est.fuerzas_internas(e, 21)
        im, iv, inn = np.argmax(np.abs(M)), np.argmax(np.abs(V)), np.argmax(np.abs(N))
        Mmax = max(Mmax, abs(M[im])); Vmax = max(Vmax, abs(V[iv])); Nmax = max(Nmax, abs(N[inn]))
        filas_el.append({"pórtico": nombre, "elemento": e.nombre,
                         "tipo": "columna" if abs(e.cos) < 1e-9 else "viga",
                         "L_m": round(e.L, 3), "seccion": (e.sec.nombre if not e.segmentos else "tramos"),
                         "Mmax": round(abs(M[im]), 4), "Vmax": round(abs(V[iv]), 4),
                         "Nmax": round(abs(N[inn]), 4)})
    # derivas por piso: desplazamiento lateral medio de los nudos de cada nivel
    niveles = {}
    for nd in est.nudos:
        ux = float(est.D[nd.gdl[0]]) if nd.restriccion[0] == 0 else 0.0
        niveles.setdefault(round(nd.y, 6), []).append(ux)
    derivas = []
    ys = sorted(niveles)
    for a, b in zip(ys[:-1], ys[1:]):
        du = abs(np.mean(niveles[b]) - np.mean(niveles[a]))
        derivas.append(du / (b - a))
    # reacciones en la base
    resumen = {"pórtico": nombre, "nudos": len(est.nudos), "elementos": len(est.elementos),
               "GDL": est.n_gdl, "residuo_equilibrio": residuo,
               "Mmax_tonf_m": round(Mmax, 3), "Vmax_tonf": round(Vmax, 3),
               "Nmax_tonf": round(Nmax, 3),
               "deriva_max": round(max(derivas) if derivas else 0.0, 6),
               "deriva_max_limite": LIMITE_DERIVA,
               "cumple_deriva": (max(derivas) if derivas else 0.0) <= LIMITE_DERIVA,
               "dif_sistematizado_rel": dif / ref}
    return resumen, filas_el


def generar(carpeta_salida):
    os.makedirs(carpeta_salida, exist_ok=True)
    resumenes, detalle = [], []
    for nombre, tipo, idx in todos_los_pórticos():
        r, f = resolver_pórtico(nombre, tipo, idx)
        resumenes.append(r); detalle += f
    with open(os.path.join(carpeta_salida, "torre_resumen_por_porticos.csv"), "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(resumenes[0].keys())); w.writeheader(); w.writerows(resumenes)
    with open(os.path.join(carpeta_salida, "torre_detalle_elementos.csv"), "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(detalle[0].keys())); w.writeheader(); w.writerows(detalle)
    return resumenes, detalle


if __name__ == "__main__":
    import sys
    salida = sys.argv[1] if len(sys.argv) > 1 else "resultados_torre"
    rs, det = generar(salida)
    print("pórticos:", len(rs), " elementos detallados:", len(det))
    print("max residuo equilibrio: %.2e" % max(r["residuo_equilibrio"] for r in rs))
    print("max dif. sistematizado (relativa): %.2e" % max(r["dif_sistematizado_rel"] for r in rs))
    print("max Mmax: %.2f tonf·m   max Vmax: %.2f tonf   max deriva: %.5f (límite %.3f)" % (
        max(r["Mmax_tonf_m"] for r in rs), max(r["Vmax_tonf"] for r in rs),
        max(r["deriva_max"] for r in rs), LIMITE_DERIVA))
    print("pórticos que incumplen deriva:", [r["pórtico"] for r in rs if not r["cumple_deriva"]])
