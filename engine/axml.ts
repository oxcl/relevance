// Edit a compiled (binary) AndroidManifest.xml in place: package name, app label and everything
// that has to follow a package rename. No decompile/rebuild of resources is involved, so it works
// on apps apktool can't round-trip (YouTube & co. after patching).

const RES_STRING_POOL = 0x0001;
const RES_XML = 0x0003;
const RES_XML_RESOURCE_MAP = 0x0180;
const RES_XML_START_ELEMENT = 0x0102;
const UTF8_FLAG = 0x100;
const TYPE_STRING = 0x03;

const ATTR = {
  label: 0x01010001,
  name: 0x01010003,
  permission: 0x01010006,
  taskAffinity: 0x01010012,
  authorities: 0x01010018,
  manageSpaceActivity: 0x01010004,
  targetActivity: 0x01010202,
  backupAgent: 0x0101027f,
  readPermission: 0x01010007,
  writePermission: 0x01010008,
};

interface Attr {
  off: number; // absolute offset of the attribute record
  nameIdx: number;
  resId: number;
  name: string;
  raw: number;
  type: number;
  data: number;
}
interface Elem {
  name: string;
  attrs: Attr[];
  children: Elem[];
  parent?: Elem;
}

function decodePool(b: Buffer, at: number) {
  const headerSize = b.readUInt16LE(at + 2);
  const size = b.readUInt32LE(at + 4);
  const count = b.readUInt32LE(at + 8);
  const styleCount = b.readUInt32LE(at + 12);
  const flags = b.readUInt32LE(at + 16);
  const stringsStart = b.readUInt32LE(at + 20);
  const stylesStart = b.readUInt32LE(at + 24);
  const utf8 = (flags & UTF8_FLAG) !== 0;
  const strings: string[] = [];
  for (let i = 0; i < count; i++) {
    let p = at + stringsStart + b.readUInt32LE(at + headerSize + i * 4);
    if (utf8) {
      let n = b[p++];
      if (n & 0x80) n = ((n & 0x7f) << 8) | b[p++]; // char count (unused)
      let len = b[p++];
      if (len & 0x80) len = ((len & 0x7f) << 8) | b[p++];
      strings.push(b.toString('utf8', p, p + len));
    } else {
      let len = b.readUInt16LE(p);
      p += 2;
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | b.readUInt16LE(p);
        p += 2;
      }
      strings.push(b.toString('utf16le', p, p + len * 2));
    }
  }
  const styleOffsets = styleCount ? b.subarray(at + headerSize + count * 4, at + headerSize + count * 4 + styleCount * 4) : Buffer.alloc(0);
  const styles = styleCount ? b.subarray(at + stylesStart, at + size) : Buffer.alloc(0);
  return { size, utf8, strings, flags, styleCount, styleOffsets: Buffer.from(styleOffsets), styles: Buffer.from(styles) };
}

function encodePool(p: ReturnType<typeof decodePool>, strings: string[]): Buffer {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let pos = 0;
  for (const s of strings) {
    offsets.push(pos);
    let buf: Buffer;
    if (p.utf8) {
      const bytes = Buffer.from(s, 'utf8');
      const len = (n: number) => (n > 0x7f ? Buffer.from([0x80 | (n >> 8), n & 0xff]) : Buffer.from([n]));
      buf = Buffer.concat([len(s.length), len(bytes.length), bytes, Buffer.from([0])]);
    } else {
      const chars = Buffer.from(s, 'utf16le');
      const n = s.length;
      const head = n > 0x7fff ? Buffer.from([((n >> 16) & 0x7fff) | 0x8000, n & 0xffff].flatMap((v) => [v & 0xff, v >> 8])) : Buffer.from([n & 0xff, n >> 8]);
      buf = Buffer.concat([head, chars, Buffer.from([0, 0])]);
    }
    parts.push(buf);
    pos += buf.length;
  }
  let data = Buffer.concat(parts);
  if (data.length % 4) data = Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]);
  const headerSize = 28;
  const stringsStart = headerSize + strings.length * 4 + p.styleCount * 4;
  const stylesStart = p.styleCount ? stringsStart + data.length : 0;
  const size = stringsStart + data.length + p.styles.length;
  const h = Buffer.alloc(headerSize);
  h.writeUInt16LE(RES_STRING_POOL, 0);
  h.writeUInt16LE(headerSize, 2);
  h.writeUInt32LE(size, 4);
  h.writeUInt32LE(strings.length, 8);
  h.writeUInt32LE(p.styleCount, 12);
  h.writeUInt32LE(p.flags & ~1, 16); // no longer sorted
  h.writeUInt32LE(stringsStart, 20);
  h.writeUInt32LE(stylesStart, 24);
  const offs = Buffer.alloc(strings.length * 4);
  offsets.forEach((o, i) => offs.writeUInt32LE(o, i * 4));
  return Buffer.concat([h, offs, p.styleOffsets, data, p.styles]);
}

function parse(b: Buffer) {
  if (b.readUInt16LE(0) !== RES_XML) throw new Error('Not a binary XML file');
  const poolAt = b.readUInt16LE(2);
  if (b.readUInt16LE(poolAt) !== RES_STRING_POOL) throw new Error('Binary XML without string pool');
  const pool = decodePool(b, poolAt);
  let resMap: number[] = [];
  const root: Elem = { name: '#root', attrs: [], children: [] };
  let cur = root;
  let p = poolAt + pool.size;
  while (p < b.length) {
    const type = b.readUInt16LE(p);
    const size = b.readUInt32LE(p + 4);
    if (type === RES_XML_RESOURCE_MAP) {
      const n = (size - 8) / 4;
      resMap = Array.from({ length: n }, (_, i) => b.readUInt32LE(p + 8 + i * 4));
    } else if (type === RES_XML_START_ELEMENT) {
      const ext = p + b.readUInt16LE(p + 2);
      const name = pool.strings[b.readUInt32LE(ext + 4)];
      const attrStart = b.readUInt16LE(ext + 8);
      const attrSize = b.readUInt16LE(ext + 10);
      const count = b.readUInt16LE(ext + 12);
      const el: Elem = { name, attrs: [], children: [], parent: cur };
      for (let i = 0; i < count; i++) {
        const off = ext + attrStart + i * attrSize;
        const nameIdx = b.readUInt32LE(off + 4);
        el.attrs.push({
          off,
          nameIdx,
          resId: resMap[nameIdx] ?? 0,
          name: pool.strings[nameIdx] ?? '',
          raw: b.readInt32LE(off + 8),
          type: b[off + 15],
          data: b.readUInt32LE(off + 16),
        });
      }
      cur.children.push(el);
      cur = el;
    } else if (type === 0x0103) {
      cur = cur.parent || root;
    }
    if (size <= 0) break;
    p += size;
  }
  return { poolAt, pool, root };
}

const walk = (e: Elem, f: (e: Elem) => void) => {
  f(e);
  for (const c of e.children) walk(c, f);
};

export interface ManifestEdit {
  packageName?: string;
  label?: string;
}

/** Rewrite a binary manifest. Returns the new bytes and what changed (for the log). */
export function editManifest(input: Buffer, edit: ManifestEdit): { bytes: Buffer; oldPackage: string; changes: string[] } {
  const b = Buffer.from(input);
  const { poolAt, pool, root } = parse(b);
  const strings = [...pool.strings];
  const changes: string[] = [];
  const intern = (s: string) => {
    // append rather than reuse: the old string may still be used elsewhere
    strings.push(s);
    return strings.length - 1;
  };
  const strOf = (a: Attr) => (a.type === TYPE_STRING ? strings[a.data] : a.raw >= 0 ? strings[a.raw] : undefined);
  const setStr = (a: Attr, v: string) => {
    const idx = intern(v);
    b.writeInt32LE(idx, a.off + 8);
    b.writeUInt16LE(8, a.off + 12);
    b[a.off + 14] = 0;
    b[a.off + 15] = TYPE_STRING;
    b.writeUInt32LE(idx, a.off + 16);
    a.raw = idx;
    a.type = TYPE_STRING;
    a.data = idx;
  };
  const attr = (e: Elem, id: number, plain?: string) => e.attrs.find((a) => (a.resId ? a.resId === id : plain !== undefined && a.name === plain && !a.resId));

  let manifest: Elem | undefined;
  walk(root, (e) => (manifest ||= e.name === 'manifest' ? e : undefined));
  if (!manifest) throw new Error('No <manifest> element');
  const pkgAttr = manifest.attrs.find((a) => a.name === 'package' && !a.resId);
  const oldPkg = pkgAttr && strOf(pkgAttr);
  if (!pkgAttr || !oldPkg) throw new Error('Manifest has no package attribute');
  const app = manifest.children.find((c) => c.name === 'application');

  if (edit.label) {
    const targets: Elem[] = [];
    if (app) targets.push(app);
    walk(manifest, (e) => {
      if (e.name !== 'activity' && e.name !== 'activity-alias') return;
      let launcher = false;
      walk(e, (c) => {
        if (c.name === 'category' && strOf(attr(c, ATTR.name, 'name') || ({} as Attr)) === 'android.intent.category.LAUNCHER') launcher = true;
      });
      if (launcher) targets.push(e);
    });
    let n = 0;
    for (const t of targets) {
      const a = attr(t, ATTR.label, 'label');
      if (a) {
        setStr(a, edit.label);
        n++;
      } else if (t === app) throw new Error('The <application> element has no label to replace');
    }
    changes.push(`label → "${edit.label}" (${n} place${n === 1 ? '' : 's'})`);
  }

  const newPkg = edit.packageName;
  if (newPkg && newPkg !== oldPkg) {
    const absolute = (v: string) => (v.startsWith('.') ? oldPkg + v : v.includes('.') ? v : `${oldPkg}.${v}`);
    const components = new Set(['application', 'activity', 'activity-alias', 'service', 'receiver', 'provider', 'instrumentation']);
    let classes = 0;
    walk(manifest, (e) => {
      if (!components.has(e.name)) return;
      // an alias name is just an identifier (apps look it up relative to their package), its target is a class
      const ids = e.name === 'activity-alias' ? [ATTR.targetActivity] : [ATTR.name, ATTR.backupAgent, ATTR.manageSpaceActivity];
      for (const id of ids) {
        const a = attr(e, id);
        const v = a && strOf(a);
        if (a && v && absolute(v) !== v) {
          setStr(a, absolute(v));
          classes++;
        }
      }
    });
    if (classes) changes.push(`${classes} relative class name${classes === 1 ? '' : 's'} made absolute`);
    setStr(pkgAttr, newPkg);
    changes.push(`package ${oldPkg} → ${newPkg}`);

    const move = (v: string) => (v.startsWith(oldPkg) ? newPkg + v.slice(oldPkg.length) : `${newPkg}.${v}`);
    let auth = 0;
    walk(manifest, (e) => {
      if (e.name !== 'provider') return;
      const a = attr(e, ATTR.authorities);
      const v = a && strOf(a);
      if (a && v) {
        setStr(a, v.split(';').map(move).join(';'));
        auth++;
      }
    });
    if (auth) changes.push(`${auth} provider authorit${auth === 1 ? 'y' : 'ies'} moved`);

    // permissions the app declares itself must not clash with the original app's
    const declared = new Set<string>();
    walk(manifest, (e) => {
      if (e.name !== 'permission') return;
      const v = strOf(attr(e, ATTR.name) || ({} as Attr));
      if (v) declared.add(v);
    });
    let perms = 0;
    if (declared.size)
      walk(manifest, (e) => {
        for (const a of e.attrs) {
          if (![ATTR.name, ATTR.permission, ATTR.readPermission, ATTR.writePermission].includes(a.resId)) continue;
          const v = strOf(a);
          if (v && declared.has(v)) {
            setStr(a, move(v));
            perms++;
          }
        }
      });
    if (declared.size) changes.push(`${declared.size} custom permission${declared.size === 1 ? '' : 's'} renamed (${perms} references)`);

    walk(manifest, (e) => {
      const a = attr(e, ATTR.taskAffinity);
      const v = a && strOf(a);
      if (a && v && v.startsWith(oldPkg)) setStr(a, newPkg + v.slice(oldPkg.length));
    });
  }

  // splice the rebuilt string pool in and fix the file size
  const newPool = encodePool(pool, strings);
  const out = Buffer.concat([b.subarray(0, poolAt), newPool, b.subarray(poolAt + pool.size)]);
  out.writeUInt32LE(out.length, 4);
  return { bytes: out, oldPackage: oldPkg, changes };
}

/** Read a few manifest facts (for tests and logging). */
export function readManifest(input: Buffer) {
  const { pool, root } = parse(input);
  let pkg = '';
  let label: string | undefined;
  walk(root, (e) => {
    if (e.name === 'manifest') {
      const a = e.attrs.find((x) => x.name === 'package' && !x.resId);
      if (a) pkg = pool.strings[a.type === TYPE_STRING ? a.data : a.raw];
    }
    if (e.name === 'application') {
      const a = e.attrs.find((x) => x.resId === ATTR.label);
      if (a && a.type === TYPE_STRING) label = pool.strings[a.data];
    }
  });
  return { packageName: pkg, label };
}
