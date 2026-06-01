# Implementation Guide

This document describes the architecture, design decisions, and implementation
approach for Relevance. It's intended for developers working on the codebase.

## Overview

Relevance is a pipeline that reads a declarative YAML config, processes Android
APKs, and publishes them as an F-Droid repository. The pipeline is idempotent,
containerized, and runs on GitHub Actions.

## Core Design Principles

### Orchestrator Pattern

The main module drives the entire pipeline. It's the only component that knows
the full sequence of steps. Each step delegates to a focused module (sources,
operations, tools). This keeps individual modules simple and testable — they
don't know about each other.

The orchestrator handles:
- Iterating over apps
- Checking idempotency (skip unchanged apps)
- Resolving versions (including querying patches for recommended versions)
- Chaining operations (patch → clone)
- Collecting errors per-app without stopping the pipeline
- Generating summary output

### Declarative Configuration

Everything is driven by `apps.yml`. The config is parsed into Pydantic models
that validate types, apply defaults, and provide clear error messages on invalid
input. The serialized Pydantic model (JSON with sorted keys) is used for
deterministic hash computation — this ensures config changes are detected
regardless of YAML formatting.

### Idempotency

Two hashes per app determine if processing is needed:
- **Source hash**: SHA-256 of the downloaded APK file — detects upstream changes
- **Config hash**: SHA-256 of the serialized Pydantic model for that app entry
  — detects any change in the YAML config

Both hashes are stored in `state.json` inside the F-Droid repo directory. This
file is persisted between runs via GitHub Actions cache. If both hashes match,
the app is skipped. The `--force` flag bypasses this check.

### Graceful Error Handling

Errors are collected per-app, not thrown. If one app fails (download error,
patch failure, merge failure), the pipeline logs the error and continues with
the next app. A summary is printed at the end showing successes and failures.
The exit code is 0 only if all apps succeeded.

### Tool Management

External tools (apktool, uber-apk-signer, APKEditor, revanced-cli, apkeep)
are either:
- Pre-installed in the Docker image (for CI)
- Auto-downloaded on first run and cached in a tools directory (for local dev)

The tools directory is configurable via environment variable, defaulting to
`.tools/` in the project root. The tool manager checks system PATH first,
then falls back to the cached tools. Operations receive tool paths from the
tool manager — they never worry about where tools are.

## Data Flow

```
apps.yml
  → Parse + validate (config.py)
  → Load previous state (cache.py)
  → For each app:
      → Check hashes (cache.py)
      → Resolve version (may query patches)
      → Download APK (sources/)
      → Verify integrity (integrity.py)
      → Merge if split (merge/)
      → Apply operations in order:
          → Patch (operations/patch/)
          → Clone (operations/clone/)
      → Copy to output (fdroid.py)
      → Update state (cache.py)
  → Generate F-Droid index (fdroid.py)
  → Generate web UI (web.py)
  → Save state (cache.py)
  → Deploy to GitHub Pages
```

## Key Modules

### config.py

Parses `apps.yml` into Pydantic models. Handles environment variable references
(e.g., `${KEYSTORE_PASSWORD}`). Provides validation and clear error messages.

### sources/

Each source implements a common interface for downloading APKs. The base class
accepts the standard parameters (package_id, version, destination) plus a
generic key-value dict for source-specific configuration. This allows different
sources to have different options without changing the interface.

Source implementations:
- **direct.py**: HTTP download with redirect following
- **github_release.py**: GitHub API with smart APK detection heuristics
- **apkpure.py**: apkeep (primary) with justapk (fallback)
- **auto.py**: Tries multiple sources in order, first success wins

### operations/patch/

Handles ReVanced patching. Responsibilities:
- Download and cache `.rvp` patch bundles
- Query `list-versions` for recommended compatible version
- Apply patches with include/exclude filtering, force flag, and options
- Track which patches succeeded/failed for description generation
- Support multiple bundles with namespaced patch references

### operations/clone/

Handles APK cloning (package rename, app name change). Responsibilities:
- Decompile with apktool
- Modify package name across manifest, smali files, and resources
- Modify app name in strings or manifest
- Recompile with apktool
- Sign with uber-apk-signer

### operations/clone/icon.py

Handles icon manipulation. Supports three modes:
- **badge**: Text overlay with configurable position, colors, and size
- **custom_image**: Replace icon with a repo image file
- **filter**: Chain PIL filters (grayscale, tint, round_corners, etc.)

Generates icons for all Android density buckets.

### merge/

Handles split APK formats (.xapk, .apks, .apkm). Uses APKEditor to merge
splits into a single APK, then re-signs. Falls back to justapk if APKEditor
fails.

### fdroid.py

Manages the F-Droid repo structure. Generates `config.yml` programmatically
from the app config. Wraps `fdroid update` via subprocess to generate the
signed index. Handles version retention (deleting old APKs beyond the
configured limit).

### cache.py

Manages state persistence. Computes hashes (source APK + config). Reads/writes
`state.json`. The state file lives in the F-Droid repo directory and is
persisted between runs via GitHub Actions cache.

### web.py

Generates two HTML files:
- **patch-browser.html**: Searchable, filterable table of all ReVanced patches
  across all loaded bundles. Data embedded as JSON in the HTML. Vanilla JS for
  search/filter/sort.
- **index.html**: Landing page with links to the F-Droid repo, patch browser,
  and GitHub project.

### integrity.py

Verifies downloaded APKs:
- APK signature validity (v1/v2/v3)
- Package name matches expected `package_id`
- Hash verification (if hash provided in config)

## Important Directories

- `src/` — All Python source code
- `docker/` — Dockerfile for CI build environment
- `.github/workflows/` — GitHub Actions workflow files
- `.cache/` — Runtime cache (downloaded APKs, work directories, patch bundles)
- `.tools/` — Downloaded external tools (JARs, binaries)
- `fdroid/` — F-Droid repo output (deployed to GitHub Pages)
- `fdroid/repo/` — APKs, index files, state.json, web UI HTML
- `fdroid/metadata/` — Auto-generated per-app metadata YAML

## Environment Variables

- `KEYSTORE_BASE64` — Base64-encoded PKCS12 keystore for signing
- `KEYSTORE_PASSWORD` — Keystore password
- `RELEVANCE_TOOLS_DIR` — Override tools directory (default: `.tools/`)

## GitHub Actions Architecture

Two workflows:

1. **Docker build** (`docker-build.yml`): Builds and pushes the CI environment
   Docker image to GHCR. Triggered when the Dockerfile changes. Contains Java,
   Python, fdroidserver, apktool, uber-apk-signer, APKEditor, revanced-cli,
   apkeep, and justapk.

2. **Build & Deploy** (`build.yml`): Runs the relevance pipeline. Uses the
   Docker image as the job container. Restores `fdroid/repo/` from GHA cache,
   processes apps, generates index and web UI, saves cache, deploys to Pages.

The GHA cache uses `restore-keys` prefix matching to always get the latest
available cache, even when `apps.yml` changes. The save key uses `run_id`
(always unique) so each run creates a fresh cache entry. Old entries evict
after 7 days.

## Design Decisions

1. **Orchestrator over pipeline framework**: The pipeline is simple enough that
   a single orchestrator module is clearer than a generic pipeline framework.

2. **Pydantic models over raw dicts**: Type validation, defaults, and clear
   error messages are worth the dependency.

3. **Subprocess over Python API for fdroidserver**: The Python API isn't
   well-documented as a library. Subprocess is simpler and more reliable.

4. **Docker over nix for CI**: Docker images are universally supported on CI
   platforms. Nix is used locally for reproducibility on the dev machine.

5. **GHA cache over gh-pages checkout**: Cache is simpler, doesn't require
   checking out a separate branch, and handles the "no previous state" case
   gracefully.

6. **Namespace patches by bundle name**: When multiple patch bundles are loaded,
   patches are prefixed with `{bundle_name}::`. This avoids ambiguity when
   different bundles have patches with the same name.

7. **Orchestrator resolves versions**: The version resolution step (querying
   patches for recommended version) happens in the orchestrator, not in the
   source. Sources only know about downloading — they don't know about patches.

8. **Serialized Pydantic for config hashing**: Hashing the JSON-serialized model
   (with sorted keys) is deterministic regardless of YAML formatting, comments,
   or whitespace.
