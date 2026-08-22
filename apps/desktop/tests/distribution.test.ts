import assert from "node:assert/strict";

import { builtInPet } from "../src/built-in-pet.js";
import { furinaDistribution } from "../src/distribution.js";
import { defaultPetSprite } from "../src/reaction-animation-mapping.js";

assert.equal(furinaDistribution.exclusivePet, true);
assert.equal(furinaDistribution.githubRepository, "sheetung/furinapet");
assert.equal(builtInPet.displayName, "芙宁娜");
assert.equal(defaultPetSprite.fileName, "furina-pet-spritesheet.webp");
assert.equal(defaultPetSprite.rows, 11);

console.log("Furina distribution contract passed.");
