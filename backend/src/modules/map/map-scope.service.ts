import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { DataScopeService } from '../hubs/data-scope.service';
import { isWorkTime } from './engines/geo.engine';

export interface HubScope { all: boolean; hubIds: string[] }
interface Priv { timezone: string; work_days: number[]; start_time: string; end_time: string }

/**
 * Who may see which vehicles on the map, and which vehicles are currently private.
 * Admins and fleet managers see everything. A hub manager sees their hubs. Any other user who has been given hubs
 * (Team page -> map scope) sees only those; without any, they see all, as before.
 */
@Injectable()
export class MapScopeService {
  private privCache = new Map<string, { at: number; map: Map<string, Priv> }>();
  private hubCache = new Map<string, { at: number; hub: string | null }>();

  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly base: DataScopeService) {}

  async hubScope(user: AuthUser): Promise<HubScope> {
    if (user.role === Role.SUPER_ADMIN || user.role === Role.ORG_ADMIN) return { all: true, hubIds: [] };
    const own = await this.base.forUser(user);
    const rows: { hub_id: string }[] = await this.ds.query(`SELECT hub_id FROM user_map_scope WHERE user_id=$1 AND organization_id=$2`, [user.sub, user.organizationId]);
    const extra = rows.map((r) => r.hub_id);
    if (user.role === Role.HUB_MANAGER) return { all: false, hubIds: [...new Set([...own.hubIds, ...extra])] };
    if (extra.length) return { all: false, hubIds: extra };
    return { all: own.all || user.role === Role.VIEWER, hubIds: [] };
  }

  async hubOfVehicle(orgId: string, vehicleId: string): Promise<string | null> {
    const k = `${orgId}:${vehicleId}`, hit = this.hubCache.get(k);
    if (hit && Date.now() - hit.at < 30_000) return hit.hub;
    const [r] = await this.ds.query(`SELECT hub_id FROM vehicles WHERE id=$1 AND organization_id=$2`, [vehicleId, orgId]);
    this.hubCache.set(k, { at: Date.now(), hub: r?.hub_id ?? null });
    if (this.hubCache.size > 5000) this.hubCache.clear();
    return r?.hub_id ?? null;
  }

  /** Working-hours settings of the vehicles that have privacy switched on (cached for 15 s). */
  async privacy(orgId: string): Promise<Map<string, Priv>> {
    const hit = this.privCache.get(orgId);
    if (hit && Date.now() - hit.at < 15_000) return hit.map;
    const rows: any[] = await this.ds.query(`SELECT vehicle_id, timezone, work_days, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time FROM vehicle_privacy WHERE organization_id=$1 AND enabled`, [orgId]);
    const map = new Map<string, Priv>(rows.map((r) => [r.vehicle_id, { timezone: r.timezone, work_days: r.work_days, start_time: r.start_time, end_time: r.end_time }]));
    this.privCache.set(orgId, { at: Date.now(), map });
    return map;
  }
  clearPrivacy(orgId: string) { this.privCache.delete(orgId); }

  async isOffDuty(orgId: string, vehicleId: string, at = new Date()): Promise<boolean> {
    const cfg = (await this.privacy(orgId)).get(vehicleId);
    return !!cfg && !isWorkTime(cfg, at);
  }
}
