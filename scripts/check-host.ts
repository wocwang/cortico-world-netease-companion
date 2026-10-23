import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import definition from '../src/index.ts';

// Check the real installed host, without modifying its code or user deployment.
const appDir = process.argv[2];
if (!appDir) throw new Error('Usage: npm run check-host -- <Coopanion resources/app directory>');
const app = JSON.parse(await readFile(join(resolve(appDir), 'package.json'), 'utf8'));
const core = join(resolve(appDir), 'build', 'cortico', 'src');
const load = (path: string) => import(pathToFileURL(join(core, path)).href);
const manifest = await load('extensions/manifest.ts');
const { dryMountWorld } = await load('extensions/dry-mount.ts');
const { checkDescribe } = await load('extensions/describe-export.ts');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const parsed = manifest.parseExtensionManifest(pkg);
if (!parsed.ok) throw new Error(JSON.stringify(parsed));
const scratchDir = await mkdtemp(join(tmpdir(), 'netease-host-check-'));
try {
  const opts = { scratchDir, packageDir: resolve('.') };
  const reports = [await dryMountWorld(definition, opts), await checkDescribe('world', definition, 'describe.json', opts)];
  console.log(JSON.stringify({ coopanionVersion: app.version, worldApi: manifest.EXTENSION_API_VERSIONS.world, reports }, null, 2));
  if (reports.some(r => r.failures.length)) process.exitCode = 1;
} finally { await rm(scratchDir, { recursive: true, force: true }); }
