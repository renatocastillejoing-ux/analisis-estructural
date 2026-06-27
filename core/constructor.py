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


def _seccion_desde(s):
    nombre = s["nombre"]
    modo = s.get("modo", "rect")
    def _fin(sec):
        if s.get("k_corte"):
            sec.k_corte = float(s["k_corte"])
        return sec
    if modo == "AI" or ("A" in s and "b" not in s and "tipo" not in s):
        return _fin(Seccion(float(s["A"]), float(s["I"]), nombre=nombre))
    if modo == "calc" and s.get("tipo"):
        dims = {k: v for k, v in s.items()
                if k not in ("nombre", "modo", "tipo", "k_corte")}
        A, I = Secc.calcular(s["tipo"], **dims)
        sec = Seccion(A, I, nombre=nombre)
        sec.tipo_seccion = s["tipo"]
        return _fin(sec)
    return _fin(Seccion.rectangular(float(s["b"]), float(s["h"]), nombre=nombre))


def construir(datos):
    # ------------------------------------------------------------------
    #  UNIDADES — el método de rigidez es AGNÓSTICO a unidades: si todas
    #  las magnitudes (E, cargas, longitudes) están en un mismo sistema
    #  consistente (p. ej. kN, m), los resultados salen en ese sistema.
    #  Por eso NO se reescalan internamente las entradas; el sistema solo
    #  fija las ETIQUETAS y la fórmula empírica f'c→E (que está en kgf/cm²).
    #  Factores hacia la base tonf·m (usados solo para f'c→E):
    # ------------------------------------------------------------------
    UNIDADES_CONV = {
        "tonf_m":  {"f": 1.0,      "l": 1.0},
        "kN_m":    {"f": 1/9.81,   "l": 1.0},
        "kgf_cm":  {"f": 1/1000,   "l": 1/100},
        "lb_ft":   {"f": 1/2204.62,"l": 1/3.281},
        "N_mm":    {"f": 1/9810,   "l": 1/1000},
    }
    FORCE_FACTORS = {
        "tonf": 1.0, "kgf": 1/1000, "N": 1/9810, "kN": 1/9.81,
        "MN": 1/0.00981, "GN": 1/0.00000981, "lbf": 1/2204.62, "kip": 1/2.20462,
    }
    LENGTH_FACTORS = {
        "m": 1.0, "mm": 1/1000, "cm": 1/100, "km": 1000, "ft": 1/3.281, "in": 1/39.37,
    }
    # Support both old combined key and new separate keys
    if "unidad_fuerza" in datos or "unidad_longitud" in datos:
        f_key = datos.get("unidad_fuerza", "tonf")
        l_key = datos.get("unidad_longitud", "m")
        conv = {"f": FORCE_FACTORS.get(f_key, 1.0), "l": LENGTH_FACTORS.get(l_key, 1.0)}
    else:
        unidad_key = datos.get("unidad", "tonf_m")
        conv = UNIDADES_CONV.get(unidad_key, UNIDADES_CONV["tonf_m"])

    # Conversión identidad: se trabaja directamente en las unidades del usuario.
    def conv_fuerza(val):      return float(val)
    def conv_longitud(val):    return float(val)
    def conv_momento(val):     return float(val)
    def conv_carga_dist(val):  return float(val)

    est = Estructura(nombre=datos.get("nombre", "Portico"),
                     despreciar_axial=bool(datos.get("despreciar_axial", False)),
                     timoshenko=bool(datos.get("timoshenko", False)),
                     pdelta=bool(datos.get("pdelta", False)),
                     g=float(datos.get("g", 9.81) or 9.81))

    # --- materiales: uno global (compat) y/o varios por nombre ---
    def _mat_desde(md):
        dens = float(md.get("densidad", 0) or 0)
        nu = float(md.get("nu", 0.2) or 0.2)
        alpha = float(md.get("alpha", 0) or 0)   # coef. dilatación térmica
        if md.get("modo") == "fc" or ("fc" in md and "E" not in md):
            # E.060: Ec = 15000·√(f'c[kgf/cm²]). desde_fc devuelve E en tonf/m²;
            # se convierte a las unidades del usuario:  E_user = E_tonf · l² / f
            mat = Material.desde_fc(float(md["fc"]), unidad="tonf/m2")
            mat.E = mat.E * conv["l"]**2 / conv["f"]
            mat.densidad = dens; mat.nu = nu; mat.alpha = alpha
        else:
            mat = Material(float(md["E"]), md.get("nombre", "material"),
                           densidad=dens, nu=nu, alpha=alpha)
        return mat

    md = datos["material"]
    mat_global = _mat_desde(md)
    est._material = mat_global
    materiales = {m["nombre"]: _mat_desde(m) for m in datos.get("materiales", [])}

    secs = {s["nombre"]: _seccion_desde(s) for s in datos["secciones"]}

    nudos = {}
    for nd in datos["nudos"]:
        restr = nd.get("restriccion") or _APOYOS[nd.get("apoyo", "libre")]
        n = Nudo(nd["id"], float(nd["x"]), float(nd["y"]),
                 restriccion=tuple(restr), nombre=nd.get("nombre"))
        r = nd.get("resorte")
        if r:
            n.aplicar_resorte(float(r.get("kx", 0)), float(r.get("ky", 0)),
                              float(r.get("kg", 0)))
        a = nd.get("asentamiento")
        if a:
            n.aplicar_asentamiento(float(a.get("dx", 0)), float(a.get("dy", 0)),
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
        elementos[ed["id"]] = e
        est.agregar_elemento(e)

    for cn in datos.get("cargas_nodales", []):
        nudos[cn["nudo"]].aplicar_carga(Fx=conv_fuerza(cn.get("Fx", 0)),
                                        Fy=conv_fuerza(cn.get("Fy", 0)),
                                        M=conv_momento(cn.get("M", 0)))

    # --- helper: resolve direction-based loads to global components ---
    def _resolve_dir(c, e):
        """Convert dir/q to wx/wy (or Px/Py) if needed. Returns the load dict
        with global components always present."""
        d = dict(c)
        dir_mode = d.get("dir")
        if dir_mode is None or dir_mode == "comp":
            return d  # already in global components
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
            "axial": (cx, cy),     # along element axis
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
        a = conv_longitud(a) if a not in (None, "") else None
        b = conv_longitud(b) if b not in (None, "") else None
        if t == "distribuida":
            if ce.get("subtipo") == "trapezoidal":
                e.agregar_carga(CargaDistribuida(
                    wx1=conv_carga_dist(ce.get("wx1", 0)), wy1=conv_carga_dist(ce.get("wy1", 0)),
                    wx2=conv_carga_dist(ce.get("wx2", 0)), wy2=conv_carga_dist(ce.get("wy2", 0)),
                    a=a, b=b))
            else:
                e.agregar_carga(CargaDistribuida(
                    wx=conv_carga_dist(ce.get("wx", 0)), wy=conv_carga_dist(ce.get("wy", 0)),
                    a=a, b=b))
        elif t == "puntual":
            aa = ce.get("a")
            e.agregar_carga(CargaPuntual(Px=conv_fuerza(ce.get("Px", 0)),
                                         Py=conv_fuerza(ce.get("Py", 0)),
                                         a=conv_longitud(aa) if aa not in (None, "") else None))
        elif t == "momento":
            aa = ce.get("a")
            e.agregar_carga(CargaMomento(M=conv_momento(ce.get("M", 0)),
                                         a=conv_longitud(aa) if aa not in (None, "") else None))
        elif t == "termica":
            e.agregar_carga(CargaTermica(dT=float(ce.get("dT", 0) or 0),
                                         dT_grad=float(ce.get("dT_grad", 0) or 0)))

    if datos.get("peso_propio"):
        est.aplicar_peso_propio()

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
    """Devuelve un dict JSON-serializable con todos los resultados numericos."""
    nl = est.n_libres

    desplazamientos = []
    for nd in est.nudos:
        desplazamientos.append({
            "nudo": nd.nombre,
            "ux": float(est.D[nd.gdl[0]]),
            "uy": float(est.D[nd.gdl[1]]),
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
                    r.append(float(est.R[g - nl]))
                elif nd.resorte[k] != 0:
                    r.append(float(-nd.resorte[k] * est.D[g]))
                else:
                    r.append(0.0)
            reacciones.append({"nudo": nd.nombre, "Rx": r[0], "Ry": r[1], "M": r[2]})

    fuerzas = []
    Mmax_glob = 0.0; Vmax_glob = 0.0; Nmax_glob = 0.0
    for e in est.elementos:
        xs, N, V, M = est.fuerzas_internas(e, 101)
        im = int(np.argmax(np.abs(M))); iv = int(np.argmax(np.abs(V)))
        ina = int(np.argmax(np.abs(N)))
        Mmax_glob = max(Mmax_glob, abs(M[im])); Vmax_glob = max(Vmax_glob, abs(V[iv]))
        Nmax_glob = max(Nmax_glob, abs(N[ina]))
        # Se reportan FUERZAS INTERNAS en los extremos (mismo convenio que los
        # diagramas): N tracción +, V según diagrama, M sagging (+) / hogging (−).
        fuerzas.append({
            "elem": e.nombre,
            "Ni": float(N[0]),  "Vi": float(V[0]),  "Mi": float(M[0]),
            "Nj": float(N[-1]), "Vj": float(V[-1]), "Mj": float(M[-1]),
            "Mmax": float(abs(M[im])), "xMmax": float(xs[im]),
            "Vmax": float(abs(V[iv])), "xVmax": float(xs[iv]),
            "Nmax": float(abs(N[ina])), "xNmax": float(xs[ina]),
            "L": float(e.L), "angulo": float(e.angulo),
        })

    umax = max(max(abs(d["ux"]), abs(d["uy"])) for d in desplazamientos)

    lbl = [None]*est.n_gdl
    for nd in est.nudos:
        for k in range(3):
            lbl[nd.gdl[k]] = f"{nd.nombre}.{['ux','uy','g'][k]}"

    equilibrio = est.verificar_equilibrio()

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
        gx = c*u - s*v; gy = s*u + c*v          # offset global SIN escalar
        diag_elems.append({
            "elem": e.nombre,
            "xi": float(e.ni.x), "yi": float(e.ni.y),
            "xj": float(e.nj.x), "yj": float(e.nj.y),
            "L": float(e.L),
            "s":  [float(t) for t in xs],
            "N":  [float(t) for t in N],
            "V":  [float(t) for t in V],
            "M":  [float(t) for t in M],
            "defx": [float(t) for t in gx],
            "defy": [float(t) for t in gy],
        })
    diag_nudos = []
    for nd in est.nudos:
        ux = float(est.D[nd.gdl[0]]); uy = float(est.D[nd.gdl[1]])
        dmax_def = max(dmax_def, abs(ux), abs(uy))
        diag_nudos.append({
            "nombre": nd.nombre, "x": float(nd.x), "y": float(nd.y),
            "restr": list(nd.restriccion),
            "resorte": [float(r) for r in nd.resorte],
            "ux": ux, "uy": uy,
        })
    diagramas = {"elementos": diag_elems, "nudos": diag_nudos,
                 "dmax_def": float(dmax_def)}

    resumen = {
        "n_nudos": len(est.nudos),
        "n_elementos": len(est.elementos),
        "n_gdl": est.n_gdl,
        "n_libres": est.n_libres,
        "Mmax": float(Mmax_glob),
        "Vmax": float(Vmax_glob),
        "Nmax": float(Nmax_glob),
        "umax": float(umax),
        "E": float(est._material.E),
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
        edict = {}
        if elem_orden is None: elem_orden = [e.nombre for e in est.elementos]
        for e in est.elementos:
            xs, N, V, M = est.fuerzas_internas(e, NP)
            edict[e.nombre] = {"N": N, "V": V, "M": M,
                               "xi": e.ni.x, "yi": e.ni.y,
                               "xj": e.nj.x, "yj": e.nj.y, "s": xs}
        # reacciones por nombre de nudo
        reac = {}
        nl = est.n_libres
        for nd in est.nudos:
            if any(nd.restriccion) or bool(np.any(nd.resorte != 0)):
                r = []
                for k in range(3):
                    g = nd.gdl[k]
                    if g >= nl: r.append(float(est.R[g-nl]))
                    elif nd.resorte[k] != 0: r.append(float(-nd.resorte[k]*est.D[g]))
                    else: r.append(0.0)
                reac[nd.nombre] = r
        res_casos[caso["nombre"]] = {"elem": edict, "reac": reac}
        if xs_ref is None:
            xs_ref = list(edict[elem_orden[0]]["s"])
            nudos_ref = [{"nombre": nd.nombre, "x": float(nd.x), "y": float(nd.y),
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
