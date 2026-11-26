<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$c/Icon.svelte';
  import { decodeRecipe } from '$shared/logic';
  import { draft, resetDraft } from '$lib/draft.svelte';
  import { session, signInUrl, data, saveConfig } from '$lib/store.svelte';
  import { navigate } from '$lib/router.svelte';
  import { freshEdit } from '$lib/iconRender';
  import { ripple, errorToast } from '$lib/ui.svelte';
  import type { Recipe } from '$shared/types';

  const raw = location.hash.slice(1);
  const recipe: Recipe | null = decodeRecipe(raw);
  let busy = $state(false);
  const toolName = { revanced: 'ReVanced', morphe: 'Morphe', lspatch: 'LSPatch', none: 'No patching' };

  async function use() {
    if (!recipe) return;
    busy = true;
    try {
      // make sure a custom patch source from the recipe exists
      let patchSourceId: string | undefined;
      if (recipe.patchSource && !['ReVanced', 'Morphe', 'LSPosed modules', 'LSPosed module repository'].includes(recipe.patchSource.name)) {
        const existing = data.config?.patchSources.find((s) => s.url === recipe.patchSource!.url);
        patchSourceId = existing?.id;
        if (!existing) {
          patchSourceId = `recipe-${Date.now().toString(36)}`;
          await saveConfig((c) => c.patchSources.push({ id: patchSourceId!, tool: recipe.patchSource!.tool, name: recipe.patchSource!.name, url: recipe.patchSource!.url }), `relevance: add patch source ${recipe.patchSource.name} from a recipe`);
        }
      }
      resetDraft();
      const d = draft.d;
      d.recipe = recipe;
      d.app.name = recipe.name;
      d.app.packageName = recipe.packageName;
      d.app.source = { ...recipe.source };
      d.app.tool = recipe.tool;
      d.app.patchSourceId = patchSourceId;
      d.app.patches = recipe.patches;
      d.app.customPatches = recipe.customPatches || [];
      d.app.customize = { name: recipe.customize.name, packageName: recipe.customize.packageName };
      if (recipe.customize.iconEdit) {
        d.iconEdit = { ...freshEdit(), ...recipe.customize.iconEdit };
        d.iconMode = 'edit';
      }
      (d as any).defaultsApplied = true;
      navigate('/add/source?keep=1', { replace: true });
    } catch (e) {
      errorToast(e);
    }
    busy = false;
  }
  onMount(() => {
    if (recipe && session.status === 'ready' && location.search.includes('auto')) use();
  });
</script>

<div class="wrap">
  <img class="art" src="/art/patches.webp" alt="" />
  {#if !recipe}
    <h1 class="display">That recipe looks incomplete</h1>
    <p class="muted">The link may have been cut off. Ask for it again, or start from scratch.</p>
    <a class="btn" href="/">Go to Relevance</a>
  {:else}
    <span class="tag olive"><Icon name="science" size={14} /> A shared recipe</span>
    <h1 class="display">Build your own {recipe.customize.name || recipe.name}</h1>
    <p class="muted">Someone shared how they build this app. Relevance will set up the same source, {toolName[recipe.tool]} {recipe.tool === 'lspatch' ? 'modules' : 'patches'} and tweaks — built in <b>your</b> GitHub, signed with <b>your</b> key.</p>
    <div class="card pad sum">
      <div><span class="muted small">Source</span><div class="mono">{recipe.source.url.replace(/^https?:\/\//, '').slice(0, 60)}</div></div>
      <div><span class="muted small">Tool</span><div>{toolName[recipe.tool]}</div></div>
      <div class="full"><span class="muted small">{recipe.patches.length + recipe.customPatches.length} {recipe.tool === 'lspatch' ? 'modules' : 'patches'}</span>
        <div class="chips">{#each recipe.patches.slice(0, 14) as p}<span class="tag">{p.name}</span>{/each}{#if recipe.patches.length > 14}<span class="tag">+{recipe.patches.length - 14}</span>{/if}</div></div>
    </div>
    {#if session.status === 'ready'}
      <button class="btn lg terra" onclick={use} disabled={busy} use:ripple><Icon name="science" /> Use this recipe</button>
    {:else if session.status === 'needs-setup'}
      <p class="notice info"><Icon name="info" />Finish setting up Relevance first, then open this link again.</p>
      <a class="btn lg" href="/setup">Set up Relevance</a>
    {:else}
      <a class="btn lg" href={signInUrl(`/recipe?auto=1#${raw}`)} data-native use:ripple><Icon name="github" /> Sign in to use this recipe</a>
    {/if}
  {/if}
</div>

<style>
  .wrap {
    max-width: 680px;
    margin: 0 auto;
    padding: 30px 16px 60px;
    display: grid;
    gap: 16px;
    justify-items: start;
  }
  .art {
    width: min(420px, 100%);
    justify-self: center;
  }
  .sum {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .full {
    grid-column: 1 / -1;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 6px;
  }
</style>
