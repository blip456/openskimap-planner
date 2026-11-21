<script lang="ts">
  // Full-screen MapLibre map. Style built in the browser; tiles through pmtiles:// in both builds.
  // Route line + highlight + arrows + distance markers, route point markers (drag with finger or mouse), the
  // profile cursor, "show this on the map" requests, and the map view that is saved with the state.
  import { onMount } from 'svelte';
  import { Map as MlMap, Marker, setWorkerUrl } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import type { DataSource, ResortEntry } from '../lib/data/types.ts';
  import type { RouteState } from '../lib/stores/route.svelte.ts';
  import { pointLetter, pointRole, ROLE_LABEL } from '../lib/stores/route.svelte.ts';
  import type { UiState } from '../lib/stores/ui.svelte.ts';
  import type { DisplayData, MapView as SavedView } from '../lib/stores/planner-persist.ts';
  import { buildMapStyle } from '../lib/map/style.ts';
  import { useDataSource } from '../lib/map/protocols.ts';
  import { addRouteLayers, pickFeature, setRouteDisplay, setRouteHighlight, setRouteSteps } from '../lib/map/route-layers.ts';
  import { allInside, boundsOf, coverZoom } from '../lib/map/camera.ts';

  let {
    ds,
    resort,
    route,
    ui,
    display,
    bottomPadding = 0,
    initialView = null,
    onview,
    onmarkertap,
    onmaptap,
  }: {
    ds: DataSource;
    resort: ResortEntry;
    route: RouteState;
    ui: UiState;
    display: DisplayData;
    bottomPadding?: number;
    initialView?: SavedView | null;
    onview?: (v: SavedView) => void;
    /** touch: a tap on a marker opens it in the Route sheet (spec §2.24); a mouse click removes the point */
    onmarkertap?: (index: number) => void;
    /** called first on every map tap; return true when the tap was used (e.g. large sheet → medium) */
    onmaptap?: () => boolean;
  } = $props();

  // the bundled MapLibre cannot find its worker file by itself
  setWorkerUrl(workerUrl);

  let container: HTMLDivElement;
  let map = $state.raw<MlMap | null>(null);
  let styleReady = $state(false);
  let idle = $state(false);
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = (ms: number) => (reduceMotion ? 0 : ms);

  onMount(() => {
    useDataSource(ds);
    const view = initialView && initialView.resort === resort.id ? initialView : null;
    const m = new MlMap({
      container,
      style: buildMapStyle(ds, resort),
      // fill the screen with the resort (no empty strip around the data on a portrait phone)
      center: view?.center ?? [(resort.bbox[0] + resort.bbox[2]) / 2, (resort.bbox[1] + resort.bbox[3]) / 2],
      zoom: view?.zoom ?? Math.min(14, coverZoom(resort.bbox, container.clientWidth || 390, container.clientHeight || 844)),
      bearing: view?.bearing ?? 0,
      pitch: view?.pitch ?? 0,
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
    m.on('moveend', () => {
      const c = m.getCenter();
      onview?.({ resort: resort.id, center: [c.lng, c.lat], zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() });
    });
    m.on('click', (e) => {
      if (onmaptap?.()) return;
      if (route.tap([e.lngLat.lng, e.lngLat.lat])) return;
      // explore mode: info cards come in phase 4b; for now log what was tapped
      const f = pickFeature(m, e.point);
      if (f) console.info('[map] tapped', f.layer.id, f.properties.name ?? f.properties.label ?? f.properties.id);
    });
    m.on('error', (e) => console.error('[map]', e.error?.message ?? e));
    // test hook for the Playwright tests (?e2e): lets them convert coordinates to screen points
    if (new URLSearchParams(location.search).has('e2e')) (window as Window & { __map?: MlMap }).__map = m;
    map = m;
    return () => {
      m.remove();
      map = null;
    };
  });

  $effect(() => {
    if (map && styleReady) setRouteSteps(map, route.result?.steps ?? null, route.result?.coordinates ?? null);
  });
  $effect(() => {
    if (map && styleReady) setRouteHighlight(map, ui.highlight);
  });
  $effect(() => {
    if (map && styleReady) setRouteDisplay(map, { showArrows: display.showArrows, showDistances: display.showDistances });
  });

  // must run before the fits below: setPadding jumps the camera and would stop a running fitBounds
  $effect(() => {
    map?.setPadding({ top: 0, right: 0, left: 0, bottom: bottomPadding });
  });

  // room for the controls (top row, mode pill) and for the Plan and Locate buttons that ride on the sheet
  const FIT = { top: 140, bottom: 80, left: 40, right: 40 };

  function hidden(m: MlMap, b: [[number, number], [number, number]]): boolean {
    const corners = [b[0], b[1], [b[0][0], b[1][1]] as [number, number], [b[1][0], b[0][1]] as [number, number]].map((c) => m.project(c));
    const c = m.getContainer();
    return !allInside(corners, { left: FIT.left, top: FIT.top, right: c.clientWidth - FIT.right, bottom: c.clientHeight - bottomPadding - FIT.bottom });
  }

  // a new route that is (partly) hidden behind the sheet or the controls: fit it into the free area.
  // Not after a change of an existing route (dragging a point near the sheet must not move the map).
  let hadRoute = false;
  $effect(() => {
    const m = map;
    const coords = route.result?.coordinates;
    const isNew = !!coords && !hadRoute;
    hadRoute = !!coords;
    if (!m || !coords || !isNew) return;
    const b = boundsOf(coords);
    if (b && hidden(m, b)) m.fitBounds(b, { padding: FIT, maxZoom: 15.5, duration: duration(700) });
  });

  // "show this part on the map" (leg zoom, step tap, opened saved route)
  $effect(() => {
    const m = map;
    const req = ui.fitRequest;
    if (!m || !req) return;
    const b = boundsOf(req.coords);
    if (b) m.fitBounds(b, { padding: FIT, maxZoom: 16, duration: duration(600) });
  });

  $effect(() => {
    if (map) map.getCanvas().style.cursor = route.planMode ? 'crosshair' : '';
  });

  // profile cursor: a marker at the scrubbed point; the map pans only after the finger rests for 400 ms
  let cursorMarker: Marker | null = null;
  $effect(() => {
    const m = map;
    const p = ui.profileCursor;
    if (!m) return;
    if (!p) {
      cursorMarker?.remove();
      return;
    }
    if (!cursorMarker) {
      const el = document.createElement('div');
      el.className = 'profile-cursor';
      el.dataset.testid = 'profile-cursor';
      cursorMarker = new Marker({ element: el });
    }
    cursorMarker.setLngLat(p).addTo(m);
    const t = setTimeout(() => {
      const pt = m.project(p);
      const c = m.getContainer();
      const inside = pt.x > 20 && pt.x < c.clientWidth - 20 && pt.y > 100 && pt.y < c.clientHeight - bottomPadding - 20;
      if (!inside) m.easeTo({ center: p, duration: duration(300) });
    }, 400);
    return () => clearTimeout(t);
  });

  // --- route point markers A, B, C… (DOM markers: few, and they need drag) ----------------------------------
  interface PointMarker {
    marker: Marker;
    el: HTMLDivElement;
    dot: HTMLSpanElement;
  }
  const markers: PointMarker[] = [];
  const stop = (e: Event) => e.stopPropagation();

  function createMarker(m: MlMap): PointMarker {
    const el = document.createElement('div');
    el.className = 'route-marker';
    el.setAttribute('role', 'button');
    el.tabIndex = -1;
    const dot = document.createElement('span');
    dot.className = 'dot';
    el.append(dot);
    // the map must not pan, zoom or add a point because of a press on a marker
    for (const t of ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mouseup', 'dblclick', 'click', 'wheel']) el.addEventListener(t, stop);
    const marker = new Marker({ element: el, draggable: false });
    const pm = { marker, el, dot };
    attachDrag(m, pm);
    return pm;
  }

  function attachDrag(m: MlMap, { marker, el }: PointMarker) {
    let st: { id: number; touch: boolean; x0: number; y0: number; gx: number; gy: number; dragging: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null;
    const index = () => Number(el.dataset.index);
    const startDrag = () => {
      if (!st || st.dragging) return;
      st.dragging = true;
      el.classList.add('dragging');
      if (st.touch) el.classList.add('lifted');
    };
    el.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.button > 0) return;
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const touch = e.pointerType !== 'mouse';
      const rect = m.getContainer().getBoundingClientRect();
      const anchor = m.project(marker.getLngLat());
      st = {
        id: e.pointerId,
        touch,
        x0: e.clientX,
        y0: e.clientY,
        // mouse: keep where the marker was grabbed; touch: the point is under the finger, the marker lifts above it
        gx: touch ? 0 : e.clientX - rect.left - anchor.x,
        gy: touch ? 0 : e.clientY - rect.top - anchor.y,
        dragging: false,
        timer: touch ? setTimeout(startDrag, 150) : null,
      };
    });
    el.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id) return;
      e.stopPropagation();
      if (!st.dragging && Math.hypot(e.clientX - st.x0, e.clientY - st.y0) > (st.touch ? 6 : 3)) startDrag();
      if (!st.dragging) return;
      const rect = m.getContainer().getBoundingClientRect();
      marker.setLngLat(m.unproject([e.clientX - rect.left - st.gx, e.clientY - rect.top - st.gy]));
    });
    const finish = (e: PointerEvent, cancelled: boolean) => {
      if (!st || e.pointerId !== st.id) return;
      e.stopPropagation();
      const s = st;
      st = null;
      if (s.timer) clearTimeout(s.timer);
      el.classList.remove('dragging', 'lifted');
      const i = index();
      if (s.dragging) {
        if (cancelled) {
          const p = route.points[i];
          if (p) marker.setLngLat(p);
        } else {
          const ll = marker.getLngLat();
          route.movePoint(i, [ll.lng, ll.lat]);
        }
      } else if (!cancelled) {
        if (e.pointerType === 'mouse') route.removePoint(i);
        else onmarkertap?.(i);
      }
    };
    el.addEventListener('pointerup', (e) => finish(e, false));
    el.addEventListener('pointercancel', (e) => finish(e, true));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') route.removePoint(index());
    });
  }

  $effect(() => {
    const m = map;
    if (!m) return;
    const points = route.points;
    const n = points.length;
    while (markers.length > n) markers.pop()!.marker.remove();
    points.forEach((p, i) => {
      const isNew = !markers[i];
      if (isNew) markers[i] = createMarker(m);
      const { marker, el, dot } = markers[i];
      const role = pointRole(i, n);
      const name = route.nameOf(p);
      // classList, not className: MapLibre's own marker classes must stay
      for (const r of ['start', 'stop', 'end']) el.classList.toggle(r, r === role);
      el.classList.toggle('new', isNew);
      el.dataset.index = String(i);
      el.dataset.testid = `marker-${pointLetter(i)}`;
      el.title = `${ROLE_LABEL[role]}: drag to move, click to remove`;
      el.setAttribute('aria-label', `Point ${pointLetter(i)}, ${ROLE_LABEL[role].toLowerCase()}${name ? `, ${name}` : ''}. Drag to move.`);
      dot.textContent = pointLetter(i);
      marker.setLngLat(p);
      if (isNew) marker.addTo(m);
    });
  });
  onMount(() => () => {
    markers.splice(0).forEach((pm) => pm.marker.remove());
    cursorMarker?.remove();
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
    touch-action: none;
  }
  .map :global(.route-marker.dragging) {
    cursor: grabbing;
    z-index: 2;
  }
  .map :global(.route-marker .dot) {
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
    transition: transform var(--dur-press) var(--spring-press), box-shadow var(--dur-fast);
  }
  .map :global(.route-marker.new .dot) {
    animation: marker-in var(--dur-press) var(--spring-press);
  }
  .map :global(.route-marker.start .dot) {
    background: var(--point-start);
  }
  .map :global(.route-marker.stop .dot) {
    background: var(--point-stop);
  }
  .map :global(.route-marker.end .dot) {
    background: var(--point-end);
  }
  /* touch drag: the marker lifts 26 px above the finger; a stem and a ground shadow show the real point */
  .map :global(.route-marker.lifted .dot) {
    transform: translateY(-26px) scale(1.2);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.35);
  }
  .map :global(.route-marker.lifted::before) {
    content: '';
    position: absolute;
    left: 21px;
    top: 4px;
    width: 2px;
    height: 18px;
    background: #fff;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
  }
  .map :global(.route-marker.lifted::after) {
    content: '';
    position: absolute;
    left: 16px;
    top: 19px;
    width: 12px;
    height: 6px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.35);
  }
  .map :global(.profile-cursor) {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    border: 3px solid #1d2329;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
  @keyframes marker-in {
    from {
      transform: scale(0.6);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .map :global(.route-marker .dot) {
      transition: none;
      animation: none;
    }
    .map :global(.route-marker.lifted .dot) {
      transform: translateY(-26px);
    }
  }
</style>
