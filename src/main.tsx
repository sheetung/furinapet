import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PetView } from "./PetView";
import { bootstrapPlugins } from "./plugins";
import { installPetDomBridge } from "./plugins/dom-bridge";
import { PluginPanel } from "./plugins/PluginPanel";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const isPetWindow = params.get("window") === "pet";
if (isPetWindow) document.documentElement.classList.add("pet-window");

void bootstrapPlugins().catch((error) => {
  console.error("[plugins] bootstrap failed", error);
});

if (isPetWindow) installPetDomBridge();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPetWindow ? (
      <PetView />
    ) : (
      <>
        <App />
        <PluginPanel />
      </>
    )}
  </StrictMode>,
);
