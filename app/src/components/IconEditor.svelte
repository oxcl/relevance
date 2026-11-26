<script lang="ts">
  import { onMount } from 'svelte';
  import { slide, scale } from 'svelte/transition';
  import type { IconEdit, Corner } from '$shared/types';
  import Icon from './Icon.svelte';
  import Switch from './Switch.svelte';
  import Dialog from './Dialog.svelte';
  import { render, loadImage, freshEdit } from '$lib/iconRender';
  import { ripple } from '$lib/ui.svelte';

  let {
    base = null,
    edit = $bindable(),
    label = '',
    canvas = $bindable(),
    onupload,
  }: { base?: string | null; edit: IconEdit; label?: string; canvas?: HTMLCanvasElement; onupload?: (f: File) => void } = $props();

  let paths = $state<Record<string, string>>({});
  let badgeList = $state<string[]>([]);
  let img = $state<HTMLImageElement | null>(null);
  let imgError = $state(false);
  let browse = $state(false);
  let search = $state('');
  let open = $state({ image: true, badge: true, text: false });
  let smalls: HTMLCanvasElement[] = $state([]);
  const sizes = [192, 96, 48, 24];

  onMount(async () => {
    const m = await import('$lib/badge-data');
    paths = m.BADGE_PATHS;
    badgeList = m.BADGE_ICONS;
    if (innerWidth < 760) open = { image: false, badge: false, text: false };
  });

  $effect(() => {
    imgError = false;
    if (!base) {
      img = null;
      return;
    }
    loadImage(base).then(
      (i) => (img = i),
      () => ((img = null), (imgError = true)),
    );
  });

  $effect(() => {
    // re-render on any edit change
    const snapshot = JSON.stringify(edit);
    void snapshot;
    if (!canvas) return;
    render(canvas, img, base || '', edit, paths, label);
    for (let i = 0; i < smalls.length; i++) {
      const c = smalls[i];
      if (!c) continue;
      const s = Math.min(96, sizes[i]);
      c.width = c.height = s * 2;
      const x = c.getContext('2d')!;
      x.imageSmoothingQuality = 'high';
      x.clearRect(0, 0, c.width, c.height);
      x.drawImage(canvas, 0, 0, c.width, c.height);
    }
  });

  const presets = ['text:RV', 'bolt', 'science', 'workspace_premium', 'settings', 'favorite'];
  const fgColors = ['#ffffff', '#36271d', '#bf6447', '#e39a3b', '#8a9a45', '#4f7fb0'];
  const bgColors = ['#ffffff', '#f5d9cc', '#bf6447', '#8a9a45', '#5d5a55', '#2b2420'];
  const filtered = $derived(badgeList.filter((b) => b.includes(search.toLowerCase().replace(/\s+/g, '_'))));
  const fmt = (v: number, unit = '%') => `${v > 0 ? '+' : ''}${v}${unit}`;
  let fileInput: HTMLInputElement;
</script>

<div class="editor">
  <div class="preview card flat">
    <div class="big">
      <canvas bind:this={canvas} width="512" height="512" class="main" aria-label="Icon preview"></canvas>
      <span class="gloss"></span>
    </div>
    {#if imgError}<div class="hint warnline"><Icon name="warning" size={16} />Couldn't load the source icon — upload one instead.</div>{/if}
    <div class="smalls">
      {#each sizes as s, i}
        <figure style="--d:{i}">
          <canvas bind:this={smalls[i]} style="width:{Math.min(64, Math.max(24, s / 3))}px;height:{Math.min(64, Math.max(24, s / 3))}px"></canvas>
          <figcaption class="mono">{s}</figcaption>
        </figure>
      {/each}
    </div>
  </div>

  <div class="panels">
    <section class="panel card flat">
      <button class="ph" onclick={() => (open.image = !open.image)} aria-expanded={open.image}>
        <Icon name="image" /> <span>Image</span> <Icon name={open.image ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} />
      </button>
      {#if open.image}
        <div class="pb" transition:slide={{ duration: 280 }}>
          {#each [['hue', 'Hue', -180, 180, '°'], ['brightness', 'Brightness', -60, 60, '%'], ['saturation', 'Saturation', -100, 100, '%'], ['contrast', 'Contrast', -60, 60, '%']] as [k, l, min, max, u]}
            <label class="slider {k}">
              <span class="sl">{l}</span>
              <input type="range" min={min} max={max} bind:value={(edit as any)[k]} />
              <span class="val mono">{fmt((edit as any)[k], u as string)}</span>
            </label>
          {/each}
          <div class="wrap-row">
            <button class="btn tonal-terra sm" onclick={() => fileInput.click()} use:ripple><Icon name="upload" size={18} /> Upload your own icon</button>
            <button class="btn text sm" onclick={() => { edit.hue = 0; edit.brightness = 0; edit.saturation = 0; edit.contrast = 0; }}>Reset</button>
            <input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onupload?.(f); }} />
          </div>
        </div>
      {/if}
    </section>

    <section class="panel card flat">
      <button class="ph" onclick={() => (open.badge = !open.badge)} aria-expanded={open.badge}>
        <Icon name="star" /> <span>Badge</span>
        <span class="ph-sw" role="presentation" onclick={(e) => e.stopPropagation()}><Switch bind:checked={edit.badge.enabled} label="Show badge" /></span>
        <Icon name={open.badge ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} />
      </button>
      {#if open.badge}
        <div class="pb" class:dim={!edit.badge.enabled} transition:slide={{ duration: 280 }}>
          <div class="rowline">
            <span class="sl">Preset</span>
            <div class="presets">
              {#each presets as p}
                <button class="pre" class:on={edit.badge.icon === p} onclick={() => { edit.badge.icon = p; edit.badge.enabled = true; }} aria-label={p}>
                  {#if p.startsWith('text:')}<b>{p.slice(5)}</b>{:else if paths[p]}<svg viewBox="0 -960 960 960" width="20" height="20"><path fill="currentColor" d={paths[p]} /></svg>{/if}
                </button>
              {/each}
              <button class="btn tonal-terra sm" onclick={() => (browse = true)}><Icon name="folder_open" size={18} /> Browse icons</button>
            </div>
          </div>
          {#if edit.badge.icon.startsWith('text:')}
            <label class="rowline"><span class="sl">Badge text</span><input class="input sm-in" maxlength="3" value={edit.badge.icon.slice(5)} oninput={(e) => (edit.badge.icon = 'text:' + (e.target as HTMLInputElement).value)} /></label>
          {/if}
          <div class="two">
            <div>
              <span class="sl">Foreground</span>
              <div class="swatches">
                {#each fgColors as c}<button class="sw" class:on={edit.badge.fg === c} style="--c:{c}" onclick={() => (edit.badge.fg = c)} aria-label={c}></button>{/each}
                <input type="color" bind:value={edit.badge.fg} aria-label="Custom foreground" />
              </div>
            </div>
            <div>
              <span class="sl">Background</span>
              <div class="swatches">
                {#each bgColors as c}<button class="sw" class:on={edit.badge.bg === c} style="--c:{c}" onclick={() => (edit.badge.bg = c)} aria-label={c}></button>{/each}
                <input type="color" bind:value={edit.badge.bg} aria-label="Custom background" />
              </div>
            </div>
          </div>
          <div class="two">
            <div class="stack-s">
              <div class="tog"><Switch bind:checked={edit.badge.iconBorder} label="Icon border" /><span>Icon border</span><input type="color" bind:value={edit.badge.iconBorderColor} /></div>
              <div class="tog"><Switch bind:checked={edit.badge.circleBorder} label="Circle border" /><span>Circle border</span><input type="color" bind:value={edit.badge.circleBorderColor} /></div>
              <label class="slider"><span class="sl">Size</span><input type="range" min="20" max="56" bind:value={edit.badge.size} /><span class="val mono">{edit.badge.size}%</span></label>
            </div>
            <div>
              <span class="sl">Position</span>
              <div class="corners">
                {#each ['tl', 'tr', 'bl', 'br'] as c}
                  <button class:on={edit.badge.corner === c} onclick={() => (edit.badge.corner = c as Corner)} aria-label="Corner {c}"><span></span></button>
                {/each}
              </div>
            </div>
          </div>
        </div>
      {/if}
    </section>

    <section class="panel card flat">
      <button class="ph" onclick={() => (open.text = !open.text)} aria-expanded={open.text}>
        <Icon name="text_fields" /> <span>Text</span>
        <span class="ph-sw" role="presentation" onclick={(e) => e.stopPropagation()}><Switch bind:checked={edit.text.enabled} label="Show text" /></span>
        <Icon name={open.text ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} />
      </button>
      {#if open.text}
        <div class="pb" class:dim={!edit.text.enabled} transition:slide={{ duration: 280 }}>
          <div class="three">
            <label class="field"><span class="sl">Text</span><input class="input" maxlength="12" bind:value={edit.text.value} oninput={() => (edit.text.enabled = true)} /></label>
            <div>
              <span class="sl">Foreground</span>
              <div class="swatches">
                {#each fgColors.slice(0, 5) as c}<button class="sw" class:on={edit.text.fg === c} style="--c:{c}" onclick={() => (edit.text.fg = c)} aria-label={c}></button>{/each}
                <input type="color" bind:value={edit.text.fg} />
              </div>
            </div>
            <div>
              <span class="sl">Background <input type="checkbox" bind:checked={edit.text.bgEnabled} aria-label="Background on" /></span>
              <div class="swatches">
                {#each bgColors.slice(0, 5) as c}<button class="sw" class:on={edit.text.bg === c} style="--c:{c}" onclick={() => ((edit.text.bg = c), (edit.text.bgEnabled = true))} aria-label={c}></button>{/each}
                <input type="color" bind:value={edit.text.bg} />
              </div>
            </div>
          </div>
          <div class="two">
            <div class="stack-s">
              <label class="slider"><span class="sl">Size</span><input type="range" min="0" max="100" bind:value={edit.text.size} /><span class="val mono">{edit.text.size}%</span></label>
              <div class="tog"><Switch bind:checked={edit.text.textBorder} label="Text border" /><span>Text border</span><input type="color" bind:value={edit.text.textBorderColor} /></div>
              <div class="tog"><Switch bind:checked={edit.text.boxBorder} label="Box border" /><span>Box border</span><input type="color" bind:value={edit.text.boxBorderColor} /></div>
            </div>
            <div>
              <span class="sl">Position</span>
              <div class="grid9">
                {#each Array(9) as _, i}<button class:on={edit.text.position === i} onclick={() => (edit.text.position = i)} aria-label="Position {i + 1}"><span></span></button>{/each}
              </div>
            </div>
          </div>
        </div>
      {/if}
    </section>
    <button class="btn text sm reset" onclick={() => (edit = freshEdit())}><Icon name="replay" size={18} /> Reset all edits</button>
  </div>
</div>

<Dialog bind:open={browse} title="Choose a badge icon" icon="star" wide>
  <div class="search"><Icon name="search" size={20} /><input class="input" placeholder="Search icons…" bind:value={search} /></div>
  <div class="iconlist">
    {#each filtered as b (b)}
      <button class:on={edit.badge.icon === b} title={b.replace(/_/g, ' ')} onclick={() => { edit.badge.icon = b; edit.badge.enabled = true; browse = false; }} in:scale={{ duration: 200, start: 0.7 }}>
        <svg viewBox="0 -960 960 960" width="26" height="26"><path fill="currentColor" d={paths[b]} /></svg>
      </button>
    {/each}
  </div>
</Dialog>

<style>
  .editor {
    display: grid;
    grid-template-columns: minmax(240px, 0.9fr) minmax(0, 1.3fr);
    gap: 18px;
    align-items: start;
  }
  .preview {
    position: sticky;
    top: 80px;
    display: grid;
    justify-items: center;
    gap: 18px;
    padding: 26px 18px;
    background: radial-gradient(circle at 50% 35%, var(--surface), var(--container));
  }
  .big {
    position: relative;
    width: min(240px, 60vw);
    aspect-ratio: 1;
    border-radius: 23%;
    overflow: hidden;
    box-shadow: var(--shadow-3);
    animation: rise 0.6s var(--ease-out);
    transition: transform 0.5s var(--ease-spring);
  }
  .big:hover {
    transform: rotate(-2deg) scale(1.03);
  }
  .main {
    width: 100%;
    height: 100%;
    display: block;
  }
  .gloss {
    position: absolute;
    inset: 0;
    background: linear-gradient(160deg, rgba(255, 255, 255, 0.22), transparent 40%);
    pointer-events: none;
  }
  .smalls {
    display: flex;
    gap: 18px;
    align-items: flex-end;
  }
  figure {
    margin: 0;
    display: grid;
    justify-items: center;
    gap: 6px;
    animation: rise 0.5s var(--ease-out) both;
    animation-delay: calc(var(--d) * 70ms + 200ms);
  }
  figure canvas {
    border-radius: 23%;
    box-shadow: var(--shadow-1);
  }
  figcaption {
    font-size: 0.72rem;
    color: var(--muted);
  }
  .warnline {
    color: var(--terra);
  }
  .panels {
    display: grid;
    gap: 12px;
  }
  .panel {
    overflow: hidden;
  }
  .ph {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    border: 0;
    background: none;
    font-weight: 700;
    font-size: 1.05rem;
    cursor: pointer;
    text-align: left;
  }
  .ph > span:first-of-type {
    flex: 1;
  }
  .ph:hover {
    background: var(--surface-2);
  }
  .ph-sw {
    display: flex;
  }
  .pb {
    display: grid;
    gap: 14px;
    padding: 4px 18px 18px;
    transition: opacity 0.3s;
  }
  .pb.dim {
    opacity: 0.55;
  }
  .sl {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-2);
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .slider {
    display: grid;
    grid-template-columns: 90px 1fr 58px;
    align-items: center;
    gap: 12px;
  }
  .val {
    text-align: center;
    padding: 4px 6px;
    border-radius: 8px;
    background: var(--container);
    font-size: 0.78rem;
  }
  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 8px;
    border-radius: 99px;
    background: linear-gradient(90deg, var(--sand), var(--terra));
    outline: none;
  }
  .hue input[type='range'] {
    background: linear-gradient(90deg, #e05757, #e0c057, #6ac257, #57c2c2, #5770e0, #c257e0, #e05757);
  }
  .saturation input[type='range'] {
    background: linear-gradient(90deg, #9b9b9b, #e0573c);
  }
  .brightness input[type='range'] {
    background: linear-gradient(90deg, #3a2c22, #fff3e4);
  }
  .contrast input[type='range'] {
    background: linear-gradient(90deg, #b9a998, #2a1f17);
  }
  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--surface);
    border: 3px solid var(--olive);
    box-shadow: var(--shadow-1);
    cursor: grab;
    transition: transform 0.2s var(--ease-spring);
  }
  input[type='range']::-webkit-slider-thumb:active {
    transform: scale(1.25);
  }
  input[type='range']::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--surface);
    border: 3px solid var(--olive);
    cursor: grab;
  }
  .rowline {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .pre {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    border: 1.5px solid var(--outline);
    background: var(--surface);
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--text);
    font-size: 0.8rem;
    transition: all 0.25s var(--ease-spring);
  }
  .pre:hover {
    transform: translateY(-2px);
  }
  .pre.on {
    border-color: var(--olive);
    background: var(--olive-c);
    color: var(--on-olive-c);
    transform: scale(1.06);
  }
  .sm-in {
    width: 90px;
    min-height: 38px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .three {
    display: grid;
    grid-template-columns: 1fr 1.2fr 1.2fr;
    gap: 14px;
  }
  .stack-s {
    display: grid;
    gap: 10px;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
    align-items: center;
  }
  .sw {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    border: 2px solid var(--outline);
    background: var(--c);
    cursor: pointer;
    transition: transform 0.25s var(--ease-spring), box-shadow 0.2s;
  }
  .sw:hover {
    transform: scale(1.12);
  }
  .sw.on {
    box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--terra);
    transform: scale(1.08);
  }
  input[type='color'] {
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: none;
    cursor: pointer;
  }
  .tog {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 0.9rem;
  }
  .tog span {
    flex: 1;
  }
  .corners,
  .grid9 {
    display: grid;
    grid-template-columns: repeat(2, 30px);
    gap: 6px;
    padding: 8px;
    margin-top: 6px;
    border-radius: 14px;
    border: 1.5px solid var(--outline);
    width: max-content;
  }
  .grid9 {
    grid-template-columns: repeat(3, 26px);
  }
  .corners button,
  .grid9 button {
    aspect-ratio: 1;
    border: 0;
    border-radius: 8px;
    background: var(--container);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: background 0.25s, transform 0.25s var(--ease-spring);
  }
  .corners button:hover,
  .grid9 button:hover {
    transform: scale(1.1);
  }
  .corners button.on,
  .grid9 button.on {
    background: var(--olive);
  }
  .reset {
    justify-self: end;
  }
  .search {
    position: relative;
    margin-bottom: 14px;
  }
  .search :global(svg) {
    position: absolute;
    left: 12px;
    top: 13px;
    color: var(--muted);
  }
  .search .input {
    padding-left: 40px;
  }
  .iconlist {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
    gap: 8px;
  }
  .iconlist button {
    aspect-ratio: 1;
    border-radius: 14px;
    border: 1.5px solid transparent;
    background: var(--surface-2);
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--text);
    transition: all 0.2s var(--ease-spring);
  }
  .iconlist button:hover {
    transform: scale(1.1);
    background: var(--olive-c);
  }
  .iconlist button.on {
    border-color: var(--olive);
    background: var(--olive-c);
  }
  @media (max-width: 900px) {
    .editor {
      grid-template-columns: 1fr;
    }
    .preview {
      position: relative;
      top: 0;
    }
    .three {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 520px) {
    .two {
      grid-template-columns: 1fr;
    }
    .slider {
      grid-template-columns: 76px 1fr 52px;
    }
  }
</style>
