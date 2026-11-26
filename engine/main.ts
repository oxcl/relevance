// Relevance build engine — runs inside the user's own GitHub Actions.
// Usage: node .relevance/engine.mjs <command> [--app id] [--force] [--trigger manual|schedule|config]
import { ENGINE_VERSION } from '../shared/types';
import { customize, fail, fetchApk, finishSkipped, patch, plan, publish, recordError, sign } from './build';
import { checkUpdates, indexBuiltin, indexCustomSources } from './check';
import { buildSite } from './site';
import { flush, loadConfig, log, setRelay, setStep, stepStatus, warn } from './util';
import { resolveIssues } from './notify';

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (k: string, d = '') => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] ?? '' : d;
};
const flag = (k: string) => argv.includes(`--${k}`) && !['false', '0'].includes(arg(k, 'true'));

async function main() {
  let relevanceUrl = process.env.RELEVANCE_URL;
  try {
    relevanceUrl ||= loadConfig().settings.relevanceUrl;
  } catch {}
  setRelay(relevanceUrl);
  setStep(cmd);
  const app = arg('app');
  log(`Relevance engine ${ENGINE_VERSION} · ${cmd}${app ? ` · ${app}` : ''}`);
  stepStatus('running');
  try {
    switch (cmd) {
      case 'plan':
        await plan(app, { force: flag('force'), trigger: (arg('trigger', 'manual') as any) || 'manual' });
        break;
      case 'fetch':
        await fetchApk(app);
        break;
      case 'patch':
        await patch(app);
        break;
      case 'customize':
        await customize(app);
        break;
      case 'sign':
        await sign(app);
        break;
      case 'publish':
        await publish(app);
        await resolveIssues(loadConfig().apps.find((a) => a.id === app)!);
        break;
      case 'skipped':
        await finishSkipped(app);
        break;
      case 'fail':
        await fail(app, { cancelled: arg('status') === 'cancelled' });
        break;
      case 'site':
        await buildSite();
        break;
      case 'check':
        await checkUpdates(app || undefined);
        break;
      case 'index':
        if (flag('builtin')) await indexBuiltin(arg('out', 'index'));
        else await indexCustomSources();
        break;
      default:
        throw new Error(`Unknown command ${cmd}`);
    }
    stepStatus('success');
    await flush();
  } catch (e: any) {
    if (cmd !== 'fail') recordError(cmd, e);
    log(`✗ ${e?.message || e}`);
    if (e?.stack) process.stdout.write(e.stack + '\n');
    stepStatus('failure', String(e?.message || e).slice(0, 200));
    await flush();
    process.exitCode = 1;
  }
}

process.on('unhandledRejection', (e) => warn(String(e)));
main();
