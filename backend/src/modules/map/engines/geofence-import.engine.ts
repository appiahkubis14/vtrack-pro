/** Turns CSV or GeoJSON text into geofence bodies for GeofencesService.create. Never throws on a bad row; reports it. */

export interface ImportRow { row: number; body?: any; error?: string }
const MAX_ROWS = 1000;

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',' || c === ';') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out.map((s) => s.trim());
}

/**
 * CSV columns (header required, any order): name, lat, lng, radius (metres) for circles; or name, polygon for polygons, where polygon is
 * "lat lng; lat lng; lat lng" (at least 3 points). Optional: color, speedLimit, description.
 */
export function parseCsv(text: string): ImportRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [{ row: 0, error: 'The file needs a header line and at least one row' }];
  if (lines.length - 1 > MAX_ROWS) return [{ row: 0, error: `At most ${MAX_ROWS} rows per import` }];
  const head = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (n: string) => head.indexOf(n);
  if (idx('name') < 0 || (idx('lat') < 0 && idx('polygon') < 0)) return [{ row: 0, error: 'Header must include name and either lat, lng, radius or polygon' }];
  return lines.slice(1).map((line, i) => {
    const row = i + 2, c = parseCsvLine(line), get = (n: string) => (idx(n) >= 0 ? c[idx(n)] ?? '' : '');
    const body: any = { name: get('name') };
    if (get('color')) body.color = get('color');
    if (get('speedlimit')) body.speedLimit = Number(get('speedlimit'));
    if (get('description')) body.description = get('description');
    if (get('polygon')) {
      const pts = get('polygon').split(/\s*[;|]\s*/).map((p) => p.trim().split(/[\s,]+/).map(Number)).filter((p) => p.length >= 2);
      if (pts.length < 3 || pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return { row, error: 'polygon needs at least 3 points written as "lat lng; lat lng; lat lng"' };
      const ring = pts.map((p) => [p[1], p[0]]); ring.push(ring[0]);
      body.type = 'polygon'; body.coordinates = { type: 'Polygon', coordinates: [ring] };
    } else {
      const lat = Number(get('lat')), lng = Number(get('lng') || get('lon')), r = Number(get('radius') || 100);
      if (get('lat') === '' || !Number.isFinite(lat) || !Number.isFinite(lng)) return { row, error: 'lat and lng must be numbers' };
      body.type = 'circle'; body.centerLatitude = lat; body.centerLongitude = lng; body.radius = r;
    }
    return { row, body };
  });
}

/** GeoJSON FeatureCollection (or one Feature/Polygon). A Point needs properties.radius (metres, default 100); name from properties.name. */
export function parseGeoJson(text: string): ImportRow[] {
  let j: any;
  try { j = JSON.parse(text.replace(/^﻿/, '')); } catch { return [{ row: 0, error: 'This is not valid JSON' }]; }
  const feats: any[] = j?.type === 'FeatureCollection' ? j.features : j?.type === 'Feature' ? [j] : j?.type ? [{ type: 'Feature', geometry: j, properties: {} }] : [];
  if (!Array.isArray(feats) || !feats.length) return [{ row: 0, error: 'No features found' }];
  if (feats.length > MAX_ROWS) return [{ row: 0, error: `At most ${MAX_ROWS} features per import` }];
  return feats.map((f, i) => {
    const row = i + 1, p = f?.properties ?? {}, g = f?.geometry;
    const name = String(p.name ?? p.Name ?? p.NAME ?? '').trim();
    const body: any = { name };
    if (p.color) body.color = p.color; if (p.speedLimit) body.speedLimit = Number(p.speedLimit); if (p.description) body.description = String(p.description);
    if (g?.type === 'Point' && Array.isArray(g.coordinates)) { body.type = 'circle'; body.centerLongitude = g.coordinates[0]; body.centerLatitude = g.coordinates[1]; body.radius = Number(p.radius ?? 100); }
    else if (g?.type === 'Polygon' && Array.isArray(g.coordinates)) { body.type = 'polygon'; body.coordinates = { type: 'Polygon', coordinates: [g.coordinates[0]] }; } // holes are not supported
    else if (g?.type === 'MultiPolygon') return { row, error: 'MultiPolygon is not supported; split it into separate polygons' };
    else return { row, error: `Geometry type ${g?.type ?? 'missing'} is not supported (use Point with a radius, or Polygon)` };
    return { row, body };
  });
}
