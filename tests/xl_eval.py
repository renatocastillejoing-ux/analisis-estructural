# -*- coding: utf-8 -*-
"""Evaluador mínimo de fórmulas de Excel (solo lo que usa el exportador del profesor):
aritmética, ^, referencias entre hojas, rangos, MMULT, MINVERSE, TRANSPOSE y fórmulas de matriz.
Sirve para recalcular el libro sin Excel/LibreOffice y compararlo con los valores del motor."""
import re

import numpy as np
from openpyxl.utils import range_boundaries
from openpyxl.worksheet.formula import ArrayFormula

_REF = re.compile(r"(?:('[^']+'|[A-Za-z_][A-Za-z0-9_]*)!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?")


class Libro:
    def __init__(self, wb):
        self.wb = wb
        self.memo = {}
        self.dueno = {}          # (hoja, fila, col) -> (fórmula de matriz, hoja, fila0, col0)
        for ws in wb.worksheets:
            for fila in ws.iter_rows():
                for c in fila:
                    if isinstance(c.value, ArrayFormula):
                        c0, r0, c1, r1 = range_boundaries(c.value.ref)
                        for r in range(r0, r1 + 1):
                            for cc in range(c0, c1 + 1):
                                self.dueno[(ws.title, r, cc)] = (c.value, ws.title, r0, c0)

    def valor(self, hoja, fila, col):
        k = (hoja, fila, col)
        if k in self.memo:
            return self.memo[k]
        if k in self.dueno:
            af, h, r0, c0 = self.dueno[k]
            M = np.atleast_2d(np.asarray(self._calc(af.text, h), float))
            for a in range(M.shape[0]):
                for b in range(M.shape[1]):
                    self.memo[(h, r0 + a, c0 + b)] = float(M[a, b])
            return self.memo[k]
        v = self.wb[hoja].cell(fila, col).value
        if isinstance(v, str) and v.startswith("="):
            v = float(self._calc(v, hoja))
        elif v is None:
            v = 0.0
        self.memo[k] = v
        return v

    def rango(self, hoja, a, b=None):
        a = a.replace("$", ""); b = b.replace("$", "") if b else None
        c0, r0, c1, r1 = range_boundaries(f"{a}:{b}" if b else f"{a}:{a}")
        M = np.array([[self.valor(hoja, r, c) for c in range(c0, c1 + 1)] for r in range(r0, r1 + 1)], float)
        return M if b else M[0, 0]

    def _calc(self, texto, hoja):
        def sub(m):
            h = m.group(1)
            h = h.strip("'") if h else hoja
            return f"_R({h!r},{m.group(2)!r},{m.group(3)!r})"
        expr = _REF.sub(sub, texto.lstrip("=")).replace("^", "**")
        return eval(expr, {"_R": self.rango, "MMULT": np.matmul, "MINVERSE": np.linalg.inv,
                           "TRANSPOSE": np.transpose, "np": np, "__builtins__": {}})

    def hoja(self, nombre, fila0, col0, n, m):
        """Matriz n×m evaluada que empieza en (fila0, col0)."""
        return np.array([[self.valor(nombre, fila0 + i, col0 + j) for j in range(m)] for i in range(n)], float)
