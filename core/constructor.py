# -*- coding: utf-8 -*-
"""
Construccion del modelo desde un diccionario de datos (el que envia el front)
y extraccion de resultados estructurados (para las tablas de la interfaz).
"""
import numpy as np
from core.metodo_rigidez import (Material, Seccion, Nudo, Elemento,
                                 CargaDistribuida, CargaPuntual, CargaMomento,
                                 CargaTermica, Estructura)
from core import secciones as Secc

_APOYOS = {
    "empotrado": (1, 1, 1),
    "fijo":      (1, 1, 0),
    "articulado":(1, 1, 0),
    "rodillo_y": (0, 1, 0),
    "rodillo_x": (1, 0, 0),
    "libre":     (0, 0, 0),
}


def _seccion_desde(s, conv_l=1.0):
    nombre = s["nombre"]
    modo = s.get("modo", "rect")
    def _fin(sec):
        if s.get("k_corte"):
            sec.k_corte = float(s["k_corte"])
        return sec
    if modo == "AI" or ("A" in s and "b" not in s and "tipo" not in s):
        A = float(s["A"]) * conv_l**2
        I = float(s["I"]) * conv_l**4
        return _fin(Seccion(A, I, nombre=nombre))
    if modo == "calc" and s.get("tipo"):
        dims = {k: float(v) * conv_l for k, v in s.items()
                if k not in ("nombre", "modo", "tipo", "k_corte")}
        A, I = Secc.calcular(s["tipo"], **dims)
        sec = Seccion(A, I, nombre=nombre)
        sec.tipo_seccion = s["tipo"]
        return _fin(sec)
    b = float(s["b"]) * conv_l
    h = float(s["h"]) * conv_l
    return _fin(Seccion.rectangular(b, h, nombre=nombre))


def construir(datos):
    # ------------------------------------------------------------------
    #  UNIDADES. El método de rigidez es agnóstico a unidades: si todas
    #  las magnitudes (E, cargas, longitudes) están en un mismo sistema
    #  consistente (p. ej. kN, m), los resultados salen en ese sistema.
    #  Por eso NO se reescalan internamente las entradas; el sistema solo
    #  fija las ETIQUETAS y la fórmula empírica f'c→E (que está en kgf/cm²).
    #  Factores hacia la base tonf·m (usados solo para f'c→E):
    # ------------------------------------------------------------------
    FORCE_FACTORS = {
        "tonf": 1.0, "kgf": 1/1000, "N": 1/9810, "kN": 1/9.81,
        "MN": 1/0.00981, "GN": 1/0.00000981, "lbf": 1/2204.62, "kip": 1/2.20462,
    }
    LENGTH_FACTORS = {
        "m": 1.0, "mm": 1/1000, "cm": 1/100, "km": 1000, "ft": 1/3.281, "in": 1/39.37,
    }
    _OLD_MAP = {
        "tonf_m": ("tonf", "m"), "kN_m": ("kN", "m"),
        "kgf_cm": ("kgf", "cm"), "lb_ft": ("lbf", "ft"),
        "N_mm": ("N", "mm"),
    }
    if "unidad_fuerza" in datos or "unidad_longitud" in datos:
        f_key = datos.get("unidad_fuerza", "tonf")
        l_key = datos.get("unidad_longitud", "m")
    else:
        f_key, l_key = _OLD_MAP.get(datos.get("unidad", "tonf_m"), ("tonf", "m"))
    cf = FORCE_FACTORS.get(f_key, 1.0)   # 1 user force unit = cf tonf
    cl = LENGTH_FACTORS.get(l_key, 1.0)  # 1 user length unit = cl m

    # --- Conversión de unidades del usuario → base tonf/m ---
    def _f(v):  return float(v) * cf              # fuerza → tonf
    def _l(v):  return float(v) * cl              # longitud → m
    def _m(v):  return float(v) * cf * cl         # momento → tonf·m
    def _cd(v): return float(v) * cf / cl         # carga distribuida → tonf/m

    est = Estructura(nombre=datos.get("nombre", "Portico"),
                     despreciar_axial=bool(datos.get("despreciar_axial", False)),
                     timoshenko=bool(datos.get("timoshenko", False)),
                     pdelta=bool(datos.get("pdelta", False)),
                     g=float(datos.get("g", 9.81) or 9.81))

    # --- materiales: uno global (compat) y/o varios por nombre ---
    def _mat_desde(md):
        dens = float(md.get("densidad", 0) or 0)
        nu = float(md.get("nu", 0.2) or 0.2)
        alpha = float(md.get("alpha", 0) or 0)
        if md.get("modo") == "fc" or ("fc" in md and "E" not in md):
            # desde_fc devuelve E en tonf/m², se usa directamente (ya en base)
            mat = Material.desde_fc(float(md["fc"]), unidad="tonf/m2")
            mat.densidad = dens; mat.nu = nu; mat.alpha = alpha
        else:
            # E del usuario → convertir a tonf/m²
            E_base = float(md["E"]) * cf / cl**2
            mat = Material(E_base, md.get("nombre", "material"),
                           densidad=dens, nu=nu, alpha=alpha)
        return mat

    md = datos["material"]
    mat_global = _mat_desde(md)
    est._material = mat_global
    materiales = {m["nombre"]: _mat_desde(m) for m in datos.get("materiales", [])}

    secs = {s["nombre"]: _seccion_desde(s, cl) for s in datos["secciones"]}

    nudos = {}
    for nd in datos["nudos"]:
        restr = nd.get("restriccion") or _APOYOS[nd.get("apoyo", "libre")]
        n = Nudo(nd["id"], _l(float(nd["x"])), _l(float(nd["y"])),
                 restriccion=tuple(restr), nombre=nd.get("nombre"))
        r = nd.get("resorte")
        if r:
            n.aplicar_resorte(float(r.get("kx", 0)) * cf / cl,
                              float(r.get("ky", 0)) * cf / cl,
                              float(r.get("kg", 0)) * cf * cl)
        a = nd.get("asentamiento")
        if a:
            n.aplicar_asentamiento(_l(float(a.get("dx", 0))),
                                   _l(float(a.get("dy", 0))),
                                   float(a.get("giro", 0)))
        nudos[nd["id"]] = n
        est.agregar_nudo(n)

    elementos = {}
    for ed in datos["elementos"]:
        mat_e = materiales.get(ed.get("material"), mat_global)
        e = Elemento(ed["id"], nudos[ed["i"]], nudos[ed["j"]], mat_e,
                     secs[ed["seccion"]], nombre=ed.get("nombre"),
                     release_i=bool(ed.get("release_i", False)),
                     release_j=bool(ed.get("release_j", False)))
        # --- tramos (barra no prismatica): seccion/material por tramo ---
        segs_in = ed.get("segmentos") or ed.get("tramos") or []
        segs_in = [s for s in segs_in if s and float(s.get("L", 0) or 0) > 0]
        if len(segs_in) >= 2:      # 0 o 1 tramo => barra prismatica normal
            segmentos = []
            for s in segs_in:
                sec_s = secs.get(s.get("seccion")) or secs[ed["seccion"]]
                mat_s = materiales.get(s.get("material")) or mat_e
                segmentos.append({"L": _l(float(s["L"])), "mat": mat_s,
                                  "sec": sec_s,
                                  "sec_nombre": s.get("seccion") or ed["seccion"]})
            # normaliza para que las longitudes sumen exactamente la geometrica
            suma = sum(sg["L"] for sg in segmentos)
            if suma > 0 and abs(suma - e.L) > 1e-9:
                fac = e.L / suma
                for sg in segmentos:
                    sg["L"] *= fac
            e.segmentos = segmentos
        elementos[ed["id"]] = e
        est.agregar_elemento(e)

    for cn in datos.get("cargas_nodales", []):
        nudos[cn["nudo"]].aplicar_carga(Fx=_f(cn.get("Fx", 0)),
                                        Fy=_f(cn.get("Fy", 0)),
                                        M=_m(cn.get("M", 0)))

    # --- auxiliar: pasa las cargas dadas por dirección a componentes globales ---
    def _resolve_dir(c, e):
        """Convierte dir/q en wx/wy (o Px/Py) cuando hace falta. Devuelve el
        diccionario de carga con las componentes globales siempre presentes."""
        d = dict(c)
        dir_mode = d.get("dir")
        if dir_mode is None or dir_mode == "comp":
            return d  # ya viene en componentes globales
        cx, cy = e.cos, e.sin
        # perpendicular orientada hacia arriba-derecha (igual que el frontend):
        # columna -> +X (derecha), viga -> +Y (arriba).
        ppx, ppy = -cy, cx
        if ppy < -1e-9 or (abs(ppy) < 1e-9 and ppx < 0):
            ppx, ppy = -ppx, -ppy
        _DIR_VEC = {
            "vert":  (0.0, 1.0),
            "horiz": (1.0, 0.0),
            "perp":  (ppx, ppy),
            "axial": (cx, cy),     # a lo largo del eje del elemento
        }
        if dir_mode == "angle":
            import math
            ang = float(d.get("ang", 0)) * math.pi / 180.0
            ux, uy = math.cos(ang), math.sin(ang)
        else:
            ux, uy = _DIR_VEC.get(dir_mode, (0.0, 1.0))
        if d.get("tipo") == "distribuida":
            trap = d.get("subtipo") == "trapezoidal"
            if trap:
                q1 = float(d.get("q1", 0) or 0)
                q2 = float(d.get("q2", 0) or 0)
                d["wx1"] = q1 * ux; d["wy1"] = q1 * uy
                d["wx2"] = q2 * ux; d["wy2"] = q2 * uy
            else:
                q = float(d.get("q", 0) or 0)
                d["wx"] = q * ux; d["wy"] = q * uy
        elif d.get("tipo") == "puntual":
            q = float(d.get("q", 0) or 0)
            d["Px"] = q * ux; d["Py"] = q * uy
        return d

    for ce in datos.get("cargas_elementos", []):
        e = elementos[ce["elem"]]
        ce = _resolve_dir(ce, e)
        t = ce["tipo"]
        a = ce.get("a"); b = ce.get("b")
        a = _l(a) if a not in (None, "") else None
        b = _l(b) if b not in (None, "") else None
        if t == "distribuida":
            if ce.get("subtipo") == "trapezoidal":
                e.agregar_carga(CargaDistribuida(
                    wx1=_cd(ce.get("wx1", 0)), wy1=_cd(ce.get("wy1", 0)),
                    wx2=_cd(ce.get("wx2", 0)), wy2=_cd(ce.get("wy2", 0)),
                    a=a, b=b))
            else:
                e.agregar_carga(CargaDistribuida(
                    wx=_cd(ce.get("wx", 0)), wy=_cd(ce.get("wy", 0)),
                    a=a, b=b))
        elif t == "puntual":
            aa = ce.get("a")
            e.agregar_carga(CargaPuntual(Px=_f(ce.get("Px", 0)),
                                         Py=_f(ce.get("Py", 0)),
                                         a=_l(aa) if aa not in (None, "") else None))
        elif t == "momento":
            aa = ce.get("a")
            e.agregar_carga(CargaMomento(M=_m(ce.get("M", 0)),
                                         a=_l(aa) if aa not in (None, "") else None))
        elif t == "termica":
            e.agregar_carga(CargaTermica(dT=float(ce.get("dT", 0) or 0),
                                         dT_grad=float(ce.get("dT_grad", 0) or 0)))

    if datos.get("peso_propio"):
        est.aplicar_peso_propio()

    est._conv_f = cf
    est._conv_l = cl
    return est


def _cond_warning(cond, despreciar_axial):
    """Devuelve (nivel, mensaje) según el número de condición de Kff.
    nivel ∈ {None, 'yellow', 'red'}. Mal condicionamiento → posible pérdida
    de precisión numérica."""
    if cond is None or cond <= 0:
        return None, None
    if cond >= 1e12:
        msg = (f"Número de condición muy alto (κ≈{cond:.1e}): los resultados "
               "pueden perder precisión.")
        if despreciar_axial:
            msg += (" Considere desactivar 'despreciar deformaciones axiales' "
                    "(la penalización empeora el condicionamiento).")
        return "red", msg
    if cond >= 1e9:
        return "yellow", (f"Número de condición elevado (κ≈{cond:.1e}): revise "
                          "rigideces muy dispares entre elementos.")
    return None, None


def extraer_resultados(est):
    """Devuelve un dict JSON-serializable con todos los resultados numericos.
    Los valores se convierten de base (tonf/m) a las unidades del usuario."""
    nl = est.n_libres
    cf = getattr(est, '_conv_f', 1.0)
    cl = getattr(est, '_conv_l', 1.0)

    # --- Funciones de reverse-conversión: base → usuario ---
    def _rf(v):   return float(v) / cf if cf else float(v)         # tonf → user force
    def _rl(v):   return float(v) / cl if cl else float(v)         # m → user length
    def _rm(v):   return float(v) / (cf * cl) if (cf * cl) else float(v)  # tonf·m → user moment
    def _rE(v):   return float(v) * cl**2 / cf if cf else float(v) # tonf/m² → user E

    desplazamientos = []
    for nd in est.nudos:
        desplazamientos.append({
            "nudo": nd.nombre,
            "ux": _rl(est.D[nd.gdl[0]]),
            "uy": _rl(est.D[nd.gdl[1]]),
            "giro": float(est.D[nd.gdl[2]]),
            "restringido": list(nd.restriccion),
        })

    reacciones = []
    for nd in est.nudos:
        tiene_apoyo = any(nd.restriccion) or bool(np.any(nd.resorte != 0))
        if tiene_apoyo:
            r = []
            for k in range(3):
                g = nd.gdl[k]
                if g >= nl:
                    val = float(est.R[g - nl])
                elif nd.resorte[k] != 0:
                    val = float(-nd.resorte[k] * est.D[g])
                else:
                    val = 0.0
                r.append(_rf(val) if k < 2 else _rm(val))
            reacciones.append({"nudo": nd.nombre, "Rx": r[0], "Ry": r[1], "M": r[2]})

    fuerzas = []
    Mmax_glob = 0.0; Vmax_glob = 0.0; Nmax_glob = 0.0
    for e in est.elementos:
        xs, N, V, M = est.fuerzas_internas(e, 101)
        im = int(np.argmax(np.abs(M))); iv = int(np.argmax(np.abs(V)))
        ina = int(np.argmax(np.abs(N)))
        Mmax_glob = max(Mmax_glob, abs(M[im])); Vmax_glob = max(Vmax_glob, abs(V[iv]))
        Nmax_glob = max(Nmax_glob, abs(N[ina]))
        fuerzas.append({
            "elem": e.nombre,
            "Ni": _rf(N[0]),  "Vi": _rf(V[0]),  "Mi": _rm(M[0]),
            "Nj": _rf(N[-1]), "Vj": _rf(V[-1]), "Mj": _rm(M[-1]),
            "Mmax": _rm(abs(M[im])), "xMmax": _rl(xs[im]),
            "Vmax": _rf(abs(V[iv])), "xVmax": _rl(xs[iv]),
            "Nmax": _rf(abs(N[ina])), "xNmax": _rl(xs[ina]),
            "L": _rl(e.L), "angulo": float(e.angulo),
        })

    umax = max(max(abs(d["ux"]), abs(d["uy"])) for d in desplazamientos)

    lbl = [None]*est.n_gdl
    for nd in est.nudos:
        for k in range(3):
            lbl[nd.gdl[k]] = f"{nd.nombre}.{['ux','uy','g'][k]}"

    equilibrio = est.verificar_equilibrio()
    if isinstance(equilibrio, dict):
        equilibrio = {k: _rf(v) if k.startswith("F") else _rm(v)
                      for k, v in equilibrio.items()}

    # --- datos numericos para diagramas interactivos en el navegador ---
    NP = 41
    diag_elems = []
    dmax_def = 0.0
    for e in est.elementos:
        xs, N, V, M = est.fuerzas_internas(e, NP)
        dofs = est._dofs_elemento(e)
        dl = e.matriz_T() @ est.D[dofs]
        ui, vi, ti, uj, vj, tj = dl
        L = e.L; c = e.cos; s = e.sin
        xi = xs / L
        u = (1-xi)*ui + xi*uj
        N1 = 1-3*xi**2+2*xi**3; N2 = L*(xi-2*xi**2+xi**3)
        N3 = 3*xi**2-2*xi**3;   N4 = L*(-xi**2+xi**3)
        v = N1*vi + N2*ti + N3*vj + N4*tj
        gx = c*u - s*v; gy = s*u + c*v
        # tramos (barra no prismatica): fronteras s0..s1 y nombre de seccion
        tramos = []
        if getattr(e, "segmentos", None):
            s0 = 0.0
            for sg in e.segmentos:
                s1 = s0 + sg["L"]
                tramos.append({"s0": _rl(s0), "s1": _rl(s1),
                               "sec": sg.get("sec_nombre", "")})
                s0 = s1
        diag_elems.append({
            "elem": e.nombre,
            "xi": _rl(e.ni.x), "yi": _rl(e.ni.y),
            "xj": _rl(e.nj.x), "yj": _rl(e.nj.y),
            "L": _rl(e.L),
            "s":  [_rl(t) for t in xs],
            "N":  [_rf(t) for t in N],
            "V":  [_rf(t) for t in V],
            "M":  [_rm(t) for t in M],
            "defx": [_rl(t) for t in gx],
            "defy": [_rl(t) for t in gy],
            "tramos": tramos,
        })
    diag_nudos = []
    for nd in est.nudos:
        ux = _rl(est.D[nd.gdl[0]]); uy = _rl(est.D[nd.gdl[1]])
        dmax_def = max(dmax_def, abs(ux), abs(uy))
        # resorte: [kx(kgf/m→tonf/m), ky, kg(kgf·m→tonf·m)] → reverse
        res_user = [
            float(nd.resorte[0]) * cl / cf if cf else float(nd.resorte[0]),
            float(nd.resorte[1]) * cl / cf if cf else float(nd.resorte[1]),
            float(nd.resorte[2]) / (cf * cl) if (cf * cl) else float(nd.resorte[2]),
        ]
        diag_nudos.append({
            "nombre": nd.nombre, "x": _rl(nd.x), "y": _rl(nd.y),
            "restr": list(nd.restriccion),
            "resorte": res_user,
            "ux": ux, "uy": uy,
        })
    diagramas = {"elementos": diag_elems, "nudos": diag_nudos,
                 "dmax_def": float(dmax_def)}

    resumen = {
        "n_nudos": len(est.nudos),
        "n_elementos": len(est.elementos),
        "n_gdl": est.n_gdl,
        "n_libres": est.n_libres,
        "Mmax": _rm(Mmax_glob),
        "Vmax": _rf(Vmax_glob),
        "Nmax": _rf(Nmax_glob),
        "umax": float(umax),
        "E": _rE(est._material.E),
        "fc": float(getattr(est._material, "fc", 0)) or None,
        "despreciar_axial": bool(est.despreciar_axial),
        "timoshenko": bool(getattr(est, "timoshenko", False)),
        "pdelta": bool(getattr(est, "pdelta", False)),
        "pdelta_iters": int(getattr(est, "pdelta_iters", 0)),
        "cond_Kff": float(getattr(est, "cond_Kff", 0.0)),
    }
    _cw_lvl, _cw_msg = _cond_warning(getattr(est, "cond_Kff", 0.0),
                                     bool(est.despreciar_axial))
    resumen["cond_warning"] = _cw_lvl
    resumen["cond_msg"] = _cw_msg

    try:
        equilibrio_elem = est.equilibrio_elementos()
    except Exception:
        equilibrio_elem = []

    return {
        "desplazamientos": desplazamientos,
        "reacciones": reacciones,
        "fuerzas": fuerzas,
        "resumen": resumen,
        "equilibrio": equilibrio,
        "equilibrio_elem": equilibrio_elem,
        "diagramas": diagramas,
        "gdl_labels": lbl,
        "K": est.K.tolist(),
        "Kff": est._part["Kff"].tolist(),
        "n_libres": est.n_libres,
    }


def resolver_combinaciones(datos):
    """Resuelve por CASOS de carga y combina linealmente (envolventes).
    datos debe traer:
      - geometria/material/secciones/nudos/elementos (como en construir)
      - 'casos': [{nombre, cargas_nodales, cargas_elementos}]
      - 'combinaciones': [{nombre, factores:{nombre_caso: factor}}]
    Devuelve resultados por combinacion y la envolvente (max/min) por elemento.
    Nota: la superposicion es valida en regimen lineal (sin P-Delta).
    """
    import numpy as np
    casos = datos.get("casos") or []
    combos = datos.get("combinaciones") or []
    if not casos:
        raise ValueError("Define al menos un caso de carga.")

    base = {k: v for k, v in datos.items()
            if k not in ("casos", "combinaciones", "cargas_nodales",
                         "cargas_elementos", "pdelta")}
    base["pdelta"] = False  # la superposicion exige linealidad

    NP = 41
    # resolver cada caso
    res_casos = {}
    xs_ref = None; nudos_ref = None; elem_orden = None
    for caso in casos:
        dc = dict(base)
        dc["cargas_nodales"] = caso.get("cargas_nodales", [])
        dc["cargas_elementos"] = caso.get("cargas_elementos", [])
        est = construir(dc); est.resolver()
        cf_c = getattr(est, '_conv_f', 1.0)
        cl_c = getattr(est, '_conv_l', 1.0)
        def _rf_c(v): return float(v) / cf_c if cf_c else float(v)
        def _rl_c(v): return float(v) / cl_c if cl_c else float(v)
        def _rm_c(v): return float(v) / (cf_c * cl_c) if (cf_c * cl_c) else float(v)
        edict = {}
        if elem_orden is None: elem_orden = [e.nombre for e in est.elementos]
        for e in est.elementos:
            xs, N, V, M = est.fuerzas_internas(e, NP)
            edict[e.nombre] = {"N": [_rf_c(t) for t in N], "V": [_rf_c(t) for t in V],
                               "M": [_rm_c(t) for t in M],
                               "xi": _rl_c(e.ni.x), "yi": _rl_c(e.ni.y),
                               "xj": _rl_c(e.nj.x), "yj": _rl_c(e.nj.y),
                               "s": [_rl_c(t) for t in xs]}
        # reacciones por nombre de nudo
        reac = {}
        nl = est.n_libres
        for nd in est.nudos:
            if any(nd.restriccion) or bool(np.any(nd.resorte != 0)):
                r = []
                for k in range(3):
                    g = nd.gdl[k]
                    if g >= nl: val = float(est.R[g-nl])
                    elif nd.resorte[k] != 0: val = float(-nd.resorte[k]*est.D[g])
                    else: val = 0.0
                    r.append(_rf_c(val) if k < 2 else _rm_c(val))
                reac[nd.nombre] = r
        res_casos[caso["nombre"]] = {"elem": edict, "reac": reac}
        if xs_ref is None:
            xs_ref = list(edict[elem_orden[0]]["s"])
            nudos_ref = [{"nombre": nd.nombre, "x": _rl_c(nd.x), "y": _rl_c(nd.y),
                          "restr": list(nd.restriccion)} for nd in est.nudos]

    # combinaciones (si no hay, una por caso con factor 1)
    if not combos:
        combos = [{"nombre": c["nombre"], "factores": {c["nombre"]: 1.0}} for c in casos]

    combo_res = []
    env = {nom: {"M": None, "V": None, "N": None} for nom in elem_orden}
    for nom in elem_orden:
        z = np.zeros(NP)
        env[nom] = {"Mmax": z.copy()-1e30, "Mmin": z.copy()+1e30,
                    "Vmax": z.copy()-1e30, "Vmin": z.copy()+1e30,
                    "Nmax": z.copy()-1e30, "Nmin": z.copy()+1e30}
    reac_env = {}

    for comb in combos:
        fac = comb["factores"]
        Mmax_g = Vmax_g = Nmax_g = 0.0
        for nom in elem_orden:
            Mc = np.zeros(NP); Vc = np.zeros(NP); Nc = np.zeros(NP)
            for cn, f in fac.items():
                if cn in res_casos:
                    ed = res_casos[cn]["elem"][nom]
                    Mc += f*ed["M"]; Vc += f*ed["V"]; Nc += f*ed["N"]
            e = env[nom]
            e["Mmax"] = np.maximum(e["Mmax"], Mc); e["Mmin"] = np.minimum(e["Mmin"], Mc)
            e["Vmax"] = np.maximum(e["Vmax"], Vc); e["Vmin"] = np.minimum(e["Vmin"], Vc)
            e["Nmax"] = np.maximum(e["Nmax"], Nc); e["Nmin"] = np.minimum(e["Nmin"], Nc)
            Mmax_g = max(Mmax_g, np.max(np.abs(Mc)))
            Vmax_g = max(Vmax_g, np.max(np.abs(Vc)))
            Nmax_g = max(Nmax_g, np.max(np.abs(Nc)))
        # reacciones de la combinacion
        for ndn in (nudos_ref or []):
            nm = ndn["nombre"]
            rr = [0.0, 0.0, 0.0]
            for cn, f in fac.items():
                rc = res_casos[cn]["reac"].get(nm)
                if rc: rr = [rr[k]+f*rc[k] for k in range(3)]
            d = reac_env.setdefault(nm, {"Rx":[1e30,-1e30],"Ry":[1e30,-1e30],"M":[1e30,-1e30]})
            for key, val in zip(("Rx","Ry","M"), rr):
                d[key][0] = min(d[key][0], val); d[key][1] = max(d[key][1], val)
        combo_res.append({"nombre": comb["nombre"], "Mmax": float(Mmax_g),
                          "Vmax": float(Vmax_g), "Nmax": float(Nmax_g)})

    elementos_env = []
    g_Mmax = g_Vmax = g_Nmax = 0.0
    for nom in elem_orden:
        e = env[nom]
        ed0 = res_casos[elem_orden and list(res_casos.keys())[0]]["elem"][nom]
        elementos_env.append({
            "elem": nom, "xi": ed0["xi"], "yi": ed0["yi"], "xj": ed0["xj"], "yj": ed0["yj"],
            "s": xs_ref,
            "Mmax": e["Mmax"].tolist(), "Mmin": e["Mmin"].tolist(),
            "Vmax": e["Vmax"].tolist(), "Vmin": e["Vmin"].tolist(),
            "Nmax": e["Nmax"].tolist(), "Nmin": e["Nmin"].tolist(),
        })
        g_Mmax = max(g_Mmax, np.max(np.abs(e["Mmax"])), np.max(np.abs(e["Mmin"])))
        g_Vmax = max(g_Vmax, np.max(np.abs(e["Vmax"])), np.max(np.abs(e["Vmin"])))
        g_Nmax = max(g_Nmax, np.max(np.abs(e["Nmax"])), np.max(np.abs(e["Nmin"])))

    reacciones_env = [{"nudo": nm, **{k: {"min": v[k][0], "max": v[k][1]}
                       for k in ("Rx","Ry","M")}} for nm, v in reac_env.items()]

    return {
        "casos": [c["nombre"] for c in casos],
        "combinaciones": combo_res,
        "envolvente": {"elementos": elementos_env, "nudos": nudos_ref},
        "resumen": {"Mmax": float(g_Mmax), "Vmax": float(g_Vmax), "Nmax": float(g_Nmax),
                    "n_casos": len(casos), "n_combinaciones": len(combo_res)},
        "reacciones_envolvente": reacciones_env,
    }
