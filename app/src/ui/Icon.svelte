<script lang="ts">
  // Lucide icon with the spec defaults (§7): 22 px, stroke 2 (2.25 at ≤ 17 px so small icons look semibold).
  import { icons, type IconName } from './icons.ts';

  let { name, size = 22, strokeWidth, filled = false }: { name: IconName; size?: number; strokeWidth?: number; filled?: boolean } = $props();
  const Component = $derived(icons[name]);
</script>

<Component
  {size}
  strokeWidth={strokeWidth ?? (size <= 17 ? 2.25 : 2)}
  fill={filled ? 'currentColor' : 'none'}
  aria-hidden="true"
  focusable="false"
/>
