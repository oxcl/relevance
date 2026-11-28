// Shared data model. Everything here lives as plain JSON inside the user's own repository.

export type ToolId = 'revanced' | 'morphe' | 'lspatch' | 'none';
export type PatchToolId = Exclude<ToolId, 'none'>;

export type SourceType = 'apkpure' | 'fdroid' | 'github' | 'url' | 'upload';

export interface AppSource {
  type: SourceType;
  /** URL the user gave (store page, repo URL, direct APK URL). For uploads: the release asset URL in the user's repo. */
  url: string;
  /** github: regex used to pick the APK asset from a release */
  assetPattern?: string;
  /** github: include pre-releases */
  prerelease?: boolean;
  /** upload: the version of the uploaded file */
  uploadedVersion?: string;
}

export interface PatchOptionDef {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  type?: string;
  default?: unknown;
  values?: Record<string, unknown> | null;
}

export interface PatchCompat {
  packageName: string;
  /** app name, when the patch list provides it */
  name?: string;
  /** null or empty = any version */
  versions: string[] | null;
  /** SHA-256 digests of the original app's signing certificates, when the patch maintainers publish them */
  signatures?: string[];
}

export interface PatchDef {
  name: string;
  description?: string | null;
  /** enabled by default */
  default?: boolean;
  /** null = universal patch (works with any app) */
  packages: PatchCompat[] | null;
  options?: PatchOptionDef[];
  /** LSPatch modules: where to download the module apk (github repo) */
  module?: { repo: string; url?: string; summary?: string };
}

export interface PatchIndex {
  tool: PatchToolId;
  sourceId: string;
  name: string;
  version: string;
  fetchedAt: string;
  /** Where the patch bundle (.rvp/.mpp) can be downloaded, if applicable */
  bundleUrl?: string;
  patches: PatchDef[];
}

export interface PatchSource {
  id: string;
  tool: PatchToolId;
  name: string;
  /** github / gitlab repo URL, or direct bundle URL */
  url: string;
  builtin?: boolean;
}

export interface SelectedPatch {
  name: string;
  options?: Record<string, unknown>;
}

export interface CustomPatch {
  id: string;
  name: string;
  description?: string;
  /** revanced/morphe: URL of a .rvp/.mpp bundle or repo; lspatch: module repo/apk URL */
  url: string;
  /** names of patches to enable from the bundle (revanced/morphe). Empty = bundle defaults */
  patchNames?: string[];
  enabled: boolean;
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

export interface IconEdit {
  hue: number; // -180..180
  brightness: number; // -100..100
  saturation: number; // -100..100
  contrast: number; // -100..100
  badge: {
    enabled: boolean;
    icon: string; // material symbol name or 'text:RV'
    label?: string;
    fg: string;
    bg: string;
    iconBorder: boolean;
    iconBorderColor: string;
    circleBorder: boolean;
    circleBorderColor: string;
    corner: Corner;
    size: number; // 20..50 (% of icon)
  };
  text: {
    enabled: boolean;
    value: string;
    fg: string;
    bg: string;
    bgEnabled: boolean;
    size: number; // 10..100
    position: number; // 0..8, 3x3 grid
    textBorder: boolean;
    textBorderColor: string;
    boxBorder: boolean;
    boxBorderColor: string;
  };
}

export interface AppCustomize {
  name?: string;
  packageName?: string;
  icon?: {
    mode: 'edit' | 'upload';
    /** repo path of the rendered final icon png */
    path: string;
    /** repo path of an uploaded base image (upload mode) */
    basePath?: string;
    edit?: IconEdit;
  };
}

export interface AppListing {
  summary: string;
  description: string; // sanitized html
  category: string;
  website?: string;
  screenshots: string[]; // repo paths or URLs
}

export interface AppConfig {
  id: string;
  name: string;
  packageName: string;
  iconUrl?: string;
  source: AppSource;
  tool: ToolId;
  patchSourceId?: string;
  patches: SelectedPatch[];
  customPatches: CustomPatch[];
  pin?: string | null;
  customize: AppCustomize;
  listing: AppListing;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationSettings {
  email: boolean;
  issue: boolean;
  inApp: boolean;
  fdroid: boolean;
}

export interface RelevanceConfig {
  $schema?: string;
  version: 1;
  owner: string;
  createdAt: string;
  settings: {
    notifications: NotificationSettings;
    /** HMAC token issued by the Relevance server binding this repository to a verified email address */
    emailToken?: string;
    emailHint?: string;
    store: { title: string; description: string; domain?: string };
    relevanceUrl: string;
    signing: { mode: 'generated' | 'custom'; fingerprint?: string; alias: string; createdAt?: string };
  };
  patchSources: PatchSource[];
  apps: AppConfig[];
}

export type AppStatus = 'never' | 'ok' | 'failed' | 'needs-review' | 'building' | 'disabled';

export interface ReleaseEntry {
  version: string;
  versionCode?: number;
  tag: string;
  date: string;
  size: number;
  sha256?: string;
  apk: string; // file name
  url: string; // download url (GitHub release asset)
  patches: string[];
  tool: ToolId;
  patchVersion?: string;
  /** version as reported by the source (e.g. a release tag) */
  sourceVersion?: string;
}

export interface BuildEntry {
  runId: number;
  version?: string;
  status: 'success' | 'failure' | 'cancelled' | 'skipped' | 'running';
  at: string;
  durationMs?: number;
  trigger: 'manual' | 'schedule' | 'config';
  error?: string;
}

export interface Attention {
  kind: 'build-failed' | 'selection-changed' | 'no-compatible-version' | 'signature-changed';
  message: string;
  at: string;
  version?: string;
  details?: string[];
}

export interface SourceMeta {
  name?: string;
  summary?: string;
  description?: string;
  iconUrl?: string;
  screenshots?: string[];
  website?: string;
  latest?: string;
}

export interface AppState {
  appId: string;
  status: AppStatus;
  configHash?: string;
  patchVersion?: string;
  current?: ReleaseEntry;
  releases: ReleaseEntry[];
  history: BuildEntry[];
  attention?: Attention | null;
  latestAvailable?: string;
  targetVersion?: string;
  checkedAt?: string;
  sourceMeta?: SourceMeta;
  /** Signing certificate(s) of the original app, pinned on the first build */
  sourceCert?: { sha256: string[]; firstSeen: string; version?: string } | null;
}

export interface Recipe {
  v: 1;
  name: string;
  packageName: string;
  source: AppSource;
  tool: ToolId;
  patchSource?: Pick<PatchSource, 'tool' | 'name' | 'url'>;
  patches: SelectedPatch[];
  customPatches: CustomPatch[];
  customize: { name?: string; packageName?: string; iconEdit?: IconEdit };
}

/** Build steps shown in the progress accordion. id must match the workflow step `id`. */
export interface StepDef {
  id: string;
  title: string;
  subtitle: string;
}

export const ENGINE_VERSION = '1.3.7';
