# Agents Guide — Relevance (OpenCode + Morphe Pipeline)

## Project Overview

Relevance is an automated Android app patcher and F-Droid repository builder driven by an **OpenCode** agent running **DeepSeek V4.1 Flash** (`opencode-go/deepseek-v4.1-flash`) on GitHub Actions.

On each scheduled run (every 1 day) or manual dispatch:
1. The OpenCode agent reads `apps.yaml` (including each app's natural-language `agent_instructions` and `variants`).
2. It checks the latest versions supported by official **Morphe Patches** (`MorpheApp/morphe-patches`) and available via **`apkeep`** (`apk-pure` by default), comparing them against previously patched versions in `fdroid/repo/state.json`.
3. When a newer version is available (or when an app/variant has not been built yet, or `--force` is requested):
   - It fetches the APK using `apkeep` (merging split `.xapk` bundles via `APKEditor` if needed).
   - It generates any required custom icons (such as `YouTube AM`, `YouTube RU`, and `YouTube DE` with the Armenia, Russia, and Germany flags replacing the red YouTube background).
   - It patches each variant using **Morphe CLI** (`MorpheApp/morphe-desktop` + `MorpheApp/morphe-patches`), applying the default selected and recommended Morphe patches by default, plus `Clone app` and `Custom branding` for side-by-side variants.
   - It signs the APKs with the repository keystore (`KEYSTORE_BASE64` / `KEYSTORE_PASSWORD`).
4. It verifies the output APKs on a live **Android Emulator** (`adb`) in GitHub Actions:
   - Installs `MorpheApp/MicroG-RE` (`GmsCore`).
   - Installs all patched APK variants simultaneously to verify side-by-side installation (`app.morphe.android.youtube`, `app.morphe.android.youtube.am`, `app.morphe.android.youtube.ru`, `app.morphe.android.youtube.de`).
   - Launches each app on the emulator and checks `logcat` for fatal exceptions.
5. It updates the signed F-Droid repository (`fdroid update --create-metadata`) and web UI in `fdroid/repo/`, which is deployed to GitHub Pages (`https://oxcl.github.io/relevance`).

## CLI Commands for the Agent

```bash
# 1. Check whether any app/variant in apps.yaml has a newer Morphe-supported version available
python3 -m src.main check-updates --config apps.yaml

# 2. Run the full pipeline (fetch -> merge -> Morphe patch -> Emulator test -> F-Droid index)
python3 -m src.main run --config apps.yaml --test-emulator

# 3. Force rebuild even if state.json is up-to-date
python3 -m src.main run --config apps.yaml --force --test-emulator

# 4. Generate a Morphe custom icon directory for a country flag
python3 -m src.main generate-icon --country AM --output /tmp/icon_am

# 5. Test existing APKs in fdroid/repo on the connected Android Emulator
python3 -m src.main test-emulator --repo-dir fdroid/repo
```

## Customizing via `apps.yaml`

Each entry in `apps.yaml` supports an `agent_instructions` field where the user can specify in plain English what variants, icons, names, or patch tweaks they want. If `agent_instructions` requests new variants or custom icon styles not yet reflected in `variants:` or `src/icons.py`, update `apps.yaml` / `src/icons.py` accordingly before running `python3 -m src.main run --config apps.yaml --test-emulator`.
