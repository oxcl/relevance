# Agents Guide

## Project Overview

Relevance is a declarative Android app patcher and F-Droid repository builder.
It reads `apps.yml`, downloads APKs, applies patches (ReVanced), clones apps
(package rename, app name, icon), and publishes the results as an F-Droid
repository on GitHub Pages.

See [README.md](README.md) for what the project does.
See [IMPLEMENTATION.md](IMPLEMENTATION.md) for architecture and design decisions.

## Project Structure

- `src/` — All Python source code
- `src/main.py` — CLI entry point + orchestrator
- `src/config.py` — YAML parsing, Pydantic models
- `src/sources/` — APK download backends (direct, github_release, apkpure, auto)
- `src/operations/patch/` — ReVanced patching
- `src/operations/clone/` — Package rename, app name, icon manipulation
- `src/merge/` — Split APK merging (APKEditor, justapk)
- `docker/` — Dockerfile for CI build environment
- `.github/workflows/` — GitHub Actions workflow files

## Code Conventions

- Python 3.12+, type hints everywhere
- Pydantic models for config and data validation
- Ruff for formatting and linting
- No comments unless explicitly asked
- Error handling: collect per-app errors, don't throw — the pipeline continues
  on failure and reports a summary at the end

## How to Run

This project uses direnv-nix. Any shell you start will automatically be in the
nix dev environment — no need to explicitly use `nix-shell`.

```bash
# Install the package
pip install -e .

# Run the pipeline
relevance --config apps.yml

# Dry run (parse config, show plan, don't execute)
relevance --config apps.yml --dry-run

# Force re-process everything (ignore idempotency)
relevance --config apps.yml --force

# Lint
ruff check src/

# Type check
mypy src/

# Validate GitHub Actions workflows
actionlint

# Build Docker image
docker build -f docker/Dockerfile -t relevance-build .
```

## Key Design Decisions

- **Orchestrator pattern**: `main.py` drives the full pipeline. Individual
  modules (sources, operations, tools) are independent and don't know about
  each other.
- **Pydantic for config**: All YAML parsing goes through Pydantic models.
  The serialized model (JSON, sorted keys) is used for config hashing.
- **Subprocess for fdroidserver**: We call `fdroid update` via subprocess, not
  the Python API.
- **Sources/operations are independent**: Each source and operation implements
  a common interface. The orchestrator chains them together.
- **Graceful errors**: Per-app errors are collected, not thrown. The pipeline
  continues and reports a summary.

## External Tools

Tools are pre-installed in the Docker image (CI) or auto-downloaded on first
run (local dev). The tool manager checks system PATH first, then falls back to
the tools directory.

- `apktool.jar` — decompile/recompile APKs
- `uber-apk-signer.jar` — zipalign + sign APKs
- `APKEditor.jar` — merge split APKs
- `revanced-cli.jar` — ReVanced patching
- `apkeep` — APKPure downloader (Rust binary)
- `justapk` — APKPure downloader (Python, fallback)

## Environment Variables

- `KEYSTORE_BASE64` — Base64-encoded PKCS12 keystore
- `KEYSTORE_PASSWORD` — Keystore password
- `RELEVANCE_TOOLS_DIR` — Override tools directory (default: `.tools/`)

## Search When Stuck

When unsure about how to proceed or stuck on a problem, **always use your
search tools to search the problem on the internet and get the latest
information**. Do not rely on potentially outdated training data.

Also remember to **occasionally do a web search** for what you are doing anyway,
even when not stuck — to ground your implementation and fact-check your
assumptions. APIs change, tools get updated, and best practices evolve.

## Review and Commit Workflow

After every task is done and every phase is done:

1. **Review your changes** — read through the code you wrote
2. **Clean up** — remove dead code, simplify where possible, improve naming
3. **Verify** — run the code, test it, check edge cases
4. **Fix issues** — address anything that's broken or could break
5. **Commit** — make a clean git commit with a descriptive message
6. **Continue** — move to the next task

Do not skip the review step. Do not commit broken code. Do not move on without
verifying.

## References

- [README.md](README.md) — What the project is
- [IMPLEMENTATION.md](IMPLEMENTATION.md) — Architecture and design decisions
- [TODO.md](TODO.md) — Implementation plan and progress
