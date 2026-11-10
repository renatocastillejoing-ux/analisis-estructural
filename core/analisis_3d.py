# -*- coding: utf-8 -*-
"""
================================================================================
  ANÁLISIS 3D — pórtico espacial por el método de rigidez (6 GDL por nudo)
================================================================================
  Elemento de pórtico espacial de 12×12 (Euler–Bernoulli, con deformación axial
  y torsión de Saint-Venant). Ejes locales: x a lo largo de la barra, y en la
  dirección `wdir` (lado `w` de la sección), z = x × y (lado `d`).
      Iz = d·w³/12 (flexión con desplazamiento en y),  Iy = w·d³/12,
      J  = a·b³·(1/3 − 0.21·(b/a)·(1 − b⁴/12a⁴))  con a ≥ b.
  Extremos rígidos (brazos) de longitud bi, bj: la parte flexible mide
  L' = L − bi − bj y se une a los nudos por transformación de cuerpo rígido.
  Rótulas: condensación estática de los momentos liberados.
  Cargas en barras: distribuidas lineales (uniforme / trapezoidal) y puntuales,
  con cargas nodales equivalentes exactas (cuadratura de Gauss de 3 puntos).
  Diafragma rígido opcional por nivel: los nudos del piso comparten (Ux, Uy, Rz)
  de un nudo maestro en el centro de masas; cada nudo conserva (uz, rx, ry).
  Matrices dispersas (scipy.sparse) y factorización LU una sola vez para todos
  los casos de carga.
================================================================================
"""
import math
import time

import numpy as np
import scipy.linalg as sla
import scipy.sparse as sp
import scipy.sparse.linalg as spla

TOL = 1e-6
_GX = np.array([0.5 - math.sqrt(15) / 10, 0.5, 0.5 + math.sqrt(15) / 10])     # Gauss en [0, 1]
_GW = np.array([5 / 18, 8 / 18, 5 / 18])


# ----------------------------------------------------------------------------
#  Elemento
# ----------------------------------------------------------------------------
def props_rect(w, d):
    """A, Iy, Iz, J de una sección rectangular w (en y local) × d (en z local)."""
    A = w * d
    Iz = d * w ** 3 / 12.0
    Iy = w * d ** 3 / 12.0
    a, b = max(w, d), min(w, d)
    J = a * b ** 3 * (1.0 / 3.0 - 0.21 * (b / a) * (1.0 - b ** 4 / (12.0 * a ** 4)))
    return A, Iy, Iz, J


def k_local(E, G, A, Iy, Iz, J, L):
    k = np.zeros((12, 12))
    EA, GJ = E * A / L, G * J / L
    z1, z2, z3, z4 = 12 * E * Iz / L ** 3, 6 * E * Iz / L ** 2, 4 * E * Iz / L, 2 * E * Iz / L
    y1, y2, y3, y4 = 12 * E * Iy / L ** 3, 6 * E * Iy / L ** 2, 4 * E * Iy / L, 2 * E * Iy / L
    k[0, 0] = k[6, 6] = EA; k[0, 6] = -EA
    k[3, 3] = k[9, 9] = GJ; k[3, 9] = -GJ
    # flexión en el plano x-y (v, θz)
    k[1, 1] = k[7, 7] = z1; k[1, 7] = -z1
    k[1, 5] = k[1, 11] = z2; k[5, 7] = k[7, 11] = -z2
    k[5, 5] = k[11, 11] = z3; k[5, 11] = z4
    # flexión en el plano x-z (w, θy)
    k[2, 2] = k[8, 8] = y1; k[2, 8] = -y1
    k[2, 4] = k[2, 10] = -y2; k[4, 8] = k[8, 10] = y2
    k[4, 4] = k[10, 10] = y3; k[4, 10] = y4
    return k + np.triu(k, 1).T


def matriz_rotacion(pi, pj, wdir):
    ex = np.asarray(pj, float) - np.asarray(pi, float)
    L = float(np.linalg.norm(ex)); ex /= L
    ey = np.asarray(wdir, float)
    ey = ey - ey.dot(ex) * ex
    if np.linalg.norm(ey) < 1e-9:                       # wdir paralelo a la barra
        ey = np.array([1.0, 0, 0]) if abs(ex[0]) < 0.9 else np.array([0, 1.0, 0])
        ey = ey - ey.dot(ex) * ex
    ey /= np.linalg.norm(ey)
    ez = np.cross(ex, ey)
    return np.vstack([ex, ey, ez]), L


def _N(xi, L):
    """Funciones de forma (12 × 3): carga local (qx, qy, qz) en el punto ξ → GDL de extremo."""
    H1, H2, H3, H4 = 1 - 3 * xi ** 2 + 2 * xi ** 3, xi - 2 * xi ** 2 + xi ** 3, 3 * xi ** 2 - 2 * xi ** 3, -xi ** 2 + xi ** 3
    N = np.zeros((12, 3))
    N[0, 0], N[6, 0] = 1 - xi, xi
    N[1, 1], N[5, 1], N[7, 1], N[11, 1] = H1, L * H2, H3, L * H4
    N[2, 2], N[4, 2], N[8, 2], N[10, 2] = H1, -L * H2, H3, -L * H4
    return N


def feq_uniforme(q_loc, L):
    """Cargas nodales equivalentes (locales) de una carga uniforme q_loc = (qx, qy, qz)."""
    return feq_general({"q1": np.asarray(q_loc, float), "q2": np.asarray(q_loc, float), "P": []}, L)


def feq_general(c, L):
    """Cargas nodales equivalentes exactas de una carga local lineal q1→q2 y puntuales."""
    f = np.zeros(12)
    q1, q2 = c["q1"], c["q2"]
    if np.any(q1) or np.any(q2):
        for x, w in zip(_GX, _GW):
            f += w * L * (_N(x, L) @ (q1 + (q2 - q1) * x))
    for P, a in c.get("P", []):
        f += _N(min(max(a / L, 0.0), 1.0), L) @ P
    return f


def _como_carga(q):
    if isinstance(q, dict):
        return q
    q = np.asarray(q, float)
    return {"q1": q, "q2": q, "P": []}


def internas(f, q, L, n=9):
    """Esfuerzos a lo largo de la parte flexible a partir de las acciones de extremo f
    (locales, sobre la barra) y su carga local (uniforme, lineal y puntuales). N (+ tracción)."""
    c = _como_carga(q)
    q1, q2 = c["q1"], c["q2"]
    s = np.linspace(0, L, n)
    extra = []
    for _, a in c.get("P", []):
        if 0 < a < L: extra += [max(a - 1e-9, 0), min(a + 1e-9, L)]
    if extra:
        s = np.unique(np.concatenate([s, extra]))
    dq = (q2 - q1) / L if L > 0 else q2 * 0
    R = np.outer(s, q1) + np.outer(s ** 2 / 2, dq)               # resultante de la distribuida en [0, s]
    Mq = np.outer(s ** 2 / 2, q1) + np.outer(s ** 3 / 6, dq)     # su momento respecto de s
    N = -f[0] - R[:, 0]
    Vy = f[1] + R[:, 1]
    Vz = f[2] + R[:, 2]
    Mz = -f[5] + f[1] * s + Mq[:, 1]
    My = -f[4] - f[2] * s - Mq[:, 2]
    for P, a in c.get("P", []):
        on = s > a
        N = N - np.where(on, P[0], 0); Vy = Vy + np.where(on, P[1], 0); Vz = Vz + np.where(on, P[2], 0)
        Mz = Mz + np.where(on, P[1] * (s - a), 0); My = My - np.where(on, P[2] * (s - a), 0)
    return s, N, Vy, Vz, Mz, My


def _skew(r):
    return np.array([[0, -r[2], r[1]], [r[2], 0, -r[0]], [-r[1], r[0], 0]])


def _condensar(k, f, rel):
    """Rótulas: elimina los GDL locales liberados por condensación estática."""
    if not rel:
        return k, f
    r = list(rel); c = [i for i in range(12) if i not in r]
    krr = k[np.ix_(r, r)]
    try:
        inv = np.linalg.inv(krr)
    except np.linalg.LinAlgError:
        inv = np.linalg.pinv(krr)
    kc = np.zeros_like(k); fc = np.zeros_like(f)
    kc[np.ix_(c, c)] = k[np.ix_(c, c)] - k[np.ix_(c, r)] @ inv @ k[np.ix_(r, c)]
    fc[c] = f[c] - k[np.ix_(c, r)] @ inv @ f[r]
    return kc, fc


def combinar_cargas(lista):
    """Combina linealmente cargas locales [(factor, carga)] (para combinaciones)."""
    q1 = np.zeros(3); q2 = np.zeros(3); P = []
    for fac, c in lista:
        q1 = q1 + fac * c["q1"]; q2 = q2 + fac * c["q2"]
        P += [(fac * p, a) for p, a in c.get("P", [])]
    return {"q1": q1, "q2": q2, "P": P}


_CERO = {"q1": np.zeros(3), "q2": np.zeros(3), "P": []}


# ----------------------------------------------------------------------------
#  Solver general
# ----------------------------------------------------------------------------
def resolver(modelo, casos, diafragmas=None):
    """
    modelo = {
      "nudos":  [[x, y, z], ...],
      "restr":  [[1,1,1,1,1,1] o None por nudo],
      "elementos": [{"i","j","E","G","w","d","wdir", "bi"?, "bj"?, "rel"?: [GDL locales liberados]}],
    }
    casos = {nombre: {"barras": {idx_elem: (qx,qy,qz) global uniforme | [cargas]}, "nudos": {idx: [Fx,Fy,Fz,Mx,My,Mz]},
                      "maestros": {nivel: [Fx, Fy, Mz]}}}
      cargas en barra (globales, medidas desde el nudo i sobre la longitud total):
        {"q1": [..], "q2": [..]}  distribuida lineal (uniforme si q1 = q2)
        {"P": [..], "a": distancia}  puntual
    diafragmas = {nivel: {"nudos": [idx...], "xc": , "yc": }} o None.
    """
    t0 = time.time()
    X = np.asarray(modelo["nudos"], float)
    nn = len(X)
    restr = modelo.get("restr") or [None] * nn
    nd = 6 * nn

    # ---- ensamblaje disperso ----
    filas, cols, vals = [], [], []
    datos_el = []
    for el in modelo["elementos"]:
        i, j = el["i"], el["j"]
        R, L = matriz_rotacion(X[i], X[j], el["wdir"])
        bi, bj = float(el.get("bi", 0) or 0), float(el.get("bj", 0) or 0)
        if bi + bj > 0.9 * L:                       # brazos demasiado largos: se recortan
            f = 0.9 * L / (bi + bj); bi *= f; bj *= f
        Lf = L - bi - bj
        A, Iy, Iz, J = props_rect(el["w"], el["d"])
        kl = k_local(el["E"], el["G"], A, Iy, Iz, J, Lf)
        rel = list(el.get("rel") or [])
        kc, _ = _condensar(kl, np.zeros(12), rel)
        T = np.kron(np.eye(4), R)
        B = np.eye(12)
        if bi or bj:
            ex = R[0]
            B[0:3, 3:6] = -_skew(bi * ex)
            B[6:9, 9:12] = -_skew(-bj * ex)
        TB = T @ B
        kg = TB.T @ kc @ TB
        g = np.r_[6 * i:6 * i + 6, 6 * j:6 * j + 6]
        filas.append(np.repeat(g, 12)); cols.append(np.tile(g, 12)); vals.append(kg.ravel())
        datos_el.append({"R": R, "L": L, "Lf": Lf, "bi": bi, "bj": bj, "TB": TB, "kl": kl, "kc": kc, "rel": rel, "g": g})
    K = sp.csr_matrix((np.concatenate(vals), (np.concatenate(filas), np.concatenate(cols))), shape=(nd, nd))

    # ---- GDL libres y transformación por diafragma ----
    fijo = np.zeros(nd, bool)
    for n, r in enumerate(restr):
        if r:
            for k in range(6):
                if r[k]: fijo[6 * n + k] = True
    libres = np.flatnonzero(~fijo)
    pos = -np.ones(nd, int); pos[libres] = np.arange(len(libres))

    niveles = sorted((diafragmas or {}).keys())
    maestro_de = {}
    for lv in niveles:
        for n in diafragmas[lv]["nudos"]:
            maestro_de[n] = lv
    n_m = 3 * len(niveles)
    rT, cT, vT = [], [], []
    col = n_m
    for n in range(nn):
        for k in range(6):
            gdl = 6 * n + k
            if fijo[gdl]: continue
            r = pos[gdl]
            lv = maestro_de.get(n)
            if lv is not None and k in (0, 1, 5):
                m0 = 3 * niveles.index(lv)
                xc, yc = diafragmas[lv]["xc"], diafragmas[lv]["yc"]
                if k == 0: rT += [r, r]; cT += [m0, m0 + 2]; vT += [1.0, -(X[n, 1] - yc)]
                elif k == 1: rT += [r, r]; cT += [m0 + 1, m0 + 2]; vT += [1.0, X[n, 0] - xc]
                else: rT.append(r); cT.append(m0 + 2); vT.append(1.0)
            else:
                rT.append(r); cT.append(col); vT.append(1.0); col += 1
    n_red = col
    Tm = sp.csr_matrix((vT, (rT, cT)), shape=(len(libres), n_red))

    Kff = K[libres][:, libres]
    Kred = (Tm.T @ Kff @ Tm).tocsc()

    # ---- cargas ----
    nombres = list(casos)
    F = np.zeros((nd, len(nombres)))
    Fred_extra = np.zeros((n_red, len(nombres)))
    cargas_loc = {}
    for c, nom in enumerate(nombres):
        caso = casos[nom]
        for e, spec in (caso.get("barras") or {}).items():
            d = datos_el[e]
            items = spec if isinstance(spec, list) else [{"q1": spec, "q2": spec}]
            loc, fn = _cargas_elemento(d, items, X[modelo["elementos"][e]["i"]])
            fe = feq_general(loc, d["Lf"])
            _, fe = _condensar(d["kl"], fe, d["rel"])
            cargas_loc[(c, e)] = (loc, fe)
            F[d["g"], c] += d["TB"].T @ fe + fn
        for n, v in (caso.get("nudos") or {}).items():
            F[6 * n:6 * n + 6, c] += np.asarray(v, float)
        for lv, v in (caso.get("maestros") or {}).items():
            m0 = 3 * niveles.index(lv)
            Fred_extra[m0:m0 + 3, c] += np.asarray(v, float)
    Fred = Tm.T @ F[libres] + Fred_extra

    t1 = time.time()
    lu = spla.splu(Kred)
    Ured = lu.solve(Fred) if len(nombres) else np.zeros((n_red, 0))
    t2 = time.time()
    U = np.zeros((nd, len(nombres)))
    U[libres] = Tm @ Ured

    # ---- reacciones y acciones de extremo ----
    Rtot = (K @ U) - F
    reac = {nom: Rtot[:, c] for c, nom in enumerate(nombres)}
    fext = {}
    for c, nom in enumerate(nombres):
        arr = np.zeros((len(datos_el), 12)); cl = []
        for e, d in enumerate(datos_el):
            f = d["kc"] @ (d["TB"] @ U[d["g"], c])
            if (c, e) in cargas_loc:
                loc, fe = cargas_loc[(c, e)]
                f -= fe; cl.append(loc)
            else:
                cl.append(_CERO)
            arr[e] = f
        fext[nom] = (arr, cl)

    return {
        "U": U, "nombres": nombres, "reacciones": reac, "fijo": fijo, "fext": fext,
        "longitudes": np.array([d["L"] for d in datos_el]), "flexibles": np.array([d["Lf"] for d in datos_el]),
        "brazos": [(d["bi"], d["bj"]) for d in datos_el], "F": F,
        "rotaciones": [d["R"] for d in datos_el], "datos_el": datos_el,
        "Kred": Kred, "Tm": Tm, "libres": libres, "n_maestros": n_m, "niveles": niveles,
        "n_gdl": nd, "n_libres": len(libres), "n_red": n_red,
        "t_ensamble": t1 - t0, "t_solucion": t2 - t1,
    }


def _cargas_elemento(d, items, Xi):
    """Reparte las cargas globales de una barra entre la parte flexible (carga local) y los
    brazos rígidos (fuerza y momento directos al nudo). Devuelve (carga local, F nodal 12)."""
    R, L, Lf, bi, bj = d["R"], d["L"], d["Lf"], d["bi"], d["bj"]
    ex = R[0]
    q1g = np.zeros(3); q2g = np.zeros(3)
    P_loc, fn = [], np.zeros(12)
    for it in items:
        if "P" in it and it.get("P") is not None and "a" in it:
            P = np.asarray(it["P"], float); a = float(it.get("a") if it.get("a") is not None else L / 2)
            if a <= bi:
                fn[0:3] += P; fn[3:6] += np.cross(a * ex, P)
            elif a >= L - bj:
                fn[6:9] += P; fn[9:12] += np.cross((a - L) * ex, P)
            else:
                P_loc.append((R @ P, a - bi))
        else:
            q1g = q1g + np.asarray(it.get("q1", [0, 0, 0]), float)
            q2g = q2g + np.asarray(it.get("q2", it.get("q1", [0, 0, 0])), float)
    qat = lambda s: q1g + (q2g - q1g) * (s / L)
    # brazos rígidos: resultante y momento al nudo correspondiente
    for s0, s1, base, o in ((0.0, bi, 0, 0.0), (L - bj, L, 6, L)):
        if s1 - s0 <= 1e-12 or not (np.any(q1g) or np.any(q2g)):
            continue
        for x, w in zip(_GX, _GW):
            s = s0 + (s1 - s0) * x; q = qat(s) * w * (s1 - s0)
            fn[base:base + 3] += q; fn[base + 3:base + 6] += np.cross((s - o) * ex, q)
    loc = {"q1": R @ qat(bi), "q2": R @ qat(L - bj), "P": P_loc}
    return loc, fn


def fuerzas_extremo(res, Ucol):
    """Acciones de extremo locales (sin cargas de tramo) para un vector de desplazamientos."""
    arr = np.zeros((len(res["datos_el"]), 12))
    for e, d in enumerate(res["datos_el"]):
        arr[e] = d["kc"] @ (d["TB"] @ Ucol[d["g"]])
    return arr


def resumen_barras(fext_arr, q_arr, L):
    """Por barra: N en i y j (+ tracción), |V| máx, |Mz| máx, |My| máx y |T|."""
    out = np.zeros((len(L), 8))
    for e in range(len(L)):
        s, N, Vy, Vz, Mz, My = internas(fext_arr[e], q_arr[e], L[e])
        out[e] = [N[0], N[-1], max(np.abs(Vy).max(), np.abs(Vz).max()),
                  np.abs(Mz).max(), np.abs(My).max(), abs(fext_arr[e][3]),
                  max(Mz.max(), 0.0), max(-Mz.min(), 0.0)]          # Mz+ (tracción abajo en vigas) y Mz−
    return out


def modal_condensado(Kred, n_m, masas, con_formas=False):
    """Modos con los GDL maestros (Ux, Uy, Rz por piso) por condensación estática.
    masas: lista por nivel de (m, J)."""
    Kll = Kred[:n_m, :n_m].toarray()
    Klo = Kred[:n_m, n_m:]
    Koo = Kred[n_m:, n_m:].tocsc()
    luo = spla.splu(Koo)
    X = luo.solve(Klo.T.toarray())
    Kc = Kll - Klo @ X
    Kc = (Kc + Kc.T) / 2
    M = np.zeros((n_m, n_m))
    for k, (m, J) in enumerate(masas):
        M[3 * k, 3 * k] = M[3 * k + 1, 3 * k + 1] = m
        M[3 * k + 2, 3 * k + 2] = J
    w2, phi = sla.eigh(Kc, M)
    w = np.sqrt(np.maximum(w2, 0))
    mt = sum(m for m, _ in masas); Jt = sum(J for _, J in masas)
    rx = np.zeros(n_m); rx[0::3] = 1
    ry = np.zeros(n_m); ry[1::3] = 1
    rz = np.zeros(n_m); rz[2::3] = 1
    modos = []
    for k in range(n_m):
        f = phi[:, k]
        mg = f @ M @ f
        part, gam = [], []
        for r, tot in ((rx, mt), (ry, mt), (rz, Jt)):
            G = (f @ M @ r) / mg
            gam.append(G); part.append(G ** 2 * mg / tot)
        modos.append({"modo": k + 1, "T": 2 * math.pi / w[k] if w[k] > 0 else None, "w": float(w[k]),
                      "f": w[k] / (2 * math.pi), "Mx": part[0], "My": part[1], "Rz": part[2],
                      "Gx": gam[0], "Gy": gam[1], "mg": mg, "forma": f.tolist()})
    if con_formas:
        return modos, {"X": X, "M": M}
    return modos


def _cqc(R, w, zeta=0.05):
    """Combinación cuadrática completa de respuestas modales R (n_modos × ...)."""
    R = np.asarray(R, float)
    n = len(w)
    rho = np.ones((n, n))
    for i in range(n):
        for j in range(n):
            if i != j and w[i] > 0 and w[j] > 0:
                r = w[j] / w[i]
                rho[i, j] = 8 * zeta ** 2 * (1 + r) * r ** 1.5 / ((1 - r ** 2) ** 2 + 4 * zeta ** 2 * r * (1 + r) ** 2)
    sh = R.shape[1:]
    Rf = R.reshape(n, -1)
    return np.sqrt(np.maximum(np.einsum("ik,ij,jk->k", Rf, rho, Rf), 0)).reshape(sh)


# ----------------------------------------------------------------------------
#  Modelo 3D general (formato del editor 3D)
# ----------------------------------------------------------------------------
#  modelo3d = {
#    "tipo": "3d", "nombre", "unidad_fuerza": "tonf", "unidad_longitud": "m",
#    "ejes": {"x": [{"nombre","c"}], "y": [...]}, "niveles": [{"nombre","z"}],
#    "materiales": [{"nombre","modo":"fc"|"E","fc","E","densidad","nu"}], "material": por defecto,
#    "secciones": [{"nombre","b","h"}]      b = ancho (X en columnas sin giro), h = peralte / lado en Y,
#    "nudos": [{"id","nombre","x","y","z","apoyo": libre|empotrado|articulado}],
#    "elementos": [{"id","nombre","i","j","seccion","material"?, "giro": 0|90,
#                   "release_i"?, "release_j"?, "segmentos"?: [{"L","seccion","material"?}]}],
#    "casos": [{"nombre"}],
#    "cargas_area": [{"z","caso","q"}],
#    "cargas_barras": [{"elem","caso","tipo": uniforme|trapezoidal|puntual,
#                       "wz" | "wz1","wz2" | "Pz","a"  (también wx, wy, Px, Py)}],
#    "cargas_nudos": [{"nudo","caso","F":[Fx,Fy,Fz,Mx,My,Mz]}],
#    "peso_propio": bool, "caso_peso_propio": "CM", "diafragma": bool,
#    "brazos_rigidos": {"modo": "placas"|"todos"|"ninguno", "factor": 1.0},
#    "sismo": {"activo","Z","U","S","R"|"sistema":"auto","TP","TL","CT","periodo":"norma"|"modal",
#              "dinamico": bool, "caso_masa":{"CM":1,"CV":0.25}, "limite_deriva"},
#    "combinaciones": [{"nombre","factores":{caso: f}}],
#  }


def _E_G(mat):
    if (mat.get("modo") or "fc") == "fc":
        E = 15000 * math.sqrt(float(mat.get("fc", 210))) * 10.0          # tonf/m²
    else:
        E = float(mat.get("E", 2.1e6))
    nu = float(mat.get("nu", 0.2) or 0.2)
    return E, E / (2 * (1 + nu))


def _orientacion(pi, pj, sec, giro):
    """(wdir, w, d) del elemento: columnas con b en X (o en Y si giro=90);
    vigas y diagonales con el peralte h en vertical."""
    dx, dy = pj[0] - pi[0], pj[1] - pi[1]
    b, h = float(sec.get("b", 0.3)), float(sec.get("h", 0.3))
    if abs(dx) < TOL and abs(dy) < TOL:                                # vertical
        return ([0, 1, 0] if int(giro or 0) % 180 == 90 else [1, 0, 0]), b, h
    return [0, 0, 1], h, b


def es_placa(w, d):
    return max(w, d) >= 4 * min(w, d)


def paños_nivel(nudos_nivel, existe_barra):
    """Paños rectangulares de un nivel: celdas entre coordenadas consecutivas cuyas
    4 aristas son barras. nudos_nivel: {(x, y): idx}. Devuelve [(x0,x1,y0,y1, [idx esquinas])]."""
    xs = sorted({round(x, 6) for x, _ in nudos_nivel})
    ys = sorted({round(y, 6) for _, y in nudos_nivel})
    out = []
    for a in range(len(xs) - 1):
        for b in range(len(ys) - 1):
            x0, x1, y0, y1 = xs[a], xs[a + 1], ys[b], ys[b + 1]
            c = [nudos_nivel.get((x0, y0)), nudos_nivel.get((x1, y0)), nudos_nivel.get((x1, y1)), nudos_nivel.get((x0, y1))]
            if None in c: continue
            bordes = [(c[0], c[1]), (c[3], c[2]), (c[0], c[3]), (c[1], c[2])]   # 2 en X, 2 en Y
            if all(existe_barra(p, q) for p, q in bordes):
                out.append((x0, x1, y0, y1, bordes))
    return out


def _cargas_barra_items(c, L):
    """Carga de barra del editor → ítems globales (desde el nudo i, longitud total)."""
    t = c.get("tipo") or "uniforme"
    if t == "puntual":
        a = c.get("a"); a = L / 2 if a in (None, "") else float(a)
        return [{"P": [float(c.get("Px", 0) or 0), float(c.get("Py", 0) or 0), float(c.get("Pz", 0) or 0)], "a": a}]
    if t == "trapezoidal":
        return [{"q1": [float(c.get("wx1", 0) or 0), float(c.get("wy1", 0) or 0), float(c.get("wz1", 0) or 0)],
                 "q2": [float(c.get("wx2", 0) or 0), float(c.get("wy2", 0) or 0), float(c.get("wz2", 0) or 0)]}]
    q = [float(c.get("wx", 0) or 0), float(c.get("wy", 0) or 0), float(c.get("wz", 0) or 0)]
    return [{"q1": q, "q2": q}]


def preparar_modelo3d(m):
    """Geometría, rigideces y cargas por caso (sobre las barras originales) del modelo del editor."""
    nudos = m["nudos"]
    idx = {n["id"]: k for k, n in enumerate(nudos)}
    X = [[float(n["x"]), float(n["y"]), float(n["z"])] for n in nudos]
    APOYO = {"empotrado": [1] * 6, "articulado": [1, 1, 1, 0, 0, 0], "fijo": [1, 1, 1, 0, 0, 0]}
    restr = [APOYO.get(n.get("apoyo") or "libre") for n in nudos]
    secs = {s["nombre"]: s for s in m["secciones"]}
    mats = {x["nombre"]: x for x in m.get("materiales") or []}
    mat_def = mats.get(m.get("material")) or next(iter(mats.values()), {"modo": "fc", "fc": 210, "densidad": 2.4})
    casos_n = [c["nombre"] for c in (m.get("casos") or [{"nombre": "CM"}, {"nombre": "CV"}])]
    caso_pp = m.get("caso_peso_propio") or casos_n[0]

    elementos, info, barra_de = [], [], {}
    for k, e in enumerate(m["elementos"]):
        i, j = idx[e["i"]], idx[e["j"]]
        sec = secs[e["seccion"]]
        mat = mats.get(e.get("material")) or mat_def
        E, G = _E_G(mat)
        wdir, w, d = _orientacion(X[i], X[j], sec, e.get("giro", 0))
        vertical = wdir != [0, 0, 1]
        dz = abs(X[j][2] - X[i][2])
        tipo = "columna" if vertical else ("viga" if dz < TOL else "diagonal")
        if tipo == "viga":
            tipo = "viga_x" if abs(X[j][1] - X[i][1]) < TOL else ("viga_y" if abs(X[j][0] - X[i][0]) < TOL else "viga")
        if tipo == "columna" and es_placa(w, d):
            tipo = "placa"
        rel = ([4, 5] if e.get("release_i") else []) + ([10, 11] if e.get("release_j") else [])
        elementos.append({"i": i, "j": j, "E": E, "G": G, "w": w, "d": d, "wdir": wdir, "rel": rel, "giro": e.get("giro", 0)})
        info.append({"id": e["id"], "nombre": e.get("nombre") or f"E{e['id']}", "tipo": tipo, "sec": e["seccion"],
                     "densidad": float(mat.get("densidad", 2.4) or 0), "fc": float(mat.get("fc", 210) or 210),
                     "b": float(sec.get("b", 0.3)), "h": float(sec.get("h", 0.3)), "segmentos": e.get("segmentos") or e.get("tramos") or [],
                     "mat": mat})
        barra_de[(min(i, j), max(i, j))] = k
    existe = lambda p, q: (min(p, q), max(p, q)) in barra_de
    L = [float(np.linalg.norm(np.subtract(X[el["j"]], X[el["i"]]))) for el in elementos]
    id_elem = {e["id"]: k for k, e in enumerate(m["elementos"])}

    # ---- cargas por caso: barras (listas de ítems globales) y nudos ----
    cargas = {c: {"barras": {}, "nudos": {}} for c in casos_n}
    def suma(caso, e, items):
        cargas.setdefault(caso, {"barras": {}, "nudos": {}})["barras"].setdefault(e, []).extend(items)
    if m.get("peso_propio", True):
        for e, el in enumerate(elementos):
            if info[e]["densidad"] > 0:
                q = [0, 0, -info[e]["densidad"] * el["w"] * el["d"]]
                suma(caso_pp, e, [{"q1": q, "q2": q}])
    for c in m.get("cargas_barras") or []:
        e = id_elem.get(c["elem"])
        if e is not None:
            suma(c.get("caso") or casos_n[0], e, _cargas_barra_items(c, L[e]))
    niveles_z = sorted({round(p[2], 6) for p in X})
    por_nivel = {z: {(round(X[k][0], 6), round(X[k][1], 6)): k for k in range(len(X)) if abs(X[k][2] - z) < TOL} for z in niveles_z}
    paños_info = []
    for ca in m.get("cargas_area") or []:
        z = min(niveles_z, key=lambda t: abs(t - float(ca["z"])))
        q = float(ca.get("q", 0)); caso = ca.get("caso") or casos_n[0]
        for (x0, x1, y0, y1, bordes) in paños_nivel(por_nivel[z], existe):
            lx, ly = x1 - x0, y1 - y0
            a, bb = min(lx, ly), max(lx, ly)
            tri = a * a / 4.0; trap = (a * bb - 2 * tri) / 2.0
            ax = tri if lx <= ly else trap; ay = trap if lx <= ly else tri
            for n, (p, r) in enumerate(bordes):
                e = barra_de[(min(p, r), max(p, r))]
                w = -q * (ax / lx if n < 2 else ay / ly)
                suma(caso, e, [{"q1": [0, 0, w], "q2": [0, 0, w]}])
            paños_info.append({"z": z, "x0": x0, "x1": x1, "y0": y0, "y1": y1, "caso": caso, "q": q})
    for c in m.get("cargas_nudos") or []:
        caso = c.get("caso") or casos_n[0]
        cargas.setdefault(caso, {"barras": {}, "nudos": {}})
        k = idx[c["nudo"]]
        prev = cargas[caso]["nudos"].get(k, [0] * 6)
        cargas[caso]["nudos"][k] = [a + float(b) for a, b in zip(prev, (list(c.get("F", [0] * 6)) + [0] * 6)[:6])]
    return {"X": X, "restr": restr, "elementos": elementos, "info": info, "L": L, "cargas": cargas,
            "casos_n": casos_n, "niveles_z": niveles_z, "por_nivel": por_nivel, "paños": paños_info,
            "secs": secs, "mats": mats, "mat_def": mat_def, "idx": idx}


def _brazos_auto(P, cfg):
    """Zonas rígidas en los extremos: vigas que llegan a placas (o a toda columna) y,
    en modo «todos», columnas en el peralte de las vigas que llegan al nudo."""
    modo = (cfg or {}).get("modo", "placas")
    f = float((cfg or {}).get("factor", 1.0) or 0)
    X, els, info = P["X"], P["elementos"], P["info"]
    if modo == "ninguno" or f <= 0:
        return
    col_en = {}; viga_en = {}
    for k, (el, inf) in enumerate(zip(els, info)):
        destino = col_en if inf["tipo"] in ("columna", "placa") else viga_en
        destino.setdefault(el["i"], []).append(k); destino.setdefault(el["j"], []).append(k)
    for k, (el, inf) in enumerate(zip(els, info)):
        if inf["tipo"] in ("columna", "placa"):
            if modo != "todos":
                continue
            for extremo, n in (("bi", el["i"]), ("bj", el["j"])):
                h = max([els[v]["w"] for v in viga_en.get(n, [])] or [0])
                el[extremo] = max(el.get(extremo, 0), f * h / 2)
            continue
        u = np.subtract(X[el["j"]], X[el["i"]]); u[2] = 0
        nu = np.linalg.norm(u)
        if nu < TOL:
            continue
        u = u / nu
        for extremo, n in (("bi", el["i"]), ("bj", el["j"])):
            mejor = 0.0
            for c in col_en.get(n, []):
                cc, ci = els[c], info[c]
                if modo == "placas" and ci["tipo"] != "placa":
                    continue
                wd = np.asarray(cc["wdir"], float); dd = np.cross([0, 0, 1], wd)
                mejor = max(mejor, 0.5 * (abs(u @ wd) * cc["w"] + abs(u @ dd) * cc["d"]))
            if mejor:
                el[extremo] = max(el.get(extremo, 0), f * mejor)


def _subdividir(P):
    """Tramos (barra no prismática): cada tramo pasa a ser una sub-barra con nudos internos."""
    X, els, info, cargas, restr, L = P["X"], P["elementos"], P["info"], P["cargas"], P["restr"], P["L"]
    subs, origen, X2, restr2 = [], [], [list(p) for p in X], list(restr)
    for k, (el, inf) in enumerate(zip(els, info)):
        segs = [s for s in inf["segmentos"] if float(s.get("L", 0) or 0) > 0]
        if len(segs) < 2:
            subs.append(dict(el)); origen.append((k, 0.0, L[k])); continue
        tot = sum(float(s["L"]) for s in segs)
        a = np.asarray(X[el["i"]], float); b = np.asarray(X[el["j"]], float)
        s0 = 0.0; prev = el["i"]
        for t, sg in enumerate(segs):
            s1 = s0 + float(sg["L"]) / tot * L[k]
            if t < len(segs) - 1:
                X2.append((a + (b - a) * s1 / L[k]).tolist()); restr2.append(None); nxt = len(X2) - 1
            else:
                nxt = el["j"]
            sec = P["secs"].get(sg.get("seccion")) or {"b": inf["b"], "h": inf["h"]}
            mat = P["mats"].get(sg.get("material")) or inf["mat"]
            E, G = _E_G(mat)
            wdir, w, d = _orientacion(X[el["i"]], X[el["j"]], sec, el.get("giro", 0))
            sub = {**el, "i": prev, "j": nxt, "E": E, "G": G, "w": w, "d": d, "wdir": wdir,
                   "rel": ([r for r in el["rel"] if r < 6] if t == 0 else []) + ([r for r in el["rel"] if r >= 6] if t == len(segs) - 1 else []),
                   "bi": el.get("bi", 0) if t == 0 else 0, "bj": el.get("bj", 0) if t == len(segs) - 1 else 0}
            subs.append(sub); origen.append((k, s0, s1))
            prev = nxt; s0 = s1
    # cargas por sub-barra
    cargas2 = {}
    for caso, cc in cargas.items():
        nb = {}
        for e2, (k, s0, s1) in enumerate(origen):
            items = cc["barras"].get(k)
            if not items: continue
            if s0 == 0.0 and abs(s1 - L[k]) < 1e-12:
                nb[e2] = items; continue
            nuevos = []
            for it in items:
                if "P" in it and "a" in it:
                    a = float(it["a"] if it["a"] is not None else L[k] / 2)
                    if s0 - 1e-12 <= a < s1 or (abs(a - L[k]) < 1e-12 and abs(s1 - L[k]) < 1e-12):
                        nuevos.append({"P": it["P"], "a": a - s0})
                else:
                    q1 = np.asarray(it["q1"], float); q2 = np.asarray(it.get("q2", it["q1"]), float)
                    qa = q1 + (q2 - q1) * s0 / L[k]; qb = q1 + (q2 - q1) * s1 / L[k]
                    nuevos.append({"q1": qa.tolist(), "q2": qb.tolist()})
            if nuevos: nb[e2] = nuevos
        cargas2[caso] = {**cc, "barras": nb}
    return {"X": X2, "restr": restr2, "elementos": subs, "origen": origen, "cargas": cargas2}


def espectro_e030(T, Z, U, S, R, TP, TL):
    if T < TP: C = 2.5
    elif T < TL: C = 2.5 * TP / T
    else: C = 2.5 * TP * TL / T ** 2
    return Z * U * C * S / R * 9.81, C


def analizar_modelo3d(m):
    t0 = time.time()
    P = preparar_modelo3d(m)
    X, restr, info, L = P["X"], P["restr"], P["info"], P["L"]
    niveles_z, por_nivel, casos_n = P["niveles_z"], P["por_nivel"], P["casos_n"]
    _brazos_auto(P, m.get("brazos_rigidos") or {"modo": "placas", "factor": 1.0})
    nudos = m["nudos"]

    # ---- diafragmas por nivel (niveles con nudos libres) ----
    diaf = None
    niveles_libres = [z for z in niveles_z if any(restr[k] is None for k in por_nivel[z].values())]
    if m.get("diafragma"):
        diaf = {}
        for z in niveles_libres:
            ids = [k for k in por_nivel[z].values() if restr[k] is None]
            if len(ids) < 2: continue
            diaf[z] = {"nudos": ids, "xc": float(np.mean([X[k][0] for k in ids])), "yc": float(np.mean([X[k][1] for k in ids]))}
        diaf = diaf or None

    # ---- pesos por nivel (para sismo y modal) ----
    sis_cfg = m.get("sismo") or {}
    fac_masa = sis_cfg.get("caso_masa") or {casos_n[0]: 1.0, **({casos_n[1]: 0.25} if len(casos_n) > 1 else {})}
    P_niv = {z: 0.0 for z in niveles_libres}
    for caso, f in fac_masa.items():
        for e, items in (P["cargas"].get(caso) or {}).get("barras", {}).items():
            W = 0.0
            for it in items:
                if "P" in it and "a" in it: W += -float(it["P"][2])
                else: W += -(float(it["q1"][2]) + float(it.get("q2", it["q1"])[2])) / 2 * L[e]
            W *= f
            for k in (P["elementos"][e]["i"], P["elementos"][e]["j"]):
                z = round(X[k][2], 6)
                if z in P_niv: P_niv[z] += W / 2
        for k, F in (P["cargas"].get(caso) or {}).get("nudos", {}).items():
            z = round(X[k][2], 6)
            if z in P_niv: P_niv[z] += -F[2] * f
    niv_d = sorted(diaf) if diaf else []

    # ---- tramos → sub-barras (con nudos internos) ----
    S = _subdividir(P)
    if diaf:
        for k in range(len(X), len(S["X"])):
            z = round(S["X"][k][2], 6)
            if z in diaf: diaf[z]["nudos"].append(k)
    modelo_s = {"nudos": S["X"], "restr": S["restr"], "elementos": S["elementos"]}
    origen = S["origen"]

    # ---- sismo E.030 ----
    sismo_out = {}
    casos = {c: v for c, v in S["cargas"].items()}
    modos, T_modal = [], {}
    g = 9.81
    def plan_dims(z):
        ks = list(por_nivel[z].values()); xx = [X[k][0] for k in ks]; yy = [X[k][1] for k in ks]
        return max(xx) - min(xx), max(yy) - min(yy)
    def masas():
        out = []
        for z in niv_d:
            lx, ly = plan_dims(z); mm = P_niv[z] / g
            out.append((max(mm, 1e-9), max(mm * (lx ** 2 + ly ** 2) / 12.0, 1e-9)))
        return out
    activo = bool(sis_cfg.get("activo")) and bool(diaf)
    Zs = float(sis_cfg.get("Z", 0.35)); Us = float(sis_cfg.get("U", 1)); Ss = float(sis_cfg.get("S", 1.15))
    TP = float(sis_cfg.get("TP", 0.6)); TL = float(sis_cfg.get("TL", 2.0)); CT = float(sis_cfg.get("CT", 60))
    R0 = float(sis_cfg.get("R", 8) or 8)
    if activo:
        hn = max(niv_d) - min(niveles_z)
        T_n = hn / CT
        if sis_cfg.get("periodo") == "modal":
            r0 = resolver(modelo_s, {casos_n[0]: casos.get(casos_n[0], {})}, diaf)
            modos, aux = modal_condensado(r0["Kred"], r0["n_maestros"], masas(), con_formas=True)
            T_modal = {d: max(modos, key=lambda mm: mm[key])["T"] for d, key in (("X", "Mx"), ("Y", "My"))}
        Pw = [P_niv[z] for z in niv_d]; h = [z - min(niveles_z) for z in niv_d]
        for d in ("X", "Y"):
            T = T_modal.get(d, T_n) if sis_cfg.get("periodo") == "modal" else T_n
            _, C = espectro_e030(T, Zs, Us, Ss, R0, TP, TL)
            k = 1.0 if T <= 0.5 else min(0.75 + 0.5 * T, 2.0)
            V = Zs * Us * C * Ss / R0 * sum(Pw)
            Ft = 0.0                                                    # E.030-2018: sin fuerza en el techo
            den = sum(Pi * hi ** k for Pi, hi in zip(Pw, h)) or 1
            F = [(V - Ft) * Pi * hi ** k / den for Pi, hi in zip(Pw, h)]
            mae = {}
            for z, fi in zip(niv_d, F):
                lx, ly = plan_dims(z)
                e_acc = 0.05 * (ly if d == "X" else lx)
                mae[z] = [fi, 0, fi * e_acc] if d == "X" else [0, fi, fi * e_acc]
            casos["S" + d] = {"maestros": mae}
            sismo_out[d] = {"T": float(T), "C": float(C), "k": float(k), "V": float(V), "F": [float(f) for f in F], "R": R0,
                            "T_norma": float(T_n), "C_R": float(C / R0), "C_R_ok": bool(C / R0 >= 0.11)}

    res = resolver(modelo_s, casos, diaf)
    if diaf and not modos and any(P_niv.get(z, 0) > 0 for z in niv_d):
        modos, aux = modal_condensado(res["Kred"], res["n_maestros"], masas(), con_formas=True)

    nombres = res["nombres"]
    nn_s = len(S["X"])
    Ud = {n: res["U"][:, c] for c, n in enumerate(nombres)}
    FE = {n: res["fext"][n] for n in nombres}
    RE = dict(res["reacciones"])

    # ---- sismo dinámico (espectral, CQC) ----
    dinamico = {}
    if activo and sis_cfg.get("dinamico") and modos:
        n_m = res["n_maestros"]
        Kred = res["Kred"]
        luo = spla.splu(Kred[n_m:, n_m:].tocsc())
        Kol = Kred[n_m:, :n_m]
        w = np.array([mm["w"] for mm in modos])
        for d, gk in (("X", "Gx"), ("Y", "Gy")):
            Ures, Fres, Rres = [], [], []
            Vb = []
            for mm in modos:
                if mm["w"] <= 0: Ures.append(np.zeros(6 * nn_s)); Fres.append(np.zeros((len(S["elementos"]), 12))); Rres.append(np.zeros(6 * nn_s)); Vb.append(0); continue
                Sa, _ = espectro_e030(2 * math.pi / mm["w"], Zs, Us, Ss, R0, TP, TL)
                ul = np.asarray(mm["forma"]) * mm[gk] * Sa / mm["w"] ** 2
                uo = -luo.solve(Kol @ ul)
                ured = np.concatenate([ul, uo])
                Uf = np.zeros(6 * nn_s); Uf[res["libres"]] = res["Tm"] @ ured
                Ures.append(Uf); Fres.append(fuerzas_extremo(res, Uf))
                Vb.append(mm[gk] ** 2 * mm["mg"] * Sa)                 # cortante basal modal
            Vd = float(_cqc(np.array(Vb)[:, None], w)[0])
            Ve = sismo_out[d]["V"]
            esc = max(1.0, 0.8 * Ve / Vd) if Vd > 0 else 1.0           # E.030: ≥ 80 % del estático (regular)
            # E.030-2018 art. 4.6.4: el escalado al cortante mínimo no se aplica a los desplazamientos
            dinamico[d] = {"U": np.array(Ures), "F": np.array(Fres) * esc, "V": Vd * esc, "V_sin_escalar": Vd, "escala": esc}
            sismo_out[d].update({"V_dinamico": Vd * esc, "escala_dinamica": esc})

    # ---- combinaciones ----
    combos = m.get("combinaciones")
    if not combos:
        combos = []
        if "CM" in casos and "CV" in casos: combos.append({"nombre": "1.4CM+1.7CV", "factores": {"CM": 1.4, "CV": 1.7}})
        if activo:
            for d in ("X", "Y"):
                sx = "SD" + d if dinamico else "S" + d
                combos.append({"nombre": f"1.25(CM+CV)+{sx}", "factores": {"CM": 1.25, "CV": 1.25, sx: 1}})
                combos.append({"nombre": f"0.9CM+{sx}", "factores": {"CM": 0.9, sx: 1}})
    Ls = res["flexibles"]
    barras_s = {}
    def resumen_caso(fe, cl):
        return resumen_barras(fe, cl, Ls)
    for c in nombres:
        barras_s[c] = resumen_caso(*FE[c])
    for d, dd in dinamico.items():
        # envolvente CQC: sin cargas de tramo los esfuerzos modales son lineales en la barra,
        # así que el máximo de la CQC está en los extremos (vectorizado para todas las barras)
        Fm = dd["F"]                                              # (modos, barras, 12)
        Lfx = np.asarray(Ls)[None, :]
        Ni, Nj = -Fm[:, :, 0], Fm[:, :, 6]
        Vv = np.hypot(Fm[:, :, 1], Fm[:, :, 2])
        Mzi, Mzj = -Fm[:, :, 5], -Fm[:, :, 5] + Fm[:, :, 1] * Lfx
        Myi, Myj = -Fm[:, :, 4], -Fm[:, :, 4] - Fm[:, :, 2] * Lfx
        Tq = Fm[:, :, 3]
        env = {k: _cqc(v, w) for k, v in (("Ni", Ni), ("Nj", Nj), ("V", Vv), ("Mzi", Mzi), ("Mzj", Mzj), ("Myi", Myi), ("Myj", Myj), ("T", Tq))}
        Mz = np.maximum(env["Mzi"], env["Mzj"]); My = np.maximum(env["Myi"], env["Myj"])
        out = np.column_stack([env["Ni"], env["Nj"], env["V"], Mz, My, env["T"], Mz, Mz])
        barras_s["SD" + d] = out
        Ud["SD" + d] = _cqc(dd["U"], w)
    for cb in combos:
        fac = {k: float(v) for k, v in (cb.get("factores") or {}).items() if k in Ud}
        if not fac: continue
        lin = {k: f for k, f in fac.items() if not k.startswith("SD")}
        env = {k: f for k, f in fac.items() if k.startswith("SD")}
        fe = sum(f * FE[k][0] for k, f in lin.items()) if lin else np.zeros_like(FE[nombres[0]][0])
        cl = [combinar_cargas([(f, FE[k][1][e]) for k, f in lin.items()]) for e in range(len(Ls))]
        rb = resumen_caso(fe, cl)
        for k, f in env.items():                       # sismo espectral: se suma en valor absoluto
            sd = barras_s[k]
            rb = rb.copy()
            rb[:, 2:8] = np.abs(rb[:, 2:8]) + abs(f) * sd[:, 2:8]
            rb[:, 0] = rb[:, 0] - abs(f) * sd[:, 0]; rb[:, 1] = rb[:, 1] - abs(f) * sd[:, 1]
        barras_s[cb["nombre"]] = rb
        Ud[cb["nombre"]] = sum(f * Ud[k] for k, f in lin.items()) + sum(abs(f) * Ud[k] for k, f in env.items()) if fac else 0
        if not env:
            FE[cb["nombre"]] = (fe, cl)
            RE[cb["nombre"]] = sum(f * RE[k] for k, f in lin.items())

    # ---- resultados por barra original (los tramos se agregan) ----
    ne0 = len(info)
    nn = len(X)
    barras = {}
    for c, rb in barras_s.items():
        agg = np.zeros((ne0, 8)); vist = np.zeros(ne0, bool)
        first = {}; last = {}
        for e2, (k, s0, s1) in enumerate(origen):
            if not vist[k]: first[k] = rb[e2, 0]; vist[k] = True
            last[k] = rb[e2, 1]
            agg[k, 2:8] = np.maximum(agg[k, 2:8], rb[e2, 2:8])
        for k in range(ne0):
            agg[k, 0] = first.get(k, 0); agg[k, 1] = last.get(k, 0)
        barras[c] = {"N": np.round(np.where(np.abs(agg[:, 0]) >= np.abs(agg[:, 1]), agg[:, 0], agg[:, 1]), 3).tolist(),
                     "Ni": np.round(agg[:, 0], 3).tolist(), "Nj": np.round(agg[:, 1], 3).tolist(),
                     "V": np.round(agg[:, 2], 3).tolist(), "M": np.round(np.maximum(agg[:, 3], agg[:, 4]), 3).tolist(),
                     "Mz": np.round(agg[:, 3], 3).tolist(), "My": np.round(agg[:, 4], 3).tolist(),
                     "T": np.round(agg[:, 5], 3).tolist(),
                     "Mz_pos": np.round(agg[:, 6], 3).tolist(), "Mz_neg": np.round(agg[:, 7], 3).tolist()}
    desp = {c: np.round(np.asarray(Ud[c]).reshape(nn_s, 6)[:nn, :3], 7).tolist() for c in Ud}
    base = [k for k in range(nn) if restr[k]]
    reacciones, equilibrio = {}, {}
    for c in RE:
        Rr = RE[c].reshape(nn_s, 6)
        reacciones[c] = [{"nudo": nudos[k].get("nombre", str(nudos[k]["id"])), "R": np.round(Rr[k], 4).tolist()} for k in base]
        s = Rr[base].sum(axis=0)
        equilibrio[c] = {"Rx": float(s[0]), "Ry": float(s[1]), "Rz": float(s[2])}
    aplicado = {}
    for c in casos:
        Fz = 0.0
        for e, items in casos[c].get("barras", {}).items():
            Le = res["longitudes"][e]
            for it in items:
                if "P" in it and "a" in it: Fz += float(it["P"][2])
                else: Fz += (float(it["q1"][2]) + float(it.get("q2", it["q1"])[2])) / 2 * Le
        Fz += sum(v[2] for v in casos[c].get("nudos", {}).values())
        Fx = sum(v[0] for v in casos[c].get("nudos", {}).values()) + sum(v[0] for v in casos[c].get("maestros", {}).values())
        Fy = sum(v[1] for v in casos[c].get("nudos", {}).values()) + sum(v[1] for v in casos[c].get("maestros", {}).values())
        aplicado[c] = {"Fx": float(Fx), "Fy": float(Fy), "Fz": float(Fz)}

    # ---- derivas (estático y, si hay, dinámico CQC) ----
    derivas = {}
    if activo:
        lim = float(sis_cfg.get("limite_deriva", 0.007))
        fac_d = 0.75 * R0
        for d, comp in (("X", 0), ("Y", 1)):
            u = Ud["S" + d].reshape(nn_s, 6)[:, comp]
            dmax, dcm, ddin = [], [], []
            for z in niv_d:
                zb = niveles_z[niveles_z.index(z) - 1]
                pares = [(k, por_nivel[zb].get(xy)) for xy, k in por_nivel[z].items() if por_nivel[zb].get(xy) is not None]
                hz = z - zb
                difs = [abs(u[k] - u[kb]) for k, kb in pares]
                dmax.append(float(fac_d * max(difs) / hz) if difs else 0.0)
                dcm.append(float(fac_d * np.mean(difs) / hz) if difs else 0.0)
                if d in dinamico and pares:
                    Um = dinamico[d]["U"].reshape(len(modos), nn_s, 6)[:, :, comp]
                    rel = np.array([[Um[mo, k] - Um[mo, kb] for k, kb in pares] for mo in range(len(modos))])
                    ddin.append(float(fac_d * _cqc(rel, w).max() / hz))
            derivas[d] = {"max": dmax, "cm": dcm, "limite": lim, "z": niv_d, "factor": fac_d,
                          "cumple": bool(max(dmax or [0]) <= lim)}
            if ddin:
                derivas[d].update({"dinamico": ddin, "cumple_dinamico": bool(max(ddin) <= lim)})

    # ---- reparto del cortante basal entre placas y columnas ----
    cortante = {}
    if activo:
        placas_base = set()
        for k, inf in enumerate(info):
            if inf["tipo"] == "placa":
                el = P["elementos"][k]
                for n in (el["i"], el["j"]):
                    if restr[n]: placas_base.add(n)
        for d, comp in (("X", 0), ("Y", 1)):
            Rb = RE["S" + d].reshape(nn_s, 6)[:, comp]
            tot = sum(Rb[n] for n in base); pl = sum(Rb[n] for n in placas_base)
            frac = float(pl / tot) if tot else 0.0
            sistema = "muros estructurales" if frac >= 0.7 else "dual" if frac >= 0.2 else "pórticos"
            cortante[d] = {"total": float(-tot), "placas": float(-pl), "frac_placas": frac, "sistema": sistema,
                           "R0_sugerido": 6 if frac >= 0.7 else 7 if frac >= 0.2 else 8}

    id_calculo = _guardar_calculo({
        "X": np.asarray(S["X"], float), "ij": [(el["i"], el["j"]) for el in S["elementos"]], "R": res["rotaciones"],
        "L": res["longitudes"], "Lf": Ls, "brazos": res["brazos"], "FE": FE,
        "ids": [info[k]["id"] for k, _, _ in origen], "nombres": [info[k]["nombre"] for k, _, _ in origen],
        "nudos_id": [n["id"] for n in nudos] + [f"t{k}" for k in range(len(X), nn_s)]})
    salida = {
        "ok": True, "id_calculo": id_calculo,
        "resumen": {"n_nudos": nn, "n_elementos": ne0, "n_gdl": res["n_gdl"], "n_libres": res["n_libres"],
                    "n_resuelto": res["n_red"], "diafragma": bool(diaf), "t_total": round(time.time() - t0, 2),
                    "t_solucion": round(res["t_solucion"], 3), "pesos_nivel": [float(P_niv[z]) for z in niv_d], "niveles": niv_d,
                    "brazos": int(sum(1 for b in res["brazos"] if b[0] or b[1])), "tramos": int(len(S["elementos"]) - ne0),
                    "dinamico": bool(dinamico)},
        "sismo": sismo_out, "casos": list(barras.keys()), "casos_base": list(casos.keys()),
        "desp": desp, "barras": barras, "reacciones": reacciones, "cortante_base": cortante,
        "equilibrio": equilibrio, "aplicado": aplicado, "derivas": derivas, "paños": P["paños"],
        "modal": [{k: (float(v) if isinstance(v, (float, np.floating)) else v) for k, v in mm.items() if k not in ("forma",)} for mm in modos[:12]],
        "elementos": [{"id": inf["id"], "nombre": inf["nombre"], "tipo": inf["tipo"], "sec": inf["sec"], "L": float(L[k]),
                       "b": inf["b"], "h": inf["h"], "fc": inf["fc"]} for k, inf in enumerate(info)],
    }
    if m.get("disenar", True):
        from core.diseno_e060 import disenar_3d
        t1 = time.time()
        salida["diseno"] = disenar_3d(salida, salida["elementos"])
        salida["resumen"]["t_diseno"] = round(time.time() - t1, 2)
    return salida


def portico_desde_3d(m, eje, valor, caso_factores=None):
    """Extrae el pórtico plano de un modelo 3D (eje 'x' → plano y = valor; eje 'y' → plano x = valor)
    como modelo 2D del editor, con las cargas repartidas igual que en el análisis 3D."""
    comp = 1 if eje == "x" else 0          # coordenada fija
    sel = [n for n in m["nudos"] if abs(float(n["x" if comp == 0 else "y"]) - valor) < TOL]
    ids = {n["id"] for n in sel}
    ex = [e for e in m["elementos"] if e["i"] in ids and e["j"] in ids]
    usados = {e["i"] for e in ex} | {e["j"] for e in ex}
    h = "y" if comp == 0 else "x"
    nudos2 = [{"id": n["id"], "nombre": n.get("nombre") or f"N{n['id']}", "x": float(n[h]), "y": float(n["z"]),
               "apoyo": {"empotrado": "empotrado", "articulado": "fijo"}.get(n.get("apoyo"), "libre")} for n in sel if n["id"] in usados]
    nombres_sec = {e["seccion"] for e in ex} | {s.get("seccion") for e in ex for s in (e.get("segmentos") or []) if s.get("seccion")}
    secs2 = [{"nombre": s["nombre"], "modo": "rect", "b": s["b"], "h": s["h"]} for s in m["secciones"] if s["nombre"] in nombres_sec]
    # cargas: mismo reparto que el análisis 3D (losa en dos direcciones, peso propio, puntuales…)
    P = preparar_modelo3d(m)
    pos = {e["id"]: k for k, e in enumerate(m["elementos"])}
    cf = caso_factores or {c["nombre"]: 1.0 for c in (m.get("casos") or [])}
    ce = []
    for e in ex:
        k = pos[e["id"]]
        if P["info"][k]["tipo"] in ("columna", "placa"):
            continue
        q1 = q2 = 0.0; puntuales = []
        for caso, f in cf.items():
            for it in (P["cargas"].get(caso) or {}).get("barras", {}).get(k, []):
                if "P" in it and "a" in it:
                    puntuales.append((f * float(it["P"][2]), float(it["a"])))
                else:
                    q1 += f * float(it["q1"][2]); q2 += f * float(it.get("q2", it["q1"])[2])
        if abs(q1) > 1e-12 or abs(q2) > 1e-12:
            if abs(q1 - q2) < 1e-9:
                ce.append({"elem": e["id"], "tipo": "distribuida", "subtipo": "uniforme", "wy": round(q1, 5), "wx": 0})
            else:
                ce.append({"elem": e["id"], "tipo": "distribuida", "subtipo": "trapezoidal", "wy1": round(q1, 5), "wy2": round(q2, 5), "wx1": 0, "wx2": 0})
        for Pz, a in puntuales:
            if abs(Pz) > 1e-12:
                ce.append({"elem": e["id"], "tipo": "puntual", "Py": round(Pz, 5), "Px": 0, "a": round(a, 5)})
    mats = m.get("materiales") or []
    mat = next((x for x in mats if x["nombre"] == m.get("material")), mats[0] if mats else {"modo": "fc", "fc": 210})
    nombre = f"{m.get('nombre', 'Modelo 3D')} · pórtico {'y' if comp == 1 else 'x'} = {valor:g} m"
    return {"nombre": nombre, "unidad_fuerza": "tonf", "unidad_longitud": "m", "despreciar_axial": True,
            "material": {"modo": mat.get("modo", "fc"), "fc": mat.get("fc", 210), "E": mat.get("E", 2e6)},
            "materiales": [{"nombre": x["nombre"], "modo": x.get("modo", "fc"), "fc": x.get("fc"), "E": x.get("E"), "densidad": x.get("densidad", 0)} for x in mats],
            "secciones": secs2, "nudos": nudos2,
            "elementos": [{"id": e["id"], "nombre": e.get("nombre") or f"E{e['id']}", "i": e["i"], "j": e["j"], "seccion": e["seccion"],
                           **({"material": e["material"]} if e.get("material") else {}),
                           **({"release_i": True} if e.get("release_i") else {}), **({"release_j": True} if e.get("release_j") else {}),
                           **({"segmentos": e["segmentos"]} if len(e.get("segmentos") or []) >= 2 else {})} for e in ex],
            "cargas_nodales": [], "cargas_elementos": ce}


def analizar_cargas_barras(m):
    """wz uniforme equivalente (por longitud) de cada barra y caso (para resúmenes y compatibilidad)."""
    P = preparar_modelo3d(m)
    out = {}
    for caso, cc in P["cargas"].items():
        for k, items in cc["barras"].items():
            W = 0.0
            for it in items:
                if "P" in it and "a" in it: W += float(it["P"][2])
                else: W += (float(it["q1"][2]) + float(it.get("q2", it["q1"])[2])) / 2 * P["L"][k]
            out.setdefault(caso, {})[m["elementos"][k]["id"]] = W / P["L"][k]
    return out


def analizar_torre(diafragma=True, periodo="norma"):
    """La torre como un modelo 3D más (misma fuente que los pórticos 2D)."""
    from core.torre_arequipa import modelo3d_torre
    m = modelo3d_torre()
    m["diafragma"] = bool(diafragma)
    m["sismo"]["periodo"] = periodo
    return analizar_modelo3d(m)


# ----------------------------------------------------------------------------
#  Cálculos recientes (en memoria) y esfuerzos en el plano de un pórtico
# ----------------------------------------------------------------------------
from collections import OrderedDict
import uuid

import threading

_CALCULOS = OrderedDict()
_CANDADO = threading.Lock()          # gunicorn usa varios hilos en un solo proceso


def _guardar_calculo(d, maximo=6):
    k = uuid.uuid4().hex
    with _CANDADO:
        _CALCULOS[k] = d
        while len(_CALCULOS) > maximo:
            _CALCULOS.popitem(last=False)
    return k


def plano_de_eje(eje, valor):
    """('x', c) → plano y = c, recorrido en +x;  ('y', c) → plano x = c, recorrido en +y."""
    if eje == "x":
        return np.array([0.0, float(valor)]), np.array([1.0, 0.0])
    return np.array([float(valor), 0.0]), np.array([0.0, 1.0])


def diagramas_portico(id_calculo, caso, eje, valor, n=21):
    """Esfuerzos N, V, M en el plano del pórtico (convención del motor 2D) para las
    barras contenidas en él, a partir de un cálculo 3D guardado. Con brazos rígidos,
    los diagramas van de cara a cara del apoyo."""
    with _CANDADO:
        d = _CALCULOS.get(id_calculo)
    if d is None:
        raise LookupError("El cálculo ya no está en memoria: vuelve a calcular el modelo 3D.")
    if caso not in d["FE"]:
        raise LookupError(f"El caso «{caso}» no tiene diagramas por barra (los casos espectrales y sus combinaciones son envolventes).")
    o, uh = plano_de_eje(eje, valor)
    U3 = np.array([uh[0], uh[1], 0.0]); V3 = np.array([0.0, 0.0, 1.0])
    W3 = np.cross(U3, V3)
    X = d["X"]
    dist = lambda p: abs((p[0] - o[0]) * (-uh[1]) + (p[1] - o[1]) * uh[0])
    coord = lambda p: ((p[0] - o[0]) * uh[0] + (p[1] - o[1]) * uh[1], p[2])
    fe_arr, cl = d["FE"][caso]
    out, nudos = [], {}
    for k, (i, j) in enumerate(d["ij"]):
        if dist(X[i]) > TOL or dist(X[j]) > TOL:
            continue
        R = d["R"][k]; L = float(d["L"][k]); Lf = float(d["Lf"][k]); bi, bj = d["brazos"][k]
        e1 = R[0]
        e2 = -np.dot(e1, V3) * U3 + np.dot(e1, U3) * V3          # perpendicular en el plano (giro +90°)
        nrm = np.linalg.norm(e2)
        if nrm < 1e-9:
            continue
        e2 /= nrm
        w = np.cross(e1, e2)
        Q = np.vstack([e1, e2, w]) @ R.T                          # local 3D → ejes del pórtico
        f = fe_arr[k]
        f2 = np.concatenate([Q @ f[0:3], Q @ f[3:6], Q @ f[6:9], Q @ f[9:12]])
        c = cl[k]
        c2 = {"q1": Q @ c["q1"], "q2": Q @ c["q2"], "P": [(Q @ p, a) for p, a in c.get("P", [])]}
        s, N, V, _, M, _ = internas(f2, c2, Lf, n)
        pi_ = np.asarray(X[i]) + bi * e1; pj_ = np.asarray(X[j]) - bj * e1
        ui, vi = coord(pi_); uj, vj = coord(pj_)
        nudos[d["nudos_id"][i]] = coord(X[i]); nudos[d["nudos_id"][j]] = coord(X[j])
        out.append({"elem": d["nombres"][k], "id": d["ids"][k], "xi": ui, "yi": vi, "xj": uj, "yj": vj,
                    "L": Lf, "s": np.round(s, 5).tolist(), "N": np.round(N, 4).tolist(),
                    "V": np.round(V, 4).tolist(), "M": np.round(M, 4).tolist(),
                    "brazos": [bi, bj], "fuera_plano": float(abs((R.T @ f[0:3]) @ W3))})
    return {"ok": True, "caso": caso, "eje": eje, "valor": float(valor), "elementos": out,
            "nudos": [{"nombre": str(k), "x": u, "y": v} for k, (u, v) in nudos.items()]}
