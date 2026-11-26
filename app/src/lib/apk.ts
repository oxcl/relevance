// Minimal APK reader: zip central directory + binary AndroidManifest.xml parser.
// Works on local files and, through ranged reads, on remote URLs without downloading everything.

export interface ApkMeta {
  packageName: string;
  versionName: string;
  versionCode: number;
  label?: string;
  iconBlob?: Blob;
  size: number;
}

type Reader = (start: number, end: number) => Promise<Uint8Array>;

interface Entry {
  name: string;
  method: number;
  compSize: number;
  size: number;
  offset: number;
}

async function centralDirectory(read: Reader, size: number): Promise<Entry[]> {
  const tailLen = Math.min(size, 66000);
  const tail = await read(size - tailLen, size);
  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip/APK file');
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const cd = await read(cdOffset, cdOffset + cdSize);
  const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries: Entry[] = [];
  let p = 0;
  const td = new TextDecoder();
  while (p + 46 <= cd.length && v.getUint32(p, true) === 0x02014b50) {
    const method = v.getUint16(p + 10, true);
    const compSize = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true);
    const elen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    const name = td.decode(cd.subarray(p + 46, p + 46 + nlen));
    entries.push({ name, method, compSize, size: usize, offset });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}

async function readEntry(read: Reader, e: Entry): Promise<Uint8Array> {
  const head = await read(e.offset, e.offset + 30);
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const nlen = hv.getUint16(26, true);
  const elen = hv.getUint16(28, true);
  const start = e.offset + 30 + nlen + elen;
  const data = await read(start, start + e.compSize);
  if (e.method === 0) return data;
  if (e.method !== 8) throw new Error('Unsupported compression');
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** Parse the binary XML manifest; returns attributes of <manifest> and <application>. */
export function parseAxml(buf: Uint8Array) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let strings: string[] = [];
  const result: { manifest: Record<string, any>; application: Record<string, any> } = { manifest: {}, application: {} };
  let p = 8;
  while (p < buf.length) {
    const type = v.getUint16(p, true);
    const headerSize = v.getUint16(p + 2, true);
    const size = v.getUint32(p + 4, true);
    if (size === 0) break;
    if (type === 0x0001) {
      const count = v.getUint32(p + 8, true);
      const flags = v.getUint32(p + 16, true);
      const strStart = v.getUint32(p + 20, true);
      const utf8 = (flags & 0x100) !== 0;
      strings = [];
      for (let i = 0; i < count; i++) {
        const off = v.getUint32(p + headerSize + i * 4, true);
        let q = p + strStart + off;
        if (utf8) {
          let l = buf[q++];
          if (l & 0x80) q++;
          l = buf[q++];
          if (l & 0x80) l = ((l & 0x7f) << 8) | buf[q++];
          strings.push(new TextDecoder().decode(buf.subarray(q, q + l)));
        } else {
          let l = v.getUint16(q, true);
          q += 2;
          if (l & 0x8000) {
            l = ((l & 0x7fff) << 16) | v.getUint16(q, true);
            q += 2;
          }
          let s = '';
          for (let k = 0; k < l; k++) s += String.fromCharCode(v.getUint16(q + k * 2, true));
          strings.push(s);
        }
      }
    } else if (type === 0x0102) {
      const nameIdx = v.getUint32(p + 20, true);
      const tag = strings[nameIdx];
      const attrStart = v.getUint16(p + 24, true);
      const attrSize = v.getUint16(p + 26, true);
      const attrCount = v.getUint16(p + 28, true);
      if (tag === 'manifest' || tag === 'application') {
        const target = result[tag];
        for (let i = 0; i < attrCount; i++) {
          const a = p + 16 + attrStart + i * attrSize;
          const an = strings[v.getUint32(a + 4, true)];
          const raw = v.getUint32(a + 8, true);
          const dtype = buf[a + 15];
          const data = v.getUint32(a + 16, true);
          if (raw !== 0xffffffff) target[an] = strings[raw];
          else if (dtype === 0x03) target[an] = strings[data];
          else if (dtype === 0x01) target[an] = `@0x${data.toString(16)}`;
          else target[an] = data;
        }
        if (tag === 'application') break;
      }
    }
    p += size;
  }
  return result;
}

async function inspect(read: Reader, size: number, withIcon: boolean): Promise<ApkMeta> {
  const entries = await centralDirectory(read, size);
  const man = entries.find((e) => e.name === 'AndroidManifest.xml');
  if (!man) {
    if (entries.some((e) => /\.apk$/.test(e.name)))
      throw new Error('This looks like a split bundle (XAPK/APKS). It will be merged during the build; please enter the details manually.');
    throw new Error('No AndroidManifest.xml found — is this an APK?');
  }
  const xml = parseAxml(await readEntry(read, man));
  const meta: ApkMeta = {
    packageName: String(xml.manifest.package || ''),
    versionName: String(xml.manifest.versionName ?? ''),
    versionCode: Number(xml.manifest.versionCode || 0),
    label: typeof xml.application.label === 'string' && !xml.application.label.startsWith('@') ? xml.application.label : undefined,
    size,
  };
  if (withIcon) {
    const pngs = entries.filter((e) => /^res\/(mipmap|drawable)[^/]*\/(ic_launcher|icon|app_icon|ic_app)[^/]*\.(png|webp)$/i.test(e.name) && !/foreground|background|monochrome/i.test(e.name));
    const rank = (n: string) => (n.includes('xxxhdpi') ? 5 : n.includes('xxhdpi') ? 4 : n.includes('xhdpi') ? 3 : n.includes('hdpi') ? 2 : 1) + (/round/.test(n) ? -0.5 : 0);
    pngs.sort((a, b) => rank(b.name) - rank(a.name) || b.size - a.size);
    if (pngs[0]) {
      const data = await readEntry(read, pngs[0]);
      meta.iconBlob = new Blob([data as BlobPart], { type: pngs[0].name.endsWith('.webp') ? 'image/webp' : 'image/png' });
    }
  }
  return meta;
}

export async function inspectFile(file: File): Promise<ApkMeta> {
  const read: Reader = async (s, e) => new Uint8Array(await file.slice(s, e).arrayBuffer());
  return inspect(read, file.size, true);
}

/** Inspect a remote APK through the Relevance proxy using HTTP range requests. */
export async function inspectUrl(url: string): Promise<ApkMeta & { finalUrl: string }> {
  const proxied = `/api/fetch?url=${encodeURIComponent(url)}`;
  const head = await fetch(proxied, { method: 'HEAD' });
  const size = Number(head.headers.get('content-length') || 0);
  const finalUrl = head.headers.get('x-final-url') || url;
  if (!size) throw new Error('The server did not report a file size');
  const read: Reader = async (s, e) => {
    const r = await fetch(proxied, { headers: { Range: `bytes=${s}-${e - 1}` } });
    if (r.status !== 206) throw new Error('The server does not support partial downloads');
    return new Uint8Array(await r.arrayBuffer());
  };
  return { ...(await inspect(read, size, true)), finalUrl };
}
