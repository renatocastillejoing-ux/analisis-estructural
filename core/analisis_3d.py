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
  Diafragma rígido opcional por nivel: los nudos del piso comparten (Ux, Uy, Rz)
  de un nudo maestro en el centro de masas; cada nudo conserva (uz, rx, ry).
  Cargas en barras: uniformes en coordenadas globales (fuerza/longitud).
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


def feq_uniforme(q_loc, L):
    """Cargas nodales equivalentes (locales) de una carga uniforme q_loc = (qx, qy, qz)."""
    qx, qy, qz = q_loc
    f = np.zeros(12)
    f[0] = f[6] = qx * L / 2
    f[1] = f[7] = qy * L / 2
    f[5], f[11] = qy * L ** 2 / 12, -qy * L ** 2 / 12
    f[2] = f[8] = qz * L / 2
    f[4], f[10] = -qz * L ** 2 / 12, qz * L ** 2 / 12
    return f


def internas(f, q, L, n=9):
    """Esfuerzos a lo largo de la barra a partir de las acciones de extremo f
    (locales, sobre la barra) y la carga uniforme local q. N (+ tracción)."""
    s = np.linspace(0, L, n)
    N = -f[0] - q[0] * s
    Vy = f[1] + q[1] * s
    Vz = f[2] + q[2] * s
    Mz = -f[5] + f[1] * s + q[1] * s ** 2 / 2
    My = -f[4] - f[2] * s - q[2] * s ** 2 / 2
    return s, N, Vy, Vz, Mz, My


# ----------------------------------------------------------------------------
#  Solver general
# ----------------------------------------------------------------------------
def resolver(modelo, casos, diafragmas=None):
    """
    modelo = {
      "nudos":  [[x, y, z], ...],
      "restr":  [[1,1,1,1,1,1] o None por nudo],
      "elementos": [{"i","j","E","G","w","d","wdir"}],
    }
    casos = {nombre: {"barras": {idx_elem: (qx,qy,qz) global}, "nudos": {idx: [Fx,Fy,Fz,Mx,My,Mz]},
                      "maestros": {nivel: [Fx, Fy, Mz]}}}
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
        A, Iy, Iz, J = props_rect(el["w"], el["d"])
        kl = k_local(el["E"], el["G"], A, Iy, Iz, J, L)
        T = np.kron(np.eye(4), R)
        kg = T.T @ kl @ T
        g = np.r_[6 * i:6 * i + 6, 6 * j:6 * j + 6]
        filas.append(np.repeat(g, 12)); cols.append(np.tile(g, 12)); vals.append(kg.ravel())
        datos_el.append((R, L, T, kl, g))
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
    feq_loc = {}
    for c, nom in enumerate(nombres):
        caso = casos[nom]
        for e, qg in (caso.get("barras") or {}).items():
            R, L, T, kl, g = datos_el[e]
            ql = R @ np.asarray(qg, float)
            fe = feq_uniforme(ql, L)
            feq_loc[(c, e)] = (fe, ql)
            F[g, c] += T.T @ fe
        for n, v in (caso.get("nudos") or {}).items():
            F[6 * n:6 * n + 6, c] += np.asarray(v, float)
        for lv, v in (caso.get("maestros") or {}).items():
            m0 = 3 * niveles.index(lv)
            Fred_extra[m0:m0 + 3, c] += np.asarray(v, float)
    Fred = Tm.T @ F[libres] + Fred_extra

    t1 = time.time()
    lu = spla.splu(Kred)
    Ured = lu.solve(Fred)
    t2 = time.time()
    U = np.zeros((nd, len(nombres)))
    U[libres] = Tm @ Ured

    # ---- reacciones y acciones de extremo ----
    Rtot = (K @ U) - F
    reac = {nom: Rtot[:, c] for c, nom in enumerate(nombres)}
    fext = {}
    for c, nom in enumerate(nombres):
        arr = np.zeros((len(datos_el), 12)); qarr = np.zeros((len(datos_el), 3))
        for e, (R, L, T, kl, g) in enumerate(datos_el):
            f = kl @ (T @ U[g, c])
            if (c, e) in feq_loc:
                fe, ql = feq_loc[(c, e)]
                f -= fe; qarr[e] = ql
            arr[e] = f
        fext[nom] = (arr, qarr)

    return {
        "U": U, "nombres": nombres, "reacciones": reac, "fijo": fijo, "fext": fext,
        "longitudes": np.array([d[1] for d in datos_el]), "F": F,
        "rotaciones": [d[0] for d in datos_el],
        "Kred": Kred, "n_maestros": n_m, "niveles": niveles,
        "n_gdl": nd, "n_libres": len(libres), "n_red": n_red,
        "t_ensamble": t1 - t0, "t_solucion": t2 - t1,
    }


def resumen_barras(fext_arr, q_arr, L):
    """Por barra: N en i y j (+ tracción), |V| máx, |M| máx (las dos flexiones) y T."""
    out = np.zeros((len(L), 6))
    for e in range(len(L)):
        s, N, Vy, Vz, Mz, My = internas(fext_arr[e], q_arr[e], L[e])
        out[e] = [N[0], N[-1], max(np.abs(Vy).max(), np.abs(Vz).max()),
                  np.abs(Mz).max(), np.abs(My).max(), abs(fext_arr[e][3])]
    return out


def modal_condensado(Kred, n_m, masas):
    """Modos con los GDL maestros (Ux, Uy, Rz por piso) por condensación estática.
    masas: lista por nivel de (m, J)."""
    Kll = Kred[:n_m, :n_m].toarray()
    Klo = Kred[:n_m, n_m:]
    Koo = Kred[n_m:, n_m:].tocsc()
    X = spla.splu(Koo).solve(Klo.T.toarray())
    Kc = Kll - Klo @ X
    Kc = (Kc + Kc.T) / 2
    M = np.zeros((n_m, n_m))
    for k, (m, J) in enumerate(masas):
        M[3 * k, 3 * k] = M[3 * k + 1, 3 * k + 1] = m
        M[3 * k + 2, 3 * k + 2] = J
    w2, phi = sla.eigh(Kc, M)
    w = np.sqrt(np.maximum(w2, 0))
    mt = sum(m for m, _ in masas); Jt = sum(J for _, J in masas)
    modos = []
    for k in range(n_m):
        f = phi[:, k]
        mg = f @ M @ f
        rx = np.zeros(n_m); rx[0::3] = 1
        ry = np.zeros(n_m); ry[1::3] = 1
        rz = np.zeros(n_m); rz[2::3] = 1
        part = []
        for r, tot in ((rx, mt), (ry, mt), (rz, Jt)):
            G = (f @ M @ r) / mg
            part.append(G ** 2 * mg / tot)
        modos.append({"modo": k + 1, "T": 2 * math.pi / w[k] if w[k] > 0 else None,
                      "f": w[k] / (2 * math.pi), "Mx": part[0], "My": part[1], "Rz": part[2],
                      "forma": f.tolist()})
    return modos


# ----------------------------------------------------------------------------
#  Modelo 3D general (formato del editor 3D)
# ----------------------------------------------------------------------------
#  modelo3d = {
#    "tipo": "3d", "nombre", "unidad_fuerza": "tonf", "unidad_longitud": "m",
#    "ejes": {"x": [{"nombre","c"}], "y": [...]}, "niveles": [{"nombre","z"}],
#    "materiales": [{"nombre","modo":"fc"|"E","fc","E","densidad","nu"}],
#    "material": nombre por defecto,
#    "secciones": [{"nombre","b","h"}]      b = ancho (X en columnas sin giro), h = peralte / lado en Y,
#    "nudos": [{"id","nombre","x","y","z","apoyo": libre|empotrado|articulado}],
#    "elementos": [{"id","nombre","i","j","seccion","material"?, "giro": 0|90}],
#    "casos": [{"nombre"}],
#    "cargas_area": [{"z","caso","q"}],               losa en dos direcciones sobre los paños del nivel
#    "cargas_barras": [{"elem","caso","wz"}],          uniforme vertical global (negativo = abajo)
#    "cargas_nudos": [{"nudo","caso","F":[Fx,Fy,Fz,Mx,My,Mz]}],
#    "peso_propio": bool, "caso_peso_propio": "CM",
#    "diafragma": bool,
#    "sismo": {"activo","Z","U","S","R","TP","TL","CT","periodo":"norma"|"modal","caso_masa":{"CM":1,"CV":0.25}},
#    "combinaciones": [{"nombre","factores":{caso: f}}],
#  }
TOL = 1e-6


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


def analizar_modelo3d(m):
    from core.torre_sismo import C_factor as _C_tp, k_exponente as _k_tp
    t0 = time.time()
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
        elementos.append({"i": i, "j": j, "E": E, "G": G, "w": w, "d": d, "wdir": wdir})
        vertical = wdir != [0, 0, 1]
        dz = abs(X[j][2] - X[i][2])
        tipo = "columna" if vertical else ("viga" if dz < TOL else "diagonal")
        if tipo == "viga":
            tipo = "viga_x" if abs(X[j][1] - X[i][1]) < TOL else ("viga_y" if abs(X[j][0] - X[i][0]) < TOL else "viga")
        info.append({"id": e["id"], "nombre": e.get("nombre") or f"E{e['id']}", "tipo": tipo, "sec": e["seccion"],
                     "densidad": float(mat.get("densidad", 2.4) or 0)})
        barra_de[(min(i, j), max(i, j))] = k
    existe = lambda p, q: (min(p, q), max(p, q)) in barra_de
    L = [float(np.linalg.norm(np.subtract(X[el["j"]], X[el["i"]]))) for el in elementos]

    # ---- cargas por caso: barras (global, por longitud) y nudos ----
    cargas = {c: {"barras": {}, "nudos": {}} for c in casos_n}
    def suma_barra(caso, e, qz):
        if caso not in cargas: cargas[caso] = {"barras": {}, "nudos": {}}
        q = cargas[caso]["barras"].get(e, (0, 0, 0))
        cargas[caso]["barras"][e] = (q[0], q[1], q[2] + qz)
    if m.get("peso_propio", True):
        for e, el in enumerate(elementos):
            if info[e]["densidad"] > 0:
                suma_barra(caso_pp, e, -info[e]["densidad"] * el["w"] * el["d"])
    for c in m.get("cargas_barras") or []:
        suma_barra(c.get("caso") or casos_n[0], m["elementos"].index(next(x for x in m["elementos"] if x["id"] == c["elem"])), float(c.get("wz", 0)))
    # losas en dos direcciones (líneas a 45°), uniformizadas conservando el total
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
                suma_barra(caso, e, -q * (ax / lx if n < 2 else ay / ly))
            paños_info.append({"z": z, "x0": x0, "x1": x1, "y0": y0, "y1": y1, "caso": caso, "q": q})
    for c in m.get("cargas_nudos") or []:
        caso = c.get("caso") or casos_n[0]
        cargas.setdefault(caso, {"barras": {}, "nudos": {}})
        k = idx[c["nudo"]]
        prev = cargas[caso]["nudos"].get(k, [0] * 6)
        cargas[caso]["nudos"][k] = [a + float(b) for a, b in zip(prev, list(c.get("F", [0] * 6)) + [0] * 6)]

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
        for e, q in (cargas.get(caso) or {}).get("barras", {}).items():
            W = -q[2] * L[e] * f
            for k in (elementos[e]["i"], elementos[e]["j"]):
                z = round(X[k][2], 6)
                if z in P_niv: P_niv[z] += W / 2
    niv_d = sorted(diaf) if diaf else []

    # ---- sismo E.030 estático ----
    sismo_out = {}
    casos = {c: v for c, v in cargas.items()}
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
    if activo:
        Z = float(sis_cfg.get("Z", 0.35)); U = float(sis_cfg.get("U", 1)); S = float(sis_cfg.get("S", 1.15))
        R = float(sis_cfg.get("R", 8)); TP = float(sis_cfg.get("TP", 0.6)); CT = float(sis_cfg.get("CT", 60))
        hn = max(niv_d) - min(niveles_z)
        T_n = hn / CT
        if sis_cfg.get("periodo") == "modal":
            r0 = resolver({"nudos": X, "restr": restr, "elementos": elementos}, {casos_n[0]: casos[casos_n[0]]}, diaf)
            modos = modal_condensado(r0["Kred"], r0["n_maestros"], masas())
            T_modal = {d: max(modos, key=lambda mm: mm[key])["T"] for d, key in (("X", "Mx"), ("Y", "My"))}
        P = [P_niv[z] for z in niv_d]; h = [z - min(niveles_z) for z in niv_d]
        for d in ("X", "Y"):
            T = T_modal.get(d, T_n)
            C = min(2.5 * (TP / T) if T > TP else 2.5, 2.5)
            k = 1.0 if T <= 0.5 else 0.75 + 0.5 * T
            V = Z * U * C * S / R * sum(P)
            Ft = 0.07 * T * V if T > 0.7 else 0.0
            den = sum(Pi * hi ** k for Pi, hi in zip(P, h)) or 1
            F = [(V - Ft) * Pi * hi ** k / den for Pi, hi in zip(P, h)]
            if F: F[-1] += Ft
            mae = {}
            for z, fi in zip(niv_d, F):
                lx, ly = plan_dims(z)
                e_acc = 0.05 * (ly if d == "X" else lx)
                mae[z] = [fi, 0, fi * e_acc] if d == "X" else [0, fi, fi * e_acc]
            casos["S" + d] = {"maestros": mae}
            sismo_out[d] = {"T": float(T), "C": float(C), "k": float(k), "V": float(V), "F": [float(f) for f in F], "R": R, "T_norma": float(T_n)}

    res = resolver({"nudos": X, "restr": restr, "elementos": elementos}, casos, diaf)
    if diaf and not modos and any(P_niv.get(z, 0) > 0 for z in niv_d):
        modos = modal_condensado(res["Kred"], res["n_maestros"], masas())

    # ---- combinaciones ----
    nombres = res["nombres"]
    Ud = {n: res["U"][:, c] for c, n in enumerate(nombres)}
    FE = {n: res["fext"][n] for n in nombres}
    RE = dict(res["reacciones"])
    combos = m.get("combinaciones")
    if not combos:
        combos = []
        if "CM" in casos and "CV" in casos: combos.append({"nombre": "1.4CM+1.7CV", "factores": {"CM": 1.4, "CV": 1.7}})
        if activo:
            for d in ("X", "Y"):
                combos.append({"nombre": f"1.25(CM+CV)+S{d}", "factores": {"CM": 1.25, "CV": 1.25, "S" + d: 1}})
                combos.append({"nombre": f"0.9CM+S{d}", "factores": {"CM": 0.9, "S" + d: 1}})
    for cb in combos:
        fac = {k: float(v) for k, v in (cb.get("factores") or {}).items() if k in Ud}
        if not fac: continue
        Ud[cb["nombre"]] = sum(f * Ud[k] for k, f in fac.items())
        FE[cb["nombre"]] = (sum(f * FE[k][0] for k, f in fac.items()), sum(f * FE[k][1] for k, f in fac.items()))
        RE[cb["nombre"]] = sum(f * RE[k] for k, f in fac.items())

    nn = len(X); Ls = res["longitudes"]
    desp = {c: np.round(Ud[c].reshape(nn, 6)[:, :3], 7).tolist() for c in Ud}
    barras = {}
    for c in Ud:
        rb = resumen_barras(FE[c][0], FE[c][1], Ls)
        barras[c] = {"N": np.round(np.where(np.abs(rb[:, 0]) >= np.abs(rb[:, 1]), rb[:, 0], rb[:, 1]), 3).tolist(),
                     "V": np.round(rb[:, 2], 3).tolist(), "M": np.round(np.maximum(rb[:, 3], rb[:, 4]), 3).tolist(),
                     "Mz": np.round(rb[:, 3], 3).tolist(), "My": np.round(rb[:, 4], 3).tolist(),
                     "T": np.round(rb[:, 5], 3).tolist()}
    base = [k for k in range(nn) if restr[k]]
    reacciones, equilibrio = {}, {}
    for c in Ud:
        Rr = RE[c].reshape(nn, 6)
        reacciones[c] = [{"nudo": nudos[k]["nombre"] if "nombre" in nudos[k] else str(nudos[k]["id"]), "R": np.round(Rr[k], 4).tolist()} for k in base]
        s = Rr[base].sum(axis=0)
        equilibrio[c] = {"Rx": float(s[0]), "Ry": float(s[1]), "Rz": float(s[2])}
    aplicado = {}
    for c in casos:
        Fz = sum(q[2] * Ls[e] for e, q in casos[c].get("barras", {}).items()) + sum(v[2] for v in casos[c].get("nudos", {}).values())
        Fx = sum(v[0] for v in casos[c].get("nudos", {}).values()) + sum(v[0] for v in casos[c].get("maestros", {}).values())
        Fy = sum(v[1] for v in casos[c].get("nudos", {}).values()) + sum(v[1] for v in casos[c].get("maestros", {}).values())
        aplicado[c] = {"Fx": float(Fx), "Fy": float(Fy), "Fz": float(Fz)}

    derivas = {}
    if activo:
        R_sis = sismo_out["X"]["R"]
        pos_xy = {}
        for z in niveles_z:
            for (x, y), k in por_nivel[z].items(): pos_xy.setdefault((x, y), []).append((z, k))
        for d, comp in (("X", 0), ("Y", 1)):
            u = Ud["S" + d].reshape(nn, 6)[:, comp]
            dmax, dcm = [], []
            for a, z in enumerate(niv_d):
                zb = niveles_z[niveles_z.index(z) - 1]
                difs = []
                for (x, y), k in por_nivel[z].items():
                    kb = por_nivel[zb].get((x, y))
                    if kb is not None: difs.append(abs(u[k] - u[kb]))
                hz = z - zb
                dmax.append(float(0.75 * R_sis * max(difs) / hz) if difs else 0.0)
                dcm.append(float(0.75 * R_sis * np.mean(difs) / hz) if difs else 0.0)
            lim = float(sis_cfg.get("limite_deriva", 0.007))
            derivas[d] = {"max": dmax, "cm": dcm, "limite": lim, "cumple": bool(max(dmax or [0]) <= lim), "z": niv_d}

    id_calculo = _guardar_calculo({
        "X": np.asarray(X, float), "ij": [(el["i"], el["j"]) for el in elementos], "R": res["rotaciones"], "L": Ls,
        "FE": FE, "ids": [inf["id"] for inf in info], "nombres": [inf["nombre"] for inf in info],
        "nudos_id": [n["id"] for n in nudos]})
    return {
        "ok": True, "id_calculo": id_calculo,
        "resumen": {"n_nudos": nn, "n_elementos": len(elementos), "n_gdl": res["n_gdl"], "n_libres": res["n_libres"],
                    "n_resuelto": res["n_red"], "diafragma": bool(diaf), "t_total": round(time.time() - t0, 2),
                    "t_solucion": round(res["t_solucion"], 3), "pesos_nivel": [float(P_niv[z]) for z in niv_d], "niveles": niv_d},
        "sismo": sismo_out, "casos": list(Ud.keys()), "casos_base": list(casos.keys()),
        "desp": desp, "barras": barras, "reacciones": reacciones,
        "equilibrio": equilibrio, "aplicado": aplicado, "derivas": derivas, "paños": paños_info,
        "modal": [{k: (float(v) if isinstance(v, (float, np.floating)) else v) for k, v in mm.items() if k != "forma"} for mm in modos[:12]],
        "elementos": [{"id": inf["id"], "nombre": inf["nombre"], "tipo": inf["tipo"], "sec": inf["sec"], "L": float(Ls[k])} for k, inf in enumerate(info)],
    }


def portico_desde_3d(m, eje, valor, caso_factores=None):
    """Extrae el pórtico plano de un modelo 3D (eje 'x' → plano y = valor; eje 'y' → plano x = valor)
    como modelo 2D del editor, con las cargas de losa repartidas al pórtico (mismo reparto que en 3D)."""
    comp = 1 if eje == "x" else 0          # coordenada fija
    sel = [n for n in m["nudos"] if abs(float(n["x" if comp == 0 else "y"]) - valor) < TOL]
    ids = {n["id"] for n in sel}
    ex = [e for e in m["elementos"] if e["i"] in ids and e["j"] in ids]
    usados = {e["i"] for e in ex} | {e["j"] for e in ex}
    h = "y" if comp == 0 else "x"
    nudos2 = [{"id": n["id"], "nombre": n.get("nombre") or f"N{n['id']}", "x": float(n[h]), "y": float(n["z"]),
               "apoyo": {"empotrado": "empotrado", "articulado": "fijo"}.get(n.get("apoyo"), "libre")} for n in sel if n["id"] in usados]
    secs2, vistas = [], set()
    for e in ex:
        s = next(s for s in m["secciones"] if s["nombre"] == e["seccion"])
        if s["nombre"] in vistas: continue
        vistas.add(s["nombre"]); secs2.append({"nombre": s["nombre"], "modo": "rect", "b": s["b"], "h": s["h"]})
    # cargas: se calculan con el mismo reparto del análisis 3D
    r = analizar_cargas_barras(m)
    cf = caso_factores or {c["nombre"]: 1.0 for c in (m.get("casos") or [])}
    ce = []
    for e in ex:
        w = sum(f * r.get(c, {}).get(e["id"], 0.0) for c, f in cf.items())
        dz = abs(next(n for n in m["nudos"] if n["id"] == e["j"])["z"] - next(n for n in m["nudos"] if n["id"] == e["i"])["z"])
        if abs(w) > 1e-12 and dz < TOL:
            ce.append({"elem": e["id"], "tipo": "distribuida", "subtipo": "uniforme", "wy": round(w, 5), "wx": 0})
    mats = m.get("materiales") or []
    mat = next((x for x in mats if x["nombre"] == m.get("material")), mats[0] if mats else {"modo": "fc", "fc": 210})
    nombre = f"{m.get('nombre', 'Modelo 3D')} · pórtico {'y' if comp == 1 else 'x'} = {valor:g} m"
    return {"nombre": nombre, "unidad_fuerza": "tonf", "unidad_longitud": "m", "despreciar_axial": True,
            "material": {"modo": mat.get("modo", "fc"), "fc": mat.get("fc", 210), "E": mat.get("E", 2e6)},
            "materiales": [{"nombre": x["nombre"], "modo": x.get("modo", "fc"), "fc": x.get("fc"), "E": x.get("E"), "densidad": x.get("densidad", 0)} for x in mats],
            "secciones": secs2, "nudos": nudos2,
            "elementos": [{"id": e["id"], "nombre": e.get("nombre") or f"E{e['id']}", "i": e["i"], "j": e["j"], "seccion": e["seccion"],
                           **({"material": e["material"]} if e.get("material") else {})} for e in ex],
            "cargas_nodales": [], "cargas_elementos": ce}


def analizar_cargas_barras(m):
    """wz (por longitud) de cada barra y caso, con el mismo reparto que analizar_modelo3d."""
    mm = dict(m); mm["sismo"] = {"activo": False}
    nudos = m["nudos"]; idx = {n["id"]: k for k, n in enumerate(nudos)}
    X = [[float(n["x"]), float(n["y"]), float(n["z"])] for n in nudos]
    barra_de = {}
    for k, e in enumerate(m["elementos"]):
        i, j = idx[e["i"]], idx[e["j"]]; barra_de[(min(i, j), max(i, j))] = e["id"]
    existe = lambda p, q: (min(p, q), max(p, q)) in barra_de
    niveles_z = sorted({round(p[2], 6) for p in X})
    por_nivel = {z: {(round(X[k][0], 6), round(X[k][1], 6)): k for k in range(len(X)) if abs(X[k][2] - z) < TOL} for z in niveles_z}
    out = {}
    secs = {s["nombre"]: s for s in m["secciones"]}
    mats = {x["nombre"]: x for x in m.get("materiales") or []}
    mat_def = mats.get(m.get("material")) or next(iter(mats.values()), {"densidad": 2.4})
    casos_n = [c["nombre"] for c in (m.get("casos") or [{"nombre": "CM"}])]
    if m.get("peso_propio", True):
        cpp = m.get("caso_peso_propio") or casos_n[0]
        for e in m["elementos"]:
            s = secs[e["seccion"]]; mat = mats.get(e.get("material")) or mat_def
            out.setdefault(cpp, {})[e["id"]] = out.get(cpp, {}).get(e["id"], 0) - float(mat.get("densidad", 2.4) or 0) * s["b"] * s["h"]
    for c in m.get("cargas_barras") or []:
        cs = c.get("caso") or casos_n[0]
        out.setdefault(cs, {})[c["elem"]] = out.get(cs, {}).get(c["elem"], 0) + float(c.get("wz", 0))
    for ca in m.get("cargas_area") or []:
        z = min(niveles_z, key=lambda t: abs(t - float(ca["z"])))
        q = float(ca.get("q", 0)); cs = ca.get("caso") or casos_n[0]
        for (x0, x1, y0, y1, bordes) in paños_nivel(por_nivel[z], existe):
            lx, ly = x1 - x0, y1 - y0
            a, bb = min(lx, ly), max(lx, ly)
            tri = a * a / 4.0; trap = (a * bb - 2 * tri) / 2.0
            ax = tri if lx <= ly else trap; ay = trap if lx <= ly else tri
            for n, (p, r) in enumerate(bordes):
                eid = barra_de[(min(p, r), max(p, r))]
                out.setdefault(cs, {})[eid] = out.get(cs, {}).get(eid, 0) - q * (ax / lx if n < 2 else ay / ly)
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

_CALCULOS = OrderedDict()


def _guardar_calculo(d, maximo=6):
    k = uuid.uuid4().hex
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
    barras contenidas en él, a partir de un cálculo 3D guardado."""
    d = _CALCULOS.get(id_calculo)
    if d is None:
        raise LookupError("El cálculo ya no está en memoria: vuelve a calcular el modelo 3D.")
    if caso not in d["FE"]:
        raise LookupError(f"Caso desconocido: {caso}")
    o, uh = plano_de_eje(eje, valor)
    U3 = np.array([uh[0], uh[1], 0.0]); V3 = np.array([0.0, 0.0, 1.0])
    W3 = np.cross(U3, V3)
    X = d["X"]
    dist = lambda p: abs((p[0] - o[0]) * (-uh[1]) + (p[1] - o[1]) * uh[0])
    coord = lambda p: ((p[0] - o[0]) * uh[0] + (p[1] - o[1]) * uh[1], p[2])
    fe_arr, q_arr = d["FE"][caso]
    out, nudos = [], {}
    for k, (i, j) in enumerate(d["ij"]):
        if dist(X[i]) > TOL or dist(X[j]) > TOL:
            continue
        R = d["R"][k]; L = float(d["L"][k]); f = fe_arr[k]; q = q_arr[k]
        e1 = R[0]
        e2 = -np.dot(e1, V3) * U3 + np.dot(e1, U3) * V3          # perpendicular en el plano (giro +90°)
        nrm = np.linalg.norm(e2)
        if nrm < 1e-9:
            continue
        e2 /= nrm
        w = np.cross(e1, e2)
        F1 = R.T @ f[0:3]; M1 = R.T @ f[3:6]; qg = R.T @ q
        Fx, Fy, Mw = F1 @ e1, F1 @ e2, M1 @ w
        qx, qy = qg @ e1, qg @ e2
        s = np.linspace(0, L, n)
        N = -Fx - qx * s
        V = Fy + qy * s
        M = -Mw + Fy * s + qy * s ** 2 / 2
        ui, vi = coord(X[i]); uj, vj = coord(X[j])
        nudos[d["nudos_id"][i]] = (ui, vi); nudos[d["nudos_id"][j]] = (uj, vj)
        out.append({"elem": d["nombres"][k], "id": d["ids"][k], "xi": ui, "yi": vi, "xj": uj, "yj": vj,
                    "L": L, "s": np.round(s, 5).tolist(), "N": np.round(N, 4).tolist(),
                    "V": np.round(V, 4).tolist(), "M": np.round(M, 4).tolist(),
                    "fuera_plano": float(abs(F1 @ W3))})
    return {"ok": True, "caso": caso, "eje": eje, "valor": float(valor), "elementos": out,
            "nudos": [{"nombre": str(k), "x": u, "y": v} for k, (u, v) in nudos.items()]}
