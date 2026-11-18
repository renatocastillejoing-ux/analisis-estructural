# Auditoría · Análisis Estructural (2026-11-18)

Estado al revisar: rama `main`, último commit `80be7ea`. Tests: **28/28 en verde** (`python -m pytest tests -q`, 10 s).
Cambios sin commit: se borraron `README.md`, `hiperestatico_test.json`, `test_hiperestatico.py`, `verify_loads.py`;
`core/graficos.py` solo tiene comentarios traducidos; `Documentación explicativa.txt` y `.claude/` sin seguimiento.

## 1. Cómo funciona

```
React (frontend/src, build → static/react)  ──fetch──►  Flask app.py  ──►  core/
```

| Capa | Archivo | Qué hace |
|---|---|---|
| Motor 2D | `core/metodo_rigidez.py` (944) | Método directo de rigidez, 3 GDL/nudo. Rótulas por condensación, tramos no prismáticos (placas) por cadena + condensación, Timoshenko, P-Delta iterativo (≤12 iter.), resortes, asentamientos, modal (masa consistente), diagnóstico de mecanismo por SVD. |
| Método del profesor | `core/metodo_matricial_A.py` (516) | Método sistematizado [A]: `K = Σ AᵀkA`, 13 pasos para el reproductor animado. Reproduce EJ1/EJ2; signo = −directo. |
| Motor 3D | `core/analisis_3d.py` (1159) | 6 GDL/nudo, scipy.sparse + LU, brazos rígidos, rótulas, espectral E.030, combinaciones. Guarda los 6 últimos cálculos **en memoria del proceso** (para «pórtico por eje»). |
| Puente | `core/constructor.py` (557) | JSON ↔ objetos, unidades (base tonf·m), `extraer_resultados`, combinaciones. |
| Salidas | `reporte.py` (memoria .txt), `graficos.py` (PNG solo con `?imagenes=1`), `diseno_e060.py` | |
| Torre | `torre_arequipa.py`, `torre_sismo.py`, `torre_resultados.py` | Modelo supuesto de la torre (24 pórticos y 3D). |
| API | `app.py` (388) | `/api/calcular`, `/combinaciones`, `/metodo_a`, `/calcular3d*`, `/modelo3d/portico`, `/torre*`, `/diseno`, `/seccion`, `/historial*`. Historial en SQLite `historial.db`. |
| UI | `frontend/src` (React + Tailwind + three.js) | `App.jsx` orquesta; `Editor/Canvas/Props` (2D), `Editor3D/Lienzo3D/Visor3D` (3D), `Paso.jsx` (animación [A]), `Results*.jsx`, `Manual`. |
| Deploy | `render.yaml` | gunicorn **1 proceso × 4 hilos** (obligatorio por la caché 3D en memoria). |

Flujo de un cálculo 2D: UI arma el JSON → `construir()` → `Estructura.resolver()` (ensamblar → verificar rango → `solve` → fuerzas por barra) → `extraer_resultados()` + `generar_reporte()` → se guarda todo en SQLite → respuesta JSON.

## 2. Mediciones (pórtico de la torre, eje letra A: 450 GDL libres)

| Paso | Tiempo | Tamaño |
|---|---|---|
| `resolver()` | 0,26 s | — |
| ↳ `matrix_rank(Kff)` | 0,067 s | — |
| ↳ `cond(Kff)` | 0,073 s | — |
| ↳ `solve` (lo único necesario) | **0,0075 s** | — |
| `extraer_resultados()` | 0,66 s | 3,9 MB JSON |
| ↳ `K` + `Kff` | — | **2,3 MB** (el frontend no los usa) |
| ↳ `diagramas` | — | 1,5 MB |
| `generar_reporte()` | **2,1 s** | **6,9 MB** de texto |

Respuesta total ≈ 11 MB y ~3 s por cálculo; además **se guarda entera en SQLite**: `historial.db` ya pesa 29 MB con 51 cálculos (28,7 MB son el campo `resultado`).

## 3. Hallazgos

### Rendimiento (lo que más se nota)
1. **Memoria de cálculo generada siempre** (2,1 s, 6,9 MB). Solo la usan «Exportar memoria» y una pestaña de Resultados. → Generarla bajo demanda (`/api/reporte/<id>` o `?reporte=1`), o resumida para modelos grandes.
2. **`K` y `Kff` viajan en cada respuesta** (2,3 MB) y el frontend 2D no los lee (el paso a paso usa los de `/api/metodo_a`). → Quitarlos de `extraer_resultados` o enviarlos solo con `?matrices=1`.
3. **Historial guarda el payload completo** (~0,5–11 MB por fila, sin tope). → Guardar solo `datos` + `resumen` y recalcular al abrir (el motor tarda <0,3 s), o limitar a N filas. `GET /api/historial` además lee y parsea todos los modelos.
4. **Tres factorizaciones O(n³) por solución**: `matrix_rank` y `cond` (dos SVD) cuestan 18× el `solve`, y se repiten en cada iteración P-Delta. → Resolver primero con Cholesky/`solve` y hacer el SVD solo si falla o si el residuo es malo; `cond` estimado (1-norma) o solo bajo demanda.
5. **Ensamblaje 2D con doble bucle Python 6×6** y matriz densa. Con 450 GDL va bien; para la torre completa en 2D conviene `np.add.at` o scipy.sparse como ya hace el 3D.
6. **`/api/metodo_a` resuelve dos veces** (sistematizado + directo para diagramas). Aceptable, pero se podrían derivar los diagramas de las `q` ya calculadas.
7. **Frontend**: `Visor3D` 490 KB e `index` 420 KB sin comprimir. Ya hay code-splitting; falta compresión (gzip/brotli en Flask o servir con `flask-compress`) y caché larga para `/static/react/assets` (los nombres llevan hash).

### Robustez / seguridad
8. **`detalle` con traceback** se devuelve al navegador en `/api/calcular`, `/metodo_a`, `/calcular3d`. Útil en local; en Render expone rutas internas. → Solo si `FLASK_DEBUG=1`.
9. **Sin límite de tamaño de petición** (`MAX_CONTENT_LENGTH`) ni de tamaño de modelo: un JSON enorme bloquea uno de los 4 hilos el tiempo que dure el SVD. → Poner límite y tope de GDL.
10. **Historial sin dueño**: en Render, cualquiera que abra la URL ve, borra o vacía (`/api/historial/limpiar`) el historial de todos. Además el disco de Render es efímero: el historial se pierde en cada deploy.
11. **Caché 3D en memoria** obliga a 1 proceso; si se escala o reinicia, «pórtico por eje» falla con «vuelve a calcular». Documentado; aceptable para uso educativo.
12. `np.linalg.inv` en condensaciones (`metodo_rigidez.py:348,420,814`, `analisis_3d.py:150`) → `solve` es más estable; el `pinv` de respaldo en rótulas 3D puede ocultar un mecanismo local.

### Higiene
13. Cambios sin commit (borrado de README y scripts de prueba sueltos): confirmar si es intencional antes de commitear. `Documentación explicativa.txt` quedó fuera del repo.
14. `historial.db` (29 MB) dentro de la carpeta: verificar que siga en `.gitignore`.
15. `requirements.txt` sin versiones fijas (`numpy`, `scipy`, `flask>=3.0`): un deploy nuevo puede traer numpy 2.x/3.x con cambios. → Fijar versiones probadas.
16. `scipy` ahora **sí** se usa (motor 3D): la nota antigua de «dependencia fantasma» ya no aplica.

### Correctitud (pendientes conocidos, no nuevos)
- El 2D por eje de la torre cuenta la losa dos veces (el 3D la reparte bien).
- Momento de base de EJ1: el motor da +0,696 y la pizarra −0,70 (convención de la Kc); decisión pendiente.
- Deformada y masa de elementos con tramos son aproximadas.

## 4. Orden sugerido antes de las actualizaciones

| # | Cambio | Esfuerzo | Efecto |
|---|---|---|---|
| 1 | Quitar `K`/`Kff` de la respuesta + reporte bajo demanda | bajo | 11 MB → ~1,6 MB, 3 s → ~0,9 s |
| 2 | Historial: guardar solo datos + resumen, con tope | bajo | DB deja de crecer |
| 3 | Rango/cond solo si el `solve` falla | bajo | resolver 0,26 s → ~0,1 s |
| 4 | Traceback solo en local + `MAX_CONTENT_LENGTH` | bajo | seguridad en Render |
| 5 | Fijar versiones en `requirements.txt` | bajo | deploys reproducibles |
| 6 | Ensamblaje vectorizado/sparse en 2D | medio | modelos grandes |
| 7 | Compresión y caché de estáticos | bajo | carga inicial |

Ninguno de estos cambios se aplicó en esta auditoría.
