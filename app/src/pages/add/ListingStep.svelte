<script lang="ts">
  import { flip } from 'svelte/animate';
  import { scale } from 'svelte/transition';
  import Icon from '$c/Icon.svelte';
  import Hero from '$c/Hero.svelte';
  import RichEditor from '$c/RichEditor.svelte';
  import StepNav from '$c/StepNav.svelte';
  import { draft } from '$lib/draft.svelte';
  import { session, gh, proxied } from '$lib/store.svelte';
  import { CATEGORIES } from '$shared/logic';
  import { toast } from '$lib/ui.svelte';

  let { go }: { go: (d: number) => void } = $props();
  const d = draft.d;
  const l = d.app.listing;
  let fileInput: HTMLInputElement;
  let dragIdx = $state<number | null>(null);
  let overIdx = $state<number | null>(null);

  function shotUrl(s: string) {
    if (s.startsWith('new:')) return d.newShots.find((n) => n.id === s.slice(4))?.url || '';
    if (/^https?:/.test(s)) return proxied(s);
    return session.repo ? gh().rawUrl(session.repo, s) : '';
  }
  function addFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (l.screenshots.length >= 10) {
        toast('Up to 10 screenshots');
        break;
      }
      if (!/image\/(png|jpeg|webp)/.test(f.type)) continue;
      const id = Math.random().toString(36).slice(2, 9);
      d.newShots.push({ id, blob: f, url: URL.createObjectURL(f) });
      l.screenshots = [...l.screenshots, `new:${id}`];
    }
  }
  function drop(i: number) {
    if (dragIdx === null || dragIdx === i) return;
    const arr = [...l.screenshots];
    const [x] = arr.splice(dragIdx, 1);
    arr.splice(i, 0, x);
    l.screenshots = arr;
    dragIdx = overIdx = null;
  }
  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= l.screenshots.length) return;
    const arr = [...l.screenshots];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    l.screenshots = arr;
  }
  function reset() {
    const info = d.info;
    if (!info) return;
    l.summary = (info.summary || '').slice(0, 80);
    l.description = info.description ? (info.description.includes('<') ? info.description : `<p>${info.description}</p>`) : '';
    l.website = info.website || '';
    l.screenshots = (info.screenshots || []).slice(0, 8);
    toast('Reset to what the source provides');
  }
  const ok = $derived(l.summary.trim().length > 0 && l.summary.length <= 80);
</script>

<Hero title="How it appears in your store" subtitle="Pulled automatically from the source where possible — edit anything." art="store" artWidth={430} compact>
  {#if d.info?.summary || d.info?.screenshots?.length}<button class="reset" onclick={reset}><Icon name="replay" size={18} /> Reset to source</button>{/if}
</Hero>

<div class="card pad form">
  <label class="field">
    <span class="label">Short summary <span class="req">*</span></span>
    <input class="input" maxlength="80" bind:value={l.summary} placeholder="A feature-rich, ad-free client with useful tweaks." />
    <span class="count mono" class:over={l.summary.length > 80}>{l.summary.length} / 80</span>
  </label>
  <div class="field">
    <span class="label">Full description</span>
    <RichEditor bind:value={l.description} />
  </div>
  <div class="two">
    <label class="field">
      <span class="label">Category</span>
      <select class="select" bind:value={l.category}>{#each CATEGORIES as c}<option>{c}</option>{/each}</select>
    </label>
    <label class="field">
      <span class="label">Website <Icon name="open_in_new" size={14} /></span>
      <input class="input mono" type="url" bind:value={l.website} placeholder="https://" />
    </label>
  </div>
  <div class="field">
    <span class="label">Screenshots</span>
    <span class="muted small">Drag to reorder · Up to 10 images (PNG, JPG, WebP) · optional</span>
    <div class="shots">
      {#each l.screenshots as s, i (s)}
        <div
          class="shot"
          class:over={overIdx === i}
          class:dragging={dragIdx === i}
          draggable="true"
          role="listitem"
          animate:flip={{ duration: 300 }}
          in:scale={{ duration: 300, start: 0.8 }}
          ondragstart={() => (dragIdx = i)}
          ondragover={(e) => { e.preventDefault(); overIdx = i; }}
          ondragleave={() => (overIdx = null)}
          ondrop={() => drop(i)}
          ondragend={() => (dragIdx = overIdx = null)}
        >
          <span class="grip"><Icon name="drag_indicator" size={18} /></span>
          <img src={shotUrl(s)} alt="Screenshot {i + 1}" loading="lazy" />
          <button class="x" aria-label="Remove screenshot" onclick={() => (l.screenshots = l.screenshots.filter((x) => x !== s))}><Icon name="close" size={16} /></button>
          <div class="mv">
            <button aria-label="Move left" onclick={() => move(i, -1)}><Icon name="chevron_left" size={16} /></button>
            <button aria-label="Move right" onclick={() => move(i, 1)}><Icon name="chevron_right" size={16} /></button>
          </div>
        </div>
      {/each}
      {#if l.screenshots.length < 10}
        <button class="add" onclick={() => fileInput.click()}><Icon name="add" size={28} /><span>Add screenshot</span></button>
      {/if}
      <input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onchange={(e) => addFiles((e.target as HTMLInputElement).files)} />
    </div>
  </div>
</div>

<StepNav {go} canNext={ok} />

<style>
  .reset {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    border: 0;
    background: none;
    color: var(--terra);
    font-weight: 600;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }
  .reset:hover :global(svg) {
    transform: rotate(-180deg);
    transition: transform 0.5s var(--ease-spring);
  }
  .form {
    display: grid;
    gap: 18px;
  }
  .req {
    color: var(--terra);
  }
  .count {
    text-align: right;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .count.over {
    color: var(--error);
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .shots {
    display: flex;
    gap: 14px;
    overflow-x: auto;
    padding: 10px 2px 14px;
  }
  .shot {
    position: relative;
    flex: 0 0 auto;
    height: 220px;
    border-radius: 18px;
    overflow: hidden;
    background: var(--container);
    box-shadow: var(--shadow-1);
    cursor: grab;
    transition: transform 0.3s var(--ease-spring), box-shadow 0.3s, opacity 0.2s;
  }
  .shot:hover {
    transform: translateY(-3px);
    box-shadow: var(--shadow-2);
  }
  .shot.dragging {
    opacity: 0.4;
  }
  .shot.over {
    transform: scale(1.04);
    box-shadow: 0 0 0 3px var(--olive);
  }
  .shot img {
    height: 100%;
    width: auto;
    min-width: 100px;
    display: block;
    pointer-events: none;
  }
  .grip {
    position: absolute;
    left: 6px;
    top: 6px;
    color: #fff;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
  }
  .x {
    position: absolute;
    right: 6px;
    top: 6px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 0;
    display: grid;
    place-items: center;
    background: var(--surface);
    box-shadow: var(--shadow-1);
    cursor: pointer;
    transition: transform 0.25s var(--ease-spring);
  }
  .x:hover {
    transform: scale(1.15) rotate(90deg);
  }
  .mv {
    position: absolute;
    bottom: 6px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.2s;
  }
  .shot:hover .mv,
  .shot:focus-within .mv {
    opacity: 1;
  }
  .mv button {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 0;
    display: grid;
    place-items: center;
    background: var(--surface);
    cursor: pointer;
  }
  .add {
    flex: 0 0 auto;
    width: 140px;
    height: 220px;
    border-radius: 18px;
    border: 2px dashed var(--outline-strong);
    background: transparent;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 6px;
    cursor: pointer;
    color: var(--text-2);
    font-weight: 600;
    transition: all 0.25s var(--ease);
  }
  .add:hover {
    border-color: var(--olive);
    background: var(--surface-2);
    color: var(--olive-text);
  }
  @media (max-width: 640px) {
    .two {
      grid-template-columns: 1fr;
    }
    .shot,
    .add {
      height: 170px;
    }
  }
</style>
