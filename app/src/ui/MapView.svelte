<script lang="ts">
  // Full-screen MapLibre map. Style built in the browser; tiles through pmtiles:// in both builds; online base maps
  // only in online mode. Route line + highlight + arrows + distance markers, route point markers (drag with finger
  // or mouse), the profile cursor, explore mode (tap → info card, hover highlight, search pin), the "Show" filter,
  // run colours, ski areas, 3D terrain, "show this on the map" requests, and the map view saved with the state.
  import { onMount, untrack } from 'svelte';
  import { Map as MlMap, Marker, ScaleControl, setWorkerUrl, type MapMouseEvent, type StyleSpecification } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import type { DataSource, ResortEntry } from '../lib/data/types.ts';
  import type { RouteState } from '../lib/stores/route.svelte.ts';
  import { pointLetter, pointRole, ROLE_LABEL } from '../lib/stores/route.svelte.ts';
  import type { UiState } from '../lib/stores/ui.svelte.ts';
  import type { ExploreState, PickedFeature } from '../lib/stores/explore.svelte.ts';
  import type { DisplayData, MapView as SavedView } from '../lib/stores/planner-persist.ts';
  import type { SkiAreas } from '@core/ski-areas.ts';
  import { buildOverlayStyle } from '@core/styles/index.ts';
  import { buildMapStyle } from '../lib/map/style.ts';
  import { useDataSource } from '../lib/map/protocols.ts';
  import {
    addRouteLayers,
    handleArrowImages,
    pickFeature,
    setRouteDisplay,
    setRouteHighlight,
    setRouteSteps,
    useArrowImages,
  } from '../lib/map/route-layers.ts';
  import { addExploreLayers, setHoverHighlight, setInfoHighlight, setSearchHighlight, wholeGeometry } from '../lib/map/explore-layers.ts';
  import { addSkiAreaLayers, emphasizeSkiArea, setSkiAreaData, showSkiAreas } from '../lib/map/ski-area-layers.ts';
  import { addSlopeLayer, applyLayerFilter } from '../lib/map/layer-filter.ts';
  import { isOnlineUrl, labelFont, styleFor, type BasemapId, type StyleDeps } from '../lib/map/basemaps.ts';
  import { applyTerrain } from '../lib/map/terrain.ts';
  import { allInside, boundsOf, coverZoom } from '../lib/map/camera.ts';
  import type { MapApi, Padding } from '../lib/map/types.ts';
  import type { LocationState } from '../lib/stores/location.svelte.ts';
  import { addLocationLayers, setLocation } from '../lib/map/location-layers.ts';
  import { bearingTarget } from '../lib/location/heading.ts';
  import type { EaseToOptions } from 'maplibre-gl';


  let {
    ds,
    resort,
    route,
    ui,
    display,
    explore,
    myLocation,
    basemap = 'local',
    online = false,
    skiAreas = null,
    padding = { top: 0, right: 0, bottom: 0, left: 0 },
    hoverEnabled = false,
    initialView = null,
    onview,
    onmarkertap,
    onmaptap,
    onfeature,
    onemptytap,
    onfallback,
    onterrainmissing,
    onready,
  }: {
    ds: DataSource;
    resort: ResortEntry;
    route: RouteState;
    ui: UiState;
    display: DisplayData;
    explore: ExploreState;
    /** my location (blue dot, follow modes) */
    myLocation: LocationState;
    /** the base map to show (already gated by online mode) */
    basemap?: BasemapId;
    online?: boolean;
    skiAreas?: SkiAreas | null;
    /** the parts of the map covered by sheets / the desktop panel */
    padding?: Padding;
    /** mouse hover highlights runs and lifts (devices with hover only) */
    hoverEnabled?: boolean;
    initialView?: SavedView | null;
    onview?: (v: SavedView) => void;
    /** touch: a tap on a marker opens it in the Route sheet (spec §2.24); a mouse click removes the point */
    onmarkertap?: (index: number) => void;
    /** called first on every map tap; return true when the tap was used (e.g. large sheet → medium) */
    onmaptap?: () => boolean;
    /** explore mode: a run, lift, station or place was tapped */
    onfeature?: (f: PickedFeature, at: [number, number]) => void;
    /** explore mode: a tap on empty map */
    onemptytap?: () => void;
    /** an online map could not load: show the message and use the offline map */
    onfallback?: (message: string) => void;
    /** 3D was switched on but there is no elevation data */
    onterrainmissing?: () => void;
    onready?: (api: MapApi) => void;
  } = $props();

  // the bundled MapLibre cannot find its worker file by itself
  setWorkerUrl(workerUrl);

  let container: HTMLDivElement;
  let map = $state.raw<MlMap | null>(null);
  let styleReady = $state(false);
  /** bumps after every style load (first style and every base map switch): the effects below run again */
  let styleVersion = $state(0);
  let idle = $state(false);
  /** base map of the current style */
  let shown = $state<BasemapId>('local');
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = (ms: number) => (reduceMotion ? 0 : ms);
  const styleCache: StyleDeps['cache'] = {};

  function styleDeps(): StyleDeps {
    return {
      local: () => buildMapStyle(ds, resort) as never,
      overlay: () => buildOverlayStyle({ bounds: resort.bbox, urls: { tiles: { ski: 'pmtiles://ski' }, glyphs: ds.glyphsUrl() } }),
      hasLocalTerrain: ds.info.tiles.includes('terrain'),
      cache: styleCache,
    };
  }

  /** Is this map error about an online source (no internet)? Those are handled by falling back, not logged. */
  function onlineError(m: MlMap, e: { sourceId?: string; error?: { url?: string; message?: string } }): boolean {
    const url = e.error?.url ?? e.error?.message ?? '';
    if (isOnlineUrl(url)) return true;
    if (!e.sourceId) return false;
    const src = m.getStyle()?.sources?.[e.sourceId] as { url?: string; tiles?: string[] } | undefined;
    const where = src?.url ?? src?.tiles?.[0] ?? '';
    return /^https?:/.test(where) && !where.startsWith(location.origin);
  }

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
    handleArrowImages(m);
    // scale bar (old planner); shown on the desktop layout only (CSS below)
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');
    m.on('style.load', () => {
      const font = labelFont(shown);
      useArrowImages(m);
      addExploreLayers(m);
      addRouteLayers(m, font);
      addSkiAreaLayers(m, font);
      addSlopeLayer(m);
      // my location on top of everything (spec §2.25)
      addLocationLayers(m);
      styleReady = true;
      styleVersion++;
    });
    m.on('idle', () => (idle = true));
    m.on('movestart', () => (idle = false));
    m.on('moveend', () => {
      const c = m.getCenter();
      onview?.({ resort: resort.id, center: [c.lng, c.lat], zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() });
    });
    const turned = () => {
      ui.bearing = m.getBearing();
      ui.pitch = m.getPitch();
    };
    // moving the map by hand stops following (as Apple Maps); turning it by hand stops turning with the compass.
    // Only gestures have an originalEvent; the app's own camera moves do not.
    m.on('dragstart', (e) => {
      if (e.originalEvent) myLocation.userPanned();
    });
    m.on('rotatestart', (e) => {
      if (e.originalEvent) myLocation.userRotated();
    });
    m.on('rotate', turned);
    m.on('pitch', turned);
    turned();
    m.on('click', (e) => {
      if (onmaptap?.()) return;
      if (route.tap([e.lngLat.lng, e.lngLat.lat])) return;
      const f = pickFeature(m, e.point);
      if (f) {
        onfeature?.(
          { source: f.source, sourceLayer: f.sourceLayer, layerId: f.layer.id, properties: { ...f.properties }, geometry: wholeGeometry(m, f) },
          [e.lngLat.lng, e.lngLat.lat],
        );
      } else onemptytap?.();
    });
    // mouse hover (devices with hover only): highlight what a click would open
    let hoverKey: string | null = null;
    let frame = 0;
    const onMove = (e: MapMouseEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!hoverEnabled || route.planMode) {
          if (hoverKey !== null) {
            hoverKey = null;
            explore.hover = null;
            m.getCanvas().style.cursor = route.planMode ? 'crosshair' : '';
          }
          return;
        }
        const f = pickFeature(m, e.point);
        const key = f ? `${f.source}:${f.properties.id ?? f.properties.name}:${f.layer.id}` : null;
        m.getCanvas().style.cursor = f ? 'pointer' : '';
        if (key === hoverKey) return;
        hoverKey = key;
        explore.hover = f ? wholeGeometry(m, f) : null;
      });
    };
    m.on('mousemove', onMove);
    m.on('mouseout', () => {
      hoverKey = null;
      explore.hover = null;
    });
    let fellBack = false;
    m.on('error', (e) => {
      if (onlineError(m, e as never)) {
        // no internet for an online map: use the offline map (once per style)
        if (!fellBack && shown !== 'local') {
          fellBack = true;
          onfallback?.('No internet. Using the offline map.');
        }
        return;
      }
      console.error('[map]', e.error?.message ?? e);
    });
    m.on('style.load', () => (fellBack = false));
    // test hook for the Playwright tests (?e2e): lets them convert coordinates to screen points
    if (new URLSearchParams(location.search).has('e2e')) (window as Window & { __map?: MlMap }).__map = m;
    map = m;
    onready?.({
      zoomIn: () => m.zoomIn({ duration: duration(300) }),
      zoomOut: () => m.zoomOut({ duration: duration(300) }),
      resetNorth: () => turnNorth(m),
    });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      m.remove();
      map = null;
    };
  });

  // --- base map ------------------------------------------------------------------------------------------------
  let styleSeq = 0;
  $effect(() => {
    const m = map;
    const want = basemap;
    if (!m || want === shown) return;
    const seq = ++styleSeq;
    void styleFor(want, styleDeps()).then((choice) => {
      if (seq !== styleSeq || !map) return;
      if (choice.warning) onfallback?.(choice.warning);
      shown = want;
      if (choice.used !== want) return; // the app switches back to the offline map
      styleReady = false;
      m.setStyle(choice.style as unknown as StyleSpecification, { diff: false });
    });
  });

  $effect(() => {
    void styleVersion;
    if (map && styleReady) setRouteSteps(map, route.result?.steps ?? null, route.result?.coordinates ?? null);
  });
  $effect(() => {
    void styleVersion;
    if (map && styleReady) setRouteHighlight(map, ui.highlight);
  });
  $effect(() => {
    void styleVersion;
    if (map && styleReady) setRouteDisplay(map, { showArrows: display.showArrows, showDistances: display.showDistances });
  });
  $effect(() => {
    void styleVersion;
    if (map && styleReady) applyLayerFilter(map, { layers: { ...display.layers }, colorBy: display.colorBy });
  });
  $effect(() => {
    void styleVersion;
    if (!map || !styleReady) return;
    showSkiAreas(map, display.showSkiAreas);
    setSkiAreaData(map, display.showSkiAreas ? skiAreas : null);
  });
  $effect(() => {
    void styleVersion;
    if (map && styleReady) emphasizeSkiArea(map, explore.skiArea);
  });
  $effect(() => {
    void styleVersion;
    if (map && styleReady) setInfoHighlight(map, explore.highlight);
  });
  $effect(() => {
    void styleVersion;
    if (map && styleReady) setHoverHighlight(map, explore.hover);
  });
  $effect(() => {
    void styleVersion;
    if (map && styleReady) setSearchHighlight(map, explore.pin?.lines);
  });

  // --- my location --------------------------------------------------------------------------------------------
  $effect(() => {
    void styleVersion;
    const m = map;
    if (!m || !styleReady) return;
    const f = myLocation.fix;
    const heading = myLocation.heading;
    setLocation(
      m,
      f
        ? {
            lon: f.lon,
            lat: f.lat,
            accuracy: f.accuracy,
            stale: myLocation.stale,
            heading,
            narrow: (myLocation.headingAccuracy ?? 99) < 15,
          }
        : null,
    );
  });

  // centre once (Locate tap, first fix) and follow: every new fix moves the map; "follow with heading" also turns
  // it so the heading points up (along the shortest turn, no spin at north). A mode change alone does not move the
  // camera: that would stop a running animation (e.g. the turn to north after a compass tap).
  let centreSeen = untrack(() => myLocation.centreSeq);
  let fixSeen: unknown = null;
  let headingSeen: number | null = null;
  /** a "turn north" animation runs until then; follow moves keep bearing 0 instead of stopping it */
  let northUntil = 0;
  $effect(() => {
    const m = map;
    const f = myLocation.fix;
    const mode = myLocation.mode;
    const seq = myLocation.centreSeq;
    const h = mode === 'heading' ? myLocation.heading : null;
    if (!m || !f) return;
    const explicit = seq !== centreSeen;
    const newFix = f !== fixSeen;
    const newHeading = h !== null && h !== headingSeen;
    centreSeen = seq;
    fixSeen = f;
    headingSeen = h;
    const following = mode === 'follow' || mode === 'heading';
    if (!explicit && !(following && (newFix || newHeading))) return;
    const opts: EaseToOptions = { center: [f.lon, f.lat], duration: duration(explicit ? 700 : 400) };
    if (explicit && m.getZoom() < 15) opts.zoom = 15;
    if (h !== null) {
      opts.bearing = bearingTarget(m.getBearing(), h);
      if (!explicit) opts.duration = duration(250);
    } else if (performance.now() < northUntil) opts.bearing = 0;
    m.easeTo(opts);
  });

  function turnNorth(m: MlMap): void {
    northUntil = performance.now() + 700;
    m.easeTo({ bearing: 0, pitch: display.terrain3d ? m.getPitch() : 0, duration: duration(500) });
  }

  let northSeen = untrack(() => myLocation.northSeq);
  $effect(() => {
    const seq = myLocation.northSeq;
    const m = map;
    if (!m || seq === northSeen) return;
    northSeen = seq;
    turnNorth(m);
  });

  // 3D terrain; switching it on tilts the map, switching it off flattens it again
  let terrainWas: boolean | null = null;
  $effect(() => {
    void styleVersion;
    const m = map;
    const on = display.terrain3d;
    if (!m || !styleReady) return;
    if (!applyTerrain(m, on, online)) {
      onterrainmissing?.();
      return;
    }
    if (terrainWas !== null && terrainWas !== on) {
      if (on && m.getPitch() < 30) m.easeTo({ pitch: 60, duration: duration(800) });
      else if (!on && m.getPitch() > 0) m.easeTo({ pitch: 0, duration: duration(600) });
    }
    terrainWas = on;
  });

  // must run before the fits below: setPadding jumps the camera and would stop a running fitBounds. Only when the
  // padding really changed: a settled sheet reports the same values again, and a needless setPadding would also stop
  // a running camera animation (e.g. the tilt after switching 3D on).
  $effect(() => {
    const m = map;
    if (!m) return;
    const p = { top: padding.top, right: padding.right, left: padding.left, bottom: padding.bottom };
    const now = m.getPadding();
    if (now.top !== p.top || now.right !== p.right || now.bottom !== p.bottom || now.left !== p.left) m.setPadding(p);
  });

  // room for the controls (top row, mode pill) and for the Plan and Locate buttons that ride on the sheet
  const FIT = { top: 140, bottom: 80, left: 40, right: 40 };

  function hidden(m: MlMap, b: [[number, number], [number, number]]): boolean {
    const corners = [b[0], b[1], [b[0][0], b[1][1]] as [number, number], [b[1][0], b[0][1]] as [number, number]].map((c) => m.project(c));
    const c = m.getContainer();
    return !allInside(corners, {
      left: padding.left + FIT.left,
      top: FIT.top,
      right: c.clientWidth - padding.right - FIT.right,
      bottom: c.clientHeight - padding.bottom - FIT.bottom,
    });
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

  // "show this part on the map" (leg zoom, step tap, opened saved route, info card, search pin)
  $effect(() => {
    const m = map;
    const req = ui.fitRequest;
    if (!m || !req) return;
    const b = boundsOf(req.coords);
    if (!b) return;
    if (req.onlyIfHidden && !hidden(m, b)) return;
    const single = b[0][0] === b[1][0] && b[0][1] === b[1][1];
    const maxZoom = req.keepZoom ? m.getZoom() : (req.maxZoom ?? 16);
    if (single) m.easeTo({ center: b[0], zoom: Math.min(Math.max(m.getZoom(), Math.min(15, maxZoom)), maxZoom), duration: duration(600) });
    else m.fitBounds(b, { padding: FIT, maxZoom, duration: duration(600) });
  });

  $effect(() => {
    if (map) map.getCanvas().style.cursor = route.planMode ? 'crosshair' : '';
  });

  // search pin: orange pin at the picked search result (spec §2.24; orange like the old planner, see decisions)
  let pinMarker: Marker | null = null;
  $effect(() => {
    const m = map;
    const pin = explore.pin;
    pinMarker?.remove();
    pinMarker = null;
    if (!m || !pin) return;
    const el = document.createElement('div');
    el.className = 'search-pin';
    el.dataset.testid = 'search-pin';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<svg viewBox="0 0 32 40" width="32" height="40"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 26.6 16 39 16 39s15-12.4 15-23.2C31 7.6 24.3 1 16 1z" fill="var(--orange)" stroke="#fff" stroke-width="2"/><circle cx="16" cy="15.5" r="5.5" fill="#fff"/></svg>';
    pinMarker = new Marker({ element: el, anchor: 'bottom' }).setLngLat([pin.lon, pin.lat]).addTo(m);
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
      const inside = pt.x > padding.left + 20 && pt.x < c.clientWidth - padding.right - 20 && pt.y > 100 && pt.y < c.clientHeight - padding.bottom - 20;
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
    pinMarker?.remove();
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
  .map :global(.maplibregl-ctrl-bottom-right .maplibregl-ctrl-scale) {
    margin: 0 76px 26px 0;
    font: 10px var(--font);
  }
  @media (max-width: 899px) {
    .map :global(.maplibregl-ctrl-scale) {
      display: none;
    }
  }
  .map :global(.search-pin) {
    width: 32px;
    height: 40px;
    pointer-events: none;
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.3));
  }
  /* animate the child: MapLibre positions the marker element itself with transform */
  .map :global(.search-pin svg) {
    display: block;
    animation: pin-in var(--dur-press) var(--spring-press);
  }
  @keyframes pin-in {
    from {
      transform: translateY(-14px);
      opacity: 0;
    }
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
    .map :global(.search-pin svg) {
      animation: none;
    }
  }
</style>
