import type { AppConfig, AppState, RelevanceConfig } from '../shared/types';
import { env, ghApi, log, REPO, relayPost, RUN_ID, warn } from './util';

export async function notify(cfg: RelevanceConfig, app: AppConfig, st: AppState) {
  const n = cfg.settings?.notifications || { email: true, issue: true, inApp: true, fdroid: true };
  const att = st.attention;
  if (!att) return;
  const runUrl = `https://github.com/${REPO}/actions/runs/${RUN_ID}`;
  const appUrl = `${cfg.settings.relevanceUrl}/apps/${app.id}`;
  const what: Record<string, string> = {
    'build-failed': 'update build failed',
    'selection-changed': 'your patch selection needs a review',
    'no-compatible-version': 'no compatible version available',
    'signature-changed': "the original app's signature doesn't match",
  };
  const title = `${app.customize?.name || app.name}: ${what[att.kind] || 'needs attention'}`;
  const body = [
    att.message,
    '',
    ...(att.details || []).map((d) => `> ${d}`),
    '',
    `- Open in Relevance: ${appUrl}`,
    `- Build log: ${runUrl}`,
    '',
    'The last good build stays published until you act.',
  ].join('\n');

  if (n.issue) {
    try {
      const existing: any[] = await ghApi(`/repos/${REPO}/issues?state=open&labels=relevance&per_page=50`);
      const same = existing.find((i) => i.title === title);
      if (same) {
        await ghApi(`/repos/${REPO}/issues/${same.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
      } else {
        await ghApi(`/repos/${REPO}/issues`, { method: 'POST', body: JSON.stringify({ title, body, labels: ['relevance'] }) });
      }
      log('✓ Opened a GitHub issue');
    } catch (e: any) {
      warn(`Could not open an issue: ${e.message}`);
    }
  }
  if (n.email && cfg.settings.emailToken) {
    const r = await relayPost('/api/notify/email', {
      repo: REPO,
      token: cfg.settings.emailToken,
      subject: `Relevance · ${title}`,
      text: `${body}\n`,
      appUrl,
      runUrl,
      appName: app.customize?.name || app.name,
      message: att.message,
    });
    if (r?.ok) log('✓ Sent an email notification');
    else warn(`Email notification not sent (${r?.status ?? 'relay unavailable'})`);
  }
  void env;
}

/** Close open Relevance issues for an app after a successful build. */
export async function resolveIssues(app: AppConfig) {
  try {
    const existing: any[] = await ghApi(`/repos/${REPO}/issues?state=open&labels=relevance&per_page=50`);
    const name = app.customize?.name || app.name;
    for (const i of existing.filter((i) => i.title.startsWith(`${name}:`))) {
      await ghApi(`/repos/${REPO}/issues/${i.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: `Resolved — a new build was published successfully (run ${RUN_ID}).` }),
      });
      await ghApi(`/repos/${REPO}/issues/${i.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
    }
  } catch {}
}
