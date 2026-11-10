import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { propsSeccion } from "../model.js";

// Visor 3D (three.js). Coordenadas de ingeniería: x, y en planta, z hacia arriba.
// Cada miembro es una caja con su sección real: ancho `w` en la dirección `wDir` y `d` en la otra.

const PALETA = ["#508C9B", "#C1666B", "#6E9B54", "#B0894E", "#7E6C9B", "#3F7C8C", "#C98A3B", "#5E7BA6"];
const COLOR_TIPO = { columna: "#5E7BA6", placa: "#C1666B", viga_x: "#6E9B54", viga_y: "#C98A3B", viga: "#6E9B54" };
const T = ([x, y, z]) => new THREE.Vector3(x, z, -y);

/* ----------------------------- construcción de escenas ----------------------------- */
export function escenaModelo(m) {
  const secs = Object.fromEntries(m.secciones.map((s, i) => [s.nombre, { ...propsSeccion(s), b: s.modo === "AI" ? (+s.A || 0) / (propsSeccion(s).h || 1) : +s.b, color: PALETA[i % PALETA.length] }]));
  const por = Object.fromEntries(m.nudos.map((n) => [n.id, n]));
  const miembros = [];
  m.elementos.forEach((e) => {
    const a = por[e.i], b = por[e.j];
    if (!a || !b) return;
    const dx = b.x - a.x, dz = b.y - a.y, L = Math.hypot(dx, dz) || 1;
    const vertical = Math.abs(dx) < 1e-9;
    const tramos = (e.segmentos || e.tramos || []).filter((t) => +t.L > 0);
    const partes = tramos.length >= 2 ? tramos : [{ L, seccion: e.seccion }];
    const suma = partes.reduce((s, t) => s + +t.L, 0) || L;
    let s0 = 0;
    partes.forEach((t, k) => {
      const s1 = s0 + (+t.L / suma) * L;
      const sec = secs[t.seccion] || secs[e.seccion] || { h: 0.3, b: 0.3, color: "#888" };
      const P = (s) => [a.x + (dx * s) / L, 0, a.y + (dz * s) / L];
      miembros.push({
        id: e.id, a: P(s0), b: P(s1), w: sec.h || 0.3, d: sec.b || 0.3, wDir: [-dz / L, 0, dx / L],
        tipo: vertical ? "columna" : "viga", color: sec.color, piso: null, grupos: [],
        info: `${e.nombre} · ${t.seccion || e.seccion}${partes.length > 1 ? ` (tramo ${k + 1})` : ""} · L = ${(s1 - s0).toFixed(2)} m`,
      });
      s0 = s1;
    });
  });
  const apoyos = m.nudos.filter((n) => n.apoyo !== "libre").map((n) => ({ p: [n.x, 0, n.y], tipo: n.apoyo }));
  return { miembros, losas: [], apoyos, etiquetas: [], pisos: 0 };
}

export function escenaTorre(g) {
  const miembros = [];
  g.columnas.forEach((c) => miembros.push({
    a: [c.x, c.y, c.z0], b: [c.x, c.y, c.z1], w: c.bx, d: c.by, wDir: [1, 0, 0],
    tipo: c.placa ? "placa" : "columna", piso: c.piso, grupos: [`L:${c.letra}`, `N:${c.numero}`],
    seccion: c.seccion, eje: { letra: c.letra, numero: c.numero },
    info: `${c.placa ? "Placa" : "Columna"} ${c.letra}-${c.numero} · piso ${c.piso} · ${c.bx.toFixed(2)}×${c.by.toFixed(2)} m`,
  }));
  g.vigas.forEach((v) => miembros.push({
    a: [v.x0, v.y0, v.z - v.h / 2], b: [v.x1, v.y1, v.z - v.h / 2], w: v.h, d: v.b, wDir: [0, 0, 1],
    tipo: v.dir === "x" ? "viga_x" : "viga_y", piso: v.piso, grupos: v.dir === "x" ? [`L:${v.letra}`] : [`N:${v.numero}`],
    seccion: v.seccion, eje: { letra: v.letra, numero: v.numero },
    info: `Viga ${v.dir === "x" ? `eje ${v.letra}` : `eje ${v.numero}`} · piso ${v.piso} · ${v.b.toFixed(2)}×${v.h.toFixed(2)} m`,
  }));
  const x0 = g.xs[0], x1 = g.xs[g.xs.length - 1], y0 = g.ys[0], y1 = g.ys[g.ys.length - 1];
  const losas = Array.from({ length: g.n_pisos }, (_, k) => ({ x0, x1, y0, y1, z: (k + 1) * g.h_piso, piso: k + 1 }));
  const etiquetas = [
    ...g.ejes_x.map((t, k) => ({ texto: t, p: [g.xs[k], y0 - 3, 0], grupo: `N:${t}` })),
    ...g.ejes_y.map((t, k) => ({ texto: t, p: [x1 + 3, g.ys[k], 0], grupo: `L:${t}` })),
    ...Array.from({ length: g.n_pisos }, (_, k) => ({ texto: `P${k + 1}`, p: [x1 + 2.5, y0 - 2.5, (k + 1) * g.h_piso], piso: k + 1 })),
  ];
  const ejes = [
    ...g.ejes_x.map((t, k) => ({ a: [g.xs[k], y0 - 1.2, 0], b: [g.xs[k], y1 + 1.2, 0] })),
    ...g.ejes_y.map((t, k) => ({ a: [x0 - 1.2, g.ys[k], 0], b: [x1 + 1.2, g.ys[k], 0] })),
  ];
  return { miembros, losas, apoyos: [], etiquetas, ejes, pisos: g.n_pisos };
}

/* ----------------------------- componente ----------------------------- */
export default function Visor3D({ escena, resaltar, pisoMax = Infinity, colorPor = "tipo", verLosas = true, verEtiquetas = true, onElegir, vistaKey, ajusteKey, controles = true, pendiente }) {
  const host = useRef(null);
  const st = useRef({});
  const [hover, setHover] = useState(null);
  const [verSuelo, setVerSuelo] = useState(true);
  const [ayuda, setAyuda] = useState(false);

  // montaje: renderer, cámara, controles, luces
  useEffect(() => {
    const el = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const persp = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    const orto = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
    const camera = persp;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;                         // la rueda acerca hacia el cursor (como Blender)
    // ratón estilo Blender: botón central orbita (Shift+central desplaza), izquierdo también orbita, derecho desplaza
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    controls.keys = { LEFT: "", UP: "", RIGHT: "", BOTTOM: "" };
    const alPulsar = (e) => { if (e.button === 1 && e.shiftKey) controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN; else if (e.button === 1) controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE; };
    renderer.domElement.addEventListener("pointerdown", alPulsar, true);
    renderer.domElement.addEventListener("auxclick", (e) => e.preventDefault());

    // cuadrícula del terreno con ejes X (rojo) e Y (verde), como Blender
    const suelo = new THREE.Group(); scene.add(suelo);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.1));
    const sol = new THREE.DirectionalLight(0xffffff, 1.4);
    sol.position.set(60, 120, 80);
    scene.add(sol);
    const raiz = new THREE.Group();
    scene.add(raiz);

    const tema = () => {
      const oscuro = document.documentElement.classList.contains("dark");
      scene.background = new THREE.Color(oscuro ? 0x0e1421 : 0xf1f5f9);
      st.current.oscuro = oscuro;
    };
    tema();
    const mo = new MutationObserver(tema);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const ajustarOrto = () => {
      const c = st.current.camera; if (c !== orto) return;
      const dist = persp.position.distanceTo(controls.target);
      const h = dist * Math.tan((persp.fov * Math.PI) / 360);
      orto.left = -h * persp.aspect; orto.right = h * persp.aspect; orto.top = h; orto.bottom = -h;
      orto.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(([en]) => {
      const { width, height } = en.contentRect;
      renderer.setSize(width, height);
      persp.aspect = width / Math.max(height, 1);
      persp.updateProjectionMatrix();
      orto.zoom = orto.zoom || 1; ajustarOrto();
    });
    ro.observe(el);
    const q = new THREE.Quaternion(), v = new THREE.Vector3();
    renderer.setAnimationLoop(() => {
      controls.update();
      const cam = st.current.camera || persp;
      renderer.render(scene, cam);
      // gizmo de navegación: proyecta los ejes del mundo con la orientación de la cámara
      const giz = st.current.gizmo;
      if (giz) {
        q.copy(cam.quaternion).invert();
        [["x", [1, 0, 0]], ["y", [0, 0, -1]], ["z", [0, 1, 0]]].forEach(([k, d]) => {
          v.set(...d).applyQuaternion(q);
          const g = giz.querySelector(`[data-eje="${k}"]`), gn = giz.querySelector(`[data-eje="-${k}"]`);
          if (g) { g.setAttribute("transform", `translate(${40 + v.x * 28},${40 - v.y * 28})`); g.style.opacity = v.z < -0.2 ? 0.55 : 1; }
          if (gn) gn.setAttribute("transform", `translate(${40 - v.x * 28},${40 + v.y * 28})`);
          const ln = giz.querySelector(`[data-linea="${k}"]`);
          if (ln) { ln.setAttribute("x2", 40 + v.x * 28); ln.setAttribute("y2", 40 - v.y * 28); }
        });
      }
    });

    // perspectiva ⇄ ortográfica sin perder el encuadre
    const usarCamara = (ortografica) => {
      const nueva = ortografica ? orto : persp;
      if (nueva === st.current.camera) return;
      if (ortografica) { orto.position.copy(persp.position); orto.quaternion.copy(persp.quaternion); orto.zoom = 1; st.current.camera = orto; ajustarOrto(); }
      else {
        const dist = persp.position.distanceTo(controls.target) / (orto.zoom || 1);
        persp.position.copy(controls.target).add(orto.position.clone().sub(controls.target).normalize().multiplyScalar(dist));
        persp.quaternion.copy(orto.quaternion); st.current.camera = persp;
      }
      controls.object = nueva; controls.update();
    };

    st.current = { ...st.current, renderer, scene, camera, persp, orto, controls, raiz, suelo, usarCamara, ajustarOrto };
    el.__visor = st;                                   // inspección en pruebas
    return () => {
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("pointerdown", alPulsar, true);
      ro.disconnect(); mo.disconnect(); controls.dispose();
      raiz.traverse((o) => { o.geometry?.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m?.map?.dispose(); m?.dispose(); }); });
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  const visibles = useMemo(() => escena.miembros.map((m, k) => ({ m, k })).filter(({ m }) => m.piso == null || m.piso <= pisoMax), [escena, pisoMax]);

  // geometría de la escena
  useEffect(() => {
    const { raiz } = st.current;
    if (!raiz) return;
    raiz.traverse((o) => { if (o !== raiz) { o.geometry?.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m?.map?.dispose(); m?.dispose(); }); } });
    raiz.clear();

    const caja = new THREE.BoxGeometry(1, 1, 1);
    const enGrupo = (m) => !resaltar || m.grupos?.includes(resaltar);
    const solidos = visibles.filter(({ m }) => enGrupo(m));
    const fantasmas = visibles.filter(({ m }) => !enGrupo(m));
    const color = (m) => {
      if (m.sel) return "#F59E0B";
      if (resaltar) return m.tipo === "placa" ? "#E11D48" : "#508C9B";
      if (colorPor === "piso" && m.piso) return new THREE.Color().setHSL(0.55 - (m.piso / (escena.pisos || 1)) * 0.5, 0.45, 0.5);
      if (colorPor === "seccion" && m.seccion) return PALETA[(parseInt(m.seccion.replace(/\D/g, "")) || 0) % PALETA.length];
      return m.color || COLOR_TIPO[m.tipo] || "#888";
    };
    const mat4 = new THREE.Matrix4();
    const instanciar = (lista, material) => {
      if (!lista.length) return null;
      const mesh = new THREE.InstancedMesh(caja, material, lista.length);
      lista.forEach(({ m }, i) => {
        const A = T(m.a), B = T(m.b);
        const eje = B.clone().sub(A); const L = eje.length() || 1e-6; eje.divideScalar(L);
        let w = T(m.wDir).sub(T([0, 0, 0]));
        w.sub(eje.clone().multiplyScalar(w.dot(eje))).normalize();
        if (w.lengthSq() < 1e-9) w = new THREE.Vector3(0, 1, 0);
        const d = new THREE.Vector3().crossVectors(eje, w).normalize();
        mat4.makeBasis(eje.multiplyScalar(L), w.multiplyScalar(m.w), d.multiplyScalar(m.d));
        mat4.setPosition(A.add(B).multiplyScalar(0.5));
        mesh.setMatrixAt(i, mat4);
        mesh.setColorAt(i, new THREE.Color(color(m)));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.lista = lista;
      raiz.add(mesh);
      return mesh;
    };
    const solido = instanciar(solidos, new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.05 }));
    instanciar(fantasmas, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.08, depthWrite: false, roughness: 1 }));
    st.current.pickable = solido;

    // nudos seleccionables (para dibujar y conectar en 3D)
    const bb = new THREE.Box3();
    escena.miembros.forEach((m) => { bb.expandByPoint(T(m.a)); bb.expandByPoint(T(m.b)); });
    const diag = bb.isEmpty() ? 10 : bb.getSize(new THREE.Vector3()).length();
    const kEt = Math.min(1, Math.max(0.3, diag / 70));
    // cuadrícula del terreno (1 m, o 5 m en modelos grandes) y ejes de color
    const { suelo } = st.current;
    if (suelo) {
      suelo.traverse((o) => { if (o !== suelo) { o.geometry?.dispose(); o.material?.dispose(); } }); suelo.clear();
      if (!bb.isEmpty()) {
        const paso = diag > 60 ? 5 : 1, c = bb.getCenter(new THREE.Vector3());
        const lado = Math.ceil((diag * 1.6) / paso) * paso;
        const grid = new THREE.GridHelper(lado, lado / paso, 0x94a3b8, 0x94a3b8);
        grid.material.transparent = true; grid.material.opacity = st.current.oscuro ? 0.16 : 0.28; grid.material.depthWrite = false;
        grid.position.set(Math.round(c.x / paso) * paso, bb.min.y - 0.001, Math.round(c.z / paso) * paso);
        suelo.add(grid);
        const ejeL = (a, b, col) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: col }));
        const y0 = bb.min.y;
        suelo.add(ejeL(new THREE.Vector3(-lado / 2 + grid.position.x, y0, 0), new THREE.Vector3(lado / 2 + grid.position.x, y0, 0), 0xe5484d));
        suelo.add(ejeL(new THREE.Vector3(0, y0, -lado / 2 + grid.position.z), new THREE.Vector3(0, y0, lado / 2 + grid.position.z), 0x46a758));
      }
      suelo.visible = verSuelo;
    }
    st.current.nudos = null;
    if (escena.nudos?.length) {
      const r = Math.max(0.09, diag / 170);
      const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshStandardMaterial({ roughness: 0.5 }), escena.nudos.length);
      const m4 = new THREE.Matrix4();
      escena.nudos.forEach((n, i) => {
        m4.makeTranslation(...T(n.p).toArray());
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, new THREE.Color(n.sel || n.id === pendiente ? "#F59E0B" : n.apoyo && n.apoyo !== "libre" ? "#E11D48" : "#0F172A"));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.lista = escena.nudos;
      raiz.add(mesh);
      st.current.nudos = mesh;
    }

    // losas
    if (verLosas) escena.losas.filter((l) => l.piso <= pisoMax).forEach((l) => {
      const g = new THREE.BoxGeometry(l.x1 - l.x0 + 0.6, 0.18, l.y1 - l.y0 + 0.6);
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x94a3b8, transparent: true, opacity: resaltar ? 0.04 : 0.12, depthWrite: false }));
      mesh.position.copy(T([(l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2, l.z + 0.09]));
      raiz.add(mesh);
    });
    // ejes en el terreno
    if (escena.ejes?.length) {
      const pts = escena.ejes.flatMap((e) => [T(e.a), T(e.b)]);
      const lineas = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x94a3b8, dashSize: 0.6, gapSize: 0.4 }));
      lineas.computeLineDistances();
      raiz.add(lineas);
    }
    // apoyos
    escena.apoyos.forEach((a) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.15, 0.8), new THREE.MeshStandardMaterial({ color: a.tipo === "empotrado" ? 0x334155 : 0x64748b }));
      mesh.position.copy(T(a.p)).add(new THREE.Vector3(0, -0.08, 0));
      raiz.add(mesh);
    });
    // etiquetas (tamaño proporcional al modelo)
    if (verEtiquetas) escena.etiquetas.filter((e) => !e.piso || e.piso <= pisoMax).forEach((e) => {
      const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
      const cx = cv.getContext("2d");
      const on = resaltar && e.grupo === resaltar;
      cx.fillStyle = on ? "#F59E0B" : e.piso ? "rgba(100,116,139,.9)" : "#508C9B";
      cx.beginPath(); cx.arc(64, 64, 54, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = "#fff"; cx.font = "bold 56px Inter, sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle";
      cx.fillText(e.texto, 64, 68);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv) }));
      sp.position.copy(T(e.p)); sp.scale.setScalar((e.piso ? 1.9 : 2.6) * kEt);
      raiz.add(sp);
    });
  }, [escena, visibles, resaltar, colorPor, verLosas, verEtiquetas, pisoMax, pendiente, verSuelo]);

  // encuadre de cámara: dir = vista con nombre o vector; soloSel = encuadra lo seleccionado (tecla F / . del numpad)
  const DIRS = { iso: [1, 0.7, 1.1], planta: [0, 1, 0.0001], bajo: [0, -1, 0.0001], frente: [0, 0.05, 1], atras: [0, 0.05, -1], lado: [1, 0.05, 0], izq: [-1, 0.05, 0] };
  const encuadrar = (dir = "iso", soloSel = false, mantener = false) => {
    const { persp, orto, controls, camera } = st.current;
    if (!persp) return;
    const box = new THREE.Box3();
    const sel = soloSel ? [...escena.miembros.filter((m) => m.sel), ...(escena.nudos || []).filter((n) => n.sel).map((n) => ({ a: n.p, b: n.p }))] : [];
    (sel.length ? sel : escena.miembros).forEach((m) => { box.expandByPoint(T(m.a)); box.expandByPoint(T(m.b)); });
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, sel.length ? 1.5 : 5);
    const dist = r / Math.sin((persp.fov * Math.PI) / 360) * 1.05;
    const dv = mantener ? camera.position.clone().sub(controls.target).normalize() : new THREE.Vector3(...(Array.isArray(dir) ? dir : DIRS[dir] || DIRS.iso)).normalize();
    [persp, orto].forEach((cam) => {
      cam.position.copy(c.clone().add(dv.clone().multiplyScalar(dist)));
      cam.up.set(0, 1, 0); cam.near = dist / 200; cam.far = dist * 20;
    });
    orto.zoom = 1;
    controls.target.copy(c);
    persp.updateProjectionMatrix(); st.current.ajustarOrto?.(); orto.updateProjectionMatrix();
    controls.update();
  };
  const [ortografica, setOrtografica] = useState(false);
  useEffect(() => { st.current.usarCamara?.(ortografica); }, [ortografica]);
  const vista = (dir) => { setVInt({ dir, t: Date.now() }); };

  // atajos de teclado estilo Blender (solo con el puntero sobre el visor)
  const dentro = useRef(false);
  useEffect(() => {
    if (!controles) return;
    const h = (e) => {
      if (!dentro.current || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.altKey) return;
      const np = e.code?.startsWith("Numpad") ? e.code.slice(6) : null;
      const k = np ?? e.key;
      let hecho = true;
      if (k === "1") vista(e.ctrlKey ? "atras" : "frente");
      else if (k === "3") vista(e.ctrlKey ? "izq" : "lado");
      else if (k === "7") vista(e.ctrlKey ? "bajo" : "planta");
      else if (k === "0" || k === "9") vista("iso");
      else if (k === "5") setOrtografica((o) => !o);
      else if (k === "Decimal" || k === "f" || k === "F") encuadrar("iso", true, true);
      else if (k === "Home") encuadrar("iso", false, true);
      else if (["2", "4", "6", "8"].includes(k) && np) {
        const { controls, camera } = st.current; const a = Math.PI / 12;
        const off = camera.position.clone().sub(controls.target);
        if (k === "4" || k === "6") off.applyAxisAngle(new THREE.Vector3(0, 1, 0), k === "4" ? -a : a);
        else { const lat = new THREE.Vector3().crossVectors(camera.up, off).normalize(); off.applyAxisAngle(lat, k === "8" ? -a : a); }
        camera.position.copy(controls.target).add(off); camera.lookAt(controls.target); controls.update();
      } else hecho = false;
      if (hecho) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [controles, escena]); // eslint-disable-line react-hooks/exhaustive-deps
  const claveAjuste = ajusteKey ?? escena;
  const [vInt, setVInt] = useState(null);
  useEffect(() => { encuadrar(vistaKey?.dir); }, [claveAjuste, vistaKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (vInt) encuadrar(vInt.dir); }, [vInt]); // eslint-disable-line react-hooks/exhaustive-deps

  // selección con el puntero
  const ray = useRef(new THREE.Raycaster());
  const elegirEn = (e) => {
    const { camera, pickable, renderer, nudos } = st.current;
    if (!pickable && !nudos) return null;
    const r = renderer.domElement.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const p = new THREE.Vector2((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1);
    ray.current.setFromCamera(p, camera);
    const hm = pickable ? ray.current.intersectObject(pickable)[0] : null;
    // nudos: el más cercano en pantalla dentro de 14 px (no hace falta acertar a la esfera)
    if (nudos) {
      let mejor = null, dmin = 14 * 14;
      const v = new THREE.Vector3();
      nudos.userData.lista.forEach((n) => {
        v.copy(T(n.p)).project(camera);
        if (v.z > 1 || v.z < -1) return;
        const dx = (v.x + 1) / 2 * r.width - px, dy = (1 - v.y) / 2 * r.height - py, d2 = dx * dx + dy * dy;
        if (d2 < dmin) {
          const dc = T(n.p).distanceTo(camera.position);
          if (hm && dc > hm.distance + 1.0 && d2 > 36) return;          // tapado por una barra (salvo que se apunte casi encima)
          dmin = d2; mejor = n;
        }
      });
      if (mejor) return { m: { _nudo: true, id: mejor.id, info: mejor.info || `Nudo ${mejor.nombre ?? mejor.id}` } };
    }
    return hm ? pickable.userData.lista[hm.instanceId] : null;
  };
  const abajo = useRef(null);

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0"
        onPointerEnter={() => { dentro.current = true; }}
        onPointerDown={(e) => { dentro.current = true; abajo.current = [e.clientX, e.clientY]; }}
        onPointerUp={(e) => {
          const a = abajo.current; abajo.current = null;
          if (!a || Math.hypot(e.clientX - a[0], e.clientY - a[1]) > 4) return;   // fue un arrastre
          const x = elegirEn(e); onElegir?.(x ? x.m : null);
        }}
        onPointerMove={(e) => { if (e.buttons) return; const x = elegirEn(e); setHover(x ? { texto: x.m.info, X: e.nativeEvent.offsetX, Y: e.nativeEvent.offsetY } : null); }}
        onPointerLeave={() => { setHover(null); dentro.current = false; }} />
      {hover && (
        <div className="pointer-events-none absolute z-10 rounded-md bg-slate-900/90 px-2 py-1 text-xs text-white shadow" style={{ left: hover.X + 14, top: hover.Y + 10 }}>{hover.texto}</div>
      )}
      {controles && (
        <>
          {/* gizmo de navegación: clic en un eje para mirar desde él */}
          <svg ref={(g) => { st.current.gizmo = g; }} width="80" height="80" viewBox="0 0 80 80" className="absolute right-3 top-3 z-10 select-none" aria-label="Orientación de la cámara">
            <circle cx="40" cy="40" r="38" className="fill-white/50 dark:fill-ink-2/50" />
            {[["x", "#E5484D", "lado", "izq"], ["y", "#46A758", "atras", "frente"], ["z", "#3E8ED0", "planta", "bajo"]].map(([k, col, d, dn]) => (
              <g key={k}>
                <line data-linea={k} x1="40" y1="40" x2="40" y2="40" stroke={col} strokeWidth="2.5" />
                <g data-eje={`-${k}`} className="cursor-pointer" onClick={() => vista(dn)}><circle r="6" fill={col} fillOpacity="0.35" stroke={col} /><title>{`Mirar desde −${k.toUpperCase()}`}</title></g>
                <g data-eje={k} className="cursor-pointer" onClick={() => vista(d)}>
                  <circle r="8.5" fill={col} /><text textAnchor="middle" dy="3.5" fontSize="10" fontWeight="700" fill="#fff">{k.toUpperCase()}</text>
                  <title>{`Mirar desde +${k.toUpperCase()}`}</title>
                </g>
              </g>
            ))}
          </svg>
          <div className="absolute bottom-3 right-3 z-10 flex flex-wrap justify-end overflow-hidden rounded-lg border border-slate-200 bg-white/95 text-xs shadow dark:border-ink-line dark:bg-ink-2/95" role="toolbar" aria-label="Cámara">
            {[["iso", "Iso", "0"], ["planta", "Planta", "7"], ["frente", "Frente", "1"], ["lado", "Lado", "3"]].map(([k, l, t]) => (
              <button key={k} onClick={() => vista(k)} className="px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-ink-3" title={`Vista ${l.toLowerCase()} (tecla ${t})`}>{l}</button>
            ))}
            <button onClick={() => setOrtografica((o) => !o)} aria-pressed={ortografica} title="Perspectiva / ortográfica (tecla 5)"
              className={`border-l border-slate-200 px-2.5 py-1.5 dark:border-ink-line ${ortografica ? "bg-teal/15 font-semibold text-teal" : "hover:bg-slate-100 dark:hover:bg-ink-3"}`}>{ortografica ? "Orto" : "Persp"}</button>
            <button onClick={() => encuadrar("iso", true, true)} title="Encuadrar la selección (F); sin selección, todo (Inicio)" className="px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-ink-3">Encuadrar</button>
            <button onClick={() => setVerSuelo((s) => !s)} aria-pressed={verSuelo} title="Mostrar u ocultar la cuadrícula del suelo"
              className={`px-2.5 py-1.5 ${verSuelo ? "text-teal" : "text-slate-400"} hover:bg-slate-100 dark:hover:bg-ink-3`}>▦</button>
            <button onClick={() => setAyuda((a) => !a)} aria-pressed={ayuda} title="Atajos del visor" className="px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-ink-3">?</button>
          </div>
          {ayuda && (
            <div className="absolute bottom-12 right-3 z-10 w-64 rounded-lg border border-slate-200 bg-white/95 p-3 text-xs leading-relaxed shadow dark:border-ink-line dark:bg-ink-2/95">
              <b>Ratón</b> · izquierdo o central: orbitar · derecho o Shift+central: desplazar · rueda: zoom hacia el cursor<br />
              <b>Teclado</b> (puntero sobre el visor) · 1 frente · 3 lado · 7 planta (Ctrl: lado opuesto) · 0 iso · 5 orto/persp · 2 4 6 8 girar 15° · F o . encuadrar selección · Inicio encuadrar todo<br />
              <b>Gizmo</b> · clic en X, Y o Z para mirar desde ese eje
            </div>
          )}
        </>
      )}
    </div>
  );
}
