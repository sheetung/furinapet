import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SkeletalAnimationDemo } from "./components/SkeletalAnimationDemo";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SkeletalAnimationDemo />
  </StrictMode>,
);
