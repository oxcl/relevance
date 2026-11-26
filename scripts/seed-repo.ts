// Provision a Relevance repository the same way the setup wizard does (for testing).
// Usage: SECRETS_DIR=<dir> bun scripts/seed-repo.ts <repoDir> <owner> <relevanceUrl>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { generateKeystore } from '../app/src/lib/keystore';
import { BUILD_WORKFLOW, PUBLISH_WORKFLOW, updateWorkflow, repoReadme } from '../shared/templates';
import { ENGINE_VERSION } from '../shared/types';
const [dir, owner, url] = process.argv.slice(2);
const repo = dir.split('/').pop()!;
const key = await generateKeystore(owner);
const w = (p: string, c: string | Uint8Array) => {
  mkdirSync(`${dir}/${p}`.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(`${dir}/${p}`, c);
};
w('relevance.json', JSON.stringify({
  version: 1, owner, createdAt: new Date().toISOString(),
  settings: {
    notifications: { email: true, issue: true, inApp: true, fdroid: true },
    store: { title: `${owner}'s apps`, description: 'A small, honest collection of apps — kept up to date automatically.' },
    relevanceUrl: url,
    signing: { mode: 'generated', fingerprint: key.fingerprint, alias: key.alias, createdAt: new Date().toISOString() },
  },
  patchSources: [], apps: [],
}, null, 2) + '\n');
w('.relevance/engine.mjs', readFileSync('app/src/generated/engine.mjs'));
w('.relevance/engine.version', ENGINE_VERSION + '\n');
w('.relevance/signing-cert.pem', key.certPem);
w('.github/workflows/relevance-build.yml', BUILD_WORKFLOW);
w('.github/workflows/relevance-publish.yml', PUBLISH_WORKFLOW);
w('.github/workflows/relevance-update.yml', updateWorkflow(`${owner}/${repo}`));
w('README.md', repoReadme(owner, repo, url, `https://${owner}.github.io/${repo}`));
const S = process.env.SECRETS_DIR!;
writeFileSync(`${S}/ks.b64`, Buffer.from(key.p12).toString('base64'));
writeFileSync(`${S}/ks.pass`, key.password);
console.log('fingerprint', key.fingerprint);
