import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { FournisseurToasts } from "./composants/ui";

async function demarrer() {
  if (__DEMO__) (await import("./demo/serveur-simule")).installer();
  createRoot(document.getElementById("racine")!).render(
    <StrictMode><FournisseurToasts><App /></FournisseurToasts></StrictMode>,
  );
}
demarrer();
