# -*- coding: utf-8 -*-
"""Lectura de un ejercicio desde foto: la respuesta de Azure OpenAI se simula (sin red)."""
import base64
import copy
import io
import json
import os
import sys
import urllib.error

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import ia_ejercicio as ia  # noqa: E402

IMAGEN = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff" + b"0" * 500).decode()

MODELO_IA = {
    "nombre": "Pórtico de un vano",
    "unidad_fuerza": "tonf", "unidad_longitud": "m", "despreciar_axial": True,
    "material": {"modo": "fc", "fc": 210},
    "secciones": [{"nombre": "C", "modo": "rect", "b": 0.3, "h": 0.4}, {"nombre": "V", "modo": "rect", "b": 0.25, "h": 0.5}],
    "nudos": [{"id": 1, "x": 0, "y": 0, "apoyo": "empotrado"}, {"id": 2, "x": 0, "y": 3, "apoyo": "libre"},
              {"id": 3, "x": 5, "y": 3, "apoyo": "libre"}, {"id": 4, "x": 5, "y": 0, "apoyo": "fijo"}],
    "elementos": [{"id": 1, "i": 1, "j": 2, "seccion": "C", "nombre": "C1"},
                  {"id": 2, "i": 2, "j": 3, "seccion": "V", "nombre": "V1"},
                  {"id": 3, "i": 4, "j": 3, "seccion": "C", "nombre": "C2"}],
    "cargas_nodales": [{"nudo": 2, "Fx": 3, "Fy": 0, "M": 0}],
    "cargas_elementos": [{"elem": 2, "tipo": "distribuida", "subtipo": "uniforme", "wx": 0, "wy": -2},
                         {"elem": 2, "tipo": "puntual", "Px": 0, "Py": -4, "a": 2.5}],
    "supuestos": ["Altura de columnas no acotada: se tomó 3 m."],
    "dudas": ["¿El apoyo derecho es articulado?"],
}


class _Resp(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False


def _azure(contenido, capturar=None):
    def abrir(req, timeout=None):
        if capturar is not None:
            capturar["req"] = req; capturar["timeout"] = timeout
        return _Resp(json.dumps({"choices": [{"message": {"content": contenido}}]}).encode())
    return abrir


@pytest.fixture
def config(monkeypatch):
    monkeypatch.setenv("AE_IA_URL", "https://ejemplo.invalid/openai/deployments/m/chat/completions?api-version=x")
    monkeypatch.setenv("AE_IA_LLAVE", "llave-de-prueba")


def test_lee_modelo_valido(config):
    cap = {}
    r = ia.leer_ejercicio(IMAGEN, abrir=_azure(json.dumps(MODELO_IA), cap))
    m = r["modelo"]
    assert len(m["nudos"]) == 4 and len(m["elementos"]) == 3
    assert m["material"] == {"modo": "fc", "fc": 210.0}
    assert m["despreciar_axial"] is True
    assert r["supuestos"] and r["dudas"]
    # la imagen va como image_url y la llave en la cabecera, no en la URL
    cuerpo = json.loads(cap["req"].data)
    partes = cuerpo["messages"][0]["content"]
    assert partes[1] == {"type": "image_url", "image_url": {"url": IMAGEN}}
    assert cap["req"].get_header("Api-key") == "llave-de-prueba"
    assert "llave" not in cap["req"].full_url
    assert cap["timeout"] == ia.TIMEOUT_S


def test_se_resuelve_con_el_metodo_del_profesor(config):
    from core.constructor import construir
    from core.metodo_profesor import resolver_profesor
    r = ia.leer_ejercicio(IMAGEN, abrir=_azure(json.dumps(MODELO_IA)))
    est = construir(r["modelo"]); est.resolver()
    resolver_profesor(est)


def test_acepta_json_en_bloque_de_codigo(config):
    r = ia.leer_ejercicio(IMAGEN, abrir=_azure("```json\n" + json.dumps(MODELO_IA) + "\n```"))
    assert r["modelo"]["nombre"] == "Pórtico de un vano"


def test_sin_configuracion(monkeypatch):
    monkeypatch.delenv("AE_IA_URL", raising=False)
    monkeypatch.delenv("AE_IA_LLAVE", raising=False)
    with pytest.raises(ia.ErrorIA) as e:
        ia.leer_ejercicio(IMAGEN, abrir=_azure("{}"))
    assert "no está configurada" in str(e.value) and e.value.estado == 503


@pytest.mark.parametrize("img", ["", "data:image/gif;base64,AAAA", "http://x/y.jpg", "data:image/png;base64,@@@"])
def test_imagen_invalida(config, img):
    with pytest.raises(ia.ErrorIA) as e:
        ia.leer_ejercicio(img, abrir=_azure("{}"))
    assert e.value.estado == 400


def test_imagen_muy_grande(config, monkeypatch):
    monkeypatch.setattr(ia, "MAX_BYTES_IMAGEN", 200)
    with pytest.raises(ia.ErrorIA) as e:
        ia.leer_ejercicio(IMAGEN, abrir=_azure("{}"))
    assert e.value.estado == 413


def _mal(fn):
    m = copy.deepcopy(MODELO_IA); fn(m); return json.dumps(m)


@pytest.mark.parametrize("roto, texto", [
    (lambda m: m["elementos"][0].update(j=99), "no existe"),
    (lambda m: m["nudos"][1].update(id=1), "repetido"),
    (lambda m: m["nudos"][0].update(apoyo="volando"), "no es válido"),
    (lambda m: m["nudos"][0].update(x="NaN"), "no es un número válido"),
    (lambda m: m["nudos"][0].update(x=float("inf")), "no es un número válido"),
    (lambda m: m["secciones"][0].update(b=-1), "mayor que cero"),
    (lambda m: [n.update(apoyo="libre") for n in m["nudos"]], "ningún apoyo"),
    (lambda m: m["cargas_elementos"][1].update(a=9), "fuera de la barra"),
    (lambda m: m["cargas_nodales"][0].update(nudo=50), "no existe"),
    (lambda m: m["elementos"][1].update(seccion="Z"), "sección"),
    (lambda m: m["elementos"][0].update(i=True), "entero"),
    (lambda m: m.update(nudos=[]), "nudos"),
])
def test_validacion_estricta(config, roto, texto):
    with pytest.raises(ia.ErrorIA) as e:
        ia.leer_ejercicio(IMAGEN, abrir=_azure(_mal(roto)))
    assert texto in str(e.value)


def test_respuesta_no_json(config):
    with pytest.raises(ia.ErrorIA) as e:
        ia.leer_ejercicio(IMAGEN, abrir=_azure("No puedo leer la imagen."))
    assert e.value.estado == 502


def test_error_http_de_azure(config):
    def abrir(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 429, "x", {}, None)
    with pytest.raises(ia.ErrorIA) as e:
        ia.leer_ejercicio(IMAGEN, abrir=abrir)
    assert "ocupada" in str(e.value)


def test_sin_red(config):
    def abrir(req, timeout=None):
        raise urllib.error.URLError("sin red")
    with pytest.raises(ia.ErrorIA) as e:
        ia.leer_ejercicio(IMAGEN, abrir=abrir)
    assert e.value.estado == 504


def test_endpoint(config, monkeypatch):
    import app as aplicacion
    monkeypatch.setattr(ia, "leer_ejercicio", _leer)
    r = aplicacion.app.test_client().post("/api/ia/leer_ejercicio", json={"imagen": IMAGEN})
    j = r.get_json()
    assert r.status_code == 200 and j["ok"] is True and len(j["modelo"]["elementos"]) == 3


_original = ia.leer_ejercicio


def _leer(img):
    return _original(img, abrir=_azure(json.dumps(MODELO_IA)))


def test_endpoint_sin_configuracion(monkeypatch):
    import app as aplicacion
    monkeypatch.delenv("AE_IA_URL", raising=False)
    monkeypatch.delenv("AE_IA_LLAVE", raising=False)
    r = aplicacion.app.test_client().post("/api/ia/leer_ejercicio", json={"imagen": IMAGEN})
    assert r.status_code == 503 and "no está configurada" in r.get_json()["error"]
