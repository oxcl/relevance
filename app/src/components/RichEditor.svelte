<script lang="ts">
  import { onMount } from 'svelte';
  import DOMPurify from 'dompurify';
  import Icon from './Icon.svelte';
  let { value = $bindable(''), max = 4000 }: { value?: string; max?: number } = $props();
  let el: HTMLDivElement;
  let length = $state(0);
  const ALLOWED = { ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 's', 'code', 'a', 'ul', 'ol', 'li', 'blockquote', 'h3'], ALLOWED_ATTR: ['href'] };
  export function clean(html: string) {
    return DOMPurify.sanitize(html, ALLOWED) as string;
  }
  onMount(() => {
    el.innerHTML = clean(value || '');
    length = el.innerText.length;
  });
  let lastSet = '';
  $effect(() => {
    // external resets (e.g. "reset to source")
    if (el && value !== lastSet && clean(value) !== clean(el.innerHTML)) {
      el.innerHTML = clean(value || '');
      length = el.innerText.length;
    }
  });
  function sync() {
    lastSet = clean(el.innerHTML);
    value = lastSet;
    length = el.innerText.length;
  }
  function cmd(c: string, arg?: string) {
    el.focus();
    document.execCommand(c, false, arg);
    sync();
  }
  function link() {
    const url = prompt('Link URL');
    if (url && /^https?:\/\//.test(url)) cmd('createLink', url);
  }
  function paste(e: ClipboardEvent) {
    e.preventDefault();
    const html = e.clipboardData?.getData('text/html');
    const text = e.clipboardData?.getData('text/plain') || '';
    document.execCommand('insertHTML', false, html ? clean(html) : text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/\n/g, '<br>'));
    sync();
  }
  const tools: [string, string, () => void][] = [
    ['format_bold', 'Bold', () => cmd('bold')],
    ['format_italic', 'Italic', () => cmd('italic')],
    ['strikethrough_s', 'Strikethrough', () => cmd('strikeThrough')],
    ['code', 'Code', () => cmd('insertHTML', `<code>${getSelection()?.toString() || 'code'}</code>`)],
    ['link', 'Link', link],
    ['format_list_bulleted', 'Bulleted list', () => cmd('insertUnorderedList')],
    ['format_list_numbered', 'Numbered list', () => cmd('insertOrderedList')],
    ['format_quote', 'Quote', () => cmd('formatBlock', 'blockquote')],
  ];
</script>

<div class="rte">
  <div class="bar" role="toolbar">
    <select class="fmt" onchange={(e) => cmd('formatBlock', (e.target as HTMLSelectElement).value)} aria-label="Paragraph style">
      <option value="p">Normal</option>
      <option value="h3">Heading</option>
    </select>
    <span class="sep"></span>
    {#each tools as [ic, label, run]}
      <button type="button" class="icon-btn sm" title={label} aria-label={label} onmousedown={(e) => e.preventDefault()} onclick={run}><Icon name={ic} size={20} /></button>
    {/each}
    <span class="sep"></span>
    <button type="button" class="icon-btn sm" title="Undo" aria-label="Undo" onclick={() => cmd('undo')}><Icon name="undo" size={20} /></button>
    <button type="button" class="icon-btn sm" title="Redo" aria-label="Redo" onclick={() => cmd('redo')}><Icon name="redo" size={20} /></button>
  </div>
  <div class="area" contenteditable="true" role="textbox" aria-multiline="true" tabindex="0" bind:this={el} oninput={sync} onpaste={paste}></div>
</div>
<div class="count mono" class:over={length > max}>{length.toLocaleString()} / {max.toLocaleString()}</div>

<style>
  .rte {
    border: 1.5px solid var(--outline);
    border-radius: 16px;
    background: var(--surface);
    overflow: hidden;
    transition: border-color 0.2s, box-shadow 0.25s;
  }
  .rte:focus-within {
    border-color: var(--olive);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--olive) 18%, transparent);
  }
  .bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--outline);
    background: var(--surface-2);
  }
  .fmt {
    border: 0;
    background: transparent;
    padding: 6px;
    border-radius: 8px;
    font-weight: 500;
    cursor: pointer;
  }
  .sep {
    width: 1px;
    height: 22px;
    background: var(--outline);
    margin: 0 6px;
  }
  .area {
    min-height: 150px;
    max-height: 380px;
    overflow: auto;
    padding: 12px 16px;
    outline: none;
    line-height: 1.6;
  }
  .area :global(p) {
    margin: 0 0 0.5em;
  }
  .area :global(code) {
    font-family: var(--mono);
    background: var(--container);
    padding: 1px 5px;
    border-radius: 6px;
    font-size: 0.88em;
  }
  .area :global(blockquote) {
    margin: 0.4em 0;
    padding-left: 12px;
    border-left: 3px solid var(--terra);
    color: var(--text-2);
  }
  .count {
    text-align: right;
    font-size: 0.75rem;
    color: var(--muted);
    margin-top: 4px;
  }
  .count.over {
    color: var(--error);
  }
</style>
