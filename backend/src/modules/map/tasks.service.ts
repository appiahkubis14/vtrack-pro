import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { AlertsGateway } from '../alerts/gateways/alerts.gateway';
import { MapScopeService } from './map-scope.service';

const STAFF_WRITE: Role[] = [Role.SUPER_ADMIN, Role.ORG_ADMIN, Role.FLEET_MANAGER, Role.DISPATCHER];
const rowsOf = (res: any): any[] => (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number' ? res[0] : res);
const MAX_PHOTO_CHARS = 1_600_000; // about 1.2 MB of image

/**
 * Checklists tied to geofences: when a vehicle enters (or leaves) a zone, a task is created for it. The assigned rider completes it in
 * the rider portal (ticks, optional photo and note) and the map sees the result straight away.
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly scope: MapScopeService, private readonly gateway: AlertsGateway) {}

  private ping(orgId: string, payload: object) { try { this.gateway.server?.to(`org:${orgId}`).emit('taskUpdate', payload); } catch { /* live push is optional; the map also polls */ } }

  // ---------------------------------------------------------------- task definitions
  private cleanItems(items: any): { id: string; text: string; requirePhoto: boolean }[] {
    if (!Array.isArray(items) || !items.length || items.length > 20) throw new BadRequestException('Give 1 to 20 checklist items');
    return items.map((it, i) => {
      const text = String(typeof it === 'string' ? it : it?.text ?? '').trim();
      if (text.length < 2 || text.length > 200) throw new BadRequestException(`Item ${i + 1}: text must be 2 to 200 characters`);
      return { id: String(it?.id || randomUUID()).slice(0, 40), text, requirePhoto: it?.requirePhoto === true };
    });
  }
  private async geofenceOrThrow(orgId: string, id: string) {
    const [g] = await this.ds.query(`SELECT id, name FROM geofences WHERE id=$1 AND organization_id=$2`, [id, orgId]);
    if (!g) throw new NotFoundException('Geofence not found'); return g;
  }
  async listDefinitions(user: AuthUser) {
    return this.ds.query(`SELECT t.id, t.geofence_id AS "geofenceId", g.name AS "geofenceName", t.trigger, t.title, t.items, t.expires_minutes AS "expiresMinutes", t.is_active AS "isActive" FROM geofence_tasks t JOIN geofences g ON g.id=t.geofence_id WHERE t.organization_id=$1 ORDER BY g.name, t.title`, [user.organizationId]);
  }
  async createDefinition(user: AuthUser, b: any) {
    if (!STAFF_WRITE.includes(user.role)) throw new ForbiddenException('Your role cannot change checklists');
    await this.geofenceOrThrow(user.organizationId, b?.geofenceId);
    const title = String(b?.title ?? '').trim(); if (title.length < 2 || title.length > 160) throw new BadRequestException('Title must be 2 to 160 characters');
    const trigger = b?.trigger === 'exit' ? 'exit' : 'entry';
    const exp = Number(b?.expiresMinutes ?? 120); if (!Number.isInteger(exp) || exp < 5 || exp > 1440) throw new BadRequestException('expiresMinutes must be 5 to 1440');
    const [r] = await this.ds.query(`INSERT INTO geofence_tasks (organization_id, geofence_id, trigger, title, items, expires_minutes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [user.organizationId, b.geofenceId, trigger, title, JSON.stringify(this.cleanItems(b.items)), exp, user.sub]);
    return { id: r.id };
  }
  async updateDefinition(user: AuthUser, id: string, b: any) {
    if (!STAFF_WRITE.includes(user.role)) throw new ForbiddenException('Your role cannot change checklists');
    const [t] = await this.ds.query(`SELECT * FROM geofence_tasks WHERE id=$1 AND organization_id=$2`, [id, user.organizationId]); if (!t) throw new NotFoundException('Checklist not found');
    const title = b.title !== undefined ? String(b.title).trim() : t.title; if (title.length < 2 || title.length > 160) throw new BadRequestException('Title must be 2 to 160 characters');
    const items = b.items !== undefined ? this.cleanItems(b.items) : t.items;
    const exp = b.expiresMinutes !== undefined ? Number(b.expiresMinutes) : t.expires_minutes; if (!Number.isInteger(exp) || exp < 5 || exp > 1440) throw new BadRequestException('expiresMinutes must be 5 to 1440');
    await this.ds.query(`UPDATE geofence_tasks SET title=$3, items=$4, expires_minutes=$5, trigger=$6, is_active=$7 WHERE id=$1 AND organization_id=$2`, [id, user.organizationId, title, JSON.stringify(items), exp, b.trigger === 'exit' ? 'exit' : b.trigger === 'entry' ? 'entry' : t.trigger, b.isActive === undefined ? t.is_active : !!b.isActive]);
    return { id };
  }
  async removeDefinition(user: AuthUser, id: string) {
    if (!STAFF_WRITE.includes(user.role)) throw new ForbiddenException('Your role cannot change checklists');
    const res = rowsOf(await this.ds.query(`DELETE FROM geofence_tasks WHERE id=$1 AND organization_id=$2 RETURNING id`, [id, user.organizationId]));
    if (!res.length) throw new NotFoundException('Checklist not found'); return { success: true };
  }

  // ---------------------------------------------------------------- triggering
  @OnEvent('geofence.transition')
  async onTransition(e: { organizationId: string; geofenceId: string; geofenceName: string; vehicleId?: string; type: string; latitude: number; longitude: number }) {
    try {
      if (!e.vehicleId) return;
      const trig = /entry|enter/i.test(e.type) ? 'entry' : 'exit';
      const tasks: any[] = await this.ds.query(`SELECT * FROM geofence_tasks WHERE geofence_id=$1 AND trigger=$2 AND is_active`, [e.geofenceId, trig]);
      for (const t of tasks) {
        const [dup] = await this.ds.query(`SELECT 1 FROM task_runs WHERE task_id=$1 AND vehicle_id=$2 AND status='pending'`, [t.id, e.vehicleId]);
        if (dup) continue;
        const [run] = await this.ds.query(`INSERT INTO task_runs (organization_id, task_id, geofence_id, geofence_name, vehicle_id, title, trigger, items, expires_at, latitude, longitude) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + ($9 || ' minutes')::interval, $10, $11) RETURNING id`,
          [e.organizationId, t.id, e.geofenceId, e.geofenceName, e.vehicleId, t.title, trig, JSON.stringify(t.items), String(t.expires_minutes), e.latitude, e.longitude]);
        this.ping(e.organizationId, { kind: 'created', id: run.id, vehicleId: e.vehicleId, title: t.title });
      }
    } catch (err: any) { this.logger.warn(`Could not create checklist run: ${err.message}`); }
  }

  @Interval(60_000)
  async expire() { await this.ds.query(`UPDATE task_runs SET status='expired' WHERE status='pending' AND expires_at < now()`).catch(() => undefined); }

  // ---------------------------------------------------------------- runs
  async listRuns(user: AuthUser, q: { status?: string; vehicleId?: string }) {
    await this.expire();
    const hubs = await this.scope.hubScope(user);
    const params: unknown[] = [user.organizationId]; let w = '';
    if (!hubs.all) { if (!hubs.hubIds.length) return []; params.push(hubs.hubIds); w += ` AND v.hub_id = ANY($${params.length}::uuid[])`; }
    if (q.status && ['pending', 'completed', 'expired'].includes(q.status)) { params.push(q.status); w += ` AND r.status = $${params.length}`; }
    if (q.vehicleId && /^[0-9a-f-]{36}$/i.test(q.vehicleId)) { params.push(q.vehicleId); w += ` AND r.vehicle_id = $${params.length}::uuid`; }
    const rows = await this.ds.query(
      `SELECT r.id, r.title, r.trigger, r.items, r.status, r.triggered_at AS "triggeredAt", r.expires_at AS "expiresAt", r.completed_at AS "completedAt", r.answers, r.note, (r.photo_data IS NOT NULL) AS "hasPhoto", r.geofence_name AS "geofenceName", r.vehicle_id AS "vehicleId", v.plate_number AS plate
         FROM task_runs r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.organization_id=$1${w} ORDER BY r.triggered_at DESC LIMIT 100`, params);
    return rows; // a checklist status is not a position, so driver privacy does not hide it
  }

  async photo(user: AuthUser, id: string) {
    const [r] = await this.ds.query(`SELECT r.photo_data, r.vehicle_id FROM task_runs r WHERE r.id=$1 AND r.organization_id=$2`, [id, user.organizationId]);
    if (!r?.photo_data) throw new NotFoundException('No photo'); return { photo: r.photo_data };
  }

  /** Pending checklists for the rider's own vehicle. */
  async myRuns(user: AuthUser) {
    await this.expire();
    return this.ds.query(
      `SELECT r.id, r.title, r.trigger, r.items, r.status, r.triggered_at AS "triggeredAt", r.expires_at AS "expiresAt", r.geofence_name AS "geofenceName", v.plate_number AS plate
         FROM task_runs r JOIN vehicles v ON v.id=r.vehicle_id
         JOIN rider_assignments a ON a.vehicle_id = v.id AND a.status='active' JOIN riders rd ON rd.id = a.rider_id AND rd.user_id = $1
        WHERE r.organization_id=$2 AND r.status='pending' ORDER BY r.triggered_at DESC`, [user.sub, user.organizationId]);
  }

  async complete(user: AuthUser, id: string, b: any) {
    const [r] = await this.ds.query(`SELECT * FROM task_runs WHERE id=$1 AND organization_id=$2`, [id, user.organizationId]);
    if (!r) throw new NotFoundException('Checklist not found');
    const isStaff = STAFF_WRITE.includes(user.role);
    if (!isStaff) {
      const [mine] = await this.ds.query(`SELECT 1 FROM rider_assignments a JOIN riders rd ON rd.id=a.rider_id WHERE a.vehicle_id=$1 AND a.status='active' AND rd.user_id=$2`, [r.vehicle_id, user.sub]);
      if (!mine) throw new ForbiddenException('This checklist is not for your vehicle');
    }
    if (r.status !== 'pending') throw new BadRequestException(r.status === 'completed' ? 'This checklist is already completed' : 'This checklist has expired');
    if (new Date(r.expires_at) < new Date()) { await this.expire(); throw new BadRequestException('This checklist has expired'); }
    const answers = b?.answers && typeof b.answers === 'object' ? b.answers : {};
    const items = r.items as { id: string; text: string; requirePhoto: boolean }[];
    const missing = items.filter((it) => answers[it.id] !== true);
    if (missing.length) throw new BadRequestException(`Please confirm: ${missing.map((m) => m.text).join('; ')}`);
    let photo: string | null = null;
    if (b?.photo) { photo = String(b.photo); if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > MAX_PHOTO_CHARS) throw new BadRequestException('Photo must be a JPEG, PNG or WebP image under about 1 MB'); }
    if (items.some((it) => it.requirePhoto) && !photo) throw new BadRequestException('A photo is required for this checklist');
    const note = b?.note ? String(b.note).slice(0, 1000) : null;
    await this.ds.query(`UPDATE task_runs SET status='completed', completed_at=now(), completed_by=$2, answers=$3, note=$4, photo_data=$5 WHERE id=$1`, [id, user.sub, JSON.stringify(answers), note, photo]);
    this.ping(user.organizationId, { kind: 'completed', id, vehicleId: r.vehicle_id, title: r.title });
    return { success: true };
  }
}
