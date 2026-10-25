import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./jetons.css";
import "./styles.css";
import { App } from "./App";
import { FournisseurToasts } from "./composants/ui";

function demarrer() {
  createRoot(document.getElementById("racine")!).render(
    <StrictMode><FournisseurToasts><App /></FournisseurToasts></StrictMode>,
  );
}
demarrer();
