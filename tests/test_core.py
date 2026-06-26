# -*- coding: utf-8 -*-
"""
Suite de validación del motor matricial contra soluciones analíticas conocidas.
Ejecutar:  python -m pytest tests/ -v     (desde analisis_estructural_web/)
Blinda contra regresiones de signo, unidades y convención de diagramas.
"""
import os
import sys
import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.metodo_rigidez import (Material, Seccion, Nudo, Elemento,
                                 CargaDistribuida, CargaPuntual, CargaMomento,
                                 CargaTermica, Estructura)
from core.constructor import construir, extraer_resultados


def _viga(restr_i, restr_j, L=6.0, E=2e7, b=0.3, h=0.6):
    est = Estructura()
    mat = Material(E); sec = Seccion.rectangular(b, h)
    n1 = Nudo(1, 0, 0, restr_i); n2 = Nudo(2, L, 0, restr_j)
    est.agregar_nudo(n1); est.agregar_nudo(n2)
    e = Elemento(1, n1, n2, mat, sec)
    est.agregar_elemento(e)
    return est, e, n1, n2


# ----------------------------------------------------------------------
#  SIGNOS Y MAGNITUDES — casos canónicos
# ----------------------------------------------------------------------
def test_viga_simple_udl_sagging_positivo():
    """Viga simple, UDL hacia abajo: Mmax=+wL²/8 (sagging), R=wL/2."""
    est, e, n1, n2 = _viga((1, 1, 0), (0, 1, 0), L=6)
    w = 10.0
    e.agregar_carga(CargaDistribuida(wy=-w))
    est.resolver()
    xs, N, V, M = est.fuerzas_internas(e, 101)
    assert M.max() == pytest.approx(w*6**2/8, rel=1e-3)   # +45 sagging
    assert M.min() == pytest.approx(0, abs=1e-6)
    assert V[0] == pytest.approx(w*6/2, rel=1e-3)         # +30
    assert V[-1] == pytest.approx(-w*6/2, rel=1e-3)       # -30
    assert np.allclose(N, 0, atol=1e-6)


def test_voladizo_punta_hogging_negativo():
    """Voladizo, carga puntual abajo en la punta: Mbase=-PL (hogging)."""
    est, e, n1, n2 = _viga((1, 1, 1), (0, 0, 0), L=4)
    P = 5.0
    e.agregar_carga(CargaPuntual(Py=-P, a=4))
    est.resolver()
    xs, N, V, M = est.fuerzas_internas(e, 51)
    assert M[0] == pytest.approx(-P*4, rel=1e-3)          # -20 hogging
    assert M[-1] == pytest.approx(0, abs=1e-6)
    assert V[0] == pytest.approx(P, rel=1e-3)             # +5


def test_axial_traccion_positiva():
    """Barra con fuerza axial de tracción: N=+P (tracción positiva)."""
    est, e, n1, n2 = _viga((1, 1, 1), (0, 0, 0), L=5)
    n2.aplicar_carga(Fx=8.0)
    est.resolver()
    xs, N, V, M = est.fuerzas_internas(e, 11)
    assert np.allclose(N, 8.0, rtol=1e-3)                 # tracción +


def test_momento_aplicado_salto():
    """Momento aplicado a media luz: salto en el DMF de magnitud M0."""
    est, e, n1, n2 = _viga((1, 1, 0), (0, 1, 0), L=6)
    e.agregar_carga(CargaMomento(M=30.0, a=3))
    est.resolver()
    xs, N, V, M = est.fuerzas_internas(e, 601)
    salto = abs(M[xs >= 3][0] - M[xs < 3][-1])
    assert salto == pytest.approx(30.0, rel=2e-2)


def test_inclinado_carga_perpendicular():
    """Voladizo inclinado 45°, carga perpendicular: Mbase=-wp·L²/2."""
    import math
    c = math.sqrt(0.5)
    est = Estructura()
    mat = Material(2e7); sec = Seccion.rectangular(0.3, 0.6)
    n1 = Nudo(1, 0, 0, (1, 1, 1)); n2 = Nudo(2, 3, 3, (0, 0, 0))
    est.agregar_nudo(n1); est.agregar_nudo(n2)
    e = Elemento(1, n1, n2, mat, sec)
    # perpendicular q=-10 → global (wx,wy)=q·(-sin,cos)
    e.agregar_carga(CargaDistribuida(wx=-10*(-c), wy=-10*c))
    est.agregar_elemento(e); est.resolver()
    xs, N, V, M = est.fuerzas_internas(e, 51)
    L = e.L
    assert M[0] == pytest.approx(-10*L*L/2, rel=1e-3)


# ----------------------------------------------------------------------
#  UNIDADES — agnóstico (mismo problema físico)
# ----------------------------------------------------------------------
def test_unidades_consistentes_tonf_vs_kn():
    """El mismo problema físico en tonf y kN: forces escalan ×g, flecha igual."""
    g = 9.81
    def run(unidad, P, E):
        d = {"unidad": unidad, "material": {"modo": "E", "E": E},
             "secciones": [{"nombre": "s", "modo": "calc", "tipo": "rectangular", "b": 0.3, "h": 0.6}],
             "nudos": [{"id": 1, "x": 0, "y": 0, "apoyo": "empotrado"},
                       {"id": 2, "x": 4, "y": 0, "apoyo": "libre"}],
             "elementos": [{"id": 1, "i": 1, "j": 2, "seccion": "s"}],
             "cargas_nodales": [{"nudo": 2, "Fy": P}], "cargas_elementos": []}
        est = construir(d); est.resolver(); r = extraer_resultados(est)
        return r["resumen"]["Mmax"], r["resumen"]["umax"]
    Mt, ut = run("tonf_m", -5.0, 2.0e6)
    Mk, uk = run("kN_m", -5.0*g, 2.0e6*g)
    assert Mk == pytest.approx(Mt*g, rel=1e-4)            # fuerzas ×g
    assert uk == pytest.approx(ut, rel=1e-4)              # flecha física igual


# ----------------------------------------------------------------------
#  EQUILIBRIO GLOBAL
# ----------------------------------------------------------------------
def test_equilibrio_global_portico():
    d = {"unidad": "kN_m", "material": {"modo": "E", "E": 2.1e7},
         "secciones": [{"nombre": "s", "modo": "calc", "tipo": "rectangular", "b": 0.3, "h": 0.3}],
         "nudos": [{"id": 1, "x": 0, "y": 0, "apoyo": "empotrado"},
                   {"id": 2, "x": 0, "y": 3, "apoyo": "libre"},
                   {"id": 3, "x": 4, "y": 3, "apoyo": "libre"},
                   {"id": 4, "x": 4, "y": 0, "apoyo": "empotrado"}],
         "elementos": [{"id": 1, "i": 1, "j": 2, "seccion": "s"},
                       {"id": 2, "i": 2, "j": 3, "seccion": "s"},
                       {"id": 3, "i": 4, "j": 3, "seccion": "s"}],
         "cargas_nodales": [{"nudo": 2, "Fx": 17}],
         "cargas_elementos": [{"elem": 2, "tipo": "distribuida", "subtipo": "uniforme", "wy": -10}]}
    est = construir(d); est.resolver()
    eq = est.verificar_equilibrio()
    assert abs(eq["residuo_Fx"]) < 1e-6
    assert abs(eq["residuo_Fy"]) < 1e-6
    assert abs(eq["residuo_M"]) < 1e-6


# ----------------------------------------------------------------------
#  TÉRMICA
# ----------------------------------------------------------------------
def test_termica_biempotrada():
    """Barra biempotrada con ΔT: N=-E·A·α·ΔT (compresión al calentar)."""
    E, A, alpha, dT = 2.1e7, 0.09, 1e-5, 50.0
    est = Estructura()
    mat = Material(E, alpha=alpha); sec = Seccion.rectangular(0.3, 0.3)
    n1 = Nudo(1, 0, 0, (1, 1, 1)); n2 = Nudo(2, 6, 0, (1, 1, 1))
    est.agregar_nudo(n1); est.agregar_nudo(n2)
    e = Elemento(1, n1, n2, mat, sec); e.agregar_carga(CargaTermica(dT=dT))
    est.agregar_elemento(e); est.resolver()
    xs, N, V, M = est.fuerzas_internas(e, 3)
    assert N[0] == pytest.approx(-E*A*alpha*dT, rel=1e-3)


def test_termica_libre_sin_esfuerzo():
    """Barra con un extremo libre: ΔT no produce esfuerzo (dilatación libre)."""
    est = Estructura()
    mat = Material(2.1e7, alpha=1e-5); sec = Seccion.rectangular(0.3, 0.3)
    n1 = Nudo(1, 0, 0, (1, 1, 1)); n2 = Nudo(2, 6, 0, (0, 0, 0))
    est.agregar_nudo(n1); est.agregar_nudo(n2)
    e = Elemento(1, n1, n2, mat, sec); e.agregar_carga(CargaTermica(dT=50))
    est.agregar_elemento(e); est.resolver()
    xs, N, V, M = est.fuerzas_internas(e, 3)
    assert np.allclose(N, 0, atol=1e-6)


# ----------------------------------------------------------------------
#  MODAL
# ----------------------------------------------------------------------
def test_modal_voladizo_primera_frecuencia():
    """Voladizo: f1 ≈ (1.875²/2π)·√(EI/mL⁴) (Euler-Bernoulli)."""
    E, b, h, L, dens = 2.1e7, 0.3, 0.3, 3.0, 24.0
    I = b*h**3/12; A = b*h
    est = Estructura(g=9.81)
    mat = Material(E, densidad=dens); sec = Seccion.rectangular(b, h)
    n1 = Nudo(1, 0, 0, (1, 1, 1)); n2 = Nudo(2, 0, L, (0, 0, 0))
    est.agregar_nudo(n1); est.agregar_nudo(n2)
    e = Elemento(1, n1, n2, mat, sec); est.agregar_elemento(e)
    est.resolver()
    res = est.analisis_modal(n_modos=3)
    m_lin = dens/9.81*A
    f_teo = (1.875**2/(2*np.pi))*np.sqrt(E*I/(m_lin*L**4))
    assert res["modos"][0]["frecuencia_hz"] == pytest.approx(f_teo, rel=2e-2)


# ----------------------------------------------------------------------
#  ROBUSTEZ
# ----------------------------------------------------------------------
def test_inestabilidad_detectada():
    est = Estructura()
    mat = Material(2e7); sec = Seccion.rectangular(0.3, 0.5)
    n1 = Nudo(1, 0, 0, (0, 1, 0)); n2 = Nudo(2, 5, 0, (0, 0, 0))
    est.agregar_nudo(n1); est.agregar_nudo(n2)
    e = Elemento(1, n1, n2, mat, sec); est.agregar_elemento(e)
    with pytest.raises(ValueError):
        est.resolver()
