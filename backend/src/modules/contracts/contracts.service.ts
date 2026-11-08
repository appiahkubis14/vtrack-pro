import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { Installment, SaleContract } from './entities/sale-contract.entity';
import { allocatePayment, generateSchedule, ScheduleError, summariseArrears, InstallmentState } from './engines/contract-schedule.engine';
import { LedgerService } from '../finance/ledger.service';
import { ACCOUNT, company } from '../finance/engines/ledger.engine';
import { DataScope } from '../hubs/data-scope.service';
import { CONTRACT_TRANSITIONS, ContractStatus, VEHICLE_TRANSITIONS, VehicleLifecycle, assertTransition } from '../../common/lifecycle/transitions';
import { assertPesewas } from '../../common/money/money';
import { assertIsoDate, todayAccra } from '../../common/dates/dates';
import { AuthUser } from '../../common/auth/auth-user';

export interface ContractInput {
  ownerId?: string; vehicleId?: string; mode?: 'outright' | 'lease' | 'work_and_pay';
  pricePesewas?: number; depositPesewas?: number; termWeeks?: number; dailyAmountPesewas?: number;
  startDate?: string; defaultAfterArrearsDays?: number; notes?: string; allowBelowCost?: boolean; gracePeriodHours?: number | null;
}

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly ledger: LedgerService) {}

  async list(orgId: string, scope: DataScope, q: { status?: string; ownerId?: string }) {
    if (!scope.all && scope.ownerIds.length === 0) return [];
    const qb = this.ds.getRepository(SaleContract).createQueryBuilder('c').where('c.organization_id=:org', { org: orgId });
    if (!scope.all) qb.andWhere('c.owner_id = ANY(:ids)', { ids: scope.ownerIds });
    if (q.status) qb.andWhere('c.status=:s', { s: q.status });
    if (q.ownerId) qb.andWhere('c.owner_id=:o', { o: q.ownerId });
    return qb.orderBy('c.created_at', 'DESC').limit(500).getMany();
  }

  async get(orgId: string, id: string, scope: DataScope) {
    const c = await this.ds.getRepository(SaleContract).findOne({ where: { id, organizationId: orgId } });
    if (!c) throw new NotFoundException('Contract not found');
    if (!scope.all && !scope.ownerIds.includes(c.ownerId)) throw new ForbiddenException('You do not have access to this contract');
    const installments = await this.ds.getRepository(Installment).find({ where: { contractId: id }, order: { dueDate: 'ASC' } });
    const states = installments.map((i) => ({ id: i.id, dueDate: i.dueDate, amount: i.amountPesewas, paid: i.paidPesewas }));
    const paid = installments.reduce((n, i) => n + i.paidPesewas, 0);
    const total = installments.reduce((n, i) => n + i.amountPesewas, 0);
    return { ...c, installments, totalInstallmentsPesewas: total, paidPesewas: paid, outstandingPesewas: total - paid, arrears: summariseArrears(states, todayAccra()) };
  }

  async create(user: AuthUser, i: ContractInput) {
    const orgId = user.organizationId;
    if (!i.ownerId || !i.vehicleId || !i.mode) throw new BadRequestException('A contract needs ownerId, vehicleId and mode');
    if (!['outright', 'lease', 'work_and_pay'].includes(i.mode)) throw new BadRequestException('mode must be outright, lease or work_and_pay');
    const price = assertPesewas(i.pricePesewas, 'pricePesewas', { min: 1 });
    const deposit = assertPesewas(i.depositPesewas ?? 0, 'depositPesewas', { min: 0 });
    const startDate = assertIsoDate(i.startDate ?? todayAccra(), 'startDate');
    if (i.gracePeriodHours != null && (!Number.isInteger(i.gracePeriodHours) || i.gracePeriodHours < 1 || i.gracePeriodHours > 168)) throw new BadRequestException('gracePeriodHours must be a whole number from 1 to 168');
    try {
      generateSchedule({ mode: i.mode, price, deposit, termWeeks: i.termWeeks, dailyAmount: i.dailyAmountPesewas, startDate });
    } catch (e) {
      if (e instanceof ScheduleError) throw new BadRequestException(e.message);
      throw e;
    }
    const [owner] = await this.ds.query(`SELECT id, is_active FROM owners WHERE id=$1 AND organization_id=$2`, [i.ownerId, orgId]);
    if (!owner) throw new BadRequestException('Owner not found');
    if (!owner.is_active) throw new ConflictException('This owner is inactive');
    const [vehicle] = await this.ds.query(`SELECT id, lifecycle_status, consignment_line_id FROM vehicles WHERE id=$1 AND organization_id=$2`, [i.vehicleId, orgId]);
    if (!vehicle) throw new BadRequestException('Vehicle not found');
    if (vehicle.lifecycle_status !== VehicleLifecycle.IN_STOCK) throw new ConflictException(`Only vehicles in stock can be sold (this one is "${vehicle.lifecycle_status}")`);

    // Rule BR15: not below landed cost unless an admin explicitly allows it.
    const cost = await this.unitCost(vehicle.consignment_line_id);
    if (cost !== null && price < cost && !(i.allowBelowCost && ['super_admin', 'org_admin'].includes(user.role))) {
      throw new ConflictException(`Price is below the unit cost of GHS ${(cost / 100).toFixed(2)}. An administrator must set allowBelowCost to proceed.`);
    }

    const repo = this.ds.getRepository(SaleContract);
    const contractNo = await this.nextContractNo(orgId);
    return repo.save(repo.create({
      organizationId: orgId, contractNo, ownerId: i.ownerId, vehicleId: i.vehicleId, mode: i.mode, pricePesewas: price, depositPesewas: deposit,
      termWeeks: i.termWeeks ?? null, dailyAmountPesewas: i.dailyAmountPesewas ?? null, startDate,
      gracePeriodHours: i.gracePeriodHours ?? null, defaultAfterArrearsDays: i.defaultAfterArrearsDays ?? 14, notes: i.notes ?? null, createdBy: user.sub,
    }));
  }

  /**
   * Edits a contract. A draft can change any commercial term (the vehicle cannot change: cancel and create a new one).
   * Once it is running only the grace period, the arrears limit and the notes can change, because the money schedule is already fixed.
   */
  async update(user: AuthUser, id: string, i: ContractInput) {
    const repo = this.ds.getRepository(SaleContract);
    const c = await repo.findOne({ where: { id, organizationId: user.organizationId } });
    if (!c) throw new NotFoundException('Contract not found');
    if (!['draft', 'active', 'defaulted'].includes(c.status)) throw new ConflictException(`A ${c.status} contract cannot be edited`);
    const draft = c.status === 'draft';
    if (!draft) for (const k of ['ownerId', 'mode', 'pricePesewas', 'depositPesewas', 'startDate', 'termWeeks', 'dailyAmountPesewas'] as const) if ((i as any)[k] !== undefined) throw new ConflictException('This contract is already running, so its price and payment plan are fixed. You can change the grace period, the arrears limit and the notes.');
    if (i.gracePeriodHours !== undefined) { if (i.gracePeriodHours !== null && (!Number.isInteger(i.gracePeriodHours) || i.gracePeriodHours < 1 || i.gracePeriodHours > 168)) throw new BadRequestException('gracePeriodHours must be a whole number from 1 to 168'); c.gracePeriodHours = i.gracePeriodHours as any; }
    if (i.defaultAfterArrearsDays !== undefined) { const d = Number(i.defaultAfterArrearsDays); if (!Number.isInteger(d) || d < 1 || d > 365) throw new BadRequestException('The arrears limit must be a whole number of days from 1 to 365'); c.defaultAfterArrearsDays = d; }
    if (i.notes !== undefined) { if (i.notes !== null && String(i.notes).length > 2000) throw new BadRequestException('Notes are too long (most 2000 characters)'); c.notes = i.notes ? String(i.notes) : null; }
    if (draft) {
      if (i.ownerId !== undefined) { const [o] = await this.ds.query(`SELECT id, is_active FROM owners WHERE id=$1 AND organization_id=$2`, [i.ownerId, user.organizationId]); if (!o) throw new BadRequestException('Owner not found'); if (!o.is_active) throw new ConflictException('This owner is inactive'); c.ownerId = i.ownerId; }
      if (i.mode !== undefined) { if (!['outright', 'lease', 'work_and_pay'].includes(i.mode)) throw new BadRequestException('mode must be outright, lease or work_and_pay'); c.mode = i.mode as any; }
      if (i.pricePesewas !== undefined) c.pricePesewas = assertPesewas(i.pricePesewas, 'pricePesewas', { min: 1 });
      if (i.depositPesewas !== undefined) c.depositPesewas = assertPesewas(i.depositPesewas ?? 0, 'depositPesewas', { min: 0 });
      if (i.startDate !== undefined) c.startDate = assertIsoDate(i.startDate, 'startDate') as any;
      if (i.termWeeks !== undefined) c.termWeeks = i.termWeeks ?? null as any;
      if (i.dailyAmountPesewas !== undefined) c.dailyAmountPesewas = i.dailyAmountPesewas ?? null as any;
      try { generateSchedule({ mode: c.mode as any, price: Number(c.pricePesewas), deposit: Number(c.depositPesewas), termWeeks: c.termWeeks ?? undefined, dailyAmount: c.dailyAmountPesewas ?? undefined, startDate: String(c.startDate).slice(0, 10) }); } catch (e) { if (e instanceof ScheduleError) throw new BadRequestException(e.message); throw e; }
      if (i.pricePesewas !== undefined) {
        const [veh] = await this.ds.query(`SELECT consignment_line_id FROM vehicles WHERE id=$1`, [c.vehicleId]); const cost = await this.unitCost(veh?.consignment_line_id ?? null);
        if (cost !== null && Number(c.pricePesewas) < cost && !(i.allowBelowCost && ['super_admin', 'org_admin'].includes(user.role))) throw new ConflictException(`Price is below the unit cost of GHS ${(cost / 100).toFixed(2)}. An administrator must set allowBelowCost to proceed.`);
      }
    }
    return repo.save(c);
  }

  /** Unit cost = goods cost plus an even share of the consignment's landed costs. Null when the vehicle has no consignment. */
  private async unitCost(lineId: string | null): Promise<number | null> {
    if (!lineId) return null;
    const [r] = await this.ds.query(
      `SELECT l.unit_cost_pesewas AS unit, c.landed_cost_pesewas AS landed,
              (SELECT SUM(quantity) FROM consignment_lines WHERE consignment_id = c.id) AS qty
         FROM consignment_lines l JOIN consignments c ON c.id = l.consignment_id WHERE l.id=$1`, [lineId]);
    if (!r) return null;
    return Number(r.unit) + Math.round(Number(r.landed) / Number(r.qty));
  }

  private async nextContractNo(orgId: string): Promise<string> {
    const [{ n }] = await this.ds.query(`SELECT COUNT(*)::int AS n FROM sale_contracts WHERE organization_id=$1`, [orgId]);
    return `VT-C-${new Date().getUTCFullYear()}-${String(n + 1).padStart(5, '0')}`;
  }

  private async lockContract(m: EntityManager, orgId: string, id: string): Promise<SaleContract> {
    const c = await m.getRepository(SaleContract).createQueryBuilder('c').setLock('pessimistic_write').where('c.id=:id AND c.organization_id=:org', { id, org: orgId }).getOne();
    if (!c) throw new NotFoundException('Contract not found');
    return c;
  }

  private async moveVehicle(m: EntityManager, vehicleId: string, to: VehicleLifecycle, patch: { ownerId?: string | null } = {}) {
    const [v] = await m.query(`SELECT lifecycle_status FROM vehicles WHERE id=$1 FOR UPDATE`, [vehicleId]);
    assertTransition('Vehicle', VEHICLE_TRANSITIONS, v.lifecycle_status, to);
    if ('ownerId' in patch) await m.query(`UPDATE vehicles SET lifecycle_status=$1, owner_id=$2 WHERE id=$3`, [to, patch.ownerId, vehicleId]);
    else await m.query(`UPDATE vehicles SET lifecycle_status=$1 WHERE id=$2`, [to, vehicleId]);
  }

  /** Approving a contract: the vehicle becomes the owner's, the schedule is generated and the deposit (if any) is posted. */
  async activate(user: AuthUser, id: string) {
    await this.ds.transaction(async (m) => {
      const c = await this.lockContract(m, user.organizationId, id);
      assertTransition('Contract', CONTRACT_TRANSITIONS, c.status, ContractStatus.ACTIVE);
      if (c.status !== ContractStatus.DRAFT) throw new ConflictException('Only a draft contract can be activated; use reinstate for a defaulted one');
      await this.moveVehicle(m, c.vehicleId, VehicleLifecycle.SOLD, { ownerId: c.ownerId });
      const schedule = generateSchedule({
        mode: c.mode, price: c.pricePesewas, deposit: c.depositPesewas, termWeeks: c.termWeeks ?? undefined,
        dailyAmount: c.dailyAmountPesewas ?? undefined, startDate: c.startDate,
      });
      if (schedule.length) await m.getRepository(Installment).insert(schedule.map((s) => ({ contractId: c.id, dueDate: s.dueDate, amountPesewas: s.amount })));
      if (c.depositPesewas > 0) {
        await this.postReceipt(m, user, c, `contract:${c.id}:deposit`, 'contract_deposit', c.depositPesewas, `Deposit for ${c.contractNo}`);
      }
      const done = schedule.length === 0;
      await m.getRepository(SaleContract).update({ id: c.id }, {
        status: done ? ContractStatus.COMPLETED : ContractStatus.ACTIVE, approvedBy: user.sub, activatedAt: new Date(), closedAt: done ? new Date() : null,
      });
    }).catch((e) => {
      // The partial unique index (one live contract per vehicle) is the final guard against a race.
      if (e?.code === '23505') throw new ConflictException('This vehicle already has a live contract');
      throw e;
    });
    return this.get(user.organizationId, id, { all: true, hubIds: [], ownerIds: [], role: user.role });
  }

  private async postReceipt(m: EntityManager, user: AuthUser, c: SaleContract, reference: string, kind: string, amount: number, description: string, pay: { method?: string; payerName?: string; note?: string } = {}) {
    const method = ['cash', 'momo', 'bank'].includes(pay.method ?? '') ? pay.method : 'cash';
    const tx = await this.postReceiptLedger(m, user, c, reference, kind, amount, description);
    const [o] = await m.query(`SELECT name FROM owners WHERE id=$1`, [c.ownerId]);
    await m.query(
      `INSERT INTO business_payments (organization_id, purpose, direction, amount_pesewas, method, party_type, party_id, party_name, contract_id, reference, ledger_transaction_id, note, recorded_by)
       VALUES ($1,$2,'in',$3,$4,'owner',$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (organization_id, reference) DO NOTHING`,
      [user.organizationId, kind === 'contract_deposit' ? 'deposit' : 'installment', amount, method, c.ownerId, pay.payerName?.trim() || o?.name || null, c.id, reference, tx.transactionId, pay.note ?? null, user.sub]);
    return tx;
  }

  private postReceiptLedger(m: EntityManager, user: AuthUser, c: SaleContract, reference: string, kind: string, amount: number, description: string) {
    return this.ledger.post(m, {
      organizationId: user.organizationId, reference, kind, description, createdBy: user.sub,
      lines: [
        { account: company(ACCOUNT.AGGREGATOR_CLEARING), direction: 'debit', amount },
        { account: company(ACCOUNT.SALES_RECEIPTS), direction: 'credit', amount },
      ],
    });
  }

  /** Records money received. `reference` is the payment's unique id (e.g. the MoMo transaction id): sending it twice changes nothing. */
  async recordPayment(user: AuthUser, id: string, b: { amountPesewas?: number; reference?: string; method?: string; payerName?: string; note?: string }) {
    const amount = assertPesewas(b.amountPesewas, 'amountPesewas', { min: 1 });
    if (!b.reference?.trim()) throw new BadRequestException('A payment needs a unique reference (for example the mobile money transaction id)');
    return this.ds.transaction(async (m) => {
      const c = await this.lockContract(m, user.organizationId, id);
      if (c.status !== ContractStatus.ACTIVE && c.status !== ContractStatus.DEFAULTED) throw new ConflictException(`Payments cannot be recorded on a ${c.status} contract`);
      const reference = `contract-payment:${c.id}:${b.reference!.trim()}`;
      const [dup] = await m.query(`SELECT id FROM ledger_transactions WHERE organization_id=$1 AND reference=$2`, [user.organizationId, reference]);
      if (dup) return { duplicate: true, contractId: c.id };

      const rows = await m.getRepository(Installment).find({ where: { contractId: c.id }, order: { dueDate: 'ASC' } });
      const states: InstallmentState[] = rows.map((r) => ({ id: r.id, dueDate: r.dueDate, amount: r.amountPesewas, paid: r.paidPesewas }));
      const alloc = allocatePayment(states, amount);
      if (alloc.unallocated > 0) throw new ConflictException(`Payment exceeds the outstanding balance by GHS ${(alloc.unallocated / 100).toFixed(2)}`);

      for (const u of alloc.updates) {
        await m.query(`UPDATE installments SET paid_pesewas=$1, paid_at = CASE WHEN $2 THEN NOW() ELSE paid_at END WHERE id=$3`, [u.newPaid, u.fullyPaid, u.id]);
      }
      await this.postReceipt(m, user, c, reference, 'contract_payment', amount, `Payment on ${c.contractNo}`, b);

      const [{ open }] = await m.query(`SELECT COUNT(*)::int AS open FROM installments WHERE contract_id=$1 AND paid_pesewas < amount_pesewas`, [c.id]);
      let status: ContractStatus = c.status;
      if (open === 0) {
        await m.getRepository(SaleContract).update({ id: c.id }, { status: ContractStatus.COMPLETED, closedAt: new Date() });
        status = ContractStatus.COMPLETED;
      }
      return { duplicate: false, contractId: c.id, applied: alloc.updates.length, status };
    });
  }

  async cancel(user: AuthUser, id: string) {
    await this.ds.transaction(async (m) => {
      const c = await this.lockContract(m, user.organizationId, id);
      assertTransition('Contract', CONTRACT_TRANSITIONS, c.status, ContractStatus.CANCELLED);
      if (c.status === ContractStatus.ACTIVE) {
        const [{ paid }] = await m.query(`SELECT COALESCE(SUM(paid_pesewas),0)::bigint AS paid FROM installments WHERE contract_id=$1`, [c.id]);
        if (Number(paid) > 0 || c.depositPesewas > 0) throw new ConflictException('A contract with money received cannot be cancelled; reverse the payments in the ledger first');
        await this.moveVehicle(m, c.vehicleId, VehicleLifecycle.RETURNED, { ownerId: null });
        await this.moveVehicle(m, c.vehicleId, VehicleLifecycle.IN_STOCK);
      }
      await m.getRepository(SaleContract).update({ id: c.id }, { status: ContractStatus.CANCELLED, closedAt: new Date() });
    });
    return this.get(user.organizationId, id, { all: true, hubIds: [], ownerIds: [], role: user.role });
  }

  async markDefaulted(orgId: string, id: string) {
    await this.ds.transaction(async (m) => {
      const c = await this.lockContract(m, orgId, id);
      assertTransition('Contract', CONTRACT_TRANSITIONS, c.status, ContractStatus.DEFAULTED);
      await m.getRepository(SaleContract).update({ id: c.id }, { status: ContractStatus.DEFAULTED });
    });
    return { id, status: ContractStatus.DEFAULTED };
  }

  async reinstate(orgId: string, id: string) {
    await this.ds.transaction(async (m) => {
      const c = await this.lockContract(m, orgId, id);
      if (c.status !== ContractStatus.DEFAULTED) throw new ConflictException('Only a defaulted contract can be reinstated');
      await m.getRepository(SaleContract).update({ id: c.id }, { status: ContractStatus.ACTIVE });
    });
    return { id, status: ContractStatus.ACTIVE };
  }

  /** Repossession is deliberate and administrator-only: it takes the vehicle back and ends any rider assignment. */
  async repossess(user: AuthUser, id: string) {
    await this.ds.transaction(async (m) => {
      const c = await this.lockContract(m, user.organizationId, id);
      assertTransition('Contract', CONTRACT_TRANSITIONS, c.status, ContractStatus.REPOSSESSED);
      await m.query(`UPDATE rider_assignments SET status='ended', end_date=CURRENT_DATE, ended_reason='repossessed' WHERE vehicle_id=$1 AND status='active'`, [c.vehicleId]);
      await m.query(`UPDATE riders SET assigned_vehicle_id=NULL WHERE assigned_vehicle_id=$1`, [c.vehicleId]);
      await this.moveVehicle(m, c.vehicleId, VehicleLifecycle.RETURNED, { ownerId: null });
      await m.getRepository(SaleContract).update({ id: c.id }, { status: ContractStatus.REPOSSESSED, closedAt: new Date() });
    });
    return { id, status: ContractStatus.REPOSSESSED };
  }

  /** Flags contracts whose oldest unpaid installment is older than the contract's allowed arrears. It only flags: repossession stays a person's decision. */
  @Cron('0 1 * * *', { timeZone: 'Africa/Accra' })
  async flagDefaults(): Promise<number> {
    const today = todayAccra();
    const contracts = await this.ds.getRepository(SaleContract).find({ where: { status: ContractStatus.ACTIVE } });
    let flagged = 0;
    for (const c of contracts) {
      const rows = await this.ds.getRepository(Installment).find({ where: { contractId: c.id } });
      const a = summariseArrears(rows.map((r) => ({ id: r.id, dueDate: r.dueDate, amount: r.amountPesewas, paid: r.paidPesewas })), today);
      if (a.arrearsDays >= c.defaultAfterArrearsDays) {
        try { await this.markDefaulted(c.organizationId, c.id); flagged++; } catch (e: any) { this.logger.warn(`Could not flag ${c.contractNo}: ${e.message}`); }
      }
    }
    return flagged;
  }
}
