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
    monkeypatch.setenv("AE_IA_REVISAR", "0")


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
    assert partes[1] == {"type": "image_url", "image_url": {"url": IMAGEN, "detail": "high"}}
    assert cuerpo["response_format"] == {"type": "json_object"} and cuerpo["max_tokens"] == 4000
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


@pytest.fixture
def bd(tmp_path, monkeypatch):
    """SQLite propia del test: la cuota no toca historial.db."""
    import app as aplicacion
    ruta = str(tmp_path / "h.db")
    monkeypatch.setattr(aplicacion, "DB_PATH", ruta)
    aplicacion.init_db()
    for v in ("AE_IA_LIMITE_USUARIO", "AE_IA_TOPE_IP", "AE_IA_TOPE_DIARIO"):
        monkeypatch.delenv(v, raising=False)
    return aplicacion


def test_endpoint(config, monkeypatch, bd):
    import app as aplicacion
    monkeypatch.setattr(ia, "leer_ejercicio", _leer)
    r = aplicacion.app.test_client().post("/api/ia/leer_ejercicio", json={"imagen": IMAGEN})
    j = r.get_json()
    assert r.status_code == 200 and j["ok"] is True and len(j["modelo"]["elementos"]) == 3


_original = ia.leer_ejercicio


def _leer(img):
    return _original(img, abrir=_azure(json.dumps(MODELO_IA)))


def test_endpoint_sin_configuracion(monkeypatch, bd):
    import app as aplicacion
    monkeypatch.delenv("AE_IA_URL", raising=False)
    monkeypatch.delenv("AE_IA_LLAVE", raising=False)
    r = aplicacion.app.test_client().post("/api/ia/leer_ejercicio", json={"imagen": IMAGEN})
    assert r.status_code == 503 and "no está configurada" in r.get_json()["error"]


# ---------------------------------------------------------------- esquema → modelo
ESQUEMA = {
    "formato": "esquema", "nombre": "Dos vanos, dos pisos",
    "unidades_leidas": {"fuerza": "kN", "longitud": "cm"}, "conversion": "kN → tonf (÷ 9.81); cm → m",
    "unidad_fuerza": "tonf", "unidad_longitud": "m", "material": {"modo": "fc", "fc": 210},
    "esquema": {
        "vanos": [5, 4], "alturas": [3.5, 3],
        "apoyos": ["empotrado", "fijo", "empotrado"],
        "secciones": [{"nombre": "C", "b": 0.3, "h": 0.4}, {"nombre": "V", "b": 0.25, "h": 0.5},
                      {"nombre": "C2", "b": 0.4, "h": 0.4}],
        "seccion_columnas": "C", "seccion_vigas": "V",
        "secciones_barras": [{"barra": {"tipo": "columna", "eje": 2, "piso": 1}, "seccion": "C2"}],
        "cargas_barras": [
            {"barra": {"tipo": "viga", "vano": 1, "piso": 1}, "tipo": "uniforme", "wx": 0, "wy": -2},
            {"barra": {"tipo": "viga", "vano": 2, "piso": 2}, "tipo": "puntual", "Px": 0, "Py": -4, "a": 2},
            {"barra": {"tipo": "columna", "eje": 1, "piso": 1}, "tipo": "uniforme", "wx": 0.5, "wy": 0},
        ],
        "cargas_nodales": [{"eje": 1, "nivel": 2, "Fx": 3, "Fy": 0, "M": 0}],
    },
    "pide": ["Reacciones", "DMF"],
    "gdl": [{"eje": 1, "nivel": 1, "numeros": [1, 2, 3]}],
    "supuestos": ["Altura del 2.º piso no acotada: 3 m."], "dudas": [],
    "confianza": [{"dato": "alturas[2]", "nivel": "baja", "nota": "cota borrosa"},
                  {"dato": "vanos[1]", "nivel": "alta", "nota": ""}],
}


def test_arma_portico_desde_esquema(config):
    r = ia.leer_ejercicio(IMAGEN, abrir=_azure(json.dumps(ESQUEMA)))
    m = r["modelo"]
    assert r["formato"] == "esquema"
    # 3 ejes × 3 niveles; ids por nivel y de izquierda a derecha, como generarPortico
    assert [(n["x"], n["y"]) for n in m["nudos"]][:4] == [(0, 0), (5, 0), (9, 0), (0, 3.5)]
    assert m["nudos"][8] == {"id": 9, "nombre": "N9", "x": 9, "y": 6.5, "apoyo": "libre"}
    assert [n["apoyo"] for n in m["nudos"][:3]] == ["empotrado", "fijo", "empotrado"]
    # 6 columnas (por eje y piso) y luego 4 vigas (por piso y vano)
    nombres = [e["nombre"] for e in m["elementos"]]
    assert nombres == ["C1", "C2", "C3", "C4", "C5", "C6", "V1", "V2", "V3", "V4"]
    assert (m["elementos"][2]["i"], m["elementos"][2]["j"], m["elementos"][2]["seccion"]) == (2, 5, "C2")
    assert m["elementos"][0]["seccion"] == "C" and m["elementos"][6]["seccion"] == "V"
    v4 = m["elementos"][9]
    assert (v4["i"], v4["j"]) == (8, 9)
    assert {"elem": 7, "tipo": "distribuida", "subtipo": "uniforme", "wx": 0.0, "wy": -2.0} in m["cargas_elementos"]
    assert {"elem": 10, "tipo": "puntual", "Px": 0.0, "Py": -4.0, "a": 2.0} in m["cargas_elementos"]
    assert m["cargas_nodales"] == [{"nudo": 7, "Fx": 3.0, "Fy": 0.0, "M": 0.0}]
    assert r["gdl"] == [{"nudo": 4, "numeros": [1, 2, 3]}]
    assert r["pide"] == ["Reacciones", "DMF"]
    assert r["confianza"][0]["nivel"] == "baja"
    assert r["supuestos"][0].startswith("Conversión de unidades")
    from core.constructor import construir
    from core.metodo_profesor import resolver_profesor
    est = construir(m); est.resolver(); resolver_profesor(est)


@pytest.mark.parametrize("roto, texto", [
    (lambda e: e.update(apoyos=["empotrado", "fijo"]), "Se esperaban 3 apoyos"),
    (lambda e: e.update(vanos=[5, -4]), "mayor que cero"),
    (lambda e: e.update(alturas=[]), "alturas"),
    (lambda e: e["cargas_barras"][0]["barra"].update(vano=7), "no existe"),
    (lambda e: e["cargas_barras"][1].update(a=9), "fuera de la barra"),
    (lambda e: e["cargas_nodales"][0].update(nivel=5), "no existe"),
    (lambda e: e["apoyos"].__setitem__(0, "libre"), "no es válido"),
])
def test_esquema_invalido(config, roto, texto):
    d = copy.deepcopy(ESQUEMA); roto(d["esquema"])
    with pytest.raises(ia.ErrorIA) as e:
        ia.leer_ejercicio(IMAGEN, abrir=_azure(json.dumps(d)))
    assert texto in str(e.value)


def test_formato_libre_sigue_valiendo_para_inclinadas(config):
    d = copy.deepcopy(MODELO_IA); d["formato"] = "libre"
    d["nudos"][2]["y"] = 4.5                                   # viga inclinada
    r = ia.leer_ejercicio(IMAGEN, abrir=_azure(json.dumps(d)))
    assert r["formato"] == "libre" and r["modelo"]["nudos"][2]["y"] == 4.5


# ---------------------------------------------------------------- parámetros de la llamada
def test_gpt5_usa_max_completion_tokens(monkeypatch):
    monkeypatch.setenv("AE_IA_URL", "https://x.invalid/openai/deployments/gpt-5-mini/chat/completions?api-version=x")
    monkeypatch.setenv("AE_IA_LLAVE", "k")
    monkeypatch.setenv("AE_IA_REVISAR", "0")
    cap = {}
    ia.leer_ejercicio(IMAGEN, abrir=_azure(json.dumps(ESQUEMA), cap))
    c = json.loads(cap["req"].data)
    assert "max_completion_tokens" in c and "max_tokens" not in c and "temperature" not in c


def test_reintenta_si_azure_pide_max_completion_tokens(config):
    cuerpos = []
    def abrir(req, timeout=None):
        cuerpos.append(json.loads(req.data))
        if len(cuerpos) == 1:
            raise urllib.error.HTTPError(req.full_url, 400, "x", {}, io.BytesIO(
                b'{"error":{"code":"unsupported_parameter","message":"Use max_completion_tokens instead."}}'))
        return _Resp(json.dumps({"choices": [{"message": {"content": json.dumps(ESQUEMA)}}]}).encode())
    ia.leer_ejercicio(IMAGEN, abrir=abrir)
    assert "max_tokens" in cuerpos[0] and "max_completion_tokens" in cuerpos[1] and len(cuerpos) == 2




def test_sin_secciones_usa_una_por_defecto_y_avisa():
    m = {"formato": "libre", "nudos": [{"id": 1, "x": 0, "y": 0, "apoyo": "empotrado"}, {"id": 2, "x": 0, "y": 3}],
         "elementos": [{"id": 1, "i": 1, "j": 2}], "cargas_nodales": [{"nudo": 2, "Fx": 1}], "secciones": []}
    r = ia.interpretar(m)
    assert r["modelo"]["secciones"][0]["b"] == 0.30 and any("no trae secciones" in d for d in r["dudas"])


def test_segunda_pasada_revisa_la_lectura(config, monkeypatch):
    monkeypatch.setenv("AE_IA_REVISAR", "1")
    import json as _j
    llamadas = []
    malo = {"formato": "libre", "nudos": [{"id": 1, "x": 0, "y": 0, "apoyo": "empotrado"}, {"id": 2, "x": 0, "y": 3}],
            "elementos": [{"id": 1, "i": 1, "j": 2}], "secciones": [{"nombre": "C", "b": 0.3, "h": 0.3}]}
    bueno = dict(malo, nudos=[{"id": 1, "x": 0, "y": 0, "apoyo": "empotrado"}, {"id": 2, "x": 0, "y": 4}])
    def falso(imagen, url, llave, abrir=None, previo=None):
        llamadas.append(previo)
        return _j.dumps(bueno if previo else malo)
    monkeypatch.setattr(ia, "pedir_a_la_ia", falso)
    monkeypatch.setattr(ia, "validar_imagen", lambda x: None)
    r = ia.leer_ejercicio("data:image/png;base64,AAAA")
    assert len(llamadas) == 2 and llamadas[1] is not None and r["modelo"]["nudos"][1]["y"] == 4
