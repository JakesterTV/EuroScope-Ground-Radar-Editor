import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  MapContainer,
  TileLayer,
  LayersControl,
  Polygon,
  Polyline,
  Circle,
  CircleMarker,
  Marker,
  Tooltip,
  useMapEvents,
  useMap,
} from 'react-leaflet';
import type { LatLngBoundsExpression, LatLngTuple } from 'leaflet';
import L from 'leaflet';
import { useStore } from '../store/useStore';
import { isGeoElement } from '../utils/parser';
import { PDFOverlayFeature } from './PDFOverlay';
import { colorDefToHex } from '../utils/coordinates';
import type {
  ColorDef,
  GeoElement,
  LineElement,
  PolygonElement,
  CircleElement,
  SymbolElement,
  TextElement,
  PathElement,
  MapSection,
  SectionItem,
  EditMode,
} from '../types';

// ─── Leaflet icon factory ─────────────────────────────────────────────────────

const vertexIcon = L.divIcon({
  className: 'vertex-handle',
  html: '<div class="vertex-dot"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

const midpointIcon = L.divIcon({
  className: 'vertex-handle',
  html: '<div class="midpoint-dot"></div>',
  iconSize: [8, 8],
  iconAnchor: [4, 4],
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveColor(name: string, colorDefs: ColorDef[]): string {
  const def = colorDefs.find(c => c.name === name);
  if (!def) return '#8888aa';
  return colorDefToHex(def.r, def.g, def.b);
}

/** Pre-compute element-id → hex color for a section in O(n). */
function buildColorMap(section: MapSection, colorDefs: ColorDef[]): Map<string, string> {
  const map = new Map<string, string>();
  let current = '#8888aa';
  for (const item of section.items) {
    if (item.kind === 'color') {
      current = resolveColor(item.value, colorDefs);
    } else if (isGeoElement(item)) {
      map.set((item as GeoElement).id, current);
    }
  }
  return map;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ElementRendererProps {
  element: GeoElement;
  color: string;
  isSelected: boolean;
  editMode: EditMode;
  onSelect: () => void;
  onDelete: () => void;
}

function ElementRenderer({
  element,
  color,
  isSelected,
  editMode,
  onSelect,
  onDelete,
}: ElementRendererProps) {
  const handleClick = () => {
    if (editMode === 'delete') {
      onDelete();
    } else {
      onSelect();
    }
  };

  const weight = isSelected ? 3 : 1.5;
  const strokeColor = isSelected ? '#facc15' : color;

  if (element.kind === 'polygon') {
    const positions = element.coords.map(
      c => [c.lat, c.lon] as LatLngTuple
    );
    return (
      <Polygon
        positions={positions}
        pathOptions={{
          color: strokeColor,
          fillColor: color,
          fillOpacity: 0.35,
          weight,
        }}
        eventHandlers={{ click: handleClick }}
      />
    );
  }

  if (element.kind === 'line') {
    return (
      <Polyline
        positions={[
          [element.p1.lat, element.p1.lon],
          [element.p2.lat, element.p2.lon],
        ]}
        pathOptions={{ color: strokeColor, weight, opacity: 0.9 }}
        eventHandlers={{ click: handleClick }}
      />
    );
  }

  if (element.kind === 'path') {
    const positions = [
      [element.lines[0].p1.lat, element.lines[0].p1.lon] as LatLngTuple,
      ...element.lines.map(l => [l.p2.lat, l.p2.lon] as LatLngTuple),
    ];
    return (
      <Polyline
        positions={positions}
        pathOptions={{ color: strokeColor, weight, opacity: 0.9 }}
        eventHandlers={{ click: handleClick }}
      />
    );
  }

  if (element.kind === 'circle') {
    const radiusM = element.radius * 1852; // NM → metres
    return (
      <Circle
        center={[element.center.lat, element.center.lon]}
        radius={radiusM}
        pathOptions={{
          color: strokeColor,
          fillColor: color,
          fillOpacity: 0.2,
          weight,
        }}
        eventHandlers={{ click: handleClick }}
      />
    );
  }

  if (element.kind === 'symbol') {
    return (
      <CircleMarker
        center={[element.coord.lat, element.coord.lon]}
        radius={5}
        pathOptions={{
          color: strokeColor,
          fillColor: color,
          fillOpacity: 0.9,
          weight: 1.5,
        }}
        eventHandlers={{ click: handleClick }}
      >
        {element.label && (
          <Tooltip direction="right" offset={[6, 0]}>
            {element.label}
          </Tooltip>
        )}
      </CircleMarker>
    );
  }

  if (element.kind === 'text') {
    // When selected, TextEditOverlay handles rendering
    if (isSelected) return null;
    return (
      <CircleMarker
        center={[element.coord.lat, element.coord.lon]}
        radius={3}
        pathOptions={{
          color: '#d4af37',
          fillColor: '#d4af37',
          fillOpacity: 1,
          weight: 1,
        }}
        eventHandlers={{ click: handleClick }}
      >
        <Tooltip permanent direction="right" offset={[5, 0]}>
          {element.text}
        </Tooltip>
      </CircleMarker>
    );
  }

  return null;
}
// ─── Snap utility ─────────────────────────────────────────────────────────

/**
 * Find the nearest snap point within `thresholdPx` pixels.
 * Checks both discrete vertices AND the closest point on every line segment,
 * so you can snap to any point along a line or polygon edge.
 */
function findSnap(
  lat: number,
  lon: number,
  map: L.Map,
  parsedFile: { maps: MapSection[] } | null,
  extraPoints: LatLngTuple[] = [],
  excludeElementId?: string,
  thresholdPx = 14,
): { lat: number; lon: number } | null {
  if (!parsedFile) return null;
  const pt = map.latLngToContainerPoint([lat, lon]);
  let bestDist = thresholdPx;
  let best: { lat: number; lon: number } | null = null;

  /** Check a single discrete coordinate. */
  const checkPt = (c: { lat: number; lon: number }) => {
    const cpt = map.latLngToContainerPoint([c.lat, c.lon]);
    const d = Math.hypot(pt.x - cpt.x, pt.y - cpt.y);
    if (d < bestDist) { bestDist = d; best = { lat: c.lat, lon: c.lon }; }
  };

  /** Check both endpoints AND the perpendicular foot on segment A→B. */
  const checkSeg = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    checkPt(a);
    checkPt(b);
    // Closest point on segment in pixel space
    const aPx = map.latLngToContainerPoint([a.lat, a.lon]);
    const bPx = map.latLngToContainerPoint([b.lat, b.lon]);
    const dx = bPx.x - aPx.x, dy = bPx.y - aPx.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return;
    const t = Math.max(0, Math.min(1, ((pt.x - aPx.x) * dx + (pt.y - aPx.y) * dy) / lenSq));
    const footPx = L.point(aPx.x + t * dx, aPx.y + t * dy);
    const d = Math.hypot(pt.x - footPx.x, pt.y - footPx.y);
    if (d < bestDist) {
      bestDist = d;
      const ll = map.containerPointToLatLng(footPx);
      best = { lat: ll.lat, lon: ll.lng };
    }
  };

  for (const section of parsedFile.maps) {
    for (const item of section.items) {
      if (!isGeoElement(item)) continue;
      const el = item as GeoElement;
      if (el.id === excludeElementId) continue;
      if (el.kind === 'polygon') {
        for (let i = 0; i < el.coords.length; i++)
          checkSeg(el.coords[i], el.coords[(i + 1) % el.coords.length]);
      } else if (el.kind === 'line') {
        checkSeg(el.p1, el.p2);
      } else if (el.kind === 'path') {
        el.lines.forEach(l => checkSeg(l.p1, l.p2));
      } else if (el.kind === 'circle') {
        checkPt(el.center);
      } else if (el.kind === 'symbol') {
        checkPt(el.coord);
      } else if (el.kind === 'text') {
        checkPt(el.coord);
      }
    }
  }
  for (const [elat, elon] of extraPoints) checkPt({ lat: elat, lon: elon });

  return best;
}

/** Dashed ring shown at the active snap target. */
function SnapIndicator({ coord }: { coord: [number, number] }) {
  return (
    <CircleMarker
      center={coord}
      radius={9}
      pathOptions={{
        color: '#60a5fa',
        fillColor: 'transparent',
        weight: 2,
        dashArray: '5 4',
        opacity: 0.9,
      }}
    />
  );
}
// ─── Vertex editing overlay ───────────────────────────────────────────────────

interface EditingOverlayProps {
  mapId: string;
  elementId: string;
}

function EditingOverlay({ mapId, elementId }: EditingOverlayProps) {
  const map = useMap();
  const parsedFile = useStore(s => s.parsedFile);
  const updatePolygonVertex = useStore(s => s.updatePolygonVertex);
  const insertPolygonVertex = useStore(s => s.insertPolygonVertex);
  const deletePolygonVertex = useStore(s => s.deletePolygonVertex);
  const updateLineEndpoint = useStore(s => s.updateLineEndpoint);
  const updatePathVertex = useStore(s => s.updatePathVertex);
  const insertPathVertex = useStore(s => s.insertPathVertex);
  const deletePathVertex = useStore(s => s.deletePathVertex);

  const [snapTarget, setSnapTarget] = useState<[number, number] | null>(null);
  // Tracks the last coord committed by setLatLng during a drag so dragend
  // can use it instead of e.target.getLatLng() (which reflects Leaflet's
  // unsynced internal drag state after a forced setLatLng call).
  const lastDragCoordRef = useRef<[number, number] | null>(null);

  const trySnap = useCallback((lat: number, lon: number) => {
    const s = findSnap(lat, lon, map, parsedFile, [], elementId);
    setSnapTarget(s ? [s.lat, s.lon] : null);
    return s ? ([s.lat, s.lon] as [number, number]) : ([lat, lon] as [number, number]);
  }, [map, parsedFile, elementId]);

  if (!parsedFile) return null;

  const section = parsedFile.maps.find(m => m.id === mapId);
  if (!section) return null;
  const item = section.items.find(
    i => isGeoElement(i) && (i as GeoElement).id === elementId
  ) as GeoElement | undefined;
  if (!item) return null;

  if (item.kind === 'polygon') {
    return (
      <>
        {snapTarget && <SnapIndicator coord={snapTarget} />}
        {/* Midpoint handles for inserting a vertex */}
        {item.coords.map((coord, i) => {
          const next = item.coords[(i + 1) % item.coords.length];
          const midLat = (coord.lat + next.lat) / 2;
          const midLon = (coord.lon + next.lon) / 2;
          return (
            <Marker
              key={`mid-${i}`}
              position={[midLat, midLon]}
              icon={midpointIcon}
              eventHandlers={{
                click: () => insertPolygonVertex(mapId, elementId, i, midLat, midLon),
              }}
            />
          );
        })}
        {/* Vertex handles */}
        {item.coords.map((coord, i) => (
          <Marker
            key={`v-${i}`}
            position={[coord.lat, coord.lon]}
            draggable
            icon={vertexIcon}
            eventHandlers={{
              drag(e) {
                const { lat, lng } = (e.target as L.Marker).getLatLng();
                const snapped = trySnap(lat, lng);
                lastDragCoordRef.current = snapped;
                (e.target as L.Marker).setLatLng(snapped);
              },
              dragend() {
                const coord = lastDragCoordRef.current;
                lastDragCoordRef.current = null;
                setSnapTarget(null);
                if (coord) updatePolygonVertex(mapId, elementId, i, coord[0], coord[1]);
              },
              contextmenu() {
                deletePolygonVertex(mapId, elementId, i);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              {`${coord.lat.toFixed(6)}, ${coord.lon.toFixed(6)}`}
              <br />
              Right-click to delete
            </Tooltip>
          </Marker>
        ))}
      </>
    );
  }

  if (item.kind === 'line') {
    return (
      <>
        {snapTarget && <SnapIndicator coord={snapTarget} />}
        {(['p1', 'p2'] as const).map(which => (
          <Marker
            key={which}
            position={[item[which].lat, item[which].lon]}
            draggable
            icon={vertexIcon}
            eventHandlers={{
              drag(e) {
                const { lat, lng } = (e.target as L.Marker).getLatLng();
                const snapped = trySnap(lat, lng);
                lastDragCoordRef.current = snapped;
                (e.target as L.Marker).setLatLng(snapped);
              },
              dragend() {
                const coord = lastDragCoordRef.current;
                lastDragCoordRef.current = null;
                setSnapTarget(null);
                if (coord) updateLineEndpoint(mapId, elementId, which, coord[0], coord[1]);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              {`${item[which].lat.toFixed(6)}, ${item[which].lon.toFixed(6)}`}
            </Tooltip>
          </Marker>
        ))}
      </>
    );
  }

  if (item.kind === 'path') {
    // Build the vertex list: lines[0].p1, then each line.p2
    const verts = [
      item.lines[0].p1,
      ...item.lines.map((l: LineElement) => l.p2),
    ];
    const N = item.lines.length; // number of segments
    return (
      <>
        {snapTarget && <SnapIndicator coord={snapTarget} />}
        {/* Midpoint handles — one per segment */}
        {item.lines.map((seg: LineElement, si: number) => {
          const midLat = (seg.p1.lat + seg.p2.lat) / 2;
          const midLon = (seg.p1.lon + seg.p2.lon) / 2;
          return (
            <Marker
              key={`mid-${si}`}
              position={[midLat, midLon]}
              icon={midpointIcon}
              eventHandlers={{
                click: () => insertPathVertex(mapId, elementId, si, midLat, midLon),
              }}
            />
          );
        })}
        {/* Vertex handles */}
        {verts.map((coord, vi) => (
          <Marker
            key={`v-${vi}`}
            position={[coord.lat, coord.lon]}
            draggable
            icon={vertexIcon}
            eventHandlers={{
              drag(e) {
                const { lat, lng } = (e.target as L.Marker).getLatLng();
                const snapped = trySnap(lat, lng);
                lastDragCoordRef.current = snapped;
                (e.target as L.Marker).setLatLng(snapped);
              },
              dragend() {
                const coord = lastDragCoordRef.current;
                lastDragCoordRef.current = null;
                setSnapTarget(null);
                if (coord) updatePathVertex(mapId, elementId, vi, coord[0], coord[1]);
              },
              contextmenu() {
                if (N > 1) deletePathVertex(mapId, elementId, vi);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              {`${coord.lat.toFixed(6)}, ${coord.lon.toFixed(6)}`}
              {N > 1 && <><br />Right-click to delete</>}
            </Tooltip>
          </Marker>
        ))}
      </>
    );
  }

  return null;
}

// ─── Name prompt overlay (for new lines / polygons) ────────────────────────────────

/** Floating overlay to assign a name to a just-drawn line or polygon. */
function NamePromptOverlay({
  coord,
  onConfirm,
  onSkip,
}: {
  coord: [number, number];
  onConfirm: (name: string) => void;
  onSkip: () => void;
}) {
  const map = useMap();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [pt, setPt] = useState(() => map.latLngToContainerPoint(coord));

  // Stop native DOM events from bubbling into Leaflet's click handler.
  // React's e.stopPropagation() only stops the synthetic event; L.DomEvent
  // disableClickPropagation adds native listeners that intercept the real event.
  const stopRef = useCallback((el: HTMLDivElement | null) => {
    if (el) L.DomEvent.disableClickPropagation(el);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    const update = () => setPt(map.latLngToContainerPoint(coord));
    map.on('move zoom moveend zoomend', update);
    return () => { map.off('move zoom moveend zoomend', update); };
  }, [map, coord]);

  return createPortal(
    <div
      ref={stopRef}
      style={{ position: 'absolute', left: pt.x + 12, top: pt.y - 16, zIndex: 1001 }}
      className="flex items-center gap-1 bg-slate-900 border border-amber-500 rounded px-2 py-1 shadow-xl"
    >
      <span className="text-amber-400 text-xs flex-shrink-0">Name:</span>
      <input
        ref={inputRef}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter') onConfirm(name.trim());
          if (e.key === 'Escape') onSkip();
        }}
        placeholder="(optional)…"
        className="bg-transparent text-slate-200 text-xs outline-none w-36"
      />
      <button
        onClick={e => { e.stopPropagation(); onConfirm(name.trim()); }}
        className="text-amber-400 text-xs px-0.5 hover:text-amber-300"
      >✓</button>
      <button
        onClick={e => { e.stopPropagation(); onSkip(); }}
        className="text-slate-500 text-xs px-0.5 hover:text-slate-300"
      >✕</button>
    </div>,
    map.getContainer()
  );
}

// ─── Text placement overlay ──────────────────────────────────────────────────────

/** Floating input shown at a clicked map coordinate for placing a new text label. */
function TextPlaceOverlay({
  coord,
  onConfirm,
  onCancel,
}: {
  coord: [number, number];
  onConfirm: (text: string) => void;
  onCancel: () => void;
}) {
  const map = useMap();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [pt, setPt] = useState(() => map.latLngToContainerPoint(coord));

  useEffect(() => {
    inputRef.current?.focus();
    const update = () => setPt(map.latLngToContainerPoint(coord));
    map.on('move zoom moveend zoomend', update);
    return () => { map.off('move zoom moveend zoomend', update); };
  }, [map, coord]);

  return createPortal(
    <div
      style={{ position: 'absolute', left: pt.x + 12, top: pt.y - 16, zIndex: 1000 }}
      className="flex items-center gap-1 bg-slate-900 border border-blue-500 rounded px-2 py-1 shadow-xl"
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
      <input
        ref={inputRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter' && text.trim()) onConfirm(text.trim());
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Label text…"
        className="bg-transparent text-slate-200 text-xs outline-none w-36"
      />
      <button
        onClick={e => { e.stopPropagation(); if (text.trim()) onConfirm(text.trim()); }}
        className="text-blue-400 text-xs px-0.5 hover:text-blue-300"
      >✓</button>
      <button
        onClick={e => { e.stopPropagation(); onCancel(); }}
        className="text-slate-500 text-xs px-0.5 hover:text-slate-300"
      >✕</button>
    </div>,
    map.getContainer()
  );
}

// ─── Text edit overlay (selected text element) ───────────────────────────────────────

const textHandleIcon = L.divIcon({
  className: '',
  html: '<div style="width:10px;height:10px;border-radius:50%;background:#d4af37;border:2px solid #fff;cursor:grab;box-shadow:0 0 0 3px rgba(212,175,55,0.35)"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

/** Draggable marker + inline text editor for an already-placed text element. */
function TextEditOverlay({ mapId, elementId }: { mapId: string; elementId: string }) {
  const map = useMap();
  const parsedFile = useStore(s => s.parsedFile);
  const updateTextElement = useStore(s => s.updateTextElement);

  const [snapTarget, setSnapTarget] = useState<[number, number] | null>(null);
  const [dragCoord, setDragCoord] = useState<[number, number]>([0, 0]);
  const [localText, setLocalText] = useState('');
  const [pt, setPt] = useState<L.Point>(() => map.latLngToContainerPoint([0, 0]));
  const lastDragCoordRef = useRef<[number, number] | null>(null);

  const trySnap = useCallback((lat: number, lon: number) => {
    const s = findSnap(lat, lon, map, parsedFile, [], elementId);
    setSnapTarget(s ? [s.lat, s.lon] : null);
    return s ? ([s.lat, s.lon] as [number, number]) : ([lat, lon] as [number, number]);
  }, [map, parsedFile, elementId]);

  const section = parsedFile?.maps.find(m => m.id === mapId);
  const el = section?.items.find(i => (i as GeoElement).id === elementId) as TextElement | undefined;

  // Sync position and text when element ID changes
  useEffect(() => {
    if (!el || el.kind !== 'text') return;
    setDragCoord([el.coord.lat, el.coord.lon]);
    setLocalText(el.text);
  }, [elementId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep screen position in sync with map pan/zoom and drag
  useEffect(() => {
    const update = () => setPt(map.latLngToContainerPoint(dragCoord));
    update();
    map.on('move zoom moveend zoomend', update);
    return () => { map.off('move zoom moveend zoomend', update); };
  }, [map, dragCoord]);

  if (!el || el.kind !== 'text') return null;

  const commit = (text: string, lat: number, lon: number) => {
    if (text.trim()) updateTextElement(mapId, elementId, text.trim(), lat, lon);
  };

  return (
    <>
      {snapTarget && <SnapIndicator coord={snapTarget} />}
      <Marker
        position={dragCoord}
        draggable
        icon={textHandleIcon}
        eventHandlers={{
          drag(e) {
            const { lat, lng } = (e.target as L.Marker).getLatLng();
            const snapped = trySnap(lat, lng);
            lastDragCoordRef.current = snapped;
            (e.target as L.Marker).setLatLng(snapped);
            setDragCoord(snapped);
          },
          dragend() {
            const coord = lastDragCoordRef.current;
            lastDragCoordRef.current = null;
            setSnapTarget(null);
            if (coord) commit(localText, coord[0], coord[1]);
          },
        }}
      />
      {createPortal(
        <div
          style={{ position: 'absolute', left: pt.x + 12, top: pt.y - 16, zIndex: 1000 }}
          className="flex items-center gap-1 bg-slate-900 border border-amber-500/70 rounded px-2 py-1 shadow-xl"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <input
            value={localText}
            onChange={e => setLocalText(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') commit(localText, dragCoord[0], dragCoord[1]);
            }}
            onBlur={() => commit(localText, dragCoord[0], dragCoord[1])}
            autoFocus
            className="bg-transparent text-amber-200 text-xs outline-none w-36"
          />
        </div>,
        map.getContainer()
      )}
    </>
  );
}

// ─── Double-click zoom toggle ─────────────────────────────────────────────────

/** Disables Leaflet's built-in double-click zoom while a draw mode is active. */
function DoubleClickZoomToggle({ editMode }: { editMode: EditMode }) {
  const map = useMap();
  useEffect(() => {
    if (editMode === 'draw-polygon' || editMode === 'draw-line') {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }
  }, [map, editMode]);
  return null;
}

// ─── Drawing handler ──────────────────────────────────────────────────────────

// Pixel snap radius for closing a polygon by clicking near the first point.
const POLY_SNAP_CLOSE_PX = 14;

interface DrawingHandlerProps {
  editMode: EditMode;
  activeMapId: string | null;
  onPolygonVertex: (lat: number, lon: number) => void;
  onPolygonClose: (trimLast: boolean) => void;
  onLineClose: (trimLast: boolean) => void;
  onCancelDraw: () => void;
  onTextPlace: (lat: number, lon: number) => void;
  drawPoints: LatLngTuple[];
}

function DrawingHandler({
  editMode,
  onPolygonVertex,
  onPolygonClose,
  onLineClose,
  onCancelDraw,
  onTextPlace,
  drawPoints,
}: DrawingHandlerProps) {
  const parsedFile = useStore(s => s.parsedFile);
  // Track whether the cursor is hovering near the first polygon vertex (snap-close target).
  const nearCloseRef = useRef(false);
  const [nearClose, setNearClose] = useState(false);

  const map = useMapEvents({
    mousemove(e) {
      if (editMode === 'draw-polygon' && drawPoints.length >= 3) {
        const firstPx   = map.latLngToContainerPoint(drawPoints[0]);
        const cursorPx  = map.latLngToContainerPoint(e.latlng);
        const isNear    = firstPx.distanceTo(cursorPx) < POLY_SNAP_CLOSE_PX;
        if (isNear !== nearCloseRef.current) {
          nearCloseRef.current = isNear;
          setNearClose(isNear);
        }
      } else if (nearCloseRef.current) {
        nearCloseRef.current = false;
        setNearClose(false);
      }
    },
    click(e) {
      const { lat, lng } = e.latlng;

      // Click near first vertex → close polygon
      if (editMode === 'draw-polygon' && drawPoints.length >= 3) {
        const firstPx  = map.latLngToContainerPoint(drawPoints[0]);
        const clickPx  = map.latLngToContainerPoint([lat, lng]);
        if (firstPx.distanceTo(clickPx) < POLY_SNAP_CLOSE_PX) {
          nearCloseRef.current = false;
          setNearClose(false);
          onPolygonClose(false);
          return;
        }
      }

      // Snap to nearest existing vertex; also allow snapping to in-progress draw points
      const extra = drawPoints as LatLngTuple[];
      const snapped = findSnap(lat, lng, map, parsedFile, extra) ?? { lat, lon: lng };
      const sLat = snapped.lat;
      const sLon = snapped.lon;
      if (editMode === 'draw-line') {
        onPolygonVertex(sLat, sLon);
      } else if (editMode === 'draw-polygon') {
        onPolygonVertex(sLat, sLon);
      } else if (editMode === 'draw-text') {
        onTextPlace(sLat, sLon);
      }
    },
    dblclick(e) {
      if (editMode === 'draw-polygon') {
        nearCloseRef.current = false;
        setNearClose(false);
        onPolygonClose(true);
      } else if (editMode === 'draw-line') {
        onLineClose(true);
      }
      L.DomEvent.stop(e);
    },
  });

  useEffect(() => {
    if (editMode !== 'draw-polygon' && editMode !== 'draw-line') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (editMode === 'draw-polygon') onPolygonClose(false);
        else if (editMode === 'draw-line') onLineClose(false);
      } else if (e.key === 'Escape') {
        onCancelDraw();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editMode, onPolygonClose, onLineClose, onCancelDraw]);

  // Visual snap-close indicator: green ring on first vertex when cursor is near it
  if (editMode === 'draw-polygon' && drawPoints.length >= 3 && nearClose) {
    return (
      <CircleMarker
        center={drawPoints[0]}
        radius={9}
        pathOptions={{ color: '#22c55e', weight: 2.5, fillColor: '#22c55e', fillOpacity: 0.25 }}
      />
    );
  }

  return null;
}

// ─── Cursor tracker ───────────────────────────────────────────────────────────

function CursorTracker() {
  const setCursorCoords = useStore(s => s.setCursorCoords);
  useMapEvents({
    mousemove(e) {
      setCursorCoords([e.latlng.lat, e.latlng.lng]);
    },
    mouseout() {
      setCursorCoords(null);
    },
  });
  return null;
}

// ─── Pan-to handler ───────────────────────────────────────────────────────────

function PanToHandler() {
  const panToCoord = useStore(s => s.panToCoord);
  const clearPanTo = useStore(s => s.clearPanTo);
  const map = useMap();

  useEffect(() => {
    if (!panToCoord) return;
    clearPanTo();
    map.flyTo(panToCoord, Math.max(map.getZoom(), 14), { duration: 0.6 });
    // After the flight animation finishes, invalidate size to re-sync all layers.
    const onMoveEnd = () => {
      map.invalidateSize({ animate: false });
      map.off('moveend', onMoveEnd);
    };
    map.on('moveend', onMoveEnd);
    return () => { map.off('moveend', onMoveEnd); };
  }, [panToCoord, clearPanTo, map]);

  return null;
}

// ─── Auto-fit to visible data ─────────────────────────────────────────────────

function AutoFit({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  const fitted = useRef(false);
  if (bounds && !fitted.current) {
    fitted.current = true;
    // Defer so Leaflet is fully initialised
    setTimeout(() => map.fitBounds(bounds as LatLngBoundsExpression, { padding: [20, 20] }), 100);
  }
  return null;
}

// ─── Main MapView ─────────────────────────────────────────────────────────────

interface MapViewProps {
  showPdfOverlay?: boolean;
  onClosePdfOverlay?: () => void;
}

export function MapView({ showPdfOverlay, onClosePdfOverlay }: MapViewProps = {}) {
  const parsedFile = useStore(s => s.parsedFile);
  const selectedMapId = useStore(s => s.selectedMapId);
  const selectedElementId = useStore(s => s.selectedElementId);
  const editMode = useStore(s => s.editMode);
  const selectElement = useStore(s => s.selectElement);
  const deleteElement = useStore(s => s.deleteElement);
  const addPathToSection = useStore(s => s.addPathToSection);
  const addPolygonToSection = useStore(s => s.addPolygonToSection);
  const addTextToSection = useStore(s => s.addTextToSection);
  const setEditMode = useStore(s => s.setEditMode);
  const drawTextTargetMapId = useStore(s => s.drawTextTargetMapId);
  const activeDrawGroupId = useStore(s => s.activeDrawGroupId);

  // Where on the map the user clicked to place a new text label
  const [placingAt, setPlacingAt] = useState<[number, number] | null>(null);

  // Pending drawn geometry awaiting name prompt
  type PendingPath = { mapId: string; points: [number, number][]; promptAt: [number, number] };
  type PendingPoly = { mapId: string; coords: [number, number][]; promptAt: [number, number] };
  const [pendingPath, setPendingPath] = useState<PendingPath | null>(null);
  const [pendingPoly, setPendingPoly] = useState<PendingPoly | null>(null);

  // Drawing state — keep a ref in sync so close handler never has a stale closure
  const [drawPoints, setDrawPoints] = useState<LatLngTuple[]>([]);
  const drawPointsRef = useRef<LatLngTuple[]>([]);
  const addDrawPoint = useCallback((lat: number, lon: number) => {
    drawPointsRef.current = [...drawPointsRef.current, [lat, lon]];
    setDrawPoints(drawPointsRef.current);
  }, []);
  const clearDrawPoints = useCallback(() => {
    drawPointsRef.current = [];
    setDrawPoints([]);
  }, []);

  // Determine map cursor class
  const cursorClass =
    editMode === 'draw-line' || editMode === 'draw-polygon'
      ? `mode-${editMode}`
      : editMode === 'delete'
      ? 'mode-delete'
      : editMode === 'draw-text'
      ? 'mode-draw-text'
      : '';

  // Compute initial bounds from visible sections
  const bounds = useCallback((): LatLngBoundsExpression | null => {
    if (!parsedFile) return null;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    let found = false;
    for (const section of parsedFile.maps) {
      if (!section.visible) continue;
      for (const item of section.items) {
        if (!isGeoElement(item)) continue;
        const el = item as GeoElement;
        const coords: Array<{ lat: number; lon: number }> = [];
        if (el.kind === 'polygon') coords.push(...el.coords);
        else if (el.kind === 'line') coords.push(el.p1, el.p2);
        else if (el.kind === 'path') { coords.push(el.lines[0].p1); el.lines.forEach(l => coords.push(l.p2)); }
        else if (el.kind === 'circle') coords.push(el.center);
        else if (el.kind === 'symbol') coords.push(el.coord);
        else if (el.kind === 'text') coords.push(el.coord);
        for (const c of coords) {
          if (c.lat < minLat) minLat = c.lat;
          if (c.lat > maxLat) maxLat = c.lat;
          if (c.lon < minLon) minLon = c.lon;
          if (c.lon > maxLon) maxLon = c.lon;
          found = true;
        }
      }
    }
    if (!found) return null;
    return [
      [minLat, minLon],
      [maxLat, maxLon],
    ];
  }, [parsedFile])();

  // Drawing callbacks
  const handleAddPoint = useCallback(
    (lat: number, lon: number) => {
      addDrawPoint(lat, lon);
    },
    [addDrawPoint]
  );

  const handleLineClose = useCallback(
    (trimLast: boolean) => {
      const raw = drawPointsRef.current;
      const pts = trimLast && raw.length > 0 ? raw.slice(0, -1) : raw;
      if (pts.length < 2) {
        clearDrawPoints();
        setEditMode('select');
        return;
      }
      const target = activeDrawGroupId ?? parsedFile?.maps.find(m => m.visible)?.id;
      if (target) {
        const points = pts as [number, number][];
        const promptAt: [number, number] = [
          points.reduce((s, c) => s + c[0], 0) / points.length,
          points.reduce((s, c) => s + c[1], 0) / points.length,
        ];
        setPendingPath({ mapId: target, points, promptAt });
      }
      clearDrawPoints();
      setEditMode('select');
    },
    [activeDrawGroupId, parsedFile, clearDrawPoints, setEditMode]
  );

  const handleTextPlace = useCallback(
    (lat: number, lon: number) => {
      setPlacingAt([lat, lon]);
    },
    []
  );

  const handlePolygonClose = useCallback((trimLast: boolean) => {
    // On dblclick, Leaflet fires click+click+dblclick. Both clicks add a vertex
    // so the last one is a duplicate — trim it. Snap-close and Enter close
    // without adding an extra vertex, so do NOT trim in those cases.
    const raw = drawPointsRef.current;
    const pts = trimLast && raw.length > 0 ? raw.slice(0, -1) : raw;
    if (pts.length < 3) {
      clearDrawPoints();
      return;
    }
    const target = activeDrawGroupId ?? parsedFile?.maps.find(m => m.visible)?.id;
    if (target) {
      const coords = pts as [number, number][];
      const centroid: [number, number] = [
        coords.reduce((s, c) => s + c[0], 0) / coords.length,
        coords.reduce((s, c) => s + c[1], 0) / coords.length,
      ];
      setPendingPoly({ mapId: target, coords, promptAt: centroid });
    }
    clearDrawPoints();
    setEditMode('select');
  }, [activeDrawGroupId, parsedFile, clearDrawPoints, setEditMode]);

  return (
    <MapContainer
      center={[52.17, 20.97]}
      zoom={13}
      className={`w-full h-full ${cursorClass}`}
      zoomControl={true}
      preferCanvas={true}
    >
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="OpenStreetMap">
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors'
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Satellite (ESRI)">
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri"
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Dark">
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
      </LayersControl>

      <CursorTracker />
      <PanToHandler />
      <DoubleClickZoomToggle editMode={editMode} />

      {/* Auto-fit on first load */}
      {bounds && <AutoFit bounds={bounds} />}

      {/* Render all visible sections */}
      {parsedFile?.maps
        .filter(s => s.visible)
        .map(section => {
          const colorMap = buildColorMap(section, parsedFile.colorDefs);
          return section.items
            .filter(isGeoElement)
            .map(item => {
              const el = item as GeoElement;
              const color = colorMap.get(el.id) ?? '#8888aa';
              const isSelected =
                el.id === selectedElementId && section.id === selectedMapId;
              return (
                <ElementRenderer
                  key={el.id}
                  element={el}
                  color={color}
                  isSelected={isSelected}
                  editMode={editMode}
                  onSelect={() => selectElement(section.id, el.id)}
                  onDelete={() => deleteElement(section.id, el.id)}
                />
              );
            });
        })}

      {/* Text edit overlay for selected text elements */}
      {selectedElementId && selectedMapId && editMode === 'select' &&
        (parsedFile?.maps.find(m => m.id === selectedMapId)
          ?.items.find(i => (i as GeoElement).id === selectedElementId && (i as GeoElement).kind === 'text')
        ) && (
          <TextEditOverlay mapId={selectedMapId} elementId={selectedElementId} />
        )}

      {/* Text placement overlay — shown after clicking map in draw-text mode */}
      {placingAt && (
        <TextPlaceOverlay
          coord={placingAt}
          onConfirm={(text) => {
            const target = drawTextTargetMapId ?? activeDrawGroupId ?? parsedFile?.maps.find(m => m.visible)?.id;
            if (target) addTextToSection(target, placingAt[0], placingAt[1], text, text);
            setPlacingAt(null);
            setEditMode('select');
          }}
          onCancel={() => { setPlacingAt(null); setEditMode('select'); }}
        />
      )}

      {/* Name prompt for a just-drawn path/line */}
      {pendingPath && (
        <NamePromptOverlay
          coord={pendingPath.promptAt}
          onConfirm={(name) => {
            addPathToSection(pendingPath.mapId, pendingPath.points, name || undefined);
            setPendingPath(null);
          }}
          onSkip={() => {
            addPathToSection(pendingPath.mapId, pendingPath.points);
            setPendingPath(null);
          }}
        />
      )}

      {/* Name prompt for a just-drawn polygon */}
      {pendingPoly && (
        <NamePromptOverlay
          coord={pendingPoly.promptAt}
          onConfirm={(name) => {
            addPolygonToSection(pendingPoly.mapId, pendingPoly.coords, name || undefined);
            setPendingPoly(null);
          }}
          onSkip={() => {
            addPolygonToSection(pendingPoly.mapId, pendingPoly.coords);
            setPendingPoly(null);
          }}
        />
      )}

      {/* Vertex editing handles */}
      {selectedElementId && selectedMapId && editMode === 'select' && (
        <EditingOverlay mapId={selectedMapId} elementId={selectedElementId} />
      )}

      {/* In-progress polygon preview */}
      {editMode === 'draw-polygon' && drawPoints.length >= 2 && (
        <Polyline
          positions={drawPoints}
          pathOptions={{ color: '#60a5fa', weight: 2, dashArray: '6 4' }}
        />
      )}
      {/* In-progress line/path preview */}
      {editMode === 'draw-line' && drawPoints.length >= 2 && (
        <Polyline
          positions={drawPoints}
          pathOptions={{ color: '#f97316', weight: 2, dashArray: '6 4' }}
        />
      )}
      {editMode === 'draw-line' && drawPoints.length === 1 && (
        <CircleMarker
          center={drawPoints[0]}
          radius={6}
          pathOptions={{ color: '#f97316', fillColor: '#f97316', fillOpacity: 1, weight: 2 }}
        />
      )}

      {/* Map event handler for drawing / cursor */}
      <DrawingHandler
        editMode={editMode}
        activeMapId={selectedMapId}
        onPolygonVertex={handleAddPoint}
        onPolygonClose={handlePolygonClose}
        onLineClose={handleLineClose}
        onCancelDraw={useCallback(() => { clearDrawPoints(); setEditMode('select'); }, [clearDrawPoints, setEditMode])}
        onTextPlace={handleTextPlace}
        drawPoints={drawPoints}
      />

      {/* PDF overlay */}
      {showPdfOverlay && (
        <PDFOverlayFeature onClose={onClosePdfOverlay ?? (() => {})} />
      )}
    </MapContainer>
  );
}
