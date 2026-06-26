/* ============================================================
   Análisis Estructural · Método de Rigidez — Front (vanilla JS)
   v4.0: Auto-save, Undo/Redo, Delete mode, Keyboard shortcuts,
         Template gallery, Improved UX
   ============================================================ */
"use strict";

const API = {
  ejemplo:   () => fetch("/api/ejemplo").then(r => r.json()),
  calcular:  (m) => fetch("/api/calcular", {
                  method:"POST", headers:{"Content-Type":"application/json"},
                  body: JSON.stringify(m)
                }).then(async r => ({ ok:r.ok, data: await r.json() })),
  historial: () => fetch("/api/historial").then(r => r.json()),
  histItem:  (id) => fetch("/api/historial/"+id).then(r => r.json()),
  histDel:   (id) => fetch("/api/historial/"+id, {method:"DELETE"}).then(r => r.json()),
  histClear: () => fetch("/api/historial/limpiar", {method:"POST"}).then(r => r.json()),
  combinaciones: (m) => fetch("/api/combinaciones", {
                  method:"POST", headers:{"Content-Type":"application/json"},
                  body: JSON.stringify(m)
                }).then(async r => ({ ok:r.ok, data: await r.json() })),
};

/* ============================================================
   SISTEMA DE UNIDADES
   ============================================================ */
const UNIDADES = {
  "tonf_m":   { label:"tonf · m",   fuerza:"tonf", longitud:"m",     momentof:"tonf·m",  cargad:"tonf/m",   cargam:"tonf·m/m", f:1,      l:1 },
  "kN_m":     { label:"kN · m",     fuerza:"kN",   longitud:"m",     momentof:"kN·m",    cargad:"kN/m",     cargam:"kN·m/m",   f:1/9.81, l:1 },
  "kgf_cm":   { label:"kgf · cm",   fuerza:"kgf",  longitud:"cm",    momentof:"kgf·cm",  cargad:"kgf/cm",   cargam:"kgf·cm/cm", f:1/1000, l:1/100 },
  "lb_ft":    { label:"lb · ft",    fuerza:"lb",   longitud:"ft",    momentof:"lb·ft",   cargad:"lb/ft",    cargam:"lb·ft/ft", f:1/2204.62, l:1/3.281 },
  "N_mm":     { label:"N · mm",     fuerza:"N",    longitud:"mm",    momentof:"N·mm",    cargad:"N/mm",     cargam:"N·mm/mm",  f:1/9810, l:1/1000 },
};
function getUnidad(){ return UNIDADES[state.modelo?.unidad || "tonf_m"] || UNIDADES.tonf_m; }

const APOYOS = [
  ["empotrado","Empotrado"], ["fijo","Articulado (fijo)"],
  ["rodillo_y","Rodillo (móvil en X)"], ["rodillo_x","Rodillo (móvil en Y)"],
  ["libre","Libre / nudo"],
];

const SEC_TIPOS = {
  rectangular: { lbl:"Rectangular maciza", campos:[["b","b (m)"],["h","h (m)"]],
    calc:d=>[d.b*d.h, d.b*Math.pow(d.h,3)/12] },
  cajon: { lbl:"Cajón hueco", campos:[["b","b (m)"],["h","h (m)"],["e","pared e (m)"]],
    calc:d=>{const bi=d.b-2*d.e, hi=d.h-2*d.e; return [d.b*d.h-bi*hi, (d.b*Math.pow(d.h,3)-bi*Math.pow(hi,3))/12];} },
  circular: { lbl:"Circular maciza", campos:[["d","Ø d (m)"]],
    calc:d=>[Math.PI*d.d*d.d/4, Math.PI*Math.pow(d.d,4)/64] },
  tubular: { lbl:"Tubo circular", campos:[["d","Ø ext (m)"],["e","pared e (m)"]],
    calc:d=>{const di=d.d-2*d.e; return [Math.PI*(d.d*d.d-di*di)/4, Math.PI*(Math.pow(d.d,4)-Math.pow(di,4))/64];} },
  perfil_I: { lbl:"Perfil I", campos:[["b","ala b (m)"],["h","altura h (m)"],["tf","esp. ala tf"],["tw","esp. alma tw"]],
    calc:d=>{const hw=d.h-2*d.tf; return [2*d.b*d.tf+hw*d.tw, (d.b*Math.pow(d.h,3)-(d.b-d.tw)*Math.pow(hw,3))/12];} },
  perfil_T: { lbl:"Perfil T", campos:[["b","ala b (m)"],["h","altura h (m)"],["tf","esp. ala tf"],["tw","esp. alma tw"]],
    calc:d=>{const hw=d.h-d.tf, Aa=d.b*d.tf, Aw=hw*d.tw, A=Aa+Aw, ya=d.tf/2, yw=d.tf+hw/2, yc=(Aa*ya+Aw*yw)/A;
             return [A, d.b*Math.pow(d.tf,3)/12+Aa*Math.pow(yc-ya,2)+d.tw*Math.pow(hw,3)/12+Aw*Math.pow(yc-yw,2)];} },
  AI: { lbl:"A e I directos", campos:[["A","A (m²)"],["I","I (m⁴)"]], calc:d=>[d.A, d.I] },
};
function calcAI(sec){
  const t = SEC_TIPOS[sec.tipo||"rectangular"]; if(!t) return [null,null];
  const d={}; t.campos.forEach(([k])=>d[k]=num(sec[k]));
  try{ const [A,I]=t.calc(d); return [(isFinite(A)&&A>0)?A:null, (isFinite(I)&&I>0)?I:null]; }
  catch(e){ return [null,null]; }
}

const MAT_PRESETS = {
  concreto210: {lbl:"Concreto f'c=210", E:2173706, densidad:2.4, nu:0.20},
  concreto280: {lbl:"Concreto f'c=280", E:2509980, densidad:2.4, nu:0.20},
  acero:       {lbl:"Acero A36/A992",   E:21000000, densidad:7.85, nu:0.30},
  aluminio:    {lbl:"Aluminio",          E:7000000, densidad:2.70, nu:0.33},
  madera:      {lbl:"Madera (conífera)", E:1000000, densidad:0.60, nu:0.30},
};
function renderMaterialItem(x, i){
  const presets = `<option value="">— preset —</option>` +
    Object.entries(MAT_PRESETS).map(([k,v])=>`<option value="${k}">${v.lbl}</option>`).join("");
  const f = (lbl,field,val)=>`<div class="field"><label>${lbl}</label><input type="number" step="any" value="${val??""}" data-coll="materiales" data-idx="${i}" data-field="${field}"></div>`;
  return `<div class="sec-item">
    <div class="sec-row1">
      <input type="text" value="${esc(x.nombre||"")}" data-coll="materiales" data-idx="${i}" data-field="nombre" placeholder="nombre">
      <select data-matpreset data-idx="${i}">${presets}</select>
      <button class="btn-del" data-del="materiales" data-idx="${i}" title="Eliminar">×</button>
    </div>
    <div class="carga-params">${f("E (tonf/m²)","E",x.E)}${f("Peso esp. (tonf/m³)","densidad",x.densidad)}${f("Poisson ν","nu",x.nu)}</div>
  </div>`;
}
function aplicarMatPreset(idx, key){
  const p = MAT_PRESETS[key]; if(!p) return;
  const m = state.modelo.materiales[idx]; if(!m) return;
  m.modo="E"; m.E=p.E; m.densidad=p.densidad; m.nu=p.nu;
  if(!m.nombre) m.nombre = key;
}

/* ============================================================
   STATE + UNDO/REDO
   ============================================================ */
const state = { modelo:null, resultado:null, vista:"modelo", diag:"dmf",
                emode:"mover", _connectFirst:null, _pv:null, _diag:null, _vb:null,
                _undoStack:[], _redoStack:[], _modified:false, _autoSaveTimer:null,
                selected:{ type:null, idx:null },
                _labelToggles:{ nombres:true, secciones:true, cargas:true, valores:true } };

const CARGA_CONVENCION = {
  distribuida: {
    wy: { label:"Intensidad vertical", signo:"+ ↑ arriba, − ↓ abajo", desc:"Componente perpendicular al eje del elemento (en el eje Y global)" },
    wx: { label:"Intensidad horizontal", signo:"+ → derecha, − ← izquierda", desc:"Componente paralela al eje del elemento (en el eje X global)" },
  },
  puntual: {
    Py: { label:"Fuerza vertical", signo:"+ ↑ arriba, − ↓ abajo", desc:"Fuerza puntual en Y global" },
    Px: { label:"Fuerza horizontal", signo:"+ → derecha, − ← izquierda", desc:"Fuerza puntual en X global" },
    a:  { label:"Posición desde nudo i", signo:"0 ≤ a ≤ L", desc:"Distancia desde el extremo i del elemento" },
  },
  momento: {
    M:  { label:"Momento flector", signo:"+ ↺ antihorario, − ↻ horario", desc:"Momento concentrado positivo en sentido antihorario" },
    a:  { label:"Posición desde nudo i", signo:"0 ≤ a ≤ L", desc:"Distancia desde el extremo i del elemento" },
  },
  nodal: {
    Fx: { label:"Fuerza horizontal", signo:"+ → derecha, − ← izquierda", desc:"Componente X de la fuerza en el nudo" },
    Fy: { label:"Fuerza vertical", signo:"+ ↑ arriba, − ↓ abajo", desc:"Componente Y de la fuerza en el nudo" },
    M:  { label:"Momento", signo:"+ ↺ antihorario, − ↻ horario", desc:"Momento concentrado en el nudo" },
  },
};

/* ---------- utilidades ---------- */
const $  = (s, e=document) => e.querySelector(s);
const $$ = (s, e=document) => Array.from(e.querySelectorAll(s));
const num = (v, d=0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function fmtF(x, d=3) {
  if (x === 0) return "0";
  if (Math.abs(x) < 1e-3) return x.toExponential(2);
  return x.toFixed(d);
}
function fmtD(x) {
  if (x === 0) return "0";
  if (Math.abs(x) < 1e-2) return x.toExponential(3);
  return x.toFixed(5);
}
function setPath(obj, path, val) {
  const ks = path.split("."); let o = obj;
  for (let i=0;i<ks.length-1;i++) o = o[ks[i]];
  o[ks[ks.length-1]] = val;
}
function nextId(coll){ return coll.reduce((m,x)=>Math.max(m, x.id||0), 0) + 1; }

function toast(msg, kind="ok", ms=3200){
  const t = $("#toast"); t.textContent = msg;
  t.className = "toast " + kind; t.classList.remove("hidden");
  clearTimeout(t._t); t._t = setTimeout(()=>t.classList.add("hidden"), ms);
}

/* ============================================================
   UNDO / REDO
   ============================================================ */
function pushUndo(){
  if (!state.modelo) return;
  state._undoStack.push(JSON.stringify(state.modelo));
  if (state._undoStack.length > 50) state._undoStack.shift();
  state._redoStack = [];
  markModified();
}
function undo(){
  if (!state._undoStack.length) return;
  state._redoStack.push(JSON.stringify(state.modelo));
  const prev = JSON.parse(state._undoStack.pop());
  state.modelo = prev;
  renderEstaticos(); renderEditor(); drawPreview();
  toast("Deshacer", "ok", 1500);
}
function redo(){
  if (!state._redoStack.length) return;
  state._undoStack.push(JSON.stringify(state.modelo));
  const next = JSON.parse(state._redoStack.pop());
  state.modelo = next;
  renderEstaticos(); renderEditor(); drawPreview();
  toast("Rehacer", "ok", 1500);
}
function markModified(){
  state._modified = true;
  const dot = $("#modified-dot");
  if (dot) dot.classList.remove("hidden");
}

/* ============================================================
   AUTO-SAVE / RESTORE
   ============================================================ */
const AUTOSAVE_KEY = "analisis_estructural_autosave";
function autoSave(){
  if (!state.modelo) return;
  try{ localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state.modelo)); }
  catch(e){ /* quota exceeded, ignore */ }
}
function autoRestore(){
  try{
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw){
      const m = JSON.parse(raw);
      if (m && m.nudos && m.elementos){
        cargarModeloEnEditor(m);
        return true;
      }
    }
  }catch(e){}
  return false;
}
function scheduleAutoSave(){
  clearTimeout(state._autoSaveTimer);
  state._autoSaveTimer = setTimeout(autoSave, 30000);
}

/* ============================================================
   NAVEGACIÓN
   ============================================================ */
function setVista(v){
  state.vista = v;
  $$(".nav-btn").forEach(b => b.classList.toggle("is-active", b.dataset.vista===v));
  $$(".bottom-nav-btn").forEach(b => b.classList.toggle("is-active", b.dataset.vista===v));
  $("#vista-modelo").classList.toggle("hidden", v!=="modelo");
  $("#vista-resultados").classList.toggle("hidden", v!=="resultados");
  $("#vista-combinaciones").classList.toggle("hidden", v!=="combinaciones");
  $("#vista-historial").classList.toggle("hidden", v!=="historial");
  // Modo app a pantalla completa solo en la vista Modelo
  document.body.classList.toggle("app-mode", v==="modelo");
  if (v==="historial") cargarHistorial();
  if (v==="modelo") requestAnimationFrame(drawPreview);
  window.scrollTo({top:0, behavior:"smooth"});
}

/* ============================================================
   EDITOR — campos estáticos
   ============================================================ */
function renderEstaticos(){
  const m = state.modelo;
  $("#in-nombre").value = m.nombre || "";
  $("#in-axial").checked = !!m.despreciar_axial;
  $("#in-peso").checked = !!m.peso_propio;
  const tk=$("#in-timoshenko"); if(tk) tk.checked = !!m.timoshenko;
  const pd=$("#in-pdelta"); if(pd) pd.checked = !!m.pdelta;
  const osc=$("#in-oscilatorio"); if(osc) osc.checked = !!m.modo_oscilatorio;
  const uc=$("#in-usar-combos"); if(uc) uc.checked = !!m.usar_combos;
  const ce=$("#combo-editor"); if(ce) ce.classList.toggle("hidden", !m.usar_combos);
  const modo = m.material.modo || (m.material.fc!=null && m.material.E==null ? "fc":"E");
  m.material.modo = modo;
  $$("#seg-material button").forEach(b => b.classList.toggle("is-active", b.dataset.mat===modo));
  $("#mat-E").classList.toggle("hidden", modo!=="E");
  $("#mat-fc").classList.toggle("hidden", modo!=="fc");
  $("#in-E").value  = m.material.E ?? "";
  $("#in-fc").value = m.material.fc ?? "";
  $("#in-dens").value = m.material.densidad ?? "";
  const ia=$("#in-alpha"); if(ia) ia.value = m.material.alpha ?? "";
  const inu=$("#in-nu"); if(inu) inu.value = m.material.nu ?? "";
  const imd=$("#in-modal"); if(imd) imd.checked = !!m.analisis_modal;
  const inm=$("#in-nmodos"); if(inm) inm.value = m.n_modos ?? "";
  const ig=$("#in-g"); if(ig) ig.value = m.g ?? "";
  const selUnidad = $("#sel-unidad");
  if(selUnidad) selUnidad.value = m.unidad || "tonf_m";
  renderUnidadInfo();
}

function renderUnidadInfo(){
  const u = getUnidad();
  const el = $("#unidad-info");
  if(el) el.textContent = `${u.fuerza} / ${u.longitud}`;
  const sb = $("#status-units");
  if(sb) sb.textContent = `${u.fuerza} · ${u.longitud}`;
}

function updateAccDots(m){}

/* ============================================================
   EDITOR — tablas dinámicas
   ============================================================ */
function optsNudos(sel){
  return state.modelo.nudos.map(n =>
    `<option value="${n.id}" ${n.id==sel?"selected":""}>${esc(n.nombre||("N"+n.id))}</option>`).join("");
}
function optsSecciones(sel){
  const lista = state.modelo.secciones || [];
  let html = lista.map(s =>
    `<option value="${esc(s.nombre)}" ${s.nombre==sel?"selected":""}>${esc(s.nombre)}</option>`).join("");
  // referencia huérfana (sección renombrada/eliminada): mostrarla para no perderla
  if (sel && !lista.some(s=>s.nombre==sel))
    html = `<option value="${esc(sel)}" selected>⚠ ${esc(sel)} (inexistente)</option>` + html;
  return html;
}
function optsMateriales(sel){
  const lista = state.modelo.materiales || [];
  let html = `<option value="" ${!sel?"selected":""}>(global)</option>` + lista.map(x =>
    `<option value="${esc(x.nombre)}" ${x.nombre==sel?"selected":""}>${esc(x.nombre)}</option>`).join("");
  if (sel && !lista.some(x=>x.nombre==sel))
    html += `<option value="${esc(sel)}" selected>⚠ ${esc(sel)} (inexistente)</option>`;
  return html;
}
function optsElementos(sel){
  return state.modelo.elementos.map(e =>
    `<option value="${e.id}" ${e.id==sel?"selected":""}>${esc(e.nombre||("E"+e.id))}</option>`).join("");
}

function renderEditor(){
  const m = state.modelo;
  $("#tb-secciones").innerHTML = m.secciones.map((s,i)=>renderSeccionItem(s,i)).join("");
  $("#tb-nudos").innerHTML = m.nudos.map((n,i)=>renderNudoItem(n,i)).join("");
  $("#tb-materiales").innerHTML = (m.materiales||[]).map((x,i)=>renderMaterialItem(x,i)).join("");
  $("#tb-elementos").innerHTML = m.elementos.map((e,i)=>`
    <tr>
      <td><input type="text" value="${esc(e.nombre||("E"+e.id))}" data-coll="elementos" data-idx="${i}" data-field="nombre" style="min-width:54px"></td>
      <td><select data-coll="elementos" data-idx="${i}" data-field="i">${optsNudos(e.i)}</select></td>
      <td><select data-coll="elementos" data-idx="${i}" data-field="j">${optsNudos(e.j)}</select></td>
      <td><select data-coll="elementos" data-idx="${i}" data-field="seccion">${optsSecciones(e.seccion)}</select></td>
      <td><select data-coll="elementos" data-idx="${i}" data-field="material">${optsMateriales(e.material)}</select></td>
      <td><div class="rot-cell">
        <input type="checkbox" ${e.release_i?"checked":""} data-coll="elementos" data-idx="${i}" data-field="release_i" title="Rótula en i">
        <input type="checkbox" ${e.release_j?"checked":""} data-coll="elementos" data-idx="${i}" data-field="release_j" title="Rótula en j">
      </div></td>
      <td><button class="btn-del" data-dup="elementos" data-idx="${i}" title="Duplicar">⧉</button> <button class="btn-del" data-del="elementos" data-idx="${i}" title="Eliminar">×</button></td>
    </tr>`).join("");
  $("#tb-cargas_nodales").innerHTML = m.cargas_nodales.map((c,i)=>renderCargaNodal(c,i)).join("");
  $("#tb-cargas_elementos").innerHTML = m.cargas_elementos.map((c,i)=>renderCargaItem(c,i)).join("");
  const casos = m.casos || (m.casos = []);
  const combos = m.combinaciones || (m.combinaciones = []);
  const tc = $("#tb-casos"); if(tc) tc.innerHTML = casos.map((c,i)=>renderCasoItem(c,i)).join("");
  const tk = $("#tb-combinaciones"); if(tk) tk.innerHTML = combos.map((c,i)=>renderComboItem(c,i)).join("");
  $("#cnt-sec").textContent = m.secciones.length;
  const cm=$("#cnt-mat"); if(cm) cm.textContent = (m.materiales||[]).length;
  $("#cnt-nud").textContent = m.nudos.length;
  $("#cnt-ele").textContent = m.elementos.length;
  $("#cnt-cn").textContent  = m.cargas_nodales.length;
  $("#cnt-ce").textContent  = m.cargas_elementos.length;
  const cc=$("#cnt-combo"); if(cc) cc.textContent = (m.combinaciones||[]).length;
  updateAccDots(m);
  // Mantener el resumen del panel de propiedades al día si no hay selección
  if (!state.selected || !state.selected.type){
    const ib=$("#inspector-body"); if(ib) ib.innerHTML = renderPropsResumen();
  }
}

function cargaKey(c){
  if (c.tipo==="distribuida") return c.subtipo==="trapezoidal" ? "dist_trap" : "dist_unif";
  return c.tipo;
}

// Opciones del selector de dirección (con su glifo/etiqueta).
const DIR_OPCIONES = [
  ["vert",  "⭥ Vertical (Y)"],
  ["horiz", "⭤ Horizontal (X)"],
  ["perp",  "⊥ Perpendicular al elemento"],
  ["axial", "∥ Axial al elemento"],
  ["angle", "∠ Por ángulo"],
  ["comp",  "⊕ Componentes X,Y"],
];
function dirSelect(coll, i, dir){
  const opts = DIR_OPCIONES.map(([v,l])=>`<option value="${v}" ${(dir||"vert")===v?"selected":""}>${l}</option>`).join("");
  return `<select class="dir-select" data-coll="${coll}" data-idx="${i}" data-field="dir" title="Marco de referencia de la carga">${opts}</select>`;
}
// Presets de dirección rápidos (botones con glifo) + nombre del modo activo.
function dirPresets(coll, i, dir){
  const cur = dir || "vert";
  const btns = DIR_OPCIONES.map(([v,l])=>{
    const sp = l.indexOf(" ");
    const glyph = l.slice(0, sp), name = l.slice(sp+1);
    return `<button type="button" class="dir-preset ${cur===v?"is-active":""}" data-dirpreset="${v}" data-coll="${coll}" data-idx="${i}" title="${esc(name)}">${glyph}</button>`;
  }).join("");
  const curName = (DIR_OPCIONES.find(o=>o[0]===cur)||["",""])[1].replace(/^\S+\s/,"");
  return `<div class="dir-presets">${btns}</div><span class="dir-cur">${esc(curName)}</span>`;
}
// Pista de signo según la dirección elegida.
function dirHint(dir){
  switch(dir){
    case "vert":  return "+ ↑ arriba · − ↓ abajo (gravedad)";
    case "horiz": return "+ → derecha · − ← izquierda";
    case "perp":  return "perpendicular al eje · + = lado izquierdo de i→j";
    case "axial": return "a lo largo del eje · + = de i hacia j";
    case "angle": return "magnitud + ángulo (0°→ +X, 90°→ +Y)";
    case "comp":  return "componentes globales independientes wx, wy";
    default: return "";
  }
}

function renderCargaItem(c, i){
  const key = cargaKey(c);
  const u = getUnidad();
  const opt = (v,l)=>`<option value="${v}" ${key===v?"selected":""}>${l}</option>`;
  const f = (label, field, val, tooltip="", ph="") =>
    `<div class="field"><label title="${esc(tooltip)}">${label}</label><input type="number" step="any" value="${val!=null&&val!==""?val:(val===0?0:"")}" placeholder="${ph}" data-coll="cargas_elementos" data-idx="${i}" data-field="${field}" title="${esc(tooltip)}"></div>`;

  let params = "", dirRow = "", helpText = "", parcial = "";
  const m = state.modelo;
  const e = m.elementos.find(x=>x.id==c.elem);
  const dir = c.dir || (c.tipo==="momento" ? null : "comp");

  if (c.tipo==="distribuida"){
    dirRow = `<div class="carga-dir-row"><span class="carga-dir-lbl">Dir.</span>${dirPresets("cargas_elementos", i, dir)}</div>`;
    const trap = c.subtipo==="trapezoidal";
    if (dir==="comp"){
      params = trap
        ? f(`wy i (${u.cargad})`,"wy1",c.wy1)+f(`wy j (${u.cargad})`,"wy2",c.wy2)+f(`wx i (${u.cargad})`,"wx1",c.wx1)+f(`wx j (${u.cargad})`,"wx2",c.wx2)
        : f(`wy (${u.cargad}) ↓−`,"wy",c.wy)+f(`wx (${u.cargad}) →+`,"wx",c.wx);
    } else {
      const wl = `w${dir==="vert"?" ↓−":dir==="horiz"?" →+":""}`;
      params = trap
        ? f(`${wl} en i (${u.cargad})`,"q1",c.q1)+f(`${wl} en j (${u.cargad})`,"q2",c.q2)
        : f(`${wl} (${u.cargad})`,"q",c.q);
      if (dir==="angle") params += f("ángulo (°)","ang",c.ang!=null?c.ang:0,"0° → +X (derecha), 90° → +Y (arriba)");
    }
    parcial = `<div class="carga-params carga-parcial">${f(`desde a (${u.longitud})`,"a",c.a!=null?c.a:"","Inicio del tramo cargado (vacío = 0)","0")}${f(`hasta b (${u.longitud})`,"b",c.b!=null?c.b:"","Fin del tramo cargado (vacío = L)","L")}</div>`;
    helpText = cargaResumen(c, e, m, u);
  }
  else if (c.tipo==="puntual"){
    dirRow = `<div class="carga-dir-row"><span class="carga-dir-lbl">Dir.</span>${dirPresets("cargas_elementos", i, dir)}</div>`;
    if (dir==="comp"){
      params = f(`Py (${u.fuerza}) ↓−`,"Py",c.Py)+f(`Px (${u.fuerza}) →+`,"Px",c.Px);
    } else {
      const pl = `P${dir==="vert"?" ↓−":dir==="horiz"?" →+":""}`;
      params = f(`${pl} (${u.fuerza})`,"q",c.q);
      if (dir==="angle") params += f("ángulo (°)","ang",c.ang!=null?c.ang:0,"0° → +X (derecha), 90° → +Y (arriba)");
    }
    params += f(`a (${u.longitud} desde i)`,"a",c.a!=null?c.a:"","a = 0 en nudo i, a = L en nudo j","L/2");
    helpText = cargaResumen(c, e, m, u);
  }
  else if (c.tipo==="momento"){
    params = f(`M (${u.momentof}) ↺+`,"M",c.M,"M positivo = antihorario")
           + f(`a (${u.longitud} desde i)`,"a",c.a!=null?c.a:"","a = 0 en nudo i, a = L en nudo j","L/2");
    helpText = `<div class="carga-help"><span class="carga-help-icon">?</span> <em>M positivo = sentido antihorario</em></div>`;
  }
  else if (c.tipo==="termica"){
    params = f(`ΔT uniforme (°)`,"dT",c.dT,"Variación de temperatura del eje (+ calienta = se alarga)")
           + f(`Gradiente ΔT (°)`,"dT_grad",c.dT_grad,"T_superior − T_inferior en el peralte → curvatura");
    helpText = `<div class="carga-help"><span class="carga-help-icon">?</span> <em>Requiere α del material. El gradiente usa el peralte h de la sección.</em></div>`;
  }

  return `<div class="carga-item" draggable="true" data-drag="cargas_elementos" data-idx="${i}">
    <div class="carga-row1">
      <span class="drag-handle" title="Arrastrar para reordenar">⋮⋮</span>
      <select data-coll="cargas_elementos" data-idx="${i}" data-field="__elem" title="Elemento">${optsElementos(c.elem)}</select>
      <select data-coll="cargas_elementos" data-idx="${i}" data-field="__tipo" style="flex:1.3" title="Tipo de carga">
        ${opt("dist_unif","Distribuida uniforme")}${opt("dist_trap","Distribuida trapezoidal")}
        ${opt("puntual","Puntual")}${opt("momento","Momento")}${opt("termica","Térmica (ΔT)")}
      </select>
      ${casoSel("cargas_elementos", i, c)}
      <button class="btn-del" data-dup="cargas_elementos" data-idx="${i}" title="Duplicar">⧉</button>
      <button class="btn-del" data-del="cargas_elementos" data-idx="${i}" title="Eliminar">×</button>
    </div>
    ${dirRow}
    <div class="carga-params">${params}</div>${parcial}${helpText}
  </div>`;
}

// Resumen en vivo: dirección, componentes globales resueltas y glifo.
function cargaResumen(c, e, m, u){
  const hint = dirHint(c.dir);
  let extra = "";
  if (e){
    const un = elemUnit(c, m);
    if (un){
      if (c.tipo==="distribuida"){
        const g = cargaDistGlobal(c, un.cx, un.cy);
        const m1=Math.hypot(g.wx1,g.wy1);
        extra = `→ global: wx=${fnum(g.wx1)}${g.wx1!==g.wx2?"~"+fnum(g.wx2):""} · wy=${fnum(g.wy1)}${g.wy1!==g.wy2?"~"+fnum(g.wy2):""} ${u.cargad} ${globGlyph(g.wx1,g.wy1)} (L=${fnum(un.L)} ${u.longitud})`;
      } else if (c.tipo==="puntual"){
        const g = cargaPuntGlobal(c, un.cx, un.cy);
        extra = `→ global: Px=${fnum(g.Px)} · Py=${fnum(g.Py)} ${u.fuerza} ${globGlyph(g.Px,g.Py)} (L=${fnum(un.L)} ${u.longitud})`;
      }
    }
  }
  return `<div class="carga-help"><span class="carga-help-icon">?</span> <em>${hint}</em>${extra?`<div class="carga-global">${extra}</div>`:""}</div>`;
}

function renderSeccionItem(s, i){
  const tipo = s.tipo || "rectangular";
  const t = SEC_TIPOS[tipo];
  const opts = Object.entries(SEC_TIPOS).map(([k,v])=>
    `<option value="${k}" ${k===tipo?"selected":""}>${v.lbl}</option>`).join("");
  const campos = t.campos.map(([k,lbl])=>
    `<div class="field"><label>${lbl}</label><input type="number" step="any" value="${s[k]??""}" data-coll="secciones" data-idx="${i}" data-field="${k}"></div>`).join("");
  let info = "";
  if (tipo!=="AI"){
    const [A,I]=calcAI(s);
    info = (A!=null&&I!=null) ? `<div class="sec-AI">A = ${A.toExponential(4)} m² &nbsp;·&nbsp; I = ${I.toExponential(4)} m⁴</div>`
                             : `<div class="sec-AI eq-warn">Completa las dimensiones…</div>`;
  }
  return `<div class="sec-item">
    <div class="sec-row1">
      <input type="text" value="${esc(s.nombre)}" data-coll="secciones" data-idx="${i}" data-field="nombre" placeholder="nombre">
      <select data-coll="secciones" data-idx="${i}" data-field="__sectipo">${opts}</select>
      <button class="btn-del" data-dup="secciones" data-idx="${i}" title="Duplicar">⧉</button>
      <button class="btn-del" data-del="secciones" data-idx="${i}" title="Eliminar">×</button>
    </div>
    <div class="carga-params">${campos}</div>
    ${info}
  </div>`;
}

function renderNudoItem(n, i){
  const res = n.resorte||{}, ase = n.asentamiento||{};
  const hasAdv = num(res.kx)||num(res.ky)||num(res.kg)||num(ase.dx)||num(ase.dy)||num(ase.giro);
  const nf = (lbl,sub,field,val)=>
    `<div class="field"><label>${lbl}</label><input type="number" step="any" value="${val??""}" data-coll="nudos" data-idx="${i}" data-sub="${sub}" data-field="${field}"></div>`;
  return `<div class="nd-item" draggable="true" data-drag="nudos" data-idx="${i}">
    <div class="nd-row1">
      <span class="drag-handle" title="Arrastrar para reordenar">⋮⋮</span>
      <span class="cell-id">${esc(n.nombre||("N"+n.id))}</span>
      <input type="number" step="any" value="${n.x??""}" data-coll="nudos" data-idx="${i}" data-field="x" placeholder="X" title="X (m)">
      <input type="number" step="any" value="${n.y??""}" data-coll="nudos" data-idx="${i}" data-field="y" placeholder="Y" title="Y (m)">
      <select data-coll="nudos" data-idx="${i}" data-field="apoyo">
        ${APOYOS.map(([v,l])=>`<option value="${v}" ${n.apoyo===v?"selected":""}>${l}</option>`).join("")}
      </select>
      <button class="btn-del" data-dup="nudos" data-idx="${i}" title="Duplicar">⧉</button>
      <button class="btn-del" data-del="nudos" data-idx="${i}" title="Eliminar">×</button>
    </div>
    <button class="nd-adv-toggle" data-ndadv="${i}">Avanzado: resorte / asentamiento ▾</button>
    <div class="nd-adv ${hasAdv?"open":""}" data-ndadvbody="${i}">
      <h5>Apoyo elástico — resorte (rigidez)</h5>
      <div class="carga-params">${nf("kx","resorte","kx",res.kx)}${nf("ky","resorte","ky",res.ky)}${nf("kg (giro)","resorte","kg",res.kg)}</div>
      <h5>Asentamiento — desplazamiento impuesto</h5>
      <div class="carga-params">${nf("dx (m)","asentamiento","dx",ase.dx)}${nf("dy (m)","asentamiento","dy",ase.dy)}${nf("giro (rad)","asentamiento","giro",ase.giro)}</div>
    </div>
  </div>`;
}

function renderCargaNodal(c, i){
  const modo = c.modo || "comp";
  const u = getUnidad();
  const conv = CARGA_CONVENCION.nodal;
  const f = (label, field, val, tooltip="") =>
    `<div class="field"><label title="${esc(tooltip)}">${label}</label><input type="number" step="any" value="${val!=null&&val!==""?val:(val===0?0:"")}" data-coll="cargas_nodales" data-idx="${i}" data-field="${field}" title="${esc(tooltip)}"></div>`;
  let cuerpo;
  if (modo==="ang"){
    const mag=num(c.mag), ang=num(c.ang);
    const Fx=(mag*Math.cos(ang*Math.PI/180)), Fy=(mag*Math.sin(ang*Math.PI/180));
    const preset = (deg,glyph,title)=>`<button type="button" class="ang-preset ${num(c.ang)===deg?"is-active":""}" data-angpreset="${deg}" data-idx="${i}" title="${title}">${glyph}</button>`;
    cuerpo = f(`Magnitud (${u.fuerza})`, "mag", c.mag, "Magnitud de la fuerza resultante")
           + `<div class="field"><label>Ángulo (°)</label>
                <div class="ang-input">
                  <input type="number" step="any" value="${c.ang!=null?c.ang:0}" data-coll="cargas_nodales" data-idx="${i}" data-field="ang" title="0° → +X (derecha), 90° → +Y (arriba)">
                  <div class="ang-presets">${preset(0,"→","0° derecha")}${preset(90,"↑","90° arriba")}${preset(180,"←","180° izquierda")}${preset(-90,"↓","−90° abajo")}</div>
                </div></div>`
           + f(`M (${u.momentof}) ↺+`, "M", c.M, conv.M.desc)
           + `<div class="carga-global" style="grid-column:1/-1">→ Fx = ${fnum(Fx)} · Fy = ${fnum(Fy)} ${u.fuerza} ${globGlyph(Fx,Fy)}</div>`;
  } else {
    cuerpo = f(`Fx (${u.fuerza}) →+`, "Fx", c.Fx, conv.Fx.desc+"\n"+conv.Fx.signo)
           + f(`Fy (${u.fuerza}) ↑+`, "Fy", c.Fy, conv.Fy.desc+"\n"+conv.Fy.signo)
           + f(`M (${u.momentof}) ↺+`, "M", c.M, conv.M.desc+"\n"+conv.M.signo);
  }
  const seg = (v,l)=>`<button type="button" data-cnmodo="${v}" data-idx="${i}" class="${modo===v?"is-active":""}">${l}</button>`;
  return `<div class="cn-item" draggable="true" data-drag="cargas_nodales" data-idx="${i}">
    <div class="sec-row1">
      <span class="drag-handle" title="Arrastrar para reordenar">⋮⋮</span>
      <select data-coll="cargas_nodales" data-idx="${i}" data-field="nudo" title="Nudo">${optsNudos(c.nudo)}</select>
      <div class="seg-mini">${seg("comp","Componentes")}${seg("ang","Magnitud + ángulo")}</div>
      ${casoSel("cargas_nodales", i, c)}
      <button class="btn-del" data-dup="cargas_nodales" data-idx="${i}" title="Duplicar">⧉</button>
      <button class="btn-del" data-del="cargas_nodales" data-idx="${i}" title="Eliminar">×</button>
    </div>
    <div class="carga-params">${cuerpo}</div>
    <div class="carga-help"><span class="carga-help-icon">?</span> <em>Fy + = arriba · Fx + = derecha · M + = antihorario</em></div>
  </div>`;
}

/* ---------- casos y combinaciones ---------- */
function optsCasos(sel){
  const cs = state.modelo.casos || [];
  return cs.map(c=>`<option value="${esc(c.nombre)}" ${c.nombre==sel?"selected":""}>${esc(c.nombre)}</option>`).join("");
}
function casoSel(coll, i, c){
  if (!state.modelo.usar_combos) return "";
  const cs = state.modelo.casos || [];
  if (!cs.length) return `<span class="muted" style="font-size:11px">define un caso</span>`;
  const val = c.caso || cs[0].nombre;
  return `<select data-coll="${coll}" data-idx="${i}" data-field="caso" title="Caso de carga" style="flex:0 0 90px">${
    cs.map(x=>`<option value="${esc(x.nombre)}" ${x.nombre==val?"selected":""}>${esc(x.nombre)}</option>`).join("")}</select>`;
}
function renderCasoItem(c, i){
  return `<div class="caso-item">
    <div class="caso-head">
      <span class="tag-caso">${esc(c.nombre||("C"+(i+1)))}</span>
      <input type="text" value="${esc(c.nombre||"")}" data-coll="casos" data-idx="${i}" data-field="nombre" placeholder="nombre del caso (D, L, S…)">
      <button class="btn-del" data-del="casos" data-idx="${i}" title="Eliminar">×</button>
    </div>
  </div>`;
}
function renderComboItem(c, i){
  const cs = state.modelo.casos || [];
  const fac = c.factores || {};
  const campos = cs.map(cc=>
    `<div class="field"><label>${esc(cc.nombre)}</label><input type="number" step="any" value="${fac[cc.nombre]??""}" data-combofac="${esc(cc.nombre)}" data-idx="${i}" placeholder="0"></div>`
  ).join("") || `<span class="muted" style="font-size:11.5px">Agrega casos primero.</span>`;
  return `<div class="combo-item">
    <div class="caso-head">
      <input type="text" value="${esc(c.nombre||"")}" data-coll="combinaciones" data-idx="${i}" data-field="nombre" placeholder="nombre (1.2D+1.6L)">
      <button class="btn-del" data-del="combinaciones" data-idx="${i}" title="Eliminar">×</button>
    </div>
    <div class="combo-factores">${campos}</div>
  </div>`;
}

/* ---------- altas por defecto ---------- */
function itemPorDefecto(coll){
  const m = state.modelo;
  if (coll==="secciones") return {nombre:"sec"+(m.secciones.length+1), tipo:"rectangular", b:0.30, h:0.50};
  if (coll==="materiales") return {nombre:"mat"+((m.materiales||[]).length+1), modo:"E", E:2100000, densidad:0, nu:0.2};
  if (coll==="nudos")     { const id=nextId(m.nudos); return {id, nombre:"N"+id, x:0, y:0, apoyo:"libre"}; }
  if (coll==="elementos") { const id=nextId(m.elementos); const n=m.nudos;
        return {id, nombre:"E"+id, i:n[0]?.id??1, j:n[1]?.id??n[0]?.id??1, seccion:m.secciones[0]?.nombre??"", release_i:false, release_j:false}; }
  if (coll==="cargas_nodales") return {nudo:m.nudos[0]?.id??1, modo:"comp", Fx:0, Fy:0, M:0};
  if (coll==="cargas_elementos") return {elem:m.elementos[0]?.id??1, tipo:"distribuida", subtipo:"uniforme", dir:"vert", q:0};
  if (coll==="casos"){ const n=(m.casos||[]).length; return {nombre: ["D","L","S","W","E"][n] || ("Caso"+(n+1))}; }
  if (coll==="combinaciones"){ const f={}; (m.casos||[]).forEach(c=>f[c.nombre]=1); return {nombre:"Comb"+((m.combinaciones||[]).length+1), factores:f}; }
}

/* ============================================================
   DELEGACIÓN DE EVENTOS DEL EDITOR
   ============================================================ */
function bindEditor(){
  const cont = $("#rail");

  $$(".acc .acc-head").forEach(h => h.addEventListener("click", () => {
    const acc = h.parentElement;
    const wasCollapsed = acc.classList.contains("is-collapsed");
    const parentGroup = acc.closest(".acc-group");
    if (wasCollapsed) {
      // Collapse sibling accordions within same group
      if (parentGroup){
        parentGroup.querySelectorAll(".acc").forEach(a => a.classList.add("is-collapsed"));
      } else {
        $$("#rail .acc").forEach(a => a.classList.add("is-collapsed"));
      }
      acc.classList.remove("is-collapsed");
      // Activate workflow step for this group
      if (parentGroup) setWorkflowActiveForGroup(parentGroup.dataset.group);
    } else {
      acc.classList.add("is-collapsed");
    }
    updateAccOpenCount();
  }));

  /* --- Drag & Drop reorder --- */
  let _dragSrc = null;
  cont.addEventListener("dragstart",(e)=>{
    const item = e.target.closest("[data-drag]");
    if (!item) return;
    _dragSrc = { coll: item.dataset.drag, idx: +item.dataset.idx };
    item.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  cont.addEventListener("dragover",(e)=>{
    e.preventDefault();
    const item = e.target.closest("[data-drag]");
    if (!item || !_dragSrc || item.dataset.drag !== _dragSrc.coll) return;
    e.dataTransfer.dropEffect = "move";
    item.classList.add("drag-over");
  });
  cont.addEventListener("dragleave",(e)=>{
    const item = e.target.closest("[data-drag]");
    if (item) item.classList.remove("drag-over");
  });
  cont.addEventListener("drop",(e)=>{
    e.preventDefault();
    const item = e.target.closest("[data-drag]");
    if (!item || !_dragSrc || item.dataset.drag !== _dragSrc.coll) return;
    item.classList.remove("drag-over");
    const coll = _dragSrc.coll;
    const fromIdx = _dragSrc.idx;
    const toIdx = +item.dataset.idx;
    if (fromIdx === toIdx) return;
    pushUndo();
    const arr = state.modelo[coll];
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    _dragSrc = null;
    renderEditor(); drawPreview();
  });
  cont.addEventListener("dragend",(e)=>{
    _dragSrc = null;
    cont.querySelectorAll(".dragging,.drag-over").forEach(el=>el.classList.remove("dragging","drag-over"));
  });

  const onEdit = (e) => {
    const el = e.target;
    if (el.dataset.matpreset !== undefined && el.value){
      aplicarMatPreset(+el.dataset.idx, el.value); renderEditor(); drawPreview(); return;
    }
    if (el.dataset.combofac !== undefined){
      const idx=+el.dataset.idx, comb=state.modelo.combinaciones[idx];
      if (comb){ comb.factores = comb.factores||{}; comb.factores[el.dataset.combofac] = num(el.value); }
      return;
    }
    if (el.dataset.coll){
      pushUndo();
      const coll = el.dataset.coll, idx = +el.dataset.idx, field = el.dataset.field;
      const item = state.modelo[coll][idx]; if (!item) return;
      if (field==="__tipo"){ aplicarTipoCarga(item, el.value); renderEditor(); drawPreview(); return; }
      if (field==="dir"){ item.dir = el.value; ensureCargaFields(item); renderEditor(); drawPreview(); return; }
      if (field==="__elem"){ item.elem = +el.value; drawPreview(); return; }
      if (field==="__sectipo"){ aplicarTipoSeccion(item, el.value); renderEditor(); drawPreview(); return; }
      let val;
      if (el.type==="checkbox") val = el.checked;
      else if (el.type==="number") val = el.value;
      else val = el.value;
      if (["i","j","nudo","elem"].includes(field)) val = +el.value;
      // Renombrar sección / material → propagar a los elementos que la usan
      // (así no hay que rehacer el elemento). Sin renderEditor en "input" para
      // no perder el foco mientras se escribe; se refresca al confirmar.
      if (field==="nombre" && (coll==="secciones" || coll==="materiales")){
        const oldName = item.nombre;
        item.nombre = val;
        if (oldName && oldName !== val){
          const key = coll==="secciones" ? "seccion" : "material";
          state.modelo.elementos.forEach(elm=>{ if (elm[key]===oldName) elm[key]=val; });
        }
        if (e.type==="change") renderEditor();
        scheduleAutoSave(); drawPreview();
        return;
      }
      const sub = el.dataset.sub;
      if (sub){ item[sub] = item[sub] || {}; item[sub][field] = val; }
      else { item[field] = val; }
      if (coll==="casos" && field==="nombre") renderEditor();
      if (coll==="secciones") updateSecAI(idx);
      if (coll==="cargas_nodales") updateCnFxFy(idx);
      scheduleAutoSave();
      drawPreview();
    } else if (el.dataset.field){
      let val = el.type==="checkbox" ? el.checked : el.value;
      setPath(state.modelo, el.dataset.field, val);
      if (el.dataset.field==="usar_combos"){ renderEstaticos(); renderEditor(); }
      scheduleAutoSave();
      drawPreview();
    }
  };
  cont.addEventListener("input", onEdit);
  cont.addEventListener("change", onEdit);

  cont.addEventListener("click", (e)=>{
    const adv = e.target.closest("[data-ndadv]");
    if (adv){ const idx=+adv.dataset.ndadv;
      const body = cont.querySelector(`[data-ndadvbody="${idx}"]`);
      if (body) body.classList.toggle("open"); return; }
    const apr = e.target.closest("[data-angpreset]");
    if (apr){ const idx=+apr.dataset.idx, item=state.modelo.cargas_nodales[idx];
      if (item){ pushUndo(); item.ang=num(apr.dataset.angpreset); renderEditor(); drawPreview(); } return; }
    const dpr = e.target.closest("[data-dirpreset]");
    if (dpr){ const idx=+dpr.dataset.idx, item=state.modelo.cargas_elementos[idx];
      if (item){ pushUndo(); item.dir=dpr.dataset.dirpreset; ensureCargaFields(item); renderEditor(); drawPreview(); } return; }
    const cnm = e.target.closest("[data-cnmodo]");
    if (cnm){ const idx=+cnm.dataset.idx, item=state.modelo.cargas_nodales[idx];
      if (item){ pushUndo(); item.modo=cnm.dataset.cnmodo;
        if (item.modo==="ang" && item.mag==null){ item.mag=0; item.ang=0; }
        renderEditor(); drawPreview(); } return; }
    const dup = e.target.closest("[data-dup]");
    if (dup){
      pushUndo();
      const coll = dup.dataset.dup, idx = +dup.dataset.idx;
      const orig = state.modelo[coll][idx];
      if (orig){
        const copy = JSON.parse(JSON.stringify(orig));
        if (copy.id != null) copy.id = nextId(state.modelo[coll]);
        if (copy.nombre) copy.nombre = copy.nombre + " copia";
        state.modelo[coll].push(copy);
        renderEditor(); drawPreview();
        toast("Elemento duplicado.", "ok", 1500);
      }
      return;
    }
    const add = e.target.closest("[data-add]");
    if (add){ pushUndo(); const coll = add.dataset.add; state.modelo[coll] = state.modelo[coll]||[]; state.modelo[coll].push(itemPorDefecto(coll)); renderEditor(); drawPreview(); return; }
    const del = e.target.closest("[data-del]");
    if (del){
      const coll = del.dataset.del, idx = +del.dataset.idx;
      if (coll === "nudos"){
        const nudoId = state.modelo.nudos[idx]?.id;
        const refs = state.modelo.elementos.filter(e=>e.i===nudoId||e.j===nudoId);
        if (refs.length){
          if (!confirm(`El nudo ${state.modelo.nudos[idx].nombre} está referenciado por ${refs.length} elemento(s). ¿Eliminar de todas formas?`)) return;
        }
      }
      if (coll === "elementos"){
        const elemId = state.modelo.elementos[idx]?.id;
        const refs = (state.modelo.cargas_elementos||[]).filter(c=>c.elem===elemId);
        if (refs.length){
          if (!confirm(`El elemento ${state.modelo.elementos[idx].nombre} tiene ${refs.length} carga(s). ¿Eliminar de todas formas?`)) return;
        }
      }
      if (coll === "secciones" || coll === "materiales"){
        const nombre = state.modelo[coll][idx]?.nombre;
        const key = coll==="secciones" ? "seccion" : "material";
        const refs = (state.modelo.elementos||[]).filter(e=>e[key]===nombre);
        if (refs.length){
          const otras = (state.modelo[coll]||[]).filter((_,k)=>k!==idx);
          if (coll==="secciones" && otras.length===0){
            toast("No puedes eliminar la única sección: los elementos quedarían sin sección.", "err", 4000);
            return;
          }
          const reemplazo = coll==="secciones" ? (otras[0]?.nombre || "") : null;
          const lbl = refs.map(e=>e.nombre||("E"+e.id)).join(", ");
          if (!confirm(`"${nombre}" la usan ${refs.length} elemento(s): ${lbl}.\n` +
              (coll==="secciones"
                 ? `Se reasignarán a "${reemplazo}".`
                 : `Volverán al material global.`) + ` ¿Continuar?`)) return;
          refs.forEach(e=>{ e[key] = reemplazo; });
        }
      }
      pushUndo();
      state.modelo[coll].splice(idx,1);
      renderEditor(); drawPreview();
    }
  });

  $("#seg-material").addEventListener("click",(e)=>{
    const b = e.target.closest("button"); if(!b) return;
    state.modelo.material.modo = b.dataset.mat; renderEstaticos(); drawPreview();
  });

  const selUnidad = $("#sel-unidad");
  if (selUnidad) {
    selUnidad.addEventListener("change", (e) => {
      state.modelo.unidad = e.target.value;
      renderEstaticos(); renderEditor(); drawPreview(); scheduleAutoSave();
    });
  }

  $("#btn-limpiar").addEventListener("click", ()=>{
    if (confirm("¿Estás seguro? Se borrará todo el modelo actual.")) limpiarModelo();
  });
  $("#btn-calcular").addEventListener("click", calcular);
  const bcc=$("#btn-calc-combos"); if(bcc) bcc.addEventListener("click", calcularCombinaciones);
  $("#btn-exportar").addEventListener("click", exportarProyecto);
  $("#btn-importar").addEventListener("click", ()=> $("#file-importar").click());
  $("#btn-guardar-tpl").addEventListener("click", guardarPlantillaCustom);
  $("#file-importar").addEventListener("change", (e)=>{
    if (e.target.files[0]) importarProyecto(e.target.files[0]);
    e.target.value = "";
  });

  /* --- Resultados buttons --- */
  const bv=$("#btn-volver-editar"); if(bv) bv.addEventListener("click",()=>setVista("modelo"));
  const bm=$("#btn-exp-memoria"); if(bm) bm.addEventListener("click",exportarMemoria);
  const bc=$("#btn-exp-csv"); if(bc) bc.addEventListener("click",exportarCSV);
  const bp=$("#btn-imprimir"); if(bp) bp.addEventListener("click",()=>window.print());
  const tr=$("#toggle-reporte"); if(tr) tr.addEventListener("click",()=>{
    const body=$("#reporte-body"); if(body) body.hidden=!body.hidden;
    const chev=tr.querySelector(".chev"); if(chev) chev.style.transform=body&&body.hidden?"rotate(-90deg)":"";
  });

  /* --- Diagramas segment (delegation) --- */
  const segDiag=$("#seg-diagramas");
  if(segDiag) segDiag.addEventListener("click",(e)=>{const b=e.target.closest("button[data-img]");if(b) renderDiagrama(b.dataset.img);});

  /* --- Diagram zoom/export (bound once) --- */
  $("#diag-zin")?.addEventListener("click", ()=>{ state._diagZoom=(state._diagZoom||1)*1.25; _applyDiagZoom($("#diag-svg")); });
  $("#diag-zout")?.addEventListener("click", ()=>{ state._diagZoom=(state._diagZoom||1)/1.25; _applyDiagZoom($("#diag-svg")); });
  $("#diag-zreset")?.addEventListener("click", ()=>{ state._diagZoom=1; const s=$("#diag-svg"); if(s && state._vb) s.setAttribute("viewBox",state._vb); });
  $("#diag-export")?.addEventListener("click", exportarDiagramaPNG);

  /* --- Envolvente segment (delegation) --- */
  const segEnv=$("#seg-envolvente");
  if(segEnv) segEnv.addEventListener("click",(e)=>{const b=e.target.closest("button[data-env]");if(b) drawEnvolvente(b.dataset.env);});

  /* --- Combinaciones --- */
  const bce=$("#btn-combo-editar"); if(bce) bce.addEventListener("click",()=>setVista("modelo"));
  const blh=$("#btn-limpiar-historial"); if(blh) blh.addEventListener("click",async()=>{
    if(!confirm("¿Vaciar todo el historial?")) return;
    await API.histClear(); cargarHistorial(); toast("Historial vaciado.","ok");
  });
}

function aplicarTipoCarga(item, key){
  Object.keys(item).forEach(k => { if (!["elem","caso"].includes(k)) delete item[k]; });
  if (key==="dist_unif"){ item.tipo="distribuida"; item.subtipo="uniforme"; item.dir="vert"; item.q=0; }
  else if (key==="dist_trap"){ item.tipo="distribuida"; item.subtipo="trapezoidal"; item.dir="vert"; item.q1=0; item.q2=0; }
  else if (key==="puntual"){ item.tipo="puntual"; item.dir="vert"; item.q=0; item.a=null; }
  else if (key==="momento"){ item.tipo="momento"; item.M=0; item.a=null; }
  else if (key==="termica"){ item.tipo="termica"; item.dT=0; item.dT_grad=0; }
}

// Inicializa los campos necesarios al cambiar de dirección, sin borrar otros.
function ensureCargaFields(c){
  if (c.tipo==="distribuida"){
    if (c.dir==="comp"){
      if (c.subtipo==="trapezoidal"){ ["wx1","wy1","wx2","wy2"].forEach(k=>{ if(c[k]==null) c[k]=0; }); }
      else { if(c.wx==null)c.wx=0; if(c.wy==null)c.wy=0; }
    } else {
      if (c.subtipo==="trapezoidal"){ if(c.q1==null)c.q1=0; if(c.q2==null)c.q2=0; }
      else { if(c.q==null)c.q=0; }
      if (c.dir==="angle" && c.ang==null) c.ang=0;
    }
  } else if (c.tipo==="puntual"){
    if (c.dir==="comp"){ if(c.Px==null)c.Px=0; if(c.Py==null)c.Py=0; }
    else { if(c.q==null)c.q=0; if(c.dir==="angle"&&c.ang==null)c.ang=0; }
  }
}

function aplicarTipoSeccion(item, tipo){
  const nombre = item.nombre;
  Object.keys(item).forEach(k => { if (k!=="nombre") delete item[k]; });
  item.nombre = nombre; item.tipo = tipo;
  const def = {
    rectangular:{b:0.30,h:0.50}, cajon:{b:0.15,h:0.15,e:0.005}, circular:{d:0.40},
    tubular:{d:0.20,e:0.01}, perfil_I:{b:0.20,h:0.40,tf:0.015,tw:0.010},
    perfil_T:{b:0.30,h:0.40,tf:0.10,tw:0.10}, AI:{A:0.01,I:1e-4},
  };
  Object.assign(item, def[tipo]||{});
}

function updateSecAI(idx){
  const item = state.modelo.secciones[idx];
  const card = $$("#tb-secciones .sec-item")[idx]; if(!card) return;
  const aiEl = card.querySelector(".sec-AI"); if(!aiEl) return;
  if ((item.tipo||"rectangular")==="AI"){ aiEl.textContent=""; return; }
  const [A,I]=calcAI(item);
  if (A!=null && I!=null){ aiEl.className="sec-AI";
    aiEl.innerHTML = `A = ${A.toExponential(4)} m² &nbsp;·&nbsp; I = ${I.toExponential(4)} m⁴`; }
  else { aiEl.className="sec-AI eq-warn"; aiEl.textContent="Completa las dimensiones…"; }
}

function updateCnFxFy(idx){
  const item = state.modelo.cargas_nodales[idx];
  if ((item.modo||"comp")!=="ang") return;
  const card = $$("#tb-cargas_nodales .cn-item")[idx]; if(!card) return;
  const aiEl = card.querySelector(".carga-global"); if(!aiEl) return;
  const u = getUnidad();
  const mag=num(item.mag), ang=num(item.ang);
  const Fx=mag*Math.cos(ang*Math.PI/180), Fy=mag*Math.sin(ang*Math.PI/180);
  aiEl.innerHTML = `→ Fx = ${fnum(Fx)} · Fy = ${fnum(Fy)} ${u.fuerza} ${globGlyph(Fx,Fy)}`;
}

/* ============================================================
   VISTA PREVIA SVG
   ============================================================ */
const SVGNS = "http://www.w3.org/2000/svg";
let _previewZoom = 1, _previewPanX = 0, _previewPanY = 0;

function drawPreview(){
  const svg = $("#preview-svg");
  const W=400, H=300, pad=40;
  const m = state.modelo;
  const nodos = m.nudos.map(n => ({...n, x:num(n.x), y:num(n.y)}));
  if (nodos.length===0){ state._pv = {ox:200, oy:150, scale:30}; svg.innerHTML = `<text x="200" y="150" text-anchor="middle" fill="#7AADB8" font-size="13" font-family="Inter">Agrega nudos para ver el modelo</text>`; $("#preview-legend").textContent=""; svg.classList.toggle("mode-nudo", state.emode==="nudo"); return; }

  const xs=nodos.map(n=>n.x), ys=nodos.map(n=>n.y);
  let minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
  let rx=(maxX-minX)||1, ry=(maxY-minY)||1;
  const baseScale=Math.min((W-2*pad)/rx,(H-2*pad)/ry);
  const scale = baseScale * _previewZoom;
  const ox=(W-rx*scale)/2 - minX*scale + _previewPanX;
  const oy=(H-ry*scale)/2 + maxY*scale + _previewPanY;
  const SX=x=>ox+x*scale, SY=y=>oy-y*scale;
  state._pv = {ox, oy, scale:baseScale};
  const byId=Object.fromEntries(nodos.map(n=>[n.id,n]));
  const d = Math.max(rx,ry);
  const u = getUnidad();

  let g = [];

  // grid lines
  if ($("#chk-grid")?.checked){
    const gridStep = 1;
    const gMinX = Math.floor(minX/gridStep)*gridStep;
    const gMaxX = Math.ceil(maxX/gridStep)*gridStep;
    const gMinY = Math.floor(minY/gridStep)*gridStep;
    const gMaxY = Math.ceil(maxY/gridStep)*gridStep;
    for(let gx=gMinX;gx<=gMaxX;gx+=gridStep){
      g.push(`<line x1="${SX(gx)}" y1="${SY(gMinY)}" x2="${SX(gx)}" y2="${SY(gMaxY)}" stroke="#D8DCE4" stroke-width="0.5" stroke-dasharray="4 4"/>`);
    }
    for(let gy=gMinY;gy<=gMaxY;gy+=gridStep){
      g.push(`<line x1="${SX(gMinX)}" y1="${SY(gy)}" x2="${SX(gMaxX)}" y2="${SY(gy)}" stroke="#D8DCE4" stroke-width="0.5" stroke-dasharray="4 4"/>`);
    }
  }

  // elementos
  m.elementos.forEach((e,eIdx)=>{
    const a=byId[e.i], b=byId[e.j]; if(!a||!b) return;
    const isSelElem = state.selected.type==="elemento" && state.selected.idx===eIdx;
    const strokeC = isSelElem ? "#508C9B" : "#201E43";
    const strokeW = isSelElem ? 5 : 3.5;
    if (isSelElem) g.push(`<line x1="${SX(a.x)}" y1="${SY(a.y)}" x2="${SX(b.x)}" y2="${SY(b.y)}" stroke="rgba(80,140,155,.22)" stroke-width="14" stroke-linecap="round"/>`);
    g.push(`<line x1="${SX(a.x)}" y1="${SY(a.y)}" x2="${SX(b.x)}" y2="${SY(b.y)}" stroke="${strokeC}" stroke-width="${strokeW}" stroke-linecap="round"/>`);
    const mx=(SX(a.x)+SX(b.x))/2, my=(SY(a.y)+SY(b.y))/2;
    if (state._labelToggles.secciones){
      const elemLabel = esc(e.nombre || ("E"+e.id));
      const wRect = Math.max(22, elemLabel.length*6 + 10);
      g.push(`<rect x="${mx-wRect/2}" y="${my-9}" width="${wRect}" height="16" rx="4" fill="${isSelElem?"#EBF3F5":"#fff"}" stroke="${isSelElem?"#508C9B":"#CBDDE1"}"/><text x="${mx}" y="${my+3}" text-anchor="middle" font-size="9" font-weight="700" fill="${isSelElem?"#3A6B78":"#201E43"}" font-family="Inter">${elemLabel}</text>`);
    }
    if (e.release_i){ const px=SX(a.x)+(SX(b.x)-SX(a.x))*0.08, py=SY(a.y)+(SY(b.y)-SY(a.y))*0.08; g.push(`<circle cx="${px}" cy="${py}" r="3.5" fill="#fff" stroke="#201E43" stroke-width="1.5"/>`); }
    if (e.release_j){ const px=SX(b.x)+(SX(a.x)-SX(b.x))*0.08, py=SY(b.y)+(SY(a.y)-SY(b.y))*0.08; g.push(`<circle cx="${px}" cy="${py}" r="3.5" fill="#fff" stroke="#201E43" stroke-width="1.5"/>`); }
    if (state._labelToggles.valores){
      const L = Math.hypot(b.x-a.x, b.y-a.y);
      const ang = Math.atan2(SY(b.y)-SY(a.y), SX(b.x)-SX(a.x));
      const lmx = (SX(a.x)+SX(b.x))/2 + 12*Math.cos(ang+Math.PI/2);
      const lmy = (my) + 12*Math.sin(ang+Math.PI/2);
      g.push(`<text x="${lmx}" y="${lmy}" text-anchor="middle" font-size="8" fill="#7AADB8" font-family="Inter">${L.toFixed(2)}${u.longitud}</text>`);
    }
    // transparent hit target for element selection
    g.push(`<line class="elem-hit" data-elem="${eIdx}" x1="${SX(a.x)}" y1="${SY(a.y)}" x2="${SX(b.x)}" y2="${SY(b.y)}" stroke="transparent" stroke-width="14" stroke-linecap="round" style="cursor:pointer"/>`);
  });

  // cargas en elementos
  if (state._labelToggles.cargas){
    m.cargas_elementos.forEach(c=>{
      const e=m.elementos.find(x=>x.id==c.elem); if(!e) return;
      const a=byId[e.i], b=byId[e.j]; if(!a||!b) return;
      g = g.concat(drawCargaElem(c, a, b, SX, SY, state._labelToggles.valores));
    });
  }

  // rubber-band line when connecting
  if (state.emode==="conectar" && state._connectFirst!=null && state._mousePos){
    const a = nodos.find(n=>n.id===state._connectFirst);
    if (a) g.push(`<line x1="${SX(a.x)}" y1="${SY(a.y)}" x2="${state._mousePos.x}" y2="${state._mousePos.y}" stroke="#508C9B" stroke-width="2" stroke-dasharray="6 4"/>`);
  }

  // nudos + apoyos
  nodos.forEach((n,idx)=>{
    g.push(drawApoyo(n, SX, SY));
    const selConn = state._connectFirst===n.id;
    const selInsp = state.selected.type==="nudo" && state.selected.idx===idx;
    if (selInsp) g.push(`<circle cx="${SX(n.x)}" cy="${SY(n.y)}" r="13" fill="rgba(80,140,155,.15)" stroke="#508C9B" stroke-width="2" stroke-dasharray="5 3"/>`);
    if (selConn) g.push(`<circle cx="${SX(n.x)}" cy="${SY(n.y)}" r="9" fill="none" stroke="#508C9B" stroke-width="2"/>`);
    g.push(`<circle cx="${SX(n.x)}" cy="${SY(n.y)}" r="${(selConn||selInsp)?6:4.5}" fill="${(selConn||selInsp)?"#508C9B":"#201E43"}"/>`);
    if (state._labelToggles.nombres){
      g.push(`<text x="${SX(n.x)+7}" y="${SY(n.y)-6}" font-size="9.5" fill="${selInsp?"#3A6B78":"#3A6B78"}" font-weight="600" font-family="Inter">${esc(n.nombre||("N"+n.id))}</text>`);
    }
    g.push(`<circle class="node-hit" data-node="${idx}" cx="${SX(n.x)}" cy="${SY(n.y)}" r="12" fill="transparent" style="cursor:pointer"/>`);
  });

  // cargas nodales
  m.cargas_nodales.forEach(c=>{
    const n=byId[c.nudo]; if(!n) return;
    let Fx, Fy;
    if ((c.modo||"comp")==="ang"){
      const mag=num(c.mag), ang=num(c.ang)*Math.PI/180;
      Fx=mag*Math.cos(ang); Fy=mag*Math.sin(ang);
    } else { Fx=num(c.Fx); Fy=num(c.Fy); }
    const COL_NODAL = "#B23A2E";
    if (Fx!==0){
      const dir=Math.sign(Fx);
      g.push(arrow(SX(n.x)-30*dir, SY(n.y), SX(n.x), SY(n.y), COL_NODAL));
      const labelDir = Fx > 0 ? "→" : "←";
      g.push(`<text x="${SX(n.x)-34*dir}" y="${SY(n.y)-6}" text-anchor="${Fx>0?"end":"start"}" font-size="9.5" font-weight="700" fill="${COL_NODAL}" font-family="Inter">${Math.abs(Fx).toFixed(1)}${u.fuerza} ${labelDir}</text>`);
    }
    if (Fy!==0){
      const dir=Math.sign(Fy);
      g.push(arrow(SX(n.x), SY(n.y)+30*dir, SX(n.x), SY(n.y), COL_NODAL));
      const labelDir = Fy > 0 ? "↑" : "↓";
      g.push(`<text x="${SX(n.x)+10}" y="${SY(n.y)+34*dir}" text-anchor="start" font-size="9.5" font-weight="700" fill="${COL_NODAL}" font-family="Inter">${Math.abs(Fy).toFixed(1)}${u.fuerza} ${labelDir}</text>`);
    }
    if (num(c.M)!==0){
      const M = num(c.M);
      const r = 14;
      const startAngle = M > 0 ? -Math.PI/4 : Math.PI/4;
      const endAngle = M > 0 ? Math.PI + Math.PI/4 : -Math.PI - Math.PI/4;
      const x1 = SX(n.x) + r * Math.cos(startAngle);
      const y1 = SY(n.y) + r * Math.sin(startAngle);
      const x2 = SX(n.x) + r * Math.cos(endAngle);
      const y2 = SY(n.y) + r * Math.sin(endAngle);
      const sweep = M > 0 ? 1 : 0;
      g.push(`<path d="M ${x1} ${y1} A ${r} ${r} 0 1 ${sweep} ${x2} ${y2}" fill="none" stroke="${COL_NODAL}" stroke-width="1.8"/>`);
      const arrowAngle = M > 0 ? endAngle + Math.PI/2 : endAngle - Math.PI/2;
      const ax1 = x2 + 4 * Math.cos(arrowAngle - 0.4);
      const ay1 = y2 + 4 * Math.sin(arrowAngle - 0.4);
      const ax2 = x2 + 4 * Math.cos(arrowAngle + 0.4);
      const ay2 = y2 + 4 * Math.sin(arrowAngle + 0.4);
      g.push(`<polygon points="${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}" fill="${COL_NODAL}"/>`);
      const dir = M > 0 ? "↺" : "↻";
      g.push(`<text x="${SX(n.x)}" y="${SY(n.y)-r-8}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${COL_NODAL}" font-family="Inter">M=${Math.abs(M).toFixed(1)}${u.momentof} ${dir}</text>`);
    }
  });

  svg.innerHTML = g.join("");
  svg.classList.toggle("mode-nudo", state.emode==="nudo");
  svg.classList.toggle("mode-conectar", state.emode==="conectar");
  svg.classList.toggle("mode-delete", state.emode==="eliminar");

  const nA = m.elementos.filter(e=>e.release_i||e.release_j).length;
  const tieneCargas = m.cargas_elementos.length + m.cargas_nodales.length > 0;
  let legendText = `${m.nudos.length} nudos · ${m.elementos.length} elementos · ${m.cargas_elementos.length+m.cargas_nodales.length} cargas`;
  if (nA) legendText += ` · ${nA} con rótula`;
  legendText += ` · ${u.fuerza}/${u.longitud}`;
  $("#preview-legend").textContent = legendText;

  const existingLegend = $(".preview-convencion");
  if (tieneCargas && !existingLegend){
    const previewCard = $(".preview-card");
    if (previewCard) {
      const legendDiv = document.createElement("div");
      legendDiv.className = "preview-convencion";
      legendDiv.innerHTML = `<span class="conv-item"><span class="conv-color" style="background:#3A6B78"></span> Distribuida</span>
        <span class="conv-item"><span class="conv-color" style="background:#B23A2E"></span> Puntual</span>
        <span class="conv-item"><span class="conv-color" style="background:#C77B30"></span> Momento</span>
        <span class="conv-sep">|</span>
        <span class="conv-item">↓ neg. = abajo</span>
        <span class="conv-item">↺ pos. = antihorario</span>`;
      previewCard.appendChild(legendDiv);
    }
  } else if (!tieneCargas && existingLegend) {
    existingLegend.remove();
  }
}

function arrow(x1,y1,x2,y2,color){
  const ang=Math.atan2(y2-y1,x2-x1), ah=5;
  const xA=x2-ah*Math.cos(ang-0.5), yA=y2-ah*Math.sin(ang-0.5);
  const xB=x2-ah*Math.cos(ang+0.5), yB=y2-ah*Math.sin(ang+0.5);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2"/><polygon points="${x2},${y2} ${xA},${yA} ${xB},${yB}" fill="${color}"/>`;
}

/* ============================================================
   CARGAS EN ELEMENTOS — resolución de dirección a ejes globales
   El backend trabaja con componentes globales (wx, wy). Aquí se
   convierte la dirección elegida (vertical, horizontal, perpendicular,
   axial, ángulo, componentes) a componentes globales para dibujar y
   para enviar al cálculo.
   ============================================================ */
// Vector unitario global de la dirección de carga elegida.
function loadDirUnit(dir, cx, cy, ang){
  switch(dir){
    case "horiz": return [1, 0];
    case "perp":  return [-cy, cx];   // perpendicular: 90° a la izquierda de i→j
    case "axial": return [cx, cy];    // a lo largo del eje del elemento (de i a j)
    case "angle": { const r=num(ang)*Math.PI/180; return [Math.cos(r), Math.sin(r)]; }
    case "vert":
    default:      return [0, 1];      // vertical global (+ = arriba, − = abajo)
  }
}
// Geometría (nodos y vector unitario) del elemento al que se aplica la carga.
function elemUnit(c, m){
  const e = m.elementos.find(x=>x.id==c.elem); if(!e) return null;
  const byId = Object.fromEntries(m.nudos.map(n=>[n.id,n]));
  const a = byId[e.i], b = byId[e.j]; if(!a||!b) return null;
  const L = Math.hypot(b.x-a.x, b.y-a.y) || 1;
  return { a, b, L, cx:(b.x-a.x)/L, cy:(b.y-a.y)/L };
}
// Componentes globales {wx1,wy1,wx2,wy2} de una distribuida.
function cargaDistGlobal(c, cx, cy){
  const trap = c.subtipo==="trapezoidal";
  if (c.dir==null || c.dir==="comp"){
    if (trap) return {wx1:num(c.wx1), wy1:num(c.wy1), wx2:num(c.wx2), wy2:num(c.wy2)};
    return {wx1:num(c.wx), wy1:num(c.wy), wx2:num(c.wx), wy2:num(c.wy)};
  }
  const [ux,uy] = loadDirUnit(c.dir, cx, cy, c.ang);
  if (trap){ const q1=num(c.q1), q2=num(c.q2);
    return {wx1:q1*ux, wy1:q1*uy, wx2:q2*ux, wy2:q2*uy}; }
  const q = num(c.q);
  return {wx1:q*ux, wy1:q*uy, wx2:q*ux, wy2:q*uy};
}
// Componentes globales {Px,Py} de una puntual.
function cargaPuntGlobal(c, cx, cy){
  if (c.dir==null || c.dir==="comp") return {Px:num(c.Px), Py:num(c.Py)};
  const [ux,uy] = loadDirUnit(c.dir, cx, cy, c.ang);
  const q = num(c.q);
  return {Px:q*ux, Py:q*uy};
}
// Glifo de flecha (8 direcciones) a partir de un vector global (gy hacia arriba +).
function globGlyph(gx, gy){
  if (Math.abs(gx)<1e-9 && Math.abs(gy)<1e-9) return "";
  const a = Math.atan2(gy, gx);
  const idx = ((Math.round(a/(Math.PI/4))%8)+8)%8;
  return ["→","↗","↑","↖","←","↙","↓","↘"][idx];
}
const fnum = (x)=> String(+(+x).toFixed(2));

function drawCargaElem(c, a, b, SX, SY){
  const out=[];
  const ax=SX(a.x), ay=SY(a.y), bx=SX(b.x), by=SY(b.y);
  const u = getUnidad();
  const Lm = Math.hypot(b.x-a.x, b.y-a.y) || 1;
  const cx=(b.x-a.x)/Lm, cy=(b.y-a.y)/Lm;            // unidad modelo i→j
  let mxs=bx-ax, mys=by-ay; const mln=Math.hypot(mxs,mys)||1; mxs/=mln; mys/=mln; // unidad pantalla
  let pnx=-mys, pny=mxs;                              // perpendicular pantalla
  if (pny<0){ pnx=-pnx; pny=-pny; }                  // que apunte "hacia abajo" en pantalla
  const COL_DISTRIBUIDA = "#3A6B78";
  const COL_PUNTUAL = "#B23A2E";
  const COL_MOMENTO = "#C77B30";

  if (c.tipo==="distribuida"){
    const g = cargaDistGlobal(c, cx, cy);
    const m1=Math.hypot(g.wx1,g.wy1), m2=Math.hypot(g.wx2,g.wy2);
    const wmax=Math.max(m1,m2,1e-9);
    if (wmax<1e-9) return out;
    // tramo parcial
    let t0=0, t1=1;
    if (c.a!=null && c.a!=="") t0=Math.min(Math.max(num(c.a)/Lm,0),1);
    if (c.b!=null && c.b!=="") t1=Math.min(Math.max(num(c.b)/Lm,0),1);
    if (t1<t0){ const tmp=t0; t0=t1; t1=tmp; }
    if (t1-t0<1e-3) t1=Math.min(t0+0.001,1);
    const N=Math.max(3, Math.round(9*(t1-t0)));
    const Hmin=9, Hmax=30;
    const tails=[];
    for(let k=0;k<=N;k++){
      const t=t0+(t1-t0)*k/N;
      const px=ax+(bx-ax)*t, py=ay+(by-ay)*t;
      const wx=g.wx1+(g.wx2-g.wx1)*t, wy=g.wy1+(g.wy2-g.wy1)*t;
      const mag=Math.hypot(wx,wy);
      if (mag<1e-9){ tails.push([px,py]); continue; }
      const dx=wx/mag, dy=-wy/mag;                    // dir de carga en pantalla
      const len=Hmin+(Hmax-Hmin)*(mag/wmax);
      // si la carga es casi paralela al elemento, separa las flechas a un lado
      let hx=px, hy=py;
      if (Math.abs(dx*mxs+dy*mys) > 0.8){ hx=px+pnx*8; hy=py+pny*8; }
      const tx=hx-dx*len, ty=hy-dy*len;
      tails.push([tx,ty]);
      out.push(arrow(tx,ty,hx,hy,COL_DISTRIBUIDA));
    }
    out.push(`<polyline points="${tails.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ")}" fill="none" stroke="${COL_DISTRIBUIDA}" stroke-width="1.4" opacity=".95"/>`);
    // etiqueta cerca del tramo cargado (lado de los tails, no en el centro)
    const li = Math.max(1, Math.round(tails.length*0.5));
    const lp = tails[Math.min(li, tails.length-1)] || tails[0];
    const gx=g.wx1, gy=g.wy1;
    const gm=Math.hypot(gx,gy)||1; const ldx=gx/gm, ldy=-gy/gm;
    const lx=lp[0]-ldx*10, ly=lp[1]-ldy*10;
    const sameMag = Math.abs(m1-m2)<1e-9;
    const lbl = sameMag
      ? `${fnum(wmax)} ${u.cargad} ${globGlyph(g.wx1,g.wy1)}`
      : `${fnum(m1)}→${fnum(m2)} ${u.cargad} ${globGlyph(g.wx2,g.wy2)}`;
    out.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${COL_DISTRIBUIDA}" font-family="Inter" paint-order="stroke" stroke="#fff" stroke-width="2.5">${lbl}</text>`);
  } else if (c.tipo==="puntual"){
    const g = cargaPuntGlobal(c, cx, cy);
    const P=Math.hypot(g.Px,g.Py); if(P<1e-9) return out;
    const t=(c.a!=null && c.a!=="")?Math.min(Math.max(num(c.a)/Lm,0),1):0.5;
    const px=ax+(bx-ax)*t, py=ay+(by-ay)*t;
    const dx=g.Px/P, dy=-g.Py/P;
    const len=34;
    const tx=px-dx*len, ty=py-dy*len;
    out.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.6" fill="${COL_PUNTUAL}"/>`);
    out.push(arrow(tx, ty, px, py, COL_PUNTUAL));
    out.push(`<text x="${(tx-dx*7).toFixed(1)}" y="${(ty-dy*7).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${COL_PUNTUAL}" font-family="Inter" paint-order="stroke" stroke="#fff" stroke-width="2.5">${fnum(P)} ${u.fuerza} ${globGlyph(g.Px,g.Py)}</text>`);
  } else if (c.tipo==="momento"){
    const L=Math.hypot(b.x-a.x,b.y-a.y)||1; const t=(c.a!=null)?Math.min(Math.max(num(c.a)/L,0),1):0.5;
    const px=ax+(bx-ax)*t, py=ay+(by-ay)*t, r=12;
    const M = num(c.M);
    if (M !== 0) {
      const startAngle = M > 0 ? -Math.PI/4 : Math.PI/4;
      const endAngle = M > 0 ? Math.PI + Math.PI/4 : -Math.PI - Math.PI/4;
      const x1 = px + r * Math.cos(startAngle);
      const y1 = py + r * Math.sin(startAngle);
      const x2 = px + r * Math.cos(endAngle);
      const y2 = py + r * Math.sin(endAngle);
      const sweep = M > 0 ? 1 : 0;
      out.push(`<path d="M ${x1} ${y1} A ${r} ${r} 0 1 ${sweep} ${x2} ${y2}" fill="none" stroke="${COL_MOMENTO}" stroke-width="2"/>`);
      const arrowAngle = M > 0 ? endAngle + Math.PI/2 : endAngle - Math.PI/2;
      const ax1 = x2 + 5 * Math.cos(arrowAngle - 0.4);
      const ay1 = y2 + 5 * Math.sin(arrowAngle - 0.4);
      const ax2 = x2 + 5 * Math.cos(arrowAngle + 0.4);
      const ay2 = y2 + 5 * Math.sin(arrowAngle + 0.4);
      out.push(`<polygon points="${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}" fill="${COL_MOMENTO}"/>`);
    }
    const dir = M > 0 ? "↺" : (M < 0 ? "↻" : "");
    out.push(`<text x="${px}" y="${py-r-8}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${COL_MOMENTO}" font-family="Inter">M=${Math.abs(M).toFixed(1)}${u.momentof} ${dir}</text>`);
  } else if (c.tipo==="termica"){
    const dT=num(c.dT), dTg=num(c.dT_grad);
    if (dT===0 && dTg===0) return out;
    const COL_T = "#C23B22";
    // banda discontinua paralela al elemento + etiqueta ΔT
    const off=6;
    out.push(`<line x1="${ax+pnx*off}" y1="${ay+pny*off}" x2="${bx+pnx*off}" y2="${by+pny*off}" stroke="${COL_T}" stroke-width="2" stroke-dasharray="5 3" opacity=".85"/>`);
    let lbl = "ΔT";
    if (dT!==0) lbl = `ΔT=${fnum(dT)}°`;
    if (dTg!==0) lbl += (dT!==0?" · ":"ΔT ") + `∇${fnum(dTg)}°`;
    const mx=(ax+bx)/2, my=(ay+by)/2;
    out.push(`<text x="${mx+pnx*16}" y="${my+pny*16}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${COL_T}" font-family="Inter" paint-order="stroke" stroke="#fff" stroke-width="2.5">${lbl}</text>`);
  }
  return out;
}

function drawApoyo(n, SX, SY){
  const x=SX(n.x), y=SY(n.y), s=9, c="#3A3A3A";
  const ap=n.apoyo;
  if (ap==="empotrado"){
    let h=`<line x1="${x-s}" y1="${y}" x2="${x+s}" y2="${y}" stroke="${c}" stroke-width="2.5"/>`;
    for(let k=-s;k<=s;k+=4) h+=`<line x1="${x+k}" y1="${y}" x2="${x+k-4}" y2="${y+6}" stroke="${c}" stroke-width="1"/>`;
    return h;
  }
  if (ap==="fijo"){
    return `<polygon points="${x},${y} ${x-7},${y+11} ${x+7},${y+11}" fill="none" stroke="${c}" stroke-width="1.8"/><line x1="${x-10}" y1="${y+11}" x2="${x+10}" y2="${y+11}" stroke="${c}" stroke-width="2"/>`;
  }
  if (ap==="rodillo_y"){
    return `<polygon points="${x},${y} ${x-7},${y+10} ${x+7},${y+10}" fill="none" stroke="${c}" stroke-width="1.8"/><line x1="${x-10}" y1="${y+14}" x2="${x+10}" y2="${y+14}" stroke="${c}" stroke-width="2"/>`;
  }
  if (ap==="rodillo_x"){
    return `<polygon points="${x},${y} ${x-10},${y-7} ${x-10},${y+7}" fill="none" stroke="${c}" stroke-width="1.8"/><line x1="${x-14}" y1="${y-10}" x2="${x-14}" y2="${y+10}" stroke="${c}" stroke-width="2"/>`;
  }
  return "";
}

/* ============================================================
   EDITOR GRÁFICO
   ============================================================ */
function svgToModel(svg, evt){
  const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
  const ctm = svg.getScreenCTM(); if(!ctm) return null;
  const p = pt.matrixTransform(ctm.inverse());
  const pv = state._pv; if(!pv) return null;
  let x = (p.x - pv.ox) / pv.scale;
  let y = (pv.oy - p.y) / pv.scale;
  if ($("#chk-snap")?.checked){ x = Math.round(x/0.5)*0.5; y = Math.round(y/0.5)*0.5; }
  return {x, y};
}
function syncNodeInputs(idx){
  const card = $$("#tb-nudos .nd-item")[idx]; if(!card) return;
  const n = state.modelo.nudos[idx];
  const r = v => Math.round(v*1000)/1000;
  const ix = card.querySelector('input[data-field="x"]'); if(ix) ix.value = r(n.x);
  const iy = card.querySelector('input[data-field="y"]'); if(iy) iy.value = r(n.y);
}
function bindGraphEditor(){
  const svg = $("#preview-svg");
  $("#seg-modo-editor")?.addEventListener("click",(e)=>{
    const b = e.target.closest("button"); if(!b) return;
    state.emode = b.dataset.emode; state._connectFirst = null; state._mousePos = null;
    $$("#seg-modo-editor button").forEach(x=>x.classList.toggle("is-active", x===b));
    drawPreview();
  });
  let dragIdx = null, _dragPending = false, _panning = false, _panStart = null, _dragMoved = false;
  const nodeIdxAt = (evt)=>{ const t = evt.target.closest("[data-node]"); return t? +t.dataset.node : null; };

  svg.addEventListener("pointerdown",(evt)=>{
    const m = state.modelo; if(!m) return;
    if (evt.shiftKey || evt.button===1){
      _panning = true; _panStart = {x:evt.clientX, y:evt.clientY, px:_previewPanX, py:_previewPanY};
      try{ svg.setPointerCapture(evt.pointerId); }catch(_){}
      return;
    }
    if (state.emode==="mover"){
      const idx = nodeIdxAt(evt);
      if (idx!=null){ _dragPending=true; dragIdx = idx; svg.classList.add("dragging");
        try{ svg.setPointerCapture(evt.pointerId); }catch(_){} }
    } else if (state.emode==="nudo"){
      const p = svgToModel(svg, evt); if(!p) return;
      pushUndo();
      const id = nextId(m.nudos);
      m.nudos.push({id, nombre:"N"+id, x:p.x, y:p.y, apoyo:"libre"});
      renderEditor(); drawPreview();
    } else if (state.emode==="conectar"){
      const idx = nodeIdxAt(evt); if(idx==null) return;
      const nid = m.nudos[idx].id;
      if (state._connectFirst==null){ state._connectFirst = nid; drawPreview(); }
      else if (state._connectFirst!==nid){
        pushUndo();
        const a = m.nudos.find(n=>n.id===state._connectFirst), b = m.nudos[idx];
        const id = nextId(m.elementos);
        m.elementos.push({id, nombre:"E"+id, i:a.id, j:b.id,
          seccion:m.secciones[0]?.nombre??"", material:m.materiales?.[0]?.nombre||null, release_i:false, release_j:false});
        state._connectFirst = null; state._mousePos = null;
        renderEditor(); drawPreview();
      }
    } else if (state.emode==="eliminar"){
      const idx = nodeIdxAt(evt);
      if (idx != null){
        const n = m.nudos[idx];
        const refs = m.elementos.filter(e=>e.i===n.id||e.j===n.id);
        const msg = refs.length ? `El nudo ${n.nombre} tiene ${refs.length} elemento(s). ¿Eliminar?` : `¿Eliminar nudo ${n.nombre}?`;
        if (confirm(msg)){
          pushUndo();
          m.nudos.splice(idx, 1);
          m.elementos = m.elementos.filter(e=>e.i!==n.id&&e.j!==n.id);
          m.cargas_nodales = m.cargas_nodales.filter(c=>c.nudo!==n.id);
          m.cargas_elementos = m.cargas_elementos.filter(c=>{
            const e = m.elementos.find(x=>x.id===c.elem);
            return e != null;
          });
          renderEditor(); drawPreview();
        }
      }
    }
  });
  svg.addEventListener("pointermove",(evt)=>{
    // status bar coordinates
    const pCoord = svgToModel(svg, evt);
    if (pCoord) {
      const sc = $("#status-coords");
      if (sc) sc.textContent = `x: ${pCoord.x.toFixed(2)} · y: ${pCoord.y.toFixed(2)} ${getUnidad().longitud}`;
    }
    if (_panning && _panStart){
      _previewPanX = _panStart.px + (evt.clientX - _panStart.x);
      _previewPanY = _panStart.py + (evt.clientY - _panStart.y);
      drawPreview(); return;
    }
    if (dragIdx!=null){
      if (_dragPending){ pushUndo(); _dragPending=false; }
      const p = svgToModel(svg, evt); if(!p) return;
      const n = state.modelo.nudos[dragIdx]; n.x = p.x; n.y = p.y;
      drawPreview(); syncNodeInputs(dragIdx);
    }
    if (state.emode==="conectar" && state._connectFirst!=null){
      const p = svgToModel(svg, evt); if(!p) return;
      state._mousePos = p;
      drawPreview();
    }
  });

  // Click-to-select in mover mode (separate from drag)
  svg.addEventListener("click",(evt)=>{
    if (state.emode !== "mover") return;
    if (_dragMoved) { _dragMoved = false; return; } // was a drag, not a click
    const nodeEl = evt.target.closest("[data-node]");
    const elemEl = evt.target.closest("[data-elem]");
    if (nodeEl) {
      selectObject("nudo", +nodeEl.dataset.node);
    } else if (elemEl) {
      selectObject("elemento", +elemEl.dataset.elem);
    } else {
      selectObject(null, null);
    }
  });
  const endDrag = ()=>{ _panning=false; _panStart=null; if (dragIdx!=null){ _dragMoved=true; dragIdx=null; _dragPending=false; svg.classList.remove("dragging"); renderEditor(); scheduleAutoSave(); } };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  // zoom controls
  $("#pv-zoom-in")?.addEventListener("click", ()=>{ _previewZoom = Math.min(_previewZoom * 1.25, 4); drawPreview(); });
  $("#pv-zoom-out")?.addEventListener("click", ()=>{ _previewZoom = Math.max(_previewZoom / 1.25, 0.25); drawPreview(); });
  $("#pv-zoom-reset")?.addEventListener("click", ()=>{ _previewZoom = 1; _previewPanX = 0; _previewPanY = 0; drawPreview(); });
  $("#pv-export-png")?.addEventListener("click", ()=>{
    const svg = $("#preview-svg"); if(!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const scale = 2; canvas.width = 800*scale; canvas.height = 600*scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    const blob = new Blob([svgData], {type:"image/svg+xml;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    img.onload = ()=>{
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = (state.modelo?.nombre || "modelo") + ".png";
      a.click(); toast("Vista previa exportada.", "ok");
    };
    img.src = url;
  });
  svg.addEventListener("wheel",(evt)=>{
    if (!state.modelo) return;
    evt.preventDefault();
    const factor = evt.deltaY > 0 ? 0.9 : 1.1;
    _previewZoom = Math.min(Math.max(_previewZoom * factor, 0.25), 4);
    drawPreview();
  }, {passive:false});
}

/* ============================================================
   CÁLCULO
   ============================================================ */
function buildPayload(){
  const m = state.modelo;
  const mat = m.material.modo==="fc"
    ? {modo:"fc", fc:num(m.material.fc,210), unidad:"tonf/m2"}
    : {modo:"E", E:num(m.material.E,2e6)};
  if (num(m.material.densidad,0)) mat.densidad = num(m.material.densidad);
  if (num(m.material.alpha,0)) mat.alpha = num(m.material.alpha);
  if (num(m.material.nu,0)) mat.nu = num(m.material.nu);
  const secPayload = (s)=>{
    const tipo = s.tipo || "rectangular";
    if (tipo==="AI") return {nombre:s.nombre, modo:"AI", A:num(s.A), I:num(s.I)};
    const o = {nombre:s.nombre, modo:"calc", tipo};
    (SEC_TIPOS[tipo]?.campos||[]).forEach(([k])=> o[k]=num(s[k]));
    return o;
  };
  return {
    nombre: m.nombre || "Pórtico",
    despreciar_axial: !!m.despreciar_axial,
    peso_propio: !!m.peso_propio,
    timoshenko: !!m.timoshenko,
    pdelta: !!m.pdelta,
    modo_oscilatorio: !!m.modo_oscilatorio,
    analisis_modal: !!m.analisis_modal,
    n_modos: num(m.n_modos, 6),
    g: num(m.g, 9.81),
    unidad: m.unidad || "tonf_m",
    material: mat,
    materiales: (m.materiales||[]).map(x=>({nombre:x.nombre, modo:x.modo||"E",
        E:num(x.E), fc:num(x.fc), densidad:num(x.densidad), nu:num(x.nu,0.2)})),
    secciones: m.secciones.map(secPayload),
    nudos: m.nudos.map(n=>{
      const o = {id:n.id, nombre:n.nombre, x:num(n.x), y:num(n.y), apoyo:n.apoyo};
      const r = n.resorte ? {kx:num(n.resorte.kx), ky:num(n.resorte.ky), kg:num(n.resorte.kg)} : null;
      if (r && (r.kx||r.ky||r.kg)) o.resorte = r;
      const a = n.asentamiento ? {dx:num(n.asentamiento.dx), dy:num(n.asentamiento.dy), giro:num(n.asentamiento.giro)} : null;
      if (a && (a.dx||a.dy||a.giro)) o.asentamiento = a;
      return o;
    }),
    elementos: m.elementos.map(e=>({id:e.id, nombre:e.nombre, i:+e.i, j:+e.j, seccion:e.seccion, material:e.material||null, release_i:!!e.release_i, release_j:!!e.release_j})),
    cargas_nodales: m.cargas_nodales.map(cargaNodalPayload),
    cargas_elementos: m.cargas_elementos.map(c=>cargaElemPayload(c, m)),
  };
}

function cargaNodalPayload(c){
  if ((c.modo||"comp")==="ang"){
    const mag=num(c.mag), ang=num(c.ang);
    return {nudo:+c.nudo, Fx:mag*Math.cos(ang*Math.PI/180), Fy:mag*Math.sin(ang*Math.PI/180), M:num(c.M)};
  }
  return {nudo:+c.nudo, Fx:num(c.Fx), Fy:num(c.Fy), M:num(c.M)};
}

function cargaElemPayload(c, m){
  const un = (m && elemUnit(c, m)) || {cx:1, cy:0};
  const ab = {a:(c.a===""||c.a==null)?null:num(c.a), b:(c.b===""||c.b==null)?null:num(c.b)};
  if (c.tipo==="distribuida"){
    const g = cargaDistGlobal(c, un.cx, un.cy);
    if (c.subtipo==="trapezoidal")
      return {elem:+c.elem, tipo:"distribuida", subtipo:"trapezoidal", wy1:g.wy1, wy2:g.wy2, wx1:g.wx1, wx2:g.wx2, ...ab};
    return {elem:+c.elem, tipo:"distribuida", subtipo:"uniforme", wy:g.wy1, wx:g.wx1, ...ab};
  }
  if (c.tipo==="puntual"){
    const g = cargaPuntGlobal(c, un.cx, un.cy);
    return {elem:+c.elem, tipo:"puntual", Py:g.Py, Px:g.Px, a:(c.a===""||c.a==null)?null:num(c.a)};
  }
  if (c.tipo==="termica"){
    return {elem:+c.elem, tipo:"termica", dT:num(c.dT), dT_grad:num(c.dT_grad)};
  }
  return {elem:+c.elem, tipo:"momento", M:num(c.M), a:(c.a===""||c.a==null)?null:num(c.a)};
}

function validar(m){
  const u = getUnidad();
  if (m.nudos.length<2) return "Define al menos 2 nudos.";
  if (m.elementos.length<1) return "Define al menos 1 elemento.";
  if (m.secciones.length<1) return "Define al menos 1 sección.";
  const ids=new Set(m.nudos.map(n=>n.id));
  const secs=new Set(m.secciones.map(s=>s.nombre));
  for (const e of m.elementos){
    if (!ids.has(+e.i)||!ids.has(+e.j)) return `El elemento ${e.nombre||e.id} referencia un nudo inexistente.`;
    if (+e.i===+e.j) return `El elemento ${e.nombre||e.id} tiene el mismo nudo en i y j.`;
    if (!secs.has(e.seccion)) return `El elemento ${e.nombre||e.id} usa una sección inexistente.`;
  }
  const tieneApoyo = m.nudos.some(n=>n.apoyo && n.apoyo!=="libre");
  if (!tieneApoyo) return "La estructura no tiene apoyos: agrega al menos un apoyo.";
  for (const c of m.cargas_elementos){
    const e = m.elementos.find(x=>x.id==c.elem);
    if (!e) continue;
    const i = m.nudos.find(n=>n.id==e.i);
    const j = m.nudos.find(n=>n.id==e.j);
    if (i && j) {
      const L = Math.hypot(num(j.x)-num(i.x), num(j.y)-num(i.y));
      if (c.a != null && num(c.a) > L) return `Carga en ${e.nombre||e.id}: a=${c.a} excede L=${L.toFixed(2)}${u.longitud}`;
      if (c.b != null && num(c.b) > L) return `Carga en ${e.nombre||e.id}: b=${c.b} excede L=${L.toFixed(2)}${u.longitud}`;
    }
  }
  return null;
}

/* ============================================================
   COMBINACIONES Y ENVOLVENTES
   ============================================================ */
function buildPayloadCombos(){
  const m = state.modelo;
  const base = buildPayload();
  const cs = m.casos || [];
  const def = cs[0] ? cs[0].nombre : null;
  const casos = cs.map(c=>({
    nombre: c.nombre,
    cargas_nodales:   m.cargas_nodales.filter(x=>(x.caso||def)===c.nombre).map(cargaNodalPayload),
    cargas_elementos: m.cargas_elementos.filter(x=>(x.caso||def)===c.nombre).map(x=>cargaElemPayload(x, m)),
  }));
  const combos = (m.combinaciones||[]).map(c=>{
    const f = {}; Object.entries(c.factores||{}).forEach(([k,v])=>{ if(num(v)) f[k]=num(v); });
    return {nombre: c.nombre, factores: f};
  });
  return {...base, casos, combinaciones: combos};
}
async function calcularCombinaciones(){
  const m = state.modelo;
  if (!m.casos || !m.casos.length){ toast("Define al menos un caso de carga.", "err"); return; }
  const err = validar(m); if (err){ toast(err, "err"); return; }
  $("#overlay").classList.remove("hidden");
  try{
    const {ok, data} = await API.combinaciones(buildPayloadCombos());
    if (!ok || !data.ok){ toast(data.error || "No se pudo calcular.", "err", 5000); return; }
    state._combos = data;
    renderCombinaciones(data);
    setVista("combinaciones");
    toast("Envolventes calculadas.", "ok");
  } catch(e){ toast("Error de conexión.", "err"); }
  finally { $("#overlay").classList.add("hidden"); }
}
function renderCombinaciones(data){
  $("#combo-vacio").classList.add("hidden");
  $("#combo-cont").classList.remove("hidden");
  const r = data.resumen;
  $("#combo-meta").textContent = `${r.n_casos} casos · ${r.n_combinaciones} combinaciones`;
  const u = getUnidad();
  $("#combo-kpis").innerHTML =
    kpi("|M| máx (envolvente)", fmtF(r.Mmax,2), u.momentof, "teal") +
    kpi("|V| máx (envolvente)", fmtF(r.Vmax,2), u.fuerza, "warning") +
    kpi("|N| máx (envolvente)", fmtF(r.Nmax,2), u.fuerza, "steel") +
    kpi("Combinaciones", r.n_combinaciones, "", "success");
  $("#tb-combos").innerHTML = data.combinaciones.map(c=>
    `<tr><td>${esc(c.nombre)}</td><td>${fmtF(c.Mmax,2)}</td><td>${fmtF(c.Vmax,2)}</td><td>${fmtF(c.Nmax,2)}</td></tr>`).join("");
  const rg = (o)=>`${fmtF(o.min,2)} / ${fmtF(o.max,2)}`;
  $("#tb-reac-env").innerHTML = (data.reacciones_envolvente||[]).map(x=>
    `<tr><td>${esc(x.nudo)}</td><td>${rg(x.Rx)}</td><td>${rg(x.Ry)}</td><td>${rg(x.M)}</td></tr>`).join("")
    || `<tr><td colspan="4" class="muted">Sin reacciones</td></tr>`;
  drawEnvolvente("M");
}
function drawEnvolvente(tipo){
  const data = state._combos, svg = $("#env-svg"); if(!data) return;
  state._envTipo = tipo;
  $$("#seg-envolvente button").forEach(b=>b.classList.toggle("is-active", b.dataset.env===tipo));
  const env = data.envolvente, nudos = env.nudos, elems = env.elementos;
  const xs = nudos.map(n=>n.x), ys = nudos.map(n=>n.y);
  const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
  const spanX=(maxX-minX)||1, spanY=(maxY-minY)||1, d=Math.max(spanX,spanY);
  const W=(x,y)=>[x,-y];
  let vmax=1e-9;
  elems.forEach(e=>{ e[tipo+"max"].forEach(v=>vmax=Math.max(vmax,Math.abs(v)));
                     e[tipo+"min"].forEach(v=>vmax=Math.max(vmax,Math.abs(v))); });
  const off=(0.22*d)/vmax, mar=0.45*d;
  svg.setAttribute("viewBox", `${minX-mar} ${-maxY-mar} ${spanX+2*mar} ${spanY+2*mar}`);
  const FS=(spanX+2*mar)*0.026;
  const color = tipo==="M"?"#508C9B":tipo==="V"?"#C77B30":"#5B7C8D";
  const g=[];
  elems.forEach(e=>{
    const [ax,ay]=W(e.xi,e.yi), [bx,by]=W(e.xj,e.yj);
    g.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#C9CFD8" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
    const L=Math.hypot(e.xj-e.xi,e.yj-e.yi)||1, dwx=(e.xj-e.xi)/L, dwy=(e.yj-e.yi)/L, nx=-dwy, ny=dwx;
    const arr=(key)=>{ const pts=[]; for(let k=0;k<e.s.length;k++){ const t=e.s[k]/L;
      const mx=e.xi+(e.xj-e.xi)*t, my=e.yi+(e.yj-e.yi)*t, val=e[key][k];
      const [wx,wy]=W(mx+nx*val*off, my+ny*val*off); pts.push([wx,wy]); } return pts; };
    const top=arr(tipo+"max"), bot=arr(tipo+"min");
    const poly=top.concat(bot.slice().reverse());
    g.push(`<polygon points="${poly.map(p=>p[0].toFixed(3)+","+p[1].toFixed(3)).join(" ")}" fill="${color}" fill-opacity="0.13" stroke="none"/>`);
    g.push(`<polyline points="${top.map(p=>p[0].toFixed(3)+","+p[1].toFixed(3)).join(" ")}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
    g.push(`<polyline points="${bot.map(p=>p[0].toFixed(3)+","+p[1].toFixed(3)).join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`);
  });
  nudos.forEach(n=>{ const [wx,wy]=W(n.x,n.y);
    g.push(`<circle cx="${wx}" cy="${wy}" r="${FS*0.3}" fill="#201E43"/>`);
    g.push(`<text x="${wx+FS*0.5}" y="${wy-FS*0.5}" font-size="${FS*0.9}" fill="#3A6B78" font-weight="600" font-family="Inter">${esc(n.nombre)}</text>`); });
  svg.innerHTML = g.join("");
}

async function calcular(){
  const err = validar(state.modelo);
  if (err){ toast(err, "err"); return; }
  $("#overlay").classList.remove("hidden");
  try{
    const {ok, data} = await API.calcular(buildPayload());
    if (!ok || !data.ok){ toast(data.error || "No se pudo calcular.", "err", 5000); $("#overlay").classList.add("hidden"); return; }
    state.resultado = data;
    renderResultados(data);
    setVista("resultados");
    autoSave();
    toast("Cálculo completado.", "ok");
  } catch(e){
    console.error("Error en calcular:", e);
    toast("Error: " + (e.message || e), "err", 6000);
  } finally {
    $("#overlay").classList.add("hidden");
  }
}

/* ============================================================
   RESULTADOS
   ============================================================ */
function kpi(label, value, unit, accent){
  return `<div class="kpi"><span class="kpi-bar ${accent}"></span>
    <div class="kpi-label">${label}</div>
    <div class="kpi-value tnum">${value}<span class="kpi-unit">${unit||""}</span></div></div>`;
}

function renderResultados(data){
  try {
  const r = data.resultados || data, res = (r.resumen || {});
  const u = getUnidad();
  state._lastData = data;
  const ev = $("#resultados-vacio"); if(ev) ev.classList.add("hidden");
  const ec = $("#resultados-cont"); if(ec) ec.classList.remove("hidden");
  const rn = $("#res-nombre"); if(rn) rn.textContent = data.nombre || "Resultados";
  const rm = $("#res-meta"); if(rm) rm.textContent =
    `${res.n_nudos||0} nudos · ${res.n_elementos||0} elementos · ${res.n_gdl||0} GDL (${res.n_libres||0} libres) · ` +
    (res.despreciar_axial ? "sin deformación axial" : "con deformación axial") +
    (res.timoshenko ? " · Timoshenko" : "") +
    (res.pdelta ? ` · P-Δ (${res.pdelta_iters||0} iter)` : "") +
    ` · E = ${(res.E!=null ? Number(res.E).toLocaleString("es") : "—")} ${u.fuerza}/${u.longitud}²` + (data.fecha?` · ${data.fecha}`:``);

  const rk = $("#res-kpis"); if(rk) rk.innerHTML =
    kpi("Momento máx", fmtF(res.Mmax||0,2), u.momentof, "teal") +
    kpi("Cortante máx", fmtF(res.Vmax||0,2), u.fuerza, "warning") +
    kpi("Desplaz. máx", fmtD(res.umax||0), u.longitud, "success") +
    kpi("Grados de libertad", res.n_libres||0, "libres", "steel") +
    (res.cond_warning ? `<span class="cond-warning warn-${res.cond_warning}" title="${esc(res.cond_msg || ('Número de condición de Kff = '+Number(res.cond_Kff||0).toExponential(2)))}">⚠ κ=${Number(res.cond_Kff||0).toExponential(1)}</span>` : "");

  renderEquilibrio(r.equilibrio, res.cond_Kff);
  state._diag = r.diagramas || {elementos:[], nudos:[]};
  state._imagenes = data.imagenes || {};
  state.diag = "dmf";
  $$("#seg-diagramas button").forEach(b=>b.classList.toggle("is-active", b.dataset.img==="dmf"));
  renderDiagrama("dmf");

  const td = $("#tb-res-desp"); if(td) td.innerHTML = (r.desplazamientos||[]).map(d=>`
    <tr><td>${esc(d.nudo||"")}</td><td>${fmtD(d.ux||0)}</td><td>${fmtD(d.uy||0)}</td><td>${fmtD(d.giro||0)}</td></tr>`).join("");
  const tr2 = $("#tb-res-reac"); if(tr2) tr2.innerHTML = (r.reacciones||[]).map(d=>`
    <tr><td>${esc(d.nudo||"")}</td><td>${fmtF(d.Rx||0)}</td><td>${fmtF(d.Ry||0)}</td><td>${fmtF(d.M||0)}</td></tr>`).join("")
    || `<tr><td colspan="4" class="muted">Sin reacciones</td></tr>`;
  const tf = $("#tb-res-fuerzas"); if(tf) tf.innerHTML = (r.fuerzas||[]).map(d=>`
    <tr><td>${esc(d.elem||"")}</td>
      <td>${fmtF(d.Ni||0)}</td><td>${fmtF(d.Vi||0)}</td><td>${fmtF(d.Mi||0)}</td>
      <td>${fmtF(d.Nj||0)}</td><td>${fmtF(d.Vj||0)}</td><td>${fmtF(d.Mj||0)}</td>
      <td>${fmtF(d.Mmax||0,2)}</td><td>${fmtF(d.Vmax||0,2)}</td></tr>`).join("");
  const rr = $("#res-reporte"); if(rr) rr.textContent = data.reporte || "";
  renderModal(data.modal);
  } catch(e) { console.error("Error renderResultados:", e); toast("Error mostrando resultados: "+e.message, "err", 6000); }
}

/* ============================================================
   ANÁLISIS MODAL — tabla + forma modal
   ============================================================ */
function renderModal(modal){
  const card = $("#res-modal-card"); if(!card) return;
  if (!modal){ card.classList.add("hidden"); return; }
  if (modal.error){
    card.classList.remove("hidden");
    $("#tb-res-modal").innerHTML = `<tr><td colspan="4" class="eq-warn">${esc(modal.error)}</td></tr>`;
    $("#seg-modos").innerHTML = ""; $("#modal-svg").innerHTML = "";
    return;
  }
  card.classList.remove("hidden");
  state._modal = modal;
  const tb = $("#tb-res-modal");
  tb.innerHTML = modal.modos.map(m=>`<tr>
    <td>${m.modo}</td><td>${m.frecuencia_hz.toFixed(3)}</td>
    <td>${m.periodo_s!=null?m.periodo_s.toFixed(4):"—"}</td>
    <td>${m.omega.toFixed(2)}</td></tr>`).join("");
  const seg = $("#seg-modos");
  seg.innerHTML = modal.modos.map((m,i)=>`<button type="button" data-modo="${i}" class="${i===0?"is-active":""}">Modo ${m.modo}</button>`).join("");
  seg.onclick = (e)=>{ const b=e.target.closest("button[data-modo]"); if(!b) return;
    $$("#seg-modos button").forEach(x=>x.classList.toggle("is-active", x===b));
    drawModalShape(+b.dataset.modo); };
  drawModalShape(0);
}

function drawModalShape(idx){
  const modal=state._modal, diag=state._diag, svg=$("#modal-svg");
  if (!modal || !diag || !svg) return;
  const modo = modal.modos[idx]; if(!modo) return;
  const formaMap = {}; modo.forma.forEach(f=>{ formaMap[f.nudo]=f; });
  const nudos=diag.nudos, elems=diag.elementos;
  const xs=nudos.map(n=>n.x), ys=nudos.map(n=>n.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const spanX=(maxX-minX)||1, spanY=(maxY-minY)||1, d=Math.max(spanX,spanY);
  const W=(x,y)=>[x,-y];
  const amp=0.18*d;   // amplitud visual de la forma modal
  const mar=0.35*d;
  svg.setAttribute("viewBox", `${minX-mar} ${-maxY-mar} ${spanX+2*mar} ${spanY+2*mar}`);
  const g=[];
  // estructura original (tenue)
  elems.forEach(e=>{ const [ax,ay]=W(e.xi,e.yi),[bx,by]=W(e.xj,e.yj);
    g.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#C9CFD8" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`); });
  // forma modal (nudos desplazados; interpolación lineal entre nudos)
  const pos=(name,x,y)=>{ const f=formaMap[name]||{ux:0,uy:0}; return W(x+f.ux*amp, y+f.uy*amp); };
  elems.forEach(e=>{
    const ni=nudos.find(n=>n.x===e.xi&&n.y===e.yi), nj=nudos.find(n=>n.x===e.xj&&n.y===e.yj);
    const [ax,ay]=pos(ni?ni.nombre:"",e.xi,e.yi), [bx,by]=pos(nj?nj.nombre:"",e.xj,e.yj);
    g.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#508C9B" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`);
  });
  nudos.forEach(n=>{ const [wx,wy]=pos(n.nombre,n.x,n.y);
    g.push(`<circle cx="${wx}" cy="${wy}" r="${d*0.012}" fill="#201E43"/>`); });
  const FS=(spanX+2*mar)*0.04;
  g.push(`<text x="${minX-mar*0.5}" y="${-maxY-mar*0.4}" font-size="${FS}" font-weight="700" fill="#3A6B78" font-family="Inter">Modo ${modo.modo} · ${modo.frecuencia_hz.toFixed(2)} Hz · T=${modo.periodo_s!=null?modo.periodo_s.toFixed(3):"—"} s</text>`);
  svg.innerHTML = g.join("");
}

function renderEquilibrio(eq, cond){
  const cont = $("#res-equilibrio-cont"); if(!cont){ return; }
  if(!eq){ cont.innerHTML=""; return; }
  const tol = 1e-3;
  const ok = Math.abs(eq.residuo_Fx||0)<tol && Math.abs(eq.residuo_Fy||0)<tol && Math.abs(eq.residuo_M||0)<tol;
  const condTxt = cond ? (cond>1e12
      ? `<span class="eq-ok eq-warn">Número de condición ${cond.toExponential(2)} — matriz mal condicionada</span>`
      : `<span class="eq-ok">Número de condición ${cond.toExponential(2)} — bien condicionada</span>`) : "";
  cont.innerHTML = `
    <div class="eq-grid">
      <div class="eq-item"><h4>Fuerza Horizontal (X)</h4>
        <div class="eq-row"><span>Aplicado</span><span>${(eq.sumFx_aplicado||0).toFixed(3)}</span></div>
        <div class="eq-row"><span>Reacción</span><span>${(eq.sumFx_reaccion||0).toFixed(3)}</span></div>
        <div class="eq-row"><span>Residuo</span><span>${(eq.residuo_Fx||0).toExponential(2)}</span></div>
      </div>
      <div class="eq-item"><h4>Fuerza Vertical (Y)</h4>
        <div class="eq-row"><span>Aplicado</span><span>${(eq.sumFy_aplicado||0).toFixed(3)}</span></div>
        <div class="eq-row"><span>Reacción</span><span>${(eq.sumFy_reaccion||0).toFixed(3)}</span></div>
        <div class="eq-row"><span>Residuo</span><span>${(eq.residuo_Fy||0).toExponential(2)}</span></div>
      </div>
      <div class="eq-item"><h4>Momento</h4>
        <div class="eq-row"><span>Aplicado</span><span>${(eq.sumM_aplicado||0).toFixed(3)}</span></div>
        <div class="eq-row"><span>Reacción</span><span>${(eq.sumM_reaccion||0).toFixed(3)}</span></div>
        <div class="eq-row"><span>Residuo</span><span>${(eq.residuo_M||0).toExponential(2)}</span></div>
      </div>
    </div>
    <div style="margin-top:10px">
      ${ok ? `<span class="eq-seal ok">Σ = 0 ✓ Equilibrio verificado</span>` : `<span class="eq-seal fail">⚠ Σ ≠ 0 — Error en equilibrio (residuos: Fx=${(eq.residuo_Fx||0).toExponential(1)}, Fy=${(eq.residuo_Fy||0).toExponential(1)}, M=${(eq.residuo_M||0).toExponential(1)})</span>`}
      ${condTxt}
    </div>`;
}

/* ============================================================
   DIAGRAMAS INTERACTIVOS
   ============================================================ */
function renderDiagrama(tipo){
  const data = state._diag, svg = $("#diag-svg"), tip = $("#diag-tip"); if(!data) return;
  state.diag = tipo;
  $$("#seg-diagramas button").forEach(b=>b.classList.toggle("is-active", b.dataset.img===tipo));
  const tipoMap = {dmf:"M", dfc:"V", dfn:"N"};
  const dk = tipoMap[tipo] || tipo;
  const nudos = data.nudos, elems = data.elementos;
  const xs=nudos.map(n=>n.x), ys=nudos.map(n=>n.y);
  const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
  const spanX=(maxX-minX)||1, spanY=(maxY-minY)||1, d=Math.max(spanX,spanY);
  const W=(x,y)=>[x,-y];
  if (tipo==="modelo"){
    const mar=0.3*d;
    svg.setAttribute("viewBox", `${minX-mar} ${-maxY-mar} ${spanX+2*mar} ${spanY+2*mar}`);
    const FS=(spanX+2*mar)*0.03, g=[];
    elems.forEach(e=>{
      const [ax,ay]=W(e.xi,e.yi), [bx,by]=W(e.xj,e.yj);
      g.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#201E43" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`);
      const mx=(ax+bx)/2, my=(ay+by)/2;
      g.push(`<text x="${mx}" y="${my-FS*0.3}" text-anchor="middle" font-size="${FS*0.8}" fill="#3A6B78" font-weight="600" font-family="Inter">${esc(e.elem)}</text>`);
    });
    nudos.forEach(n=>{ const [wx,wy]=W(n.x,n.y);
      const restr=n.restr;
      g.push(`<circle cx="${wx}" cy="${wy}" r="${FS*0.25}" fill="#201E43"/>`);
      g.push(`<text x="${wx+FS*0.3}" y="${wy-FS*0.3}" font-size="${FS*0.75}" fill="#3A6B78" font-weight="600" font-family="Inter">${esc(n.nombre)}</text>`);
    });
    svg.innerHTML = g.join(""); state._vb = svg.getAttribute("viewBox"); return;
  }
  let vmax=1e-9;
  if (tipo==="deformada"){
    elems.forEach(e=>{ e.defx.forEach(v=>vmax=Math.max(vmax,Math.abs(v))); e.defy.forEach(v=>vmax=Math.max(vmax,Math.abs(v))); });
  } else {
    elems.forEach(e=>{ const arr=e[dk]||[]; arr.forEach(v=>vmax=Math.max(vmax,Math.abs(v))); });
  }
  if (vmax<1e-12) vmax=1;
  let scale;
  if (tipo==="deformada"){
    scale = vmax>0 ? (0.2*d)/vmax : 1;
  } else {
    scale = (0.22*d)/vmax;
  }
  const mar=0.45*d;
  svg.setAttribute("viewBox", `${minX-mar} ${-maxY-mar} ${spanX+2*mar} ${spanY+2*mar}`);
  const FS=(spanX+2*mar)*0.026;
  const color = dk==="M"?"#508C9B":dk==="V"?"#C77B30":dk==="N"?"#5B7C8D":"#2E9E8A";
  const g=[];
  // Convenio de lado del diagrama (ver fnx/fny dentro del bucle):
  //   M  → siempre del LADO TRACCIONADO (sagging hacia el lado opuesto a +y local).
  //   V,N → del lado de la normal +y local; o lado tracción si el toggle está activo.
  elems.forEach(e=>{
    const [ax,ay]=W(e.xi,e.yi), [bx,by]=W(e.xj,e.yj);
    const L=Math.hypot(e.xj-e.xi,e.yj-e.yi)||1, dwx=(e.xj-e.xi)/L, dwy=(e.yj-e.yi)/L, nx=-dwy, ny=dwx;
    if (tipo==="deformada"){
      g.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#C9CFD8" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
      const pts=[]; for(let k=0;k<e.s.length;k++){
        const t=e.s[k]/L;
        const mx=e.xi+(e.xj-e.xi)*t+e.defx[k]*scale, my=e.yi+(e.yj-e.yi)*t+e.defy[k]*scale;
        const [wx,wy]=W(mx,my); pts.push([wx,wy]); }
      g.push(`<polyline points="${pts.map(p=>p[0].toFixed(4)+","+p[1].toFixed(4)).join(" ")}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`);
    } else {
      // Build baseline and diagram points
      // M  → siempre del lado traccionado (sagging)
      // V,N → siempre perpendicular al elemento (convención estándar)
      const isM = dk==="M";
      const fnx = isM ? dwy : nx, fny = isM ? -dwx : ny;
      const bPts=[], dPts=[];
      for(let k=0;k<e.s.length;k++){
        const t=e.s[k]/L;
        const mx=e.xi+(e.xj-e.xi)*t, my=e.yi+(e.yj-e.yi)*t;
        bPts.push(W(mx, my));
        const val=(e[dk]||[])[k]||0;
        dPts.push(W(mx+fnx*val*scale, my+fny*val*scale));
      }
      // Filled polygon: baseline + diagram curve
      const poly=[...bPts, ...dPts.slice().reverse()];
      g.push(`<polygon points="${poly.map(p=>p[0].toFixed(4)+","+p[1].toFixed(4)).join(" ")}" fill="${color}" fill-opacity="0.22" stroke="none"/>`);
      // Baseline
      g.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#C9CFD8" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`);
      // Diagram curve outline
      g.push(`<polyline points="${dPts.map(p=>p[0].toFixed(4)+","+p[1].toFixed(4)).join(" ")}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`);
      // Vertical connector lines at each data point
      for(let k=0;k<bPts.length;k+=Math.max(1,Math.floor(bPts.length/8))){
        const [bxk,byk]=bPts[k], [dxk,dyk]=dPts[k];
        if(Math.hypot(dxk-bxk,dyk-byk)>FS*0.15){
          g.push(`<line x1="${bxk}" y1="${byk}" x2="${dxk}" y2="${dyk}" stroke="${color}" stroke-width="0.7" stroke-opacity="0.3" vector-effect="non-scaling-stroke"/>`);
        }
      }
      // Max and min value markers
      const arr=e[dk]||[];
      if(arr.length>0){
        let iMax=0, iMin=0;
        for(let k=1;k<arr.length;k++){ if(arr[k]>arr[iMax]) iMax=k; if(arr[k]<arr[iMin]) iMin=k; }
        const u=getUnidad();
        const vUnit=dk==="M"?u.momentof:u.fuerza;
        const lbl=(v)=> Math.abs(v)>=1000?v.toFixed(0):Math.abs(v)>=1?v.toFixed(2):v.toFixed(3);
        const drawMark=(idx,side)=>{
          if(Math.abs(arr[idx])<1e-12) return;
          const [mx,my]=dPts[idx];
          g.push(`<circle cx="${mx}" cy="${my}" r="${FS*0.18}" fill="${color}" stroke="#fff" stroke-width="${FS*0.06}"/>`);
          const off=side*FS*0.55;
          const anchor=side>0?"start":"end";
          g.push(`<text x="${mx}" y="${my+off}" text-anchor="${anchor}" dominant-baseline="middle" font-size="${FS*0.55}" fill="${color}" font-weight="700" font-family="Inter,system-ui">${fmtF(arr[idx],2)} ${vUnit}</text>`);
        };
        drawMark(iMax,-1);
        if(iMin!==iMax) drawMark(iMin,1);
        else if(arr.length>1) drawMark(arr.length-1,1);
      }
      // Zero-crossing marker
      for(let k=1;k<arr.length;k++){
        if((arr[k-1]<0&&arr[k]>0)||(arr[k-1]>0&&arr[k]<0)){
          const t0=-arr[k-1]/(arr[k]-arr[k-1]);
          const mx0=e.xi+(e.xj-e.xi)*(e.s[k-1]+t0*(e.s[k]-e.s[k-1]))/L;
          const my0=e.yi+(e.yj-e.yi)*(e.s[k-1]+t0*(e.s[k]-e.s[k-1]))/L;
          const [wx0,wy0]=W(mx0,my0);
          g.push(`<circle cx="${wx0}" cy="${wy0}" r="${FS*0.12}" fill="#fff" stroke="${color}" stroke-width="${FS*0.08}"/>`);
        }
      }
    }
  });
  nudos.forEach(n=>{ const [wx,wy]=W(n.x,n.y);
    g.push(`<circle cx="${wx}" cy="${wy}" r="${FS*0.3}" fill="#201E43"/>`);
    g.push(`<text x="${wx+FS*0.5}" y="${wy-FS*0.5}" font-size="${FS*0.9}" fill="#3A6B78" font-weight="600" font-family="Inter">${esc(n.nombre)}</text>`); });
  svg.innerHTML = g.join("");
  state._vb = svg.getAttribute("viewBox");

  svg.onmousemove = (evt)=>{
    const pt = svg.createSVGPoint(); pt.x=evt.clientX; pt.y=evt.clientY;
    const ctm = svg.getScreenCTM(); if(!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    let found=null, bestDist=Infinity;
    const isM = dk==="M";
    for(const e of elems){
      const L=Math.hypot(e.xj-e.xi,e.yj-e.yi)||1, dwx=(e.xj-e.xi)/L, dwy=(e.yj-e.yi)/L;
      const fnx = isM ? dwy : -dwy, fny = isM ? -dwx : dwx;
      for(let k=0;k<e.s.length;k++){
        const t=e.s[k]/L;
        let mx=e.xi+(e.xj-e.xi)*t, my=e.yi+(e.yj-e.yi)*t;
        if (tipo!=="deformada"){ const val=(e[dk]||[])[k]||0; mx+=fnx*val*scale; my+=fny*val*scale; }
        const [wx,wy]=W(mx,my);
        const dist=Math.hypot(p.x-wx, p.y-wy);
        if (dist<bestDist && dist<FS*2){ bestDist=dist; found={elem:e.elem, idx:k, x:e.s[k], val:(e[dk]||[])[k]}; }
      }
    }
    if (found){
      tip.hidden=false;
      tip.style.left=(evt.clientX-svg.getBoundingClientRect().left)+"px";
      tip.style.top=(evt.clientY-svg.getBoundingClientRect().top)+"px";
      const u=getUnidad();
      const units = dk==="M"?u.momentof:dk==="V"?u.fuerza:dk==="N"?u.fuerza:u.longitud;
      const dkLbl = dk==="M"?"Momento (lado tracción)":dk==="V"?"Cortante":dk==="N"?"Axial":dk;
      tip.innerHTML=`<span class="tip-x">${esc(found.elem)} @ x=${found.x.toFixed(2)}${u.longitud}</span><br>${dkLbl} = ${fmtF(found.val,3)} ${units}`;
    } else { tip.hidden=true; }
  };
  svg.onmouseleave = ()=>{ tip.hidden=true; };

  // diagram zoom
  state._diagZoom = state._diagZoom || 1;
}
function _applyDiagZoom(svg){
  if (!state._vb) return;
  const vb = state._vb.split(" ").map(Number);
  const cx=vb[0]+vb[2]/2, cy=vb[1]+vb[3]/2;
  const w=vb[2]/state._diagZoom, h=vb[3]/state._diagZoom;
  svg.setAttribute("viewBox", `${cx-w/2} ${cy-h/2} ${w} ${h}`);
}

function exportarDiagramaPNG(){
  const svg = $("#diag-svg"); if(!svg) return;
  const svgData = new XMLSerializer().serializeToString(svg);
  const vb = svg.getAttribute("viewBox") || "0 0 800 600";
  const [, , w, h] = vb.split(" ").map(Number);
  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = (w || 800) * scale;
  canvas.height = (h || 600) * scale;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const img = new Image();
  const blob = new Blob([svgData], {type:"image/svg+xml;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  img.onload = ()=>{
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = (state.resultado?.nombre || "diagrama") + "_" + (state.diag || "dmf") + ".png";
    a.click();
    toast("Diagrama exportado como PNG.", "ok");
  };
  img.src = url;
}

/* ============================================================
   CARGAR / GUARDAR MODELO
   ============================================================ */
function cargarModeloEnEditor(modelo){
  if (!modelo.material.modo) modelo.material.modo = (modelo.material.E!=null?"E":"fc");
  (modelo.secciones||[]).forEach(s=>{
    if (!s.tipo){
      if (s.b!=null && s.h!=null) s.tipo = "rectangular";
      else if (s.A!=null && s.I!=null) s.tipo = "AI";
      else s.tipo = "rectangular";
    }
  });
  (modelo.cargas_nodales||[]).forEach(c=>{ if(!c.modo) c.modo = "comp"; });
  if (modelo.peso_propio==null) modelo.peso_propio = false;
  if (modelo.modo_oscilatorio==null) modelo.modo_oscilatorio = false;
  if (!modelo.materiales) modelo.materiales = [];
  if (!modelo.casos) modelo.casos = [];
  if (!modelo.combinaciones) modelo.combinaciones = [];
  if (modelo.usar_combos==null) modelo.usar_combos = false;
  if (modelo.unidad==null) modelo.unidad = "tonf_m";
  state.modelo = modelo;
  state._undoStack = [];
  state._redoStack = [];
  state._modified = false;
  const dot = $("#modified-dot");
  if (dot) dot.classList.add("hidden");
  _previewZoom = 1; _previewPanX = 0; _previewPanY = 0;
  renderEstaticos(); renderEditor(); drawPreview();
}
function limpiarModelo(){
  cargarModeloEnEditor({
    nombre:"Nueva estructura", despreciar_axial:false, peso_propio:false, unidad:"tonf_m",
    material:{modo:"E", E:2100000}, materiales:[], casos:[], combinaciones:[], usar_combos:false,
    secciones:[],
    nudos:[], elementos:[], cargas_nodales:[], cargas_elementos:[],
  });
  toast("Modelo reiniciado.","ok");
}

/* ============================================================
   PLANTILLAS
   ============================================================ */
function _baseModelo(nombre, nudos, elementos, cn, ce, extra){
  return Object.assign({
    nombre, despreciar_axial:false, peso_propio:false, timoshenko:false, pdelta:false, unidad:"kN_m",
    material:{modo:"E", E:2100000}, materiales:[],
    secciones:[{nombre:"sec1", tipo:"rectangular", b:0.30, h:0.50}],
    nudos, elementos, cargas_nodales:cn||[], cargas_elementos:ce||[],
  }, extra||{});
}
function nd(id,x,y,ap){ return {id, nombre:"N"+id, x, y, apoyo:ap||"libre"}; }
function el(id,i,j,sec){ return {id, nombre:"E"+id, i, j, seccion:sec||"sec1", release_i:false, release_j:false}; }
const PLANTILLAS = {
  voladizo: ()=> _baseModelo("Voladizo",
    [nd(1,0,0,"empotrado"), nd(2,3,0)], [el(1,1,2)],
    [{nudo:2, modo:"comp", Fx:0, Fy:-5, M:0}], []),
  simple: ()=> _baseModelo("Viga simplemente apoyada",
    [nd(1,0,0,"fijo"), nd(2,6,0,"rodillo_y")], [el(1,1,2)],
    [], [{elem:1, tipo:"distribuida", subtipo:"uniforme", wy:-2, wx:0}]),
  continua: ()=> _baseModelo("Viga continua (2 tramos)",
    [nd(1,0,0,"fijo"), nd(2,4,0,"rodillo_y"), nd(3,8,0,"rodillo_y")],
    [el(1,1,2), el(2,2,3)], [],
    [{elem:1, tipo:"distribuida", subtipo:"uniforme", wy:-2, wx:0},
     {elem:2, tipo:"distribuida", subtipo:"uniforme", wy:-2, wx:0}]),
  portico: ()=> _baseModelo("Pórtico simple",
    [nd(1,0,0,"empotrado"), nd(2,0,3), nd(3,5,3), nd(4,5,0,"empotrado")],
    [el(1,1,2), el(2,2,3), el(3,3,4)],
    [{nudo:2, modo:"comp", Fx:4, Fy:0, M:0}],
    [{elem:2, tipo:"distribuida", subtipo:"uniforme", wy:-2.5, wx:0}]),
  portico2: ()=> _baseModelo("Pórtico 2 niveles",
    [nd(1,0,0,"empotrado"), nd(2,0,3), nd(3,0,6), nd(4,5,6), nd(5,5,3), nd(6,5,0,"empotrado")],
    [el(1,1,2), el(2,2,3), el(3,3,4), el(4,4,5), el(5,5,6), el(6,2,5)],
    [{nudo:3, modo:"comp", Fx:3, Fy:0, M:0}, {nudo:2, modo:"comp", Fx:5, Fy:0, M:0}],
    [{elem:3, tipo:"distribuida", subtipo:"uniforme", wy:-2.5, wx:0},
     {elem:6, tipo:"distribuida", subtipo:"uniforme", wy:-2.5, wx:0}]),
  dosaguas: ()=> _baseModelo("Pórtico a dos aguas",
    [nd(1,0,0,"empotrado"), nd(2,0,3), nd(3,4,4.5), nd(4,8,3), nd(5,8,0,"empotrado")],
    [el(1,1,2), el(2,2,3), el(3,3,4), el(4,4,5)],
    [],
    [{elem:2, tipo:"distribuida", subtipo:"uniforme", wy:-1.8, wx:0},
     {elem:3, tipo:"distribuida", subtipo:"uniforme", wy:-1.8, wx:0}]),
  portico_ejercicio: ()=> _baseModelo("Pórtico - Ejercicio (13 kN/m, 17 kN, 4 kN/m)",
    [
      nd(1,0,0,"fijo"),      // A - Articulado (base izq)
      nd(2,0,3.5),           // B - Tope columna izq
      nd(3,4,3.5),           // C - Tope columna der
      nd(4,4,0,"rodillo_y"), // F - Rodillo (base der)
    ],
    [
      el(1,1,2),  // Columna izq A-B
      el(2,2,3),  // Viga B-C
      el(3,3,4),  // Columna der C-F
    ],
    [{nudo:2, modo:"comp", Fx:17, Fy:0, M:0}],
    [
      {elem:2, tipo:"distribuida", subtipo:"uniforme", wy:-13, wx:0},
      {elem:3, tipo:"distribuida", subtipo:"uniforme", wy:0, wx:-4},
    ]),
  doble_voladizo: ()=> _baseModelo("Viga doble voladizo",
    [nd(1,0,0,"fijo"), nd(2,3,0,"libre"), nd(3,6,0,"fijo")], [el(1,1,2), el(2,2,3)],
    [], [{elem:1, tipo:"distribuida", subtipo:"uniforme", wy:-1.5, wx:0},
         {elem:2, tipo:"distribuida", subtipo:"uniforme", wy:-1.5, wx:0}]),
  arco: ()=> _baseModelo("Arco de medio punto",
    [nd(1,0,0,"empotrado"), nd(2,3,4), nd(3,6,0,"empotrado")], [el(1,1,2), el(2,2,3)],
    [{nudo:2, modo:"comp", Fx:0, Fy:-8, M:0}],
    [{elem:1, tipo:"distribuida", subtipo:"uniforme", wy:-1.2, wx:0},
     {elem:2, tipo:"distribuida", subtipo:"uniforme", wy:-1.2, wx:0}]),
  cercha_simple: ()=> _baseModelo("Cercha simple (triángulo)",
    [nd(1,0,0,"fijo"), nd(2,6,0,"rodillo_y"), nd(3,3,3)], [el(1,1,3), el(2,3,2), el(3,1,2)],
    [{nudo:3, modo:"comp", Fx:0, Fy:-6, M:0}], []),
  cercha_howe: ()=> _baseModelo("Cercha Howe",
    [nd(1,0,0,"fijo"), nd(2,12,0,"rodillo_y"), nd(3,3,0), nd(4,6,0), nd(5,9,0),
     nd(6,1.5,2), nd(7,3,4), nd(8,6,5), nd(9,9,4), nd(10,10.5,2)],
    [el(1,1,7), el(2,7,8), el(3,8,9), el(4,9,10), el(5,10,2),
     el(6,1,6), el(7,6,7), el(8,7,4), el(9,4,8), el(10,8,5),
     el(11,5,9), el(12,9,10), el(13,1,3), el(14,3,6), el(15,3,4),
     el(16,4,5), el(17,5,2)],
    [],
    [{elem:13, tipo:"distribuida", subtipo:"uniforme", wy:-2, wx:0},
     {elem:14, tipo:"distribuida", subtipo:"uniforme", wy:-2, wx:0},
     {elem:15, tipo:"distribuida", subtipo:"uniforme", wy:-2, wx:0},
     {elem:16, tipo:"distribuida", subtipo:"uniforme", wy:-2, wx:0},
     {elem:17, tipo:"distribuida", subtipo:"uniforme", wy:-2, wx:0}]),
  ejemplo: ()=> _baseModelo("Ejemplo: Pórtico",
    [nd(1,0,0,"empotrado"), nd(2,0,3), nd(3,5,3), nd(4,5,0,"empotrado")],
    [el(1,1,2), el(2,2,3), el(3,3,4)],
    [{nudo:2, modo:"comp", Fx:4, Fy:0, M:0}],
    [{elem:2, tipo:"distribuida", subtipo:"uniforme", wy:-2.5, wx:0}]),
  portico_3tramos: ()=> _baseModelo("Pórtico 3 tramos",
    [nd(1,0,0,"empotrado"), nd(2,0,4), nd(3,5,4), nd(4,10,4), nd(5,15,4), nd(6,15,0,"empotrado")],
    [el(1,1,2), el(2,2,3), el(3,3,4), el(4,4,5), el(5,5,6), el(6,2,5)],
    [],
    [{elem:2, tipo:"distribuida", subtipo:"uniforme", wy:-3, wx:0},
     {elem:3, tipo:"distribuida", subtipo:"uniforme", wy:-3, wx:0},
     {elem:4, tipo:"distribuida", subtipo:"uniforme", wy:-3, wx:0}]),
  viga_con_voladizo: ()=> _baseModelo("Viga con voladizo",
    [nd(1,0,0,"fijo"), nd(2,6,0,"rodillo_y"), nd(3,9,0,"libre")],
    [el(1,1,2), el(2,2,3)],
    [], [{elem:1, tipo:"distribuida", subtipo:"uniforme", wy:-2, wx:0},
         {elem:2, tipo:"distribuida", subtipo:"uniforme", wy:-1.5, wx:0}]),
  empotrado_simple: ()=> _baseModelo("Viga empotrado-simple",
    [nd(1,0,0,"empotrado"), nd(2,8,0,"rodillo_y")], [el(1,1,2)],
    [], [{elem:1, tipo:"distribuida", subtipo:"uniforme", wy:-3, wx:0}]),
  portico_arriostrado: ()=> _baseModelo("Pórtico arriostrado",
    [nd(1,0,0,"empotrado"), nd(2,0,4), nd(3,6,4), nd(4,6,0,"empotrado"), nd(5,3,4)],
    [el(1,1,2), el(2,2,5), el(3,5,3), el(4,3,4), el(5,2,3)],
    [{nudo:2, modo:"comp", Fx:5, Fy:0, M:0}],
    [{elem:5, tipo:"distribuida", subtipo:"uniforme", wy:-2, wx:0}]),
  marco_gableado: ()=> _baseModelo("Marco gableado",
    [nd(1,0,0,"empotrado"), nd(2,0,3), nd(3,4,5), nd(4,8,3), nd(5,8,0,"empotrado")],
    [el(1,1,2), el(2,2,3), el(3,3,4), el(4,4,5)],
    [],
    [{elem:2, tipo:"distribuida", subtipo:"uniforme", wy:-1.5, wx:0},
     {elem:3, tipo:"distribuida", subtipo:"uniforme", wy:-1.5, wx:0}]),
  marco_L: ()=> _baseModelo("Marco en L",
    [nd(1,0,0,"empotrado"), nd(2,0,4), nd(3,4,4), nd(4,4,0,"fijo")],
    [el(1,1,2), el(2,2,3), el(3,3,4)],
    [{nudo:3, modo:"comp", Fx:0, Fy:-6, M:0}],
    [{elem:2, tipo:"distribuida", subtipo:"uniforme", wy:-2, wx:0}]),
  viga_apoyada_3soportes: ()=> _baseModelo("Viga continua 3 apoyos",
    [nd(1,0,0,"fijo"), nd(2,5,0,"rodillo_y"), nd(3,10,0,"rodillo_y")],
    [el(1,1,2), el(2,2,3)],
    [], [{elem:1, tipo:"distribuida", subtipo:"uniforme", wy:-2.5, wx:0},
         {elem:2, tipo:"distribuida", subtipo:"uniforme", wy:-2.5, wx:0}]),
  cercha_pratt: ()=> _baseModelo("Cercha Pratt",
    [nd(1,0,0,"fijo"), nd(2,10,0,"rodillo_y"), nd(3,2.5,0), nd(4,5,0), nd(5,7.5,0),
     nd(6,2.5,2.5), nd(7,5,3.5), nd(8,7.5,2.5)],
    [el(1,1,6), el(2,6,7), el(3,7,8), el(4,8,2),
     el(5,1,3), el(6,3,6), el(7,3,4), el(8,4,7), el(9,4,5), el(10,5,8), el(11,5,2)],
    [{nudo:3, modo:"comp", Fx:0, Fy:-4, M:0},
     {nudo:4, modo:"comp", Fx:0, Fy:-4, M:0},
     {nudo:5, modo:"comp", Fx:0, Fy:-4, M:0}], []),
  cercha_k: ()=> _baseModelo("Cercha K",
    [nd(1,0,0,"fijo"), nd(2,12,0,"rodillo_y"), nd(3,4,0), nd(4,8,0),
     nd(5,4,3), nd(6,8,3)],
    [el(1,1,5), el(2,5,6), el(3,6,2),
     el(4,1,3), el(5,3,5), el(6,3,4), el(7,4,6), el(8,4,2)],
    [{nudo:3, modo:"comp", Fx:0, Fy:-5, M:0},
     {nudo:4, modo:"comp", Fx:0, Fy:-5, M:0}], []),
  viga_tres_puntos: ()=> _baseModelo("Viga - 3 cargas puntuales",
    [nd(1,0,0,"fijo"), nd(2,10,0,"rodillo_y")], [el(1,1,2)],
    [{nudo:1, modo:"comp", Fx:0, Fy:0, M:0}],
    [{elem:1, tipo:"puntual", Py:-8, Px:0, a:2.5},
     {elem:1, tipo:"puntual", Py:-12, Px:0, a:5},
     {elem:1, tipo:"puntual", Py:-8, Px:0, a:7.5}]),
  viga_momentos: ()=> _baseModelo("Viga con momentos",
    [nd(1,0,0,"fijo"), nd(2,8,0,"rodillo_y")], [el(1,1,2)],
    [], [{elem:1, tipo:"momento", M:10, a:0},
         {elem:1, tipo:"momento", M:-10, a:8}]),
  portico_inclinado: ()=> _baseModelo("Pórtico con viga inclinada",
    [nd(1,0,0,"empotrado"), nd(2,0,3), nd(3,6,5), nd(4,6,0,"empotrado")],
    [el(1,1,2), el(2,2,3), el(3,3,4)],
    [],
    [{elem:2, tipo:"distribuida", subtipo:"uniforme", wy:-2, wx:0}]),
  doble_portal: ()=> _baseModelo("Doble pórtico",
    [nd(1,0,0,"empotrado"), nd(2,0,3.5), nd(3,5,3.5), nd(4,5,0,"empotrado"),
     nd(5,5,3.5), nd(6,10,3.5), nd(7,10,0,"empotrado")],
    [el(1,1,2), el(2,2,3), el(3,3,4), el(4,5,6), el(5,6,7)],
    [{nudo:2, modo:"comp", Fx:3, Fy:0, M:0}],
    [{elem:2, tipo:"distribuida", subtipo:"uniforme", wy:-2, wx:0},
     {elem:4, tipo:"distribuida", subtipo:"uniforme", wy:-2, wx:0}]),
  voladizo_trapezoidal: ()=> _baseModelo("Voladizo - carga trapezoidal",
    [nd(1,0,0,"empotrado"), nd(2,5,0)], [el(1,1,2)],
    [], [{elem:1, tipo:"distribuida", subtipo:"trapezoidal", wy1:-4, wy2:-1, wx1:0, wx2:0}]),
  cercha_fink: ()=> _baseModelo("Cercha Fink",
    [nd(1,0,0,"fijo"), nd(2,10,0,"rodillo_y"), nd(3,5,4),
     nd(4,2.5,2), nd(5,7.5,2)],
    [el(1,1,4), el(2,4,3), el(3,3,5), el(4,5,2),
     el(5,1,3), el(6,3,2),
     el(7,4,5)],
    [{nudo:3, modo:"comp", Fx:0, Fy:-6, M:0}], []),
  marco_2pisos_2tramos: ()=> _baseModelo("Marco 2 pisos × 2 tramos",
    [nd(1,0,0,"empotrado"), nd(2,0,3), nd(3,0,6),
     nd(4,5,0,"empotrado"), nd(5,5,3), nd(6,5,6),
     nd(7,10,0,"empotrado"), nd(8,10,3), nd(9,10,6)],
    [el(1,1,2), el(2,2,3), el(3,4,5), el(4,5,6), el(5,7,8), el(6,8,9),
     el(7,2,5), el(8,5,8), el(81,3,6), el(82,6,9)],
    [{nudo:3, modo:"comp", Fx:4, Fy:0, M:0}, {nudo:6, modo:"comp", Fx:4, Fy:0, M:0}],
    [{elem:7, tipo:"distribuida", subtipo:"uniforme", wy:-2.5, wx:0},
     {elem:8, tipo:"distribuida", subtipo:"uniforme", wy:-2.5, wx:0}]),
};
/* ============================================================
   TEMPLATE GALLERY
   ============================================================ */
const TPL_SVG = {
  voladizo: `<line x1="20" y1="60" x2="100" y2="60" stroke="#201E43" stroke-width="2.5"/><line x1="20" y1="60" x2="20" y2="30" stroke="#3A6B78" stroke-width="1.5" stroke-dasharray="3 2"/><polygon points="20,60 14,68 26,68" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><circle cx="100" cy="60" r="2.5" fill="#B23A2E"/><line x1="80" y1="48" x2="100" y2="60" stroke="#B23A2E" stroke-width="1.5"/><polygon points="100,60 93,55 93,65" fill="#B23A2E"/>`,
  simple: `<line x1="20" y1="60" x2="100" y2="60" stroke="#201E43" stroke-width="2.5"/><polygon points="20,60 14,68 26,68" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="100" y1="64" x2="100" y2="68" stroke="#3A3A3A" stroke-width="1.5"/><line x1="96" y1="68" x2="104" y2="68" stroke="#3A3A3A" stroke-width="1.5"/><line x1="25" y1="52" x2="95" y2="52" stroke="#3A6B78" stroke-width="1.2"/><line x1="25" y1="52" x2="25" y2="60" stroke="#3A6B78" stroke-width="1"/><line x1="35" y1="52" x2="35" y2="60" stroke="#3A6B78" stroke-width="1"/><line x1="45" y1="52" x2="45" y2="60" stroke="#3A6B78" stroke-width="1"/><line x1="55" y1="52" x2="55" y2="60" stroke="#3A6B78" stroke-width="1"/><line x1="65" y1="52" x2="65" y2="60" stroke="#3A6B78" stroke-width="1"/><line x1="75" y1="52" x2="75" y2="60" stroke="#3A6B78" stroke-width="1"/><line x1="85" y1="52" x2="85" y2="60" stroke="#3A6B78" stroke-width="1"/><line x1="95" y1="52" x2="95" y2="60" stroke="#3A6B78" stroke-width="1"/>`,
  continua: `<line x1="10" y1="60" x2="60" y2="60" stroke="#201E43" stroke-width="2.5"/><line x1="60" y1="60" x2="110" y2="60" stroke="#201E43" stroke-width="2.5"/><polygon points="10,60 4,68 16,68" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="60" y1="64" x2="60" y2="68" stroke="#3A3A3A" stroke-width="1.5"/><line x1="56" y1="68" x2="64" y2="68" stroke="#3A3A3A" stroke-width="1.5"/><line x1="110" y1="64" x2="110" y2="68" stroke="#3A3A3A" stroke-width="1.5"/><line x1="106" y1="68" x2="114" y2="68" stroke="#3A3A3A" stroke-width="1.5"/><line x1="15" y1="52" x2="55" y2="52" stroke="#3A6B78" stroke-width="1.2"/><line x1="65" y1="52" x2="105" y2="52" stroke="#3A6B78" stroke-width="1.2"/>`,
  doble_voladizo: `<line x1="10" y1="60" x2="60" y2="60" stroke="#201E43" stroke-width="2.5"/><line x1="60" y1="60" x2="110" y2="60" stroke="#201E43" stroke-width="2.5"/><polygon points="10,60 4,68 16,68" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><polygon points="110,60 104,68 116,68" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="15" y1="52" x2="55" y2="52" stroke="#3A6B78" stroke-width="1.2"/><line x1="65" y1="52" x2="105" y2="52" stroke="#3A6B78" stroke-width="1.2"/>`,
  portico: `<line x1="20" y1="80" x2="20" y2="30" stroke="#201E43" stroke-width="2.5"/><line x1="20" y1="30" x2="100" y2="30" stroke="#201E43" stroke-width="2.5"/><line x1="100" y1="30" x2="100" y2="80" stroke="#201E43" stroke-width="2.5"/><line x1="20" y1="80" x2="26" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="20" y1="80" x2="14" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="20" y1="80" x2="20" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="100" y1="80" x2="106" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="100" y1="80" x2="94" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="100" y1="80" x2="100" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="25" y1="22" x2="95" y2="22" stroke="#3A6B78" stroke-width="1.2"/><line x1="25" y1="22" x2="25" y2="30" stroke="#3A6B78" stroke-width="1"/><line x1="35" y1="22" x2="35" y2="30" stroke="#3A6B78" stroke-width="1"/><line x1="45" y1="22" x2="45" y2="30" stroke="#3A6B78" stroke-width="1"/><line x1="55" y1="22" x2="55" y2="30" stroke="#3A6B78" stroke-width="1"/><line x1="65" y1="22" x2="65" y2="30" stroke="#3A6B78" stroke-width="1"/><line x1="75" y1="22" x2="75" y2="30" stroke="#3A6B78" stroke-width="1"/><line x1="85" y1="22" x2="85" y2="30" stroke="#3A6B78" stroke-width="1"/><line x1="95" y1="22" x2="95" y2="30" stroke="#3A6B78" stroke-width="1"/>`,
  portico2: `<line x1="15" y1="80" x2="15" y2="50" stroke="#201E43" stroke-width="2.5"/><line x1="15" y1="50" x2="15" y2="20" stroke="#201E43" stroke-width="2.5"/><line x1="15" y1="20" x2="85" y2="20" stroke="#201E43" stroke-width="2.5"/><line x1="85" y1="20" x2="85" y2="50" stroke="#201E43" stroke-width="2.5"/><line x1="85" y1="50" x2="85" y2="80" stroke="#201E43" stroke-width="2.5"/><line x1="15" y1="50" x2="85" y2="50" stroke="#201E43" stroke-width="2" stroke-dasharray="4 2"/><line x1="15" y1="80" x2="21" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="15" y1="80" x2="9" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="85" y1="80" x2="91" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="85" y1="80" x2="79" y2="86" stroke="#3A3A3A" stroke-width="1"/>`,
  dosaguas: `<line x1="15" y1="80" x2="15" y2="40" stroke="#201E43" stroke-width="2.5"/><line x1="15" y1="40" x2="55" y2="20" stroke="#201E43" stroke-width="2.5"/><line x1="55" y1="20" x2="95" y2="40" stroke="#201E43" stroke-width="2.5"/><line x1="95" y1="40" x2="95" y2="80" stroke="#201E43" stroke-width="2.5"/><line x1="15" y1="80" x2="21" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="15" y1="80" x2="9" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="95" y1="80" x2="101" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="95" y1="80" x2="89" y2="86" stroke="#3A3A3A" stroke-width="1"/>`,
  portico_ejercicio: `<line x1="20" y1="80" x2="20" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="20" y1="25" x2="90" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="90" y1="25" x2="90" y2="80" stroke="#201E43" stroke-width="2.5"/><polygon points="20,80 14,88 26,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="90" y1="84" x2="90" y2="88" stroke="#3A3A3A" stroke-width="1.5"/><line x1="86" y1="88" x2="94" y2="88" stroke="#3A3A3A" stroke-width="1.5"/><line x1="25" y1="17" x2="85" y2="17" stroke="#3A6B78" stroke-width="1.2"/><line x1="25" y1="17" x2="25" y2="25" stroke="#3A6B78" stroke-width="1"/><line x1="35" y1="17" x2="35" y2="25" stroke="#3A6B78" stroke-width="1"/><line x1="45" y1="17" x2="45" y2="25" stroke="#3A6B78" stroke-width="1"/><line x1="55" y1="17" x2="55" y2="25" stroke="#3A6B78" stroke-width="1"/><line x1="65" y1="17" x2="65" y2="25" stroke="#3A6B78" stroke-width="1"/><line x1="75" y1="17" x2="75" y2="25" stroke="#3A6B78" stroke-width="1"/><line x1="85" y1="17" x2="85" y2="25" stroke="#3A6B78" stroke-width="1"/><circle cx="20" cy="25" r="2.5" fill="#B23A2E"/><line x1="5" y1="25" x2="20" y2="25" stroke="#B23A2E" stroke-width="1.5"/><polygon points="20,25 13,22 13,28" fill="#B23A2E"/>`,
  arco: `<path d="M 20 80 Q 60 10 100 80" fill="none" stroke="#201E43" stroke-width="2.5"/><line x1="20" y1="80" x2="26" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="20" y1="80" x2="14" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="100" y1="80" x2="106" y2="86" stroke="#3A3A3A" stroke-width="1"/><line x1="100" y1="80" x2="94" y2="86" stroke="#3A3A3A" stroke-width="1"/><circle cx="60" cy="30" r="2.5" fill="#B23A2E"/><line x1="60" y1="42" x2="60" y2="30" stroke="#B23A2E" stroke-width="1.5"/><polygon points="60,30 56,36 64,36" fill="#B23A2E"/>`,
  cercha_simple: `<line x1="20" y1="70" x2="60" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="60" y1="25" x2="100" y2="70" stroke="#201E43" stroke-width="2.5"/><line x1="20" y1="70" x2="100" y2="70" stroke="#201E43" stroke-width="2.5"/><polygon points="20,70 14,78 26,78" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="100" y1="74" x2="100" y2="78" stroke="#3A3A3A" stroke-width="1.5"/><line x1="96" y1="78" x2="104" y2="78" stroke="#3A3A3A" stroke-width="1.5"/><circle cx="60" cy="25" r="2.5" fill="#B23A2E"/><line x1="60" y1="12" x2="60" y2="25" stroke="#B23A2E" stroke-width="1.5"/><polygon points="60,25 56,18 64,18" fill="#B23A2E"/>`,
  cercha_howe: `<line x1="10" y1="70" x2="60" y2="20" stroke="#201E43" stroke-width="2.5"/><line x1="60" y1="20" x2="110" y2="70" stroke="#201E43" stroke-width="2.5"/><line x1="10" y1="70" x2="110" y2="70" stroke="#201E43" stroke-width="2.5"/><line x1="30" y1="70" x2="30" y2="48" stroke="#201E43" stroke-width="1.8"/><line x1="45" y1="70" x2="45" y2="34" stroke="#201E43" stroke-width="1.8"/><line x1="60" y1="70" x2="60" y2="20" stroke="#201E43" stroke-width="1.8"/><line x1="75" y1="70" x2="75" y2="34" stroke="#201E43" stroke-width="1.8"/><line x1="90" y1="70" x2="90" y2="48" stroke="#201E43" stroke-width="1.8"/><polygon points="10,70 4,78 16,78" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="110" y1="74" x2="110" y2="78" stroke="#3A3A3A" stroke-width="1.5"/><line x1="106" y1="78" x2="114" y2="78" stroke="#3A3A3A" stroke-width="1.5"/>`,
  ejemplo: `<line x1="20" y1="80" x2="20" y2="30" stroke="#201E43" stroke-width="2.5"/><line x1="20" y1="30" x2="100" y2="30" stroke="#201E43" stroke-width="2.5"/><line x1="100" y1="30" x2="100" y2="80" stroke="#201E43" stroke-width="2.5"/><polygon points="20,80 14,88 26,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><polygon points="100,80 94,88 106,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><circle cx="20" cy="30" r="2.5" fill="#B23A2E"/><line x1="5" y1="30" x2="20" y2="30" stroke="#B23A2E" stroke-width="1.5"/><polygon points="20,30 13,27 13,33" fill="#B23A2E"/>`,
  portico_3tramos: `<line x1="10" y1="80" x2="10" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="10" y1="25" x2="43" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="43" y1="25" x2="76" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="76" y1="25" x2="110" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="110" y1="25" x2="110" y2="80" stroke="#201E43" stroke-width="2.5"/><polygon points="10,80 4,88 16,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><polygon points="110,80 104,88 116,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/>`,
  viga_con_voladizo: `<line x1="10" y1="55" x2="80" y2="55" stroke="#201E43" stroke-width="2.5"/><line x1="80" y1="55" x2="110" y2="55" stroke="#201E43" stroke-width="2.5"/><polygon points="10,55 4,63 16,63" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="80" y1="59" x2="80" y2="63" stroke="#3A3A3A" stroke-width="1.5"/><line x1="76" y1="63" x2="84" y2="63" stroke="#3A3A3A" stroke-width="1.5"/><line x1="15" y1="47" x2="75" y2="47" stroke="#3A6B78" stroke-width="1.2"/>`,
  empotrado_simple: `<line x1="20" y1="55" x2="100" y2="55" stroke="#201E43" stroke-width="2.5"/><polygon points="20,55 14,63 26,63" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="100" y1="59" x2="100" y2="63" stroke="#3A3A3A" stroke-width="1.5"/><line x1="96" y1="63" x2="104" y2="63" stroke="#3A3A3A" stroke-width="1.5"/><line x1="25" y1="47" x2="95" y2="47" stroke="#3A6B78" stroke-width="1.2"/><line x1="25" y1="47" x2="25" y2="55" stroke="#3A6B78" stroke-width="1"/><line x1="35" y1="47" x2="35" y2="55" stroke="#3A6B78" stroke-width="1"/><line x1="45" y1="47" x2="45" y2="55" stroke="#3A6B78" stroke-width="1"/><line x1="55" y1="47" x2="55" y2="55" stroke="#3A6B78" stroke-width="1"/><line x1="65" y1="47" x2="65" y2="55" stroke="#3A6B78" stroke-width="1"/><line x1="75" y1="47" x2="75" y2="55" stroke="#3A6B78" stroke-width="1"/><line x1="85" y1="47" x2="85" y2="55" stroke="#3A6B78" stroke-width="1"/>`,
  portico_arriostrado: `<line x1="15" y1="80" x2="15" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="15" y1="25" x2="100" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="100" y1="25" x2="100" y2="80" stroke="#201E43" stroke-width="2.5"/><line x1="15" y1="25" x2="57" y2="25" stroke="#201E43" stroke-width="1.8"/><line x1="57" y1="25" x2="100" y2="25" stroke="#201E43" stroke-width="1.8"/><line x1="15" y1="25" x2="57" y2="25" stroke="#201E43" stroke-width="1.5" stroke-dasharray="4 2"/><polygon points="15,80 9,88 21,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><polygon points="100,80 94,88 106,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/>`,
  marco_gableado: `<line x1="15" y1="80" x2="15" y2="35" stroke="#201E43" stroke-width="2.5"/><line x1="15" y1="35" x2="60" y2="15" stroke="#201E43" stroke-width="2.5"/><line x1="60" y1="15" x2="105" y2="35" stroke="#201E43" stroke-width="2.5"/><line x1="105" y1="35" x2="105" y2="80" stroke="#201E43" stroke-width="2.5"/><polygon points="15,80 9,88 21,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><polygon points="105,80 99,88 111,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/>`,
  marco_L: `<line x1="20" y1="80" x2="20" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="20" y1="25" x2="90" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="90" y1="25" x2="90" y2="80" stroke="#201E43" stroke-width="2.5"/><polygon points="20,80 14,88 26,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><polygon points="90,80 84,88 96,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><circle cx="90" cy="25" r="2.5" fill="#B23A2E"/><line x1="90" y1="12" x2="90" y2="25" stroke="#B23A2E" stroke-width="1.5"/><polygon points="90,25 86,18 94,18" fill="#B23A2E"/>`,
  viga_apoyada_3soportes: `<line x1="10" y1="55" x2="60" y2="55" stroke="#201E43" stroke-width="2.5"/><line x1="60" y1="55" x2="110" y2="55" stroke="#201E43" stroke-width="2.5"/><polygon points="10,55 4,63 16,63" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="60" y1="59" x2="60" y2="63" stroke="#3A3A3A" stroke-width="1.5"/><line x1="56" y1="63" x2="64" y2="63" stroke="#3A3A3A" stroke-width="1.5"/><line x1="110" y1="59" x2="110" y2="63" stroke="#3A3A3A" stroke-width="1.5"/><line x1="106" y1="63" x2="114" y2="63" stroke="#3A3A3A" stroke-width="1.5"/><line x1="15" y1="47" x2="55" y2="47" stroke="#3A6B78" stroke-width="1.2"/><line x1="65" y1="47" x2="105" y2="47" stroke="#3A6B78" stroke-width="1.2"/>`,
  cercha_pratt: `<line x1="10" y1="70" x2="60" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="60" y1="25" x2="110" y2="70" stroke="#201E43" stroke-width="2.5"/><line x1="10" y1="70" x2="110" y2="70" stroke="#201E43" stroke-width="2.5"/><line x1="30" y1="70" x2="38" y2="42" stroke="#201E43" stroke-width="1.5"/><line x1="50" y1="70" x2="55" y2="30" stroke="#201E43" stroke-width="1.5"/><line x1="70" y1="70" x2="65" y2="30" stroke="#201E43" stroke-width="1.5"/><line x1="90" y1="70" x2="82" y2="42" stroke="#201E43" stroke-width="1.5"/><polygon points="10,70 4,78 16,78" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="110" y1="74" x2="110" y2="78" stroke="#3A3A3A" stroke-width="1.5"/><line x1="106" y1="78" x2="114" y2="78" stroke="#3A3A3A" stroke-width="1.5"/>`,
  cercha_k: `<line x1="10" y1="70" x2="45" y2="30" stroke="#201E43" stroke-width="2.5"/><line x1="45" y1="30" x2="75" y2="30" stroke="#201E43" stroke-width="2.5"/><line x1="75" y1="30" x2="110" y2="70" stroke="#201E43" stroke-width="2.5"/><line x1="10" y1="70" x2="110" y2="70" stroke="#201E43" stroke-width="2.5"/><line x1="45" y1="30" x2="45" y2="70" stroke="#201E43" stroke-width="1.5"/><line x1="75" y1="30" x2="75" y2="70" stroke="#201E43" stroke-width="1.5"/><polygon points="10,70 4,78 16,78" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="110" y1="74" x2="110" y2="78" stroke="#3A3A3A" stroke-width="1.5"/><line x1="106" y1="78" x2="114" y2="78" stroke="#3A3A3A" stroke-width="1.5"/>`,
  viga_tres_puntos: `<line x1="20" y1="55" x2="100" y2="55" stroke="#201E43" stroke-width="2.5"/><polygon points="20,55 14,63 26,63" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="100" y1="59" x2="100" y2="63" stroke="#3A3A3A" stroke-width="1.5"/><line x1="96" y1="63" x2="104" y2="63" stroke="#3A3A3A" stroke-width="1.5"/><circle cx="40" cy="45" r="2.5" fill="#B23A2E"/><line x1="40" y1="35" x2="40" y2="45" stroke="#B23A2E" stroke-width="1.5"/><polygon points="40,45 36,38 44,38" fill="#B23A2E"/><circle cx="60" cy="42" r="2.5" fill="#B23A2E"/><line x1="60" y1="30" x2="60" y2="42" stroke="#B23A2E" stroke-width="1.5"/><polygon points="60,42 56,33 64,33" fill="#B23A2E"/><circle cx="80" cy="45" r="2.5" fill="#B23A2E"/><line x1="80" y1="35" x2="80" y2="45" stroke="#B23A2E" stroke-width="1.5"/><polygon points="80,45 76,38 84,38" fill="#B23A2E"/>`,
  viga_momentos: `<line x1="20" y1="55" x2="100" y2="55" stroke="#201E43" stroke-width="2.5"/><polygon points="20,55 14,63 26,63" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="100" y1="59" x2="100" y2="63" stroke="#3A3A3A" stroke-width="1.5"/><line x1="96" y1="63" x2="104" y2="63" stroke="#3A3A3A" stroke-width="1.5"/><path d="M 25 50 A 8 8 0 0 1 25 38" fill="none" stroke="#C77B30" stroke-width="1.5"/><polygon points="25,38 22,44 28,44" fill="#C77B30"/><path d="M 95 50 A 8 8 0 0 0 95 38" fill="none" stroke="#C77B30" stroke-width="1.5"/><polygon points="95,38 92,44 98,44" fill="#C77B30"/>`,
  portico_inclinado: `<line x1="15" y1="80" x2="15" y2="35" stroke="#201E43" stroke-width="2.5"/><line x1="15" y1="35" x2="100" y2="15" stroke="#201E43" stroke-width="2.5"/><line x1="100" y1="15" x2="100" y2="80" stroke="#201E43" stroke-width="2.5"/><polygon points="15,80 9,88 21,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><polygon points="100,80 94,88 106,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/>`,
  doble_portal: `<line x1="5" y1="80" x2="5" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="5" y1="25" x2="57" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="57" y1="25" x2="57" y2="80" stroke="#201E43" stroke-width="2.5"/><line x1="57" y1="25" x2="110" y2="25" stroke="#201E43" stroke-width="2.5"/><line x1="110" y1="25" x2="110" y2="80" stroke="#201E43" stroke-width="2.5"/><polygon points="5,80 -1,88 11,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><polygon points="57,80 51,88 63,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><polygon points="110,80 104,88 116,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/>`,
  voladizo_trapezoidal: `<line x1="20" y1="55" x2="100" y2="55" stroke="#201E43" stroke-width="2.5"/><polygon points="20,55 14,63 26,63" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="25" y1="42" x2="95" y2="49" stroke="#3A6B78" stroke-width="1.2"/><line x1="25" y1="42" x2="25" y2="55" stroke="#3A6B78" stroke-width="1"/><line x1="35" y1="43" x2="35" y2="55" stroke="#3A6B78" stroke-width="1"/><line x1="45" y1="44" x2="45" y2="55" stroke="#3A6B78" stroke-width="1"/><line x1="55" y1="45" x2="55" y2="55" stroke="#3A6B78" stroke-width="1"/><line x1="65" y1="46" x2="65" y2="55" stroke="#3A6B78" stroke-width="1"/><line x1="75" y1="47" x2="75" y2="55" stroke="#3A6B78" stroke-width="1"/><line x1="85" y1="48" x2="85" y2="55" stroke="#3A6B78" stroke-width="1"/><line x1="95" y1="49" x2="95" y2="55" stroke="#3A6B78" stroke-width="1"/>`,
  cercha_fink: `<line x1="10" y1="70" x2="60" y2="20" stroke="#201E43" stroke-width="2.5"/><line x1="60" y1="20" x2="110" y2="70" stroke="#201E43" stroke-width="2.5"/><line x1="10" y1="70" x2="110" y2="70" stroke="#201E43" stroke-width="2.5"/><line x1="35" y1="70" x2="42" y2="40" stroke="#201E43" stroke-width="1.5"/><line x1="78" y1="40" x2="85" y2="70" stroke="#201E43" stroke-width="1.5"/><line x1="42" y1="40" x2="78" y2="40" stroke="#201E43" stroke-width="1.5"/><polygon points="10,70 4,78 16,78" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><line x1="110" y1="74" x2="110" y2="78" stroke="#3A3A3A" stroke-width="1.5"/><line x1="106" y1="78" x2="114" y2="78" stroke="#3A3A3A" stroke-width="1.5"/>`,
  marco_2pisos_2tramos: `<line x1="5" y1="80" x2="5" y2="50" stroke="#201E43" stroke-width="2.5"/><line x1="5" y1="50" x2="5" y2="20" stroke="#201E43" stroke-width="2.5"/><line x1="5" y1="50" x2="57" y2="50" stroke="#201E43" stroke-width="2"/><line x1="5" y1="20" x2="57" y2="20" stroke="#201E43" stroke-width="2"/><line x1="57" y1="80" x2="57" y2="50" stroke="#201E43" stroke-width="2.5"/><line x1="57" y1="50" x2="57" y2="20" stroke="#201E43" stroke-width="2.5"/><line x1="57" y1="50" x2="110" y2="50" stroke="#201E43" stroke-width="2"/><line x1="57" y1="20" x2="110" y2="20" stroke="#201E43" stroke-width="2"/><line x1="110" y1="80" x2="110" y2="50" stroke="#201E43" stroke-width="2.5"/><line x1="110" y1="50" x2="110" y2="20" stroke="#201E43" stroke-width="2.5"/><polygon points="5,80 -1,88 11,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><polygon points="57,80 51,88 63,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/><polygon points="110,80 104,88 116,88" fill="none" stroke="#3A3A3A" stroke-width="1.2"/>`,
};

const TPL_NAMES = {
  voladizo:"Voladizo", simple:"Viga simplemente apoyada", continua:"Viga continua",
  doble_voladizo:"Viga doble voladizo", portico:"Pórtico simple", portico2:"Pórtico 2 niveles",
  dosaguas:"Pórtico a dos aguas", portico_ejercicio:"Pórtico ejercicio",
  arco:"Arco de medio punto", cercha_simple:"Cercha simple", cercha_howe:"Cercha Howe",
  ejemplo:"Ejemplo: Pórtico", portico_3tramos:"Pórtico 3 tramos",
  viga_con_voladizo:"Viga con voladizo", empotrado_simple:"Empotrado-simple",
  portico_arriostrado:"Pórtico arriostrado", marco_gableado:"Marco gableado",
  marco_L:"Marco en L", viga_apoyada_3soportes:"Viga 3 apoyos",
  cercha_pratt:"Cercha Pratt", cercha_k:"Cercha K",
  viga_tres_puntos:"3 cargas puntuales", viga_momentos:"Viga con momentos",
  portico_inclinado:"Pórtico inclinado", doble_portal:"Doble pórtico",
  voladizo_trapezoidal:"Voladizo trapezoidal", cercha_fink:"Cercha Fink",
  marco_2pisos_2tramos:"Marco 2×2",
};

const TPL_CATEGORIES = {
  vigas:["voladizo","simple","continua","doble_voladizo","viga_con_voladizo",
         "empotrado_simple","viga_apoyada_3soportes","viga_tres_puntos",
         "viga_momentos","voladizo_trapezoidal"],
  porticos:["portico","portico2","dosaguas","portico_ejercicio","ejemplo",
            "portico_3tramos","portico_arriostrado","marco_gableado","marco_L",
            "portico_inclinado","doble_portal","marco_2pisos_2tramos"],
  cerchas:["cercha_simple","cercha_howe","cercha_pratt","cercha_k","cercha_fink"],
  arcos:["arco"],
};

let _tplActiveCat = "todas";
let _tplSearchQuery = "";

function _generarSvgPlantilla(modelo, w, h){
  w=w||120; h=h||90;
  const nudos=modelo.nudos||[], elems=modelo.elementos||[];
  if(!nudos.length) return `<rect x="10" y="10" width="${w-20}" height="${h-20}" rx="4" fill="#F7FAFA" stroke="#CBDDE1" stroke-width="1"/>`;
  const xs=nudos.map(n=>typeof n.x==="number"?n.x:parseFloat(n.x)||0);
  const ys=nudos.map(n=>typeof n.y==="number"?n.y:parseFloat(n.y)||0);
  const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
  const spanX=(maxX-minX)||1, spanY=(maxY-minY)||1;
  const pad=12, sx=(w-2*pad)/spanX, sy=(h-2*pad)/spanY, sc=Math.min(sx,sy);
  const ox=pad+(w-2*pad-spanX*sc)/2, oy=pad+(h-2*pad-spanY*sc)/2;
  const px=x=>(x-minX)*sc+ox, py=y=>h-((y-minY)*sc+oy);
  let svg=`<rect x="2" y="2" width="${w-4}" height="${h-4}" rx="4" fill="#FAFCFD" stroke="#D8DCE4" stroke-width="0.8"/>`;
  elems.forEach(e=>{
    const ni=nudos.find(n=>n.id===e.i), nj=nudos.find(n=>n.id===e.j);
    if(!ni||!nj) return;
    svg+=`<line x1="${px(ni.x)}" y1="${py(ni.y)}" x2="${px(nj.x)}" y2="${py(nj.y)}" stroke="#201E43" stroke-width="2" stroke-linecap="round"/>`;
  });
  nudos.forEach(n=>{
    const r=(n.apoyo&&n.apoyo!=="libre")?3:2;
    svg+=`<circle cx="${px(n.x)}" cy="${py(n.y)}" r="${r}" fill="#201E43"/>`;
    if(n.apoyo==="empotrado"){
      const nx=px(n.x), ny=py(n.y);
      svg+=`<line x1="${nx-5}" y1="${ny}" x2="${nx+5}" y2="${ny}" stroke="#3A6B78" stroke-width="1.5"/>`;
      for(let k=-4;k<=4;k+=2) svg+=`<line x1="${nx+k}" y1="${ny}" x2="${nx+k-2}" y2="${ny+4}" stroke="#3A6B78" stroke-width="0.7"/>`;
    } else if(n.apoyo==="articulado"||n.apoyo==="fijo"){
      const nx=px(n.x), ny=py(n.y);
      svg+=`<polygon points="${nx},${ny} ${nx-4},${ny+6} ${nx+4},${ny+6}" fill="none" stroke="#3A6B78" stroke-width="1"/>`;
    } else if(n.apoyo==="rodillo_y"||n.apoyo==="rodillo_x"){
      const nx=px(n.x), ny=py(n.y);
      svg+=`<polygon points="${nx},${ny} ${nx-4},${ny+5} ${nx+4},${ny+5}" fill="none" stroke="#3A6B78" stroke-width="1"/>`;
      svg+=`<line x1="${nx-5}" y1="${ny+7}" x2="${nx+5}" y2="${ny+7}" stroke="#3A6B78" stroke-width="1"/>`;
    }
  });
  return svg;
}

function _clasificarPlantilla(modelo){
  const nudos=modelo.nudos||[], elems=modelo.elementos||[];
  const apoyos=nudos.filter(n=>n.apoyo&&n.apoyo!=="libre");
  const todosLibres=nudos.every(n=>!n.apoyo||n.apoyo==="libre");
  if(todosLibres||apoyos.length===0) return "porticos";
  const hasVertical=elems.some(e=>{
    const ni=nudos.find(n=>n.id===e.i), nj=nudos.find(n=>n.id===e.j);
    if(!ni||!nj) return false;
    const dx=(typeof nj.x==="number"?nj.x:0)-(typeof ni.x==="number"?ni.x:0);
    const dy=(typeof nj.y==="number"?nj.y:0)-(typeof ni.y==="number"?ni.y:0);
    return Math.abs(dy)>Math.abs(dx)*1.5;
  });
  const allOnLine=Math.abs(ys=>{const yy=nudos.map(n=>typeof n.y==="number"?n.y:0);return Math.max(...yy)-Math.min(...yy);})()<0.01;
  const ys=nudos.map(n=>typeof n.y==="number"?n.y:0);
  const sameY=Math.max(...ys)-Math.min(...ys)<0.01;
  if(sameY) return "vigas";
  if(hasVertical) return "porticos";
  return "porticos";
}

function renderTemplateGallery(){
  const grid = $("#template-grid"); if(!grid) return;
  const search = (_tplSearchQuery||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const custom = _getCustomTemplates();
  const customKeys = Object.keys(custom);
  const showBuiltIn = _tplActiveCat !== "mis";
  const showCustom = _tplActiveCat === "todas" || _tplActiveCat === "mis";
  // filter built-in templates
  let builtInKeys = showBuiltIn ? Object.keys(TPL_SVG) : [];
  if(showBuiltIn && _tplActiveCat !== "todas"){
    builtInKeys = builtInKeys.filter(k=> (TPL_CATEGORIES[_tplActiveCat]||[]).includes(k));
  }
  if(search && showBuiltIn){
    builtInKeys = builtInKeys.filter(k=>{
      const name = (TPL_NAMES[k]||k).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
      return name.includes(search);
    });
  }
  const builtIn = builtInKeys.map(key=>
    `<div class="template-card" data-tpl="${key}">
      <svg viewBox="0 0 120 90" xmlns="http://www.w3.org/2000/svg">${TPL_SVG[key]}</svg>
      <span class="template-card-name">${esc(TPL_NAMES[key]||key)}</span>
    </div>`
  ).join("");
  // custom templates
  let customHtml = "";
  if(showCustom){
    let filteredCustom = customKeys;
    if(_tplActiveCat !== "todas" && _tplActiveCat !== "mis"){
      filteredCustom = customKeys.filter(k=> (custom[k].cat||"porticos") === _tplActiveCat);
    }
    if(search){
      filteredCustom = filteredCustom.filter(k=>{
        const name = (custom[k].nombre||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
        return name.includes(search);
      });
    }
    if(filteredCustom.length > 0){
      const sepLabel = _tplActiveCat === "mis" ? "Mis plantillas" : "Mis " + _tplActiveCat;
      customHtml = `<div class="tpl-custom-sep">${esc(sepLabel)}</div>` +
        filteredCustom.map(key=>{
          const t = custom[key];
          const svgContent = t.svg || _generarSvgPlantilla(t.modelo||{});
          return `<div class="template-card-wrap">
            <button class="template-card-del" data-del-tpl="${key}" title="Eliminar plantilla">✕</button>
            <div class="template-card template-card--custom" data-tpl-custom="${key}">
              <svg viewBox="0 0 120 90" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>
              <span class="template-card-name">${esc(t.nombre)}</span>
            </div>
          </div>`;
        }).join("");
    }
  }
  // empty state
  if(!builtIn && !customHtml){
    grid.innerHTML = `<div class="tpl-empty"><div class="tpl-empty-icon">🔍</div>No se encontraron plantillas</div>`;
  } else {
    grid.innerHTML = (builtIn||"") + customHtml;
  }
  // click handlers
  grid.onclick = (e)=>{
    const delBtn = e.target.closest("[data-del-tpl]");
    if(delBtn){ e.stopPropagation(); eliminarPlantillaCustom(delBtn.dataset.delTpl); return; }
    const cardCustom = e.target.closest("[data-tpl-custom]");
    if(cardCustom){ cargarPlantillaCustom(cardCustom.dataset.tplCustom); return; }
    const card = e.target.closest("[data-tpl]");
    if(card){ cargarPlantilla(card.dataset.tpl); }
  };
}

function cargarPlantilla(key){
  const f = PLANTILLAS[key]; if(!f) return;
  pushUndo();
  cargarModeloEnEditor(f()); setVista("modelo");
  const panel = $("#tpl-panel"); if(panel) panel.classList.add("hidden");
  toast("Plantilla: " + (TPL_NAMES[key]||key), "ok");
}

/* ============================================================
   PLANTILLAS PERSONALIZADAS (localStorage)
   ============================================================ */
function _getCustomTemplates(){
  try { return JSON.parse(localStorage.getItem("tpl_custom") || "{}"); }
  catch(e){ return {}; }
}
function _saveCustomTemplates(tpls){
  localStorage.setItem("tpl_custom", JSON.stringify(tpls));
}
function guardarPlantillaCustom(){
  if(!state.modelo || (!state.modelo.nudos.length && !state.modelo.elementos.length)){
    toast("No hay modelo que guardar.","err"); return;
  }
  const nombre = prompt("Nombre de la plantilla:", state.modelo.nombre || "Mi plantilla");
  if(!nombre || !nombre.trim()) return;
  const key = "custom_" + Date.now();
  const modelo = JSON.parse(JSON.stringify(state.modelo));
  modelo.nombre = nombre.trim();
  const svg = _generarSvgPlantilla(modelo);
  const cat = _clasificarPlantilla(modelo);
  const tpls = _getCustomTemplates();
  tpls[key] = { nombre: nombre.trim(), modelo: modelo, svg: svg, cat: cat };
  _saveCustomTemplates(tpls);
  renderTemplateGallery();
  toast("Plantilla guardada: " + nombre.trim(), "ok");
}
function eliminarPlantillaCustom(key){
  const tpls = _getCustomTemplates();
  if(!tpls[key]) return;
  if(!confirm('Eliminar plantilla "' + tpls[key].nombre + '"?')) return;
  delete tpls[key];
  _saveCustomTemplates(tpls);
  renderTemplateGallery();
  toast("Plantilla eliminada.","ok");
}
function cargarPlantillaCustom(key){
  const tpls = _getCustomTemplates();
  const tpl = tpls[key]; if(!tpl) return;
  pushUndo();
  cargarModeloEnEditor(JSON.parse(JSON.stringify(tpl.modelo)));
  setVista("modelo");
  const panel = $("#tpl-panel"); if(panel) panel.classList.add("hidden");
  toast("Plantilla: " + tpl.nombre, "ok");
}

/* ============================================================
   EXPORTAR / IMPORTAR
   ============================================================ */
function descargar(nombre, contenido, tipo){
  const blob = new Blob([contenido], {type:tipo});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}
function exportarProyecto(){
  const nom = (state.modelo.nombre||"portico").replace(/\s+/g,"_");
  const m = JSON.parse(JSON.stringify(state.modelo));
  if (m.cargas_elementos) m.cargas_elementos.forEach(c=>{
    const e = m.elementos.find(x=>x.id==c.elem); if(!e) return;
    const un = elemUnit(c, m); if(!un) return;
    const cx=un.cx, cy=un.cy;
    if (c.tipo==="distribuida"){
      const g = cargaDistGlobal(c, cx, cy);
      if (c.subtipo==="trapezoidal"){ c.wx1=g.wx1; c.wy1=g.wy1; c.wx2=g.wx2; c.wy2=g.wy2; }
      else { c.wx=g.wx1; c.wy=g.wy1; }
    } else if (c.tipo==="puntual"){
      const g = cargaPuntGlobal(c, cx, cy);
      c.Px=g.Px; c.Py=g.Py;
    }
  });
  if (m.cargas_nodales) m.cargas_nodales.forEach(c=>{
    if ((c.modo||"comp")==="ang"){
      const mag=num(c.mag||0), ang=num(c.ang||0)*Math.PI/180;
      c.Fx=mag*Math.cos(ang); c.Fy=mag*Math.sin(ang);
    }
  });
  descargar(nom+".json", JSON.stringify(m, null, 2), "application/json");
  toast("Proyecto exportado (.json).","ok");
}
function importarProyecto(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const m = JSON.parse(reader.result);
      if(!m.nudos||!m.elementos||!m.secciones) throw new Error("formato");
      pushUndo();
      cargarModeloEnEditor(m); setVista("modelo"); toast("Proyecto importado.","ok");
    }catch(e){ toast("Archivo no válido.","err"); }
  };
  reader.readAsText(file);
}
function exportarMemoria(){
  const d = state._lastData;
  if(!d||!d.reporte){ toast("Primero calcula la estructura.","err"); return; }
  const nom = (d.nombre||"memoria").replace(/\s+/g,"_");
  descargar(nom+"_memoria.txt", d.reporte, "text/plain;charset=utf-8");
  toast("Memoria exportada (.txt).","ok");
}
function exportarCSV(){
  const d = state._lastData;
  if(!d){ toast("Primero calcula la estructura.","err"); return; }
  const r = d.resultados; const L=[];
  L.push("DESPLAZAMIENTOS"); L.push("Nudo,ux,uy,giro");
  r.desplazamientos.forEach(x=>L.push(`${x.nudo},${x.ux},${x.uy},${x.giro}`));
  L.push(""); L.push("REACCIONES"); L.push("Nudo,Rx,Ry,M");
  r.reacciones.forEach(x=>L.push(`${x.nudo},${x.Rx},${x.Ry},${x.M}`));
  L.push(""); L.push("FUERZAS EN EXTREMOS");
  L.push("Elem,Ni,Vi,Mi,Nj,Vj,Mj,Mmax,Vmax");
  r.fuerzas.forEach(x=>L.push(`${x.elem},${x.Ni},${x.Vi},${x.Mi},${x.Nj},${x.Vj},${x.Mj},${x.Mmax},${x.Vmax}`));
  const nom = (d.nombre||"resultados").replace(/\s+/g,"_");
  descargar(nom+".csv", L.join("\n"), "text/csv;charset=utf-8");
  toast("Tablas exportadas (.csv).","ok");
}

/* ============================================================
   HISTORIAL
   ============================================================ */
async function cargarHistorial(){
  try{
    const resp = await API.historial();
    const allData = resp.items || resp || [];
    const q = ($("#hist-search")?.value || "").toLowerCase().trim();
    const data = q ? allData.filter(h => (h.nombre||"").toLowerCase().includes(q)) : allData;
    const cont = $("#historial-cont");
    if (!data.length){ cont.innerHTML = `<div class="empty"><div class="empty-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div><h3>Sin cálculos</h3><p>Realiza un cálculo y aparecerá aquí.</p></div>`; return; }
    cont.innerHTML = data.map(h=>{
      const modelo = h.modelo || {};
      const miniSvg = `<svg viewBox="0 0 120 90" xmlns="http://www.w3.org/2000/svg">${_generarSvgPlantilla(modelo, 120, 90)}</svg>`;
      return `
      <div class="hist-card" data-hid="${h.id}">
        <span class="card-accent"></span>
        <div class="hist-mini-svg">${miniSvg}</div>
        <div class="hist-top">
          <div><div class="hist-name">${esc(h.nombre)}</div><div class="hist-date">${h.fecha}</div></div>
        </div>
        <div class="hist-kpis">
          <div><div class="hist-kpi-l">Máx</div><div class="hist-kpi-v">${fmtF(h.resumen?.Mmax||0,2)}</div></div>
          <div><div class="hist-kpi-l">V Máx</div><div class="hist-kpi-v">${fmtF(h.resumen?.Vmax||0,2)}</div></div>
          <div><div class="hist-kpi-l">Despl.</div><div class="hist-kpi-v">${fmtD(h.resumen?.umax||0)}</div></div>
        </div>
        <div class="hist-actions">
          <button class="btn btn-secondary btn-sm" data-hload="${h.id}">Ver</button>
          <button class="btn btn-danger btn-sm" data-hdel="${h.id}">Eliminar</button>
        </div>
      </div>`;
    }).join("");
    cont.querySelectorAll("[data-hload]").forEach(b=>b.addEventListener("click", async (e)=>{
      e.stopPropagation();
      try{ const data = await API.histItem(b.dataset.hload); state.resultado = data; renderResultados(data); setVista("resultados"); }
      catch(_){ toast("No se pudo cargar.","err"); }
    }));
    cont.querySelectorAll("[data-hdel]").forEach(b=>b.addEventListener("click", async (e)=>{
      e.stopPropagation();
      if (!confirm("¿Eliminar este cálculo?")) return;
      await API.histDel(b.dataset.hdel); cargarHistorial(); toast("Eliminado.","ok");
    }));
  }catch(e){ toast("Error al cargar historial.","err"); }
}

/* ============================================================
   KEYBOARD SHORTCUTS
   ============================================================ */
function bindKeyboard(){
  document.addEventListener("keydown", (e)=>{
    if (e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT") return;
    if (e.ctrlKey && e.key==="z"){ e.preventDefault(); undo(); }
    else if (e.ctrlKey && e.shiftKey && (e.key==="Z"||e.key==="z")){ e.preventDefault(); redo(); }
    else if (e.ctrlKey && e.key==="y"){ e.preventDefault(); redo(); }
    else if (e.ctrlKey && e.key==="Enter"){ e.preventDefault(); calcular(); }
    else if (e.ctrlKey && e.key==="s"){ e.preventDefault(); exportarProyecto(); }
    else if (e.key==="1"){ setVista("modelo"); }
    else if (e.key==="2"){ setVista("resultados"); }
    else if (e.key==="3"){ setVista("combinaciones"); }
    else if (e.key==="4"){ setVista("historial"); }
    else if (e.key==="?" || (e.shiftKey && e.key==="/")){
      e.preventDefault();
      toast("<b>Atajos:</b> Ctrl+Z deshacer · Ctrl+Shift+Z rehacer · Ctrl+Enter calcular · Ctrl+S exportar · 1-4 cambiar vista · Shift+arrastrar mover vista", "ok", 6000);
    }
  });
}

/* ============================================================
   SELECCIÓN DE OBJETOS + INSPECTOR CONTEXTUAL
   ============================================================ */
function selectObject(type, idx){
  state.selected = { type, idx };
  renderInspector();
  drawPreview();
  // Panel de propiedades siempre visible, solo actualizar contenido
  const ss = $("#status-sel");
  if (ss){
    if (type==="nudo" && idx!=null){
      const n = state.modelo.nudos[idx];
      ss.textContent = `Nudo ${esc(n.nombre||("N"+n.id))} seleccionado`;
    } else if (type==="elemento" && idx!=null){
      const e = state.modelo.elementos[idx];
      ss.textContent = `Elem ${esc(e.nombre||("E"+e.id))} · ${e.seccion||""}`;
    } else {
      ss.textContent = "";
    }
  }
}

// Resumen del modelo para el panel cuando no hay selección (estilo ETABS).
function renderPropsResumen(){
  const m = state.modelo; if(!m) return "";
  const u = getUnidad();
  const nCargas = (m.cargas_nodales||[]).length + (m.cargas_elementos||[]).length;
  const chip = (lbl,val)=>`<div class="props-info-chip"><strong>${val}</strong> ${lbl}</div>`;
  const opts = [];
  if (m.despreciar_axial) opts.push("Sin axial");
  if (m.peso_propio) opts.push("Peso propio");
  if (m.timoshenko) opts.push("Timoshenko");
  if (m.pdelta) opts.push("P-Δ");
  if (m.analisis_modal) opts.push("Modal");
  const vacio = (m.nudos||[]).length===0;
  return `
    <div class="props-section">
      <div class="props-section-title">Proyecto</div>
      <div class="props-field"><label>Nombre</label><span class="props-value">${esc(m.nombre||"—")}</span></div>
      <div class="props-field"><label>Unidades</label><span class="props-value">${u.fuerza} · ${u.longitud}</span></div>
    </div>
    <div class="props-section">
      <div class="props-section-title">Modelo</div>
      <div class="props-info">
        ${chip("nudos",(m.nudos||[]).length)}
        ${chip("elementos",(m.elementos||[]).length)}
        ${chip("secciones",(m.secciones||[]).length)}
        ${chip("cargas",nCargas)}
      </div>
    </div>
    ${opts.length?`<div class="props-section">
      <div class="props-section-title">Opciones</div>
      <div class="props-info">${opts.map(o=>`<div class="props-info-chip">${o}</div>`).join("")}</div>
    </div>`:""}
    <div class="props-empty" style="padding:var(--sp5) var(--sp3)">
      <p class="hint">${vacio
        ? "Agrega nudos y elementos en el paso <strong>Modelar</strong>."
        : "Selecciona un <strong>nudo</strong> o <strong>elemento</strong> en el lienzo (modo Mover) para editar sus propiedades."}</p>
    </div>`;
}

function renderInspector(){
  const { type, idx } = state.selected;
  const body = $("#inspector-body");
  const hint = $("#inspector-hint");
  const subtitle = $("#props-subtitle");
  if (!body) return;

  if (!type || idx == null){
    if (hint) hint.textContent = "Modelo";
    if (subtitle) subtitle.textContent = "Resumen general";
    body.innerHTML = renderPropsResumen();
    return;
  }

  if (type === "nudo"){
    const n = state.modelo.nudos[idx];
    if (!n) return;
    if (hint) hint.textContent = `Nudo ${n.nombre || ("N"+n.id)}`;
    if (subtitle) subtitle.textContent = "Propiedades del nudo";
    body.innerHTML = renderPropsNudo(n, idx);
  } else if (type === "elemento"){
    const e = state.modelo.elementos[idx];
    if (!e) return;
    if (hint) hint.textContent = `Elemento ${e.nombre || ("E"+e.id)}`;
    if (subtitle) subtitle.textContent = "Propiedades del elemento";
    body.innerHTML = renderPropsElemento(e, idx);
  }
  bindInspectorEvents();
}

function renderPropsNudo(n, idx){
  const apoyo_opts = APOYOS.map(([v,l])=>
    `<option value="${v}" ${n.apoyo===v?"selected":""}>${l}</option>`).join("");
  const res = n.resorte||{}, ase = n.asentamiento||{};
  const u = getUnidad();
  const nf = (lbl,sub,field,val)=>
    `<div class="props-field"><label>${lbl}</label><input type="number" step="any" value="${val??""}" class="insp-inp" data-insp-coll="nudos" data-insp-idx="${idx}" data-insp-sub="${sub}" data-insp-field="${field}"></div>`;
  return `
    <div class="props-info">
      <span class="props-info-chip">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/></svg>
        Nudo · <strong>${esc(n.nombre||("N"+n.id))}</strong>
      </span>
    </div>

    <div class="props-section">
      <div class="props-section-title">Geometría</div>
      <div class="props-field">
        <label>Nombre</label>
        <input type="text" value="${esc(n.nombre||("N"+n.id))}" class="insp-inp" data-insp-coll="nudos" data-insp-idx="${idx}" data-insp-field="nombre">
      </div>
      <div class="props-field-row">
        <div class="props-field">
          <label>X (${u.longitud})</label>
          <input type="number" step="any" value="${n.x??""}" class="insp-inp" data-insp-coll="nudos" data-insp-idx="${idx}" data-insp-field="x">
        </div>
        <div class="props-field">
          <label>Y (${u.longitud})</label>
          <input type="number" step="any" value="${n.y??""}" class="insp-inp" data-insp-coll="nudos" data-insp-idx="${idx}" data-insp-field="y">
        </div>
      </div>
      <div class="props-field">
        <label>Apoyo</label>
        <select class="insp-inp" data-insp-coll="nudos" data-insp-idx="${idx}" data-insp-field="apoyo">${apoyo_opts}</select>
      </div>
    </div>

    <div class="props-section">
      <div class="props-section-title">Apoyo elástico (resorte)</div>
      <div class="props-field-row">
        ${nf("kx (tonf/m)","resorte","kx",res.kx)}
        ${nf("ky (tonf/m)","resorte","ky",res.ky)}
      </div>
      <div class="props-field">
        ${nf("kθ (tonf·m/rad)","resorte","kg",res.kg)}
      </div>
    </div>

    <div class="props-section">
      <div class="props-section-title">Asentamiento impuesto</div>
      <div class="props-field-row">
        ${nf(`dx (${u.longitud})`,"asentamiento","dx",ase.dx)}
        ${nf(`dy (${u.longitud})`,"asentamiento","dy",ase.dy)}
      </div>
      <div class="props-field">
        ${nf("giro (rad)","asentamiento","giro",ase.giro)}
      </div>
    </div>

    <div class="props-section">
      <div class="props-section-title">Cargas en este nudo</div>
      ${renderPropsCargasNudo(n.id)}
      <button class="btn btn-secondary btn-sm" data-insp-add-carga-nudo="${n.id}" style="width:100%;margin-top:var(--sp3)">+ Agregar carga nodal</button>
    </div>

    <div class="props-delete">
      <button class="btn btn-danger btn-sm" data-delete-nudo="${idx}">Eliminar nudo</button>
    </div>
  `;
}

function renderPropsCargasNudo(nudoId){
  const cargas = (state.modelo.cargas_nodales||[]).filter(c=>+c.nudo===+nudoId);
  if (!cargas.length) return `<p class="hint" style="margin-top:var(--sp2)">Sin cargas asignadas.</p>`;
  const u = getUnidad();
  return `<div class="props-carga-list">${cargas.map((c,i)=>{
    const Fx=num(c.Fx||0), Fy=num(c.Fy||0), M=num(c.M||0);
    return `<div class="props-carga-row">
      <span class="props-carga-type">Nodal</span>
      <span class="props-carga-val">Fx=${Fx.toFixed(2)} · Fy=${Fy.toFixed(2)} · M=${M.toFixed(2)} ${u.fuerza}</span>
    </div>`;
  }).join("")}</div>`;
}

function renderPropsElemento(e, idx){
  const secOpts = state.modelo.secciones.map(s=>
    `<option value="${esc(s.nombre)}" ${s.nombre===e.seccion?"selected":""}>${esc(s.nombre)}</option>`).join("");
  const matOpts = `<option value="" ${!e.material?"selected":""}>Global</option>` +
    (state.modelo.materiales||[]).map(m=>
      `<option value="${esc(m.nombre)}" ${m.nombre===e.material?"selected":""}>${esc(m.nombre)}</option>`).join("");
  const ni = state.modelo.nudos.find(n=>n.id===+e.i), nj = state.modelo.nudos.find(n=>n.id===+e.j);
  const L = (ni&&nj) ? Math.hypot(num(nj.x)-num(ni.x), num(nj.y)-num(ni.y)).toFixed(3) : "—";
  const u = getUnidad();
  return `
    <div class="props-info">
      <span class="props-info-chip">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="12" x2="21" y2="12"/></svg>
        Elemento · <strong>L = ${L} ${u.longitud}</strong>
      </span>
    </div>

    <div class="props-section">
      <div class="props-section-title">Identificación</div>
      <div class="props-field">
        <label>Nombre</label>
        <input type="text" value="${esc(e.nombre||("E"+e.id))}" class="insp-inp" data-insp-coll="elementos" data-insp-idx="${idx}" data-insp-field="nombre">
      </div>
      <div class="props-field-row">
        <div class="props-field">
          <label>Nudo i</label>
          <span class="props-value">${esc(e.i)}</span>
        </div>
        <div class="props-field">
          <label>Nudo j</label>
          <span class="props-value">${esc(e.j)}</span>
        </div>
      </div>
    </div>

    <div class="props-section">
      <div class="props-section-title">Sección y material</div>
      <div class="props-field">
        <label>Sección</label>
        <select class="insp-inp" data-insp-coll="elementos" data-insp-idx="${idx}" data-insp-field="seccion">${secOpts}</select>
      </div>
      <div class="props-field">
        <label>Material</label>
        <select class="insp-inp" data-insp-coll="elementos" data-insp-idx="${idx}" data-insp-field="material">${matOpts}</select>
      </div>
    </div>

    <div class="props-section">
      <div class="props-section-title">Rótulas (liberaciones)</div>
      <div class="props-field-row">
        <div class="props-field" style="display:flex;align-items:center;gap:var(--sp2)">
          <input type="checkbox" ${e.release_i?"checked":""} class="insp-inp" data-insp-coll="elementos" data-insp-idx="${idx}" data-insp-field="release_i" style="width:16px;height:16px">
          <label style="margin:0">Rótula i</label>
        </div>
        <div class="props-field" style="display:flex;align-items:center;gap:var(--sp2)">
          <input type="checkbox" ${e.release_j?"checked":""} class="insp-inp" data-insp-coll="elementos" data-insp-idx="${idx}" data-insp-field="release_j" style="width:16px;height:16px">
          <label style="margin:0">Rótula j</label>
        </div>
      </div>
    </div>

    <div class="props-section">
      <div class="props-section-title">Cargas en este elemento</div>
      ${renderPropsCargasElem(e.id)}
      <button class="btn btn-secondary btn-sm" data-insp-add-carga-elem="${e.id}" style="width:100%;margin-top:var(--sp3)">+ Agregar carga en elemento</button>
    </div>

    <div class="props-delete">
      <button class="btn btn-danger btn-sm" data-delete-elemento="${idx}">Eliminar elemento</button>
    </div>
  `;
}

function renderPropsCargasElem(elemId){
  const cargas = (state.modelo.cargas_elementos||[]).filter(c=>+c.elem===+elemId);
  if (!cargas.length) return `<p class="hint" style="margin-top:var(--sp2)">Sin cargas asignadas.</p>`;
  const u = getUnidad();
  const m = state.modelo;
  return `<div class="props-carga-list">${cargas.map((c,i)=>{
    let lbl = "", tag = c.tipo||"carga";
    const un = elemUnit(c, m);
    if (c.tipo==="distribuida"){
      const g = un ? cargaDistGlobal(c, un.cx, un.cy) : {wx1:0,wy1:0,wx2:0,wy2:0};
      const m1=Math.hypot(g.wx1,g.wy1), m2=Math.hypot(g.wx2,g.wy2);
      lbl = (Math.abs(m1-m2)<1e-9 ? fnum(m1) : `${fnum(m1)}~${fnum(m2)}`) + ` ${u.cargad} ${globGlyph(g.wx1||g.wx2,g.wy1||g.wy2)}`;
      tag = c.subtipo==="trapezoidal" ? "distrib. trap." : "distribuida";
    } else if (c.tipo==="puntual"){
      const g = un ? cargaPuntGlobal(c, un.cx, un.cy) : {Px:0,Py:0};
      lbl = `${fnum(Math.hypot(g.Px,g.Py))} ${u.fuerza} ${globGlyph(g.Px,g.Py)}`;
    } else if (c.tipo==="momento"){
      lbl = `${fnum(num(c.M))} ${u.momentof} ${num(c.M)>=0?"↺":"↻"}`;
    }
    return `<div class="props-carga-row">
      <span class="props-carga-type">${tag}</span>
      <span class="props-carga-val">${lbl}</span>
    </div>`;
  }).join("")}</div>`;
}

function bindInspectorEvents(){
  const body = $("#inspector-body"); if(!body) return;

  body.addEventListener("input", (e)=>{
    const el = e.target.closest("[data-insp-coll]"); if(!el) return;
    pushUndo();
    const coll = el.dataset.inspColl, idx = +el.dataset.inspIdx;
    const field = el.dataset.inspField, sub = el.dataset.inspSub;
    const item = state.modelo[coll][idx]; if(!item) return;
    let val = el.type==="checkbox" ? el.checked : (el.type==="number" ? el.value : el.value);
    if (["x","y"].includes(field)) { val = parseFloat(val)||0; }
    if (sub && sub!=="undefined" && sub){ item[sub]=item[sub]||{}; item[sub][field]=val; }
    else { item[field]=val; }
    scheduleAutoSave(); drawPreview();
    if (coll==="nudos") syncNodeInputs(idx);
    renderEditor();
  }, { capture:false });

  body.addEventListener("change", (e)=>{
    const el = e.target.closest("[data-insp-coll]"); if(!el) return;
    pushUndo();
    const coll = el.dataset.inspColl, idx = +el.dataset.inspIdx;
    const field = el.dataset.inspField;
    const item = state.modelo[coll][idx]; if(!item) return;
    let val = el.type==="checkbox" ? el.checked : el.value;
    item[field]=val;
    scheduleAutoSave(); drawPreview(); renderEditor();
    renderInspector();
  }, { capture:false });

  body.addEventListener("click", (e)=>{
    const addNudo = e.target.closest("[data-insp-add-carga-nudo]");
    if (addNudo){
      pushUndo();
      state.modelo.cargas_nodales.push({nudo:+addNudo.dataset.inspAddCargaNudo, modo:"comp", Fx:0, Fy:0, M:0});
      renderEditor(); renderInspector(); drawPreview(); return;
    }
    const addElem = e.target.closest("[data-insp-add-carga-elem]");
    if (addElem){
      pushUndo();
      state.modelo.cargas_elementos.push({elem:+addElem.dataset.inspAddCargaElem, tipo:"distribuida", subtipo:"uniforme", wy:0, wx:0});
      renderEditor(); renderInspector(); drawPreview(); return;
    }
    const delNudo = e.target.closest("[data-delete-nudo]");
    if (delNudo){
      const idx = +delNudo.dataset.deleteNudo;
      const n = state.modelo.nudos[idx];
      if (n && confirm(`¿Eliminar nudo "${n.nombre||("N"+n.id)}"? Se perderán las cargas y elementos asociados.`)){
        pushUndo();
        const nid = n.id;
        state.modelo.nudos.splice(idx, 1);
        state.modelo.elementos = state.modelo.elementos.filter(e=>+e.i!==nid && +e.j!==nid);
        state.modelo.cargas_nodales = state.modelo.cargas_nodales.filter(c=>+c.nudo!==nid);
        state.modelo.cargas_elementos = state.modelo.cargas_elementos.filter(c=>{
          const e = state.modelo.elementos.find(el=>+el.id===+c.elem);
          return !!e;
        });
        selectObject(null, null);
        renderEditor(); drawPreview(); scheduleAutoSave();
      }
      return;
    }
    const delElem = e.target.closest("[data-delete-elemento]");
    if (delElem){
      const idx = +delElem.dataset.deleteElemento;
      const e = state.modelo.elementos[idx];
      if (e && confirm(`¿Eliminar elemento "${e.nombre||("E"+e.id)}"?`)){
        pushUndo();
        const eid = e.id;
        state.modelo.elementos.splice(idx, 1);
        state.modelo.cargas_elementos = state.modelo.cargas_elementos.filter(c=>+c.elem!==eid);
        selectObject(null, null);
        renderEditor(); drawPreview(); scheduleAutoSave();
      }
      return;
    }
  }, { capture:false });
}

/* ============================================================
   WORKFLOW STEPPER
   ============================================================ */
const WF_ORDEN = ["definir", "modelar", "cargar"];
// Marca como completados los pasos previos al activo (progreso visual).
function markStepsProgress(activeStep){
  const ai = WF_ORDEN.indexOf(activeStep);
  $$("#workflow-stepper .wf-step").forEach(b=>{
    const i = WF_ORDEN.indexOf(b.dataset.wf);
    b.classList.toggle("is-active", b.dataset.wf===activeStep);
    b.classList.toggle("is-done", ai>=0 && i>=0 && i<ai);
  });
}

function setWorkflowActiveForGroup(groupKey){
  if (!groupKey) return;
  markStepsProgress(groupKey);
  $$(".acc-group").forEach(g=>g.classList.remove("is-active"));
  const gid = "grp-"+groupKey;
  const grp = $("#"+gid); if(grp) grp.classList.add("is-active");
}

const WF_GROUP_MAP = {
  "definir": "grp-definir",
  "modelar": "grp-modelar",
  "cargar":  "grp-cargar",
};

function setWorkflowStep(step){
  const gid = WF_GROUP_MAP[step];
  if (!gid) return;
  markStepsProgress(step);
  // Solo el grupo del paso activo es visible en el rail
  $$("#rail .acc-group").forEach(g=>g.classList.remove("is-active"));
  const grp = $("#"+gid);
  if (grp){
    grp.classList.add("is-active");
    // Abrir el primer acordeón del grupo si todos están colapsados
    const accs = grp.querySelectorAll(".acc");
    const anyOpen = Array.from(accs).some(a=>!a.classList.contains("is-collapsed"));
    if (!anyOpen && accs[0]) accs[0].classList.remove("is-collapsed");
  }
  // Llevar el rail al inicio al cambiar de paso
  const rail = $("#rail"); if (rail) rail.scrollTop = 0;
  updateAccOpenCount();
}

function initWorkflowStepper(){
  $$("#workflow-stepper .wf-step").forEach(btn=>{
    btn.addEventListener("click",()=>setWorkflowStep(btn.dataset.wf));
  });
}

/* ============================================================
   LABEL TOGGLES
   ============================================================ */
function initLabelToggles(){
  const cont = $("#label-toggles"); if(!cont) return;
  cont.addEventListener("click",(e)=>{
    const btn = e.target.closest(".lbl-toggle"); if(!btn) return;
    const lbl = btn.dataset.lbl;
    state._labelToggles[lbl] = !state._labelToggles[lbl];
    btn.classList.toggle("is-active", state._labelToggles[lbl]);
    drawPreview();
  });
}

/* ============================================================
   INSPECTOR PANEL TOGGLE
   ============================================================ */
function initInspectorToggle(){
  // Botón legacy (ya no existe en el HTML nuevo); se mantiene por compatibilidad.
  const btn = $("#inspector-toggle");
  if (btn){ btn.textContent = "✕"; btn.title = "Cerrar inspector";
    btn.addEventListener("click",()=>{ selectObject(null, null); }); }
}

/* Colapsar / expandir el panel de propiedades (persistente) */
function initPropsCollapse(){
  const btn = $("#props-collapse-btn");
  const vista = $("#vista-modelo");
  if (!btn || !vista) return;
  const apply = (collapsed)=>{
    vista.classList.toggle("props-collapsed", collapsed);
    btn.title = collapsed ? "Expandir panel de propiedades" : "Colapsar panel de propiedades";
    localStorage.setItem("ae_props_collapsed", collapsed ? "1" : "0");
    requestAnimationFrame(drawPreview);   // el lienzo cambia de tamaño
  };
  btn.addEventListener("click",()=> apply(!vista.classList.contains("props-collapsed")));
  apply(localStorage.getItem("ae_props_collapsed")==="1");
}

/* ============================================================
   COLAPSAR / EXPANDIR TODOS LOS ACORDEONES
   ============================================================ */
function activeRailAccs(){
  const grp = $("#rail .acc-group.is-active");
  return grp ? Array.from(grp.querySelectorAll(".acc")) : [];
}

function updateAccOpenCount(){
  const accs = activeRailAccs();
  const open = accs.filter(a => !a.classList.contains("is-collapsed")).length;
  const hint = $("#acc-open-count");
  if (hint) hint.textContent = open === 0
    ? "Todo colapsado"
    : `${open} de ${accs.length} secciones abiertas`;
  const lbl = $("#collapse-all-label");
  if (lbl) lbl.textContent = open === 0 ? "Expandir todo" : "Colapsar todo";
}

function initCollapseAll(){
  const btn = $("#btn-collapse-all"); if(!btn) return;
  btn.addEventListener("click",()=>{
    const accs = activeRailAccs();
    const anyOpen = accs.some(a => !a.classList.contains("is-collapsed"));
    if (anyOpen){
      accs.forEach(a => a.classList.add("is-collapsed"));
    } else if (accs[0]) {
      accs[0].classList.remove("is-collapsed");
    }
    updateAccOpenCount();
  });
  updateAccOpenCount();
}

/* ============================================================
   MENÚ HAMBURGUESA (acciones de Modelo)
   ============================================================ */
function initHamMenu(){
  const btn = $("#ham-btn"), menu = $("#ham-menu");
  if (!btn || !menu) return;
  const open = ()=>{ menu.classList.remove("hidden"); btn.classList.add("is-open"); };
  const close = ()=>{ menu.classList.add("hidden"); btn.classList.remove("is-open"); };
  btn.addEventListener("click",(e)=>{
    e.stopPropagation();
    menu.classList.contains("hidden") ? open() : close();
  });
  // Cerrar al elegir una acción (excepto el input de archivo)
  menu.addEventListener("click",(e)=>{
    if (e.target.closest(".ham-item")) close();
  });
  // Cerrar al hacer clic fuera o con Escape
  document.addEventListener("click",(e)=>{
    if (!menu.classList.contains("hidden") && !e.target.closest(".ham-wrap")) close();
  });
  document.addEventListener("keydown",(e)=>{ if (e.key==="Escape") close(); });
  // Template modal
  initTplModal();
}

function initTplModal(){
  const panel = $("#tpl-panel");
  const btnToggle = $("#btn-tpl-toggle");
  const btnClose = $("#btn-tpl-close");
  const search = $("#tpl-search");
  const tabs = $("#tpl-tabs");

  function openTpl(){
    _tplActiveCat = "todas";
    _tplSearchQuery = "";
    if(search) search.value = "";
    renderTemplateGallery();
    panel.classList.remove("hidden");
    if(search) setTimeout(()=>search.focus(), 100);
  }
  function closeTpl(){
    panel.classList.add("hidden");
  }

  if(btnToggle) btnToggle.addEventListener("click", openTpl);
  if(btnClose) btnClose.addEventListener("click", closeTpl);

  // Close on overlay click
  if(panel) panel.addEventListener("click",(e)=>{
    if(e.target === panel) closeTpl();
  });

  // Close on Escape
  document.addEventListener("keydown",(e)=>{
    if(e.key==="Escape" && panel && !panel.classList.contains("hidden")) closeTpl();
  });

  // Search input
  if(search) search.addEventListener("input",(e)=>{
    _tplSearchQuery = e.target.value;
    renderTemplateGallery();
  });

  // Category tabs
  if(tabs) tabs.addEventListener("click",(e)=>{
    const tab = e.target.closest(".tpl-tab");
    if(!tab) return;
    _tplActiveCat = tab.dataset.cat;
    tabs.querySelectorAll(".tpl-tab").forEach(t=>t.classList.toggle("is-active", t===tab));
    renderTemplateGallery();
  });
}

/* ============================================================
   MODO SIMPLE / AVANZADO
   ============================================================ */
function initModeToggle(){
  const cont = $("#mode-toggle"); if(!cont) return;
  const saved = localStorage.getItem("ae_mode") || "simple";
  const apply = (m)=>{
    document.body.dataset.mode = m;
    $$("#mode-toggle .mode-btn").forEach(b=>b.classList.toggle("is-active", b.dataset.mode===m));
    localStorage.setItem("ae_mode", m);
  };
  cont.addEventListener("click",(e)=>{
    const btn = e.target.closest(".mode-btn"); if(!btn) return;
    apply(btn.dataset.mode);
  });
  apply(saved);
}

/* ============================================================
   STATUS BAR: sincronizar texto de snap
   ============================================================ */
function initStatusSnap(){
  const chk = $("#chk-snap"), sb = $("#status-snap");
  if (!chk || !sb) return;
  const upd = ()=>{ sb.textContent = chk.checked ? "snap 0.5 m" : "snap off"; };
  chk.addEventListener("change", upd);
  upd();
  const chkGrid = $("#chk-grid");
  if (chkGrid) chkGrid.addEventListener("change", ()=> drawPreview());
}

/* ============================================================
   INIT
   ============================================================ */
function init(){
  if (!autoRestore()){
    limpiarModelo();
  }
  bindEditor();
  bindGraphEditor();
  bindKeyboard();
  initWorkflowStepper();
  initLabelToggles();
  initInspectorToggle();
  initPropsCollapse();
  initCollapseAll();
  initHamMenu();
  initModeToggle();
  initStatusSnap();
  document.body.classList.add("app-mode");
  setWorkflowStep("definir");
  window.addEventListener("beforeunload", (e)=>{
    if (state._modified){ e.preventDefault(); e.returnValue=""; }
  });
  bindBottomNav();
  renderTemplateGallery();
  drawPreview();
  renderDiagrama("dmf");
}

function bindBottomNav(){
  $$(".bottom-nav-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const vista = btn.dataset.vista;
      if (vista) setVista(vista);
    });
  });
  $$(".nav-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const vista = btn.dataset.vista;
      if (vista) setVista(vista);
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
