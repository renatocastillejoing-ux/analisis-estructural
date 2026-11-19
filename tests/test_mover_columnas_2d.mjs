// Prueba de columnaEntera2d / trasladarColumnas2d.   Uso:  node tests/test_mover_columnas_2d.mjs
import assert from "node:assert/strict";
import { generarPortico, columnaEntera2d, trasladarColumnas2d } from "../frontend/src/model.js";

const m = generarPortico({ pisos: 2, luces: [4, 4], alturas: [3], apoyo: "empotrado", b_col: 0.3, h_col: 0.3, b_viga: 0.25, h_viga: 0.5, w: 2 });
const nx = (id) => m.nudos.find((n) => n.id === id);
const en = (x, y) => m.nudos.find((n) => Math.abs(n.x - x) < 1e-9 && Math.abs(n.y - y) < 1e-9);
const largo = (e) => Math.hypot(nx(e.j).x - nx(e.i).x, nx(e.j).y - nx(e.i).y);

const col = m.elementos.find((e) => nx(e.i).x === 4 && nx(e.i).y === 0);
const ids = columnaEntera2d(m, col.id);
assert.equal(ids.length, 2, "la columna central tiene 2 pisos");
assert.deepEqual(columnaEntera2d(m, m.elementos.find((e) => nx(e.i).y === 3 && nx(e.j).x !== nx(e.i).x).id), [], "una viga no es columna");

// cargas extra sobre la viga V2 (4→8) del piso 1: puntual al centro (4 m → a = 2) y trapezoidal
const v2 = m.elementos.find((e) => nx(e.i).x === 4 && nx(e.j).x === 8 && nx(e.i).y === 3);
m.cargas_elementos.push({ elem: v2.id, tipo: "puntual", Py: -5, Px: 0, a: null }, { elem: v2.id, tipo: "distribuida", subtipo: "trapezoidal", wy1: 0, wy2: -4, wx1: 0, wx2: 0 });
const wTot = (id) => m.cargas_elementos.filter((c) => c.elem === id && c.subtipo === "uniforme").reduce((s, c) => s + c.wy * largo(m.elementos.find((e) => e.id === id)), 0);
const carga0 = wTot(v2.id);

const nElem0 = m.elementos.length;
const r = trasladarColumnas2d(m, ids, 1);               // x = 4 → 5: cae dentro de V2 (4→8) en y = 3 y en y = 6
assert.equal(r.movidas, 2);
assert.equal(r.cortes, 2, "se cortan las vigas de los dos pisos");
assert.equal(m.elementos.length, nElem0 + 2);
// la columna ahora vive en x = 5, y los apoyos se trasladaron
assert.ok(ids.every((id) => { const e = m.elementos.find((q) => q.id === id); return nx(e.i).x === 5 && nx(e.j).x === 5; }));
assert.equal(en(5, 0).apoyo, "empotrado", "el apoyo viaja con la columna");
assert.equal(en(4, 0), undefined, "el nudo de base viejo se elimina");
assert.ok(en(4, 3), "las vigas se quedan: el nudo (4,3) sigue existiendo");
// V2 quedó en 4→5 (1 m) y su mitad nueva 5→8 (3 m); uniforme repartida en proporción, w total conservado
const partes = m.elementos.filter((e) => e.nombre.startsWith(v2.nombre) && nx(e.i).y === 3);
assert.equal(partes.length, 2);
const [p1, p2] = partes.sort((a, b) => nx(a.i).x - nx(b.i).x);
assert.ok(Math.abs(largo(p1) - 1) < 1e-9 && Math.abs(largo(p2) - 3) < 1e-9);
assert.ok(Math.abs(wTot(p1.id) + wTot(p2.id) - carga0) < 1e-9, "la carga uniforme total se conserva");
// puntual a = 2 (centro de 4 m) cae en el 2.º tramo, a = 2 - 1 = 1 desde el nuevo nudo
const pun = m.cargas_elementos.find((c) => c.tipo === "puntual" && c.elem === p2.id);
assert.ok(pun && Math.abs(pun.a - 1) < 1e-9, "puntual pasa al tramo 5→8 con a = 1");
// trapezoidal: de 0 a -4 en 4 m → en s = 1 m vale -1; tramo 1: 0→-1, tramo 2: -1→-4
const t1 = m.cargas_elementos.find((c) => c.subtipo === "trapezoidal" && c.elem === p1.id);
const t2 = m.cargas_elementos.find((c) => c.subtipo === "trapezoidal" && c.elem === p2.id);
assert.ok(Math.abs(t1.wy2 + 1) < 1e-9 && Math.abs(t2.wy1 + 1) < 1e-9 && t2.wy2 === -4 && t1.wy1 === 0, "trapezoidal repartida");
// integridad: ninguna carga apunta a una barra inexistente, ningún nudo suelto, sin barras duplicadas
assert.ok(m.cargas_elementos.every((c) => m.elementos.some((e) => e.id === c.elem)));
const usados = new Set(m.elementos.flatMap((e) => [e.i, e.j]));
assert.ok(m.nudos.every((n) => usados.has(n.id)), "sin nudos sueltos");
const pares = m.elementos.map((e) => [Math.min(e.i, e.j), Math.max(e.i, e.j)].join("-"));
assert.equal(new Set(pares).size, pares.length, "sin barras duplicadas");

// mover sobre un nudo existente (columna de x=0 hacia x=4 piso a piso: no hay ya columna en x=4 → se conecta)
const ids0 = columnaEntera2d(m, m.elementos.find((e) => nx(e.i).x === 0 && nx(e.i).y === 0).id);
const r0 = trasladarColumnas2d(m, ids0, 4);
assert.equal(r0.movidas, 2);
assert.ok(m.nudos.every((n) => n.x !== 0 || n.y === 3 || n.y === 6), "solo quedan los nudos de las vigas en x = 0");
// no mover con dx = 0
assert.deepEqual(trasladarColumnas2d(m, ids0, 0), { movidas: 0, cortes: 0, omitidas: 0 });

// carga en nudo que queda suelto viaja con la columna
const m2 = generarPortico({ pisos: 1, luces: [4], alturas: [3], apoyo: "empotrado", b_col: 0.3, h_col: 0.3, b_viga: 0.25, h_viga: 0.5, w: 0 });
m2.cargas_nodales.push({ nudo: 1, Fx: 3, Fy: 0, M: 0 });          // en la base de la columna izquierda
const c2 = m2.elementos.find((e) => m2.nudos.find((n) => n.id === e.i).x === 0 && m2.nudos.find((n) => n.id === e.i).y === 0);
trasladarColumnas2d(m2, [c2.id], 2);
const cn = m2.cargas_nodales[0];
assert.equal(m2.nudos.find((n) => n.id === cn.nudo).x, 2, "la carga nodal viaja al nuevo nudo");
console.log("OK: trasladarColumnas2d");
