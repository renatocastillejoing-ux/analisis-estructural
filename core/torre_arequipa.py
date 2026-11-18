# -*- coding: utf-8 -*-
"""Torre de Arequipa: punto de entrada único para la app. La geometría sale del plano
del curso (core/torre_plano.py y core/torre_plano.json, generados con
tools/extraer_plano.py). La retícula ideal anterior quedó en core/torre_reticula.py."""
from core.torre_plano import (COMBO, CM_AREA, CV_AREA, GAMMA_HA, H_PISO, N_PISOS,  # noqa: F401
                              geometria_3d, modelo3d_torre, portico, todos_los_pórticos)
