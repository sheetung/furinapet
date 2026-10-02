import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Pure relative-import TS modules only; no browser or Tauri bootstrapping.
async function moduleUrl(url) {
  const source = await readFile(url, 'utf8');
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  for (const match of [...outputText.matchAll(/from\s+['"](\.[^'"]+)['"]/g)]) {
    outputText = outputText.replace(match[0], `from '${await moduleUrl(new URL(`${match[1]}.ts`, url))}'`);
  }
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
export async function load(source) { return import(await moduleUrl(new URL(source, import.meta.url))); }
