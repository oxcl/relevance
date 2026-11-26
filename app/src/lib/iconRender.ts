import type { IconEdit, Corner } from '$shared/types';

export const DEFAULT_EDIT: IconEdit = {
  hue: 0,
  brightness: 0,
  saturation: 0,
  contrast: 0,
  badge: {
    enabled: false,
    icon: 'text:RV',
    fg: '#ffffff',
    bg: '#bf6447',
    iconBorder: false,
    iconBorderColor: '#36271d',
    circleBorder: true,
    circleBorderColor: '#ffffff',
    corner: 'tr',
    size: 36,
  },
  text: {
    enabled: false,
    value: 'Mod',
    fg: '#ffffff',
    bg: '#36271d',
    bgEnabled: true,
    size: 40,
    position: 7,
    textBorder: false,
    textBorderColor: '#36271d',
    boxBorder: false,
    boxBorderColor: '#ffffff',
  },
};

export function freshEdit(): IconEdit {
  return structuredClone(DEFAULT_EDIT);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Could not load the icon image'));
    img.src = src;
  });
}

const S = 512;
let adjCache: { key: string; canvas: HTMLCanvasElement } | null = null;

function rgbToHsl(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hslToRgb(h: number, s: number, l: number) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

/** The base image with hue/brightness/saturation/contrast applied, cached. */
function adjusted(img: CanvasImageSource, edit: IconEdit, id: string): HTMLCanvasElement {
  const key = `${id}|${edit.hue}|${edit.brightness}|${edit.saturation}|${edit.contrast}`;
  if (adjCache?.key === key) return adjCache.canvas;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, S, S);
  if (edit.hue || edit.brightness || edit.saturation || edit.contrast) {
    const d = ctx.getImageData(0, 0, S, S);
    const px = d.data;
    const dh = edit.hue / 360;
    const sat = 1 + edit.saturation / 100;
    const bri = edit.brightness / 100;
    const con = 1 + edit.contrast / 100;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      let [h, s, l] = rgbToHsl(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
      h = (h + dh + 1) % 1;
      s = Math.min(1, Math.max(0, s * sat));
      let [r, g, b] = hslToRgb(h, s, l);
      r = (r - 0.5) * con + 0.5 + bri;
      g = (g - 0.5) * con + 0.5 + bri;
      b = (b - 0.5) * con + 0.5 + bri;
      px[i] = Math.max(0, Math.min(255, r * 255));
      px[i + 1] = Math.max(0, Math.min(255, g * 255));
      px[i + 2] = Math.max(0, Math.min(255, b * 255));
    }
    ctx.putImageData(d, 0, 0);
  }
  adjCache = { key, canvas: c };
  return c;
}

function cornerXY(corner: Corner, r: number, pad: number) {
  const x = corner.endsWith('l') ? pad + r : S - pad - r;
  const y = corner.startsWith('t') ? pad + r : S - pad - r;
  return [x, y];
}

/** Draw the full composition at 512×512. */
export function render(canvas: HTMLCanvasElement, img: CanvasImageSource | null, imgId: string, edit: IconEdit, paths: Record<string, string>, label = '') {
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  if (img) ctx.drawImage(adjusted(img, edit, imgId), 0, 0);
  else {
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, '#e9d9c2');
    g.addColorStop(1, '#cdb79a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#6b5440';
    ctx.font = '700 240px Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((label[0] || '?').toUpperCase(), S / 2, S / 2 + 10);
  }

  const t = edit.text;
  if (t.enabled && t.value.trim()) {
    const fontSize = 30 + (t.size / 100) * 110;
    ctx.font = `800 ${fontSize}px Roboto, sans-serif`;
    const tw = ctx.measureText(t.value).width;
    const padX = fontSize * 0.35;
    const bw = Math.min(S - 20, tw + padX * 2);
    const bh = fontSize * 1.3;
    const col = t.position % 3;
    const row = Math.floor(t.position / 3);
    const margin = 26;
    const x = col === 0 ? margin : col === 1 ? (S - bw) / 2 : S - margin - bw;
    const y = row === 0 ? margin : row === 1 ? (S - bh) / 2 : S - margin - bh;
    const rad = bh * 0.32;
    if (t.bgEnabled) {
      ctx.fillStyle = t.bg;
      roundRect(ctx, x, y, bw, bh, rad);
      ctx.fill();
    }
    if (t.boxBorder) {
      ctx.lineWidth = Math.max(4, fontSize * 0.08);
      ctx.strokeStyle = t.boxBorderColor;
      roundRect(ctx, x, y, bw, bh, rad);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = x + bw / 2;
    const cy = y + bh / 2 + fontSize * 0.04;
    if (t.textBorder) {
      ctx.lineWidth = Math.max(4, fontSize * 0.12);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = t.textBorderColor;
      ctx.strokeText(t.value, cx, cy, bw - padX);
    }
    ctx.fillStyle = t.fg;
    ctx.fillText(t.value, cx, cy, bw - padX);
  }

  const b = edit.badge;
  if (b.enabled) {
    const r = (S * (b.size / 100)) / 2;
    const [cx, cy] = cornerXY(b.corner, r, 14);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.22)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = b.bg;
    ctx.fill();
    ctx.restore();
    if (b.circleBorder) {
      ctx.beginPath();
      ctx.arc(cx, cy, r - r * 0.05, 0, Math.PI * 2);
      ctx.lineWidth = r * 0.1;
      ctx.strokeStyle = b.circleBorderColor;
      ctx.stroke();
    }
    if (b.icon.startsWith('text:')) {
      const txt = b.icon.slice(5) || 'RV';
      const fs = (r * 1.15) / Math.max(1, txt.length * 0.55);
      ctx.font = `900 ${Math.min(r * 0.95, fs)}px Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (b.iconBorder) {
        ctx.lineWidth = r * 0.12;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = b.iconBorderColor;
        ctx.strokeText(txt, cx, cy + r * 0.05);
      }
      ctx.fillStyle = b.fg;
      ctx.fillText(txt, cx, cy + r * 0.05);
    } else if (paths[b.icon]) {
      const p = new Path2D(paths[b.icon]);
      const size = r * 1.2;
      ctx.save();
      ctx.translate(cx - size / 2, cy - size / 2);
      ctx.scale(size / 960, size / 960);
      ctx.translate(0, 960);
      if (b.iconBorder) {
        ctx.lineWidth = 90;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = b.iconBorderColor;
        ctx.stroke(p);
      }
      ctx.fillStyle = b.fg;
      ctx.fill(p);
      ctx.restore();
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function edgeColor(c: HTMLCanvasElement): string {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const d = ctx.getImageData(0, 0, S, S).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < S; i += 8) {
    for (const [x, y] of [[i, 2], [i, S - 3], [2, i], [S - 3, i]]) {
      const k = (y * S + x) * 4;
      if (d[k + 3] < 200) continue;
      r += d[k]; g += d[k + 1]; b += d[k + 2]; n++;
    }
  }
  if (n < 10) return '#FFFFFF';
  const h = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

async function toBytes(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Final assets for the APK: legacy icon, adaptive foreground and background colour. */
export async function exportIcon(main: HTMLCanvasElement) {
  const png = await toBytes(main);
  const fg = document.createElement('canvas');
  fg.width = fg.height = 432;
  const fctx = fg.getContext('2d')!;
  fctx.imageSmoothingQuality = 'high';
  const inner = 252;
  fctx.drawImage(main, (432 - inner) / 2, (432 - inner) / 2, inner, inner);
  return { png, fg: await toBytes(fg), background: edgeColor(main) };
}
