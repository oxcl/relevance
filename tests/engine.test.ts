import { expect, test } from 'bun:test';
process.env.RELEVANCE_WORK = '/tmp/nix-shell.wKJehR/claude-1000/-home-user-Projects-relevance/ba12dd88-374e-422b-a4f7-366e8d52d0a2/scratchpad/work';
const { parseListPatches, fromPatchesList } = await import('../engine/patches');
const { rewriteManifest } = await import('../engine/build');
import { pickTarget, compareVersions } from '../shared/logic';
import { readFileSync } from 'node:fs';

const sample = `INFO: Index: 0
Name: Hide ads
Description: Removes ads.
Enabled: true
Options:
	Name: customKey
	Description: Some option
	that spans lines
	Required: false
	Default: abc
	Possible values:
		Value A (a)
		Value B (b)
	Type: String
Compatible packages:
	Package name: com.google.android.youtube
	Compatible versions:
		20.14.43
		20.12.46

Index: 1
Name: Universal thing
Enabled: false`;

test('parse list-patches', () => {
  const p = parseListPatches(sample);
  expect(p.length).toBe(2);
  expect(p[0].name).toBe('Hide ads');
  expect(p[0].options![0].key).toBe('customKey');
  expect(p[0].options![0].values).toEqual({ a: 'Value A', b: 'Value B' });
  expect(p[0].packages![0].versions).toEqual(['20.14.43', '20.12.46']);
  expect(p[1].packages).toBe(null);
  expect(p[1].default).toBe(false);
});

test('morphe list + target', () => {
  const j = JSON.parse(readFileSync('/tmp/nix-shell.wKJehR/claude-1000/-home-user-Projects-relevance/ba12dd88-374e-422b-a4f7-366e8d52d0a2/scratchpad/mo.json', 'utf8'));
  const patches = fromPatchesList(j);
  const idx = { tool: 'morphe', sourceId: 'morphe', name: 'Morphe', version: '1', fetchedAt: '', patches } as any;
  const yt = patches.filter((p) => p.packages?.some((c) => c.packageName === 'com.google.android.youtube'));
  const sel = yt.slice(0, 5).map((p) => ({ name: p.name }));
  const t = pickTarget(idx, 'com.google.android.youtube', sel, null);
  console.log(JSON.stringify(t).slice(0,300)); expect(t.target).toBeTruthy();
  console.log('target', t.target, t.supported?.slice(0, 4));
});

test('versions', () => {
  expect(compareVersions('20.14.43', '20.12.46')).toBeGreaterThan(0);
  expect(compareVersions('v1.10', '1.9')).toBeGreaterThan(0);
  expect(compareVersions('1.0', '1.0-beta')).toBeLessThan(0);
});

test('manifest rewrite', () => {
  const xml = `<?xml version="1.0" encoding="utf-8" standalone="no"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.ex.app"><permission android:name="com.ex.app.permission.C2D" android:protectionLevel="signature"/><uses-permission android:name="com.ex.app.permission.C2D"/><application android:icon="@mipmap/ic_launcher" android:label="@string/app_name" android:roundIcon="@mipmap/ic_round"><activity android:name="com.ex.app.Main"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity><provider android:authorities="com.ex.app.files;androidx.startup" android:name="x"/></application></manifest>`;
  const out = rewriteManifest(xml, { oldPkg: 'com.ex.app', newPkg: 'com.ex.app.clone', label: 'My "App"', icon: true });
  expect(out).toContain('android:authorities="com.ex.app.clone.files;com.ex.app.clone.androidx.startup"');
  expect(out).toContain('"com.ex.app.clone.permission.C2D"');
  expect(out).toContain('android:icon="@mipmap/relevance_icon"');
  expect(out).toContain('android:roundIcon="@mipmap/relevance_icon"');
  expect(out).toContain('<activity android:name="com.ex.app.Main" android:label="My &quot;App&quot;">');
  expect(out).toContain('package="com.ex.app.clone"');
  const rel = rewriteManifest('<manifest package="a.b"><application android:name=".App"><activity android:name=".Main"></activity></application></manifest>', { oldPkg: 'a.b', newPkg: 'a.b.c' });
  expect(rel).toContain('android:name="a.b.App"');
  expect(rel).toContain('android:name="a.b.Main"');
  expect(rel).toContain('package="a.b.c"');
});

test('apkpure version codes', async () => {
  const { parseApkpureCodes } = await import('../shared/sources');
  const html = readFileSync(new URL('./fixtures/apkpure-versions.html', import.meta.url), 'utf8');
  const codes = parseApkpureCodes(html, 'com.reddit.frontpage');
  expect(codes['2026.46.0']).toBe(2646090); // current release (header block)
  expect(codes['2026.40.0']).toBe(2640090); // version list
  expect(codes['3.20.82']).toBeUndefined(); // APKPure's own app banner is ignored
});

test('binary manifest edit renames package, label, authorities and permissions', async () => {
  const { editManifest, readManifest } = await import('../engine/axml');
  const src = readFileSync(new URL('./fixtures/binaryeye-manifest.bin', import.meta.url));
  expect(readManifest(src).packageName).toBe('de.markusfisch.android.binaryeye');
  const r = editManifest(src, { packageName: 'de.markusfisch.android.binaryeye.mod', label: 'Eye Mod' });
  const m = readManifest(r.bytes);
  expect(m.packageName).toBe('de.markusfisch.android.binaryeye.mod');
  expect(m.label).toBe('Eye Mod');
  // re-parsing the output must work and a second edit must be stable
  const again = editManifest(r.bytes, { label: 'Eye Mod 2' });
  expect(readManifest(again.bytes)).toEqual({ packageName: 'de.markusfisch.android.binaryeye.mod', label: 'Eye Mod 2' });
});
