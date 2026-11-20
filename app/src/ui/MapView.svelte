<script lang="ts">
  // Full-screen MapLibre map. Style built in the browser; tiles through pmtiles:// in both builds.
  import { onMount } from 'svelte';
  import { Map as MlMap, Marker, setWorkerUrl } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import type { DataSource, ResortEntry } from '../lib/data/types.ts';
  import type { RouteState } from '../lib/stores/route.svelte.ts';
  import { pointLetter, pointRole } from '../lib/stores/route.svelte.ts';
  import { buildMapStyle } from '../lib/map/style.ts';
  import { useDataSource } from '../lib/map/protocols.ts';
  import { addRouteLayers, pickFeature, setRouteSteps } from '../lib/map/route-layers.ts';
  import { allInside, boundsOf, coverZoom } from '../lib/map/camera.ts';

  let {
    ds,
    resort,
    route,
    bottomPadding = 0,
    onmarkertap,
  }: {
    ds: DataSource;
    resort: ResortEntry;
    route: RouteState;
    bottomPadding?: number;
    /** touch: a tap on a marker opens the Route sheet (spec §2.24); with a mouse it removes the point */
    onmarkertap?: (index: number) => void;
  } = $props();

  // the bundled MapLibre cannot find its worker file by itself
  setWorkerUrl(workerUrl);

  let container: HTMLDivElement;
  let map = $state.raw<MlMap | null>(null);
  let styleReady = $state(false);
  let idle = $state(false);
  const finePointer = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

  onMount(() => {
    useDataSource(ds);
    const m = new MlMap({
      container,
      style: buildMapStyle(ds, resort),
      // fill the screen with the resort (no empty strip around the data on a portrait phone)
      center: [(resort.bbox[0] + resort.bbox[2]) / 2, (resort.bbox[1] + resort.bbox[3]) / 2],
      zoom: Math.min(14, coverZoom(resort.bbox, container.clientWidth || 390, container.clientHeight || 844)),
      maxZoom: 19,
      maxPitch: 85,
      attributionControl: false,
    });
    m.on('load', () => {
      addRouteLayers(m);
      styleReady = true;
    });
    m.on('idle', () => (idle = true));
    m.on('movestart', () => (idle = false));
    m.on('click', (e) => {
      if (route.tap([e.lngLat.lng, e.lngLat.lat])) return;
      // explore mode: info cards come in phase 4; for now log what was tapped
      const f = pickFeature(m, e.point);
      if (f) console.info('[map] tapped', f.layer.id, f.properties.name ?? f.properties.label ?? f.properties.id);
    });
    m.on('error', (e) => console.error('[map]', e.error?.message ?? e));
    // test hook for the Playwright smoke tests (?e2e): lets them convert coordinates to screen points
    if (new URLSearchParams(location.search).has('e2e')) (window as Window & { __map?: MlMap }).__map = m;
    map = m;
    return () => {
      m.remove();
      map = null;
    };
  });

  $effect(() => {
    if (map && styleReady) setRouteSteps(map, route.result?.steps ?? null);
  });

  // must run before the fit below: setPadding jumps the camera and would stop a running fitBounds
  $effect(() => {
    map?.setPadding({ top: 0, right: 0, left: 0, bottom: bottomPadding });
  });

  // a new route that is (partly) hidden behind the sheet or the controls: fit it into the free area
  // bottom: room for the Plan and Locate buttons that ride on the sheet
  const FIT = { top: 140, bottom: 80, left: 40, right: 40 };
  $effect(() => {
    const m = map;
    const coords = route.result?.coordinates;
    if (!m || !coords) return;
    const b = boundsOf(coords);
    if (!b) return;
    const corners = [b[0], b[1], [b[0][0], b[1][1]] as [number, number], [b[1][0], b[0][1]] as [number, number]].map((c) => m.project(c));
    const c = m.getContainer();
    const box = { left: FIT.left, top: FIT.top, right: c.clientWidth - FIT.right, bottom: c.clientHeight - bottomPadding - FIT.bottom };
    if (!allInside(corners, box)) {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      m.fitBounds(b, { padding: FIT, maxZoom: 15.5, duration: reduce ? 0 : 700 });
    }
  });

  $effect(() => {
    if (map) map.getCanvas().style.cursor = route.planMode ? 'crosshair' : '';
  });

  // route point markers A, B, C… (DOM markers: few, and they need drag)
  $effect(() => {
    const m = map;
    if (!m) return;
    const points = route.points;
    const n = points.length;
    const markers = points.map((p, i) => {
      const el = document.createElement('div');
      el.className = `route-marker ${pointRole(i, n)}`;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `Point ${pointLetter(i)}, ${pointRole(i, n) === 'end' ? 'destination' : pointRole(i, n)}. Drag to move.`);
      el.dataset.testid = `marker-${pointLetter(i)}`;
      const dot = document.createElement('span');
      dot.textContent = pointLetter(i);
      el.append(dot);
      const marker = new Marker({ element: el, draggable: true }).setLngLat(p).addTo(m);
      let dragged = false;
      marker.on('dragstart', () => (dragged = true));
      marker.on('dragend', () => {
        const ll = marker.getLngLat();
        route.movePoint(i, [ll.lng, ll.lat]);
      });
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (dragged) {
          dragged = false;
          return;
        }
        if (finePointer) route.removePoint(i);
        else onmarkertap?.(i);
      });
      return marker;
    });
    return () => markers.forEach((mk) => mk.remove());
  });
</script>

<div
  class="map"
  bind:this={container}
  data-testid="map"
  data-style-ready={styleReady}
  data-idle={idle}
  aria-hidden="true"
></div>

<style>
  .map {
    position: fixed;
    inset: 0;
    z-index: var(--z-map);
    background: #eef0f2;
    touch-action: none;
  }
  /* route point markers (spec §2.24): 28 px circle inside a 44 px hit area */
  .map :global(.route-marker) {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    cursor: grab;
  }
  .map :global(.route-marker span) {
    width: var(--marker);
    height: var(--marker);
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    font: 700 13px var(--font-rounded);
    border: 2.5px solid #fff;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    box-sizing: border-box;
    animation: marker-in var(--dur-press) var(--spring-press);
  }
  .map :global(.route-marker.start span) {
    background: var(--point-start);
  }
  .map :global(.route-marker.stop span) {
    background: var(--point-stop);
  }
  .map :global(.route-marker.end span) {
    background: var(--point-end);
  }
  @keyframes marker-in {
    from {
      transform: scale(0.6);
    }
  }
</style>
