import type { ParsedCoord, CoordFormat } from '../types';

/**
 * Parse a single DMS component like "N051.05.55.146" or "E016.53.51.393".
 * Format: [NSEW]DDD.MM.SS.FFF  (FFF = thousandths of a second)
 */
export function parseDMSComponent(s: string): number {
  const dir = s[0].toUpperCase() as 'N' | 'S' | 'E' | 'W';
  const rest = s.slice(1);
  const parts = rest.split('.');
  if (parts.length < 3) return 0;

  const deg = parseInt(parts[0], 10);
  const min = parseInt(parts[1], 10);
  const sec = parseInt(parts[2], 10);
  const frac = parts[3] ? parseInt(parts[3], 10) : 0;
  const totalSec = sec + frac / 1000;
  const decimal = deg + min / 60 + totalSec / 3600;

  return dir === 'S' || dir === 'W' ? -decimal : decimal;
}

/**
 * Returns true if the string looks like a DMS coordinate (N/S/E/W followed
 * immediately by digits, e.g. "N051.05.55.146"). Named fixes such as "WR754"
 * or "EPWA" start with a letter that is NOT immediately followed by a digit
 * and must NOT be mistaken for coordinates.
 */
export function isDMS(s: string): boolean {
  return /^[NSEWnsew]\d+\./.test(s);
}

/** Returns true if the string looks like any form of coordinate value. */
export function looksLikeCoord(s: string): boolean {
  return isDMS(s) || (!isNaN(parseFloat(s)) && isFinite(Number(s)));
}

/**
 * Parse a lat + lon string pair into a ParsedCoord.
 * Handles both DMS ("N051.05.55.146") and decimal ("52.17342411954806") forms.
 */
export function parseCoordPair(latStr: string, lonStr: string): ParsedCoord {
  const tl = latStr.trim();
  const tlon = lonStr.trim();
  const format: CoordFormat = isDMS(tl) ? 'dms' : 'decimal';

  const lat = format === 'dms' ? parseDMSComponent(tl) : parseFloat(tl);
  const lon = format === 'dms' ? parseDMSComponent(tlon) : parseFloat(tlon);

  return { lat, lon, rawLat: tl, rawLon: tlon, format };
}

/**
 * Convert a decimal degree value back to the DMS string format used by the file.
 * isLat: true → N/S prefix;  false → E/W prefix.
 */
export function toDMSString(decimal: number, isLat: boolean): string {
  const isNeg = decimal < 0;
  const abs = Math.abs(decimal);

  let deg = Math.floor(abs);
  let minFull = (abs - deg) * 60;
  let min = Math.floor(minFull);
  let secFull = (minFull - min) * 60;
  let sec = Math.floor(secFull);
  let frac = Math.round((secFull - sec) * 1000);

  // carry overflow
  if (frac >= 1000) { frac -= 1000; sec += 1; }
  if (sec >= 60)    { sec -= 60;   min += 1; }
  if (min >= 60)    { min -= 60;   deg += 1; }

  const dir = isLat ? (isNeg ? 'S' : 'N') : (isNeg ? 'W' : 'E');
  const dStr = deg.toString().padStart(3, '0');
  const mStr = min.toString().padStart(2, '0');
  const sStr = sec.toString().padStart(2, '0');
  const fStr = frac.toString().padStart(3, '0');

  return `${dir}${dStr}.${mStr}.${sStr}.${fStr}`;
}

/**
 * Serialise a ParsedCoord back to its file string representation.
 * If the coordinate has not changed from its raw value, the original string is
 * returned verbatim (preserving original precision / formatting).
 */
export function coordToStrings(coord: ParsedCoord): { latStr: string; lonStr: string } {
  // Check whether decimal value matches the raw representation
  const origLat =
    coord.format === 'dms' ? parseDMSComponent(coord.rawLat) : parseFloat(coord.rawLat);
  const origLon =
    coord.format === 'dms' ? parseDMSComponent(coord.rawLon) : parseFloat(coord.rawLon);

  const unchanged =
    Math.abs(origLat - coord.lat) < 1e-10 && Math.abs(origLon - coord.lon) < 1e-10;

  if (unchanged) {
    return { latStr: coord.rawLat, lonStr: coord.rawLon };
  }

  if (coord.format === 'dms') {
    return {
      latStr: toDMSString(coord.lat, true),
      lonStr: toDMSString(coord.lon, false),
    };
  }

  // Decimal: preserve up to 14 decimal places
  return {
    latStr: coord.lat.toFixed(14),
    lonStr: coord.lon.toFixed(14),
  };
}

/**
 * Build a new ParsedCoord at the given decimal position,
 * adopting the same format as a reference coord.
 */
export function makeCoord(lat: number, lon: number, format: CoordFormat): ParsedCoord {
  if (format === 'dms') {
    return {
      lat,
      lon,
      rawLat: toDMSString(lat, true),
      rawLon: toDMSString(lon, false),
      format: 'dms',
    };
  }
  return {
    lat,
    lon,
    rawLat: lat.toFixed(14),
    rawLon: lon.toFixed(14),
    format: 'decimal',
  };
}

/** Convert a ColorDef RGB to a CSS hex string. */
export function colorDefToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    r.toString(16).padStart(2, '0') +
    g.toString(16).padStart(2, '0') +
    b.toString(16).padStart(2, '0')
  );
}
