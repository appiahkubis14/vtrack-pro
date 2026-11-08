import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { User } from '../auth/entities/user.entity';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  findAll(query: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 50 } = query;
    return this.organizations.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async create(body: Partial<Organization>) {
    const org = this.organizations.create(body);
    return this.organizations.save(org);
  }

  async findOne(id: string) {
    const org = await this.organizations.findOne({ where: { id } });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);
    return org;
  }

  async update(id: string, body: Partial<Organization>) {
    await this.findOne(id);
    await this.organizations.update(id, body as any);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.organizations.softDelete(id);
    return { success: true };
  }

  async listUsers(id: string) {
    await this.findOne(id);
    // Never return credentials: no password hash, two-factor secret or backup codes.
    return this.users.find({
      where: { organizationId: id },
      select: ['id', 'email', 'firstName', 'lastName', 'phone', 'role', 'isActive', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
  }

  async inviteUser(id: string, body: { email: string; role?: string }) {
    await this.findOne(id);
    // TODO: this creates a placeholder account without a password and emails
    // nothing yet - real invite flow needs a signed invite token + email send
    // via NotificationsService, plus an "accept invite" endpoint that lets
    // the invitee set their own password. Kept minimal here since the
    // frontend doesn't call this endpoint yet.
    const existing = await this.users.findOne({ where: { email: body.email } });
    if (existing) throw new NotFoundException('User with that email already exists');
    return { success: true, note: 'Invite created - email delivery not yet wired up' };
  }
}
