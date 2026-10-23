import { readFile, writeFile } from 'node:fs/promises';
import definition from '../src/index.ts';
const instance = definition.create({ cfg: definition.defaults(), persist: () => {} } as never);
const prompts = await Promise.all((instance.webUi?.().promptDocs ?? []).map(async doc => ({
  key: doc.key, title: doc.title, role: doc.role, content: await readFile(doc.path, 'utf8'),
})));
await writeFile(new URL('../describe.json', import.meta.url), JSON.stringify({ ...definition.describe, prompts }, null, 2) + '\n');
