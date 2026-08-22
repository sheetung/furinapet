import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PetView } from "./PetView";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
createRoot(document.getElementById("root")!).render(
  <StrictMode>{params.get("window") === "pet" ? <PetView /> : <App />}</StrictMode>,
);
