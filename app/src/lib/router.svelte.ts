import { flushSync } from 'svelte';

export interface Route {
  path: string;
  name: string;
  params: Record<string, string>;
  query: URLSearchParams;
  hash: string;
}

const patterns: [string, RegExp, string[]][] = [];
export function definePatterns(list: [name: string, pattern: string][]) {
  for (const [name, pat] of list) {
    const keys: string[] = [];
    const re = new RegExp(
      '^' +
        pat.replace(/\/:(\w+)(\?)?/g, (_, k, opt) => {
          keys.push(k);
          return opt ? '(?:/([^/]+))?' : '/([^/]+)';
        }) +
        '/?$',
    );
    patterns.push([name, re, keys]);
  }
}

function match(path: string): { name: string; params: Record<string, string> } {
  for (const [name, re, keys] of patterns) {
    const m = path.match(re);
    if (m) {
      const params: Record<string, string> = {};
      keys.forEach((k, i) => m[i + 1] !== undefined && (params[k] = decodeURIComponent(m[i + 1])));
      return { name, params };
    }
  }
  return { name: 'notfound', params: {} };
}

function current(): Route {
  const { pathname, search, hash } = location;
  const m = match(pathname);
  return { path: pathname, name: m.name, params: m.params, query: new URLSearchParams(search), hash };
}

export const router = $state<{ route: Route; direction: 'forward' | 'back'; depth: number }>({
  route: { path: '/', name: 'landing', params: {}, query: new URLSearchParams(), hash: '' },
  direction: 'forward',
  depth: 0,
});

let historyIndex = 0;

export function initRouter() {
  router.route = current();
  historyIndex = history.state?.i ?? 0;
  if (history.state?.i === undefined) history.replaceState({ i: 0 }, '');
  addEventListener('popstate', (e) => {
    const i = e.state?.i ?? 0;
    const dir = i < historyIndex ? 'back' : 'forward';
    historyIndex = i;
    transition(() => {
      router.direction = dir;
      router.route = current();
    }, dir);
  });
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest('a');
    if (!a || a.target || a.hasAttribute('download') || a.dataset.native !== undefined) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || /^[a-z]+:/i.test(href)) return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
    e.preventDefault();
    navigate(url.pathname + url.search + url.hash, { back: a.dataset.back !== undefined });
  });
}

function transition(update: () => void, dir: 'forward' | 'back') {
  const doc = document as any;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduce) {
    update();
    scrollTo({ top: 0 });
    return;
  }
  document.documentElement.classList.toggle('vt-back', dir === 'back');
  const t = doc.startViewTransition(() => {
    flushSync(update);
    scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  });
  t.finished.finally(() => document.documentElement.classList.remove('vt-back'));
}

export function navigate(to: string, opts: { replace?: boolean; back?: boolean } = {}) {
  const url = new URL(to, location.href);
  if (url.pathname + url.search === location.pathname + location.search && !opts.replace) {
    if (url.hash !== location.hash) location.hash = url.hash;
    return;
  }
  const dir = opts.back ? 'back' : 'forward';
  transition(() => {
    if (opts.replace) history.replaceState({ i: historyIndex }, '', url);
    else {
      historyIndex++;
      history.pushState({ i: historyIndex }, '', url);
    }
    router.direction = dir;
    router.route = current();
  }, dir);
}

export function goBack(fallback: string) {
  if (historyIndex > 0) history.back();
  else navigate(fallback, { back: true, replace: true });
}
