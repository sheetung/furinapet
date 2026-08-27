/**
 * The Furinapet neuro-system ABI.
 *
 * Everything the perception, brain, cerebellum and motion layers exchange is declared
 * here and nowhere else. Adding a field is a version bump, not an edit — the mirror
 * of this file lives in `src/neuro/schemas/neuro-v1.schema.json` for consumers that
 * are not TypeScript, and `neuro-v1.schema.test.ts` fails if the two drift.
 */
export * from "./common";
export * from "./perception";
export * from "./world-state";
export * from "./character-state";
export * from "./brain-intent";
export * from "./motor-plan";
export * from "./validate";
