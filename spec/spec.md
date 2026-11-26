# Relevance — Project Spec

Nov 26, 2026 · @Azad

## Essence

Relevance is a free web app, usable on phone and desktop, where users apply modifications to Android apps. The builds run in the user's own GitHub Actions and the results are published to the user's own GitHub as a custom F-Droid repository plus a static app-store website on GitHub Pages. Relevance keeps the apps and their patches automatically updated. Relevance itself stores no APKs, and the legal responsibility for what is built sits with the user. Relevance is intentionally static and client side: all of a user's data lives in one GitHub repository they choose, and the server is only thin glue code.

## Overview

A user signs in and connects their GitHub. They add an app by choosing where its APK comes from: a third-party app store, a direct upload, a direct URL, GitHub Releases, or possibly F-Droid. They then choose one patching tool for the app (ReVanced, Morphe, or LSPatch for Xposed modules) and pick patches from it, plus any custom extra patches for that tool. They can also make basic changes that need no patch, such as renaming the app or editing its icon. The user's GitHub Actions then decompile, patch, repack and sign the APK and publish it to the user's GitHub.

For supported sources, Relevance keeps the app and its patches up to date. It picks the newest app version that the selected patches support rather than the absolute latest, for stability. Apps uploaded directly are updated by hand.

A user's apps appear in their own F-Droid repository and their own static store website, both on their GitHub and under their control, including the domain. The whole output is static files, so users can also download it as a zip. On Relevance's website, a user's apps are visible only to that user while signed in. When a build fails or an update changes what the user picked, Relevance tells the user by email, inside Relevance, and with a warning in the app's description in F-Droid.

## Parts

### Platform and pricing

- A public web app that runs in the browser, on both phone and desktop.
- Material 3 inspired UI with rich interaction animations and transition states.
- Free. No paid tiers for now.

### Visual style

- Warm Material 3 style: cream and warm-sand backgrounds, muted terracotta and olive green accents, soft rounded cards with gentle shadows.
- Each page has its own soft, hand-drawn watercolor illustration in faded tones, such as a calm landscape with hills and a blossoming tree.
- Use the Roboto font, with bold, confident headlines. Version numbers and package names in a small monospace font.
- Pill-shaped buttons, filter chips with counts, and app icons on rounded tiles.
- The feel: cozy, honest, calm, well-crafted.
- Both a light mode and a dark mode.
- Reference images of the main screens accompany this spec. Use them to understand the general layout, structure and especially the vibe, not as exact designs to reproduce. They were made with an AI image generator, so they may not be 100% accurate.

### Hosting

- Most of Relevance is intentionally static and runs client side, including the main website.
- The server is minimal and thin: only glue code that makes the static parts work, such as completing Sign in with GitHub, relaying live build logs and sending notification emails. It keeps no state of its own.
- The web app and its thin server are hosted on Cloudflare.
- APK builds do not run on Relevance's infrastructure. They run in the user's own GitHub Actions.

### Accounts and GitHub

- Users sign in with GitHub. There is no separate email and password account.
- Each user has one GitHub repository for Relevance: either Relevance creates a new one or the user picks an existing one. The user chooses whether the repository is public or private. If they choose private, Relevance warns them that the F-Droid repository, the store site and direct downloads will not work, because they require a public repository. If they choose public, Relevance shows a warning that the repository's contents, such as the app list and configuration, are publicly visible. Signing keys always stay secret. Relevance works only inside that repository and puts everything there: all the state and data it needs, the build workflows (GitHub Actions), the F-Droid repository and the store site (GitHub Pages).
- GitHub is the only supported provider for now.
- The connection to GitHub sits behind a clean abstraction, so GitLab, Codeberg and other static hosting providers can be added later.
- Relevance does not store APKs.
- Relevance shows users a warning that they are responsible for the legal risk of what they build and publish.

### First sign-in and account deletion

- The first sign-in is a guided setup:
  1. Create a new repository or pick an existing one, and choose public or private, with the matching warning.
  2. Generate the signing key, or supply one.
  3. Show the legal-risk warning.
  4. Show the F-Droid repository link and a QR code for adding it in F-Droid.
- When a user deletes their Relevance account, their GitHub repository is left untouched.

### App sources

- When adding an app, the user gives Relevance a URL for where to get the APK. There is no search.
- Supported sources:
  - The API of a third-party app store, such as APKPure, using a URL from that store.
  - A direct APK upload.
  - A direct URL to an APK.
  - GitHub Releases of a repository.
  - Possibly F-Droid.
- Google Play is not supported unless a very stable, trusted, working API exists for it.
- Sources that can be checked automatically drive automatic updates. Direct uploads are updated by hand.
- An app can be added with no modification at all. Relevance then works like a normal app store or F-Droid repository, passing on each new release with automatic updates. This needs no special handling: companion apps such as GmsCore (microG) are added this way from their GitHub Releases.

### Patch sources

- Each app uses exactly one patching tool: ReVanced, Morphe, or LSPatch (Xposed modules). Tools are never mixed on one app, because mixing is too unstable. Relevance shows which patches each tool offers for the app, so the user can choose a tool.
- Support as many existing patch ecosystems as makes sense, including ReVanced repositories, Morphe repositories and Xposed modules. Xposed modules are embedded into the APK with LSPatch, so they work without root.
- Users can add custom patch repositories, and add custom extra patches to an app on top of its chosen tool.
- Users can configure patch options, for example the name and icon for a custom branding patch, or a patch's toggles.

### Add app flow

- Six steps: Source → Tool → Patches → Customize → Store listing → Review. The Store listing step, after Customize, is where the user edits the app's description, details and screenshots for the store site.
- Tool step: one large card per patching tool (ReVanced, Morphe, LSPatch). Each card shows how many patches the tool has for this app, a "See available patches" button that opens a dialog listing them, and the newest app version it supports. A tool with no patches for this app stays enabled, because the user can provide custom patches. There is also a "No patching" option, for when the user only wants to clone an app and change its package name, name or icon; choosing it skips the Patches step and goes straight to Customize. The user picks exactly one option.
- Patches step: a list of the chosen tool's patches, then a section for custom extra patches, plus a summary of the selected count and the target version with the pin option.
- Users can switch an existing app to a different tool later. Its patches are then selected again from scratch.

### Basic modifications

- Changes Relevance makes itself by decompiling the APK, with no patch needed:
  - Rename the app.
  - Change the icon with a rich built-in icon editor, similar to App Cloner.
  - Upload a custom icon instead.
- The icon editor includes:
  - Hue and other basic image edits, such as brightness and saturation.
  - A large live preview, with smaller previews below it at different sizes.
  - Badges: a few preselected badges plus a button to pick from a collection of icons. The badge's foreground and background colors can be changed, it can have a border around the badge icon and a border around its circle, and it can be placed in any corner.
  - Text overlay: text foreground and background colors, position, size, text border, and the border of the text's rectangle box.
- A user can apply only these changes and no patches at all.
- Users can have several variants of the same app, for example multiple YouTube builds (cloning). Each variant gets a different package name, so variants install side by side with each other and with the original app.

### Building and signing

- The user's GitHub Actions decompile, patch, repack and sign the APK, and publish it to the user's GitHub.
- By default Relevance generates a signing key for each user and keeps it securely in their GitHub repository.
- Users can supply their own signing keys instead.
- An app with no patches, no modifications and no change of name or package name keeps its original signature. It is not decompiled or re-signed, only published as is.

### Automatic updates

- Relevance checks daily for updates to apps and patches, for supported sources.
- Users can also check for updates or trigger a rebuild by hand.
- Relevance knows which app versions each selected patch supports. It picks the newest app version that all selected patches support, rather than the absolute latest.
- Users can pin an app to a specific version instead.
- Each app's patch selection is saved and reused for every update.
- If a build fails, or a new version no longer matches the saved selection, the app stays on its last good build until the user acts.

### Build progress, history and logs

- While an APK builds, Relevance shows a rich, real-time progress view with a progress bar.
- Every build step is shown by name, for example decompiling or patching with ReVanced, in an accordion similar to GitHub Actions.
- Each step can be expanded to show its exact log.
- Users can cancel a running build.
- Log text is live and real time while each step runs, not only after it finishes. Thin backend glue may be used to achieve this.
- Each app keeps a build history, with the logs of past builds.

### Dashboard

- A Needs attention list at the top: apps whose last build failed, or whose new version no longer matches the saved patch selection.
- Shows the builds (GitHub Actions) that are currently running.
- Shows the user's apps.
- Shows the custom patch repositories the user has added.

### Settings

- Notification channel toggles.
- Signing keys.
- The connected GitHub repository.

### Personal F-Droid repository and store site

- Each user has exactly one F-Droid repository, on their GitHub. They add it to F-Droid to get updates automatically.
- Relevance generates a static, app-store-style website for each user, similar to F-Droid's, from the apps in their GitHub, and publishes it on GitHub Pages.
- Each app on the store site shows a description, screenshots and the patches applied. There are no ratings. The description and screenshots are pulled automatically from the source where possible, and the user can change them. Where they cannot be pulled, the user may provide them; this is optional. Deleting an app in Relevance also removes it from the user's F-Droid repository and store site.
- The store site links back to Relevance as advertisement, for example inviting visitors to customize apps further on Relevance.
- Each app on the store site has two buttons:
  - Share: shares the link to the site.
  - Use this recipe: opens the visitor's own Relevance with the same app source, patches and modifications, so they can build it themselves.
- Visitors can see the available versions of each app and download any of them directly from the store site, without going through F-Droid. All past versions are kept. The user controls the store site, including its domain. It is not on Relevance's infrastructure.
- The whole output is static files. Users can also export it, for example by downloading it as a zip.

### Privacy of apps on Relevance

- On Relevance's own website, a user's apps are visible only to that user while signed in.
- Relevance's main website has no public listing of modified apps. Recipes are shared only through the store sites.

### Notifications

- Relevance notifies the user when:
  - An update is available but the build fails.
  - A new version changes things from what the user picked, for example the patch choices differ or it is uncertain whether the saved selection still applies.
- Notifications go through four channels:
  - Email, sent by Relevance through Cloudflare from Relevance's own domain.
  - A GitHub issue opened in the user's repository.
  - A notice inside Relevance.
  - A warning at the top of the app's description in F-Droid, for example: an update is available but the build is failing, check it out.
- Users can turn off any channel.
