# -*- coding: utf-8 -*-
"""
================================================================================
  SISTEMA DE ANALISIS ESTRUCTURAL - METODO MATRICIAL DE RIGIDEZ
  Servidor Flask: API de calculo + historial (SQLite) + interfaz web.
================================================================================
  Ejecutar:   python app.py
  Abrir:      http://127.0.0.1:5000
================================================================================
"""
import os
import json
import sqlite3
import datetime
import traceback

from flask import Flask, request, jsonify, g, send_from_directory, redirect

from core.constructor import construir, extraer_resultados
from core.reporte import generar_reporte
from core import graficos

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "historial.db")

app = Flask(__name__, static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024      # 20 MB por petición

HISTORIAL_MAX_FILAS = 50                                  # el historial conserva solo los últimos 50 cálculos
HISTORIAL_MAX_BYTES = 2 * 1024 * 1024                     # no se guardan payloads mayores a 2 MB


def _con_detalle():
    """El traceback solo sale en local: con app.debug o con AE_DEBUG=1."""
    return bool(app.debug) or os.environ.get("AE_DEBUG") == "1"


def error_json(mensaje, codigo=400):
    """Respuesta de error en JSON; incluye 'detalle' (traceback) solo fuera de producción."""
    cuerpo = {"ok": False, "error": mensaje}
    if _con_detalle():
        cuerpo["detalle"] = traceback.format_exc()
    return jsonify(cuerpo), codigo


@app.errorhandler(413)
def demasiado_grande(_e):
    return jsonify({"ok": False,
                    "error": "La petición es demasiado grande (máximo 20 MB). "
                             "Reduzca el tamaño del modelo."}), 413


# ----------------------------------------------------------------------------
#  Base de datos (SQLite) para el historial
# ----------------------------------------------------------------------------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS calculos (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha     TEXT NOT NULL,
            nombre    TEXT NOT NULL,
            resumen   TEXT NOT NULL,
            datos     TEXT NOT NULL,
            resultado TEXT NOT NULL
        )
    """)
    con.commit()
    con.close()


def memoria_de_calculo(est):
    """Memoria con el método sistematizado del profesor (matriz [A], barras 4×4).
    Si el modelo tiene algo que ese método no admite, se usa la memoria del
    método directo y se dice por qué al inicio."""
    from core.metodo_profesor import resolver_profesor, memoria_profesor
    try:
        return memoria_profesor(resolver_profesor(est), est.nombre)
    except Exception as e:
        return ("AVISO: este modelo no se puede presentar con el método sistematizado "
                f"([A], barras 4×4): {e}" + "\n"
                "Se muestra la memoria del método directo de rigidez." + "\n\n"
                + generar_reporte(est))


# ----------------------------------------------------------------------------
#  Rutas de la interfaz
# ----------------------------------------------------------------------------
@app.route("/")
def index():
    """Interfaz (React + Tailwind), compilada en static/react/ (npm run build en frontend/)."""
    return send_from_directory(os.path.join(BASE_DIR, "static", "react"), "index.html")


@app.route("/nueva")
def nueva():
    """Ruta antigua de la interfaz React: se mantiene por los enlaces guardados."""
    return redirect("/", code=301)


# ----------------------------------------------------------------------------
#  API: calcular
# ----------------------------------------------------------------------------
@app.route("/api/calcular", methods=["POST"])
def api_calcular():
    datos = request.get_json(force=True)
    try:
        est = construir(datos)
        est.resolver()
    except Exception as e:
        return error_json(f"No se pudo resolver la estructura: {e}")

    resultados = extraer_resultados(est)
    # Los diagramas se renderizan como SVG interactivo en el navegador; los PNG
    # de matplotlib solo se generan bajo demanda (?imagenes=1) para no penalizar
    # cada cálculo. Por defecto se omiten.
    imagenes = {}
    if request.args.get("imagenes") in ("1", "true", "yes"):
        imagenes = graficos.generar_todas_base64(est)

    # Análisis modal opcional (modo avanzado)
    modal = None
    if datos.get("analisis_modal"):
        try:
            modal = est.analisis_modal(n_modos=int(datos.get("n_modos", 6)))
        except Exception as e:
            modal = {"error": str(e)}

    payload = {
        "ok": True,
        "nombre": est.nombre,
        "resultados": resultados,
        "imagenes": imagenes,
        "modal": modal,
    }

    # guardar en historial (sin imágenes base64 ni payloads enormes; máximo 50 filas)
    try:
        guardable = {k: v for k, v in payload.items() if k != "imagenes"}
        guardable["imagenes"] = {}
        txt_resultado = json.dumps(guardable)
        txt_datos = json.dumps(datos)
        if len(txt_resultado) + len(txt_datos) > HISTORIAL_MAX_BYTES:
            payload["id"] = None
            payload["aviso_historial"] = "Cálculo demasiado grande: no se guardó en el historial."
        else:
            db = get_db()
            fecha = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            resumen = json.dumps(resultados["resumen"])
            cur = db.execute(
                "INSERT INTO calculos (fecha, nombre, resumen, datos, resultado) "
                "VALUES (?,?,?,?,?)",
                (fecha, est.nombre, resumen, txt_datos, txt_resultado),
            )
            payload["id"] = cur.lastrowid
            payload["fecha"] = fecha
            db.execute(
                "DELETE FROM calculos WHERE id NOT IN "
                "(SELECT id FROM calculos ORDER BY id DESC LIMIT ?)",
                (HISTORIAL_MAX_FILAS,),
            )
            db.commit()
    except Exception:
        payload["id"] = None

    return jsonify(payload)


@app.route("/api/memoria", methods=["POST"])
def api_memoria():
    """Memoria de cálculo (texto): solo se genera cuando se pide, con el modelo en el cuerpo."""
    datos = request.get_json(force=True)
    try:
        est = construir(datos)
        est.resolver()
        return jsonify({"ok": True, "nombre": est.nombre, "texto": memoria_de_calculo(est)})
    except Exception as e:
        return error_json(f"No se pudo generar la memoria de cálculo: {e}")


# ----------------------------------------------------------------------------
#  API: historial
# ----------------------------------------------------------------------------
@app.route("/api/historial", methods=["GET"])
def api_historial():
    db = get_db()
    filas = db.execute(
        "SELECT id, fecha, nombre, resumen, datos FROM calculos ORDER BY id DESC"
    ).fetchall()
    items = []
    for f in filas:
        modelo = json.loads(f["datos"])
        items.append({
            "id": f["id"], "fecha": f["fecha"], "nombre": f["nombre"],
            "resumen": json.loads(f["resumen"]),
            "modelo": {
                "nudos": modelo.get("nudos", []),
                "elementos": modelo.get("elementos", []),
            },
        })
    return jsonify({"ok": True, "items": items})


@app.route("/api/historial/<int:cid>", methods=["GET"])
def api_historial_item(cid):
    db = get_db()
    f = db.execute("SELECT resultado, datos FROM calculos WHERE id=?", (cid,)).fetchone()
    if not f:
        return jsonify({"ok": False, "error": "No encontrado"}), 404
    payload = json.loads(f["resultado"])
    payload["datos"] = json.loads(f["datos"])
    return jsonify(payload)


@app.route("/api/historial/<int:cid>", methods=["DELETE"])
def api_historial_borrar(cid):
    db = get_db()
    db.execute("DELETE FROM calculos WHERE id=?", (cid,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/historial/limpiar", methods=["POST"])
def api_historial_limpiar():
    db = get_db()
    db.execute("DELETE FROM calculos")
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/combinaciones", methods=["POST"])
def api_combinaciones():
    """Resuelve por casos de carga y devuelve envolventes."""
    from core.constructor import resolver_combinaciones
    datos = request.get_json(force=True)
    try:
        res = resolver_combinaciones(datos)
        return jsonify({"ok": True, **res})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/metodo_a", methods=["POST"])
def api_metodo_a():
    """Resuelve por el METODO SISTEMATIZADO DE RIGIDEZ (matriz [A], como el
    profesor) y devuelve los datos de cada paso para el reproductor animado."""
    from core.metodo_profesor import resolver_profesor, a_api
    datos = request.get_json(force=True)
    try:
        est = construir(datos)
        res = a_api(resolver_profesor(est))
        # diagramas N/V/M por barra (del motor directo, para dibujar DMF/DFC)
        try:
            est.resolver()
            res["diagramas"] = extraer_resultados(est)["diagramas"]
        except Exception:
            res["diagramas"] = None
        return jsonify(res)
    except NotImplementedError as e:
        return jsonify({"ok": False,
                        "error": f"Caso aun no soportado por el metodo [A]: {e}"}), 400
    except Exception as e:
        return error_json(str(e))


@app.route("/api/torre/lista", methods=["GET"])
def api_torre_lista():
    from core.torre_arequipa import todos_los_pórticos
    cuenta = {}
    items = []
    for n, t, _ in todos_los_pórticos():               # idx = posición dentro de su tipo
        items.append({"nombre": n, "tipo": t, "idx": cuenta.get(t, 0)})
        cuenta[t] = cuenta.get(t, 0) + 1
    return jsonify({"ok": True, "items": items})


@app.route("/api/calcular3d", methods=["POST"])
def api_calcular3d():
    """Análisis de un pórtico espacial (6 GDL por nudo) del editor 3D."""
    from core.analisis_3d import analizar_modelo3d
    datos = request.get_json(force=True)
    try:
        return jsonify(analizar_modelo3d(datos))
    except Exception as e:
        return error_json(f"No se pudo resolver el modelo 3D: {e}")


@app.route("/api/diseno", methods=["POST"])
def api_diseno():
    """Diseño E.060 de barras de un pórtico 2D a partir de sus diagramas."""
    from core.diseno_e060 import disenar_2d
    d = request.get_json(force=True)
    try:
        return jsonify({"ok": True, "diseno": disenar_2d(d["elementos"])})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/calcular3d/portico", methods=["POST"])
def api_calcular3d_portico():
    """Diagramas N/V/M en el plano de un pórtico, tomados del último cálculo 3D."""
    from core.analisis_3d import diagramas_portico
    d = request.get_json(force=True)
    try:
        return jsonify(diagramas_portico(d["id_calculo"], d["caso"], d["eje"], float(d["valor"])))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/calcular3d/diagramas", methods=["POST"])
def api_calcular3d_diagramas():
    """Diagramas de momento de todas las barras del último cálculo 3D (para el visor)."""
    from core.analisis_3d import diagramas_3d
    d = request.get_json(force=True)
    try:
        return jsonify(diagramas_3d(d["id_calculo"], d["caso"]))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/modelo3d/portico", methods=["POST"])
def api_modelo3d_portico():
    """Extrae un pórtico plano (modelo 2D del editor) de un modelo 3D."""
    from core.analisis_3d import portico_desde_3d
    d = request.get_json(force=True)
    try:
        return jsonify(portico_desde_3d(d["modelo"], d["eje"], float(d["valor"]), d.get("factores")))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/torre/modelo3d", methods=["GET"])
def api_torre_modelo3d():
    from core.torre_arequipa import modelo3d_torre
    return jsonify(modelo3d_torre())


@app.route("/api/torre/plano", methods=["GET"])
def api_torre_plano():
    """Fondo del plano DXF (static/plano/*.json): planta=1 (pisos 1-3) o planta=2 (pisos 4-10)."""
    archivo = {"1": "planta_1a3.json", "2": "planta_4a10.json"}.get(request.args.get("planta", "1"))
    if not archivo:
        return jsonify({"ok": False, "error": "planta debe ser 1 (pisos 1-3) o 2 (pisos 4-10)"}), 400
    ruta = os.path.join(BASE_DIR, "static", "plano", archivo)
    if not os.path.exists(ruta):
        return jsonify({"ok": False, "error": "Falta el fondo; genéralo con tools/plano_fondo.py"}), 404
    with open(ruta, encoding="utf-8") as f:
        return jsonify(json.load(f))


@app.route("/api/torre/3d", methods=["GET"])
def api_torre_3d():
    """Geometría completa de la torre para el visor 3D."""
    from core.torre_arequipa import geometria_3d
    return jsonify({"ok": True, **geometria_3d()})


@app.route("/api/torre", methods=["GET"])
def api_torre():
    """Modelo de un pórtico de la torre (cargas CM/CV combinadas 1.4CM+1.7CV)."""
    from core.torre_arequipa import portico
    from core.torre_resultados import carga_combinada
    tipo = request.args.get("tipo", "letra")
    idx = int(request.args.get("idx", 0))
    try:
        if request.args.get("casos") in ("1", "true"):
            return jsonify(portico(tipo, idx))       # con casos CM y CV separados
        d = carga_combinada(portico(tipo, idx))
        return jsonify(d)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/seccion", methods=["POST"])
def api_seccion():
    """Calcula A e I de una seccion segun su tipo y dimensiones."""
    from core import secciones as Secc
    d = request.get_json(force=True)
    try:
        tipo = d.pop("tipo")
        A, I = Secc.calcular(tipo, **d)
        return jsonify({"ok": True, "A": A, "I": I})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/tipos_seccion", methods=["GET"])
def api_tipos_seccion():
    from core import secciones as Secc
    return jsonify({k: {"campos": v[1], "etiqueta": v[2]}
                    for k, v in Secc.TIPOS.items()})


# ----------------------------------------------------------------------------
#  API: modelo de ejemplo (portico de 2 tramos del enunciado)
# ----------------------------------------------------------------------------
@app.route("/api/ejemplo", methods=["GET"])
def api_ejemplo():
    return jsonify(MODELO_EJEMPLO)


MODELO_EJEMPLO = {
    "nombre": "Portico 2 tramos (ejemplo)",
    "despreciar_axial": True,
    "material": {"modo": "E", "E": 2.0e6, "nombre": "E=2e6 tonf/m2"},
    "secciones": [
        {"nombre": "viga",  "modo": "rect", "b": 0.25, "h": 0.50},
        {"nombre": "col40", "modo": "rect", "b": 0.40, "h": 0.40},
        {"nombre": "col30", "modo": "rect", "b": 0.30, "h": 0.30},
    ],
    "nudos": [
        {"id": 1, "x": 0.0, "y": 0.0, "apoyo": "empotrado"},
        {"id": 2, "x": 5.0, "y": 0.0, "apoyo": "empotrado"},
        {"id": 3, "x": 9.0, "y": 0.0, "apoyo": "empotrado"},
        {"id": 4, "x": 0.0, "y": 3.0, "apoyo": "libre"},
        {"id": 5, "x": 5.0, "y": 3.0, "apoyo": "libre"},
        {"id": 6, "x": 9.0, "y": 3.0, "apoyo": "libre"},
    ],
    "elementos": [
        {"id": 1, "i": 1, "j": 4, "seccion": "col40", "nombre": "C1"},
        {"id": 2, "i": 2, "j": 5, "seccion": "col30", "nombre": "C2"},
        {"id": 3, "i": 3, "j": 6, "seccion": "col40", "nombre": "C3"},
        {"id": 4, "i": 4, "j": 5, "seccion": "viga",  "nombre": "V1"},
        {"id": 5, "i": 5, "j": 6, "seccion": "viga",  "nombre": "V2"},
    ],
    "cargas_nodales": [
        {"nudo": 4, "Fx": 4.0, "Fy": 0.0, "M": 0.0},
    ],
    "cargas_elementos": [
        {"elem": 4, "tipo": "distribuida", "subtipo": "uniforme", "wy": -2.5},
        {"elem": 5, "tipo": "distribuida", "subtipo": "uniforme", "wy": -2.5},
    ],
}


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    print("=" * 60)
    print("  Sistema de Analisis Estructural - Metodo de Rigidez")
    print(f"  Abrir en el navegador:  http://127.0.0.1:{port}")
    print("=" * 60)
    # Depuración solo en local (FLASK_DEBUG=0 la apaga). En Render la app corre con gunicorn y no pasa por aquí.
    app.run(debug=os.environ.get("FLASK_DEBUG", "1") == "1", port=port)
else:
    init_db()
