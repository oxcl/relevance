import { writeFileSync, mkdirSync } from 'node:fs';
import type { PatchSource } from '../shared/types';
import { configHash, findPatch, pickTarget } from '../shared/logic';
import { resolveSource, sourceAutoUpdates, getDownload } from '../shared/sources';
import { patchSourceFor, srcCtx } from './build';
import { notify } from './notify';
import { BUILTIN_SOURCES, indexSource, loadIndex } from './patches';
import { env, ghApi, info, loadConfig, loadState, log, ok, putFile, REPO, shortErr, updateState, warn } from './util';

export async function indexCustomSources() {
  const cfg = loadConfig();
  for (const src of cfg.patchSources.filter((s) => !s.builtin)) {
    try {
      info(`Indexing ${src.name}`);
      const idx = await indexSource(src);
      await putFile(`.relevance/index/${src.id}.json`, () => JSON.stringify(idx, null, 1) + '\n', `relevance: index ${src.name} ${idx.version}`);
      mkdirSync('.relevance/index', { recursive: true });
      writeFileSync(`.relevance/index/${src.id}.json`, JSON.stringify(idx));
      ok(`${src.name}: ${idx.patches.length} patches (${idx.version})`);
    } catch (e) {
      warn(`Could not index ${src.name}: ${shortErr(e)}`);
    }
  }
}

/** Builtin indexes published by Relevance itself (runs in the Relevance repository). */
export async function indexBuiltin(outDir: string) {
  mkdirSync(outDir, { recursive: true });
  for (const src of BUILTIN_SOURCES) {
    try {
      const idx = await indexSource(src as PatchSource);
      writeFileSync(`${outDir}/${src.id}.json`, JSON.stringify(idx));
      ok(`${src.name}: ${idx.patches.length} entries (${idx.version})`);
    } catch (e) {
      warn(`Could not index ${src.name}: ${shortErr(e)}`);
    }
  }
}

export async function checkUpdates(only?: string) {
  await indexCustomSources();
  const cfg = loadConfig();
  const toBuild: string[] = [];
  for (const app of cfg.apps) {
    if (only && app.id !== only) continue;
    if (!app.enabled) continue;
    const st = loadState(app.id);
    const hash = await configHash(app);
    try {
      info(`Checking ${app.name}`);
      const ps = patchSourceFor(cfg, app);
      const index = ps && app.tool !== 'lspatch' ? await loadIndex(ps) : null;
      if (index) {
        const missing = app.patches.filter((p) => !findPatch(index, p.name, app.packageName)).map((p) => p.name);
        if (missing.length) {
          const msg = `Patches you picked are no longer offered by ${index.name} ${index.version}: ${missing.join(', ')}`;
          if (st.attention?.message !== msg) {
            const s2 = await updateState(
              app.id,
              (s) => {
                s.status = 'needs-review';
                s.attention = { kind: 'selection-changed', message: msg, at: new Date().toISOString(), details: missing };
                s.checkedAt = new Date().toISOString();
              },
              `relevance: ${app.name} needs a review`,
            );
            await notify(cfg, app, s2);
          }
          warn(msg);
          continue;
        }
      }
      let available: string[] | null = null;
      let latest: string | undefined;
      const auto = sourceAutoUpdates(app.source.type);
      if (auto) {
        const si = await resolveSource(app.source, srcCtx());
        available = si.versions;
        latest = si.latest || si.versions?.[0];
      }
      const t = pickTarget(app.tool === 'revanced' || app.tool === 'morphe' ? index : null, app.packageName, app.patches, available, app.pin);
      let target = t.target;
      if (!target && auto) target = (await getDownload(app.source, null, srcCtx())).version || null;
      const changed =
        !st.current ||
        st.configHash !== hash ||
        (index && st.patchVersion !== index.version) ||
        (auto && target && target !== (st.current.sourceVersion ?? st.current.version));
      await updateState(
        app.id,
        (s) => {
          s.checkedAt = new Date().toISOString();
          s.latestAvailable = latest;
          s.targetVersion = target || undefined;
        },
        `relevance: checked ${app.name}`,
      );
      if (t.conflict) {
        warn(`${app.name}: ${t.reason}`);
        continue;
      }
      if (changed && st.status !== 'failed') {
        log(`→ ${app.name}: build ${target ?? 'latest'} (current ${st.current?.version ?? 'none'})`);
        toBuild.push(app.id);
      } else if (changed && st.status === 'failed' && st.attention?.version !== target) {
        log(`→ ${app.name}: new version ${target} after a failed build — retrying`);
        toBuild.push(app.id);
      } else {
        ok(`${app.name} is up to date (${st.current?.version ?? '—'})`);
      }
    } catch (e) {
      warn(`${app.name}: ${shortErr(e)}`);
    }
  }
  for (const id of toBuild) {
    await ghApi(`/repos/${REPO}/actions/workflows/relevance-build.yml/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: env.GITHUB_REF_NAME || 'main', inputs: { app: id, trigger: 'schedule', force: 'false' } }),
    });
    ok(`Queued a build for ${id}`);
  }
  if (!toBuild.length) ok('Everything is up to date');
}
