# -*- coding: utf-8 -*-
"""
Calculadora de propiedades de seccion transversal.
Devuelve (A, I) para flexion respecto al eje horizontal (fuerte) del plano.
Todas las dimensiones en metros; A en m2, I en m4.
"""
import math


def rectangular(b, h):
    """Rectangulo macizo b x h."""
    A = b * h
    I = b * h**3 / 12.0
    return A, I


def cajon(b, h, e):
    """Rectangular hueco (cajon/tubular rectangular), pared de espesor e."""
    bi, hi = b - 2*e, h - 2*e
    if bi <= 0 or hi <= 0:
        raise ValueError("El espesor es demasiado grande para la seccion.")
    A = b*h - bi*hi
    I = (b*h**3 - bi*hi**3) / 12.0
    return A, I


def circular(d):
    """Circulo macizo de diametro d."""
    A = math.pi * d**2 / 4.0
    I = math.pi * d**4 / 64.0
    return A, I


def tubular(d, e):
    """Circular hueco (tubo), diametro exterior d, pared e."""
    di = d - 2*e
    if di <= 0:
        raise ValueError("El espesor es demasiado grande para el tubo.")
    A = math.pi * (d**2 - di**2) / 4.0
    I = math.pi * (d**4 - di**4) / 64.0
    return A, I


def perfil_I(b, h, tf, tw):
    """Perfil I doblemente simetrico: ancho de ala b, altura total h,
    espesor de ala tf, espesor de alma tw. Eje fuerte (horizontal)."""
    hw = h - 2*tf
    if hw <= 0:
        raise ValueError("Las alas no caben en la altura indicada.")
    A = 2*b*tf + hw*tw
    I = (b*h**3 - (b - tw)*hw**3) / 12.0
    return A, I


def perfil_T(b, h, tf, tw):
    """Perfil T: ala de ancho b y espesor tf arriba, alma de altura (h-tf)
    y espesor tw. Eje horizontal por el centroide (parallel axis)."""
    hw = h - tf
    A_ala, A_alma = b*tf, hw*tw
    A = A_ala + A_alma
    # centroide desde el borde superior
    y_ala = tf/2.0
    y_alma = tf + hw/2.0
    yc = (A_ala*y_ala + A_alma*y_alma) / A
    I = (b*tf**3/12.0 + A_ala*(yc - y_ala)**2 +
         tw*hw**3/12.0 + A_alma*(yc - y_alma)**2)
    return A, I


# Registro: tipo -> (funcion, [campos requeridos], etiqueta)
TIPOS = {
    "rectangular": (rectangular, ["b", "h"],            "Rectangular maciza (b×h)"),
    "cajon":       (cajon,       ["b", "h", "e"],       "Cajón hueco (b×h, pared e)"),
    "circular":    (circular,    ["d"],                 "Circular maciza (Ø d)"),
    "tubular":     (tubular,     ["d", "e"],            "Tubo circular (Ø d, pared e)"),
    "perfil_I":    (perfil_I,    ["b", "h", "tf", "tw"],"Perfil I (b,h,tf,tw)"),
    "perfil_T":    (perfil_T,    ["b", "h", "tf", "tw"],"Perfil T (b,h,tf,tw)"),
}


def calcular(tipo, **dims):
    """Calcula (A, I) segun el tipo y dimensiones dadas."""
    if tipo not in TIPOS:
        raise ValueError(f"Tipo de seccion desconocido: {tipo}")
    func, campos, _ = TIPOS[tipo]
    args = {k: float(dims[k]) for k in campos}
    return func(**args)
