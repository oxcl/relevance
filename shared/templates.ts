// Files Relevance writes into the user's repository (besides relevance.json and state).
import { ENGINE_VERSION } from './types';

const E = '${{';
const x = (s: string) => `${E} ${s} }}`;

export const BUILD_WORKFLOW = `# Managed by Relevance (engine ${ENGINE_VERSION}). Changes may be overwritten.
name: Relevance build
run-name: "Build ${x('inputs.app')} · ${x('inputs.trigger')}"

on:
  workflow_dispatch:
    inputs:
      app:
        description: App id from relevance.json
        required: true
        type: string
      force:
        description: Rebuild even if nothing changed
        type: boolean
        default: false
      trigger:
        description: What started this build
        type: string
        default: manual

permissions:
  contents: write
  issues: write
  id-token: write
  actions: read

concurrency:
  group: relevance-build-${x('inputs.app')}
  cancel-in-progress: false

jobs:
  build:
    name: Build ${x('inputs.app')}
    runs-on: ubuntu-latest
    timeout-minutes: 75
    outputs:
      skip: ${x('steps.plan.outputs.skip')}
    env:
      APP: ${x('inputs.app')}
      GITHUB_TOKEN: ${x('github.token')}
      RELEVANCE_KEYSTORE: ${x('secrets.RELEVANCE_KEYSTORE')}
      RELEVANCE_KEYSTORE_PASSWORD: ${x('secrets.RELEVANCE_KEYSTORE_PASSWORD')}
    steps:
      - name: Checkout
        uses: actions/checkout@v7
      - name: Set up Java
        uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: '21'
      - name: Set up Node
        uses: actions/setup-node@v7
        with:
          node-version: '22'
      - name: Plan [plan]
        id: plan
        run: node .relevance/engine.mjs plan --app "$APP" --force ${x('inputs.force')} --trigger "${x('inputs.trigger')}"
      - name: Fetch APK [fetch]
        if: steps.plan.outputs.skip != 'true'
        run: node .relevance/engine.mjs fetch --app "$APP"
      - name: Patch [patch]
        if: steps.plan.outputs.skip != 'true' && steps.plan.outputs.patch == 'true'
        run: node .relevance/engine.mjs patch --app "$APP"
      - name: Decompile & customize [customize]
        if: steps.plan.outputs.skip != 'true' && steps.plan.outputs.customize == 'true'
        run: node .relevance/engine.mjs customize --app "$APP"
      - name: Sign [sign]
        if: steps.plan.outputs.skip != 'true' && steps.plan.outputs.rebuild == 'true'
        run: node .relevance/engine.mjs sign --app "$APP"
      - name: Publish [publish]
        if: steps.plan.outputs.skip != 'true'
        run: node .relevance/engine.mjs publish --app "$APP"
      - name: Nothing to build
        if: steps.plan.outputs.skip == 'true'
        run: node .relevance/engine.mjs skipped --app "$APP"
      - name: Report problem
        if: failure() || cancelled()
        run: node .relevance/engine.mjs fail --app "$APP" --status "${x('job.status')}"

  site:
    name: Publish F-Droid repo and store
    needs: build
    if: always() && needs.build.outputs.skip != 'true'
    uses: ./.github/workflows/relevance-publish.yml
    secrets: inherit
    permissions:
      contents: read
      pages: write
      id-token: write
      actions: read
`;

export const PUBLISH_WORKFLOW = `# Managed by Relevance (engine ${ENGINE_VERSION}). Changes may be overwritten.
name: Relevance publish
run-name: Publish F-Droid repository and store site

on:
  workflow_call:
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write
  actions: read

concurrency:
  group: relevance-pages
  cancel-in-progress: false

jobs:
  publish:
    name: F-Droid repo and store site
    runs-on: ubuntu-latest
    timeout-minutes: 40
    environment:
      name: github-pages
      url: ${x("steps.deploy.outputs.page_url || steps.deploy2.outputs.page_url || steps.deploy3.outputs.page_url")}
    env:
      GITHUB_TOKEN: ${x('github.token')}
      RELEVANCE_KEYSTORE: ${x('secrets.RELEVANCE_KEYSTORE')}
      RELEVANCE_KEYSTORE_PASSWORD: ${x('secrets.RELEVANCE_KEYSTORE_PASSWORD')}
    steps:
      - name: Checkout
        uses: actions/checkout@v7
        with:
          ref: ${x('github.event.repository.default_branch')}
      - name: Set up Node
        uses: actions/setup-node@v7
        with:
          node-version: '22'
      - name: Set up Python
        uses: actions/setup-python@v7
        with:
          python-version: '3.12'
          cache: pip
          cache-dependency-path: .relevance/engine.version
      - name: Install fdroidserver
        run: pip install --quiet fdroidserver
      - name: Generate F-Droid repository and store site [site]
        run: node .relevance/engine.mjs site
      - name: Configure Pages
        uses: actions/configure-pages@v6
      - name: Upload site
        uses: actions/upload-pages-artifact@v5
        with:
          path: _site
          retention-days: 90
      # GitHub sometimes doesn't list a freshly uploaded artifact yet ("No artifacts named
      # github-pages were found"), so give it time and retry instead of failing the publish.
      - name: Deploy to GitHub Pages
        id: deploy
        continue-on-error: true
        uses: actions/deploy-pages@v5
      - name: Wait for the artifact to become visible
        if: steps.deploy.outcome == 'failure'
        run: sleep 30
      - name: Deploy to GitHub Pages (second try)
        id: deploy2
        if: steps.deploy.outcome == 'failure'
        continue-on-error: true
        uses: actions/deploy-pages@v5
      - name: Wait a little longer
        if: steps.deploy2.outcome == 'failure'
        run: sleep 90
      - name: Deploy to GitHub Pages (last try)
        id: deploy3
        if: steps.deploy2.outcome == 'failure'
        uses: actions/deploy-pages@v5
`;

export function updateWorkflow(seed: string) {
  // spread users over the day to be nice to sources
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const minute = h % 60;
  const hour = (h >> 6) % 24;
  return `# Managed by Relevance (engine ${ENGINE_VERSION}). Changes may be overwritten.
name: Relevance updates
run-name: "Check for updates${x("inputs.app && format(' · {0}', inputs.app) || ''")}"

on:
  schedule:
    - cron: '${minute} ${hour} * * *'
  workflow_dispatch:
    inputs:
      app:
        description: Only check this app (optional)
        type: string
        default: ''

permissions:
  contents: write
  actions: write
  issues: write
  id-token: write

concurrency:
  group: relevance-updates
  cancel-in-progress: false

jobs:
  check:
    name: Check apps and patches
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      GITHUB_TOKEN: ${x('github.token')}
    steps:
      - name: Checkout
        uses: actions/checkout@v7
      - name: Set up Java
        uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: '21'
      - name: Set up Node
        uses: actions/setup-node@v7
        with:
          node-version: '22'
      - name: Check for updates [check]
        run: node .relevance/engine.mjs check --app "${x('inputs.app')}"
`;
}

export function repoReadme(owner: string, repo: string, relevanceUrl: string, pages: string) {
  return `# ${repo}

This repository is managed by [Relevance](${relevanceUrl}). It holds everything for my apps:

- \`relevance.json\` — the apps, their sources, patches and customizations
- \`.relevance/\` — build state, icons, screenshots and the build engine
- \`.github/workflows/\` — the builds, which run in this repository's GitHub Actions

## Install

- **Store:** ${pages}
- **F-Droid repository:** ${pages}/fdroid/repo

APKs are published as GitHub Releases of this repository. Signing keys are kept as encrypted
GitHub Actions secrets and are never committed.

> The owner of this repository is responsible for what is built and published here.
`;
}
