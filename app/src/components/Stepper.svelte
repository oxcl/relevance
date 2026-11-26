<script lang="ts">
  import Icon from './Icon.svelte';
  let { steps, current, onjump, compactLabels = [] }: { steps: string[]; current: number; onjump?: (i: number) => void; compactLabels?: string[] } = $props();
</script>

<ol class="stepper" style="--n:{steps.length};--p:{steps.length > 1 ? current / (steps.length - 1) : 0}">
  <span class="track" aria-hidden="true"><span class="fill"></span></span>
  {#each steps as s, i}
    <li class:done={i < current} class:active={i === current}>
      <button type="button" disabled={i > current || !onjump} onclick={() => onjump?.(i)} aria-current={i === current ? 'step' : undefined}>
        <span class="dot">
          {#if i < current}<Icon name="check" size={18} />{:else}{i + 1}{/if}
        </span>
        <span class="lbl"><span class="full">{s}</span><span class="short">{compactLabels[i] || s}</span></span>
      </button>
    </li>
  {/each}
</ol>

<style>
  .stepper {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--n), 1fr);
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .track {
    position: absolute;
    top: 17px;
    left: calc(50% / var(--n));
    right: calc(50% / var(--n));
    height: 2px;
    background: var(--outline);
    border-radius: 2px;
  }
  .fill {
    position: absolute;
    inset: 0;
    background: var(--olive);
    transform-origin: left;
    transform: scaleX(var(--p));
    transition: transform 0.7s var(--ease-emph);
    border-radius: 2px;
  }
  li {
    display: flex;
    justify-content: center;
    position: relative;
  }
  button {
    display: grid;
    justify-items: center;
    gap: 6px;
    border: 0;
    background: none;
    padding: 0;
    cursor: pointer;
    color: var(--muted);
    font-weight: 500;
    font-size: 0.88rem;
  }
  button:disabled {
    cursor: default;
  }
  .dot {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--container);
    color: var(--text-2);
    font-weight: 700;
    font-size: 0.9rem;
    box-shadow: 0 0 0 5px var(--bg);
    transition:
      background-color 0.4s var(--ease),
      color 0.3s,
      transform 0.5s var(--ease-spring),
      box-shadow 0.4s;
  }
  li.done .dot {
    background: var(--olive);
    color: var(--on-olive);
    animation: pop 0.5s var(--ease-spring);
  }
  li.active .dot {
    background: var(--terra);
    color: var(--on-terra);
    transform: scale(1.08);
    box-shadow:
      0 0 0 5px var(--bg),
      0 0 0 9px color-mix(in srgb, var(--terra) 22%, transparent);
  }
  li.active button {
    color: var(--terra);
    font-weight: 700;
  }
  li.done button {
    color: var(--text);
  }
  li.done button:hover .dot {
    transform: scale(1.1);
  }
  .short {
    display: none;
  }
  @keyframes pop {
    0% {
      transform: scale(0.6);
    }
  }
  @media (max-width: 640px) {
    .dot {
      width: 30px;
      height: 30px;
      font-size: 0.8rem;
    }
    .track {
      top: 14px;
    }
    button {
      font-size: 0.7rem;
    }
    .full {
      display: none;
    }
    .short {
      display: inline;
    }
  }
</style>
