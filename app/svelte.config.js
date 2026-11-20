import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Svelte 5: components use runes ($state, $derived, $props); detected per file.
export default {
  preprocess: vitePreprocess(),
};
