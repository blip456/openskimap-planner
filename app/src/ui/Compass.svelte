<script lang="ts">
  // Compass button (spec §2.7): only while the map is turned or tilted; the needle follows the bearing. A tap turns
  // the map back to north (and flat, unless 3D is on). After the reset it stays 1 s, then fades out.
  // `force`: always shown (in "follow with heading", spec §2.7)
  let { bearing, pitch, size = 48, force = false, onreset }: { bearing: number; pitch: number; size?: number; force?: boolean; onreset: () => void } = $props();
  const turned = $derived(force || Math.abs(bearing) > 1 || pitch > 1);
  let visible = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (turned) {
      if (timer) clearTimeout(timer);
      timer = null;
      visible = true;
    } else if (visible && !timer) {
      timer = setTimeout(() => {
        visible = false;
        timer = null;
      }, 1000);
    }
  });
</script>

{#if visible}
  <button
    type="button"
    class="glass compass"
    style:width={`${size}px`}
    style:height={`${size}px`}
    aria-label="Map is turned. Tap to point north."
    title="Map is turned. Click to point north."
    onclick={onreset}
    data-testid="compass"
  >
    <svg viewBox="0 0 30 30" width={size * 0.62} height={size * 0.62} style:transform={`rotate(${-bearing}deg)`} aria-hidden="true">
      <path d="M15 3 L19 15 L11 15 Z" fill="var(--red)" />
      <path d="M15 27 L11 15 L19 15 Z" fill="var(--label-3)" />
      <circle cx="15" cy="15" r="1.6" fill="var(--glass-label)" />
    </svg>
  </button>
{/if}

<style>
  .compass {
    border: 0;
    border-radius: var(--r-pill);
    padding: 0;
    display: grid;
    place-items: center;
    cursor: pointer;
    animation: fade-in var(--dur-fast) var(--ease-out);
  }
  .compass:active svg {
    scale: var(--press-scale);
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .compass {
      animation: none;
    }
  }
</style>
