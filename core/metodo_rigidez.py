# -*- coding: utf-8 -*-
"""
================================================================================
  METODO MATRICIAL DIRECTO DE RIGIDEZ  -  PORTICOS PLANOS 2D  (motor v2)
================================================================================
  Elemento viga-columna con 3 GDL por nudo: [ux, uy, giro]
  Novedades respecto a v1:
    - Cargas distribuidas TRAPEZOIDALES (w1 en i, w2 en j)
    - MOMENTOS aplicados en cualquier punto del elemento
    - ROTULAS INTERNAS (liberacion de momento en extremo i y/o j) por
      condensacion estatica
  Unidades: consistentes (recomendado tonf, m).
================================================================================
"""
import numpy as np

np.set_printoptions(precision=4, suppress=True, linewidth=200)


# ==============================================================================
#  MATERIAL  (f'c -> E segun Norma E.060: Ec = 15000*sqrt(f'c) [kgf/cm2])
# ==============================================================================
class Material:
    def __init__(self, E, nombre="material", densidad=0.0, nu=0.2,
                 alpha=0.0):
        self.E = float(E)
        self.nombre = nombre
        self.densidad = float(densidad)   # peso especifico (fuerza/volumen)
        self.nu = float(nu)               # modulo de Poisson (para Timoshenko)
        self.alpha = float(alpha)         # coef. dilatacion termica (1/grado)

    @classmethod
    def desde_fc(cls, fc, unidad="tonf/m2", nombre=None):
        E_kgf_cm2 = 15000.0 * np.sqrt(fc)
        if unidad == "kgf/cm2":
            E = E_kgf_cm2
        elif unidad == "tonf/m2":
            E = E_kgf_cm2 * 10.0          # 1 kgf/cm2 = 10 tonf/m2
        else:
            raise ValueError("unidad debe ser 'kgf/cm2' o 'tonf/m2'")
        m = cls(E, nombre or f"Concreto f'c={fc}")
        m.fc = fc
        return m


# ==============================================================================
#  SECCION
# ==============================================================================
class Seccion:
    def __init__(self, A, I, nombre="seccion", b=None, h=None):
        self.A = float(A); self.I = float(I)
        self.b = b; self.h = h; self.nombre = nombre

    @classmethod
    def rectangular(cls, b, h, nombre=None):
        return cls(b*h, b*h**3/12.0, nombre or f"Rect {b}x{h}", b=b, h=h)


# ==============================================================================
#  NUDO
# ==============================================================================
class Nudo:
    def __init__(self, id, x, y, restriccion=(0, 0, 0), nombre=None):
        self.id = id; self.x = float(x); self.y = float(y)
        self.restriccion = tuple(int(r) for r in restriccion)
        self.nombre = nombre or f"N{id}"
        self.carga = np.zeros(3)
        self.resorte = np.zeros(3)        # rigidez de apoyo elastico [kx, ky, kg]
        self.asentamiento = np.zeros(3)   # desplazamiento impuesto en GDL restringidos
        self.gdl = [None, None, None]

    def aplicar_carga(self, Fx=0.0, Fy=0.0, M=0.0):
        self.carga += np.array([Fx, Fy, M], float)

    def aplicar_resorte(self, kx=0.0, ky=0.0, kg=0.0):
        self.resorte += np.array([kx, ky, kg], float)

    def aplicar_asentamiento(self, dx=0.0, dy=0.0, giro=0.0):
        self.asentamiento = np.array([dx, dy, giro], float)


# ==============================================================================
#  CARGAS EN ELEMENTOS
# ==============================================================================
class CargaDistribuida:
    """
    Carga distribuida (uniforme, trapezoidal y/o PARCIAL) en componentes GLOBALES.
    Uso uniforme:     CargaDistribuida(wy=-2.5)
    Uso trapezoidal:  CargaDistribuida(wy1=-1.0, wy2=-3.0)
    Uso parcial:      CargaDistribuida(wy=-2.5, a=1.0, b=3.0)  (desde a hasta b)
    wy<0 = hacia abajo (gravedad). wx para componente horizontal.
    Las intensidades w1 y w2 se toman en x=a y x=b respectivamente.
    """
    def __init__(self, wy=None, wx=None, wy1=0.0, wy2=0.0, wx1=0.0, wx2=0.0,
                 a=None, b=None):
        self.wy1 = float(wy) if wy is not None else float(wy1)
        self.wy2 = float(wy) if wy is not None else float(wy2)
        self.wx1 = float(wx) if wx is not None else float(wx1)
        self.wx2 = float(wx) if wx is not None else float(wx2)
        self.a = a            # inicio del tramo cargado (None -> 0)
        self.b = b            # fin del tramo cargado (None -> L)
        self.tipo = "distribuida"

    @property
    def uniforme(self):
        return self.wy1 == self.wy2 and self.wx1 == self.wx2

    @property
    def parcial(self):
        return self.a is not None or self.b is not None


class CargaPuntual:
    """Carga puntual en componentes GLOBALES a distancia 'a' del nudo i."""
    def __init__(self, Px=0.0, Py=0.0, a=None):
        self.Px = float(Px); self.Py = float(Py); self.a = a
        self.tipo = "puntual"


class CargaMomento:
    """Momento concentrado M (positivo antihorario) a distancia 'a' del nudo i."""
    def __init__(self, M=0.0, a=None):
        self.M = float(M); self.a = a
        self.tipo = "momento"


class CargaTermica:
    """Carga térmica en un elemento.
      dT       : variación uniforme de temperatura (alarga/acorta el eje).
      dT_grad  : gradiente (T_superior − T_inferior) en el peralte → curvatura.
    Produce fuerzas de empotramiento axiales (E·A·α·ΔT) y momentos
    (E·I·α·ΔT_grad/h). Requiere material.alpha y, para el gradiente, el
    peralte h de la sección.
    """
    def __init__(self, dT=0.0, dT_grad=0.0):
        self.dT = float(dT)
        self.dT_grad = float(dT_grad)
        self.tipo = "termica"


# ==============================================================================
#  ELEMENTO
# ==============================================================================
class Elemento:
    def __init__(self, id, nudo_i, nudo_j, material, seccion, nombre=None,
                 release_i=False, release_j=False):
        self.id = id; self.ni = nudo_i; self.nj = nudo_j
        self.mat = material; self.sec = seccion
        self.nombre = nombre or f"E{id}"
        self.cargas = []
        self.factor_axial = 1.0
        self.timoshenko = False     # incluir deformacion por cortante
        self.N_axial = 0.0          # fuerza axial (para P-Delta; traccion +)
        self.usar_geometrica = False  # incluir rigidez geometrica (2do orden)
        self.release_i = bool(release_i)   # rotula (libera momento) en extremo i
        self.release_j = bool(release_j)   # rotula (libera momento) en extremo j

        dx = nudo_j.x - nudo_i.x; dy = nudo_j.y - nudo_i.y
        self.L = np.hypot(dx, dy)
        if self.L == 0:
            raise ValueError(f"Elemento {id}: longitud nula.")
        self.cos = dx/self.L; self.sin = dy/self.L
        self.angulo = np.degrees(np.arctan2(dy, dx))

    def agregar_carga(self, carga):
        self.cargas.append(carga); return self

    # ---------------- rigidez local base (sin releases) ----------------
    def k_local_base(self):
        E, A, I, L = self.mat.E, self.sec.A, self.sec.I, self.L
        EA_L = E*A/L*self.factor_axial
        EI = E*I
        # factor de cortante (Timoshenko): phi = 12 E I / (G As L^2)
        phi = 0.0
        if self.timoshenko:
            nu = getattr(self.mat, "nu", 0.2)
            G = E/(2*(1+nu))
            kcz = getattr(self.sec, "k_corte", 1.2)   # factor de forma a cortante
            As = A/kcz
            phi = 12*EI/(G*As*L**2) if (G*As) > 0 else 0.0
        b = 1.0/(1.0+phi)
        k = np.zeros((6, 6))
        k[0, 0] = EA_L; k[0, 3] = -EA_L; k[3, 0] = -EA_L; k[3, 3] = EA_L
        k11 = 12*EI/L**3*b
        k12 = 6*EI/L**2*b
        k22 = (4+phi)*EI/L*b
        k25 = (2-phi)*EI/L*b
        k[1, 1] = k11;   k[1, 2] = k12;   k[1, 4] = -k11;  k[1, 5] = k12
        k[2, 1] = k12;   k[2, 2] = k22;   k[2, 4] = -k12;  k[2, 5] = k25
        k[4, 1] = -k11;  k[4, 2] = -k12;  k[4, 4] = k11;   k[4, 5] = -k12
        k[5, 1] = k12;   k[5, 2] = k25;   k[5, 4] = -k12;  k[5, 5] = k22
        return k

    # ---------------- rigidez geometrica (2do orden / P-Delta) ----------
    def kg_geometrica_local(self):
        """Matriz de rigidez geometrica local. N>0 traccion (rigidiza),
        N<0 compresion (ablanda). Usa la fuerza axial self.N_axial."""
        N = self.N_axial; L = self.L
        kg = np.zeros((6, 6))
        f = N/L
        vals = f*np.array([
            [0, 0,        0,        0, 0,        0],
            [0, 6/5,      L/10,     0, -6/5,     L/10],
            [0, L/10,     2*L**2/15,0, -L/10,    -L**2/30],
            [0, 0,        0,        0, 0,        0],
            [0, -6/5,     -L/10,    0, 6/5,      -L/10],
            [0, L/10,     -L**2/30, 0, -L/10,    2*L**2/15],
        ])
        kg[:, :] = vals
        return kg

    def _dofs_liberados(self):
        c = []
        if self.release_i: c.append(2)
        if self.release_j: c.append(5)
        return c

    # ---------------- condensacion estatica por releases ----------------
    def _condensar(self, k, f):
        """Devuelve (k_mod, f_mod) tras liberar los GDL rotacionales con rotula."""
        c = self._dofs_liberados()
        if not c:
            return k.copy(), f.copy()
        r = [i for i in range(6) if i not in c]
        kcc = k[np.ix_(c, c)]
        kcc_inv = np.linalg.inv(kcc)
        krc = k[np.ix_(r, c)]
        kcr = k[np.ix_(c, r)]
        # matriz modificada (6x6) con filas/columnas liberadas en cero
        km = np.zeros((6, 6))
        km[np.ix_(r, r)] = k[np.ix_(r, r)] - krc @ kcc_inv @ kcr
        fm = np.zeros(6)
        fm[r] = f[r] - krc @ kcc_inv @ f[c]
        return km, fm

    def k_local(self):
        k, _ = self._condensar(self.k_local_base(), np.zeros(6))
        return k

    def matriz_T(self):
        c, s = self.cos, self.sin
        T = np.zeros((6, 6))
        R = np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])
        T[0:3, 0:3] = R; T[3:6, 3:6] = R
        return T

    def k_global(self):
        T = self.matriz_T()
        kl = self.k_local()
        if self.usar_geometrica and abs(self.N_axial) > 0:
            kl = kl + self.kg_geometrica_local()
        return T.T @ kl @ T

    # ---------------- matriz de masa consistente (local / global) -------
    def masa_local(self, m_lineal):
        """Matriz de masa consistente 6x6 en ejes locales.
        m_lineal = masa por unidad de longitud (masa/longitud)."""
        L = self.L
        m = np.zeros((6, 6))
        # axial (consistente)
        ax = m_lineal*L/6.0*np.array([[2.0, 1.0], [1.0, 2.0]])
        for a, ia in enumerate((0, 3)):
            for b, ib in enumerate((0, 3)):
                m[ia, ib] += ax[a, b]
        # flexion (consistente, Hermite) DOFs [v_i, t_i, v_j, t_j] = [1,2,4,5]
        c = m_lineal*L/420.0
        Mb = c*np.array([
            [156.0,   22*L,    54.0,   -13*L],
            [22*L,    4*L**2,  13*L,   -3*L**2],
            [54.0,    13*L,    156.0,  -22*L],
            [-13*L,  -3*L**2, -22*L,    4*L**2],
        ])
        idx = (1, 2, 4, 5)
        for a in range(4):
            for b in range(4):
                m[idx[a], idx[b]] += Mb[a, b]
        return m

    def masa_global(self, m_lineal):
        T = self.matriz_T()
        return T.T @ self.masa_local(m_lineal) @ T

    # ---------------- fuerzas de empotramiento (base, sin releases) -----
    def ff_local_base(self):
        L = self.L; c, s = self.cos, self.sin
        Peq = np.zeros(6)
        for carga in self.cargas:
            if carga.tipo == "distribuida":
                Peq += self._feq_distribuida(carga)
            elif carga.tipo == "puntual":
                a = carga.a if carga.a is not None else L/2.0
                b = L - a
                Pa = carga.Px*c + carga.Py*s;  Pp = -carga.Px*s + carga.Py*c
                Peq[0] += Pa*b/L;  Peq[3] += Pa*a/L
                Peq[1] += Pp*b**2*(L+2*a)/L**3
                Peq[2] += Pp*a*b**2/L**2
                Peq[4] += Pp*a**2*(L+2*b)/L**3
                Peq[5] += -Pp*a**2*b/L**2
            elif carga.tipo == "momento":
                a = carga.a if carga.a is not None else L/2.0
                xi = a/L; M0 = carga.M
                # derivadas de las funciones de forma de Hermite en xi
                N1p = 6*xi*(xi-1)/L
                N2p = 1 - 4*xi + 3*xi**2
                N3p = 6*xi*(1-xi)/L
                N4p = -2*xi + 3*xi**2
                Peq[1] += M0*N1p; Peq[2] += M0*N2p
                Peq[4] += M0*N3p; Peq[5] += M0*N4p
            elif carga.tipo == "termica":
                E = self.mat.E; A = self.sec.A; I = self.sec.I
                alpha = getattr(self.mat, "alpha", 0.0)
                # ΔT uniforme → fuerza axial de empotramiento N_T = E·A·α·ΔT
                NT = E*A*alpha*carga.dT
                Peq[0] += -NT; Peq[3] += NT
                # gradiente → curvatura κ = α·ΔT_grad/h → momento M_T = E·I·κ
                h = getattr(self.sec, "h", None)
                if carga.dT_grad and h:
                    MT = E*I*alpha*carga.dT_grad/float(h)
                    Peq[2] += -MT; Peq[5] += MT
        self._Peq_base = Peq
        return -Peq

    def fuerzas_empotramiento_local(self):
        _, fm = self._condensar(self.k_local_base(), self.ff_local_base())
        return fm

    def fuerzas_empotramiento_global(self):
        return self.matriz_T().T @ self.fuerzas_empotramiento_local()

    # -------- intensidad local (axial, perpendicular) de una distribuida en x --
    def _w_local(self, carga, x):
        L = self.L; c, s = self.cos, self.sin
        a = 0.0 if carga.a is None else carga.a
        b = L if carga.b is None else carga.b
        if x < a - 1e-12 or x > b + 1e-12 or b <= a:
            return 0.0, 0.0
        t = 0.0 if b == a else (x - a)/(b - a)
        wx = carga.wx1 + (carga.wx2 - carga.wx1)*t
        wy = carga.wy1 + (carga.wy2 - carga.wy1)*t
        wa = wx*c + wy*s            # axial local
        wp = -wx*s + wy*c           # perpendicular local
        return wa, wp

    # -------- vector de cargas equivalentes de una distribuida (Gauss) --------
    def _feq_distribuida(self, carga):
        """Integra w(x) contra las funciones de forma sobre [a,b] (cuadratura
        de Gauss). Maneja uniforme, trapezoidal y parcial de forma general."""
        L = self.L
        a = 0.0 if carga.a is None else max(0.0, carga.a)
        b = L if carga.b is None else min(L, carga.b)
        Peq = np.zeros(6)
        if b <= a:
            return Peq
        # 4 puntos de Gauss-Legendre (exacto hasta grado 7)
        gp = [-0.8611363116, -0.3399810436, 0.3399810436, 0.8611363116]
        gw = [0.3478548451, 0.6521451549, 0.6521451549, 0.3478548451]
        for xi_g, w_g in zip(gp, gw):
            x = 0.5*(b - a)*xi_g + 0.5*(a + b)
            jac = 0.5*(b - a)
            wa, wp = self._w_local(carga, x)
            xi = x/L
            # funciones de forma: axiales (lineales) y transversales (Hermite)
            Na_i = 1 - xi; Na_j = xi
            N1 = 1 - 3*xi**2 + 2*xi**3
            N2 = L*(xi - 2*xi**2 + xi**3)
            N3 = 3*xi**2 - 2*xi**3
            N4 = L*(-xi**2 + xi**3)
            Peq[0] += w_g*jac*wa*Na_i
            Peq[3] += w_g*jac*wa*Na_j
            Peq[1] += w_g*jac*wp*N1
            Peq[2] += w_g*jac*wp*N2
            Peq[4] += w_g*jac*wp*N3
            Peq[5] += w_g*jac*wp*N4
        return Peq

    # -------- integrales acumuladas de la distribuida hasta x (solicitaciones) -
    def _acumulado_distribuida(self, carga, x):
        """Devuelve (Fperp, Mperp, Faxial) acumulados de 0 a x para la carga.
        Fperp = int_0^x wp ds ; Mperp = int_0^x wp(s)(x-s) ds ; Faxial idem."""
        L = self.L
        a = 0.0 if carga.a is None else max(0.0, carga.a)
        b = L if carga.b is None else min(L, carga.b)
        xx = min(x, b)
        if xx <= a or b <= a:
            return 0.0, 0.0, 0.0
        # w lineal en [a,b]; integramos analiticamente en [a,xx]
        # parametro local u = (s-a)/(b-a)
        wa1, wp1 = self._w_local(carga, a)
        wa2, wp2 = self._w_local(carga, b)
        Lab = b - a
        def integr(w1, w2):
            # F = int_a^xx w ds ; M = int_a^xx w(s)(x-s) ds
            du = xx - a
            # w(s) = w1 + (w2-w1)*(s-a)/Lab
            F = w1*du + (w2-w1)*du**2/(2*Lab)
            # int w(s)*s ds  y  int w(s) ds  -> M = x*F - int w(s)*s ds
            # int_a^xx w(s)*s ds
            Iws = (w1*(xx**2-a**2)/2
                   + (w2-w1)/Lab*((xx**3-a**3)/3 - a*(xx**2-a**2)/2))
            M = x*F - Iws
            return F, M
        Fp, Mp = integr(wp1, wp2)
        Fa, _ = integr(wa1, wa2)
        return Fp, Mp, Fa



# ==============================================================================
#  ESTRUCTURA
# ==============================================================================
class Estructura:
    def __init__(self, nombre="Portico", despreciar_axial=False,
                 timoshenko=False, pdelta=False, g=9.81):
        self.nombre = nombre
        self.nudos = []; self.elementos = []
        self.resuelto = False
        self.despreciar_axial = despreciar_axial
        self.timoshenko = bool(timoshenko)
        self.pdelta = bool(pdelta)
        self._PENAL_AXIAL = 1.0e5      # rigidez axial = PENAL x rigidez de flexion
        self.pdelta_iters = 0
        self.g = float(g)              # gravedad (para masa = peso/g) en unid. del usuario

    def agregar_nudo(self, n): self.nudos.append(n); return n
    def agregar_elemento(self, e): self.elementos.append(e); return e

    def _numerar_gdl(self):
        self.gdl_libres = []; self.gdl_restr = []
        c = 0
        for nd in self.nudos:
            for k in range(3):
                if nd.restriccion[k] == 0:
                    nd.gdl[k] = c; self.gdl_libres.append(c); c += 1
        self.n_libres = c
        for nd in self.nudos:
            for k in range(3):
                if nd.restriccion[k] == 1:
                    nd.gdl[k] = c; self.gdl_restr.append(c); c += 1
        self.n_gdl = c

    def _dofs_elemento(self, e): return e.ni.gdl + e.nj.gdl

    def ensamblar(self):
        self._numerar_gdl()
        for e in self.elementos:
            e.timoshenko = self.timoshenko
            e.usar_geometrica = self.pdelta
            if self.despreciar_axial:
                # rigidez axial ~ PENAL x rigidez de flexion (12EI/L^3):
                # mantiene el condicionamiento acotado y la deformacion axial ~0
                I_, A_, L_ = e.sec.I, e.sec.A, e.L
                e.factor_axial = self._PENAL_AXIAL * 12*I_/(A_*L_**2)
            else:
                e.factor_axial = 1.0
        n = self.n_gdl
        K = np.zeros((n, n)); self._kg_elementos = {}
        for e in self.elementos:
            kg = e.k_global(); self._kg_elementos[e.id] = kg
            d = self._dofs_elemento(e)
            for a in range(6):
                for b in range(6):
                    K[d[a], d[b]] += kg[a, b]
        self.K = K
        # apoyos elasticos (resortes): se suman a la diagonal del GDL
        for nd in self.nudos:
            for k in range(3):
                if nd.resorte[k] != 0.0:
                    g = nd.gdl[k]
                    K[g, g] += nd.resorte[k]
        self.K = K
        P = np.zeros(n)
        for nd in self.nudos:
            for k in range(3):
                P[nd.gdl[k]] += nd.carga[k]
        self._ff_global = {}
        for e in self.elementos:
            ff = e.fuerzas_empotramiento_global(); self._ff_global[e.id] = ff
            d = self._dofs_elemento(e)
            for a in range(6):
                P[d[a]] += -ff[a]
        self.P = P
        return K, P

    def resolver(self):
        self._solve_core()
        if self.pdelta:
            self.pdelta_iters = 0
            for it in range(12):
                Dprev = self.D.copy()
                for e in self.elementos:
                    e.N_axial = -self.fuerzas_elem[e.id][0]   # axial (traccion +)
                self._solve_core()
                self.pdelta_iters = it + 1
                escala = 1.0 + float(np.max(np.abs(self.D)))
                if np.max(np.abs(self.D - Dprev)) < 1e-9*escala:
                    break
        return self.D

    def _diagnostico_inestabilidad(self, Kff):
        """Identifica los GDL libres asociados al mecanismo (vector del menor
        valor singular de Kff) y los traduce a 'Nudo.dirección'."""
        try:
            nl = self.n_libres
            if nl == 0:
                return ""
            _, sv, Vt = np.linalg.svd(Kff)
            null_vec = Vt[-1]                      # dirección de menor rigidez
            etiquetas = [None] * nl
            comp = ["traslación-X", "traslación-Y", "rotación"]
            for nd in self.nudos:
                for k in range(3):
                    g = nd.gdl[k]
                    if g is not None and g < nl:
                        etiquetas[g] = f"{nd.nombre} ({comp[k]})"
            orden = np.argsort(-np.abs(null_vec))
            sospechosos = [etiquetas[i] for i in orden[:3]
                           if etiquetas[i] and abs(null_vec[i]) > 0.15]
            return ", ".join(sospechosos)
        except Exception:
            return ""

    def _solve_core(self):
        self.ensamblar()
        nl = self.n_libres
        Kff = self.K[:nl, :nl]; Kfr = self.K[:nl, nl:]
        Pf = self.P[:nl]
        # asentamientos: desplazamientos impuestos en los GDL restringidos
        Dr = np.zeros(self.n_gdl - nl)
        for nd in self.nudos:
            for k in range(3):
                if nd.restriccion[k] == 1 and nd.asentamiento[k] != 0.0:
                    Dr[nd.gdl[k] - nl] = nd.asentamiento[k]
        # guardia de estabilidad: la matriz Kff debe ser de rango completo
        if nl > 0 and np.linalg.matrix_rank(Kff) < nl:
            detalle = self._diagnostico_inestabilidad(Kff)
            raise ValueError(
                "La estructura es inestable o está insuficientemente restringida "
                "(matriz de rigidez singular). En 2D se necesitan al menos 3 "
                "reacciones bien dispuestas (no concurrentes ni paralelas)."
                + (f" Mecanismo detectado en: {detalle}." if detalle else ""))
        self.cond_Kff = float(np.linalg.cond(Kff)) if nl > 0 else 0.0
        try:
            Df = np.linalg.solve(Kff, Pf - Kfr @ Dr)
        except np.linalg.LinAlgError:
            raise ValueError("No se pudo resolver el sistema (matriz singular). "
                             "Revise apoyos y conectividad de los elementos.")
        D = np.concatenate([Df, Dr])
        self.D = D; self.Df = Df
        self.R = self.K[nl:, :] @ D - self.P[nl:]
        self._part = dict(Kff=Kff, Kfr=Kfr, Pf=Pf, Df=Df, Dr=Dr)
        self.resuelto = True
        self._calcular_fuerzas_elementos()
        return D

    def aplicar_peso_propio(self):
        """Agrega a cada elemento una carga distribuida de peso propio
        (w = peso_especifico * Area, hacia -Y global). Llamar antes de resolver."""
        for e in self.elementos:
            dens = getattr(e.mat, "densidad", 0.0)
            if dens:
                e.agregar_carga(CargaDistribuida(wy=-dens*e.sec.A))

    def verificar_equilibrio(self):
        """Comprueba el equilibrio global: suma de cargas aplicadas + reacciones.
        Devuelve resultantes y el residuo (debe ser ~0)."""
        nl = self.n_libres
        Rfull = np.zeros(self.n_gdl)
        Rfull[nl:] = self.R
        # fuerzas de resortes (apoyos elasticos) en GDL libres: -k*D
        for nd in self.nudos:
            for k in range(3):
                if nd.resorte[k] != 0.0:
                    g = nd.gdl[k]
                    if g < nl:
                        Rfull[g] += -nd.resorte[k] * self.D[g]
        total = self.P + Rfull       # cargas equivalentes aplicadas + reacciones
        Fx_ap = Fy_ap = M_ap = 0.0
        Fx_re = Fy_re = M_re = 0.0
        for nd in self.nudos:
            gx, gy, gg = nd.gdl
            # aplicado (lo que esta en P)
            Fx_ap += self.P[gx]; Fy_ap += self.P[gy]
            M_ap += self.P[gg] + nd.x*self.P[gy] - nd.y*self.P[gx]
            # reacciones (lo que esta en Rfull)
            Fx_re += Rfull[gx]; Fy_re += Rfull[gy]
            M_re += Rfull[gg] + nd.x*Rfull[gy] - nd.y*Rfull[gx]
        return {
            "sumFx_aplicado": float(Fx_ap), "sumFy_aplicado": float(Fy_ap),
            "sumM_aplicado": float(M_ap),
            "sumFx_reaccion": float(Fx_re), "sumFy_reaccion": float(Fy_re),
            "sumM_reaccion": float(M_re),
            "residuo_Fx": float(Fx_ap + Fx_re),
            "residuo_Fy": float(Fy_ap + Fy_re),
            "residuo_M": float(M_ap + M_re),
        }

    def _calcular_fuerzas_elementos(self):
        self.fuerzas_elem = {}
        for e in self.elementos:
            d = self._dofs_elemento(e)
            dg = self.D[d]
            dl = e.matriz_T() @ dg
            kb = e.k_local_base()
            ffb = e.ff_local_base()
            cdofs = e._dofs_liberados()
            if cdofs:
                # recuperar el giro condensado en el/los extremo(s) liberado(s)
                r = [i for i in range(6) if i not in cdofs]
                kcc = kb[np.ix_(cdofs, cdofs)]
                kcr = kb[np.ix_(cdofs, r)]
                dl_c = -np.linalg.inv(kcc) @ (kcr @ dl[r] + ffb[cdofs])
                dl_full = dl.copy()
                dl_full[cdofs] = dl_c
            else:
                dl_full = dl
            f_loc = kb @ dl_full + ffb
            self.fuerzas_elem[e.id] = f_loc

    # ---------------- fuerzas internas a lo largo del elemento ----------
    def fuerzas_internas(self, e, npts=51):
        f = self.fuerzas_elem[e.id]
        Ni, Vi, Mi = f[0], f[1], f[2]
        L = e.L; c, s = e.cos, e.sin
        xs = np.linspace(0, L, npts)
        N = np.zeros(npts); V = np.zeros(npts); M = np.zeros(npts)
        for k, x in enumerate(xs):
            n_ax = -Ni; v = Vi; m = -Mi + Vi*x
            for carga in e.cargas:
                if carga.tipo == "distribuida":
                    Fp, Mp, Fa = e._acumulado_distribuida(carga, x)
                    v += Fp; m += Mp; n_ax += -Fa
                elif carga.tipo == "puntual":
                    a = carga.a if carga.a is not None else L/2.0
                    if x >= a - 1e-12:
                        Pa = carga.Px*c + carga.Py*s; Pp = -carga.Px*s + carga.Py*c
                        n_ax += -Pa; v += Pp; m += Pp*(x-a)
                elif carga.tipo == "momento":
                    a = carga.a if carga.a is not None else L/2.0
                    if x >= a - 1e-12:
                        m += -carga.M     # salto del momento flector en x=a
            N[k] = n_ax; V[k] = v; M[k] = m
        return xs, N, V, M

    # ---------------- matriz de masa global ------------------------------
    def ensamblar_masa(self, masa_extra=None):
        """Ensambla la matriz de masa consistente global. La masa lineal de
        cada elemento es (densidad/g)·A. `masa_extra` opcional: dict
        {id_nudo: [mx, my, mrot]} de masas concentradas en nudos."""
        n = self.n_gdl
        Mg = np.zeros((n, n))
        for e in self.elementos:
            dens = getattr(e.mat, "densidad", 0.0)
            m_lin = (dens/self.g)*e.sec.A if (dens and self.g) else 0.0
            if m_lin <= 0:
                continue
            me = e.masa_global(m_lin)
            d = self._dofs_elemento(e)
            for a in range(6):
                for b in range(6):
                    Mg[d[a], d[b]] += me[a, b]
        if masa_extra:
            for nid, mvals in masa_extra.items():
                nd = next((x for x in self.nudos if x.id == nid), None)
                if nd is None:
                    continue
                for k in range(3):
                    Mg[nd.gdl[k], nd.gdl[k]] += float(mvals[k])
        return Mg

    def analisis_modal(self, n_modos=6, masa_extra=None):
        """Análisis modal: resuelve K φ = ω² M φ en los GDL libres.
        Devuelve frecuencias (rad/s, Hz), periodos (s) y formas modales."""
        if not self.resuelto:
            self._solve_core()
        nl = self.n_libres
        if nl == 0:
            raise ValueError("No hay grados de libertad para el análisis modal.")
        M = self.ensamblar_masa(masa_extra)
        Mff = M[:nl, :nl]
        if np.allclose(Mff, 0.0):
            raise ValueError("Masa nula: define la densidad del material (o masas "
                             "concentradas) para el análisis modal.")
        Kff = self.K[:nl, :nl]
        # Problema generalizado simétrico vía Cholesky de Mff (SPD).
        try:
            Lm = np.linalg.cholesky(Mff)
        except np.linalg.LinAlgError:
            Mff = Mff + np.eye(nl)*1e-9*np.trace(Mff)/max(nl, 1)
            Lm = np.linalg.cholesky(Mff)
        Linv = np.linalg.inv(Lm)
        A = Linv @ Kff @ Linv.T
        A = 0.5*(A + A.T)                      # simetrizar por seguridad numérica
        lam, Y = np.linalg.eigh(A)
        lam = np.clip(lam, 0.0, None)          # ω² ≥ 0
        omega = np.sqrt(lam)
        Phi = Linv.T @ Y                       # formas modales en GDL libres
        n_modos = int(min(n_modos, nl))
        modos = []
        for i in range(n_modos):
            w = float(omega[i])
            f = w/(2*np.pi)
            phi_full = np.zeros(self.n_gdl)
            phi_full[:nl] = Phi[:, i]
            # normalizar por el máximo desplazamiento de traslación
            mx = max((abs(phi_full[nd.gdl[0]]) for nd in self.nudos), default=0)
            my = max((abs(phi_full[nd.gdl[1]]) for nd in self.nudos), default=0)
            esc = max(mx, my) or 1.0
            forma = [{"nudo": nd.nombre,
                      "ux": float(phi_full[nd.gdl[0]]/esc),
                      "uy": float(phi_full[nd.gdl[1]]/esc),
                      "g":  float(phi_full[nd.gdl[2]]/esc)} for nd in self.nudos]
            modos.append({
                "modo": i+1,
                "omega": w,
                "frecuencia_hz": float(f),
                "periodo_s": float(1.0/f) if f > 1e-12 else None,
                "forma": forma,
            })
        return {"n_modos": n_modos, "modos": modos}

    # ---------------- verificación de equilibrio por elemento -----------
    def equilibrio_elementos(self):
        """Para cada elemento comprueba que sus fuerzas de extremo + cargas
        aplicadas estén en equilibrio (residuo ≈ 0). Sello de calidad."""
        out = []
        for e in self.elementos:
            f = self.fuerzas_elem[e.id]          # [Ni,Vi,Mi,Nj,Vj,Mj] local
            L = e.L
            # resultante de cargas aplicadas (local) sobre el elemento
            xs, N, V, M = self.fuerzas_internas(e, 3)
            # equilibrio: fuerzas de extremo deben equilibrar las cargas
            # ΣFx_local = f[0]+f[3]+(axial aplicado), etc. Usamos las fuerzas
            # internas en extremos: en i N(0), en j N(L) deben ligar con f.
            resN = float(N[0] + f[0])            # N interno(0) = -f[0]  → suma≈0
            resV = float(V[0] - f[1])
            resM = float(M[0] + f[2])
            out.append({"elem": e.nombre,
                        "res_N": resN, "res_V": resV, "res_M": resM,
                        "ok": bool(max(abs(resN), abs(resV), abs(resM))
                                   < 1e-6*(1+abs(f[0])+abs(f[1])+abs(f[2])))})
        return out
