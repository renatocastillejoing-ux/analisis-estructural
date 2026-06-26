# Análisis Estructural · Método Matricial de Rigidez (aplicación web)

Aplicación web full-stack para el análisis de **pórticos planos 2D** por el **método matricial directo de rigidez**. Permite definir la estructura desde una interfaz visual, calcular, y ver los resultados (desplazamientos, reacciones, fuerzas internas, diagramas y memoria de cálculo) **en la misma pantalla**, con un **historial** de todos los cálculos realizados.

Proyecto de fin de ciclo. Interfaz con el sistema de diseño **Museo Larco Premium**.

---

## 1. Cómo ejecutar

Requisitos: **Python 3.9+**.

```bash
# 1) (opcional) crear entorno virtual
python -m venv venv
# Windows:  venv\Scripts\activate
# Mac/Linux: source venv/bin/activate

# 2) instalar dependencias
pip install -r requirements.txt

# 3) iniciar el servidor
python app.py
```

Luego abre en el navegador:

```
http://127.0.0.1:5000
```

Al iniciar se carga automáticamente un **pórtico de ejemplo** (dos tramos, 5 barras) que puedes calcular de inmediato o modificar.

---

## 2. Cómo se usa la interfaz

La aplicación tiene **tres pestañas** (arriba a la derecha):

### Modelo
Columna izquierda (editor) y columna derecha (vista previa en vivo). En el editor defines, por secciones plegables:
- **General**: nombre del proyecto y si se **desprecian las deformaciones axiales** (idealización del método manual de pocos GDL).
- **Material**: módulo `E` (tonf/m²) o por `f'c` (kgf/cm², con `Ec = 15000·√f'c`).
- **Secciones**: rectangulares `b × h` (se calculan `A` e `I`). Puedes agregar varias y referenciarlas por nombre.
- **Nudos**: coordenadas `(x, y)` y tipo de apoyo (empotrado, articulado, rodillo en X, rodillo en Y, libre).
- **Elementos**: nudo inicial `i`, nudo final `j`, sección, y **rótulas** (liberación de momento) en los extremos `i` y/o `j`.
- **Cargas en nudos**: `Fx`, `Fy`, `M` (sistema global).
- **Cargas en elementos**: distribuida **uniforme**, distribuida **trapezoidal**, **puntual**, o **momento** aplicado, indicando intensidad, dirección y posición.

La **vista previa** se actualiza a cada cambio: dibuja barras, nudos, apoyos, rótulas y cargas. Pulsa **Calcular estructura** para resolver.

### Resultados
Se muestran en la misma pantalla:
- **KPIs**: momento máximo, cortante máximo, desplazamiento máximo y número de grados de libertad.
- **Diagramas** (imágenes): DMF, DFC/DMC, axial, deformada y modelo, con un selector.
- **Tablas**: desplazamientos y rotaciones por nudo, reacciones, y fuerzas internas en extremos de cada elemento.
- **Memoria de cálculo paso a paso**: matrices locales y globales de cada barra, ensamblaje, partición y solución del sistema.

### Historial
Cada cálculo se guarda automáticamente (base de datos **SQLite** `historial.db`). Desde aquí puedes **Ver** un cálculo anterior (recupera todos sus resultados y diagramas), **Editar** (carga sus datos en el editor para recalcular) o **Eliminar**.

---

## 3. Arquitectura

```
analisis_estructural_web/
├── app.py                 # Servidor Flask: API REST + historial SQLite
├── requirements.txt
├── core/                  # Motor de cálculo (independiente de la web)
│   ├── metodo_rigidez.py  #   matrices, ensamblaje, solución, fuerzas internas, rótulas
│   ├── constructor.py     #   construye el modelo desde JSON + extrae resultados
│   ├── reporte.py         #   memoria de cálculo paso a paso
│   └── graficos.py        #   diagramas (matplotlib) -> PNG base64
├── templates/
│   └── index.html         # interfaz (una sola página)
└── static/
    ├── css/style.css      # estilos (sistema Museo Larco, CSS puro)
    └── js/app.js          # lógica del front (editor, preview, resultados, historial)
```

**Flujo:** el front arma un JSON con el modelo y lo envía a `POST /api/calcular`; Flask construye la estructura con `core/`, la resuelve, genera resultados + diagramas (PNG en base64) + memoria de cálculo, lo guarda en SQLite y lo devuelve; el front lo muestra. Los diagramas se generan en el servidor con matplotlib y se incrustan en la página (no se descargan archivos sueltos).

### API
| Método | Ruta | Descripción |
|---|---|---|
| GET  | `/` | Interfaz web |
| GET  | `/api/ejemplo` | Modelo de ejemplo |
| POST | `/api/calcular` | Resuelve y devuelve resultados + imágenes + memoria; guarda en historial |
| GET  | `/api/historial` | Lista de cálculos guardados |
| GET  | `/api/historial/<id>` | Recupera un cálculo completo |
| DELETE | `/api/historial/<id>` | Elimina un cálculo |
| POST | `/api/historial/limpiar` | Vacía el historial |

---

## 4. Método y validación

- **Elemento viga-columna** con 3 GDL por nudo `[ux, uy, giro]`; matriz local 6×6 (axial `EA/L`; flexión `12EI/L³, 6EI/L², 4EI/L`), transformación a global `K = Tᵀ k T` y **ensamblaje directo**, que equivale a la operación `Aᵀ k A` con matriz de compatibilidad (el método que valida ETABS).
- **Despreciar deformaciones axiales**: rigidiza el eje axial de las barras; los desplazamientos verticales resultan ≈ 0 y el nivel se traslada como cuerpo rígido, reproduciendo la idealización de pocos GDL del método manual.
- **Cargas trapezoidales, puntuales y momentos**: fuerzas de empotramiento perfecto consistentes (incluye funciones de forma de Hermite para el momento aplicado).
- **Rótulas internas**: condensación estática del GDL rotacional liberado.
- **Guardia de estabilidad**: si la matriz de rigidez es singular (estructura mal restringida), se informa el error en lugar de devolver resultados sin sentido.

El motor fue verificado contra soluciones teóricas exactas: viga empotrada-empotrada (uniforme y triangular), simplemente apoyada (puntual y momento), voladizo, propped cantilever (rótula) y equilibrio global de pórticos.

---

## 5. Notas

- Usa **unidades consistentes** (recomendado **tonf, m**).
- El ejemplo trae las **secciones y el módulo E del enunciado** (vigas 25×50, columnas 40×40 y 30×30, E = 2×10⁶ tonf/m²). Las **luces, la altura y las cargas** del ejemplo son valores de referencia: reemplázalos por los de tu problema.
- El historial se guarda en `historial.db` (se crea solo). Para empezar de cero, basta con borrar ese archivo.

---

## Novedades versión 3

Mejoras de exactitud, modelado y experiencia añadidas en esta versión:

### Motor de cálculo (mayor exactitud y elementos más complejos)
- **Calculadora de propiedades de sección** (`core/secciones.py`): rectangular maciza, cajón hueco, circular, tubo circular, perfil I y perfil T. Calcula A e I automáticamente (con centroide en el perfil T).
- **Cargas distribuidas generalizadas por integración numérica** (Gauss–Legendre sobre las funciones de forma de Hermite): maneja uniforme, trapezoidal y **parcial** (tramo de *a* hasta *b*) de forma unificada y exacta.
- **Apoyos elásticos (resortes)** en x, y y giro: se suman a la diagonal de la matriz de rigidez; su fuerza se reporta como reacción.
- **Asentamientos / desplazamientos impuestos** en apoyos (desplazamiento prescrito en GDL restringidos).
- **Peso propio automático**: a partir del peso específico del material (w = γ·A por elemento, hacia −Y).
- **Verificación de equilibrio global** (ΣFx, ΣFy, ΣM y residuos ≈ 0) como sello de calidad de cada resultado.
- **Número de condición** de la matriz Kff (aviso si está mal condicionada).

### Interfaz
- **Calculadora de secciones integrada**: eliges el tipo y las dimensiones y ves A e I en vivo.
- **Cargas nodales por magnitud + ángulo**: ingresas “12 a 55°” y el sistema descompone Fx y Fy automáticamente (además del modo por componentes).
- **Cargas distribuidas parciales** (campos *a* y *b*) y **peso propio** (interruptor + densidad del material).
- **Panel de verificación de equilibrio** y badge de condición en los resultados.
- **Importar / Exportar proyecto** en formato `.json` (respaldo y trabajo en equipo).
- **Exportar memoria** (`.txt`), **tablas** (`.csv`) e **Imprimir / Guardar como PDF** (estilo de impresión dedicado).

### Endpoints nuevos
- `POST /api/seccion` → calcula A e I de un tipo de sección.
- `GET /api/tipos_seccion` → lista de tipos disponibles y sus campos.

> Nota: los apoyos elásticos y asentamientos están soportados por el motor y la API; pueden usarse hoy vía **Importar `.json`** (campos `resorte` y `asentamiento` en cada nudo). Su edición visual en el formulario de nudos queda como mejora pendiente.
