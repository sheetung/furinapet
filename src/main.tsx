import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PetView } from "./PetView";
import { bootstrapAiSuggestionRuntime } from "./pet-brain/ai-runtime";
import { bootstrapPetBrainRuntime } from "./pet-brain/runtime";
import { installPetDomBridge } from "./pet/dom-bridge";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const isPetWindow = params.get("window") === "pet";
if (isPetWindow) document.documentElement.classList.add("pet-window");
if (isPetWindow) {
  installPetDomBridge();
  bootstrapPetBrainRuntime();
  bootstrapAiSuggestionRuntime();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPetWindow ? (
      <PetView />
    ) : (
      <App />
    )}
  </StrictMode>,
);
