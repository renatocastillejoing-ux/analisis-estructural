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

from flask import Flask, request, jsonify, render_template, g

from core.constructor import construir, extraer_resultados
from core.reporte import generar_reporte
from core import graficos

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "historial.db")

app = Flask(__name__, static_folder="static", template_folder="templates")


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


# ----------------------------------------------------------------------------
#  Rutas de la interfaz
# ----------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


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
        return jsonify({
            "ok": False,
            "error": f"No se pudo resolver la estructura: {e}",
            "detalle": traceback.format_exc(),
        }), 400

    resultados = extraer_resultados(est)
    reporte = generar_reporte(est)
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
        "reporte": reporte,
        "modal": modal,
    }

    # guardar en historial
    try:
        db = get_db()
        fecha = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        resumen = json.dumps(resultados["resumen"])
        db.execute(
            "INSERT INTO calculos (fecha, nombre, resumen, datos, resultado) "
            "VALUES (?,?,?,?,?)",
            (fecha, est.nombre, resumen, json.dumps(datos), json.dumps(payload)),
        )
        db.commit()
        payload["id"] = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        payload["fecha"] = fecha
    except Exception:
        payload["id"] = None

    return jsonify(payload)


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
    app.run(debug=True, port=port)
else:
    init_db()
