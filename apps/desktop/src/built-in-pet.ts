import { furinaDistribution } from "./distribution.js";

export const builtInPet = {
  id: "builtin",
  displayName: furinaDistribution.petDisplayName,
  builtIn: true,
  protected: true,
  installed: true,
} as const;
