import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { parseFile, isGeoElement } from '../utils/parser';
import { exportFile } from '../utils/exporter';
import { makeCoord } from '../utils/coordinates';
import {
  githubFetchFile,
  githubPushAsPR,
  type GitHubConfig,
} from '../utils/github';
import type {
  ParsedFile,
  MapSection,
  GeoElement,
  SectionItem,
  EditMode,
  PolygonElement,
  LineElement,
  PathElement,
  CoordFormat,
  ActiveLine,
} from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppStore {
  // ── File ────────────────────────────────────────────────────────────────────
  filePath: string | null;
  parsedFile: ParsedFile | null;
  isDirty: boolean;

  // ── Undo / redo ─────────────────────────────────────────────────────────────
  /** Serialised snapshots of parsedFile.maps (JSON strings). */
  undoStack: string[];
  redoStack: string[];

  // ── Selection ────────────────────────────────────────────────────────────────
  selectedMapId: string | null;
  selectedElementId: string | null;

  // ── Edit mode ────────────────────────────────────────────────────────────────
  editMode: EditMode;
  /** Text string to place when editMode === 'draw-text' */
  pendingTextLabel: string | null;
  /** Which map section new text labels are placed into (set when entering draw-text mode). */
  drawTextTargetMapId: string | null;
  /** The sidebar-selected group that all new objects (line/polygon/text) are drawn into. */
  activeDrawGroupId: string | null;

  // ── Map cursor ───────────────────────────────────────────────────────────────
  cursorCoords: [number, number] | null;

  // ── Pan request ───────────────────────────────────────────────────────────────
  /** When set, MapView should fly to this [lat, lon] then clear it. */
  panToCoord: [number, number] | null;

  // ── GitHub integration ───────────────────────────────────────────────────────
  /** OAuth access token from GitHub (set after OAuth flow completes). */
  githubToken: string | null;
  githubConfig: GitHubConfig | null;
  /** SHA of the file as fetched from GitHub — needed for commit */
  githubFileSha: string | null;

  // ── Actions ──────────────────────────────────────────────────────────────────
  loadFromText(text: string, path?: string): void;
  fetchFromServer(path: string): Promise<void>;
  saveToServer(): Promise<void>;

  toggleMapVisibility(mapId: string): void;
  setMapsVisibility(ids: string[], visible: boolean): void;
  selectElement(mapId: string | null, elementId: string | null): void;
  /** Select a map section for the properties panel without selecting an element. */
  selectSection(mapId: string | null): void;
  /** Update the ACTIVE: directives on a map section. */
  updateMapActiveLines(mapId: string, activeLines: ActiveLine[]): void;
  /** Request the map to pan/fly to a coordinate, then clears itself. */
  requestPanTo(coord: [number, number]): void;
  clearPanTo(): void;
  /** Enter text-placement mode with the given label string. */
  beginTextPlace(text: string): void;
  /** Enter draw-text mode targeting a specific map section. */
  enterDrawText(mapId: string): void;
  /** Set the active group for all new object placement from the sidebar. */
  setActiveDrawGroup(id: string | null): void;
  setEditMode(mode: EditMode): void;
  setCursorCoords(coords: [number, number] | null): void;

  setGithubToken(token: string | null): void;
  setGitHubConfig(cfg: GitHubConfig | null): void;
  fetchFromGitHub(cfg: GitHubConfig): Promise<void>;
  saveAsGitHubPR(opts: {
    branchName: string;
    commitMessage: string;
    prTitle: string;
    prBody: string;
  }): Promise<string>;

  // Geometry edits (each one pushes an undo snapshot first)
  updatePolygonVertex(
    mapId: string,
    elementId: string,
    vertexIndex: number,
    lat: number,
    lon: number
  ): void;
  insertPolygonVertex(
    mapId: string,
    elementId: string,
    afterIndex: number,
    lat: number,
    lon: number
  ): void;
  deletePolygonVertex(mapId: string, elementId: string, vertexIndex: number): void;
  updateLineEndpoint(
    mapId: string,
    elementId: string,
    which: 'p1' | 'p2',
    lat: number,
    lon: number
  ): void;
  deleteElement(mapId: string, elementId: string): void;
  addLineToSection(
    mapId: string,
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
    name?: string
  ): void;
  addPolygonToSection(mapId: string, coords: [number, number][], name?: string): void;
  addTextToSection(mapId: string, lat: number, lon: number, text: string, name?: string): void;
  updateTextElement(mapId: string, elementId: string, text: string, lat: number, lon: number): void;

  // Path vertex editing
  updatePathVertex(mapId: string, elementId: string, vertexIdx: number, lat: number, lon: number): void;
  insertPathVertex(mapId: string, elementId: string, segmentIdx: number, lat: number, lon: number): void;
  deletePathVertex(mapId: string, elementId: string, vertexIdx: number): void;

  undo(): void;
  redo(): void;

  getExportText(): string | null;
}

// ─── Helper utilities (module-private) ───────────────────────────────────────

const MAX_UNDO = 50;

function snapshotMaps(maps: MapSection[]): string {
  return JSON.stringify(maps);
}

function findItem(
  maps: MapSection[],
  mapId: string,
  elementId: string
): { section: MapSection; item: GeoElement; index: number } | null {
  const section = maps.find(m => m.id === mapId);
  if (!section) return null;
  const index = section.items.findIndex(
    i => isGeoElement(i) && (i as GeoElement).id === elementId
  );
  if (index === -1) return null;
  return { section, item: section.items[index] as GeoElement, index };
}

/** Determine the CoordFormat used by a polygon element (first coord wins). */
function polyFormat(el: PolygonElement): CoordFormat {
  return el.coords[0]?.format ?? 'decimal';
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useStore = create<AppStore>()(
  immer((set, get) => ({
    filePath: null,
    parsedFile: null,
    isDirty: false,
    undoStack: [],
    redoStack: [],
    selectedMapId: null,
    selectedElementId: null,
    editMode: 'select',
    pendingTextLabel: null,
    drawTextTargetMapId: null,
    activeDrawGroupId: null,
    cursorCoords: null,
    panToCoord: null,
    githubToken: null,
    githubConfig: null,
    githubFileSha: null,

    // ── Load ────────────────────────────────────────────────────────────────

    loadFromText(text, path) {
      const parsed = parseFile(text);
      set(draft => {
        draft.parsedFile = parsed as unknown as typeof draft.parsedFile;
        draft.filePath = path ?? null;
        draft.isDirty = false;
        draft.undoStack = [];
        draft.redoStack = [];
        draft.selectedMapId = null;
        draft.selectedElementId = null;
      });
    },

    async fetchFromServer(path) {
      const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      get().loadFromText(text, path);
    },

    setGithubToken(token) {
      set(draft => { draft.githubToken = token; });
    },

    setGitHubConfig(cfg) {
      set(draft => { draft.githubConfig = cfg; });
    },

    async fetchFromGitHub(cfg) {
      const { content, sha } = await githubFetchFile(cfg);
      get().loadFromText(content, `${cfg.owner}/${cfg.repo}/${cfg.filePath}`);
      set(draft => {
        draft.githubConfig = cfg;
        draft.githubFileSha = sha;
      });
    },

    async saveAsGitHubPR({ branchName, commitMessage, prTitle, prBody }) {
      const { githubConfig, githubFileSha, parsedFile } = get();
      if (!githubConfig) throw new Error('No GitHub configuration set');
      if (!githubFileSha) throw new Error('File SHA unknown — load the file from GitHub first');
      if (!parsedFile) throw new Error('No file loaded');

      const content = exportFile(parsedFile);
      const prUrl = await githubPushAsPR(githubConfig, content, githubFileSha, {
        branchName,
        commitMessage,
        prTitle,
        prBody,
      });
      set(draft => { draft.isDirty = false; });
      return prUrl;
    },

    async saveToServer() {
      const { filePath, parsedFile } = get();
      if (!filePath || !parsedFile) throw new Error('No file loaded');
      const text = exportFile(parsedFile);
      const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: text,
      });
      if (!res.ok) throw new Error(await res.text());
      set(draft => { draft.isDirty = false; });
    },

    // ── Visibility / selection ───────────────────────────────────────────────

    toggleMapVisibility(mapId) {
      set(draft => {
        if (!draft.parsedFile) return;
        const section = draft.parsedFile.maps.find(m => m.id === mapId);
        if (section) section.visible = !section.visible;
      });
    },

    setMapsVisibility(ids, visible) {
      set(draft => {
        if (!draft.parsedFile) return;
        for (const section of draft.parsedFile.maps) {
          if (ids.includes(section.id)) section.visible = visible;
        }
      });
    },

    selectElement(mapId, elementId) {
      set(draft => {
        draft.selectedMapId = mapId;
        draft.selectedElementId = elementId;
      });
    },

    selectSection(mapId) {
      set(draft => {
        draft.selectedMapId = mapId;
        draft.selectedElementId = null;
      });
    },

    updateMapActiveLines(mapId, activeLines) {
      set(draft => {
        if (!draft.parsedFile) return;
        draft.undoStack.push(snapshotMaps(draft.parsedFile.maps));
        if (draft.undoStack.length > MAX_UNDO) draft.undoStack.shift();
        draft.redoStack = [];
        const section = draft.parsedFile.maps.find(m => m.id === mapId);
        if (!section) return;
        section.activeLines = activeLines;
        draft.isDirty = true;
      });
    },

    requestPanTo(coord) {
      set(draft => { draft.panToCoord = coord; });
    },

    clearPanTo() {
      set(draft => { draft.panToCoord = null; });
    },

    beginTextPlace(text) {
      set(draft => {
        draft.pendingTextLabel = text;
        draft.editMode = 'draw-text';
      });
    },

    setActiveDrawGroup(id) {
      set(draft => { draft.activeDrawGroupId = id; });
    },

    enterDrawText(mapId) {
      set(draft => {
        draft.editMode = 'draw-text';
        draft.drawTextTargetMapId = mapId;
        draft.pendingTextLabel = null;
        draft.selectedElementId = null;
        draft.selectedMapId = null;
      });
    },

    setEditMode(mode) {
      set(draft => {
        draft.editMode = mode;
        if (mode !== 'draw-text') {
          draft.pendingTextLabel = null;
          draft.drawTextTargetMapId = null;
        }
        if (mode !== 'select') {
          // Clear selection when switching to a drawing/delete mode
          draft.selectedElementId = null;
          draft.selectedMapId = null;
        }
      });
    },

    setCursorCoords(coords) {
      set(draft => { draft.cursorCoords = coords; });
    },

    // ── History helpers ──────────────────────────────────────────────────────

    undo() {
      const { undoStack, parsedFile } = get();
      if (undoStack.length === 0 || !parsedFile) return;
      set(draft => {
        if (!draft.parsedFile) return;
        const snapshot = draft.undoStack.pop()!;
        draft.redoStack.push(snapshotMaps(draft.parsedFile.maps as unknown as MapSection[]));
        if (draft.redoStack.length > MAX_UNDO) draft.redoStack.shift();
        draft.parsedFile.maps = JSON.parse(snapshot);
        draft.isDirty = true;
        draft.selectedElementId = null;
        draft.selectedMapId = null;
      });
    },

    redo() {
      const { redoStack, parsedFile } = get();
      if (redoStack.length === 0 || !parsedFile) return;
      set(draft => {
        if (!draft.parsedFile) return;
        const snapshot = draft.redoStack.pop()!;
        draft.undoStack.push(snapshotMaps(draft.parsedFile.maps as unknown as MapSection[]));
        if (draft.undoStack.length > MAX_UNDO) draft.undoStack.shift();
        draft.parsedFile.maps = JSON.parse(snapshot);
        draft.isDirty = true;
        draft.selectedElementId = null;
        draft.selectedMapId = null;
      });
    },

    // ── Edit operations ──────────────────────────────────────────────────────

    updatePolygonVertex(mapId, elementId, vertexIndex, lat, lon) {
      set(draft => {
        if (!draft.parsedFile) return;
        const maps = draft.parsedFile.maps as unknown as MapSection[];

        // Push snapshot for undo
        draft.undoStack.push(snapshotMaps(maps));
        if (draft.undoStack.length > MAX_UNDO) draft.undoStack.shift();
        draft.redoStack = [];

        const found = findItem(maps, mapId, elementId);
        if (!found || found.item.kind !== 'polygon') return;
        const poly = found.item as PolygonElement;
        const fmt = polyFormat(poly);
        poly.coords[vertexIndex] = makeCoord(lat, lon, fmt);
        draft.isDirty = true;
      });
    },

    insertPolygonVertex(mapId, elementId, afterIndex, lat, lon) {
      set(draft => {
        if (!draft.parsedFile) return;
        const maps = draft.parsedFile.maps as unknown as MapSection[];

        draft.undoStack.push(snapshotMaps(maps));
        if (draft.undoStack.length > MAX_UNDO) draft.undoStack.shift();
        draft.redoStack = [];

        const found = findItem(maps, mapId, elementId);
        if (!found || found.item.kind !== 'polygon') return;
        const poly = found.item as PolygonElement;
        const fmt = polyFormat(poly);
        poly.coords.splice(afterIndex + 1, 0, makeCoord(lat, lon, fmt));
        draft.isDirty = true;
      });
    },

    deletePolygonVertex(mapId, elementId, vertexIndex) {
      set(draft => {
        if (!draft.parsedFile) return;
        const maps = draft.parsedFile.maps as unknown as MapSection[];

        draft.undoStack.push(snapshotMaps(maps));
        if (draft.undoStack.length > MAX_UNDO) draft.undoStack.shift();
        draft.redoStack = [];

        const found = findItem(maps, mapId, elementId);
        if (!found || found.item.kind !== 'polygon') return;
        const poly = found.item as PolygonElement;
        if (poly.coords.length <= 3) return; // never delete below 3 vertices
        poly.coords.splice(vertexIndex, 1);
        draft.isDirty = true;
      });
    },

    updateLineEndpoint(mapId, elementId, which, lat, lon) {
      set(draft => {
        if (!draft.parsedFile) return;
        const maps = draft.parsedFile.maps as unknown as MapSection[];

        draft.undoStack.push(snapshotMaps(maps));
        if (draft.undoStack.length > MAX_UNDO) draft.undoStack.shift();
        draft.redoStack = [];

        const found = findItem(maps, mapId, elementId);
        if (!found || found.item.kind !== 'line') return;
        const line = found.item as LineElement;
        const fmt = line[which].format;
        line[which] = makeCoord(lat, lon, fmt);
        draft.isDirty = true;
      });
    },

    deleteElement(mapId, elementId) {
      set(draft => {
        if (!draft.parsedFile) return;
        const maps = draft.parsedFile.maps as unknown as MapSection[];

        draft.undoStack.push(snapshotMaps(maps));
        if (draft.undoStack.length > MAX_UNDO) draft.undoStack.shift();
        draft.redoStack = [];

        const section = maps.find(m => m.id === mapId);
        if (!section) return;
        const idx = section.items.findIndex(
          i => isGeoElement(i) && (i as GeoElement).id === elementId
        );
        if (idx !== -1) section.items.splice(idx, 1);

        draft.isDirty = true;
        if (draft.selectedElementId === elementId) {
          draft.selectedElementId = null;
          draft.selectedMapId = null;
        }
      });
    },

    addLineToSection(mapId, lat1, lon1, lat2, lon2, name) {
      set(draft => {
        if (!draft.parsedFile) return;
        const maps = draft.parsedFile.maps as unknown as MapSection[];

        draft.undoStack.push(snapshotMaps(maps));
        if (draft.undoStack.length > MAX_UNDO) draft.undoStack.shift();
        draft.redoStack = [];

        const section = maps.find(m => m.id === mapId);
        if (!section) return;

        const newId = `el-new-${Date.now()}`;
        const newLine: LineElement = {
          kind: 'line',
          id: newId,
          p1: makeCoord(lat1, lon1, 'decimal'),
          p2: makeCoord(lat2, lon2, 'decimal'),
          elementName: name ?? undefined,
        };
        if (name) {
          section.items.push({ kind: 'comment', text: `// ${name}` } as unknown as SectionItem);
        }
        section.items.push(newLine as unknown as SectionItem);
        draft.isDirty = true;
      });
    },

    addPolygonToSection(mapId, coords, name) {
      set(draft => {
        if (!draft.parsedFile) return;
        const maps = draft.parsedFile.maps as unknown as MapSection[];

        draft.undoStack.push(snapshotMaps(maps));
        if (draft.undoStack.length > MAX_UNDO) draft.undoStack.shift();
        draft.redoStack = [];

        const section = maps.find(m => m.id === mapId);
        if (!section) return;

        const newId = `el-new-${Date.now()}`;
        const newPoly: PolygonElement = {
          kind: 'polygon',
          id: newId,
          areaType: 'OTHER',
          coordType: 'REGION',
          coords: coords.map(([lat, lon]) => makeCoord(lat, lon, 'decimal')),
          elementName: name ?? undefined,
        };
        if (name) {
          section.items.push({ kind: 'comment', text: `// ${name}` } as unknown as SectionItem);
        }
        section.items.push(newPoly as unknown as SectionItem);
        draft.isDirty = true;
      });
    },

    addTextToSection(mapId, lat, lon, text, name) {
      set(draft => {
        if (!draft.parsedFile) return;
        const maps = draft.parsedFile.maps as unknown as MapSection[];
        draft.undoStack.push(snapshotMaps(maps));
        if (draft.undoStack.length > MAX_UNDO) draft.undoStack.shift();
        draft.redoStack = [];
        const section = maps.find(m => m.id === mapId);
        if (!section) return;
        const newEl = {
          kind: 'text' as const,
          id: `el-new-${Date.now()}`,
          coord: makeCoord(lat, lon, 'decimal'),
          text,
          elementName: name ?? undefined,
        };
        if (name) {
          section.items.push({ kind: 'comment', text: `// ${name}` } as unknown as SectionItem);
        }
        section.items.push(newEl as unknown as SectionItem);
        draft.selectedMapId = mapId;
        draft.selectedElementId = newEl.id;
        draft.isDirty = true;
      });
    },

    updateTextElement(mapId, elementId, text, lat, lon) {
      set(draft => {
        if (!draft.parsedFile) return;
        const maps = draft.parsedFile.maps as unknown as MapSection[];
        draft.undoStack.push(snapshotMaps(maps));
        if (draft.undoStack.length > MAX_UNDO) draft.undoStack.shift();
        draft.redoStack = [];
        const found = findItem(maps, mapId, elementId);
        if (!found || found.item.kind !== 'text') return;
        found.item.text = text;
        found.item.coord = makeCoord(lat, lon, found.item.coord.format);
        draft.isDirty = true;
      });
    },

    updatePathVertex(mapId, elementId, vertexIdx, lat, lon) {
      set(draft => {
        if (!draft.parsedFile) return;
        const maps = draft.parsedFile.maps as unknown as MapSection[];
        draft.undoStack.push(snapshotMaps(maps));
        if (draft.undoStack.length > MAX_UNDO) draft.undoStack.shift();
        draft.redoStack = [];

        const found = findItem(maps, mapId, elementId);
        if (!found || found.item.kind !== 'path') return;
        const path = found.item as unknown as PathElement;
        const N = path.lines.length;
        const fmt = path.lines[0].p1.format;
        const coord = makeCoord(lat, lon, fmt);
        if (vertexIdx === 0) {
          path.lines[0].p1 = coord;
        } else if (vertexIdx === N) {
          path.lines[N - 1].p2 = coord;
        } else {
          // Interior vertex: update the end of the previous segment and the
          // start of the next to keep the chain connected.
          path.lines[vertexIdx - 1].p2 = makeCoord(lat, lon, path.lines[vertexIdx - 1].p2.format);
          path.lines[vertexIdx].p1 = makeCoord(lat, lon, path.lines[vertexIdx].p1.format);
        }
        draft.isDirty = true;
      });
    },

    insertPathVertex(mapId, elementId, segmentIdx, lat, lon) {
      set(draft => {
        if (!draft.parsedFile) return;
        const maps = draft.parsedFile.maps as unknown as MapSection[];
        draft.undoStack.push(snapshotMaps(maps));
        if (draft.undoStack.length > MAX_UNDO) draft.undoStack.shift();
        draft.redoStack = [];

        const found = findItem(maps, mapId, elementId);
        if (!found || found.item.kind !== 'path') return;
        const path = found.item as unknown as PathElement;
        const seg = path.lines[segmentIdx];
        const fmt = seg.p1.format;
        const newCoord = makeCoord(lat, lon, fmt);
        const newSeg: LineElement = {
          kind: 'line',
          id: `el-new-${Date.now()}`,
          p1: newCoord,
          p2: seg.p2,
        };
        seg.p2 = makeCoord(lat, lon, seg.p2.format);
        (path.lines as unknown as LineElement[]).splice(segmentIdx + 1, 0, newSeg);
        draft.isDirty = true;
      });
    },

    deletePathVertex(mapId, elementId, vertexIdx) {
      set(draft => {
        if (!draft.parsedFile) return;
        const maps = draft.parsedFile.maps as unknown as MapSection[];
        draft.undoStack.push(snapshotMaps(maps));
        if (draft.undoStack.length > MAX_UNDO) draft.undoStack.shift();
        draft.redoStack = [];

        const found = findItem(maps, mapId, elementId);
        if (!found || found.item.kind !== 'path') return;
        const path = found.item as unknown as PathElement;
        const N = path.lines.length;
        if (N <= 1) return; // keep minimum 1 segment
        if (vertexIdx === 0) {
          path.lines.splice(0, 1);
        } else if (vertexIdx === N) {
          path.lines.splice(N - 1, 1);
        } else {
          // Merge: connect lines[vertexIdx-1].start → lines[vertexIdx].end
          path.lines[vertexIdx - 1].p2 = path.lines[vertexIdx].p2;
          path.lines.splice(vertexIdx, 1);
        }
        draft.isDirty = true;
      });
    },

    // ── Export ───────────────────────────────────────────────────────────────

    getExportText() {
      const { parsedFile } = get();
      if (!parsedFile) return null;
      return exportFile(parsedFile);
    },
  }))
);
