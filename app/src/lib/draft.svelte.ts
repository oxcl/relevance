import type { AppConfig, IconEdit, Recipe } from '$shared/types';
import type { SourceInfo } from '$shared/sources';
import { freshEdit } from './iconRender';

export interface Draft {
  editing: string | null; // app id when editing
  app: AppConfig;
  info: SourceInfo | null;
  uploadFile: File | null;
  uploadMeta: { packageName: string; versionName: string; versionCode: number } | null;
  iconBase: string | null; // url used as editor base
  iconUploadBlob: Blob | null;
  sourceIconBlob: Blob | null;
  iconMode: 'none' | 'edit' | 'upload';
  iconEdit: IconEdit;
  iconTouched: boolean;
  newShots: { id: string; blob: Blob; url: string }[];
  visited: number;
  recipe: Recipe | null;
  /** id of the app this draft duplicates */
  cloneOf?: string | null;
}

export function blankApp(): AppConfig {
  const now = new Date().toISOString();
  return {
    id: '',
    name: '',
    packageName: '',
    source: { type: 'apkpure', url: '' },
    tool: 'revanced',
    patches: [],
    customPatches: [],
    pin: null,
    customize: {},
    listing: { summary: '', description: '', category: 'System', website: '', screenshots: [] },
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

function fresh(): Draft {
  return {
    editing: null,
    app: blankApp(),
    info: null,
    uploadFile: null,
    uploadMeta: null,
    iconBase: null,
    iconUploadBlob: null,
    sourceIconBlob: null,
    iconMode: 'none',
    iconEdit: freshEdit(),
    iconTouched: false,
    newShots: [],
    visited: 0,
    recipe: null,
    cloneOf: null,
  };
}

export const draft = $state<{ d: Draft }>({ d: fresh() });

export function resetDraft() {
  draft.d = fresh();
}

const KEY = 'rv-draft';
export function persistDraft() {
  try {
    const d = $state.snapshot(draft.d) as any;
    sessionStorage.setItem(KEY, JSON.stringify({ ...d, uploadFile: null, iconUploadBlob: null, sourceIconBlob: null, iconExport: null, newShots: [], iconBase: d.iconBase?.startsWith('blob:') ? null : d.iconBase }));
  } catch {}
}
export function restoreDraft(): boolean {
  try {
    const s = sessionStorage.getItem(KEY);
    if (!s) return false;
    draft.d = { ...fresh(), ...JSON.parse(s) };
    return true;
  } catch {
    return false;
  }
}
export function clearPersisted() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}
