// Small UI runtime: toasts, ripples, theme switching with a circular reveal, confetti petals.
import { flushSync } from 'svelte';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
}
export const toasts = $state<Toast[]>([]);
let tid = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action'], ms = 4200) {
  const t = { id: ++tid, text, kind, action };
  toasts.push(t);
  setTimeout(() => dismiss(t.id), ms);
}
export function dismiss(id: number) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}
export function errorToast(e: unknown, prefix = '') {
  const m = e instanceof Error ? e.message : String(e);
  toast(prefix ? `${prefix}: ${m}` : m, 'error', undefined, 7000);
}

/** Material ripple: use:ripple */
export function ripple(node: HTMLElement) {
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const r = node.getBoundingClientRect();
    const size = Math.hypot(r.width, r.height) * 2;
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.width = s.style.height = `${size}px`;
    s.style.left = `${e.clientX - r.left - size / 2}px`;
    s.style.top = `${e.clientY - r.top - size / 2}px`;
    node.appendChild(s);
    setTimeout(() => s.remove(), 700);
  };
  node.addEventListener('pointerdown', down);
  return { destroy: () => node.removeEventListener('pointerdown', down) };
}

/** Subtle 3D tilt toward the pointer: use:tilt */
export function tilt(node: HTMLElement, strength = 5) {
  if (matchMedia('(hover: none)').matches) return {};
  let raf = 0;
  const move = (e: PointerEvent) => {
    const r = node.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      node.style.transform = `perspective(900px) rotateX(${-y * strength}deg) rotateY(${x * strength}deg) translateY(-3px)`;
      node.style.setProperty('--mx', `${(x + 0.5) * 100}%`);
      node.style.setProperty('--my', `${(y + 0.5) * 100}%`);
    });
  };
  const leave = () => {
    cancelAnimationFrame(raf);
    node.style.transform = '';
  };
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerleave', leave);
  return {
    destroy() {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', leave);
    },
  };
}

/**
 * Scroll region for long lists: use:scrollArea (with class="scroll-area").
 * Marks which edges still hide content so CSS can fade them, and whether it overflows at all.
 */
export function scrollArea(node: HTMLElement) {
  let raf = 0;
  const update = () => {
    raf = 0;
    const max = node.scrollHeight - node.clientHeight;
    node.classList.toggle('overflows', max > 2);
    node.classList.toggle('more-above', node.scrollTop > 2);
    node.classList.toggle('more-below', node.scrollTop < max - 2);
  };
  const queue = () => (raf ||= requestAnimationFrame(update));
  node.addEventListener('scroll', queue, { passive: true });
  const ro = new ResizeObserver(queue);
  ro.observe(node);
  const mo = new MutationObserver(() => {
    for (const c of node.children) ro.observe(c);
    queue();
  });
  mo.observe(node, { childList: true, subtree: true });
  for (const c of node.children) ro.observe(c);
  update();
  return {
    destroy() {
      cancelAnimationFrame(raf);
      node.removeEventListener('scroll', queue);
      ro.disconnect();
      mo.disconnect();
    },
  };
}

/** Parallax drift for illustrations on scroll + pointer: use:parallax */
export function parallax(node: HTMLElement, depth = 0.08) {
  let raf = 0;
  let px = 0;
  let py = 0;
  const apply = () => {
    const y = scrollY * depth;
    node.style.transform = `translate3d(${px}px, ${y + py}px, 0)`;
  };
  const onScroll = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(apply);
  };
  const onMove = (e: PointerEvent) => {
    px = (e.clientX / innerWidth - 0.5) * -14;
    py = (e.clientY / innerHeight - 0.5) * -8;
    onScroll();
  };
  addEventListener('scroll', onScroll, { passive: true });
  if (!matchMedia('(hover: none)').matches) addEventListener('pointermove', onMove, { passive: true });
  return {
    destroy() {
      removeEventListener('scroll', onScroll);
      removeEventListener('pointermove', onMove);
    },
  };
}

/** Reveal on intersection with a stagger index: use:reveal={i} */
export function reveal(node: HTMLElement, i = 0) {
  node.style.opacity = '0';
  node.style.transform = 'translateY(16px)';
  node.style.transition = `opacity .7s var(--ease-out) ${i * 50}ms, transform .8s var(--ease-out) ${i * 50}ms`;
  const io = new IntersectionObserver(
    (es) => {
      for (const e of es)
        if (e.isIntersecting) {
          node.style.opacity = '';
          node.style.transform = '';
          io.disconnect();
          setTimeout(() => (node.style.transition = ''), 900 + i * 50);
        }
    },
    { threshold: 0.05 },
  );
  io.observe(node);
  return { destroy: () => io.disconnect() };
}

// ---------------------------------------------------------------- theme
export type ThemePref = 'system' | 'light' | 'dark';
export const theme = $state<{ pref: ThemePref }>({ pref: 'system' });
try {
  const t = localStorage.getItem('rv-theme');
  if (t === 'light' || t === 'dark') theme.pref = t;
} catch {}

export function isDark() {
  return theme.pref === 'dark' || (theme.pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}

export function setTheme(pref: ThemePref, origin?: { x: number; y: number }) {
  const apply = () => {
    theme.pref = pref;
    if (pref === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = pref;
    try {
      pref === 'system' ? localStorage.removeItem('rv-theme') : localStorage.setItem('rv-theme', pref);
    } catch {}
  };
  const doc = document as any;
  if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return apply();
  const x = origin?.x ?? innerWidth - 40;
  const y = origin?.y ?? 40;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const t = doc.startViewTransition(() => flushSync(apply));
  t.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 650, easing: 'cubic-bezier(.3,0,0,1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
}

// ---------------------------------------------------------------- petals
export function petals(count = 36) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#f2b8c6', '#f7cdd6', '#e99aa9', '#f9dfe4', '#dfe4bb', '#f5d9cc'];
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
  document.body.appendChild(layer);
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    const size = 8 + Math.random() * 10;
    p.style.cssText = `position:absolute;top:-24px;left:${Math.random() * 100}%;width:${size}px;height:${size * 0.78}px;background:${colors[i % colors.length]};border-radius:${size}px 0 ${size}px 0;opacity:.95;box-shadow:0 1px 2px rgba(0,0,0,.08)`;
    layer.appendChild(p);
    const dx = (Math.random() - 0.5) * 300;
    const dur = 2800 + Math.random() * 2200;
    p.animate(
      [
        { transform: `translate(0,0) rotate(0deg)` },
        { transform: `translate(${dx * 0.5}px, ${innerHeight * 0.5}px) rotate(${180 + Math.random() * 180}deg)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${innerHeight + 40}px) rotate(${360 + Math.random() * 360}deg)`, opacity: 0.6 },
      ],
      { duration: dur, delay: Math.random() * 900, easing: 'cubic-bezier(.3,.2,.5,1)', fill: 'both' },
    );
  }
  setTimeout(() => layer.remove(), 6500);
}

export function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function timeAgo(iso: string | undefined | null): string {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export function duration(ms: number | undefined): string {
  if (!ms && ms !== 0) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export async function copy(text: string, label = 'Copied') {
  await navigator.clipboard.writeText(text);
  toast(label, 'success', undefined, 1800);
}

export function downloadBlob(data: BlobPart, name: string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.dataset.native = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
