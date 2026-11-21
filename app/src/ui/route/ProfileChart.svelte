<script lang="ts">
  // Gradient profile of the route (spec §2.17; old planner renderRouteProfile): elevation along the route, filled per
  // step (official colours) or per slice (steepness), route points A, B, C… at the leg ends, axes.
  // Scrubbing: drag a finger sideways along the chart (vertical drags scroll the sheet), or hover with a mouse,
  // or ←/→ on the focused chart. The readout replaces the chart header; a marker shows the point on the map.
  import { onDestroy } from 'svelte';
  import Segmented from '../Segmented.svelte';
  import { pointLetter, pointRole } from '../../lib/stores/route.svelte.ts';
  import {
    elevationAxis,
    pointMarks,
    profileLegend,
    routeProfilePoints,
    routeProfileSegments,
    sampleAt,
    type ProfileMode,
    type ProfileRoute,
    type ProfileSample,
    visibleDistanceTicks,
    endLabel,
  } from '../../lib/route/profile.ts';
  import { markerLabel, stepKind } from '../../lib/route/steps.ts';
  import { formatDistance } from '../../lib/format.ts';

  let {
    result,
    mode,
    onmode,
    oncursor,
    tall = false,
    desktop = false,
    title = 'Gradient profile',
    showPoints = true,
    testid = 'profile',
  }: {
    /** a route, or one run/lift as a one-step route (info cards) */
    result: ProfileRoute;
    mode: ProfileMode;
    /** without it the colours are fixed (no Official / Steepness switch) */
    onmode?: (m: ProfileMode) => void;
    /** [lon, lat] of the scrubbed point for the map marker, or null */
    oncursor: (p: [number, number] | null) => void;
    tall?: boolean;
    desktop?: boolean;
    title?: string;
    /** route points A, B, C… at the leg ends */
    showPoints?: boolean;
    testid?: string;
  } = $props();

  let width = $state(300);
  const H = $derived(tall ? 160 : 128);
  const pad = { left: 44, right: 16, top: 16, bottom: 20 };

  const points = $derived(routeProfilePoints(result));
  const usable = $derived(points.length >= 2 && points[points.length - 1].d >= 1);
  const segments = $derived(usable ? routeProfileSegments(result, points, mode) : []);
  const legend = $derived(profileLegend(segments, mode));
  const total = $derived(usable ? points[points.length - 1].d : 1);
  const axis = $derived(usable ? elevationAxis(points, 3) : { min: 0, max: 1, ticks: [] });
  const marks = $derived(usable && showPoints ? pointMarks(result, points) : []);

  const plotW = $derived(Math.max(10, width - pad.left - pad.right));
  const plotH = $derived(H - pad.top - pad.bottom);
  // ticks whose label would touch the end label are dropped (the end label shows the total)
  // middle ticks are round numbers; the end label is the real total (a 68 m lift must not say "100 m")
  const tickLabel = (d: number) => (d === 0 ? '0' : d >= total ? endLabel(total) : markerLabel(Math.round(d / 100) * 100));
  const xTicks = $derived(usable ? visibleDistanceTicks(total, plotW, tickLabel) : []);
  const baseY = $derived(pad.top + plotH);
  const x = (d: number) => pad.left + (d / total) * plotW;
  const y = (e: number) => pad.top + plotH - ((e - axis.min) / (axis.max - axis.min)) * plotH;
  const path = (from: number, to: number) =>
    points
      .slice(from, to + 1)
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.e).toFixed(1)}`)
      .join(' ');
  const areas = $derived(
    segments.map((s) => {
      const d0 = x(points[s.from].d).toFixed(1);
      const d1 = x(points[s.to].d).toFixed(1);
      return { d: `${path(s.from, s.to)} L${d1},${baseY} L${d0},${baseY} Z`, color: s.color };
    }),
  );
  const line = $derived(usable ? path(0, points.length - 1) : '');
  const nPoints = $derived(result.legs.length + 1);

  // --- scrubbing ---------------------------------------------------------------------------------------------
  let sample = $state<ProfileSample | null>(null);
  let fading = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let svg = $state<SVGSVGElement>() as SVGSVGElement;

  function show(d: number) {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    fading = false;
    sample = sampleAt(points, segments, d);
    oncursor(sample ? [sample.lon, sample.lat] : null);
  }

  /** after release: stay 1 s, then fade (150 ms) */
  function hideLater() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      fading = true;
      hideTimer = setTimeout(() => {
        sample = null;
        fading = false;
        oncursor(null);
      }, 150);
    }, 1000);
  }

  // a new route or mode invalidates the cursor
  $effect(() => {
    void segments;
    sample = null;
    oncursor(null);
  });
  onDestroy(() => {
    if (hideTimer) clearTimeout(hideTimer);
    oncursor(null);
  });

  const distAt = (clientX: number) => {
    const r = svg.getBoundingClientRect();
    return ((clientX - r.left - pad.left) / plotW) * total;
  };

  let touch: { id: number; x: number; y: number; scrubbing: boolean } | null = null;

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    touch = { id: e.pointerId, x: e.clientX, y: e.clientY, scrubbing: false };
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      show(distAt(e.clientX));
      return;
    }
    if (!touch || e.pointerId !== touch.id) return;
    if (!touch.scrubbing) {
      const dx = Math.abs(e.clientX - touch.x);
      const dy = Math.abs(e.clientY - touch.y);
      if (dy > 6 && dy >= dx) {
        touch = null; // vertical: the sheet moves or scrolls
        return;
      }
      if (dx <= 6) return;
      touch.scrubbing = true;
      svg.setPointerCapture(e.pointerId);
    }
    e.stopPropagation(); // the sheet must not move while scrubbing
    show(distAt(e.clientX));
  }

  function onPointerUp(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    if (!touch || e.pointerId !== touch.id) return;
    if (touch.scrubbing) e.stopPropagation();
    else show(distAt(e.clientX)); // tap: show that point
    touch = null;
    hideLater();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = total * (e.shiftKey ? 0.1 : 0.01);
    show((sample?.d ?? 0) + (e.key === 'ArrowRight' ? step : -step));
    hideLater();
  }

  const readout = $derived.by(() => {
    if (!sample) return null;
    const st = result.steps[sample.step];
    const ele = `${Math.round(sample.e)} m`;
    const main = st.type === 'lift' ? ele : `${Math.round(sample.slope * 100)}% · ${ele}`;
    const name = st.type !== 'walk' && st.label && st.label !== 'Unnamed run' ? st.label : null;
    const sub = [`at ${formatDistance(sample.d)}`, stepKind(st), ...(name ? [name] : [])].join(' · ');
    return { main, sub, color: sample.segment.color };
  });

  const eles = $derived(usable ? points.map((p) => p.e) : [0]);
  const description = $derived(
    usable ? `From ${Math.round(eles[0])} m to ${Math.round(eles[eles.length - 1])} m, ${formatDistance(total)}` : '',
  );
</script>

{#if usable}
  <div class="grp chart-cell" data-testid={testid}>
    <div class="head">
      {#if readout}
        <div class="readout" class:fading data-testid={`${testid}-readout`} aria-live="off">
          <div class="main"><i class="swatch" style:background={readout.color}></i>{readout.main}</div>
          <div class="sub">{readout.sub}</div>
        </div>
      {:else}
        <span class="title">{title}</span>
        {#if onmode}<div class="seg">
          <Segmented
            compact
            label="Colour the profile by"
            value={mode}
            onchange={onmode}
            testid="profile-mode"
            options={[
              { value: 'official', label: 'Official', title: 'Colour by the official piste difficulty' },
              { value: 'steepness', label: 'Steepness', title: 'Colour every slice by its measured gradient' },
            ]}
          />
        </div>{/if}
      {/if}
    </div>
    <div class="plot" bind:clientWidth={width}>
      <svg
        bind:this={svg}
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="slider"
        aria-label={`${title}. Drag along it to see a point on the map.`}
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(sample?.d ?? 0)}
        aria-valuetext={readout ? `${readout.main}, ${readout.sub}` : description}
        tabindex="0"
        data-testid={`${testid}-chart`}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={() => {
          touch = null;
          hideLater();
        }}
        onpointerleave={(e) => e.pointerType === 'mouse' && sample && hideLater()}
        onkeydown={onKey}
      >
        {#each axis.ticks as e (e)}
          <line class="grid" x1={pad.left} x2={width - pad.right} y1={y(e)} y2={y(e)} />
          <text class="ylabel" x={pad.left - 6} y={y(e)}>{e}</text>
        {/each}
        {#each areas as a, i (i)}
          <path d={a.d} fill={a.color} fill-opacity="0.85" />
        {/each}
        <path class="line" d={line} />
        {#each marks as d, i (i)}
          <line class="leg" x1={x(d)} x2={x(d)} y1={pad.top} y2={baseY} />
          <circle cx={x(d)} cy={pad.top - 6} r="7" class={`pt ${pointRole(i, nPoints)}`} />
          <text class="pt-label" x={x(d)} y={pad.top - 6}>{pointLetter(i)}</text>
        {/each}
        {#each xTicks as d, i (i)}
          <text
            class="xlabel"
            x={x(d)}
            y={H - 5}
            text-anchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>{tickLabel(d)}</text
          >
        {/each}
        {#if sample}
          <g class="cursor" class:fading>
            <line x1={x(sample.d)} x2={x(sample.d)} y1={pad.top} y2={baseY} />
            <circle cx={x(sample.d)} cy={y(sample.e)} r="6" />
          </g>
        {/if}
      </svg>
    </div>
    {#if legend.length}
      <div class="legend">
        {#each legend as l (l.key)}
          <span><i class="swatch" style:background={l.color}></i>{l.label}</span>
        {/each}
      </div>
    {/if}
    <p class="hint">{desktop ? 'Hover' : 'Drag along'} the profile to see a point on the map.</p>
  </div>
{/if}

<style>
  .chart-cell {
    padding: 0 0 12px;
  }
  .head {
    min-height: 50px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px 0;
    box-sizing: border-box;
  }
  .title {
    flex: 1;
    font-size: var(--t-subhead);
    font-weight: var(--fw-semibold);
  }
  .seg {
    flex: none;
    width: 170px;
  }
  .readout {
    flex: 1;
    min-width: 0;
    transition: opacity var(--dur-fast);
  }
  .readout .main {
    font: var(--fw-semibold) var(--t-subhead) var(--font-rounded);
    font-variant-numeric: tabular-nums;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .readout .sub {
    font-size: var(--t-caption);
    color: var(--label-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fading {
    opacity: 0;
    transition: opacity var(--dur-fast);
  }
  .plot {
    padding: 0;
  }
  svg {
    display: block;
    width: 100%;
    touch-action: pan-y;
    cursor: crosshair;
    outline: none;
    -webkit-user-select: none;
    user-select: none;
  }
  svg:focus-visible {
    outline: 3px solid var(--focus-ring);
    outline-offset: -3px;
    border-radius: var(--r-md);
  }
  .grid {
    stroke: var(--separator);
    stroke-width: 0.5;
  }
  .ylabel {
    font-size: 11px;
    fill: var(--label-2);
    text-anchor: end;
    dominant-baseline: middle;
    font-variant-numeric: tabular-nums;
  }
  .xlabel {
    font-size: 11px;
    fill: var(--label-2);
    font-variant-numeric: tabular-nums;
  }
  .line {
    fill: none;
    stroke: var(--label);
    stroke-opacity: 0.6;
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .leg {
    stroke: var(--label-3);
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }
  .pt {
    stroke: #fff;
    stroke-width: 1.5;
  }
  .pt.start {
    fill: var(--point-start);
  }
  .pt.stop {
    fill: var(--point-stop);
  }
  .pt.end {
    fill: var(--point-end);
  }
  .pt-label {
    font: 700 9px var(--font-rounded);
    fill: #fff;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }
  .cursor line {
    stroke: var(--label);
    stroke-width: 1.5;
  }
  .cursor circle {
    fill: #fff;
    stroke: var(--label);
    stroke-width: 3;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    padding: 6px 16px 0;
    font-size: var(--t-caption);
    color: var(--label-2);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .hint {
    margin: 6px 16px 0;
    font-size: var(--t-caption);
    color: var(--label-2);
  }
</style>
