// Prueba de moverNudosDeEje (editar ejes arrastrando lo que está sobre ellos).   Uso:  node tests/test_mover_eje_3d.mjs
import assert from "node:assert/strict";
import { generarEdificio, moverNudosDeEje } from "../frontend/src/model3d.js";

const m = generarEdificio({ lucesX: [5, 5], lucesY: [5], alturas: [3], pisos: 2 });
const n0 = m.nudos.length, b0 = m.elementos.length;
const enX5 = m.nudos.filter((n) => n.x === 5).length;
assert.ok(enX5 > 0);
assert.equal(moverNudosDeEje(m, "x", 5, 6), enX5);
assert.equal(m.nudos.filter((n) => n.x === 5).length, 0);
assert.equal(m.nudos.filter((n) => n.x === 6).length, enX5);
assert.equal(m.nudos.length, n0);
assert.equal(m.elementos.length, b0, "las barras siguen conectadas");
// un nivel: todo lo que está en z = 3 sube a 3.5
const enZ3 = m.nudos.filter((n) => n.z === 3).length;
assert.equal(moverNudosDeEje(m, "z", 3, 3.5), enZ3);
assert.equal(m.nudos.filter((n) => n.z === 3.5).length, enZ3);
// fusión: llevar el eje x=6 sobre x=10 une los nudos
moverNudosDeEje(m, "x", 6, 10);
assert.equal(m.nudos.filter((n) => n.x === 10).length, enX5, "no se duplican nudos");
assert.equal(moverNudosDeEje(m, "x", 99, 100), 0, "coordenada sin nudos: nada");
console.log("OK: moverNudosDeEje");
