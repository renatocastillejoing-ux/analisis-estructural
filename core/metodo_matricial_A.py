# -*- coding: utf-8 -*-
"""
================================================================================
  MÉTODO MATRICIAL DE RIGIDEZ POR MATRIZ DE COMPATIBILIDAD [A]
  (metodología del profesor — Análisis II)
================================================================================
  Incógnitas {D}: giros de nudo + desplazamientos laterales por piso.
  Se DESPRECIAN las deformaciones axiales (hipótesis del método a mano).

      {d} = [A]{D}        (compatibilidad: deformaciones de barra ← GDL)
      [k]  block-diag      (rigidez rotacional de cada barra: (EI/L)[[4,2],[2,4]])
      [K] = [A]ᵀ[k][A]     (rigidez de la estructura)
      {P} = {Pext} − [A]ᵀ{FEM}
      [K]{D} = {P}  →  {D}
      {M} = [k][A]{D} + {FEM}   (momentos de extremo de cada barra)

  v1: pórticos ORTOGONALES (columnas verticales, vigas horizontales), que es el
  caso de EJ1/EJ2 y de los pórticos de la torre. Da los mismos resultados que el
  método directo de rigidez (con axial despreciada); la diferencia es que aquí
  se construye explícitamente la matriz [A], como en la pizarra.

  Además de resolver, emite `pasos`: la secuencia ordenada de la resolución para
  el reproductor animado del front.
================================================================================
"""
import numpy as np


def _es_columna(e):
    return abs(e.cos) < 1e-6          # barra vertical


def resolver_metodo_A(est, tol=1e-6):
    """Resuelve `est` (una Estructura ya construida) por el método [A].
    Devuelve un dict JSON-serializable con A, k, K, P, D, deformaciones,
    momentos de barra y la lista de `pasos` para animar."""
    nudos = sorted(est.nudos, key=lambda n: n.id)
    elementos = est.elementos
    ys = sorted({round(n.y, 6) for n in nudos})
    base_y = ys[0]
    niveles = [y for y in ys if y > base_y + tol]

    # ---------- numeración de GDL: primero giros, luego desplaz. laterales -----
    rot_dof = {}                       # nudo.id -> índice de GDL
    sway_dof = {}                      # cota y   -> índice de GDL
    labels = []
    idx = 0
    for n in nudos:
        if n.restriccion[2] == 0:      # giro libre
            rot_dof[n.id] = idx
            labels.append(f"θ_{n.nombre}")
            idx += 1
    for y in niveles:
        nods = [n for n in nudos if abs(n.y - y) < 1e-6]
        if any(n.restriccion[0] == 0 for n in nods):   # nivel con traslación libre
            sway_dof[round(y, 6)] = idx
            labels.append(f"Δ_{y:g}")
            idx += 1
    nD = idx

    # ---------- matriz [A], rigidez de barra [k] y FEM -------------------------
    nd = 2 * len(elementos)
    A = np.zeros((nd, nD))
    k = np.zeros((nd, nd))
    FEM = np.zeros(nd)
    def_labels = []
    barras = []
    for m, e in enumerate(elementos):
        ri, rj = 2 * m, 2 * m + 1
        L = e.L
        EI = e.mat.E * e.sec.I
        k[ri:rj + 1, ri:rj + 1] = (EI / L) * np.array([[4.0, 2.0], [2.0, 4.0]])
        def_labels += [f"d{ri+1}({e.nombre}·i)", f"d{rj+1}({e.nombre}·j)"]
        # giros de nudo
        if e.ni.id in rot_dof:
            A[ri, rot_dof[e.ni.id]] += 1.0
        if e.nj.id in rot_dof:
            A[rj, rot_dof[e.nj.id]] += 1.0
        # rotación de cuerda ψ por desplazamiento lateral de piso.
        # ψ = −sinθ·(Δ_j − Δ_i)/L  (orientada según el eje i→j de la barra).
        # φ = θ − ψ  →  coef(Δ_i)= −s/L ,  coef(Δ_j)= +s/L  en ambas filas.
        # Para vigas horizontales s=0 (sin aporte); vale para columnas e inclinadas.
        s = e.sin
        yi = round(e.ni.y, 6)
        yj = round(e.nj.y, 6)
        if yi in sway_dof:
            A[ri, sway_dof[yi]] += -s / L
            A[rj, sway_dof[yi]] += -s / L
        if yj in sway_dof:
            A[ri, sway_dof[yj]] += +s / L
            A[rj, sway_dof[yj]] += +s / L
        # momentos de empotramiento perfecto (de las cargas del elemento)
        ff = e.ff_local_base()         # [Ni,Vi,Mi,Nj,Vj,Mj] local
        FEM[ri] = ff[2]
        FEM[rj] = ff[5]
        barras.append({"elem": e.nombre, "L": float(L), "EI": float(EI),
                       "FEM_i": float(ff[2]), "FEM_j": float(ff[5])})

    K = A.T @ k @ A

    # ---------- vector de cargas {P} = Pext − Aᵀ FEM ---------------------------
    Pext = np.zeros(nD)
    for n in nudos:
        if n.id in rot_dof:
            Pext[rot_dof[n.id]] += n.carga[2]             # momento aplicado
    for y in niveles:
        yy = round(y, 6)
        if yy in sway_dof:
            Pext[sway_dof[yy]] += sum(n.carga[0] for n in nudos
                                      if abs(n.y - y) < 1e-6)   # fuerza lateral
    P = Pext - A.T @ FEM

    # ---------- solución -------------------------------------------------------
    D = np.linalg.solve(K, P) if nD else np.zeros(0)
    d = A @ D
    M = k @ d + FEM

    # momentos de extremo por elemento
    momentos = []
    for m, e in enumerate(elementos):
        momentos.append({"elem": e.nombre,
                         "Mi": float(M[2*m]), "Mj": float(M[2*m+1])})

    pasos = _construir_pasos(labels, def_labels, barras, A, k, K, Pext, FEM, P,
                             D, d, M, elementos)

    return {
        "ok": True,
        "n_gdl": int(nD),
        "gdl_labels": labels,
        "def_labels": def_labels,
        "A": A.tolist(), "k": k.tolist(), "K": K.tolist(),
        "FEM": FEM.tolist(), "Pext": Pext.tolist(), "P": P.tolist(),
        "D": D.tolist(), "d": d.tolist(), "M": M.tolist(),
        "momentos": momentos,
        "pasos": pasos,
    }


def _construir_pasos(labels, def_labels, barras, A, k, K, Pext, FEM, P, D, d, M,
                     elementos):
    """Secuencia ordenada para el reproductor animado."""
    pasos = []
    pasos.append({"id": "gdl", "titulo": "1. Grados de libertad {D}",
                  "desc": "Se numeran los giros de nudo y los desplazamientos "
                          "laterales por piso (se desprecia la deformación axial).",
                  "labels": labels})
    pasos.append({"id": "A", "titulo": "2. Matriz de compatibilidad [A]",
                  "desc": "Cada deformación de barra {d} en función de los GDL "
                          "{D}:  {d} = [A]{D}. Fila por barra (giros ±1, cuerda ∓1/L).",
                  "rows": def_labels, "cols": labels, "M": A.tolist()})
    pasos.append({"id": "k", "titulo": "3. Rigidez de barra [k]",
                  "desc": "Bloques (EI/L)·[[4,2],[2,4]] por barra (diagonal).",
                  "M": k.tolist(), "barras": barras})
    pasos.append({"id": "K", "titulo": "4. Rigidez de la estructura [K]=[A]ᵀ[k][A]",
                  "desc": "Producto triple; matriz cuadrada de orden nGDL.",
                  "rows": labels, "cols": labels, "M": K.tolist()})
    pasos.append({"id": "P", "titulo": "5. Vector de cargas {P}",
                  "desc": "{P} = {Pext} − [A]ᵀ{FEM}  (cargas nodales menos "
                          "empotramientos trasladados).",
                  "labels": labels, "Pext": Pext.tolist(), "P": P.tolist()})
    pasos.append({"id": "D", "titulo": "6. Solución {D}=[K]⁻¹{P}",
                  "desc": "Desplazamientos y giros de la estructura.",
                  "labels": labels, "D": D.tolist()})
    pasos.append({"id": "M", "titulo": "7. Momentos de barra {M}=[k][A]{D}+{FEM}",
                  "desc": "Momentos en los extremos de cada barra.",
                  "momentos": [{"elem": e.nombre, "Mi": float(M[2*i]),
                                "Mj": float(M[2*i+1])}
                               for i, e in enumerate(elementos)]})
    return pasos


# ==============================================================================
#  MÉTODO SISTEMATIZADO DE RIGIDEZ (formulación EXACTA del profesor)
#  Vigas: local [θi, θj], Kv=(EI/L)[[4,2],[2,4]]
#  Columnas empotradas en base: local [Δtop, θtop],
#      Kc=[[12EI/L³,-6EI/L²],[-6EI/L²,4EI/L]]
#  GDL (Q-D): primero desplazamientos laterales por piso, luego giros de nudo.
# ==============================================================================
def resolver_sistematizado(est, tol=1e-6):
    if any(abs(e.sin) > 1e-6 and abs(e.cos) > 1e-6 for e in est.elementos):
        return resolver_sistematizado_general(est, tol)
    nudos = sorted(est.nudos, key=lambda n: n.id)
    elementos = est.elementos
    ys = sorted({round(n.y, 6) for n in nudos})
    base_y = ys[0]
    sway = {}      # cota y -> idx GDL (desplazamiento lateral del piso)
    rot = {}       # nudo.id -> idx GDL (giro)
    labels = []
    idx = 0
    for y in [yy for yy in ys if yy > base_y + tol]:
        nods = [n for n in nudos if abs(n.y - y) < 1e-6]
        if any(n.restriccion[0] == 0 for n in nods):
            sway[round(y, 6)] = idx; labels.append(f"D{idx+1}(Δ y={y:g})"); idx += 1
    for n in nudos:
        if n.restriccion[2] == 0:
            rot[n.id] = idx; labels.append(f"D{idx+1}(θ {n.nombre})"); idx += 1
    nD = idx

    barras = []
    for e in elementos:
        L = e.L; EI = e.mat.E * e.sec.I
        Ai = np.zeros((2, nD))
        ff = e.ff_local_base()
        if abs(e.sin) < 1e-6:                       # VIGA (horizontal)
            Ki = (EI / L) * np.array([[4., 2.], [2., 4.]])
            if e.ni.id in rot: Ai[0, rot[e.ni.id]] = 1.0
            if e.nj.id in rot: Ai[1, rot[e.nj.id]] = 1.0
            # FEM en la convención del profesor (UDL: [-wL²/12, +wL²/12]);
            # es el opuesto del signo interno de ff_local_base.
            ri = -np.array([ff[2], ff[5]]); tipo = "viga"
        elif abs(e.cos) < 1e-6:                     # COLUMNA (vertical)
            # Caso general (multi-piso): la cuerda de la columna depende del
            # desplazamiento del piso de arriba Δ_top y del de abajo Δ_bot.
            # Sistema local (θ_i, θ_j, Δ_rel), Δ_rel = Δ_top − Δ_bot.
            # Si la base está empotrada, Δ_bot = 0 (caso EJ1/EJ2 y pórticos de 1 piso).
            top, bot = (e.ni, e.nj) if e.ni.y > e.nj.y else (e.nj, e.ni)
            yt = round(top.y, 6); yb = round(bot.y, 6)
            # columna con cargas propias → forma general ψ (lleva sus FEM)
            col_cargada = len(e.cargas) > 0
            if all(bot.restriccion) and not col_cargada:
                # Base empotrada (1 piso / EJ1-EJ2): forma reducida de la pizarra
                Ki = np.array([[12*EI/L**3, -6*EI/L**2], [-6*EI/L**2, 4*EI/L]])
                if yt in sway: Ai[0, sway[yt]] = 1.0
                if top.id in rot: Ai[1, rot[top.id]] = 1.0
                ri = np.array([0.0, 0.0]); tipo = "columna"
            else:
                # Columna de piso intermedio (base sobre un piso que se mueve).
                # Dos deformaciones de extremo φ = θ − ψ, con la rotación de cuerda
                # ψ = (Δ_j − Δ_i)/L en AMBAS filas. Signo validado contra el motor
                # directo en pórtico de 2 pisos (magnitudes exactas; signo global =
                # convención del profesor, igual que en las vigas).
                Ki = (EI / L) * np.array([[4.0, 2.0], [2.0, 4.0]])
                if e.ni.id in rot: Ai[0, rot[e.ni.id]] = 1.0
                if e.nj.id in rot: Ai[1, rot[e.nj.id]] = 1.0
                yi_, yj_ = round(e.ni.y, 6), round(e.nj.y, 6)
                if yi_ in sway: Ai[:, sway[yi_]] += e.sin / L
                if yj_ in sway: Ai[:, sway[yj_]] -= e.sin / L
                ri = -np.array([ff[2], ff[5]]); tipo = "columna_piso"
        else:
            raise NotImplementedError("barra inclinada: pendiente v2")
        barras.append({"e": e, "Ai": Ai, "Ki": Ki, "ri": ri, "tipo": tipo})

    K = np.zeros((nD, nD)); R = np.zeros(nD)
    for b in barras:
        K += b["Ai"].T @ b["Ki"] @ b["Ai"]
        R += b["Ai"].T @ b["ri"]
    Qn = np.zeros(nD)
    for n in nudos:
        if n.id in rot: Qn[rot[n.id]] += n.carga[2]
    for y, di in sway.items():
        Qn[di] += sum(n.carga[0] for n in nudos if abs(n.y - y) < 1e-6)
    Q = Qn - R
    D = np.linalg.solve(K, Q) if nD else np.zeros(0)

    out_barras = []
    def_labels = []
    A_rows = []
    for b in barras:
        e_ = b["e"]
        if b["tipo"] == "columna":
            # Momentos de extremo de la columna en formulación ψ (φ = θ − ψ):
            # garantiza que q sean MOMENTOS de extremo aunque la columna
            # empotrada use la forma reducida Kc (cuyo 1er componente es cortante
            # cuando hay desplazamiento). Mismo resultado físico, misma convención.
            Ap = np.zeros((2, nD))
            if e_.ni.id in rot: Ap[0, rot[e_.ni.id]] = 1.0
            if e_.nj.id in rot: Ap[1, rot[e_.nj.id]] = 1.0
            yi_, yj_ = round(e_.ni.y, 6), round(e_.nj.y, 6)
            if yi_ in sway: Ap[:, sway[yi_]] += e_.sin / e_.L
            if yj_ in sway: Ap[:, sway[yj_]] -= e_.sin / e_.L
            EI_ = e_.mat.E * e_.sec.I; L_ = e_.L
            Kv_ = (EI_ / L_) * np.array([[4.0, 2.0], [2.0, 4.0]])
            d = Ap @ D
            q = Kv_ @ d
        else:
            d = b["Ai"] @ D
            q = b["Ki"] @ d
        qT = q + b["ri"]
        e = b["e"]
        AtKA = (b["Ai"].T @ b["Ki"] @ b["Ai"])
        dl = [f"{e.nombre}·i", f"{e.nombre}·j"]
        def_labels += dl
        A_rows.append(b["Ai"])
        out_barras.append({"elem": e.nombre, "tipo": b["tipo"],
                           "i": e.ni.nombre, "j": e.nj.nombre,
                           "xi": float(e.ni.x), "yi": float(e.ni.y),
                           "xj": float(e.nj.x), "yj": float(e.nj.y),
                           "L": float(e.L), "EI": float(e.mat.E * e.sec.I),
                           "def_labels": dl,
                           "A": b["Ai"].tolist(), "K": b["Ki"].tolist(),
                           "AtKA": AtKA.tolist(),
                           "r": b["ri"].tolist(), "d": d.tolist(),
                           "q": q.tolist(), "qT": qT.tolist()})
    A_full = np.vstack(A_rows).tolist() if A_rows else []
    nudos_out = [{"nombre": n.nombre, "x": float(n.x), "y": float(n.y),
                  "restr": list(n.restriccion)} for n in nudos]
    pasos = _pasos_sistematizado(labels, def_labels, out_barras,
                                 A_full, K.tolist(), Qn.tolist(), R.tolist(),
                                 Q.tolist(), D.tolist())
    return {"ok": True, "n_gdl": int(nD), "labels": labels,
            "def_labels": def_labels, "A": A_full,
            "K": K.tolist(), "R": R.tolist(), "Qn": Qn.tolist(),
            "Q": Q.tolist(), "D": D.tolist(),
            "barras": out_barras, "nudos": nudos_out, "pasos": pasos}


def _pasos_sistematizado(labels, def_labels, barras, A, K, Qn, R, Q, D):
    """Secuencia de 13 pasos (método sistematizado) para el reproductor animado."""
    P = []
    P.append({"n": 0, "id": "activar", "titulo": "Activación de GDL sobre el pórtico",
              "desc": "Cada grado de libertad global se activa uno por uno. Las barras "
                      "que lo contienen se iluminan: así se arma la columna de [A].",
              "labels": labels, "barras": [{"elem": b["elem"], "tipo": b["tipo"],
                          "A": b["A"], "xi": b["xi"], "yi": b["yi"],
                          "xj": b["xj"], "yj": b["yj"]} for b in barras]})
    P.append({"n": 1, "id": "coords", "titulo": "Sistemas de coordenadas Q–D y q–d",
              "desc": "Se numeran los GDL globales {D} (primero desplazamientos "
                      "laterales por piso, luego giros de nudo) y las deformaciones "
                      "de barra {d}.", "labels": labels, "def_labels": def_labels})
    P.append({"n": 2, "id": "A", "titulo": "Matriz de compatibilidad [A]",
              "desc": "Para cada barra, {dᵢ} = [Aᵢ]{D}. Filas = deformaciones de "
                      "barra, columnas = GDL globales (1 donde el GDL global activa "
                      "la deformación local).",
              "rows": def_labels, "cols": labels, "A": A,
              "barras": [{"elem": b["elem"], "tipo": b["tipo"], "A": b["A"],
                          "def_labels": b["def_labels"]} for b in barras]})
    P.append({"n": 3, "id": "Ki", "titulo": "Rigidez de barra [Kᵢ] (sistema q–d)",
              "desc": "Vigas: (EI/L)·[[4,2],[2,4]]. Columnas empotradas: "
                      "[[12EI/L³,−6EI/L²],[−6EI/L²,4EI/L]].",
              "barras": [{"elem": b["elem"], "tipo": b["tipo"], "K": b["K"],
                          "EI": b["EI"], "L": b["L"]} for b in barras]})
    P.append({"n": 4, "id": "AtKA", "titulo": "Aporte de cada barra  [Aᵢ]ᵀ[Kᵢ][Aᵢ]",
              "desc": "Cada barra aporta su rigidez a la estructura.",
              "cols": labels,
              "barras": [{"elem": b["elem"], "AtKA": b["AtKA"]} for b in barras]})
    P.append({"n": 4.5, "id": "ensamble", "titulo": "Ensamblaje barra a barra en [K]",
              "desc": "Cada barra suma su aporte [Aᵢ]ᵀ[Kᵢ][Aᵢ] a la matriz global. "
                      "Las celdas se llenan una a una a medida que entra cada barra.",
              "rows": labels, "cols": labels, "K": K,
              "barras": [{"elem": b["elem"], "AtKA": b["AtKA"],
                          "def_labels": b["def_labels"]} for b in barras]})
    P.append({"n": 5, "id": "K", "titulo": "Rigidez de la estructura [K] = Σ[Aᵢ]ᵀ[Kᵢ][Aᵢ]",
              "desc": "Suma de los aportes; matriz simétrica de orden nGDL.",
              "rows": labels, "cols": labels, "K": K})
    P.append({"n": 6, "id": "r", "titulo": "Fuerzas de empotramiento {rᵢ}",
              "desc": "Momentos de empotramiento perfecto por las cargas en barras "
                      "(UDL: ∓wL²/12; puntual, triangular, etc.).",
              "barras": [{"elem": b["elem"], "r": b["r"],
                          "def_labels": b["def_labels"]} for b in barras]})
    P.append({"n": 7, "id": "R", "titulo": "Vector de fijación {R} = Σ[Aᵢ]ᵀ{rᵢ}",
              "desc": "Traslada las fuerzas de empotramiento a los GDL globales.",
              "labels": labels, "R": R})
    P.append({"n": 8, "id": "Q", "titulo": "Vector de cargas {Q} = {Q}nudos − {R}",
              "desc": "Cargas nodales directas menos el vector de fijación.",
              "labels": labels, "Qn": Qn, "R": R, "Q": Q})
    P.append({"n": 9, "id": "D", "titulo": "Solución  {D} = [K]⁻¹{Q}",
              "desc": "Desplazamientos y giros de la estructura.",
              "labels": labels, "D": D})
    P.append({"n": 10, "id": "d", "titulo": "Deformaciones de barra {dᵢ} = [Aᵢ]{D}",
              "desc": "Se recuperan las deformaciones locales de cada barra.",
              "barras": [{"elem": b["elem"], "d": b["d"]} for b in barras]})
    P.append({"n": 11, "id": "q", "titulo": "Fuerzas de barra {qᵢ} = [Kᵢ]{dᵢ}",
              "desc": "Fuerzas de extremo del estado complementario.",
              "barras": [{"elem": b["elem"], "q": b["q"]} for b in barras]})
    P.append({"n": 12, "id": "qT", "titulo": "Fuerzas totales {qᵢ} = [Kᵢ]{dᵢ} + {rᵢ}",
              "desc": "Se suma el estado primario (empotramiento). Con esto se "
                      "dibujan los diagramas DMF/DFC.",
              "barras": [{"elem": b["elem"], "qT": b["qT"]} for b in barras]})
    return P


# ==============================================================================
#  MÉTODO SISTEMATIZADO GENERAL (barras inclinadas)
#  Con las deformaciones axiales despreciadas, las traslaciones independientes
#  son el espacio nulo de las restricciones de barra inextensible:
#      (u_j − u_i)·e_x = 0   para cada barra,   u = 0 en los apoyos.
#  Cada traslación independiente es un GDL {D}; la rotación de cuerda de cada
#  barra es ψ = n·(u_j − u_i)/L con n la normal (giro +90°). Deformaciones de
#  barra: φ = θ − ψ (convención directa), [k] = (EI/L)[[4,2],[2,4]].
#  Fijación {R} por trabajo virtual de las fuerzas de empotramiento (momentos y
#  cortantes). Se presenta en la convención del profesor (giros horarios +).
# ==============================================================================
def _rref_nulo(C, tol=1e-9):
    """Base del espacio nulo por escalonamiento reducido; devuelve (N, libres)."""
    C = np.array(C, float)
    m, n = C.shape if C.size else (0, C.shape[1] if C.ndim == 2 else 0)
    A = C.copy(); piv = []; r = 0
    for c in range(n):
        if r >= m: break
        p = r + int(np.argmax(np.abs(A[r:, c]))) if m > r else r
        if abs(A[p, c]) < tol: continue
        A[[r, p]] = A[[p, r]]; A[r] /= A[r, c]
        for k in range(m):
            if k != r and abs(A[k, c]) > tol: A[k] -= A[k, c] * A[r]
        piv.append(c); r += 1
    libres = [c for c in range(n) if c not in piv]
    N = np.zeros((n, len(libres)))
    for k, f in enumerate(libres):
        N[f, k] = 1.0
        for row, pc in enumerate(piv):
            N[pc, k] = -A[row, f]
    N[np.abs(N) < 1e-12] = 0
    return N, libres


def resolver_sistematizado_general(est, tol=1e-6):
    nudos = sorted(est.nudos, key=lambda n: n.id)
    elementos = est.elementos
    for e in elementos:
        if hasattr(e, "es_segmentada") and e.es_segmentada():
            raise NotImplementedError("barras con tramos de sección variable en una estructura con barras inclinadas")
    # incógnitas de traslación (componentes libres) ordenadas de arriba hacia abajo,
    # para que los GDL libres queden en los nudos altos (como los Δ de piso)
    comp = []
    for n in sorted(nudos, key=lambda q: (-q.y, q.x)):
        for k in (0, 1):
            if n.restriccion[k] == 0: comp.append((n.id, k))
    col = {c: i for i, c in enumerate(comp)}
    filas = []
    for e in elementos:
        f = np.zeros(len(comp))
        for nd, sgn in ((e.nj, 1.0), (e.ni, -1.0)):
            if (nd.id, 0) in col: f[col[(nd.id, 0)]] += sgn * e.cos
            if (nd.id, 1) in col: f[col[(nd.id, 1)]] += sgn * e.sin
        if np.any(f): filas.append(f)
    if comp:
        N, libres = _rref_nulo(np.array(filas) if filas else np.zeros((0, len(comp))))
    else:
        N, libres = np.zeros((0, 0)), []
    nT = N.shape[1]
    nombre = {n.id: n.nombre for n in nudos}
    labels = [f"D{k+1}(Δ{'x' if comp[f][1] == 0 else 'y'} {nombre[comp[f][0]]})" for k, f in enumerate(libres)]
    rot = {}
    for n in nudos:
        if n.restriccion[2] == 0:
            rot[n.id] = len(labels); labels.append(f"D{len(labels)+1}(θ {n.nombre})")
    nD = len(labels)

    def tras(nd):
        """Matriz 2 × nD: (ux, uy) del nudo en función de {D}."""
        T = np.zeros((2, nD))
        for k in (0, 1):
            if (nd.id, k) in col: T[k, :nT] = N[col[(nd.id, k)]]
        return T

    barras, Kd, Rd = [], np.zeros((nD, nD)), np.zeros(nD)
    for e in elementos:
        L = e.L; EI = e.mat.E * e.sec.I; c, s = e.cos, e.sin
        nrm = np.array([-s, c])
        psi = nrm @ (tras(e.nj) - tras(e.ni)) / L               # 1 × nD
        Ad = np.zeros((2, nD))
        if e.ni.id in rot: Ad[0, rot[e.ni.id]] = 1.0
        if e.nj.id in rot: Ad[1, rot[e.nj.id]] = 1.0
        Ad -= psi                                               # φ = θ − ψ
        Ki = (EI / L) * np.array([[4.0, 2.0], [2.0, 4.0]])
        ff = e.ff_local_base()                                  # fuerzas de empotramiento sobre la barra
        g = lambda N_, V_: np.array([c * N_ - s * V_, s * N_ + c * V_])
        Rb = tras(e.ni).T @ g(ff[0], ff[1]) + tras(e.nj).T @ g(ff[3], ff[4])
        if e.ni.id in rot: Rb[rot[e.ni.id]] += ff[2]
        if e.nj.id in rot: Rb[rot[e.nj.id]] += ff[5]
        Kd += Ad.T @ Ki @ Ad; Rd += Rb
        tipo = "viga" if abs(s) < 1e-6 else "columna_piso" if abs(c) < 1e-6 else "inclinada"
        barras.append({"e": e, "Ad": Ad, "Ki": Ki, "ff": ff, "tipo": tipo})
    Qn = np.zeros(nD)
    for n in nudos:
        Qn += tras(n).T @ np.asarray(n.carga[:2], float)
        if n.id in rot: Qn[rot[n.id]] += n.carga[2]
    Qd = Qn - Rd
    Dd = np.linalg.solve(Kd, Qd) if nD else np.zeros(0)

    # ---- convención del profesor: giros y momentos horarios positivos ----
    Sg = np.ones(nD); Sg[nT:] = -1.0
    K = (Sg[:, None] * Kd) * Sg[None, :]; Q = Sg * Qd; R = Sg * Rd; Qn_p = Sg * Qn; D = Sg * Dd
    out_barras, def_labels, A_rows = [], [], []
    for b in barras:
        e = b["e"]
        A = -(b["Ad"] * Sg[None, :])
        r = -np.array([b["ff"][2], b["ff"][5]])
        d = A @ D
        q = b["Ki"] @ d
        qT = q + r
        dl = [f"{e.nombre}·i", f"{e.nombre}·j"]
        def_labels += dl; A_rows.append(A)
        out_barras.append({"elem": e.nombre, "tipo": b["tipo"], "i": e.ni.nombre, "j": e.nj.nombre,
                           "xi": float(e.ni.x), "yi": float(e.ni.y), "xj": float(e.nj.x), "yj": float(e.nj.y),
                           "L": float(e.L), "EI": float(e.mat.E * e.sec.I), "def_labels": dl,
                           "A": A.tolist(), "K": b["Ki"].tolist(), "AtKA": (A.T @ b["Ki"] @ A).tolist(),
                           "r": r.tolist(), "d": d.tolist(), "q": q.tolist(), "qT": qT.tolist()})
    A_full = np.vstack(A_rows).tolist() if A_rows else []
    nudos_out = [{"nombre": n.nombre, "x": float(n.x), "y": float(n.y), "restr": list(n.restriccion)} for n in nudos]
    # modos de traslación (para dibujar cada GDL en el reproductor)
    modos = []
    for k in range(nD):
        u = {}
        for n in nudos:
            T = tras(n)
            u[n.nombre] = [float(T[0, k]), float(T[1, k]), 0.0]
        if k >= nT:
            nid = next(i for i, v in rot.items() if v == k)
            u[nombre[nid]][2] = -1.0            # giro horario positivo
        modos.append(u)
    pasos = _pasos_sistematizado(labels, def_labels, out_barras, A_full, K.tolist(), Qn_p.tolist(), R.tolist(), Q.tolist(), D.tolist())
    for p in pasos:
        if p["id"] == "R":
            p["desc"] = "Con barras inclinadas, {R} se obtiene por trabajo virtual de las fuerzas de empotramiento (momentos y cortantes) sobre cada GDL."
    return {"ok": True, "n_gdl": int(nD), "labels": labels, "def_labels": def_labels, "A": A_full,
            "K": K.tolist(), "R": R.tolist(), "Qn": Qn_p.tolist(), "Q": Q.tolist(), "D": D.tolist(),
            "barras": out_barras, "nudos": nudos_out, "pasos": pasos, "modos": modos, "general": True}
