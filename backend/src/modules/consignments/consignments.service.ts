import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Consignment, ConsignmentLine } from './entities/consignment.entity';
import { Supplier } from './entities/supplier.entity';
import { AuthUser } from '../../common/auth/auth-user';
import { VehicleModel, VehicleType } from './entities/vehicle-model.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { CONSIGNMENT_TRANSITIONS, VEHICLE_TRANSITIONS, ConsignmentStatus, VehicleLifecycle, assertTransition } from '../../common/lifecycle/transitions';
import { assertPesewas } from '../../common/money/money';
import { assertIsoDate } from '../../common/dates/dates';

export interface VehicleModelInput {
  brand?: string; name?: string; vehicleType?: VehicleType; batterySpec?: string; listPricePesewas?: number; isActive?: boolean;
}
export interface ConsignmentInput {
  reference?: string; supplierId?: string; supplierName?: string; supplierCountry?: string; containerNo?: string; blNumber?: string; notes?: string;
  landedCostPesewas?: number;
  lines?: { vehicleModelId: string; quantity: number; unitCostPesewas: number }[];
}

const DATE_FIELD: Partial<Record<ConsignmentStatus, keyof Consignment>> = {
  [ConsignmentStatus.SHIPPED]: 'shippedAt',
  [ConsignmentStatus.AT_PORT]: 'arrivedAt',
  [ConsignmentStatus.CLEARED]: 'clearedAt',
  [ConsignmentStatus.RECEIVED]: 'receivedAt',
  [ConsignmentStatus.CLOSED]: 'closedAt',
};

@Injectable()
export class ConsignmentsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // ---------- vehicle models ----------
  listModels(orgId: string) {
    return this.ds.getRepository(VehicleModel).find({ where: { organizationId: orgId }, order: { brand: 'ASC', name: 'ASC' } });
  }

  async createModel(orgId: string, i: VehicleModelInput) {
    if (!i.brand || !i.name || !i.vehicleType) throw new BadRequestException('A vehicle model needs brand, name and vehicleType');
    if (!Object.values(VehicleType).includes(i.vehicleType)) throw new BadRequestException(`vehicleType must be one of ${Object.values(VehicleType).join(', ')}`);
    const price = i.listPricePesewas == null ? 0 : assertPesewas(i.listPricePesewas, 'listPricePesewas', { min: 0 });
    const repo = this.ds.getRepository(VehicleModel);
    return repo.save(repo.create({ organizationId: orgId, brand: i.brand, name: i.name, vehicleType: i.vehicleType, batterySpec: i.batterySpec ?? null, listPricePesewas: price }));
  }

  async updateModel(orgId: string, id: string, i: VehicleModelInput) {
    const repo = this.ds.getRepository(VehicleModel);
    const m = await repo.findOne({ where: { id, organizationId: orgId } });
    if (!m) throw new NotFoundException('Vehicle model not found');
    if (i.brand !== undefined) m.brand = i.brand;
    if (i.name !== undefined) m.name = i.name;
    if (i.vehicleType !== undefined) m.vehicleType = i.vehicleType;
    if (i.batterySpec !== undefined) m.batterySpec = i.batterySpec;
    if (i.listPricePesewas !== undefined) m.listPricePesewas = assertPesewas(i.listPricePesewas, 'listPricePesewas', { min: 0 });
    if (i.isActive !== undefined) m.isActive = i.isActive;
    return repo.save(m);
  }

  // ---------- consignments ----------
  async list(orgId: string) {
    const rows = await this.ds.query(
      `SELECT c.*, COALESCE(SUM(l.quantity),0)::int AS units_ordered, COALESCE(SUM(l.units_registered),0)::int AS units_registered, COALESCE(SUM(l.units_written_off),0)::int AS units_written_off
         FROM consignments c LEFT JOIN consignment_lines l ON l.consignment_id = c.id
        WHERE c.organization_id=$1 GROUP BY c.id ORDER BY c.created_at DESC`, [orgId]);
    return rows.map((r: any) => ({
      id: r.id, reference: r.reference, supplierName: r.supplier_name, containerNo: r.container_no, status: r.status,
      landedCostPesewas: Number(r.landed_cost_pesewas), unitsOrdered: r.units_ordered, unitsRegistered: r.units_registered, unitsWrittenOff: r.units_written_off, supplierId: r.supplier_id, createdAt: r.created_at,
    }));
  }

  async get(orgId: string, id: string) {
    const c = await this.ds.getRepository(Consignment).findOne({ where: { id, organizationId: orgId }, relations: { lines: { vehicleModel: true } } });
    if (!c) throw new NotFoundException('Consignment not found');
    return c;
  }

  async create(orgId: string, userId: string, i: ConsignmentInput) {
    if (!i.reference) throw new BadRequestException('A consignment needs a reference');
    if (!i.lines?.length) throw new BadRequestException('A consignment needs at least one line');
    for (const l of i.lines) {
      if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new BadRequestException('Line quantity must be a whole number of at least 1');
      assertPesewas(l.unitCostPesewas, 'unitCostPesewas', { min: 0 });
    }
    const modelIds = [...new Set(i.lines.map((l) => l.vehicleModelId))];
    const found = await this.ds.getRepository(VehicleModel).createQueryBuilder('m').where('m.organization_id=:o AND m.id IN (:...ids)', { o: orgId, ids: modelIds }).getCount();
    if (found !== modelIds.length) throw new BadRequestException('One or more vehicle models do not exist');
    const landed = i.landedCostPesewas == null ? 0 : assertPesewas(i.landedCostPesewas, 'landedCostPesewas', { min: 0 });

    let supplier: Supplier | null = null;
    if (i.supplierId) {
      supplier = await this.ds.getRepository(Supplier).findOne({ where: { id: i.supplierId, organizationId: orgId } });
      if (!supplier) throw new BadRequestException('Supplier not found');
    }
    return this.ds.transaction(async (m) => {
      const exists = await m.getRepository(Consignment).findOne({ where: { organizationId: orgId, reference: i.reference } });
      if (exists) throw new ConflictException(`Consignment reference ${i.reference} already exists`);
      const c = await m.getRepository(Consignment).save(m.getRepository(Consignment).create({
        organizationId: orgId, reference: i.reference, supplierId: supplier?.id ?? null, supplierName: supplier?.name ?? i.supplierName ?? null, supplierCountry: supplier?.country ?? i.supplierCountry ?? null,
        containerNo: i.containerNo ?? null, blNumber: i.blNumber ?? null, notes: i.notes ?? null, landedCostPesewas: landed, createdBy: userId,
      }));
      await m.getRepository(ConsignmentLine).insert(i.lines!.map((l) => ({ consignmentId: c.id, vehicleModelId: l.vehicleModelId, quantity: l.quantity, unitCostPesewas: l.unitCostPesewas })));
      return this.getWith(m.getRepository(Consignment), c.id);
    });
  }

  private getWith(repo: import('typeorm').Repository<Consignment>, id: string) {
    return repo.findOneOrFail({ where: { id }, relations: { lines: { vehicleModel: true } } });
  }

  /** Landed cost (freight, duty, clearing) is finalized once the goods are cleared. */
  async setLandedCost(orgId: string, id: string, landedCostPesewas: number) {
    const c = await this.get(orgId, id);
    if (c.status === ConsignmentStatus.CLOSED) throw new ConflictException('A closed consignment cannot be changed');
    c.landedCostPesewas = assertPesewas(landedCostPesewas, 'landedCostPesewas', { min: 0 });
    await this.ds.getRepository(Consignment).save({ id: c.id, landedCostPesewas: c.landedCostPesewas });
    return this.get(orgId, id);
  }

  async advance(orgId: string, id: string, to: ConsignmentStatus, date?: string) {
    if (to === ConsignmentStatus.RECEIVED) throw new BadRequestException('Use the receive action to register units; the consignment becomes received when all are registered');
    const c = await this.get(orgId, id);
    assertTransition('Consignment', CONSIGNMENT_TRANSITIONS, c.status, to);
    if (to === ConsignmentStatus.CLOSED) await this.assertCanClose(c);
    const field = DATE_FIELD[to];
    const patch: Partial<Consignment> = { status: to };
    if (field) (patch as any)[field] = date ? assertIsoDate(date) : new Date().toISOString().slice(0, 10);
    await this.ds.getRepository(Consignment).update({ id }, patch as any);
    return this.get(orgId, id);
  }

  /** Rule BR14: a consignment cannot close until every ordered unit is registered (in stock or sold) or written off with a reason. */
  private async assertCanClose(c: Consignment) {
    const open = (c.lines ?? []).reduce((n, l) => n + (l.quantity - l.unitsRegistered - l.unitsWrittenOff), 0);
    if (open > 0) throw new ConflictException(`${open} unit(s) from this consignment are neither registered nor written off`);
  }

  /** Units that never arrived or arrived unusable. A reason is mandatory and the write-off is permanent. */
  async writeOff(user: AuthUser, id: string, i: { lineId?: string; units?: number; reason?: string }) {
    const units = i.units ?? 1;
    if (!Number.isInteger(units) || units < 1) throw new BadRequestException('units must be a whole number of at least 1');
    if (!i.reason?.trim() || i.reason.trim().length < 3) throw new BadRequestException('A reason is required to write off units');
    return this.ds.transaction(async (m) => {
      const c = await m.getRepository(Consignment).findOne({ where: { id, organizationId: user.organizationId } });
      if (!c) throw new NotFoundException('Consignment not found');
      if (c.status === ConsignmentStatus.CLOSED) throw new ConflictException('A closed consignment cannot be changed');
      if (c.status === ConsignmentStatus.ORDERED) throw new ConflictException('Nothing can be written off before the goods have shipped');
      const l = await m.getRepository(ConsignmentLine).createQueryBuilder('l').setLock('pessimistic_write').where('l.id=:l AND l.consignment_id=:c', { l: i.lineId, c: id }).getOne();
      if (!l) throw new NotFoundException('Consignment line not found');
      const outstanding = l.quantity - l.unitsRegistered - l.unitsWrittenOff;
      if (units > outstanding) throw new ConflictException(`Only ${outstanding} unit(s) are outstanding on this line`);
      await m.query(`UPDATE consignment_lines SET units_written_off = units_written_off + $1 WHERE id=$2`, [units, l.id]);
      await m.query(`INSERT INTO write_offs (organization_id, consignment_line_id, units, reason, created_by) VALUES ($1,$2,$3,$4,$5)`, [user.organizationId, l.id, units, i.reason!.trim(), user.sub]);
      const [{ open }] = await m.query(`SELECT COALESCE(SUM(quantity - units_registered - units_written_off),0)::int AS open FROM consignment_lines WHERE consignment_id=$1`, [id]);
      if (open === 0 && c.status === ConsignmentStatus.CLEARED) await m.query(`UPDATE consignments SET status='received', received_at=CURRENT_DATE WHERE id=$1`, [id]);
      return { consignmentId: id, writtenOff: units, outstanding: open };
    });
  }

  // ---------- suppliers ----------
  listSuppliers(orgId: string) { return this.ds.getRepository(Supplier).find({ where: { organizationId: orgId }, order: { name: 'ASC' } }); }

  async createSupplier(orgId: string, i: Partial<Supplier>) {
    if (!i.name?.trim()) throw new BadRequestException('A supplier needs a name');
    const repo = this.ds.getRepository(Supplier);
    if (await repo.findOne({ where: { organizationId: orgId, name: i.name.trim() } })) throw new ConflictException('A supplier with this name already exists');
    return repo.save(repo.create({ organizationId: orgId, name: i.name.trim(), country: i.country ?? null, contactName: i.contactName ?? null, phone: i.phone ?? null, email: i.email ?? null, notes: i.notes ?? null }));
  }

  async updateSupplier(orgId: string, id: string, i: Partial<Supplier>) {
    const repo = this.ds.getRepository(Supplier);
    const s = await repo.findOne({ where: { id, organizationId: orgId } });
    if (!s) throw new NotFoundException('Supplier not found');
    for (const k of ['name', 'country', 'contactName', 'phone', 'email', 'notes', 'isActive'] as const) if ((i as any)[k] !== undefined) (s as any)[k] = (i as any)[k];
    return repo.save(s);
  }

  // ---------- individual vehicles ----------
  async listVehicles(orgId: string, q: { status?: string }) {
    const params: unknown[] = [orgId]; let st = '';
    if (q.status) { params.push(q.status); st = 'AND v.lifecycle_status=$2'; }
    return this.ds.query(
      `SELECT v.id, v.plate_number AS "plateNumber", v.chassis_no AS "chassisNo", v.motor_no AS "motorNo", v.color, v.lifecycle_status AS "lifecycleStatus",
              v.owner_id AS "ownerId", o.name AS "ownerName", vm.brand, vm.name AS "modelName", vm.vehicle_type AS "vehicleType", c.reference AS "consignmentRef"
         FROM vehicles v LEFT JOIN owners o ON o.id=v.owner_id LEFT JOIN vehicle_models vm ON vm.id=v.vehicle_model_id
         LEFT JOIN consignment_lines l ON l.id=v.consignment_line_id LEFT JOIN consignments c ON c.id=l.consignment_id
        WHERE v.organization_id=$1 ${st} ORDER BY v.created_at DESC LIMIT 500`, params);
  }

  /** Real plate, chassis and motor numbers replace the placeholders given at receipt. */
  async updateVehicle(orgId: string, id: string, i: { plateNumber?: string; chassisNo?: string; motorNo?: string; color?: string }) {
    const repo = this.ds.getRepository(Vehicle);
    const v = await repo.findOne({ where: { id, organizationId: orgId } });
    if (!v) throw new NotFoundException('Vehicle not found');
    if (v.lifecycleStatus === VehicleLifecycle.RETIRED) throw new ConflictException('A retired vehicle cannot be edited');
    const clean = (x: string | undefined) => (x === undefined ? undefined : x.trim() === '' ? null : x.trim());
    if (i.plateNumber !== undefined) { if (!i.plateNumber.trim()) throw new BadRequestException('Plate number cannot be empty'); v.plateNumber = i.plateNumber.trim().toUpperCase(); }
    const ch = clean(i.chassisNo); if (ch !== undefined) v.chassisNo = ch;
    const mo = clean(i.motorNo); if (mo !== undefined) v.motorNo = mo;
    const co = clean(i.color); if (co !== undefined) v.color = co as any;
    try { return await repo.save(v); } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('That plate, chassis or motor number is already used by another vehicle');
      throw e;
    }
  }

  /** Removes a vehicle from service for good (stolen beyond recovery, scrapped). Needs a reason; only stock or returned vehicles can be retired. */
  async retireVehicle(user: AuthUser, id: string, reason?: string) {
    if (!reason?.trim() || reason.trim().length < 3) throw new BadRequestException('A reason is required to retire a vehicle');
    return this.ds.transaction(async (m) => {
      const [v] = await m.query(`SELECT id, lifecycle_status FROM vehicles WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [id, user.organizationId]);
      if (!v) throw new NotFoundException('Vehicle not found');
      assertTransition('Vehicle', VEHICLE_TRANSITIONS, v.lifecycle_status, VehicleLifecycle.RETIRED);
      await m.query(`UPDATE vehicles SET lifecycle_status='retired' WHERE id=$1`, [id]);
      await m.query(`INSERT INTO write_offs (organization_id, vehicle_id, units, reason, created_by) VALUES ($1,$2,1,$3,$4)`, [user.organizationId, id, reason.trim(), user.sub]);
      return { id, lifecycleStatus: 'retired' };
    });
  }

  /**
   * Registers received units as vehicles (lifecycle in_stock). Without `counts` every outstanding unit is registered.
   * Plates are placeholders (UNIT-<ref>-<n>) until the real registration plate is entered.
   */
  async receive(orgId: string, id: string, counts?: { lineId: string; count: number }[]) {
    return this.ds.transaction(async (m) => {
      const c = await m.getRepository(Consignment).findOne({ where: { id, organizationId: orgId }, relations: { lines: true } });
      if (!c) throw new NotFoundException('Consignment not found');
      if (c.status !== ConsignmentStatus.CLEARED && c.status !== ConsignmentStatus.RECEIVED) {
        throw new ConflictException(`Units can be received only after the goods are cleared (status is "${c.status}")`);
      }
      const lines = await m.getRepository(ConsignmentLine).createQueryBuilder('l').setLock('pessimistic_write').where('l.consignment_id=:id', { id }).getMany();
      const modelRows = await m.getRepository(VehicleModel).findByIds(lines.map((l) => l.vehicleModelId));
      const models = new Map(modelRows.map((x) => [x.id, x]));
      const [{ n }] = await m.query(`SELECT COUNT(*)::int AS n FROM vehicles WHERE consignment_line_id = ANY($1::uuid[])`, [lines.map((l) => l.id)]);
      let seq: number = n;
      const created: string[] = [];
      for (const l of lines) {
        const outstanding = l.quantity - l.unitsRegistered - l.unitsWrittenOff;
        const wanted = counts ? (counts.find((x) => x.lineId === l.id)?.count ?? 0) : outstanding;
        if (!Number.isInteger(wanted) || wanted < 0) throw new BadRequestException('Counts must be whole numbers');
        if (wanted > outstanding) throw new ConflictException(`Line ${l.id}: only ${outstanding} unit(s) outstanding, cannot register ${wanted}`);
        const model = models.get(l.vehicleModelId);
        for (let k = 0; k < wanted; k++) {
          seq += 1;
          const v = await m.getRepository(Vehicle).save(m.getRepository(Vehicle).create({
            organizationId: orgId, plateNumber: `UNIT-${c.reference}-${String(seq).padStart(3, '0')}`,
            make: model?.brand, model: model?.name, vehicleModelId: l.vehicleModelId, consignmentLineId: l.id,
            lifecycleStatus: VehicleLifecycle.IN_STOCK, fuelType: 'electric', odometer: 0,
          }));
          created.push(v.id);
        }
        if (wanted > 0) await m.query(`UPDATE consignment_lines SET units_registered = units_registered + $1 WHERE id=$2`, [wanted, l.id]);
      }
      const [{ open }] = await m.query(`SELECT COALESCE(SUM(quantity - units_registered - units_written_off),0)::int AS open FROM consignment_lines WHERE consignment_id=$1`, [id]);
      if (open === 0 && c.status !== ConsignmentStatus.RECEIVED) {
        await m.query(`UPDATE consignments SET status='received', received_at=CURRENT_DATE WHERE id=$1`, [id]);
      }
      return { consignmentId: id, registered: created.length, vehicleIds: created, outstanding: open };
    });
  }

  /** Landed cost against what the units have sold for. Prices come from contracts, never from list price. */
  async profitability(orgId: string, id: string) {
    const c = await this.get(orgId, id);
    const [row] = await this.ds.query(
      `SELECT COUNT(v.id)::int AS units,
              COUNT(sc.id)::int AS units_sold,
              COALESCE(SUM(sc.price_pesewas),0) AS revenue
         FROM vehicles v
         JOIN consignment_lines l ON l.id = v.consignment_line_id
         LEFT JOIN sale_contracts sc ON sc.vehicle_id = v.id AND sc.status IN ('active','completed','defaulted')
        WHERE l.consignment_id = $1`, [id]);
    const goods = (c.lines ?? []).reduce((n, l) => n + l.quantity * l.unitCostPesewas, 0);
    const totalCost = goods + c.landedCostPesewas;
    const unitsOrdered = (c.lines ?? []).reduce((n, l) => n + l.quantity, 0);
    const revenue = Number(row.revenue);
    return {
      reference: c.reference, unitsOrdered, unitsRegistered: row.units, unitsSold: row.units_sold,
      goodsCostPesewas: goods, landedCostPesewas: c.landedCostPesewas, totalCostPesewas: totalCost,
      revenueContractedPesewas: revenue,
      costPerUnitPesewas: unitsOrdered ? Math.round(totalCost / unitsOrdered) : 0,
      marginPesewas: revenue - Math.round(unitsOrdered ? (totalCost * row.units_sold) / unitsOrdered : 0),
      note: 'Margin compares contracted revenue with the cost of only the units sold so far.',
    };
  }
}
