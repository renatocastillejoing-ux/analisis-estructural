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
        a: P(s0), b: P(s1), w: sec.h || 0.3, d: sec.b || 0.3, wDir: [-dz / L, 0, dx / L],
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
export default function Visor3D({ escena, resaltar, pisoMax = Infinity, colorPor = "tipo", verLosas = true, verEtiquetas = true, onElegir, vistaKey }) {
  const host = useRef(null);
  const st = useRef({});
  const [hover, setHover] = useState(null);

  // montaje: renderer, cámara, controles, luces
  useEffect(() => {
    const el = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.screenSpacePanning = true;
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

    const ro = new ResizeObserver(([en]) => {
      const { width, height } = en.contentRect;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    });
    ro.observe(el);
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

    st.current = { ...st.current, renderer, scene, camera, controls, raiz };
    return () => {
      renderer.setAnimationLoop(null);
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
    // etiquetas
    if (verEtiquetas) escena.etiquetas.filter((e) => !e.piso || e.piso <= pisoMax).forEach((e) => {
      const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
      const cx = cv.getContext("2d");
      const on = resaltar && e.grupo === resaltar;
      cx.fillStyle = on ? "#F59E0B" : e.piso ? "rgba(100,116,139,.9)" : "#508C9B";
      cx.beginPath(); cx.arc(64, 64, 54, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = "#fff"; cx.font = "bold 56px Inter, sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle";
      cx.fillText(e.texto, 64, 68);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv) }));
      sp.position.copy(T(e.p)); sp.scale.setScalar(e.piso ? 1.9 : 2.6);
      raiz.add(sp);
    });
  }, [escena, visibles, resaltar, colorPor, verLosas, verEtiquetas, pisoMax]);

  // encuadre de cámara
  const encuadrar = (dir = "iso") => {
    const { camera, controls } = st.current;
    if (!camera) return;
    const box = new THREE.Box3();
    escena.miembros.forEach((m) => { box.expandByPoint(T(m.a)); box.expandByPoint(T(m.b)); });
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 5;
    const dist = r / Math.sin((camera.fov * Math.PI) / 360) * 1.05;
    const v = { iso: [1, 0.7, 1.1], planta: [0, 1, 0.0001], frente: [0, 0.05, 1], lado: [1, 0.05, 0] }[dir] || [1, 0.7, 1.1];
    camera.position.copy(c.clone().add(new THREE.Vector3(...v).normalize().multiplyScalar(dist)));
    controls.target.copy(c);
    camera.near = dist / 200; camera.far = dist * 20; camera.updateProjectionMatrix();
    controls.update();
  };
  useEffect(() => { encuadrar(vistaKey?.dir); }, [escena, vistaKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // selección con el puntero
  const ray = useRef(new THREE.Raycaster());
  const elegirEn = (e) => {
    const { camera, pickable, renderer } = st.current;
    if (!pickable) return null;
    const r = renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.current.setFromCamera(p, camera);
    const hit = ray.current.intersectObject(pickable)[0];
    return hit ? pickable.userData.lista[hit.instanceId] : null;
  };
  const abajo = useRef(null);

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0"
        onPointerDown={(e) => { abajo.current = [e.clientX, e.clientY]; }}
        onPointerUp={(e) => {
          const a = abajo.current; abajo.current = null;
          if (!a || Math.hypot(e.clientX - a[0], e.clientY - a[1]) > 4) return;   // fue un arrastre
          const x = elegirEn(e); onElegir?.(x ? x.m : null);
        }}
        onPointerMove={(e) => { if (e.buttons) return; const x = elegirEn(e); setHover(x ? { texto: x.m.info, X: e.nativeEvent.offsetX, Y: e.nativeEvent.offsetY } : null); }}
        onPointerLeave={() => setHover(null)} />
      {hover && (
        <div className="pointer-events-none absolute z-10 rounded-md bg-slate-900/90 px-2 py-1 text-xs text-white shadow" style={{ left: hover.X + 14, top: hover.Y + 10 }}>{hover.texto}</div>
      )}
    </div>
  );
}
