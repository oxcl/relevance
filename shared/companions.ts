// Apps that a patched app needs next to it. Google apps patched for non-root use rely on MicroG
// (GmsCore) for sign-in, notifications and casting.
import type { AppConfig, RelevanceConfig } from './types';

export interface Companion {
  id: string;
  name: string;
  packageName: string;
  source: AppConfig['source'];
  summary: string;
  why: string;
  iconUrl: string;
}

const MICROG_PKG = 'app.revanced.android.gms';

export function companionFor(app: Pick<AppConfig, 'tool' | 'patches' | 'packageName' | 'name'>): Companion | null {
  if (!app.patches.some((p) => p.name === 'GmsCore support')) return null;
  const why = `${app.name} patched without root can't use Google Play services, so it needs MicroG for sign-in, notifications and casting.`;
  if (app.tool === 'morphe')
    return {
      id: 'microg-re',
      name: 'MicroG-RE',
      packageName: MICROG_PKG,
      source: { type: 'github', url: 'https://github.com/MorpheApp/MicroG-RE', assetPattern: '^microg-[\\w.]+\\.apk$' },
      summary: "Morphe's MicroG build, so patched Google apps can sign in.",
      iconUrl: 'https://raw.githubusercontent.com/MorpheApp/MicroG-RE/main/play-services-core/src/main/res/mipmap-xxxhdpi/ic_app.png',
      why,
    };
  if (app.tool === 'revanced')
    return {
      id: 'revanced-gmscore',
      name: 'ReVanced GmsCore',
      packageName: MICROG_PKG,
      source: { type: 'github', url: 'https://github.com/ReVanced/GmsCore', assetPattern: '^app\\.revanced\\.android\\.gms-[\\w.]+-signed\\.apk$' },
      summary: "ReVanced's MicroG build, so patched Google apps can sign in.",
      iconUrl: 'https://raw.githubusercontent.com/ReVanced/GmsCore/main/play-services-core/src/main/res/mipmap-xxxhdpi/ic_app.png',
      why,
    };
  return null;
}

/** The companion the user should still add, or null when it's not needed or already in the store. */
export function missingCompanion(cfg: RelevanceConfig | null | undefined, app: Parameters<typeof companionFor>[0]): Companion | null {
  const c = companionFor(app);
  if (!c || !cfg) return c;
  return cfg.apps.some((a) => (a.customize?.packageName || a.packageName) === c.packageName) ? null : c;
}

export function companionApp(c: Companion, takenIds: string[]): AppConfig {
  const now = new Date().toISOString();
  let id = c.id;
  for (let n = 2; takenIds.includes(id); n++) id = `${c.id}-${n}`;
  return {
    id,
    name: c.name,
    packageName: c.packageName,
    iconUrl: c.iconUrl,
    source: c.source,
    tool: 'none',
    patches: [],
    customPatches: [],
    pin: null,
    customize: {},
    listing: { summary: c.summary, description: `<p>${c.summary}</p><p>${c.why}</p>`, category: 'System', website: c.source.url, screenshots: [] },
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Icon for companion apps added before they carried one (their APK icons are vector drawables F-Droid can't show). */
export function companionIcon(app: Pick<AppConfig, 'source' | 'packageName'>): string | undefined {
  if (app.packageName !== MICROG_PKG) return undefined;
  if (/MorpheApp\/MicroG-RE/i.test(app.source.url)) return 'https://raw.githubusercontent.com/MorpheApp/MicroG-RE/main/play-services-core/src/main/res/mipmap-xxxhdpi/ic_app.png';
  if (/ReVanced\/GmsCore/i.test(app.source.url)) return 'https://raw.githubusercontent.com/ReVanced/GmsCore/main/play-services-core/src/main/res/mipmap-xxxhdpi/ic_app.png';
  return undefined;
}
