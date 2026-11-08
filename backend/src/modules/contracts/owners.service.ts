import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Owner } from './entities/owner.entity';
import { DataScope } from '../hubs/data-scope.service';
import { decryptField, encryptField, maskField } from '../../common/crypto/field-crypto';

export interface OwnerInput {
  ownerType?: 'individual' | 'sme'; name?: string; phone?: string; email?: string;
  momoNumber?: string; idDocument?: string; kycStatus?: 'pending' | 'verified' | 'rejected';
  userId?: string | null; riderId?: string | null; isActive?: boolean;
}

/** Sensitive values are encrypted at rest and only ever leave the API masked. */
@Injectable()
export class OwnersService {
  constructor(@InjectRepository(Owner) private readonly repo: Repository<Owner>) {}

  private view(o: Owner & { momoNumberEnc?: string | null }) {
    const { momoNumberEnc, idDocumentEnc, ...safe } = o as any;
    return { ...safe, momoNumberMasked: momoNumberEnc ? maskField(decryptField(momoNumberEnc)) : null };
  }

  private async withSecrets(orgId: string, id: string): Promise<Owner> {
    const o = await this.repo.createQueryBuilder('o').addSelect('o.momo_number_enc').where('o.id=:id AND o.organization_id=:org', { id, org: orgId }).getOne();
    if (!o) throw new NotFoundException('Owner not found');
    return o;
  }

  async list(orgId: string, scope: DataScope) {
    if (!scope.all && scope.ownerIds.length === 0) return [];
    const qb = this.repo.createQueryBuilder('o').addSelect('o.momo_number_enc').where('o.organization_id=:org', { org: orgId });
    if (!scope.all) qb.andWhere('o.id = ANY(:ids)', { ids: scope.ownerIds });
    return (await qb.orderBy('o.name', 'ASC').getMany()).map((o) => this.view(o));
  }

  async get(orgId: string, id: string) { return this.view(await this.withSecrets(orgId, id)); }

  async create(orgId: string, i: OwnerInput) {
    if (!i.name?.trim() || !i.phone?.trim()) throw new BadRequestException('An owner needs a name and a phone number');
    const dup = await this.repo.findOne({ where: { organizationId: orgId, phone: i.phone } });
    if (dup) throw new ConflictException('An owner with this phone number already exists');
    const o = this.repo.create({
      organizationId: orgId, ownerType: i.ownerType ?? 'individual', name: i.name.trim(), phone: i.phone.trim(), email: i.email ?? null,
      momoNumberEnc: i.momoNumber ? encryptField(i.momoNumber) : null,
      idDocumentEnc: i.idDocument ? encryptField(i.idDocument) : null,
      idDocumentLast4: i.idDocument ? i.idDocument.slice(-4) : null,
      userId: i.userId ?? null, riderId: i.riderId ?? null,
    });
    const saved = await this.repo.save(o);
    return this.view(saved);
  }

  async update(orgId: string, id: string, i: OwnerInput) {
    const o = await this.withSecrets(orgId, id);
    if (i.ownerType !== undefined) o.ownerType = i.ownerType;
    if (i.name !== undefined) o.name = i.name;
    if (i.phone !== undefined) o.phone = i.phone;
    if (i.email !== undefined) o.email = i.email;
    if (i.kycStatus !== undefined) o.kycStatus = i.kycStatus;
    if (i.userId !== undefined) o.userId = i.userId;
    if (i.riderId !== undefined) o.riderId = i.riderId;
    if (i.isActive !== undefined) o.isActive = i.isActive;
    if (i.momoNumber !== undefined) o.momoNumberEnc = i.momoNumber ? encryptField(i.momoNumber) : null;
    if (i.idDocument !== undefined) { o.idDocumentEnc = i.idDocument ? encryptField(i.idDocument) : null; o.idDocumentLast4 = i.idDocument ? i.idDocument.slice(-4) : null; }
    return this.view(await this.repo.save(o));
  }
}
