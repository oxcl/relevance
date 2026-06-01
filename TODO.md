# TODO — Android App Patcher & F-Droid Repo Builder

## Phase 0: Project Setup

**Goal**: Nix environment for local dev, Docker image for CI, Python project scaffold, GitHub Actions for both.

**Why**: This project runs on two environments: a local NixOS machine for development, and GitHub Actions for production. We use `shell.nix` for local dev (NixOS reproducibility) and a Docker image for CI (fast, reproducible, no install step). The Docker image is built once and pushed to GHCR, then all GitHub Actions use it as the base container. Java 17 is needed for apktool, uber-apk-signer, fdroidserver, and other Android tools. The Python package structure gives us a clean CLI entry point.

### 0.1 shell.nix (local dev)

- [ ] Write `shell.nix` with:
  - Python 3.12+ with packages from pyproject.toml
  - Java 17 (JRE)
  - `fdroidserver` (nix package)
  - System libs: `zlib`, `libjpeg`, `libpng` (for Pillow)
  - Dev tools: `actionlint`, `gh`
- [ ] Verify: `nix-shell` enters successfully

### 0.2 pyproject.toml

- [ ] Write `pyproject.toml`:
  - Package name: `relevance`
  - Python requires: `>=3.12`
  - Dependencies: `pyyaml`, `pydantic>=2.0`, `httpx`, `pillow`, `click`, `rich`, `jinja2`
  - Dev dependencies: `ruff`, `mypy`
  - Entry point: `relevance = "src.main:cli"`
- [ ] Verify: `nix-shell --run "pip install -e ."` succeeds

### 0.3 Minimal src/main.py

- [ ] Create `src/__init__.py` (empty)
- [ ] Create `src/main.py` with a Click CLI:
  - `relevance --version` prints version
  - `relevance hello` prints "relevance is working"
- [ ] Verify: `nix-shell --run "python -m src.main hello"` prints "relevance is working"

### 0.4 Dockerfile (CI build environment)

- [ ] `docker/Dockerfile`:
  - Ubuntu 22.04 base
  - Java 17 (JDK — fdroidserver, apktool, APKEditor, uber-apk-signer need it)
  - Python 3.12+ with pip
  - fdroidserver (pip)
  - justapk (pip) — APKPure downloader with auto XAPK→APK conversion
  - System deps: `git`, `curl`, `wget`, `unzip`, `zip`, `aapt`
  - Pre-downloaded binaries:
    - `apkeep` — Rust binary, APKPure downloader (primary)
  - Pre-downloaded JARs:
    - `apktool.jar` — decompile/recompile APKs
    - `uber-apk-signer.jar` — zipalign + sign APKs
    - `APKEditor.jar` — merge split APKs (.xapk, .apks, .apkm) into single APK
  - Don't set `USER` or `WORKDIR` — GH Actions overrides these
  - Layer ordering: system deps → Java → Python → pip packages → binaries → JARs
- [ ] Verify: `docker build -f docker/Dockerfile -t relevance-build .`
- [ ] Verify: `docker run --rm relevance-build java --version`
- [ ] Verify: `docker run --rm relevance-build python3 --version`
- [ ] Verify: `docker run --rm relevance-build fdroid --version`
- [ ] Verify: `docker run --rm relevance-build apkeep --version`
- [ ] Verify: `docker run --rm relevance-build python3 -c "import justapk"`

### 0.5 Docker Build Workflow

- [ ] `.github/workflows/docker-build.yml`:
  - Trigger: push to `main` when `docker/Dockerfile` changes, plus `workflow_dispatch`
  - Build and push to `ghcr.io/oxcl/relevance/build-env:latest`
  - Use GHA cache for Docker layers (`type=gha,mode=max`)
  - `permissions: packages: write`
- [ ] Verify: `actionlint` passes

### 0.6 Main GitHub Actions Workflow (skeleton)

- [ ] `.github/workflows/build.yml`:
  - Trigger: `workflow_dispatch` (manual)
  - Uses `ghcr.io/oxcl/relevance/build-env:latest` as container
  - Steps: checkout, install relevance via `pip install .`, print tool versions
- [ ] Verify: `actionlint` passes

### Verification Criteria

Phase 0 is complete when ALL of these pass:

```bash
# 1. Nix shell works
nix-shell --run "python3 --version"           # >= 3.12
nix-shell --run "java --version"              # >= 17
nix-shell --run "fdroid --version"
nix-shell --run "actionlint --version"

# 2. Python package installs and runs
nix-shell --run "pip install -e ."
nix-shell --run "relevance --version"
nix-shell --run "relevance hello"

# 3. Linting passes
nix-shell --run "ruff check src/"

# 4. Docker image builds
docker build -f docker/Dockerfile -t relevance-build .
docker run --rm relevance-build java --version
docker run --rm relevance-build python3 --version
docker run --rm relevance-build fdroid --version
docker run --rm relevance-build apkeep --version
docker run --rm relevance-build python3 -c "import justapk"
# JAR files present
docker run --rm relevance-build ls /opt/jars/  # apktool, uber-apk-signer, APKEditor

# 5. GitHub Actions workflows valid
nix-shell --run "actionlint"
```

---

## Phase 1: Direct URL APK Download + Hash-Based Idempotency + Pages Publish

**Goal**: Download one APK from a direct URL, compute hashes for idempotency, publish state to GitHub Pages so future runs can check if anything changed.

**Why**: Before building complex patching logic, we need the simplest possible end-to-end path: download an APK and publish it. This phase also establishes the idempotency system, which is critical — the pipeline runs on a schedule (every 12 hours), and we don't want to re-download and re-process apps that haven't changed. Two hashes per app solve this: a **source hash** (did the upstream APK change?) and a **config hash** (did the user edit the YAML for this app?). If both match what's already published, we skip. The `state.json` file lives in `fdroid/repo/` (cached via GHA cache between runs) so the worker can compare against previous state. This phase also gets GitHub Pages publishing working, which is the final delivery mechanism for everything.

### 1.1 Minimal YAML Config

- [ ] Create `apps.yml` with one app:
  ```yaml
  settings:
    repo_name: "Relevance"
    repo_description: "Custom F-Droid repository"
    output_dir: "fdroid/repo"
    publish_original: true

  apps:
    - name: "Tasker"
      package_id: "net.dinglisch.android.taskerm"
      source:
        type: direct
        url: "https://tasker.joaoapps.com/direct_purchase_download"
      operations: []
  ```
- [ ] Write Pydantic models for this minimal config (`Settings`, `AppConfig`, `SourceConfig`)
- [ ] Write YAML loader that parses and validates
- [ ] Verify: `relevance --config apps.yml --dry-run` prints parsed config

### 1.2 Direct URL Download

- [ ] Implement download using `httpx` with:
  - Redirect following
  - Progress bar (via `rich`)
  - Timeout handling
  - Save to `.cache/{package_id}/source.apk`
- [ ] Detect file type from `Content-Disposition` header or URL
- [ ] Verify: `relevance --config apps.yml` downloads the APK

### 1.3 Hash-Based Idempotency

Two hashes per app, both must match to skip:

- [ ] **Source APK hash**: `sha256(downloaded_apk_file)` — tells us if the upstream APK changed
- [ ] **Config hash**: `sha256(deterministic_json_of_app_config_entry)` — tells us if the YAML config for this app changed
  - Deterministic: sort keys, no whitespace, stable serialization
  - Covers: name, package_id, source, operations, all fields
- [ ] Store hashes in `state.json` inside `fdroid/repo/` (persisted via GHA cache between runs):
  ```json
  {
    "apps": {
      "net.dinglisch.android.taskerm": {
        "source_hash": "abc123...",
        "config_hash": "def456...",
        "version": "6.4.0",
        "last_updated": "2026-05-29T12:00:00Z"
      }
    }
  }
  ```
- [ ] On each run:
  1. Load `state.json` from `fdroid/repo/` (exists if cache was restored)
  2. For each app: compare `source_hash` and `config_hash` against current values
  3. If both match → skip (log "up to date")
  4. If either differs → process (download, operate, output)
  5. After processing all apps, write updated `state.json` to `fdroid/repo/`
- [ ] First run: no `state.json` exists → process everything
- [ ] Verify: run twice, second run skips everything

### 1.4 Minimal GitHub Pages Publish

- [ ] The output directory (`fdroid/repo/`) becomes the Pages content:
  ```
  fdroid/repo/
  ├── state.json                              # Hash state for idempotency
  ├── net.dinglisch.android.taskerm_1.0.apk   # The APK
  └── ...                                     # More APKs + F-Droid index (later)
  ```
- [ ] Update GitHub Actions workflow to:
  1. Restore `fdroid/repo/` from GHA cache
  2. Run `relevance --config apps.yml`
  3. Save `fdroid/repo/` to GHA cache
  4. Deploy `fdroid/repo/` to GitHub Pages (using `peaceiris/actions-gh-pages`)
- [ ] Verify: after push, `https://oxcl.github.io/relevance/fdroid.repo/state.json` is accessible

### 1.5 CLI Integration

- [ ] `relevance --config apps.yml` — run full pipeline (download + hash + output)
- [ ] `relevance --config apps.yml --dry-run` — parse config, show plan, don't download
- [ ] `relevance --config apps.yml --force` — ignore hashes, re-process everything
- [ ] Verify: end-to-end run works

### Verification Criteria

Phase 1 is complete when ALL of these pass:

```bash
# 1. Config parses correctly
relevance --config apps.yml --dry-run

# 2. APK downloads successfully
relevance --config apps.yml
ls fdroid/repo/net.dinglisch.android.taskerm_*.apk

# 3. Downloaded file is a valid APK
file fdroid/repo/net.dinglisch.android.taskerm_*.apk

# 4. state.json is generated
cat fdroid/repo/state.json
# Contains source_hash and config_hash for the app

# 5. Idempotent — second run skips everything
relevance --config apps.yml
# Output: "Tasker: up to date (source unchanged, config unchanged)"

# 6. Config change detected — re-downloads
# (edit apps.yml, e.g. change name)
relevance --config apps.yml
# Output: "Tasker: config changed, re-processing..."

# 7. --force overrides idempotency
relevance --config apps.yml --force
# Output: "Tasker: force mode, re-processing..."

# 8. GitHub Pages has state.json (after push + deploy)
curl https://oxcl.github.io/relevance/fdroid.repo/state.json
# Returns the JSON

# 9. Linting passes
ruff check src/
```

---

## Phase 2: F-Droid Repo & Publishing

**Goal**: Set up a valid F-Droid repository on GitHub Pages. Use GHA cache to persist the `fdroid/repo/` directory between runs. When an app has no operations, publish it as-is.

**Why**: This phase establishes the publishing infrastructure. F-Droid repos have a specific structure: APKs in `repo/`, a signed `index-v1.jar` containing the repo index, and optional metadata. We use `fdroidserver` CLI (`fdroid update`) to generate the index — it scans APKs, extracts package info, permissions, and icons, then produces signed index files. The repo is deployed to GitHub Pages at `https://oxcl.github.io/relevance/fdroid.repo`.

The critical design decision is **incremental publishing via GHA cache**: the `fdroid/repo/` directory is cached between runs using `actions/cache`. On each run, we restore the cache (getting all previously deployed APKs), process only changed apps, then save the updated directory back to cache. This preserves skipped apps and enables version retention.

### 2.1 Keystore & Config

- [ ] Keystore via env vars: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`
- [ ] Error out immediately if either is missing
- [ ] Decode keystore to temp file on each run
- [ ] Generate `fdroid/config.yml` programmatically from `settings` in `apps.yml`
- [ ] `repo_url: https://oxcl.github.io/relevance/fdroid.repo`

### 2.2 Cache Restore

- [ ] At start of workflow: restore `fdroid/repo/` from GHA cache
- [ ] Cache key: `fdroid-repo-${{ hashFiles('apps.yml') }}` (exact match)
- [ ] Restore keys: `fdroid-repo-` (prefix match, gets latest)
- [ ] If no cache exists: first run, empty `fdroid/repo/`

### 2.3 Passthrough Publishing

For apps with no `operations` (or `operations` omitted/empty):
- [ ] Check if APK already exists in `fdroid/repo/` (from cache) AND is up-to-date (hash match in `state.json`)
- [ ] If up-to-date → skip
- [ ] If changed or new → download APK, copy to `fdroid/repo/`
- [ ] No re-signing — keep original developer signature
- [ ] Let `fdroid update` handle APK naming: `{package_id}_{versionCode}.apk`

### 2.4 Version Retention

- [ ] Setting in `settings`: `keep_versions: 2` (default: latest + 1 previous)
- [ ] After processing, group APKs in `fdroid/repo/` by `package_id`
- [ ] Sort by version code (extracted from filename)
- [ ] Delete APKs beyond `keep_versions` count

### 2.5 Index Generation

- [ ] Run `fdroid update --create-metadata` in `fdroid/` directory
- [ ] Generates: `index-v1.jar`, `index-v1.json`, icons, metadata stubs
- [ ] Add `.nojekyll` to output directory

### 2.6 Cache Save & Deploy

- [ ] Save `fdroid/repo/` to GHA cache (always unique key via `github.run_id`)
- [ ] Deploy `fdroid/repo/` to GitHub Pages

### 2.7 Main Workflow (updated)

```yaml
name: Build & Deploy
on:
  workflow_dispatch:
  schedule:
    - cron: '0 */12 * * *'

jobs:
  build:
    runs-on: ubuntu-latest
    container:
      image: ghcr.io/oxcl/relevance/build-env:latest
      credentials:
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    steps:
      - uses: actions/checkout@v4

      - name: Install relevance
        run: pip install .

      - name: Restore cached repo
        uses: actions/cache/restore@v5
        id: cache
        with:
          path: fdroid/repo/
          key: fdroid-repo-${{ hashFiles('apps.yml') }}
          restore-keys: fdroid-repo-

      - name: Decode keystore
        run: echo "$KEYSTORE_BASE64" | base64 -d > fdroid/keystore.p12
        env:
          KEYSTORE_BASE64: ${{ secrets.KEYSTORE_BASE64 }}

      - name: Build
        run: relevance --config apps.yml
        env:
          KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}

      - name: Generate F-Droid index
        working-directory: fdroid
        run: fdroid update --create-metadata
        env:
          KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}

      - name: Save repo cache
        if: always()
        uses: actions/cache/save@v5
        with:
          path: fdroid/repo/
          key: fdroid-repo-${{ github.run_id }}

      - name: Deploy to Pages
        if: success()
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./fdroid/repo
```

### 2.8 CLI Info Output

- [ ] After successful run, print:
  ```
  Repo URL: https://oxcl.github.io/relevance/fdroid.repo
  Fingerprint: SHA256:ABCD1234...
  Add: https://oxcl.github.io/relevance/fdroid.repo?fingerprint=ABCD1234...
  ```

### Verification Criteria

Phase 2 is complete when ALL of these pass:

```bash
# 1. Errors without env vars
unset KEYSTORE_BASE64 KEYSTORE_PASSWORD
relevance --config apps.yml
# Error: "KEYSTORE_BASE64 not set"

# 2. First run (empty cache)
export KEYSTORE_BASE64=... KEYSTORE_PASSWORD=...
relevance --config apps.yml
ls fdroid/repo/net.dinglisch.android.taskerm_*.apk

# 3. fdroid update produces index
cd fdroid && fdroid update
ls fdroid/repo/index-v1.jar

# 4. Index contains the app
python3 -c "import json; d=json.load(open('fdroid/repo/index-v1.json')); print([a['packageName'] for a in d['apps']])"

# 5. No re-signing — original signature preserved
apksigner verify fdroid/repo/net.dinglisch.android.taskerm_*.apk

# 6. .nojekyll exists
ls fdroid/repo/.nojekyll

# 7. Second run (cache restored)
relevance --config apps.yml
# Output: "Tasker: up to date"

# 8. APK preserved across runs
ls fdroid/repo/net.dinglisch.android.taskerm_*.apk

# 9. Version retention works

# 10. Fingerprint printed
relevance --config apps.yml
# Output includes fingerprint and add link

# 11. (After push) Pages serves repo
curl -I https://oxcl.github.io/relevance/fdroid.repo/index-v1.jar
# HTTP 200
```

---

## Phase 3: APKPure Source (with split APK handling)

**Goal**: Add APKPure as a download source using `apkeep` (primary) and `justapk` (fallback). Handle split APK formats (.xapk, .apks, .apkm) by merging them into single APKs with APKEditor.

**Why**: Direct URL (Phase 1) works for controlled downloads, but most apps need to be fetched from app stores. APKPure covers the vast majority of Play Store apps without requiring authentication. The challenge is that APKPure sometimes serves split APKs (.xapk) instead of single APKs, and F-Droid only accepts single APKs. We solve this with a merge step: download → detect format → merge if needed → single APK output.

Merged APKs lose their original signature (the merge modifies APK structure, invalidating v2/v3 signatures), so we must re-sign with our keystore. Apps with DRM/anti-tamper may fail after merge — those apps aren't suitable for our repo.

### 3.1 APKPure Download

- [ ] Implement `ApkPureSource.download()`:
  - Primary: `apkeep -a {package_id}` for latest
  - Primary with version: `apkeep -a {package_id}@{version}` for specific version
  - Fallback: `justapk download {package_id}` if apkeep fails
- [ ] Detect downloaded file type: `.apk` (ready), `.xapk`/`.apks`/`.apkm` (needs merge)
- [ ] Handle errors: app not found, network timeout, rate limiting
- [ ] Verify: download a known app (e.g., Telegram) from APKPure

### 3.2 Split APK Merge

- [ ] Implement `merge_split_apk()`:
  - `java -jar APKEditor.jar m -i input.xapk -o output.apk`
  - Handles `.xapk`, `.apks`, `.apkm` formats
  - After merge: re-sign with `uber-apk-signer --apks output.apk`
- [ ] If download is already `.apk` → skip merge, use as-is (no re-sign needed)
- [ ] If download is `.xapk`/`.apks`/`.apkm` → merge → re-sign → use merged APK
- [ ] If APKEditor merge fails → try `justapk download` as fallback (it auto-converts)
- [ ] Re-sign the justapk output with our keystore (justapk uses debug key by default)
- [ ] Verify: download an app known to serve .xapk, confirm merge produces valid APK

### 3.3 Version Handling

- [ ] `version: auto` (default, also when `version` is omitted) → get latest from APKPure
- [ ] `version: "X.Y.Z"` → pin to specific version via `apkeep -a pkg@version`
- [ ] Extract version code from downloaded APK for F-Droid filename

### 3.4 Keystore for Modified APKs

- [ ] One shared keystore for all modified APKs (merged + cloned, later phases)
- [ ] Provided via `KEYSTORE_BASE64` + `KEYSTORE_PASSWORD` env vars (same as F-Droid repo keystore)
- [ ] For merged APKs: re-sign with this keystore
- [ ] For passthrough APKs (no operations): keep original signature, no re-sign

### 3.5 Updated apps.yml

```yaml
settings:
  repo_name: "Relevance"
  repo_description: "Custom F-Droid repository"
  output_dir: "fdroid/repo"
  publish_original: true
  keep_versions: 2

apps:
  # Direct (existing)
  - name: "Tasker"
    package_id: "net.dinglisch.android.taskerm"
    source:
      type: direct
      url: "https://tasker.joaoapps.com/direct_purchase_download"

  # APKPure (latest)
  - name: "Telegram"
    package_id: "org.telegram.messenger"
    source:
      type: apkpure

  # APKPure (pinned version)
  - name: "Instagram"
    package_id: "com.instagram.android"
    source:
      type: apkpure
      version: "350.0.0.0.0"
```

### Verification Criteria

Phase 3 is complete when ALL of these pass:

```bash
# 1. APKPure source works (single APK, no merge needed)
relevance --config apps.yml --app "Telegram"
ls fdroid/repo/org.telegram.messenger_*.apk
apksigner verify fdroid/repo/org.telegram.messenger_*.apk

# 2. APKPure source works (split APK → merged)
relevance --config apps.yml --app "Instagram"
ls fdroid/repo/com.instagram.android_*.apk
apksigner verify fdroid/repo/com.instagram.android_*.apk

# 3. Merged APK is re-signed (not original developer signature)
# (verify it has our keystore signature, not the original)

# 4. Version pinning works
# (set version: "350.0.0.0.0" in apps.yml for Instagram)
relevance --config apps.yml --app "Instagram"
ls fdroid/repo/com.instagram.android_350000000*.apk

# 5. apkeep fallback to justapk works
# (simulate apkeep failure, e.g., rename apkeep binary)
relevance --config apps.yml --app "Telegram"
# Output: "Telegram: apkeep failed, falling back to justapk..."

# 6. justapk output is re-signed with our keystore
apksigner verify fdroid/repo/org.telegram.messenger_*.apk

# 7. Split APK merge failure → justapk fallback
# (corrupt or unmergeable .xapk)
relevance --config apps.yml --app "SomeApp"
# Output: "SomeApp: APKEditor merge failed, trying justapk fallback..."

# 8. Idempotent
relevance --config apps.yml
# All apps: "up to date"
```

---

## Phase 4: APK Cloning (Package Rename + App Name)

**Goal**: Modify an APK's package name and app name so it can be installed alongside the original app. No icon modifications yet.

**Why**: This is the first "modification" operation in the pipeline. Cloning exercises the full APK modification chain: decompile with apktool → modify smali/resources → recompile → sign. Package rename is the core of cloning — it changes the app's identity so Android treats it as a different app. App name change makes it distinguishable in the launcher. After this phase, the pipeline can produce installable variants of any APK.

### 4.1 Decompile & Recompile

- [ ] Implement `decompile_apk()`: `apktool d input.apk -o {work_dir}/`
- [ ] Implement `recompile_apk()`: `apktool b {work_dir}/ -o unsigned.apk`
- [ ] Work directory: `.cache/{package_id}/work/`
- [ ] Clean up work directory after successful recompile
- [ ] Verify: decompile → recompile → sign → valid APK

### 4.2 Package Name Change

The package name appears in multiple places — all must be updated:

- [ ] **AndroidManifest.xml**: `package="com.old.name"` → `package="com.new.name"`
- [ ] **apktool.yml**: set `renameManifestPackage: com.new.name`
- [ ] **Smali directory structure**: rename `smali/com/old/name/` → `smali/com/new/name/` (all `smali*` directories for multi-DEX)
- [ ] **Smali file contents**: find/replace `Lcom/old/name/` → `Lcom/new/name/` in all `.smali` files (class reference format)
- [ ] **Resource XML files**: find/replace `com.old.name` → `com.new.name` in `res/` XML files if referenced
- [ ] **ContentProvider authorities**: update `android:authorities` to use new package name
- [ ] Verify: cloned APK installs alongside original on device

### 4.3 App Name Change

- [ ] If `android:label="@string/app_name"` → edit `res/values/strings.xml`, change value to new name
- [ ] If `android:label="Literal Name"` → replace directly in manifest
- [ ] Handle localized strings: update `res/values-*/strings.xml` too (or leave original locale only)
- [ ] Verify: cloned app shows new name in launcher

### 4.4 Version Extraction

- [ ] Parse `apktool.yml` after decompile for `versionInfo.versionName` and `versionInfo.versionCode`
- [ ] Use version code for output filename: `{package_id}_{versionCode}.apk`
- [ ] Verify: output filename contains correct version code

### 4.5 Signing

- [ ] Zipalign: `zipalign -p 4 input.apk aligned.apk`
- [ ] Sign: `uber-apk-signer --ks keystore.p12 --ksKeyPass pass:xxx aligned.apk`
- [ ] Same shared keystore as merged APKs
- [ ] Verify: `apksigner verify` passes on output

### 4.6 Output

- [ ] Clone APK: `fdroid/repo/{new_package}_{version}.apk`
- [ ] Original APK: `fdroid/repo/{package_id}_{version}.apk` (if `publish_original: true`)
- [ ] Update `state.json` with new hashes
- [ ] Update F-Droid metadata with clone description (prepend `description_append` to auto-generated)

### 4.7 YAML Schema

```yaml
apps:
  - name: "Tasker Clone"
    package_id: "net.dinglisch.android.taskerm"
    source:
      type: direct
      url: "https://tasker.joaoapps.com/direct_purchase_download"
    operations:
      - type: clone
        new_package: "net.dinglisch.taskerm.clone"
        new_name: "Tasker Clone"
        description_append: "Cloned for parallel installation."
```

### 4.8 Description Generation

- [ ] Auto-generate clone description:
  ```
  Cloned variant of {original_name} ({original_package}) for parallel installation.

  Modifications applied:
  - Package renamed: {old_package} → {new_package}
  - App name changed to "{new_name}"
  - Re-signed with custom keystore

  Source: {original_name} v{version} ({source_type})
  ```
- [ ] If `description_append` is set, **prepend** it to the auto-generated description
- [ ] Verify: F-Droid metadata contains correct description

### Verification Criteria

Phase 4 is complete when ALL of these pass:

```bash
# 1. Clone produces valid APK
relevance --config apps.yml --app "Tasker Clone"
ls fdroid/repo/net.dinglisch.taskerm.clone_*.apk
apksigner verify fdroid/repo/net.dinglisch.taskerm.clone_*.apk

# 2. Package name changed
aapt dump badging fdroid/repo/net.dinglisch.taskerm.clone_*.apk | grep package
# package: name='net.dinglisch.taskerm.clone'

# 3. App name changed
aapt dump badging fdroid/repo/net.dinglisch.taskerm.clone_*.apk | grep application-label:
# application-label:'Tasker Clone'

# 4. Original APK also published
ls fdroid/repo/net.dinglisch.android.taskerm_*.apk

# 5. Both install side by side
adb install fdroid/repo/net.dinglisch.android.taskerm_*.apk
adb install fdroid/repo/net.dinglisch.taskerm.clone_*.apk
# Both installed, different apps in launcher

# 6. Description has user text prepended
# Check metadata/net.dinglisch.taskerm.clone.yml
# Contains: "Cloned for parallel installation." before auto-generated text

# 7. Idempotent
relevance --config apps.yml
# All apps: "up to date"

# 8. Linting passes
ruff check src/
```

---

## Phase 5: ReVanced Patching

**Goal**: Apply ReVanced patches to APKs. Support version auto-selection (recommended version from patches), recommended patches (default set), custom patch selection with namespacing, multiple bundles, patch options, and integration with clone.

**Why**: ReVanced is the most mature Android patching framework with ~288 patches covering YouTube, Reddit, Spotify, Facebook, and 50+ other apps. It modifies APK smali bytecode at build time — no root required. The CLI provides `list-versions` to find the best compatible version and `patch` to apply patches. After this phase, the pipeline can produce patched (and optionally cloned) APKs.

### 5.1 Patch Sources Config

```yaml
patch_sources:
  revanced:
    - name: "revanced"
      type: github_release
      repo: "ReVanced/revanced-patches"
      asset_pattern: "*.rvp"
    - name: "extended"  # optional extra bundle
      type: github_release
      repo: "SomeUser/revanced-patches-fork"
      asset_pattern: "*.rvp"
```

- [ ] Download all `.rvp` files from GitHub releases on each run (cached in `.cache/`)
- [ ] Always download latest tag (no version pinning for patches)
- [ ] `revanced-cli.jar` baked into Docker image
- [ ] All bundles loaded together when patching: `-bp bundle1.rvp -bp bundle2.rvp`
- [ ] Verify: `.rvp` files downloaded, `list-patches` works across all bundles

### 5.2 Patch Namespacing

When multiple bundles are loaded, patches are namespaced by bundle name:
- Bundle `revanced` → patches: `revanced::Hide ads`, `revanced::SponsorBlock`
- Bundle `extended` → patches: `extended::Hide ads`, `extended::Spoof streaming data`

- [ ] Parse `list-patches` output across all bundles, prefix with `{bundle_name}::`
- [ ] In `include`/`exclude`, user can specify:
  - `"Hide ads"` → matches from the first bundle that has it
  - `"extended::Hide ads"` → matches specifically from the `extended` bundle
- [ ] Ambiguity: if "Hide ads" exists in multiple bundles and no namespace specified → use first bundle's version, log warning
- [ ] Verify: namespaced patch listing works

### 5.3 Version Auto-Selection

When `version: auto` (default) and the app has a ReVanced patch operation:
- [ ] Before downloading, query across all bundles: `java -jar revanced-cli.jar list-versions -bp bundle1.rvp -bp bundle2.rvp -f {package_id}`
- [ ] Parse output → version with highest total patch count
- [ ] Override the APKPure source's default "get latest" behavior — use the recommended version instead
- [ ] Pass that version to APKPure source: `apkeep -a {package_id}@{version}`
- [ ] If apkeep fails → fallback to `justapk download {package_id}@{version}`
- [ ] If no compatible version found → log error, skip app
- [ ] If `version: "X.Y.Z"` pinned → use that, apply with `--force`
- [ ] If `version: latest` → get latest from source, apply with `--force`
- [ ] Verify: auto-selected version is downloaded and patched

### 5.4 Patch Application

- [ ] Implement `apply_revanced_patches()`:
  - **No include/exclude specified** → apply all default patches (ReVanced's recommended set, patches with `use: true`)
  - **Include specified** → `--exclusive -e "Patch1" -e "Patch2"`
  - **Exclude specified** → `-d "Patch1" -d "Patch2"`
  - **Both specified** → `--exclusive -e "Patch1" -d "Patch2"`
  - **Multiple bundles** → `-bp bundle1.rvp -bp bundle2.rvp`
  - **Force** → `-f` flag
  - **Patch options** → `-O "PatchName" "key=value"` (see 5.5)
- [ ] Parse output: track which patches succeeded and which failed
- [ ] If a patch fails → log warning, continue with remaining patches
- [ ] Verify: apply recommended patches to a known app

### 5.5 Patch Options

Some ReVanced patches have configurable options (e.g., `hide_ads_in_feed: true`).

- [ ] Support in YAML:
  ```yaml
  operations:
    - type: patch
      framework: revanced
      patches:
        include:
          - name: "Hide ads"
            options:
              hide_ads_in_feed: true
              hide_ads_in_player: false
          - name: "SponsorBlock"  # no options, use defaults
  ```
- [ ] Translate to CLI: `-e "Hide ads" -O "Hide ads" "hide_ads_in_feed=true" -O "Hide ads" "hide_ads_in_player=false"`
- [ ] If no options specified for a patch → use defaults (no `-O` flags)
- [ ] Verify: patch with custom options applied

### 5.6 Patch Failure Reporting

- [ ] Track: list of patches that succeeded and failed with error messages
- [ ] In auto-generated description, append:
  ```
  **Patches applied (8/10):**
  - Hide ads ✓
  - SponsorBlock ✓
  - Some patch ✗ (failed: <error message>)
  - ...
  ```
- [ ] Verify: failed patches appear in description

### 5.7 Operation Chaining

When both `patch` and `clone` are in `operations`:
- [ ] Execute in order: patch first, then clone
- [ ] Patched APK becomes input to clone
- [ ] Verify: patch → clone chain works

### 5.8 YAML Schema

```yaml
settings:
  repo_name: "Relevance"
  output_dir: "fdroid/repo"
  publish_original: true
  keep_versions: 2

patch_sources:
  revanced:
    - name: "revanced"
      type: github_release
      repo: "ReVanced/revanced-patches"
      asset_pattern: "*.rvp"

apps:
  # Recommended patches (default set)
  - name: "YouTube ReVanced"
    package_id: "com.google.android.youtube"
    source:
      type: apkpure
    # version: auto (default) → uses list-versions to find best version
    operations:
      - type: patch
        framework: revanced
        # No include/exclude → apply recommended patches
      - type: clone
        new_package: "com.google.youtube.revanced"
        new_name: "YouTube RV"
        description_append: "Patched with ReVanced."

  # Custom patch selection with options
  - name: "Reddit ReVanced"
    package_id: "com.reddit.frontpage"
    source:
      type: apkpure
    operations:
      - type: patch
        framework: revanced
        patches:
          include:
            - name: "Hide ads"
              options:
                hide_banner_ads: true
            - name: "Sanitize sharing links"
        force: false
      - type: clone
        new_package: "com.reddit.revanced"
        new_name: "Reddit RV"

  # Namespaced patch from specific bundle
  - name: "Spotify ReVanced"
    package_id: "com.spotify.music"
    source:
      type: apkpure
    operations:
      - type: patch
        framework: revanced
        patches:
          include:
            - "extended::Hide ads"  # specifically from extended bundle
      - type: clone
        new_package: "com.spotify.revanced"
        new_name: "Spotify RV"
```

### 5.9 Patched Description Auto-Generation

```jinja2
{{ description_append }}

**{{ app_name }}** v{{ version }}

**Patches applied ({{ success_count }}/{{ total_count }}):**
{% for patch in patches %}
- {{ patch.name }} {% if patch.succeeded %}✓{% else %}✗ ({{ patch.error }}){% endif %}
{% endfor %}

{% if clone %}
**Modifications:**
- Package renamed: {{ old_package }} → {{ new_package }}
- App name changed to "{{ new_name }}"
- Re-signed with custom keystore
{% endif %}

**Source:** {{ original_name }} v{{ version }} ({{ source_type }})
```

### Verification Criteria

Phase 5 is complete when ALL of these pass:

```bash
# 1. .rvp bundle downloaded
ls .cache/revanced/patches.rvp

# 2. list-patches works across all bundles
java -jar revanced-cli.jar list-patches -bp .cache/revanced/patches.rvp

# 3. list-versions works
java -jar revanced-cli.jar list-versions -bp .cache/revanced/patches.rvp -f com.google.android.youtube

# 4. Recommended patches applied (default set)
relevance --config apps.yml --app "YouTube ReVanced"
ls fdroid/repo/com.google.youtube.revanced_*.apk
apksigner verify fdroid/repo/com.google.youtube.revanced_*.apk

# 5. Custom patch selection works
relevance --config apps.yml --app "Reddit ReVanced"
# Only "Hide ads" and "Sanitize sharing links" applied

# 6. Version auto-selection uses list-versions
relevance --config apps.yml --app "YouTube ReVanced"
# Output: "YouTube ReVanced: recommended version 19.16.39 (42 patches)"

# 7. Patch failure reported in description
# Description shows: "Some patch ✗ (failed: ...)"

# 8. Patch + clone chain works
# Output has new package name + new app name

# 9. Multiple bundles loaded together
# (configure two bundles, verify both loaded)

# 10. Patch options work
# (set custom options for a patch, verify in CLI output)

# 11. Namespaced patches work
# (use "extended::Hide ads", verify correct patch applied)

# 12. Idempotent
relevance --config apps.yml
# All apps: "up to date"
```

---

## Phase 6: Web UI — Patch Browser

**Goal**: Generate a static HTML page listing all available ReVanced patches. Searchable, filterable, single HTML file, vanilla JS. Plus a landing page linking to the F-Droid repo and patch browser.

**Why**: When editing `apps.yml`, users need to know what patches exist, which apps they target, and what versions they support. Manually running `list-patches` CLI commands is tedious. The patch browser provides a browsable reference that's always up-to-date with the latest patch bundles. It's generated at build time and deployed alongside the F-Droid repo.

### 6.1 Data Collection

- [ ] For each `.rvp` bundle in `patch_sources.revanced`:
  - Run: `java -jar revanced-cli.jar list-patches --packages --versions --options -bp bundle.rvp`
  - Parse output into structured data:
    ```json
    {
      "name": "Hide ads",
      "bundle": "revanced",
      "description": "Hides ads in the app.",
      "default": true,
      "compatible_packages": [
        {
          "name": "com.google.android.youtube",
          "versions": ["19.16.39", "19.15.36"]
        }
      ],
      "options": []
    }
    ```
- [ ] Collect all patches across all bundles into a single list
- [ ] Verify: parsing produces correct structured data

### 6.2 Patch Browser HTML

- [ ] Generate `patch-browser.html` — single file, all CSS/JS inlined
- [ ] **Summary bar** at top: "288 patches across 52 apps" (from data)
- [ ] **Table columns**: Patch Name, Bundle, Target App, Compatible Versions, Default (✓/✗), Description
- [ ] **Search**: Text input, filters across all columns in real-time
- [ ] **Filters**: Dropdowns for Bundle (if multiple), Target App
- [ ] **Sort**: Click column headers to sort ascending/descending
- [ ] **Links**: Patch name links to source code on GitHub
- [ ] **Timestamp**: "Last updated: 2026-05-29 12:00 UTC"
- [ ] **Responsive**: Works on mobile (horizontal scroll on table)
- [ ] Vanilla JS, no dependencies
- [ ] Verify: open in browser, search/filter/sort works

### 6.3 Landing Page

- [ ] Generate `index.html` — simple page with links to:
  - F-Droid repo URL: `https://oxcl.github.io/relevance/fdroid.repo`
  - Patch browser: `patch-browser.html`
  - GitHub repo: `https://github.com/oxcl/relevance`
  - Repo name and description from `settings`
- [ ] Minimal styling, clean design
- [ ] Verify: open in browser, links work

### 6.4 Deployment

- [ ] Both files placed in `fdroid/repo/`:
  ```
  fdroid/repo/
  ├── index.html            # Landing page
  ├── patch-browser.html    # Patch browser
  ├── index-v1.jar          # F-Droid index
  ├── state.json
  └── *.apk
  ```
- [ ] Accessible at:
  - `https://oxcl.github.io/relevance/fdroid.repo/`
  - `https://oxcl.github.io/relevance/fdroid.repo/patch-browser.html`
- [ ] Verify: both pages accessible after deploy

### 6.5 CLI Integration

- [ ] `relevance --config apps.yml` generates patch browser as part of the pipeline
- [ ] `relevance --config apps.yml --skip-browser` to skip HTML generation
- [ ] Verify: HTML files generated alongside APKs

### Verification Criteria

Phase 6 is complete when ALL of these pass:

```bash
# 1. Patch data collected
relevance --config apps.yml --dry-run
# Output shows: "Found 288 patches across 52 apps"

# 2. Patch browser generated
ls fdroid/repo/patch-browser.html
# File is non-empty, contains HTML

# 3. Landing page generated
ls fdroid/repo/index.html
# File is non-empty, contains links

# 4. Patch browser has correct data
grep "Hide ads" fdroid/repo/patch-browser.html
# Patch name appears in the HTML

# 5. Search works (manual)
# Open patch-browser.html in browser
# Type "YouTube" in search → filters to YouTube patches only

# 6. Filters work (manual)
# Select "com.google.android.youtube" from app filter → shows only YouTube patches

# 7. Sort works (manual)
# Click "Patch Name" column → sorts alphabetically

# 8. Summary shows correct counts
# "288 patches across 52 apps" at top

# 9. Timestamp shown
# "Last updated: 2026-05-29 12:00 UTC"

# 10. Landing page links work
# Open index.html → click F-Droid link → goes to repo
# Click Patch Browser link → goes to patch-browser.html

# 11. (After push) Pages serves both pages
curl -I https://oxcl.github.io/relevance/fdroid.repo/patch-browser.html
# HTTP 200
curl -I https://oxcl.github.io/relevance/fdroid.repo/
# HTTP 200
```
