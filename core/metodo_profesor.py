# -*- coding: utf-8 -*-
"""
================================================================================
  MÉTODO SISTEMATIZADO DE RIGIDEZ CON MATRICES 4×4 (formulación del profesor)
================================================================================
  Cada barra tiene 4 GDL locales, en este orden:
        d = [Δi, θi, Δj, θj]
  Δ = desplazamiento perpendicular a la barra, θ = giro (antihorario +,
  horario −). Extremo i = abajo en columnas y placas, izquierda en vigas.

  Rigidez de barra (Timoshenko; α = 0 en vigas y columnas):
                 ⎡ 12/L²    6/L    −12/L²    6/L  ⎤
    [k] = EI     ⎢ 6/L     4+α     −6/L     2−α   ⎥
         ─────── ⎢ −12/L²  −6/L     12/L²   −6/L  ⎥
         L(1+α)  ⎣ 6/L     2−α     −6/L     4+α   ⎦
    placa:  α = 12EI / (L²·G·Ac),  G = E / 2(1+ν),  ν = 0.15,  Ac = 5/6·b·h

  Brazo rígido de longitud a en el extremo i (b en j): la barra flexible mide
  L − a − b y su Δ en el borde del brazo es Δi + a·θi  (Δj − b·θj): entra en [A].

  Deformación axial despreciada (EA = ∞): las traslaciones independientes son el
  espacio nulo de las barras inextensibles (sirve con varios pisos e inclinadas).

  Pasos: [A] → [k] → [A]ᵀ[k][A] → [K] = Σ → {Q}nudos → {r} → {R} = Σ[A]ᵀ{r}
         → {Q} = {Q}nudos − {R} → {D} = [K]⁻¹{Q} → {d} = [A]{D} → {q} = [k]{d}
         → {q}total = {q} + {r}
================================================================================
"""
import numpy as np

from core.metodo_matricial_A import _rref_nulo
from core.metodo_rigidez import NU_PLACA

LOC = ["Δi", "θi", "Δj", "θj"]


def k_barra(EI, L, alfa=0.0):
    """Matriz 4×4 del profesor (Δi, θi, Δj, θj)."""
    f = EI / (L * (1.0 + alfa))
    return f * np.array([
        [12 / L**2, 6 / L, -12 / L**2, 6 / L],
        [6 / L, 4 + alfa, -6 / L, 2 - alfa],
        [-12 / L**2, -6 / L, 12 / L**2, -6 / L],
        [6 / L, 2 - alfa, -6 / L, 4 + alfa]])


def k_rotula(EI, L, rel_i, rel_j):
    """[k] 4×4 del profesor para barra con rótula (Δi, θi, Δj, θj)."""
    if rel_i and rel_j:
        return np.zeros((4, 4))
    c = 3 * EI / L**3
    if rel_j:
        return c * np.array([[1, L, -1, 0], [L, L**2, -L, 0], [-1, -L, 1, 0], [0, 0, 0, 0]], float)
    return c * np.array([[1, 0, -1, L], [0, 0, 0, 0], [-1, 0, 1, -L], [L, 0, -L, L**2]], float)


def _tipo(e):
    c, s = abs(e.cos), abs(e.sin)
    if s < 1e-6:
        return "viga"
    if c < 1e-6:
        return "placa" if e.placa else "columna"
    return "inclinada"


def _invertida(e, tipo):
    """True si el extremo i del modelo no es el de abajo (columna) / izquierda (viga)."""
    if tipo in ("columna", "placa"):
        return e.nj.y < e.ni.y
    return e.nj.x < e.ni.x


def _orden_barras(elementos):
    """Columnas y placas de abajo hacia arriba y de izquierda a derecha; luego vigas
    (por piso, de izquierda a derecha); al final las inclinadas."""
    def clave(e):
        t = _tipo(e)
        g = 0 if t in ("columna", "placa") else 1 if t == "viga" else 2
        return (g, round(min(e.ni.y, e.nj.y), 6), round(min(e.ni.x, e.nj.x), 6), e.id)
    return sorted(elementos, key=clave)


def _flexibles(e):
    return [sg for sg in (e.segmentos or []) if not sg.get("rigido")]


def _asent(nd):
    """Asentamiento impuesto en los GDL restringidos del nudo (dx, dy, giro)."""
    return np.array([nd.asentamiento[k] if nd.restriccion[k] else 0.0 for k in range(3)], float)


def resolver_profesor(est):
    """Resuelve la estructura con matrices 4×4 por barra. Devuelve un dict con todos
    los datos de cada paso (para el reproductor y la memoria de cálculo)."""
    est.ensamblar()                       # fija Timoshenko, axial y tramos en cada barra
    nudos = sorted(est.nudos, key=lambda n: n.id)
    elementos = _orden_barras(est.elementos)

    # ---- GDL globales: traslaciones independientes (barras inextensibles) + giros ----
    comp = []
    for n in sorted(nudos, key=lambda q: (-q.y, q.x)):
        for k in (0, 1):
            if n.restriccion[k] == 0:
                comp.append((n.id, k))
    col = {c: i for i, c in enumerate(comp)}
    filas = []
    for e in elementos:
        f = np.zeros(len(comp))
        for nd, sg in ((e.nj, 1.0), (e.ni, -1.0)):
            if (nd.id, 0) in col: f[col[(nd.id, 0)]] += sg * e.cos
            if (nd.id, 1) in col: f[col[(nd.id, 1)]] += sg * e.sin
        if np.any(f):
            filas.append(f)
    if comp:
        N, libres = _rref_nulo(np.array(filas) if filas else np.zeros((0, len(comp))))
    else:
        N, libres = np.zeros((0, 0)), []
    nT = N.shape[1]
    nombre = {n.id: n.nombre for n in nudos}
    def _comp_real(k, f):
        # componente que representa al GDL de traslación (modo de piso): la x si participa
        # (la de mayor |valor|, el nudo más alto primero); si no, la y. Solo cambia la etiqueta.
        nz = [i for i in range(len(comp)) if abs(N[i, k]) > 1e-9]
        xs = [i for i in nz if comp[i][1] == 0]
        cand = xs or nz or [f]
        return max(cand, key=lambda i: (round(abs(N[i, k]), 9), -i))
    labels = []
    for k, f in enumerate(libres):
        i = _comp_real(k, f)
        labels.append(f"D{k+1}(Δ{'x' if comp[i][1] == 0 else 'y'} {nombre[comp[i][0]]})")
    rot = {}
    for n in nudos:
        if n.restriccion[2] == 0:
            rot[n.id] = len(labels)
            labels.append(f"D{len(labels)+1}(θ {n.nombre})")
    nD = len(labels)

    def tras(nd):
        T = np.zeros((2, nD))
        for k in (0, 1):
            if (nd.id, k) in col:
                T[k, :nT] = N[col[(nd.id, k)]]
        return T

    S_INV = np.array([[0, 0, -1, 0], [0, 0, 0, 1], [-1, 0, 0, 0], [0, 1, 0, 0]], float)
    K = np.zeros((nD, nD)); R = np.zeros(nD)
    barras = []
    numero = 0
    for e in elementos:
        tipo = _tipo(e)
        nrm = np.array([-e.sin, e.cos]); ex = np.array([e.cos, e.sin])
        # compatibilidad en los nudos (sistema de la barra tal como está en el modelo)
        An = np.zeros((4, nD))
        An[0] = nrm @ tras(e.ni); An[2] = nrm @ tras(e.nj)
        if e.ni.id in rot: An[1, rot[e.ni.id]] = 1.0
        if e.nj.id in rot: An[3, rot[e.nj.id]] = 1.0
        a, b = float(e.brazo_i), float(e.brazo_j)
        T = np.array([[1, a, 0, 0], [0, 1, 0, 0], [0, 0, 1, -b], [0, 0, 0, 1]], float)
        Ti = np.linalg.inv(T)
        # rigidez y empotramiento del motor (tramos, rótulas y brazos ya condensados)
        k6, ff6 = e._condensar(e.k_local_base(), e.ff_local_base())
        ix = [1, 2, 4, 5]
        Kf = Ti.T @ k6[np.ix_(ix, ix)] @ Ti
        rf = Ti.T @ ff6[ix]
        Lf = e.L - a - b
        E = e.mat.E; I = e.sec.I; A_ = e.sec.A; EI = E * I
        alfa = G = Ac = nu = None
        exacta = len(_flexibles(e)) <= 1 and not (e.release_i or e.release_j)
        if exacta:
            sg = (_flexibles(e) or [{}])[0]
            mat = sg.get("mat") or e.mat; sec = sg.get("sec") or e.sec
            E = mat.E; I = sec.I; A_ = sec.A; EI = E * I
            alfa = 0.0
            if e.timoshenko:
                nu = NU_PLACA if e.placa else getattr(mat, "nu", 0.2)
                G = E / (2 * (1 + nu)); Ac = A_ / getattr(sec, "k_corte", 1.2)
                alfa = 12 * EI / (Lf**2 * G * Ac)
            Kf = k_barra(EI, Lf, alfa)
        rotula = None
        if (not exacta and len(_flexibles(e)) <= 1 and not e.timoshenko and not (a or b)):
            # [k] modificada del profesor para barra con rótula (3EI/L³), sin condensar
            sg = (_flexibles(e) or [{}])[0]
            mat = sg.get("mat") or e.mat; sec = sg.get("sec") or e.sec
            E = mat.E; I = sec.I; A_ = sec.A; EI = E * I; alfa = 0.0
            Kf = k_rotula(EI, Lf, bool(e.release_i), bool(e.release_j))
            rotula = "ambos" if (e.release_i and e.release_j) else "i" if e.release_i else "j"
            if _invertida(e, tipo) and rotula != "ambos":
                rotula = "j" if rotula == "i" else "i"
        A4 = T @ An
        # asentamiento de apoyo: desplazamientos conocidos de los extremos {d0} = [Δi, θi, Δj, θj];
        # entra como fuerza de fijación  {r} += [k]{d0}
        si, sj = _asent(e.ni), _asent(e.nj)
        d0 = T @ np.array([nrm @ si[:2], si[2], nrm @ sj[:2], sj[2]])
        # axial (EA = ∞): las fuerzas de empotramiento axiales van directo a las traslaciones
        Rax = (ex @ tras(e.ni)) * ff6[0] + (ex @ tras(e.nj)) * ff6[3]
        if _invertida(e, tipo):
            A4 = S_INV @ A4; Kf = S_INV @ Kf @ S_INV.T; rf = S_INV @ rf; d0 = S_INV @ d0
            ni, nj = e.nj, e.ni
        else:
            ni, nj = e.ni, e.nj
        AtKA = A4.T @ Kf @ A4
        K += AtKA
        rf = rf + Kf @ d0
        R += A4.T @ rf + Rax
        dl = [f"d{numero + k + 1}" for k in range(4)]
        numero += 4
        sec = e.sec
        barras.append({
            "e": e, "A": A4, "K": Kf, "r": rf, "d0": d0, "AtKA": AtKA,
            "elem": e.nombre, "tipo": tipo, "i": ni.nombre, "j": nj.nombre,
            "xi": float(ni.x), "yi": float(ni.y), "xj": float(nj.x), "yj": float(nj.y),
            "L": float(e.L), "Lf": float(Lf), "brazo_i": a, "brazo_j": b,
            "brazo_ini": a if ni is e.ni else b, "brazo_fin": b if ni is e.ni else a,
            "E": float(E), "I": float(I), "Asec": float(A_), "EI": float(EI),
            "b": getattr(sec, "b", None), "h": getattr(sec, "h", None),
            "alfa": alfa, "G": G, "Ac": Ac, "nu": nu,
            "exacta": exacta, "rotula": rotula, "def_labels": [f"{e.nombre}·{d} {LOC[k]}" for k, d in enumerate(dl)],
            "dnum": dl,
        })

    # apoyos elásticos (resortes): kx, ky sobre las traslaciones del nudo y kg sobre su giro
    resortes = []
    for n in nudos:
        kx, ky, kg = (float(v) for v in n.resorte)
        if kx or ky:
            Tn = tras(n)
            K += Tn.T @ np.diag([kx, ky]) @ Tn
        if kg and n.id in rot:
            K[rot[n.id], rot[n.id]] += kg
        if kx or ky or kg:
            resortes.append({"nudo": n.nombre, "kx": kx, "ky": ky, "kg": kg})

    Qn = np.zeros(nD)
    for n in nudos:
        Qn += tras(n).T @ np.asarray(n.carga[:2], float)
        if n.id in rot:
            Qn[rot[n.id]] += n.carga[2]
    Q = Qn - R
    try:
        D = np.linalg.solve(K, Q) if nD else np.zeros(0)
    except np.linalg.LinAlgError:
        raise ValueError("La matriz [K] es singular: la estructura es inestable con las barras inextensibles.")
    for b in barras:
        b["d"] = b["A"] @ D
        b["q"] = b["K"] @ b["d"]
        b["qT"] = b["q"] + b["r"]

    reac, residuo = _equilibrio_nudos(nudos, barras, tras, D)
    desp = {n.id: [*(tras(n) @ D if nD else np.zeros(2)), float(D[rot[n.id]]) if n.id in rot else 0.0] for n in nudos}

    modos = []
    for k in range(nD):
        u = {}
        for n in nudos:
            Tn = tras(n)
            u[n.nombre] = [float(Tn[0, k]), float(Tn[1, k]), 0.0]
        if k >= nT:
            nid = next(i for i, v in rot.items() if v == k)
            u[nombre[nid]][2] = 1.0           # giro antihorario positivo
        modos.append(u)
    return {"labels": labels, "nT": nT, "barras": barras, "K": K, "R": R,
            "Qn": Qn, "Q": Q, "D": D, "modos": modos, "nudos": nudos, "resortes": resortes,
            "reacciones": reac, "residuo_equilibrio": residuo, "desp": desp}


S_INV4 = np.array([[0, 0, -1, 0], [0, 0, 0, 1], [-1, 0, 0, 0], [0, 1, 0, 0]], float)


def aplicar_a_estructura(est):
    """Resuelve con [A] y deja en `est` sus resultados: {D} de cada nudo, fuerzas de extremo
    (al nudo, con N del equilibrio de nudos) y reacciones. Los diagramas N/V/M se trazan
    luego por estática desde estas fuerzas y las cargas de tramo."""
    res = resolver_profesor(est)
    nl = est.n_libres
    D = np.zeros(est.n_gdl)
    for n in est.nudos:
        u = res["desp"][n.id]
        for k in range(3):
            D[n.gdl[k]] = n.asentamiento[k] if n.restriccion[k] else u[k]
    est.D = D; est.Df = D[:nl]
    for b in res["barras"]:
        e = b["e"]
        Vi, Mi, Vj, Mj = b["qT"]
        q = np.array([Vi, Mi + Vi * b["brazo_ini"], Vj, Mj - Vj * b["brazo_fin"]])   # al nudo
        if _invertida(e, b["tipo"]):
            q = S_INV4 @ q
        ff = e._condensar(e.k_local_base(), e.ff_local_base())[1]
        est.fuerzas_elem[e.id] = np.array([-b["N"] + ff[0], q[0], q[1], b["N"] + ff[3], q[2], q[3]])
    R = np.zeros(est.n_gdl - nl)
    por_nombre = {r["nudo"]: r for r in res["reacciones"]}
    for n in est.nudos:
        r = por_nombre.get(n.nombre)
        for k, c in enumerate(("Rx", "Ry", "M")):
            if n.restriccion[k] and r is not None:
                R[n.gdl[k] - nl] = r[c]
    est.R = R
    est.resultado_profesor = res
    return res


def _equilibrio_nudos(nudos, barras, tras, D):
    """Fuerza normal N de cada barra y reacciones de apoyo por EQUILIBRIO DE NUDOS
    (como a mano): con EA = ∞ el método no da N; se despeja de ΣFx = ΣFy = 0 en cada
    nudo, con los cortantes y momentos {q} ya conocidos. ΣM da la reacción de momento."""
    idx = {n.id: k for k, n in enumerate(nudos)}
    incog = []                                    # ("N", barra) | ("R", nudo, gdl)
    for k, b in enumerate(barras):
        incog.append(("N", k))
    for n in nudos:
        for g in range(3):
            if n.restriccion[g]:
                incog.append(("R", n.id, g))
    col = {u: c for c, u in enumerate(incog)}
    M = np.zeros((3 * len(nudos), len(incog)))
    rhs = np.zeros(3 * len(nudos))
    for n in nudos:                               # cargas y resortes: fuerzas externas conocidas
        f = np.asarray(n.carga, float).copy()
        u = tras(n) @ D if len(D) else np.zeros(2)
        f[:2] -= np.asarray(n.resorte[:2], float) * u
        rhs[3 * idx[n.id]: 3 * idx[n.id] + 3] -= f
    for k, b in enumerate(barras):
        e = b["e"]
        xi, yi, xj, yj = b["xi"], b["yi"], b["xj"], b["yj"]
        L = np.hypot(xj - xi, yj - yi)
        ex = np.array([xj - xi, yj - yi]) / L; nr = np.array([-ex[1], ex[0]])
        ii = e.nj if _invertida(e, b["tipo"]) else e.ni
        jj = e.ni if ii is e.nj else e.nj
        Vi, Mi, Vj, Mj = b["qT"]
        # con brazo rígido, {q} está en la cara: al nudo se lleva con [T]ᵀ (M + V·a)
        Mi = Mi + Vi * b["brazo_ini"]; Mj = Mj - Vj * b["brazo_fin"]
        exm = np.array([e.cos, e.sin])            # axial de empotramiento (sentido del modelo)
        ff = e._condensar(e.k_local_base(), e.ff_local_base())[1]
        for nd, V, Mo, s, fa in ((ii, Vi, Mi, -1.0, None), (jj, Vj, Mj, 1.0, None)):
            r = 3 * idx[nd.id]
            # fuerza que la barra recibe en ese extremo = la que el nudo le da: va al nudo con −
            M[r:r + 2, col[("N", k)]] -= s * ex
            rhs[r:r + 2] += V * nr
            rhs[r + 2] += Mo
        rhs[3 * idx[e.ni.id]: 3 * idx[e.ni.id] + 2] += ff[0] * exm
        rhs[3 * idx[e.nj.id]: 3 * idx[e.nj.id] + 2] += ff[3] * exm
    for n in nudos:
        for g in range(3):
            if n.restriccion[g]:
                M[3 * idx[n.id] + g, col[("R", n.id, g)]] = 1.0
    # Σ(fuerzas de barra sobre el nudo) + cargas + reacciones = 0
    #   −(V·n + N·(±ex) + ff) + carga + R = 0  →  M·x = rhs
    x = np.linalg.lstsq(M, rhs, rcond=None)[0]
    residuo = float(np.max(np.abs(M @ x - rhs))) if len(rhs) else 0.0
    for k, b in enumerate(barras):
        b["N"] = float(x[col[("N", k)]])          # tracción +
    reac = []
    for n in nudos:
        if any(n.restriccion):
            reac.append({"nudo": n.nombre, **{c: (float(x[col[("R", n.id, g)]]) if n.restriccion[g] else None)
                                             for g, c in enumerate(("Rx", "Ry", "M"))}})
    return reac, residuo


# ------------------------------------------------------------------------------
#  Salida para la API (reproductor paso a paso)
# ------------------------------------------------------------------------------
def _f(x):
    return None if x is None else float(x)


def formula_k(b):
    """Texto con las fórmulas de EI (y α, G, Ac en placas) reemplazadas."""
    t = []
    if b["b"] and b["h"]:
        t.append(f"I = b·h³/12 = {b['b']:.3g}·{b['h']:.3g}³/12 = {b['I']:.6g} m⁴")
        t.append(f"EI = E·I = {b['E']:.6g} × {b['I']:.6g} = {b['EI']:.6g} tonf·m²")
    else:
        t.append(f"EI = E·I = {b['E']:.6g} × {b['I']:.6g} = {b['EI']:.6g} tonf·m²")
    if b["brazo_ini"] or b["brazo_fin"]:
        t.append(f"Brazo rígido: {b['brazo_ini']:.3g} m (i) y {b['brazo_fin']:.3g} m (j) → L flexible = {b['Lf']:.4g} m")
    if b["G"]:
        nu = b["nu"]
        t.append(f"G = E / 2(1+ν) = {b['E']:.6g} / 2(1+{nu:g}) = {b['G']:.6g} tonf/m²")
        if b["b"] and b["h"]:
            t.append(f"Ac = 5/6·b·h = 5/6·{b['b']:.3g}·{b['h']:.3g} = {b['Ac']:.6g} m²")
        else:
            t.append(f"Ac = 5/6·A = {b['Ac']:.6g} m²")
        t.append(f"α = 12EI / (L²·G·Ac) = 12·{b['EI']:.6g} / ({b['Lf']:.4g}²·{b['G']:.6g}·{b['Ac']:.6g}) = {b['alfa']:.4f}")
    elif b.get("rotula"):
        lado = {"i": "en i", "j": "en j", "ambos": "en ambos extremos"}[b["rotula"]]
        t.append(f"Rótula {lado}: [k] modificada = 3EI/L³ = 3·{b['EI']:.6g}/{b['Lf']:.4g}³"
                 if b["rotula"] != "ambos" else "Rótula en ambos extremos: [k] = 0 (solo transmite cortante isostático)")
    elif b["exacta"]:
        t.append("α = 0 (se desprecia la deformación por corte)")
    else:
        t.append("Barra con tramos o rótulas: [k] por condensación de sus tramos")
    return t


def a_api(res):
    """Datos para el reproductor. [Aᵢ] y [Aᵢ]ᵀ[kᵢ][Aᵢ] van compactos: solo las
    columnas (GDL globales) en las que la barra participa (Aidx)."""
    labels = res["labels"]; nD = len(labels)
    out = []
    for b in res["barras"]:
        idx = [c for c in range(nD) if np.any(np.abs(b["A"][:, c]) > 1e-12)]
        out.append({k: b[k] for k in ("elem", "tipo", "i", "j", "xi", "yi", "xj", "yj",
                                       "def_labels", "dnum", "exacta")}
                   | {k: _f(b[k]) for k in ("L", "Lf", "E", "I", "EI", "alfa", "G", "Ac", "brazo_ini", "brazo_fin")}
                   | {"b": _f(b["b"]), "h": _f(b["h"]), "formula": formula_k(b),
                      "Aidx": idx, "Asub": b["A"][:, idx].tolist(),
                      "AtKAsub": b["AtKA"][np.ix_(idx, idx)].tolist(),
                      "K": b["K"].tolist(), "r": b["r"].tolist(), "d": b["d"].tolist(),
                      "q": b["q"].tolist(), "qT": b["qT"].tolist(), "N": b.get("N")})
    def_labels = [l for b in out for l in b["def_labels"]]
    # [A] completa solo en modelos pequeños (en los grandes se ve por barra)
    A_full = np.vstack([b["A"] for b in res["barras"]]).tolist() if res["barras"] and nD <= 40 else None
    nudos = [{"nombre": n.nombre, "x": float(n.x), "y": float(n.y), "restr": list(n.restriccion)} for n in res["nudos"]]
    K, R, Qn, Q, D = (res[k].tolist() for k in ("K", "R", "Qn", "Q", "D"))
    return {"ok": True, "n_gdl": nD, "labels": labels, "def_labels": def_labels, "A": A_full,
            "K": K, "R": R, "Qn": Qn, "Q": Q, "D": D, "barras": out, "nudos": nudos,
            "modos": res["modos"], "general": True, "matrices4": True,
            "reacciones": res["reacciones"], "residuo_equilibrio": res["residuo_equilibrio"],
            "pasos": _pasos(labels, def_labels, out, A_full, K, Qn, R, Q, D) + [
                {"n": 13, "id": "reacciones", "titulo": "Fuerza normal y reacciones por equilibrio de nudos",
                 "desc": "Con EA = ∞ el método no da N: se despeja de ΣFx = ΣFy = 0 en cada nudo con los cortantes {q} ya conocidos; ΣM da el momento de apoyo.",
                 "barras": [{"elem": b["elem"], "N": b["N"]} for b in out], "reacciones": res["reacciones"]}]}


def _pasos(labels, def_labels, barras, A, K, Qn, R, Q, D):
    P = []
    sub = lambda keys: [{k: b[k] for k in keys} for b in barras]
    P.append({"n": 0, "id": "activar", "titulo": "Activación de GDL sobre el pórtico",
              "desc": "Cada grado de libertad global se activa uno por uno. Las barras que lo contienen se iluminan: así se arma la columna de [A].",
              "labels": labels, "barras": sub(["elem", "tipo", "Aidx", "Asub", "xi", "yi", "xj", "yj"])})
    P.append({"n": 1, "id": "coords", "titulo": "Sistemas de coordenadas Q–D (global) y q–d (local)",
              "desc": "GDL globales {D}: desplazamientos laterales y giros de nudo. GDL locales: 4 por barra (Δ y θ en cada extremo), numerados primero en columnas y placas (de abajo hacia arriba, de izquierda a derecha) y luego en vigas.",
              "labels": labels, "def_labels": def_labels})
    P.append({"n": 2, "id": "A", "titulo": "Matriz de compatibilidad [A]",
              "desc": "Para cada barra, {dᵢ} = [Aᵢ]{D}: 4 filas (Δi, θi, Δj, θj) y una columna por GDL global. Un brazo rígido de longitud a suma a·θ al desplazamiento del extremo.",
              "rows": def_labels, "cols": labels, "A": A, "barras": sub(["elem", "tipo", "Aidx", "Asub", "def_labels"])})
    P.append({"n": 3, "id": "Ki", "titulo": "Rigidez de barra [kᵢ] (4×4)",
              "desc": "[k] = EI/(L(1+α))·[12/L², 6/L, −12/L², 6/L; 6/L, 4+α, −6/L, 2−α; …]. En vigas y columnas α = 0; en placas α = 12EI/(L²·G·Ac).",
              "barras": sub(["elem", "tipo", "K", "EI", "L", "Lf", "alfa", "formula"])})
    P.append({"n": 4, "id": "AtKA", "titulo": "Aporte de cada barra  [Aᵢ]ᵀ[kᵢ][Aᵢ]",
              "desc": "Cada barra aporta su rigidez a la estructura.", "cols": labels,
              "barras": sub(["elem", "Aidx", "AtKAsub"])})
    P.append({"n": 4.5, "id": "ensamble", "titulo": "Ensamblaje barra a barra en [K]",
              "desc": "Cada barra suma su aporte [Aᵢ]ᵀ[kᵢ][Aᵢ] a la matriz global.",
              "rows": labels, "cols": labels, "K": K, "barras": sub(["elem", "Aidx", "AtKAsub", "def_labels"])})
    P.append({"n": 5, "id": "K", "titulo": "Rigidez de la estructura [K] = Σ[Aᵢ]ᵀ[kᵢ][Aᵢ]",
              "desc": "Suma de los aportes; matriz simétrica de orden nGDL.", "rows": labels, "cols": labels, "K": K})
    P.append({"n": 6, "id": "r", "titulo": "Fuerzas de empotramiento {rᵢ}",
              "desc": "Cortantes y momentos de empotramiento perfecto por las cargas en las barras (antihorario +).",
              "barras": sub(["elem", "r", "def_labels"])})
    P.append({"n": 7, "id": "R", "titulo": "Vector de fijación {R} = Σ[Aᵢ]ᵀ{rᵢ}",
              "desc": "Traslada las fuerzas de empotramiento a los GDL globales.", "labels": labels, "R": R})
    P.append({"n": 8, "id": "Q", "titulo": "Vector de cargas {Q} = {Q}nudos − {R}",
              "desc": "Cargas nodales directas menos el vector de fijación.", "labels": labels, "Qn": Qn, "R": R, "Q": Q})
    P.append({"n": 9, "id": "D", "titulo": "Solución  {D} = [K]⁻¹{Q}",
              "desc": "Desplazamientos y giros de la estructura.", "labels": labels, "D": D})
    P.append({"n": 10, "id": "d", "titulo": "Desplazamientos de extremo {dᵢ} = [Aᵢ]{D}",
              "desc": "Se recuperan los 4 desplazamientos locales de cada barra.", "barras": sub(["elem", "d"])})
    P.append({"n": 11, "id": "q", "titulo": "Fuerzas complementarias {qᵢ} = [kᵢ]{dᵢ}",
              "desc": "Fuerzas de extremo del estado complementario.", "barras": sub(["elem", "q"])})
    P.append({"n": 12, "id": "qT", "titulo": "Fuerzas totales {qᵢ} = [kᵢ]{dᵢ} + {rᵢ}",
              "desc": "Se suma el estado primario (empotramiento): cortantes y momentos de extremo con los que se trazan el DMF y el DFC.",
              "barras": sub(["elem", "qT"])})
    return P


# ------------------------------------------------------------------------------
#  Memoria de cálculo (texto) con el método del profesor
# ------------------------------------------------------------------------------
def _mat_txt(M, filas=None, cols=None, w=13, dec=4):
    M = np.atleast_2d(np.asarray(M, float))
    out = []
    if cols is not None:
        out.append(" " * 14 + "".join(f"{c:>{w}}" for c in cols))
    for r, fila in enumerate(M):
        cab = f"{filas[r]:<14}" if filas is not None else " " * 14
        out.append(cab + "".join(f"{(0.0 if abs(v) < 1e-12 else v):>{w}.{dec}f}" for v in fila))
    return "\n".join(out)


def memoria_profesor(res, nombre="Pórtico", dec=4):
    labels = res["labels"]; nD = len(labels)
    DL = [f"D{k+1}" for k in range(nD)]
    barras = res["barras"]
    L = []
    P = L.append

    def tit(t):
        P(""); P("=" * 78); P("  " + t); P("=" * 78)

    P("MEMORIA DE CÁLCULO — MÉTODO SISTEMATIZADO DE RIGIDEZ (matriz [A], barras 4×4)")
    P(f"Estructura: {nombre}")
    P("Unidades: tonf, m, rad. Giros y momentos antihorarios positivos (horario negativo).")
    P("Se desprecia la deformación axial (EA = ∞). Placas con deformación por corte.")

    tit("PASO 1. Sistemas de coordenadas Q–D (global) y q–d (local)")
    P(f"GDL globales ({nD}):")
    for k, l in enumerate(labels):
        P(f"  {l}")
    P("")
    P("GDL locales por barra (Δ = desplazamiento perpendicular, θ = giro):")
    for b in barras:
        nums = ", ".join(f"{d}={LOC[k]}" for k, d in enumerate(b["dnum"]))
        P(f"  {b['elem']:<8} {b['tipo']:<9} {b['i']} → {b['j']}   {nums}")

    tit("PASO 2. Matriz de compatibilidad [A]   {d} = [A]{D}")
    if nD <= 12:
        filas = [f"{b['elem']}·{d}" for b in barras for d in b["dnum"]]
        P(_mat_txt(np.vstack([b["A"] for b in barras]), filas, DL, w=9, dec=3))
    else:
        P(f"(Con {nD} GDL se muestra cada [Ai] solo con las columnas que no son cero.)")
        for b in barras:
            nz = [c for c in range(nD) if np.any(np.abs(b["A"][:, c]) > 1e-12)]
            P(f"\n[A] {b['elem']}:")
            P(_mat_txt(b["A"][:, nz], [f"{d} {LOC[k]}" for k, d in enumerate(b["dnum"])], [DL[c] for c in nz], w=9, dec=3))

    tit("PASO 3. Rigidez de cada barra [k] (4×4)")
    P("[k] = EI/(L(1+α)) · [ 12/L²  6/L  −12/L²  6/L ;  6/L  4+α  −6/L  2−α ;")
    P("                       −12/L² −6/L  12/L²  −6/L ;  6/L  2−α  −6/L  4+α ]")
    for b in barras:
        P(f"\n{b['elem']} ({b['tipo']}), L = {b['Lf']:.4f} m")
        for t in formula_k(b):
            P("  " + t)
        P(_mat_txt(b["K"], [f"{d}" for d in b["dnum"]], b["dnum"], dec=dec))

    tit("PASO 4. Aporte de cada barra [A]ᵀ[k][A]")
    for b in barras:
        nz = [c for c in range(nD) if np.any(np.abs(b["AtKA"][:, c]) > 1e-12)]
        P(f"\n{b['elem']}:")
        if nz:
            P(_mat_txt(b["AtKA"][np.ix_(nz, nz)], [DL[c] for c in nz], [DL[c] for c in nz], dec=dec))
        else:
            P("  (no aporta: sus extremos no tienen GDL libres)")

    tit("PASO 5. Matriz de rigidez de la estructura [K] = Σ [A]ᵀ[k][A]")
    P(_mat_txt(res["K"], DL, DL, dec=dec))

    tit("PASO 6. Cargas en los nudos {Q}nudos")
    P(_mat_txt(res["Qn"][:, None], DL, ["Q"], dec=dec))

    tit("PASO 7. Fuerzas de empotramiento de cada barra {r}")
    for b in barras:
        P(f"\n{b['elem']}:")
        P(_mat_txt(b["r"][:, None], [f"{d} {LOC[k]}" for k, d in enumerate(b["dnum"])], ["r"], dec=dec))

    tit("PASO 8. Vector de fijación {R} = Σ [A]ᵀ{r}")
    P(_mat_txt(res["R"][:, None], DL, ["R"], dec=dec))

    tit("PASO 9. Vector de carga total {Q} = {Q}nudos − {R}")
    P(_mat_txt(res["Q"][:, None], DL, ["Q"], dec=dec))

    tit("PASO 10. Desplazamientos {D} = [K]⁻¹{Q}")
    P(_mat_txt(res["D"][:, None], labels, ["D"], w=16, dec=7))

    tit("PASO 11. Desplazamientos de extremo de cada barra {d} = [A]{D}")
    for b in barras:
        P(f"\n{b['elem']}:")
        P(_mat_txt(b["d"][:, None], [f"{d} {LOC[k]}" for k, d in enumerate(b["dnum"])], ["d"], w=16, dec=7))

    tit("PASO 12. Fuerzas complementarias {q} = [k]{d}")
    for b in barras:
        P(f"\n{b['elem']}:")
        P(_mat_txt(b["q"][:, None], [f"{d} {LOC[k]}" for k, d in enumerate(b["dnum"])], ["q"], dec=dec))

    tit("PASO 13. Fuerzas totales de extremo {q}total = {q} + {r}")
    P(f"{'Barra':<10}{'V i':>12}{'M i':>12}{'V j':>12}{'M j':>12}")
    for b in barras:
        P(f"{b['elem']:<10}" + "".join(f"{v:>12.{dec}f}" for v in b["qT"]))
    P("")
    P("Con estas fuerzas y las cargas de cada tramo se trazan el DMF y el DFC.")
    return "\n".join(L) + "\n"
