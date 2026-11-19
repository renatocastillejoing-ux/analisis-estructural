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
import uuid
import secrets

import io
import threading
import time

from flask import Flask, request, jsonify, g, send_from_directory, redirect, send_file

from core.constructor import construir, extraer_resultados
from core.reporte import generar_reporte
from core import graficos

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "historial.db")

def _cargar_env_local():
    """Lee un .env junto a app.py (no se sube: está en .gitignore) sin pisar variables ya definidas."""
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(ruta):
        return
    for linea in open(ruta, encoding="utf-8"):
        linea = linea.strip()
        if linea and not linea.startswith("#") and "=" in linea:
            k, v = linea.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_cargar_env_local()

app = Flask(__name__, static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024      # 20 MB por petición
# firma la cookie anónima de la cuota de IA; sin SECRET_KEY se genera una (cambia al reiniciar)
app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)

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


@app.errorhandler(400)
def _e400(e):
    return jsonify({"ok": False, "error": "La petición no es un JSON válido."}), 400


@app.errorhandler(404)
def _e404(e):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "Ruta no encontrada."}), 404
    return e


@app.errorhandler(405)
def _e405(e):
    return jsonify({"ok": False, "error": "Método HTTP no permitido en esta ruta."}), 405


@app.errorhandler(500)
def _e500(e):
    return jsonify({"ok": False, "error": "Error interno del servidor."}), 500


@app.errorhandler(RecursionError)
def _erec(e):
    return jsonify({"ok": False, "error": "El JSON está demasiado anidado."}), 400


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
        # solo el método del profesor: si no se puede, se dice por qué (sin cambiar de método)
        return f"No se puede resolver este modelo con el método sistematizado ([A], barras 4×4): {e}"


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


@app.route("/api/exportar/excel", methods=["POST"])
def api_exportar_excel():
    """Excel (.xlsx) del cálculo en el formato del profesor ([A], [K] por barra, {D}…)."""
    from core.exportar_profesor import exportar_excel
    datos = request.get_json(force=True)
    try:
        est = construir(datos)
        contenido = exportar_excel(est)
    except NotImplementedError as e:
        return jsonify({"ok": False, "error": f"Caso aun no soportado por el metodo [A]: {e}"}), 400
    except Exception as e:
        return error_json(f"No se pudo exportar a Excel: {e}")
    nombre = "".join(c if c.isalnum() or c in " _-" else "_" for c in est.nombre).strip() or "portico"
    return send_file(io.BytesIO(contenido), as_attachment=True, download_name=f"{nombre}_profesor.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


_PDF = {"bytes": None, "info": None, "progreso": {"estado": "libre", "i": 0, "n": 0, "nombre": ""}}
_PDF_LOCK = threading.Lock()
_ARRANQUE = f"{os.getpid()}-{int(time.time())}"        # cambia si el servidor se reinicia


def _generar_pdf_en_hilo():
    """Hilo de fondo: genera el PDF de la torre y lo deja en memoria. El avance se consulta
    en /api/torre/pdf/progreso; la petición que lo inicia vuelve de inmediato."""
    from core import pdf_porticos
    pr = _PDF["progreso"]
    try:
        def avance(i, n, nombre):
            pr.update(i=i, n=n, nombre=nombre)
        _PDF["bytes"], _PDF["info"] = pdf_porticos.generar_pdf(avance)
        pr.update(estado="listo", fin=time.time())
    except Exception as e:
        traceback.print_exc()
        pr.update(estado="error", error=str(e), fin=time.time())
    finally:
        _PDF_LOCK.release()


@app.route("/api/torre/pdf/progreso", methods=["GET"])
def api_torre_pdf_progreso():
    pr = dict(_PDF["progreso"])
    pr["segundos"] = round((pr.get("fin") or time.time()) - pr["inicio"], 1) if pr.get("inicio") else 0
    pr["arranque"] = _ARRANQUE
    pr["en_memoria"] = _PDF["bytes"] is not None
    return jsonify({"ok": True, **pr})


@app.route("/api/torre/pdf/iniciar", methods=["POST", "GET"])
def api_torre_pdf_iniciar():
    """Pone a generar el PDF de todos los pórticos en segundo plano y responde al instante.
    Si ya está en memoria no regenera (salvo ?forzar=1); si ya se está generando, no lanza otro."""
    pr = _PDF["progreso"]
    if _PDF["bytes"] is not None and request.args.get("forzar") != "1":
        pr.update(estado="listo")
    elif _PDF_LOCK.acquire(blocking=False):
        pr.clear()
        pr.update(estado="generando", i=0, n=0, nombre="", inicio=time.time())
        threading.Thread(target=_generar_pdf_en_hilo, name="pdf-torre", daemon=True).start()
    return api_torre_pdf_progreso()


@app.route("/api/torre/pdf", methods=["GET"])
def api_torre_pdf():
    """Descarga el PDF de todos los pórticos (DFN, DFC y DMF, 1.4CM + 1.7CV) ya generado en
    memoria. Si aún no existe responde 409 con el estado: se inicia con /api/torre/pdf/iniciar
    y se espera consultando /api/torre/pdf/progreso (ninguna petición dura más que unos ms)."""
    if _PDF["bytes"] is None:
        return jsonify({"ok": False, "estado": _PDF["progreso"].get("estado", "libre"),
                        "error": "El PDF aún no está generado: pídelo con /api/torre/pdf/iniciar."}), 409
    r = send_file(io.BytesIO(_PDF["bytes"]), mimetype="application/pdf", as_attachment=True,
                  download_name="torre_arequipa_porticos.pdf")
    r.headers["X-Segundos"] = str((_PDF["info"] or {}).get("segundos", ""))
    return r


@app.route("/api/comparar_etabs", methods=["POST"])
def api_comparar_etabs():
    """Compara las fuerzas de extremo del sistema con la tabla «Element Forces - Frames» de ETABS.
    multipart: modelo (JSON), archivo (.xlsx/.csv); opcionales col_nombre, caso, modo (abs|signo),
    factor_fuerza, factor_momento, por_coordenadas (1)."""
    from core.etabs import comparar
    f = request.files.get("archivo")
    if f is None or not request.form.get("modelo"):
        return jsonify({"ok": False, "error": "Faltan el modelo (campo «modelo») o el archivo de ETABS (campo «archivo»)."}), 400
    try:
        est = construir(json.loads(request.form["modelo"]))
        est.resolver()
        res = comparar(est, f.read(), f.filename or "",
                       col_nombre=request.form.get("col_nombre") or None,
                       caso=request.form.get("caso") or None,
                       modo=request.form.get("modo", "abs"),
                       factor_fuerza=float(request.form.get("factor_fuerza") or 1),
                       factor_momento=request.form.get("factor_momento") or None,
                       forzar_coordenadas=request.form.get("por_coordenadas") in ("1", "true"))
        return jsonify(res)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


_PSEUDO3D = {}


@app.route("/api/torre/pseudo3d", methods=["GET"])
def api_torre_pseudo3d():
    """Sismo de la torre por el método pseudo-tridimensional del profesor: [K] de cada pórtico
    con [A], rigidez lateral [KL] por condensación y [K]ed = Σ[r]ᵀ[KL][r] por diafragma."""
    from core.pseudo3d import analizar_pseudo3d
    from core.torre_plano import supuestos
    try:
        supuestos()
        from core import torre_plano
        clave = torre_plano._SUP_MTIME
        if clave not in _PSEUDO3D:
            _PSEUDO3D.clear(); _PSEUDO3D[clave] = analizar_pseudo3d()
        r = _PSEUDO3D[clave]
        if request.args.get("barras") not in ("1", "true"):
            r = {**r, "direcciones": {d: {**v, "porticos": [{k: x for k, x in p.items() if k != "barras"} for p in v["porticos"]]}
                                      for d, v in r["direcciones"].items()}}
        return jsonify({"ok": True, **r})
    except Exception as e:
        return error_json(f"No se pudo hacer el análisis pseudo-tridimensional: {e}", 500)


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


# ---- cálculo 3D en segundo plano: en el servidor en línea (CPU lenta) la torre puede tardar
# más que el límite de una petición (gunicorn --timeout 180) y el navegador recibía un 500 en
# HTML. Ahora se inicia, se consulta el estado cada segundo y se recoge el resultado.
_TRABAJOS3D = {}
_TRABAJOS3D_LOCK = threading.Lock()


@app.route("/api/calcular3d/iniciar", methods=["POST"])
def api_calcular3d_iniciar():
    from core.analisis_3d import analizar_modelo3d
    datos = request.get_json(force=True)
    tid = uuid.uuid4().hex
    with _TRABAJOS3D_LOCK:
        for k in [k for k, v in _TRABAJOS3D.items() if time.time() - v["t0"] > 1800]:
            _TRABAJOS3D.pop(k, None)                     # limpia trabajos de más de 30 min
        _TRABAJOS3D[tid] = {"estado": "calculando", "t0": time.time()}

    # fracción del tiempo total en que empieza cada etapa (medido con la torre, 2026-11-19)
    FRACCION = {"prep": 0.0, "diaf": 0.01, "sub": 0.01, "sismo": 0.01, "resolver": 0.01, "modal": 0.15,
                "dinamico": 0.16, "combos": 0.38, "barras": 0.70, "derivas": 0.71, "diseno": 0.76}

    def correr():
        from core import analisis_3d as a3
        a3._AVANCE.cb = lambda k, txt: _TRABAJOS3D[tid].update(etapa=txt, fraccion=FRACCION.get(k, 0.0))
        try:
            r = analizar_modelo3d(datos)
            _TRABAJOS3D[tid].update(estado="listo", resultado=r)
        except Exception as e:
            _TRABAJOS3D[tid].update(estado="error", error=f"No se pudo resolver el modelo 3D: {e}")
    threading.Thread(target=correr, daemon=True).start()
    return jsonify({"ok": True, "id": tid})


@app.route("/api/calcular3d/estado/<tid>", methods=["GET"])
def api_calcular3d_estado(tid):
    t = _TRABAJOS3D.get(tid)
    if t is None:
        return jsonify({"ok": False, "estado": "perdido",
                        "error": "El servidor se reinició durante el cálculo. Vuelve a calcular."}), 404
    seg = round(time.time() - t["t0"], 1)
    if t["estado"] == "listo":
        _TRABAJOS3D.pop(tid, None)
        return jsonify({"ok": True, "estado": "listo", "segundos": seg, "resultado": t["resultado"]})
    if t["estado"] == "error":
        _TRABAJOS3D.pop(tid, None)
        return jsonify({"ok": False, "estado": "error", "error": t["error"]}), 400
    return jsonify({"ok": True, "estado": "calculando", "segundos": seg,
                    "etapa": t.get("etapa", "Iniciando"), "fraccion": t.get("fraccion", 0.0)})


@app.route("/favicon.ico")
def favicon():
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#508C9B"/>'
           '<path d="M7 25V9h18v16M7 15h18M16 9v16" stroke="#fff" stroke-width="2.4" fill="none"/></svg>')
    return app.response_class(svg, mimetype="image/svg+xml", headers={"Cache-Control": "public, max-age=604800"})


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
    idx = request.args.get("idx", 0, type=int)
    if idx is None or idx < 0:
        return error_json("«idx» debe ser un número entero mayor o igual a 0.")
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
#  API: ejercicio desde foto (IA con visión; AE_IA_URL / AE_IA_LLAVE)
# ----------------------------------------------------------------------------
@app.route("/api/ia/cuota", methods=["GET"])
def api_ia_cuota():
    """Sin cuota: lecturas ilimitadas (uso personal). Solo informa si la IA está configurada."""
    return jsonify({"ok": True, "ilimitada": True,
                    "configurada": bool(os.environ.get("AE_IA_URL") and os.environ.get("AE_IA_LLAVE"))})


@app.route("/api/ia/leer_ejercicio", methods=["POST"])
def api_ia_leer_ejercicio():
    from core import ia_ejercicio
    datos = request.get_json(force=True, silent=True) or {}
    try:
        ia_ejercicio.configuracion()
        ia_ejercicio.validar_imagen(datos.get("imagen"))
        r = ia_ejercicio.leer_ejercicio(datos.get("imagen"))
    except ia_ejercicio.ErrorIA as e:
        return jsonify({"ok": False, "error": str(e)}), e.estado
    except Exception:
        return jsonify({"ok": False, "error": "No se pudo leer el ejercicio desde la foto."}), 500
    return jsonify({"ok": True, **r})


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
    app.run(debug=os.environ.get("FLASK_DEBUG", "0") == "1", port=port)
else:
    init_db()
