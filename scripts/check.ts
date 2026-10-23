import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseExtensionManifest } from 'cortico/extensions/manifest.ts';
import { dryMountWorld } from 'cortico/extensions/dry-mount.ts';
import { checkDescribe } from 'cortico/extensions/describe-export.ts';
import definition from '../src/index.ts';
const pkg = JSON.parse((await readFile('package.json', 'utf8')).replace(/^\uFEFF/, ''));
const manifest = parseExtensionManifest(pkg);
if (!manifest.ok) throw new Error(JSON.stringify(manifest));
const scratchDir = await mkdtemp(join(tmpdir(), 'netease-world-check-'));
try {
  const opts = { scratchDir, packageDir: resolve('.'), hasWebUiClient: manifest.manifest.webUiClient !== undefined };
  const reports = [await dryMountWorld(definition, opts), await checkDescribe('world', definition, 'describe.json', opts)];
  for (const report of reports) console.log(JSON.stringify(report, null, 2));
  if (reports.some(r => r.failures.length)) process.exitCode = 1;
} finally { await rm(scratchDir, { recursive: true, force: true }); }
