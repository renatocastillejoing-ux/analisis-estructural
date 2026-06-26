# -*- coding: utf-8 -*-
"""
Reporte PASO A PASO del metodo matricial de rigidez.
Genera la memoria de calculo: matrices de cada elemento, ensamblaje,
particion, solucion, reacciones y fuerzas internas.
"""
import numpy as np
import io


def _fmt_matriz(M, etiquetas_fila=None, etiquetas_col=None, ancho=None, dec=2):
    """Formatea una matriz con etiquetas de fila/columna.
    Si la matriz tiene valores de magnitud muy grande (p.ej. por rigidizacion
    axial), conmuta automaticamente a notacion cientifica para evitar solapes."""
    buf = io.StringIO()
    n, m = M.shape
    vmax = np.max(np.abs(M)) if M.size else 0.0
    cientifico = vmax >= 1.0e5
    if cientifico:
        ancho = ancho or 14
        celda = lambda v: f"{v:>{ancho}.3e}"
    else:
        ancho = ancho or 11
        celda = lambda v: f"{v:>{ancho}.{dec}f}"
    if etiquetas_col is not None:
        buf.write(" " * 8)
        for j in range(m):
            buf.write(f"{str(etiquetas_col[j]):>{ancho}}")
        buf.write("\n")
    for i in range(n):
        if etiquetas_fila is not None:
            buf.write(f"{str(etiquetas_fila[i]):>7} ")
        else:
            buf.write(" " * 8)
        for j in range(m):
            buf.write(celda(M[i, j]))
        buf.write("\n")
    return buf.getvalue()


def _gdl_label(nudo, k):
    eje = ["ux", "uy", "g"][k]
    return f"{nudo.nombre}.{eje}"


def generar_reporte(est, archivo=None, dec=3):
    """
    Genera el reporte completo. Si 'archivo' se da, lo guarda ademas en texto.
    Requiere que la estructura ya este resuelta (est.resolver()).
    """
    if not est.resuelto:
        est.resolver()

    out = io.StringIO()
    P = out.write

    def titulo(txt, simbolo="="):
        P("\n" + simbolo * 78 + "\n")
        P("  " + txt + "\n")
        P(simbolo * 78 + "\n")

    # etiquetas de GDL global ordenadas por numero
    lbl = [None] * est.n_gdl
    for nudo in est.nudos:
        for k in range(3):
            lbl[nudo.gdl[k]] = _gdl_label(nudo, k)

    # ----------------------------------------------------------------------
    titulo(f"MEMORIA DE CALCULO  -  {est.nombre}", "#")
    P("\nMETODO MATRICIAL DIRECTO DE RIGIDEZ - PORTICO PLANO (3 GDL por nudo)\n")
    if est.despreciar_axial:
        P("\nNOTA: se DESPRECIAN las deformaciones axiales (hipotesis del metodo\n")
        P("manual). El solver rigidiza internamente el eje axial de las barras\n")
        P("(EA elevado); por eso en las matrices los terminos axiales aparecen\n")
        P("con magnitud muy grande, los desplazamientos verticales resultan ~0\n")
        P("y el nivel se traslada como cuerpo rigido (1 GDL horizontal + giros).\n")

    # ----------------------------------------------------------------------
    titulo("1. DATOS DE ENTRADA")
    P("\n>> NUDOS\n")
    P(f"{'Nudo':>6}{'X':>10}{'Y':>10}{'Restriccion (ux,uy,g)':>26}\n")
    for nd in est.nudos:
        rstr = f"({nd.restriccion[0]},{nd.restriccion[1]},{nd.restriccion[2]})"
        tipo = _tipo_apoyo(nd.restriccion)
        P(f"{nd.nombre:>6}{nd.x:>10.3f}{nd.y:>10.3f}{rstr:>16}  {tipo}\n")

    P("\n>> ELEMENTOS\n")
    P(f"{'Elem':>6}{'i':>5}{'j':>5}{'L':>9}{'angulo':>9}{'E':>13}{'A':>10}{'I':>13}\n")
    for e in est.elementos:
        P(f"{e.nombre:>6}{e.ni.nombre:>5}{e.nj.nombre:>5}{e.L:>9.3f}"
          f"{e.angulo:>9.2f}{e.mat.E:>13.1f}{e.sec.A:>10.4f}{e.sec.I:>13.6f}\n")

    P("\n>> CARGAS NODALES (directas) [Fx, Fy, M]\n")
    hay = False
    for nd in est.nudos:
        if np.any(nd.carga != 0):
            P(f"  {nd.nombre}: {nd.carga}\n"); hay = True
    if not hay:
        P("  (ninguna)\n")

    P("\n>> CARGAS EN ELEMENTOS\n")
    hay = False
    for e in est.elementos:
        for c in e.cargas:
            if c.tipo == "distribuida":
                if c.uniforme:
                    P(f"  {e.nombre}: distribuida uniforme  wx={c.wx1}, wy={c.wy1}\n")
                else:
                    P(f"  {e.nombre}: distribuida trapezoidal  "
                      f"(wx1={c.wx1},wy1={c.wy1}) -> (wx2={c.wx2},wy2={c.wy2})\n")
            elif c.tipo == "puntual":
                P(f"  {e.nombre}: puntual  Px={c.Px}, Py={c.Py}, a={c.a}\n")
            elif c.tipo == "momento":
                P(f"  {e.nombre}: momento  M={c.M}, a={c.a}\n")
            hay = True
    if not hay:
        P("  (ninguna)\n")

    rot = [e.nombre + (" [rotula en i]" if e.release_i else "") +
           (" [rotula en j]" if e.release_j else "")
           for e in est.elementos if e.release_i or e.release_j]
    if rot:
        P("\n>> ROTULAS INTERNAS (liberacion de momento):\n")
        for r in rot:
            P(f"  {r}\n")

    # ----------------------------------------------------------------------
    titulo("2. NUMERACION DE GRADOS DE LIBERTAD")
    P("\nSe numeran primero los GDL LIBRES y luego los RESTRINGIDOS,\n")
    P("de modo que el sistema queda particionado [ libres | restringidos ].\n\n")
    P(f"  Total GDL          = {est.n_gdl}\n")
    P(f"  GDL libres         = {est.n_libres}   -> {est.gdl_libres}\n")
    P(f"  GDL restringidos   = {est.n_gdl-est.n_libres}   -> {est.gdl_restr}\n\n")
    P(f"{'Nudo':>6}{'ux':>6}{'uy':>6}{'giro':>6}\n")
    for nd in est.nudos:
        P(f"{nd.nombre:>6}{nd.gdl[0]:>6}{nd.gdl[1]:>6}{nd.gdl[2]:>6}\n")

    # ----------------------------------------------------------------------
    titulo("3. MATRICES POR ELEMENTO")
    for e in est.elementos:
        P(f"\n{'-'*70}\nELEMENTO {e.nombre}  ({e.ni.nombre} -> {e.nj.nombre})  "
          f"L={e.L:.3f}  angulo={e.angulo:.2f}  cos={e.cos:.4f}  sin={e.sin:.4f}\n{'-'*70}\n")
        EA = e.mat.E*e.sec.A; EI = e.mat.E*e.sec.I
        P(f"  EA = {EA:.2f}    EI = {EI:.4f}    EA/L = {EA/e.L:.2f}    "
          f"EI/L = {EI/e.L:.4f}\n")
        dofs = est._dofs_elemento(e)
        etiq = [lbl[d] for d in dofs]

        P("\n  >> Matriz de rigidez LOCAL  [k]local (6x6):\n")
        P(_fmt_matriz(e.k_local(), dec=2))

        P("\n  >> Matriz de transformacion [T] (local <- global):\n")
        P(_fmt_matriz(e.matriz_T(), dec=4))

        P("\n  >> Matriz de rigidez GLOBAL  [K]e = [T]'[k][T]  (GDL: "
          + ", ".join(etiq) + "):\n")
        P(_fmt_matriz(est._kg_elementos[e.id], etiq, etiq, dec=1))

        ff = e.fuerzas_empotramiento_local()
        if np.any(np.abs(ff) > 1e-9):
            P("\n  >> Fuerzas de empotramiento perfecto (LOCAL) "
              "[Ni,Vi,Mi,Nj,Vj,Mj]:\n")
            P(f"     {ff}\n")
            P("  >> Cargas nodales equivalentes en GLOBAL (= -[T]'ff):\n")
            P(f"     {-est._ff_global[e.id]}\n")

    # ----------------------------------------------------------------------
    titulo("4. MATRIZ DE RIGIDEZ GLOBAL ENSAMBLADA [K]")
    P("\n")
    P(_fmt_matriz(est.K, lbl, lbl, dec=1))

    titulo("5. VECTOR DE CARGAS GLOBAL {P}")
    P("\n(cargas nodales directas + cargas equivalentes por cargas en elementos)\n\n")
    for d in range(est.n_gdl):
        P(f"  {lbl[d]:>8} : {est.P[d]:>12.3f}\n")

    # ----------------------------------------------------------------------
    titulo("6. PARTICION Y SOLUCION DEL SISTEMA")
    nl = est.n_libres
    lf = lbl[:nl]
    P("\nSistema particionado:\n")
    P("  | Kff  Kfr | | Df |   | Pf |\n")
    P("  | Krf  Krr | | Dr | = | Pr |   con Dr = 0 (apoyos rigidos)\n")
    P("\nSe resuelve:   [Kff]{Df} = {Pf}\n")

    P("\n  >> Submatriz [Kff] (GDL libres):\n")
    P(_fmt_matriz(est._part["Kff"], lf, lf, dec=1))
    P("\n  >> Vector {Pf}:\n")
    for i in range(nl):
        P(f"     {lf[i]:>8} : {est._part['Pf'][i]:>12.3f}\n")

    P("\n  >> SOLUCION  {Df} = [Kff]^-1 {Pf}:\n")
    for i in range(nl):
        P(f"     {lf[i]:>8} : {est.Df[i]:>15.6e}\n")

    # ----------------------------------------------------------------------
    titulo("7. DESPLAZAMIENTOS Y ROTACIONES POR NUDO")
    P(f"\n{'Nudo':>6}{'ux':>16}{'uy':>16}{'giro (rad)':>16}\n")
    for nd in est.nudos:
        ux = est.D[nd.gdl[0]]; uy = est.D[nd.gdl[1]]; g = est.D[nd.gdl[2]]
        P(f"{nd.nombre:>6}{ux:>16.6e}{uy:>16.6e}{g:>16.6e}\n")

    # ----------------------------------------------------------------------
    titulo("8. REACCIONES EN LOS APOYOS")
    P(f"\n{'Nudo':>6}{'Rx':>14}{'Ry':>14}{'M':>14}\n")
    for nd in est.nudos:
        if any(nd.restriccion):
            r = []
            for k in range(3):
                g = nd.gdl[k]
                r.append(est.R[g-nl] if g >= nl else 0.0)
            P(f"{nd.nombre:>6}{r[0]:>14.4f}{r[1]:>14.4f}{r[2]:>14.4f}\n")

    # ----------------------------------------------------------------------
    titulo("9. FUERZAS INTERNAS EN EXTREMOS DE CADA ELEMENTO (LOCAL)")
    P(f"\n{'Elem':>6}{'N_i':>11}{'V_i':>11}{'M_i':>11}"
      f"{'N_j':>11}{'V_j':>11}{'M_j':>11}\n")
    for e in est.elementos:
        f = est.fuerzas_elem[e.id]
        P(f"{e.nombre:>6}{f[0]:>11.3f}{f[1]:>11.3f}{f[2]:>11.3f}"
          f"{f[3]:>11.3f}{f[4]:>11.3f}{f[5]:>11.3f}\n")

    # valores maximos de momento y cortante
    P("\n>> Momento flector y cortante maximos por elemento:\n")
    for e in est.elementos:
        xs, N, V, M = est.fuerzas_internas(e, npts=101)
        im = np.argmax(np.abs(M)); iv = np.argmax(np.abs(V))
        P(f"   {e.nombre}: |M|max = {abs(M[im]):.3f} en x={xs[im]:.2f}    "
          f"|V|max = {abs(V[iv]):.3f} en x={xs[iv]:.2f}\n")

    # --- verificacion de equilibrio global ---
    eq = est.verificar_equilibrio()
    P("\n" + "="*78 + "\n  10. VERIFICACION DE EQUILIBRIO GLOBAL\n" + "="*78 + "\n")
    P("(suma de cargas aplicadas + reacciones = 0)\n")
    P(f"  ΣFx: aplicado={eq['sumFx_aplicado']:+10.4f}  reaccion={eq['sumFx_reaccion']:+10.4f}  residuo={eq['residuo_Fx']:+.2e}\n")
    P(f"  ΣFy: aplicado={eq['sumFy_aplicado']:+10.4f}  reaccion={eq['sumFy_reaccion']:+10.4f}  residuo={eq['residuo_Fy']:+.2e}\n")
    P(f"  ΣM : aplicado={eq['sumM_aplicado']:+10.4f}  reaccion={eq['sumM_reaccion']:+10.4f}  residuo={eq['residuo_M']:+.2e}\n")
    if hasattr(est, "cond_Kff"):
        P(f"\n  Numero de condicion de [Kff] = {est.cond_Kff:.3e}")
        P("   (valores muy altos > 1e12 indican mal condicionamiento)\n")

    P("\n" + "#"*78 + "\n  FIN DE LA MEMORIA DE CALCULO\n" + "#"*78 + "\n")

    texto = out.getvalue()
    if archivo:
        with open(archivo, "w", encoding="utf-8") as fh:
            fh.write(texto)
    return texto


def _tipo_apoyo(r):
    mapa = {
        (1, 1, 1): "Empotrado",
        (1, 1, 0): "Apoyo fijo (articulado)",
        (0, 1, 0): "Apoyo movil / rodillo (Y)",
        (1, 0, 0): "Apoyo movil / rodillo (X)",
        (0, 0, 0): "Libre",
    }
    return mapa.get(tuple(r), "Restriccion parcial")
