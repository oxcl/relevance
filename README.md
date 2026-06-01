# Relevance

A declarative Android app patcher and F-Droid repository builder.

Define your apps in a single YAML file. Relevance downloads, patches, clones,
and publishes them as an F-Droid repository on GitHub Pages — automatically,
idempotently, and on a schedule.

## What It Does

Relevance takes a declarative list of Android apps and turns them into a
self-hosted F-Droid repository. For each app, it can:

- **Download** the APK from multiple sources with automatic fallback
- **Patch** it using ReVanced, Morphe, Piko, or Xposed module injection
- **Clone** it with a new package name, app name, and custom icon
- **Publish** the original and modified versions to an F-Droid repo

The pipeline runs on a GitHub Action schedule. It's idempotent — apps are only
re-processed when the source APK or the config changes. Everything is driven by
a single `apps.yml` file.

## Features

### Declarative Configuration

Everything lives in one YAML file. No scripts, no manual steps. Add an app, run
the action, it appears in your F-Droid repo.

```yaml
apps:
  - name: "YouTube ReVanced"
    package_id: "com.google.android.youtube"
    source:
      type: apkpure
    operations:
      - type: patch
        framework: revanced
      - type: clone
        new_package: "com.google.youtube.revanced"
        new_name: "YouTube RV"
        icon:
          mode: badge
          badge:
            text: "RV"
            position: bottom_right
            bg_color: "#FF0000"
            text_color: "#FFFFFF"
```

### APK Sources

Download APKs from multiple sources with automatic fallback:

| Source | Description |
|--------|-------------|
| Direct URL | Download from any direct link |
| GitHub Releases | Smart APK detection from release assets |
| APKPure | Via apkeep, with justapk fallback |
| F-Droid | Official F-Droid repository |
| Aptoide | Aptoide REST API |
| Uptodown | Reverse-engineered mobile API |
| Google Play | Via Aurora Store token dispenser |
| Huawei AppGallery | Direct download API |

Sources can be chained for fallback:

```yaml
source:
  type: [apkpure, fdroid, uptodown]
```

### Patching

Apply patches from multiple frameworks:

| Framework | Type | Apps Covered |
|-----------|------|-------------|
| **ReVanced** | Static bytecode patching | YouTube, Reddit, Spotify, Twitter, Instagram, 50+ more |
| **Morphe** | Static bytecode patching | YouTube, YouTube Music, Reddit |
| **Piko** | Static bytecode patching (via Morphe) | Twitter/X, Instagram |
| **ZenPatch** | Xposed module injection | Any app with an Xposed module |
| **LSPatch** | Xposed module injection (fallback) | Same as ZenPatch |

Patch features:
- **Version auto-selection**: Automatically picks the app version supported by
  the most patches
- **Recommended patches**: Apply the default patch set, or cherry-pick specific
  patches
- **Multiple bundles**: Load patches from multiple sources simultaneously,
  namespaced by bundle name
- **Patch options**: Configure individual patch settings
- **Failure resilience**: Failed patches are skipped and reported in the
  description, not treated as errors

### App Cloning

Modify APKs so they install alongside the originals:

- **Package rename**: Change the Android package name across manifest, smali
  files, and resource references
- **App name**: Change the display name shown in the launcher
- **Icon badge**: Overlay a text badge on the original icon with configurable
  position, colors, and size
- **Custom icon**: Replace the icon entirely with a custom image
- **Icon filters**: Apply image filters (grayscale, tint, round corners,
  brightness, contrast, blur, invert, mirror)
- **All densities**: Automatically generates icons for all Android density
  buckets (mdpi through xxxhdpi)

### Split APK Handling

Modern app stores serve split APKs (.xapk, .apks, .apkm). Relevance handles
them transparently:

1. Downloads the split format from the source
2. Detects whether it's a single APK or a split bundle
3. Merges splits into a single installable APK using APKEditor
4. Re-signs with the project keystore
5. Publishes the merged APK to F-Droid

### F-Droid Repository

The output is a valid F-Droid repository hosted on GitHub Pages:

- Signed index (`index-v1.jar`) for the F-Droid client
- Per-app metadata with auto-generated descriptions
- Descriptions include details of all patches applied and modifications made
- Original (unmodified) APKs published alongside patched versions
- Configurable version retention (keep latest N versions per app)
- Repo URL: `https://oxcl.github.io/relevance/fdroid.repo`

### Web UI

A searchable, filterable patch browser is generated at build time and deployed
alongside the F-Droid repo:

- Lists all available ReVanced patches across all loaded bundles
- Filter by target app, bundle, or framework
- Search across patch names, descriptions, and compatible versions
- Shows compatible app versions for each patch
- Summary statistics (total patches, total apps)

Plus a landing page linking to the F-Droid repo, patch browser, and project
source.

### Idempotency

The pipeline is designed to run repeatedly without waste:

- **Source hash**: SHA-256 of the downloaded APK — detects upstream updates
- **Config hash**: SHA-256 of the app's YAML entry — detects config changes
- **Skip when unchanged**: Apps are only re-processed when either hash changes
- **Force override**: `--force` flag bypasses hash checks for manual re-runs

### CI/CD

The entire pipeline runs as a GitHub Action:

- **Scheduled**: Every 12 hours by default (configurable)
- **Manual dispatch**: Trigger on-demand from the Actions tab
- **Docker environment**: Pre-built image with all tools (Java, Python,
  fdroidserver, apktool, ReVanced CLI, APKEditor, apkeep)
- **Cached state**: F-Droid repo directory cached between runs
- **GitHub Pages**: Automatic deployment on each successful run

## Architecture

```
apps.yml  →  Download  →  Patch  →  Clone  →  F-Droid Repo  →  GitHub Pages
              (sources)   (revanced)  (rename)    (fdroidserver)    (deploy)
                          (morphe)    (icon)
                          (xposed)    (sign)
```

## Getting Started

See [TODO.md](TODO.md) for the implementation plan and current progress.

## License

[License TBD]
