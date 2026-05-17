import type { ParsedFile, SectionItem, GeoElement } from '../types';
import { activeLineToRaw } from '../types';
import { coordToStrings } from './coordinates';

export interface ElementLineRange {
  /** 0-based index of the first line belonging to this element in the exported text. */
  start: number;
  /** 0-based index of the last line (inclusive). */
  end: number;
}

/**
 * Export the file to text AND build a map from element ID → line range
 * (0-based) in the exported output. Useful for the dev-mode viewer.
 */
export function exportFileWithMap(parsed: ParsedFile): {
  text: string;
  elementLineMap: Map<string, ElementLineRange>;
} {
  const out: string[] = [];
  const elementLineMap = new Map<string, ElementLineRange>();

  for (const line of parsed.headerLines) {
    out.push(line);
  }

  for (const section of parsed.maps) {
    const qualifier = section.qualifier ? `:${section.qualifier}` : '';
    out.push(`MAP:${section.name}${qualifier}`);
    if (section.airport !== undefined) out.push(`AIRPORT:${section.airport}`);
    if (section.folder  !== undefined) out.push(`FOLDER:${section.folder}`);
    for (const al of section.activeLines) out.push(`ACTIVE:${activeLineToRaw(al)}`);
    if (section.style   !== undefined) out.push(`STYLE:${section.style}`);
    if (section.fontSize  !== undefined) out.push(`FONTSIZE:${section.fontSize}`);
    if (section.textAlign !== undefined) out.push(`TEXTALIGN:${section.textAlign}`);

    for (const item of section.items) {
      if (
        item.kind === 'line'    || item.kind === 'polygon' ||
        item.kind === 'circle'  || item.kind === 'symbol'  ||
        item.kind === 'text'    || item.kind === 'path'
      ) {
        const start = out.length;
        exportItem(item, out);
        elementLineMap.set(item.id, { start, end: out.length - 1 });
      } else {
        exportItem(item, out);
      }
    }
  }

  return { text: out.join('\n'), elementLineMap };
}

function isGeoItem(item: SectionItem): item is GeoElement {
  return (
    item.kind === 'line' ||
    item.kind === 'polygon' ||
    item.kind === 'circle' ||
    item.kind === 'symbol' ||
    item.kind === 'text'
  );
}

/**
 * Reconstruct the original file text from a ParsedFile.
 * Header lines are emitted verbatim; MAP sections are rebuilt from their
 * structured item lists.
 */
export function exportFile(parsed: ParsedFile): string {
  return exportFileWithMap(parsed).text;
}

function exportItem(item: SectionItem, out: string[]): void {
  switch (item.kind) {
    case 'comment':
      out.push(item.text);
      break;

    case 'empty':
      out.push('');
      break;

    case 'color':
      out.push(`COLOR:${item.value}`);
      break;

    case 'raw':
      out.push(item.line);
      break;

    case 'line': {
      const { latStr: lat1, lonStr: lon1 } = coordToStrings(item.p1);
      const { latStr: lat2, lonStr: lon2 } = coordToStrings(item.p2);
      out.push(`LINE:${lat1}:${lon1}:${lat2}:${lon2}`);
      break;
    }

    case 'path': {
      // Expand back to individual LINE directives — format is unchanged
      for (const line of item.lines) {
        const { latStr: lat1, lonStr: lon1 } = coordToStrings(line.p1);
        const { latStr: lat2, lonStr: lon2 } = coordToStrings(line.p2);
        out.push(`LINE:${lat1}:${lon1}:${lat2}:${lon2}`);
      }
      break;
    }

    case 'polygon': {
      const extra = item.coordTypeExtra ? `:${item.coordTypeExtra}` : '';
      out.push(`COORDTYPE:${item.areaType}:${item.coordType}${extra}`);
      for (const c of item.coords) {
        const { latStr, lonStr } = coordToStrings(c);
        out.push(`COORD:${latStr}:${lonStr}`);
      }
      break;
    }

    case 'circle': {
      const extra = item.coordTypeExtra ? `:${item.coordTypeExtra}` : '';
      out.push(`COORDTYPE:${item.areaType}:${item.coordType}${extra}`);
      const { latStr, lonStr } = coordToStrings(item.center);
      out.push(`COORD_CIRCLE:${latStr}:${lonStr}:${item.radius.toFixed(2)}:${item.points}`);
      break;
    }

    case 'symbol': {
      const { latStr, lonStr } = coordToStrings(item.coord);
      out.push(
        `SYMBOL:${item.symbolType}:${latStr}:${lonStr}:${item.label}:${item.offsetX}:${item.offsetY}`
      );
      break;
    }

    case 'text': {
      const { latStr, lonStr } = coordToStrings(item.coord);
      out.push(`TEXT:${latStr}:${lonStr}:${item.text}`);
      break;
    }

    default:
      // Exhaustiveness guard – should never happen
      if (isGeoItem(item as SectionItem)) {
        // handled above
      }
      break;
  }
}
