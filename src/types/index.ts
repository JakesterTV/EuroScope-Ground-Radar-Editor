// ─── Coordinate Types ────────────────────────────────────────────────────────

export type CoordFormat = 'dms' | 'decimal';

export interface ParsedCoord {
  lat: number;
  lon: number;
  rawLat: string;
  rawLon: string;
  format: CoordFormat;
}

// ─── Geometry Element Types ──────────────────────────────────────────────────

export interface LineElement {
  kind: 'line';
  id: string;
  p1: ParsedCoord;
  p2: ParsedCoord;
  /** Display name derived from the // comment immediately above this element in the source. */
  elementName?: string;
  /** 1-based line number in the source file where this element starts */
  sourceLine?: number;
}

export type DrawType = 'POLYGON' | 'POLYLINE' | 'REGION' | 'REGION_FILLONLY' | 'NONE';

export interface PolygonElement {
  kind: 'polygon';
  id: string;
  /** Area type from COORDTYPE directive: OTHER, APW, RWYCLOSED, TWYCLOSED, AREATYPE, TWYTYPE */
  areaType: string;
  /** Draw type from COORDTYPE directive */
  coordType: DrawType;
  /** Any trailing COORDTYPE parameters (HatchType, FillType) preserved verbatim */
  coordTypeExtra?: string;
  coords: ParsedCoord[];
  /** Display name derived from the // comment immediately above this element in the source. */
  elementName?: string;
  sourceLine?: number;
}

export interface CircleElement {
  kind: 'circle';
  id: string;
  /** Area type from COORDTYPE directive: OTHER, APW, RWYCLOSED, TWYCLOSED, AREATYPE, TWYTYPE */
  areaType: string;
  /** Draw type from COORDTYPE directive */
  coordType: DrawType;
  /** Any trailing COORDTYPE parameters (HatchType, FillType) preserved verbatim */
  coordTypeExtra?: string;
  center: ParsedCoord;
  /** Radius in nautical miles */
  radius: number;
  points: number;
  /** Display name derived from the // comment immediately above this element in the source. */
  elementName?: string;
  sourceLine?: number;
}

export interface SymbolElement {
  kind: 'symbol';
  id: string;
  symbolType: string;
  coord: ParsedCoord;
  label: string;
  /** Horizontal pixel offset for the label (was: size) */
  offsetX: number;
  /** Vertical pixel offset for the label (was: rotation) */
  offsetY: number;
  /** Display name derived from the // comment immediately above this element in the source. */
  elementName?: string;
  sourceLine?: number;
}

export interface TextElement {
  kind: 'text';
  id: string;
  coord: ParsedCoord;
  text: string;
  /** Display name derived from the // comment immediately above this element in the source. */
  elementName?: string;
  sourceLine?: number;
}

/**
 * A sequence of connected LINE segments treated as a single editable path.
 * lines[i].p2 coordinates match lines[i+1].p1.
 * When exported, each line is written as a separate LINE: directive.
 */
export interface PathElement {
  kind: 'path';
  id: string;
  lines: LineElement[];
  /** Display name derived from the // comment immediately above this element in the source. */
  elementName?: string;
  sourceLine?: number;
}

export type GeoElement =
  | LineElement
  | PolygonElement
  | CircleElement
  | SymbolElement
  | TextElement
  | PathElement;

// ─── Section Item (all content inside a MAP: block) ─────────────────────────

export type SectionItem =
  | GeoElement
  | { kind: 'comment'; text: string }
  | { kind: 'empty' }
  | { kind: 'color'; value: string }
  | { kind: 'raw'; line: string };

// ─── ACTIVE line types ────────────────────────────────────────────────────────

/** A parsed ACTIVE: directive on a map section. */
export type ActiveLine =
  | { kind: 'always' }
  | {
      kind: 'schedule';
      /** First day (MMDD recurring | YYMMDD one-off) */
      startDate: string;
      /** Last day (same format as startDate) */
      endDate: string;
      /**
       * "0" = continuous range (no weekday filter).
       * Otherwise a string of weekday digits: 1=Mon…7=Sun, e.g. "135"
       */
      weekdays: string;
      /** Start time UTC, HHMM */
      startTime: string;
      /** End time UTC, HHMM */
      endTime: string;
    }
  | { kind: 'runway';   raw: string }
  | { kind: 'id';       raw: string }
  | { kind: 'callsign'; raw: string }
  | { kind: 'lvp';      raw: string }
  | { kind: 'map';      raw: string }
  | { kind: 'stand';    raw: string }
  | { kind: 'unknown';  raw: string };

/** Serialise an ActiveLine back to the text after "ACTIVE:" */
export function activeLineToRaw(al: ActiveLine): string {
  switch (al.kind) {
    case 'always':   return '1';
    case 'schedule': return `${al.startDate}:${al.endDate}:${al.weekdays}:${al.startTime}:${al.endTime}`;
    default:         return al.raw;
  }
}

/** Parse the text after "ACTIVE:" into a typed ActiveLine. */
export function parseActiveLine(raw: string): ActiveLine {
  if (raw === '1') return { kind: 'always' };
  if (raw.startsWith('RWY:'))      return { kind: 'runway',   raw };
  if (raw.startsWith('ID:'))       return { kind: 'id',       raw };
  if (raw.startsWith('CALLSIGN:')) return { kind: 'callsign', raw };
  if (raw.startsWith('LVP:'))      return { kind: 'lvp',      raw };
  if (raw.startsWith('MAP:'))      return { kind: 'map',      raw };
  if (raw.startsWith('STAND:'))    return { kind: 'stand',    raw };
  // Schedule: SchedStartDate:SchedEndDate:SchedWeekdays:StartTime:EndTime
  const parts = raw.split(':');
  if (
    parts.length === 5 &&
    /^\d{4,6}$/.test(parts[0]) &&
    /^\d{4,6}$/.test(parts[1]) &&
    /^\d+$/.test(parts[2]) &&
    /^\d{4}$/.test(parts[3]) &&
    /^\d{4}$/.test(parts[4])
  ) {
    return {
      kind: 'schedule',
      startDate: parts[0],
      endDate:   parts[1],
      weekdays:  parts[2],
      startTime: parts[3],
      endTime:   parts[4],
    };
  }
  return { kind: 'unknown', raw };
}

// ─── Map Section ─────────────────────────────────────────────────────────────

export interface MapSection {
  id: string;
  name: string;
  qualifier?: string;
  folder?: string;
  airport?: string;
  /** All ACTIVE: directives belonging to this section, in file order. */
  activeLines: ActiveLine[];
  style?: string;
  fontSize?: string;
  textAlign?: string;
  items: SectionItem[];
  visible: boolean;
}

// ─── Top-level File Structure ─────────────────────────────────────────────────

export interface ColorDef {
  name: string;
  r: number;
  g: number;
  b: number;
}

export interface SymbolDef {
  name: string;
  commands: string[];
}

export interface ParsedFile {
  /** All lines before the first MAP: directive, preserved verbatim for export */
  headerLines: string[];
  colorDefs: ColorDef[];
  symbolDefs: SymbolDef[];
  maps: MapSection[];
}

// ─── Editor State ─────────────────────────────────────────────────────────────

export type EditMode = 'select' | 'draw-line' | 'draw-polygon' | 'delete' | 'draw-text';
