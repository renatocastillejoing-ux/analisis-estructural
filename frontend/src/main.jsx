import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Teclado virtual en iOS (no respeta interactive-widget): --kb = alto que tapa el teclado,
// para que las hojas inferiores suban sobre él.
const vv = window.visualViewport;
if (vv) {
  const kb = () => document.documentElement.style.setProperty("--kb", `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
  vv.addEventListener("resize", kb); vv.addEventListener("scroll", kb); kb();
}
// campos numéricos: la tecla Intro del teclado del teléfono dice «Siguiente»
document.addEventListener("focusin", (e) => {
  const el = e.target;
  if (el instanceof HTMLInputElement && (el.type === "number" || el.inputMode === "decimal" || el.inputMode === "numeric") && !el.hasAttribute("enterkeyhint")) el.enterKeyHint = "next";
});

createRoot(document.getElementById("root")).render(<App />);
