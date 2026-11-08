import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { AuthUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';

/** Roles an administrator may hand out. super_admin and system are never created through the API. */
export const ASSIGNABLE_ROLES: Role[] = [Role.ORG_ADMIN, Role.FLEET_MANAGER, Role.DISPATCHER, Role.HUB_MANAGER, Role.FINANCE, Role.AUDITOR, Role.INVESTOR, Role.RIDER, Role.VIEWER];
const ROUNDS = 12;

export function assertStrongPassword(p: string | undefined): string {
  if (!p || p.length < 10 || !/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p) || !/[^A-Za-z0-9]/.test(p)) {
    throw new BadRequestException('Password must be at least 10 characters with an upper-case letter, a lower-case letter, a digit and a symbol');
  }
  return p;
}

export function generateTempPassword(): string {
  const b = randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, 'x');
  return `Vt${b.slice(0, 8)}#${randomBytes(2).toString('hex')}9A`;
}

export interface CreateUserInput { email?: string; firstName?: string; lastName?: string; phone?: string; role?: string; ownerId?: string; hubId?: string; riderId?: string; password?: string }

@Injectable()
export class TeamService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async list(user: AuthUser) {
    return this.ds.query(
      `SELECT u.id, u.email, u.first_name AS "firstName", u.last_name AS "lastName", u.phone, u.role, u.is_active AS "isActive", u.must_change_password AS "mustChangePassword",
              u.last_login_at AS "lastLoginAt", u.created_at AS "createdAt",
              (SELECT name FROM owners WHERE user_id=u.id LIMIT 1) AS "ownerName",
              (SELECT name FROM hubs WHERE manager_user_id=u.id LIMIT 1) AS "hubName",
              (SELECT full_name FROM riders WHERE user_id=u.id LIMIT 1) AS "riderName"
         FROM users u WHERE u.organization_id=$1 AND u.role <> 'system' AND u.deleted_at IS NULL ORDER BY u.created_at DESC`, [user.organizationId]);
  }

  /** Creates a login with a one-time password that must be changed at first sign-in; returns the password once. */
  async create(admin: AuthUser, i: CreateUserInput) {
    const email = i.email?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('A valid email is required');
    if (!i.firstName?.trim()) throw new BadRequestException('First name is required');
    const role = i.role as Role;
    if (!ASSIGNABLE_ROLES.includes(role)) throw new BadRequestException(`role must be one of ${ASSIGNABLE_ROLES.join(', ')}`);
    if (role === Role.ORG_ADMIN && admin.role !== Role.SUPER_ADMIN && admin.role !== Role.ORG_ADMIN) throw new ForbiddenException();
    const password = i.password ? assertStrongPassword(i.password) : generateTempPassword();
    const hash = await bcrypt.hash(password, ROUNDS);

    return this.ds.transaction(async (m) => {
      if (role === Role.INVESTOR) {
        if (!i.ownerId) throw new BadRequestException('An investor login must be linked to an owner (ownerId)');
        const [o] = await m.query(`SELECT id, user_id FROM owners WHERE id=$1 AND organization_id=$2`, [i.ownerId, admin.organizationId]);
        if (!o) throw new NotFoundException('Owner not found');
        if (o.user_id) throw new ConflictException('This owner already has a login');
      }
      if (role === Role.HUB_MANAGER) {
        if (!i.hubId) throw new BadRequestException('A hub manager login must be linked to a hub (hubId)');
        const [h] = await m.query(`SELECT id FROM hubs WHERE id=$1 AND organization_id=$2`, [i.hubId, admin.organizationId]);
        if (!h) throw new NotFoundException('Hub not found');
      }
      if (role === Role.RIDER) {
        if (!i.riderId) throw new BadRequestException('A rider login must be linked to a rider (riderId)');
        const [r] = await m.query(`SELECT id, user_id FROM riders WHERE id=$1 AND organization_id=$2`, [i.riderId, admin.organizationId]);
        if (!r) throw new NotFoundException('Rider not found');
        if (r.user_id) throw new ConflictException('This rider already has a login');
      }
      let created: any;
      try {
        [created] = await m.query(
          `INSERT INTO users (organization_id, email, password_hash, first_name, last_name, phone, role, is_active, must_change_password)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true,true) RETURNING id, email, role`,
          [admin.organizationId, email, hash, i.firstName!.trim(), i.lastName?.trim() ?? null, i.phone?.trim() ?? null, role]);
      } catch (e: any) {
        if (e?.code === '23505') throw new ConflictException('A user with this email already exists');
        throw e;
      }
      if (role === Role.INVESTOR) await m.query(`UPDATE owners SET user_id=$1 WHERE id=$2`, [created.id, i.ownerId]);
      if (role === Role.HUB_MANAGER) await m.query(`UPDATE hubs SET manager_user_id=$1 WHERE id=$2`, [created.id, i.hubId]);
      if (role === Role.RIDER) await m.query(`UPDATE riders SET user_id=$1 WHERE id=$2`, [created.id, i.riderId]);
      return { ...created, temporaryPassword: i.password ? undefined : password, mustChangePassword: true };
    });
  }

  private async target(admin: AuthUser, id: string) {
    const [u] = await this.ds.query(`SELECT id, role FROM users WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, admin.organizationId]);
    if (!u || u.role === Role.SYSTEM) throw new NotFoundException('User not found');
    if (u.role === Role.SUPER_ADMIN && admin.role !== Role.SUPER_ADMIN) throw new ForbiddenException();
    return u as { id: string; role: Role };
  }

  async setActive(admin: AuthUser, id: string, active: boolean) {
    if (id === admin.sub && !active) throw new ConflictException('You cannot deactivate your own account');
    await this.target(admin, id);
    await this.ds.query(`UPDATE users SET is_active=$1 WHERE id=$2`, [active, id]);
    if (!active) await this.ds.query(`UPDATE user_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL`, [id]).catch(() => undefined);
    return { id, isActive: active };
  }

  async resetPassword(admin: AuthUser, id: string) {
    await this.target(admin, id);
    const password = generateTempPassword();
    await this.ds.query(`UPDATE users SET password_hash=$1, must_change_password=true WHERE id=$2`, [await bcrypt.hash(password, ROUNDS), id]);
    await this.ds.query(`UPDATE user_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL`, [id]).catch(() => undefined);
    return { id, temporaryPassword: password, mustChangePassword: true };
  }

  async changeOwnPassword(user: AuthUser, current: string, next: string) {
    assertStrongPassword(next);
    const [u] = await this.ds.query(`SELECT password_hash FROM users WHERE id=$1`, [user.sub]);
    if (!u || !(await bcrypt.compare(current ?? '', u.password_hash))) throw new UnauthorizedException('Current password is incorrect');
    if (current === next) throw new BadRequestException('The new password must differ from the current one');
    await this.ds.query(`UPDATE users SET password_hash=$1, must_change_password=false WHERE id=$2`, [await bcrypt.hash(next, ROUNDS), user.sub]);
    return { changed: true };
  }

  async me(user: AuthUser) {
    const [u] = await this.ds.query(`SELECT id, email, first_name AS "firstName", last_name AS "lastName", role, must_change_password AS "mustChangePassword", organization_id AS "organizationId" FROM users WHERE id=$1`, [user.sub]);
    return u;
  }
}
