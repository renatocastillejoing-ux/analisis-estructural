# -*- coding: utf-8 -*-
"""
Cuota de lecturas con IA (ejercicio desde foto), guardada en la SQLite del historial.

- Por usuario: AE_IA_LIMITE_USUARIO lecturas (5). El usuario es un identificador anónimo en
  cookie firmada, y además se cuenta por IP (hash con la clave del servidor, nunca la IP en
  claro) con AE_IA_TOPE_IP (15): borrar la cookie no regala cuota.
- Global: AE_IA_TOPE_DIARIO lecturas por día (100) para todo el servidor.
- Se RESERVA un cupo antes de llamar a Azure y se DEVUELVE si la llamada falla: en la práctica
  solo se descuenta cuando la IA devolvió un modelo válido, y dos pestañas a la vez no se cuelan.
"""
import datetime
import hashlib
import hmac
import os
import sqlite3
import threading

_CANDADO = threading.Lock()


def _entero(nombre, defecto):
    try:
        v = int(os.environ.get(nombre, "") or defecto)
        return v if v >= 0 else defecto
    except ValueError:
        return defecto


def limites():
    return {"usuario": _entero("AE_IA_LIMITE_USUARIO", 5),
            "ip": _entero("AE_IA_TOPE_IP", 15),
            "diario": _entero("AE_IA_TOPE_DIARIO", 100)}


class CuotaAgotada(Exception):
    def __init__(self, mensaje):
        super().__init__(mensaje)
        self.estado = 429


def crear_tabla(con):
    con.execute("CREATE TABLE IF NOT EXISTS ia_uso (clave TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)")


def _hoy():
    return datetime.date.today().isoformat()


def claves(usuario, ip, secreto):
    """Claves de conteo: usuario de la cookie, IP con hash (HMAC) y el día."""
    h = hmac.new(str(secreto).encode(), str(ip or "?").encode(), hashlib.sha256).hexdigest()[:32]
    return {"usuario": f"u:{usuario}", "ip": f"ip:{h}", "diario": f"dia:{_hoy()}"}


def _leer(con, clave):
    f = con.execute("SELECT n FROM ia_uso WHERE clave = ?", (clave,)).fetchone()
    return int(f[0]) if f else 0


def estado(db_path, cl):
    lim = limites()
    con = sqlite3.connect(db_path)
    try:
        crear_tabla(con)
        usados = {k: _leer(con, cl[k]) for k in cl}
    finally:
        con.close()
    quedan = max(0, min(lim["usuario"] - usados["usuario"], lim["ip"] - usados["ip"]))
    return {"limite": lim["usuario"], "usadas": usados["usuario"], "quedan": quedan,
            "diario_agotado": usados["diario"] >= lim["diario"]}


def reservar(db_path, cl):
    """Suma 1 a cada contador si ninguno está en su tope; si alguno lo está, lanza CuotaAgotada."""
    lim = limites()
    with _CANDADO:
        con = sqlite3.connect(db_path, timeout=10)
        try:
            crear_tabla(con)
            con.execute("BEGIN IMMEDIATE")
            usados = {k: _leer(con, cl[k]) for k in cl}
            if usados["usuario"] >= lim["usuario"] or usados["ip"] >= lim["ip"]:
                con.rollback()
                raise CuotaAgotada(f"Ya usaste tus {lim['usuario']} lecturas con IA. "
                                   "Puedes seguir armando el modelo a mano, con el generador o con una plantilla.")
            if usados["diario"] >= lim["diario"]:
                con.rollback()
                raise CuotaAgotada("Hoy ya se usaron todas las lecturas con IA del servidor. "
                                   "Vuelve a intentarlo mañana o arma el modelo a mano.")
            for k in cl:
                con.execute("INSERT INTO ia_uso (clave, n) VALUES (?, 1) "
                            "ON CONFLICT(clave) DO UPDATE SET n = n + 1", (cl[k],))
            con.commit()
        finally:
            con.close()


def devolver(db_path, cl):
    """Deshace una reserva (la llamada a la IA falló o el modelo no fue válido)."""
    with _CANDADO:
        con = sqlite3.connect(db_path, timeout=10)
        try:
            for k in cl:
                con.execute("UPDATE ia_uso SET n = MAX(0, n - 1) WHERE clave = ?", (cl[k],))
            con.commit()
        finally:
            con.close()
