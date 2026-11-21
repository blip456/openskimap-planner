<script lang="ts">
  // iOS switch (spec §2.11): a real checkbox with role="switch", drawn as a 51 × 31 track.
  let {
    checked,
    onchange,
    label,
    disabled = false,
    testid,
  }: { checked: boolean; onchange: (on: boolean) => void; label?: string; disabled?: boolean; testid?: string } = $props();
</script>

<span class="switch">
  <input
    type="checkbox"
    role="switch"
    {checked}
    {disabled}
    aria-label={label}
    aria-checked={checked}
    data-testid={testid}
    onchange={(e) => onchange(e.currentTarget.checked)}
  />
  <span class="track" aria-hidden="true"><span class="thumb"></span></span>
</span>

<style>
  .switch {
    position: relative;
    flex: none;
    width: 51px;
    height: 31px;
    display: inline-block;
  }
  input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
    z-index: 1;
  }
  input:disabled {
    cursor: default;
  }
  .track {
    position: absolute;
    inset: 0;
    border-radius: 16px;
    background: var(--fill-1);
    transition: background var(--dur-fast);
  }
  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 27px;
    height: 27px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15), 0 3px 1px rgba(0, 0, 0, 0.06);
    transition: transform var(--dur-press) var(--spring-press);
  }
  input:checked + .track {
    background: var(--green);
  }
  input:checked + .track .thumb {
    transform: translateX(20px);
  }
  input:disabled + .track {
    opacity: 0.4;
  }
  input:focus-visible + .track {
    outline: 3px solid var(--focus-ring);
    outline-offset: 2px;
  }
  @media (prefers-contrast: more) {
    input:not(:checked) + .track {
      box-shadow: inset 0 0 0 1px var(--label-3);
    }
  }
</style>
