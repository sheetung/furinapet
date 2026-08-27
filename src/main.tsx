import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AgentNavigation } from "./agents/AgentNavigation";
import { App } from "./App";
import { PetView } from "./PetView";
import { bootstrapAiSuggestionRuntime } from "./pet-brain/ai-runtime";
import { BrainNavigation } from "./pet-brain/BrainNavigation";
import { bootstrapPetBrainRuntime } from "./pet-brain/runtime";
import { bootstrapNeuroPerception } from "./neuro/perception/store";
import { installPetDomBridge } from "./plugins/dom-bridge";
import { PluginNavigation } from "./plugins/PluginNavigation";
import { bootstrapPluginRuntime } from "./plugins/runtime";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const isPetWindow = params.get("window") === "pet";
if (isPetWindow) document.documentElement.classList.add("pet-window");
if (isPetWindow) {
  installPetDomBridge();
  bootstrapPetBrainRuntime();
  bootstrapAiSuggestionRuntime();
  bootstrapNeuroPerception();
} else {
  bootstrapPluginRuntime();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPetWindow ? (
      <PetView />
    ) : (
      <>
        <App />
        <PluginNavigation />
        <AgentNavigation />
        <BrainNavigation />
      </>
    )}
  </StrictMode>,
);
