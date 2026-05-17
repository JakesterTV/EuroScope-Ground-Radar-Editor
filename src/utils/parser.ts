import type {
  ParsedFile,
  MapSection,
  SectionItem,
  ColorDef,
  SymbolDef,
  LineElement,
  PolygonElement,
  CircleElement,
  SymbolElement,
  TextElement,
  PathElement,
  GeoElement,
} from '../types';
import { parseCoordPair, looksLikeCoord } from './coordinates';
import { parseActiveLine } from '../types';

// ─── Internal counter for unique element IDs within a parse ──────────────────
let _idCtr = 0;
function nextId(): string {
  return `el-${++_idCtr}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isGeoElement(item: SectionItem): item is GeoElement {
  return (
    item.kind === 'line' ||
    item.kind === 'polygon' ||
    item.kind === 'circle' ||
    item.kind === 'symbol' ||
    item.kind === 'text' ||
    item.kind === 'path'
  );
}

// ─── Path merging ─────────────────────────────────────────────────────────────

/** Tolerance for endpoint matching (≈ 0.01 mm at the equator). */
const CHAIN_EPS = 1e-9;

function coordsConnect(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return Math.abs(a.lat - b.lat) < CHAIN_EPS && Math.abs(a.lon - b.lon) < CHAIN_EPS;
}

/**
 * Scan a section's item list and merge runs of consecutive LINE elements whose
 * endpoints chain together into PathElement objects.
 * A run is a maximal sequence of adjacent LineElement items (no non-line items
 * in between). Within that run, lines are chained greedily; disconnected
 * sub-sequences start a new chain.
 * Single-element chains remain as LineElement.
 */
function mergePaths(items: SectionItem[]): SectionItem[] {
  const result: SectionItem[] = [];
  let i = 0;

  while (i < items.length) {
    const item = items[i];

    if (item.kind !== 'line') {
      result.push(item);
      i++;
      continue;
    }

    // Collect the maximal run of consecutive LINE items
    const run: LineElement[] = [item as LineElement];
    while (i + 1 < items.length && items[i + 1].kind === 'line') {
      i++;
      run.push(items[i] as LineElement);
    }
    i++;

    if (run.length === 1) {
      result.push(run[0]);
      continue;
    }

    // Greedily split run into connected chains
    let chain: LineElement[] = [run[0]];
    for (let j = 1; j < run.length; j++) {
      if (coordsConnect(chain[chain.length - 1].p2, run[j].p1)) {
        chain.push(run[j]);
      } else {
        if (chain.length >= 2) {
          result.push({ kind: 'path', id: nextId(), lines: chain, elementName: chain[0].elementName, sourceLine: chain[0].sourceLine } as PathElement);
        } else {
          result.push(...chain);
        }
        chain = [run[j]];
      }
    }
    // Flush final chain
    if (chain.length >= 2) {
      result.push({ kind: 'path', id: nextId(), lines: chain, elementName: chain[0].elementName, sourceLine: chain[0].sourceLine } as PathElement);
    } else {
      result.push(...chain);
    }
  }

  return result;
}

// ─── Main parser ─────────────────────────────────────────────────────────────

/**
 * Parse the full text content of a GRpluginMaps-style file into a structured
 * ParsedFile object.  Every line is either parsed into a typed element or
 * preserved verbatim so that a round-trip export produces an identical file.
 */
export function parseFile(content: string): ParsedFile {
  _idCtr = 0;

  const lines = content.split('\n');

  const headerLines: string[] = [];
  const colorDefs: ColorDef[] = [];
  const symbolDefs: SymbolDef[] = [];
  const maps: MapSection[] = [];

  let inHeader = true;
  let currentSection: MapSection | null = null;
  let currentSymbolDef: SymbolDef | null = null;
  let currentCoordBlock: PolygonElement | null = null;
  let currentCoordType: string = 'POLYGON';
  let currentAreaType: string = 'OTHER';
  /** The text of the most recent // comment, consumed as elementName when the next geo element is created. */
  let pendingName: string | null = null;

  // Flush the active COORDTYPE block into the section's item list.
  function flushCoordBlock(): void {
    if (currentCoordBlock && currentSection && currentCoordBlock.coords.length > 0) {
      currentSection.items.push(currentCoordBlock);
    }
    currentCoordBlock = null;
  }

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li].trimEnd(); // preserve leading spaces
    const trimmed = raw.trim();

    // ── MAP: directive marks the end of the header ───────────────────────────
    if (trimmed.startsWith('MAP:')) {
      if (inHeader) inHeader = false;
      flushCoordBlock();
      currentSymbolDef = null;
      pendingName = null; // reset name context at section boundary

      // Parse MAP name and optional qualifier
      const mapStr = trimmed.slice('MAP:'.length);
      // Qualifier is a single letter after the last colon, e.g. MAP:Name:A
      const lastColon = mapStr.lastIndexOf(':');
      let name: string;
      let qualifier: string | undefined;
      if (lastColon !== -1 && /^[AGT2]+$/.test(mapStr.slice(lastColon + 1))) {
        name = mapStr.slice(0, lastColon);
        qualifier = mapStr.slice(lastColon + 1);
      } else {
        name = mapStr;
      }

      currentSection = {
        id: `map-${maps.length}`,
        name,
        qualifier,
        activeLines: [],
        items: [],
        visible: true,
      };
      maps.push(currentSection);
      continue;
    }

    // ── Header section (before first MAP:) ───────────────────────────────────
    if (inHeader) {
      headerLines.push(raw);

      if (trimmed.startsWith('COLORDEF:')) {
        const parts = trimmed.slice('COLORDEF:'.length).split(':');
        if (parts.length >= 4) {
          colorDefs.push({
            name: parts[0],
            r: parseInt(parts[1], 10),
            g: parseInt(parts[2], 10),
            b: parseInt(parts[3], 10),
          });
        }
        currentSymbolDef = null;
        continue;
      }

      if (trimmed.startsWith('SYMBOLDEF:')) {
        currentSymbolDef = {
          name: trimmed.slice('SYMBOLDEF:'.length),
          commands: [],
        };
        symbolDefs.push(currentSymbolDef);
        continue;
      }

      // SYMBOLDEF body lines
      if (currentSymbolDef && trimmed.length > 0) {
        currentSymbolDef.commands.push(trimmed);
      }

      continue; // all header lines are stored in headerLines already
    }

    // ── Inside a MAP section ─────────────────────────────────────────────────
    if (!currentSection) continue;

    // Section-level header properties
    if (trimmed.startsWith('FOLDER:')) {
      currentSection.folder = trimmed.slice('FOLDER:'.length);
      continue;
    }
    if (trimmed.startsWith('AIRPORT:')) {
      currentSection.airport = trimmed.slice('AIRPORT:'.length);
      continue;
    }
    if (trimmed.startsWith('ACTIVE:')) {
      currentSection.activeLines.push(parseActiveLine(trimmed.slice('ACTIVE:'.length)));
      continue;
    }
    if (trimmed.startsWith('STYLE:')) {
      currentSection.style = trimmed.slice('STYLE:'.length);
      continue;
    }
    if (trimmed.startsWith('FONTSIZE:')) {
      currentSection.fontSize = trimmed.slice('FONTSIZE:'.length);
      continue;
    }
    if (trimmed.startsWith('TEXTALIGN:')) {
      currentSection.textAlign = trimmed.slice('TEXTALIGN:'.length);
      continue;
    }

    // COLOR change
    if (trimmed.startsWith('COLOR:') && !trimmed.startsWith('COLORDEF:')) {
      flushCoordBlock();
      currentSection.items.push({ kind: 'color', value: trimmed.slice('COLOR:'.length) });
      continue;
    }

    // Comment
    if (trimmed.startsWith('//')) {
      // Do NOT flush on comment – comments can appear between COORDTYPE and COORD lines
      // However, a new logical block comment does end the previous block in practice.
      // Looking at the data: comments appear BETWEEN blocks, so flush is correct.
      flushCoordBlock();
      currentSection.items.push({ kind: 'comment', text: trimmed });
      // Store as pending name for the next geo element
      pendingName = trimmed.replace(/^\/\/\s*/, '').trim() || null;
      continue;
    }

    // Empty line
    if (trimmed === '') {
      currentSection.items.push({ kind: 'empty' });
      continue;
    }

    // COORDTYPE – starts a new geometry block
    if (trimmed.startsWith('COORDTYPE:')) {
      flushCoordBlock();
      const parts = trimmed.split(':');
      currentAreaType = parts[1] ?? 'OTHER';
      currentCoordType = parts[2] ?? 'POLYGON';
      const extraParts = parts.slice(3);
      currentCoordBlock = {
        kind: 'polygon',
        id: nextId(),
        areaType: currentAreaType,
        coordType: currentCoordType as import('../types').DrawType,
        coordTypeExtra: extraParts.length > 0 ? extraParts.join(':') : undefined,
        coords: [],
        elementName: pendingName ?? undefined,
        sourceLine: li + 1,
      };
      // pendingName stays set — subsequent blocks with no comment inherit this name
      continue;
    }

    // COORD – append to current block
    if (trimmed.startsWith('COORD:')) {
      if (currentCoordBlock) {
        const rest = trimmed.slice('COORD:'.length);
        const parts = rest.split(':');
        if (parts.length >= 2) {
          currentCoordBlock.coords.push(parseCoordPair(parts[0], parts[1]));
        }
      } else {
        currentSection.items.push({ kind: 'raw', line: trimmed });
      }
      continue;
    }

    // COORD_CIRCLE – terminates any open COORDTYPE block and inserts a circle
    if (trimmed.startsWith('COORD_CIRCLE:')) {
      const savedAreaType = currentCoordBlock ? currentCoordBlock.areaType : currentAreaType;
      const savedCoordType = currentCoordBlock ? currentCoordBlock.coordType : currentCoordType;
      const savedExtra = currentCoordBlock ? currentCoordBlock.coordTypeExtra : undefined;
      // Discard the open (empty) coord block created by the preceding COORDTYPE line
      currentCoordBlock = null;

      const rest = trimmed.slice('COORD_CIRCLE:'.length);
      const parts = rest.split(':');
      if (parts.length >= 4) {
        const center = parseCoordPair(parts[0], parts[1]);
        const radius = parseFloat(parts[2]);
        const points = parseInt(parts[3], 10);
        const circleEl: CircleElement = {
          kind: 'circle',
          id: nextId(),
          areaType: savedAreaType,
          coordType: savedCoordType as import('../types').DrawType,
          coordTypeExtra: savedExtra,
          center,
          radius,
          points,
          elementName: pendingName ?? undefined,
          sourceLine: li + 1,
        };
        currentSection.items.push(circleEl);
        // pendingName stays set — subsequent elements with no comment inherit this name
      }
      continue;
    }

    // LINE – two points (decimal or DMS)
    if (trimmed.startsWith('LINE:')) {
      flushCoordBlock();
      const rest = trimmed.slice('LINE:'.length);
      const parts = rest.split(':');
      // Must have 4 parts and the first part must look like a coordinate
      if (parts.length >= 4 && looksLikeCoord(parts[0])) {
        const p1 = parseCoordPair(parts[0], parts[1]);
        const p2 = parseCoordPair(parts[2], parts[3]);
        const lineEl: LineElement = {
          kind: 'line',
          id: nextId(),
          p1,
          p2,
          elementName: pendingName ?? undefined,
          sourceLine: li + 1,
        };
        currentSection.items.push(lineEl);
        // pendingName stays set — subsequent elements with no comment inherit this name
      } else {
        // Named-fix LINE (e.g. LINE:AGAVA:WR642) – preserve verbatim
        currentSection.items.push({ kind: 'raw', line: trimmed });
      }
      continue;
    }

    // SYMBOL
    if (trimmed.startsWith('SYMBOL:')) {
      flushCoordBlock();
      const rest = trimmed.slice('SYMBOL:'.length);
      const parts = rest.split(':');
      // parts[0]=type, parts[1]=lat, parts[2]=lon, parts[3]=label, parts[4]=size, parts[5]=rotation
      if (parts.length >= 3 && looksLikeCoord(parts[1])) {
        const coord = parseCoordPair(parts[1], parts[2]);
        const symbolEl: SymbolElement = {
          kind: 'symbol',
          id: nextId(),
          symbolType: parts[0],
          coord,
          label: parts[3] ?? '',
          offsetX: parts[4] ? parseInt(parts[4], 10) : 0,
          offsetY: parts[5] ? parseInt(parts[5], 10) : 0,
          elementName: pendingName ?? undefined,
          sourceLine: li + 1,
        };
        currentSection.items.push(symbolEl);
        // pendingName stays set — subsequent elements with no comment inherit this name
      } else {
        // Named-fix SYMBOL – preserve verbatim
        currentSection.items.push({ kind: 'raw', line: trimmed });
      }
      continue;
    }

    // TEXT
    if (trimmed.startsWith('TEXT:')) {
      flushCoordBlock();
      const rest = trimmed.slice('TEXT:'.length);
      const parts = rest.split(':');
      if (parts.length >= 3 && looksLikeCoord(parts[0])) {
        const coord = parseCoordPair(parts[0], parts[1]);
        const textEl: TextElement = {
          kind: 'text',
          id: nextId(),
          coord,
          text: parts.slice(2).join(':'),
          elementName: pendingName ?? undefined,
          sourceLine: li + 1,
        };
        currentSection.items.push(textEl);
        // pendingName stays set — subsequent elements with no comment inherit this name
      } else {
        currentSection.items.push({ kind: 'raw', line: trimmed });
      }
      continue;
    }

    // Anything else – preserve verbatim
    currentSection.items.push({ kind: 'raw', line: trimmed });
  }

  // Flush any unclosed coord block at EOF
  flushCoordBlock();

  // Post-process: chain consecutive connected LINE elements into PathElements
  for (const section of maps) {
    section.items = mergePaths(section.items);
  }

  return { headerLines, colorDefs, symbolDefs, maps };
}

// ─── Helpers used by other modules ───────────────────────────────────────────

/**
 * Iterate over all geo elements in a section, yielding each element together
 * with the color name that was active when the element was defined.
 */
export function* iterSectionElements(
  section: MapSection
): Generator<{ element: GeoElement; colorName: string }> {
  let colorName = '';
  for (const item of section.items) {
    if (item.kind === 'color') {
      colorName = item.value;
    } else if (isGeoElement(item)) {
      yield { element: item, colorName };
    }
  }
}
