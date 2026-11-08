import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';

export interface GeoResult { label: string; lat: number; lng: number; type?: string; /** south, north, west, east */ bbox?: number[] }

/**
 * Address search and reverse lookup through a Nominatim-compatible service (default: the public OpenStreetMap one).
 * The public service allows about one request per second and needs an identifying User-Agent, so this class
 * queues requests one second apart and caches answers. For heavy use point GEOCODER_URL at your own instance
 * or a paid provider with the same API.
 */
@Injectable()
export class GeocodeService {
  private readonly logger = new Logger(GeocodeService.name);
  private readonly base = (process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
  private readonly country = (process.env.GEOCODER_COUNTRY ?? 'gh').toLowerCase();
  private readonly ua = `VTrackPro/1.0 (${process.env.GEOCODER_CONTACT || 'fleet tracking'})`;
  private readonly minGapMs = Number(process.env.GEOCODER_MIN_GAP_MS ?? 1000);
  private readonly ttlMs = 24 * 3600 * 1000;
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private chain: Promise<unknown> = Promise.resolve();
  private lastCall = 0;

  private cached<T>(key: string): T | undefined {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value as T;
    if (hit) this.cache.delete(key);
    return undefined;
  }
  private remember(key: string, value: unknown) {
    if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: Date.now(), value });
  }

  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.lastCall + this.minGapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCall = Date.now();
      return fn();
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async get(path: string): Promise<any> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 7000);
    try {
      const res = await fetch(this.base + path, { headers: { 'User-Agent': this.ua, Accept: 'application/json', 'Accept-Language': 'en' }, signal: ctl.signal });
      if (!res.ok) throw new Error(`geocoder answered ${res.status}`);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  async search(q: string, near?: { lat: number; lng: number }): Promise<GeoResult[]> {
    const text = (q ?? '').trim();
    if (text.length < 3) throw new BadRequestException('Type at least 3 characters to search');
    if (text.length > 200) throw new BadRequestException('Search text is too long');
    const key = `s:${text.toLowerCase()}:${near ? near.lat.toFixed(1) + ',' + near.lng.toFixed(1) : ''}`;
    const hit = this.cached<GeoResult[]>(key);
    if (hit) return hit;
    const params = new URLSearchParams({ q: text, format: 'jsonv2', limit: '6', addressdetails: '0' });
    if (this.country) params.set('countrycodes', this.country);
    if (near) { const d = 1.5; params.set('viewbox', `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`); }
    try {
      const rows = await this.queue(() => this.get('/search?' + params.toString()));
      const out: GeoResult[] = (Array.isArray(rows) ? rows : []).map((r: any) => ({
        label: String(r.display_name ?? ''), lat: Number(r.lat), lng: Number(r.lon), type: r.type,
        bbox: Array.isArray(r.boundingbox) ? [Number(r.boundingbox[0]), Number(r.boundingbox[1]), Number(r.boundingbox[2]), Number(r.boundingbox[3])] : undefined,
      })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
      this.remember(key, out);
      return out;
    } catch (e: any) {
      this.logger.warn(`Address search failed: ${e.message}`);
      throw new BadGatewayException('Address search is not available right now. Try again in a moment.');
    }
  }

  async reverse(lat: number, lng: number): Promise<{ address: string | null }> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new BadRequestException('lat and lng must be valid coordinates');
    const key = `r:${lat.toFixed(4)},${lng.toFixed(4)}`;
    const hit = this.cached<{ address: string | null }>(key);
    if (hit) return hit;
    try {
      const r = await this.queue(() => this.get(`/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`));
      const value = { address: r && !r.error ? String(r.display_name ?? '') || null : null };
      this.remember(key, value);
      return value;
    } catch (e: any) {
      this.logger.warn(`Reverse lookup failed: ${e.message}`);
      throw new BadGatewayException('Address lookup is not available right now.');
    }
  }
}
