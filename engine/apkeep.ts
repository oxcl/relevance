// APKPure downloads through EFF's apkeep (https://github.com/EFForg/apkeep). APKPure's website
// answers GitHub's runners with a bot challenge; apkeep talks to APKPure's API instead and can
// list and fetch every published version.
import { chmodSync, createReadStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { sortVersionsDesc } from '../shared/logic';
import { download, info, ok, run, WORK } from './util';

const VERSION = '1.1.0';
const SHA256 = 'badd7ad9fa7d2f32abe01eaf33b7ff086361a95bbc000a33bf44b630d4bf2140';
let bin: string | null = null;

async function sha256(file: string) {
  const h = createHash('sha256');
  for await (const c of createReadStream(file)) h.update(c as Buffer);
  return h.digest('hex');
}

export async function apkeepBin(): Promise<string> {
  if (bin) return bin;
  const file = join(WORK, 'tools', `apkeep-${VERSION}`);
  if (!existsSync(file)) {
    info(`Downloading apkeep ${VERSION}`);
    await download(`https://github.com/EFForg/apkeep/releases/download/${VERSION}/apkeep-x86_64-unknown-linux-gnu`, file);
  }
  const got = await sha256(file);
  if (got !== SHA256) throw new Error(`apkeep checksum mismatch (${got}); refusing to run it`);
  chmodSync(file, 0o755);
  bin = file;
  return file;
}

const listCache = new Map<string, string[]>();
export async function apkeepVersions(pkg: string): Promise<string[]> {
  if (listCache.has(pkg)) return listCache.get(pkg)!;
  const out = await run(await apkeepBin(), ['-l', '-a', pkg, '-d', 'apk-pure', '-o', 'output_format=json'], { quiet: true });
  const line = out.split('\n').find((l) => l.trim().startsWith('{'));
  const j = line ? JSON.parse(line) : null;
  const app = j?.apps?.[pkg];
  if (!app || app.error) throw new Error(`APKPure has no listing for ${pkg}${app?.error ? ` (${app.error})` : ''}`);
  const versions = sortVersionsDesc((app.available_versions || []).map((v: any) => String(v.version)));
  if (!versions.length) throw new Error(`APKPure lists no versions for ${pkg}`);
  listCache.set(pkg, versions);
  return versions;
}

/** Download exactly `version`; returns the path of the .apk or .xapk file. */
export async function apkeepDownload(pkg: string, version: string): Promise<string> {
  const dir = join(WORK, 'apkeep');
  mkdirSync(dir, { recursive: true });
  info(`Downloading ${pkg} ${version} from APKPure with apkeep`);
  await run(await apkeepBin(), ['-a', `${pkg}@${version}`, '-d', 'apk-pure', '-o', 'acknowledge_dangers=true', dir]);
  const file = readdirSync(dir).find((f) => f.startsWith(`${pkg}@${version}.`) && /\.(x?apk)$/i.test(f));
  if (!file) throw new Error(`apkeep did not produce ${pkg} ${version}`);
  ok(`Got ${file}`);
  return join(dir, file);
}
