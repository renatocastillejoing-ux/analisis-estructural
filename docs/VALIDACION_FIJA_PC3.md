# Validación contra la hoja «FIJA PC3» (2026-11-18)

Pórtico: placa 0.30×1.80, columna 0.30×0.50, viga 0.30×0.50, h = 3.50 m, luz 4.00 m entre ejes,
f'c = 280 (E = 2 509 980.08 t/m²), H = 20 t en el nudo de la placa, EA = ∞, corte en la placa
(ν = 0.15, Ac = 5/6·b·h → α = 0.73). Brazo rígido de la viga = media placa = 0.90 m.

## Por qué la hoja no cuadra

Se reprodujeron EXACTAMENTE los números de la hoja con dos condiciones; ambas son errores:

1. **{D} redondeado** a −0.00027, −0.00007, 0.00078 (1–2 cifras significativas). Con ese {D}
   salen justo los q de la hoja (placa 18.2055 / 60.0905 / 3.6288; columna 1.4434 / 2.6829 /
   2.3691; viga −1.3574 / −3.1071 / −2.3227) y por eso no cierra nada:
   - ΣV de la base = 18.2055 + 1.4434 = 19.65 ≠ 20 t;
   - nudo 4: columna 2.3691 + viga −2.3227 ≠ 0.
   → En la hoja hay que llevar {D} con al menos 6 cifras significativas.
2. **Viga con L = 4.00** en su [K] aunque [A] le pone un brazo de 0.90 (d9 = 0.9·D1). En el
   ejemplo 7-1 el profesor usa la longitud flexible (4.75 − 0.75 = 4.00). Aquí debe ser
   Lf = 4.00 − 0.90 = **3.10**. Con L = 4.00 y {D} sin redondear: placa 18.5625 / 60.6252 / 4.3436.
3. Errata: d3 de la placa escrito −0.00678; es −0.00078 (= −D3).

Todo lo demás de la hoja está bien: E, I, G, Ac, α = 0.73, las cuatro K por barra, [A] y la
[K] total (300 203.52 / 6 569.08 / 103 608.85 / 16 807.898 / 3 841.81 / 61 400.378).

## Resultado correcto (Lf = 3.10, sin redondear)

| Barra | Vi | Mi | Vj | Mj |
|---|---|---|---|---|
| Placa | 18.4407 | 58.8341 | −18.4407 | 5.7085 |
| Columna | 1.5593 | 2.7873 | −1.5593 | 2.6701 |
| Viga (en la cara de la placa) | −2.0946 | −3.8233 | 2.0946 | −2.6701 |

ΣV = 20.00 t y el nudo 4 cierra (2.6701 − 2.6701 = 0). Prueba fija en
tests/test_metodo_profesor.py::test_fija_pc3.
