/**
 * Runs the business layer against a REAL Postgres (database "vtrack_test", created by scripts/setup-test-db.sh).
 * It never touches the development database. Services are built directly, so Redis and MQTT are not needed.
 */
process.env.DB_DATABASE = process.env.TEST_DB_DATABASE ?? 'vtrack_test';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AuthUser } from '../../src/common/auth/auth-user';
import { Role } from '../../src/common/constants/roles.constant';
import { Hub } from '../../src/modules/hubs/entities/hub.entity';
import { Owner } from '../../src/modules/contracts/entities/owner.entity';
import { DataScopeService } from '../../src/modules/hubs/data-scope.service';
import { ConsignmentsService } from '../../src/modules/consignments/consignments.service';
import { OwnersService } from '../../src/modules/contracts/owners.service';
import { ContractsService } from '../../src/modules/contracts/contracts.service';
import { OperationsService } from '../../src/modules/operations/operations.service';
import { LedgerService } from '../../src/modules/finance/ledger.service';
import { SettlementsService, SETTLEMENT_SHORTFALL_EVENT } from '../../src/modules/finance/settlements.service';
import { BusinessReportsService } from '../../src/modules/finance/business-reports.service';
import { VehicleType } from '../../src/modules/consignments/entities/vehicle-model.entity';
import { ConsignmentStatus } from '../../src/common/lifecycle/transitions';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ds: DataSource = require('../../src/config/typeorm.config').default;

const DATE = '2026-11-03';
const TAG = String(Math.floor(Math.random() * 1e6)).padStart(6, '0'); // phone numbers are unique across the database
const REF = `CN-${randomUUID().slice(0, 6).toUpperCase()}`; // plates are unique across the database, so each run needs its own
let orgId: string;
let admin: AuthUser;
let hubMgr: AuthUser;
let investor: AuthUser;
let otherMgr: AuthUser;
let hubId: string;
let otherHubId: string;
let scope: DataScopeService;
let consignments: ConsignmentsService;
let owners: OwnersService;
let contracts: ContractsService;
let ops: OperationsService;
let ledger: LedgerService;
let settlements: SettlementsService;
let reports: BusinessReportsService;
const events = new EventEmitter2();

async function mkUser(role: Role, label: string): Promise<AuthUser> {
  const id = randomUUID();
  await ds.query(`INSERT INTO users (id, organization_id, email, password_hash, role) VALUES ($1,$2,$3,'x',$4)`, [id, orgId, `${label}-${id}@test.local`, role]);
  return { sub: id, email: `${label}@test.local`, organizationId: orgId, role };
}

async function rejects(p: Promise<unknown>, status?: number) {
  try { await p; } catch (e: any) {
    if (status) expect(e.getStatus?.() ?? e.status).toBe(status);
    return e;
  }
  throw new Error('Expected the call to be rejected, but it succeeded');
}

beforeAll(async () => {
  await ds.initialize();
  orgId = randomUUID();
  await ds.query(`INSERT INTO organizations (id, name, slug) VALUES ($1,'Test Org',$2)`, [orgId, `t-${orgId.slice(0, 8)}`]);
  admin = await mkUser(Role.ORG_ADMIN, 'admin');
  hubMgr = await mkUser(Role.HUB_MANAGER, 'mgr');
  otherMgr = await mkUser(Role.HUB_MANAGER, 'mgr2');
  investor = await mkUser(Role.INVESTOR, 'inv');
  hubId = (await ds.getRepository(Hub).save(ds.getRepository(Hub).create({ organizationId: orgId, name: 'Madina Hub', region: 'Greater Accra', managerUserId: hubMgr.sub }))).id;
  otherHubId = (await ds.getRepository(Hub).save(ds.getRepository(Hub).create({ organizationId: orgId, name: 'Kumasi Hub', region: 'Ashanti', managerUserId: otherMgr.sub }))).id;

  scope = new DataScopeService(ds.getRepository(Hub), ds.getRepository(Owner));
  ledger = new LedgerService(ds);
  consignments = new ConsignmentsService(ds);
  owners = new OwnersService(ds.getRepository(Owner));
  contracts = new ContractsService(ds, ledger);
  ops = new OperationsService(ds, scope);
  settlements = new SettlementsService(ds, ledger, scope, events);
  reports = new BusinessReportsService(ds, scope);
});

afterAll(async () => { await ds.destroy(); });

describe('full business flow', () => {
  let modelId: string;
  let consignmentId: string;
  let vehicleIds: string[];
  let ownerId: string;
  let contractId: string;
  let riderId: string;
  let rider2Id: string;
  let assignmentId: string;

  it('imports a container and registers units into stock', async () => {
    const m = await consignments.createModel(orgId, { brand: 'Huodi', name: 'HD-72V Cargo', vehicleType: VehicleType.EBIKE, listPricePesewas: 1_500_000 });
    modelId = m.id;
    const c = await consignments.create(orgId, admin.sub, { reference: REF, supplierName: 'Huodi Ltd', lines: [{ vehicleModelId: modelId, quantity: 3, unitCostPesewas: 1_000_000 }], landedCostPesewas: 300_000 });
    consignmentId = c.id;
    await rejects(consignments.create(orgId, admin.sub, { reference: REF, lines: [{ vehicleModelId: modelId, quantity: 1, unitCostPesewas: 1 }] }), 409);
    await rejects(consignments.receive(orgId, consignmentId), 409); // not cleared yet
    await consignments.advance(orgId, consignmentId, ConsignmentStatus.SHIPPED);
    await consignments.advance(orgId, consignmentId, ConsignmentStatus.AT_PORT);
    await rejects(consignments.advance(orgId, consignmentId, ConsignmentStatus.RECEIVED), 400);
    await consignments.advance(orgId, consignmentId, ConsignmentStatus.CLEARED);
    const lineId = (await consignments.get(orgId, consignmentId)).lines![0].id;
    const first = await consignments.receive(orgId, consignmentId, [{ lineId, count: 2 }]);
    expect(first.registered).toBe(2);
    expect(first.outstanding).toBe(1);
    await rejects(consignments.advance(orgId, consignmentId, ConsignmentStatus.CLOSED), 400); // cannot close before everything is received (BR14)
    await rejects(consignments.receive(orgId, consignmentId, [{ lineId, count: 5 }]), 409); // more than outstanding
    const second = await consignments.receive(orgId, consignmentId);
    expect(second.registered).toBe(1);
    expect((await consignments.get(orgId, consignmentId)).status).toBe('received');
    vehicleIds = [...first.vehicleIds, ...second.vehicleIds];
    const plates = await ds.query(`SELECT plate_number, lifecycle_status FROM vehicles WHERE id = ANY($1) ORDER BY plate_number`, [vehicleIds]);
    expect(plates.map((p: any) => p.plate_number)).toEqual([`UNIT-${REF}-001`, `UNIT-${REF}-002`, `UNIT-${REF}-003`]);
    expect(plates.every((p: any) => p.lifecycle_status === 'in_stock')).toBe(true);
  });

  it('encrypts owner secrets and never returns them', async () => {
    const o: any = await owners.create(orgId, { name: 'Ama Mensah', phone: `0244${TAG}`, momoNumber: `0244${TAG}`, idDocument: 'GHA-123456789-0', kycStatus: 'verified', userId: investor.sub });
    ownerId = o.id;
    expect(o.momoNumberEnc).toBeUndefined();
    expect(o.idDocumentEnc).toBeUndefined();
    expect(o.momoNumberMasked).toMatch(/\*/);
    expect(o.momoNumberMasked).not.toBe(`0244${TAG}`);
    const [raw] = await ds.query(`SELECT momo_number_enc, id_document_enc, id_document_last4 FROM owners WHERE id=$1`, [ownerId]);
    expect(raw.momo_number_enc).toMatch(/^v1:/);
    expect(raw.id_document_enc).not.toContain('123456789');
    expect(raw.id_document_last4).toBe('89-0');
    await rejects(owners.create(orgId, { name: 'Dup', phone: `0244${TAG}` }), 409);
  });

  it('creates and activates a lease contract', async () => {
    await rejects(contracts.create(admin, { ownerId, vehicleId: vehicleIds[0], mode: 'lease', pricePesewas: 500_000, depositPesewas: 0, termWeeks: 10 }), 409); // below cost (BR15)
    const c = await contracts.create(admin, { ownerId, vehicleId: vehicleIds[0], mode: 'lease', pricePesewas: 1_500_000, depositPesewas: 300_000, termWeeks: 12, startDate: '2026-10-01' });
    contractId = c.id;
    expect(c.status).toBe('draft');
    const active: any = await contracts.activate(admin, contractId);
    expect(active.status).toBe('active');
    expect(active.installments).toHaveLength(12);
    expect(active.totalInstallmentsPesewas).toBe(1_200_000);
    const [v] = await ds.query(`SELECT lifecycle_status, owner_id FROM vehicles WHERE id=$1`, [vehicleIds[0]]);
    expect(v).toEqual({ lifecycle_status: 'sold', owner_id: ownerId });
    await rejects(contracts.create(admin, { ownerId, vehicleId: vehicleIds[0], mode: 'outright', pricePesewas: 1_500_000 }), 409); // already sold
    await rejects(contracts.activate(admin, contractId), 409);
  });

  it('records payments once, oldest first, and refuses overpayment', async () => {
    const r1 = await contracts.recordPayment(admin, contractId, { amountPesewas: 150_000, reference: 'MOMO-1' });
    expect(r1.duplicate).toBe(false);
    const again = await contracts.recordPayment(admin, contractId, { amountPesewas: 150_000, reference: 'MOMO-1' });
    expect(again.duplicate).toBe(true);
    const view: any = await contracts.get(orgId, contractId, { all: true, hubIds: [], ownerIds: [], role: Role.ORG_ADMIN });
    expect(view.paidPesewas).toBe(150_000);
    expect(view.installments[0].paidPesewas).toBe(100_000);
    expect(view.installments[1].paidPesewas).toBe(50_000);
    await rejects(contracts.recordPayment(admin, contractId, { amountPesewas: 5_000_000, reference: 'MOMO-BIG' }), 409);
    await rejects(contracts.recordPayment(admin, contractId, { amountPesewas: 100, reference: '' }), 400);
    const [{ n }] = await ds.query(`SELECT COUNT(*)::int n FROM ledger_transactions WHERE organization_id=$1 AND reference LIKE 'contract-payment:%'`, [orgId]);
    expect(n).toBe(1);
  });

  it('assigns riders with one-rider-one-vehicle enforced', async () => {
    riderId = (await ops.createRider(hubMgr, { fullName: 'Kofi Boateng', phone: `0551${TAG}`, hubId })).id;
    rider2Id = (await ops.createRider(hubMgr, { fullName: 'Yaw Owusu', phone: `0552${TAG}`, hubId })).id;
    await rejects(ops.createRider(hubMgr, { fullName: 'Wrong Hub', phone: `0553${TAG}`, hubId: otherHubId }), 403);
    await rejects(ops.assign(hubMgr, { riderId, vehicleId: vehicleIds[1] }), 409); // not sold yet
    // sell a second vehicle (outright, fully paid) so it can be assigned
    const c2 = await contracts.create(admin, { ownerId, vehicleId: vehicleIds[1], mode: 'outright', pricePesewas: 1_400_000, depositPesewas: 1_400_000 });
    const done: any = await contracts.activate(admin, c2.id);
    expect(done.status).toBe('completed');

    const a = await ops.assign(hubMgr, { riderId, vehicleId: vehicleIds[0], dailyRemittancePesewas: 3_000, serviceFeePesewas: 500, dailyTargetPesewas: 8_000, startDate: '2026-11-01' });
    assignmentId = a.id;
    await rejects(ops.assign(hubMgr, { riderId: rider2Id, vehicleId: vehicleIds[0] }), 409); // vehicle already has a rider
    await rejects(ops.assign(hubMgr, { riderId, vehicleId: vehicleIds[1] }), 409); // rider already has a vehicle
    await ops.assign(hubMgr, { riderId: rider2Id, vehicleId: vehicleIds[1], dailyRemittancePesewas: 3_000, serviceFeePesewas: 500, startDate: '2026-11-01' });
    const [r] = await ds.query(`SELECT assigned_vehicle_id, daily_target_amount FROM riders WHERE id=$1`, [riderId]);
    expect(r.assigned_vehicle_id).toBe(vehicleIds[0]);
    expect(Number(r.daily_target_amount)).toBe(30);
  });

  it('handles batteries, swaps and charging', async () => {
    const b1 = await ops.createBattery(admin, { serialNo: 'BAT-1', hubId });
    const b2 = await ops.createBattery(admin, { serialNo: 'BAT-2', hubId });
    const b3 = await ops.createBattery(admin, { serialNo: 'BAT-3', hubId });
    await ops.fit(hubMgr, b1.id, vehicleIds[0]);
    await rejects(ops.fit(hubMgr, b2.id, vehicleIds[0]), 409); // vehicle already has one
    await ops.swap(hubMgr, { vehicleId: vehicleIds[0], batteryInId: b2.id, riderId });
    const after = await ds.query(`SELECT serial_no, status, current_vehicle_id FROM batteries WHERE organization_id=$1 ORDER BY serial_no`, [orgId]);
    expect(after.find((b: any) => b.serial_no === 'BAT-1')).toMatchObject({ status: 'charging', current_vehicle_id: null });
    expect(after.find((b: any) => b.serial_no === 'BAT-2')).toMatchObject({ status: 'fitted', current_vehicle_id: vehicleIds[0] });
    await rejects(ops.swap(hubMgr, { vehicleId: vehicleIds[0], batteryInId: b1.id }), 409); // BAT-1 is charging, not available
    // DB-level: a battery cannot be on two vehicles even if the service check is bypassed
    await rejects(ds.query(`UPDATE batteries SET current_vehicle_id=$1 WHERE serial_no='BAT-3' AND organization_id=$2`, [vehicleIds[0], orgId]));

    const ev = await ops.startCharge(hubMgr, { batteryId: b1.id, riderId });
    await rejects(ops.startCharge(hubMgr, { batteryId: b1.id }), 409);
    const done = await ops.finishCharge(hubMgr, ev.id, { kwh: 7.2, feePesewas: 1_000 });
    expect(done.status).toBe('completed');
    const [bat] = await ds.query(`SELECT status FROM batteries WHERE id=$1`, [b1.id]);
    expect(bat.status).toBe('available');
    void b3;
  });

  it('settles a day: collections, deductions, ledger', async () => {
    await ds.query(`UPDATE charge_events SET charge_date=$1 WHERE organization_id=$2`, [DATE, orgId]);
    await ops.recordCollection(hubMgr, { riderId, amountPesewas: 5_000, date: DATE, reference: 'RCPT-1' });
    const dup: any = await ops.recordCollection(hubMgr, { riderId, amountPesewas: 5_000, date: DATE, reference: 'RCPT-1' });
    expect(dup.duplicate).toBe(true);
    await ops.recordCollection(hubMgr, { riderId, amountPesewas: 3_000, date: DATE, source: 'momo', reference: 'RCPT-2' });

    const out = await settlements.calculate(hubMgr, { date: DATE, hubId });
    const mine = out.find((o) => o.riderId === riderId)!;
    expect(mine.version).toBe(1);
    expect(mine.status).toBe('settled');
    const [s] = await ds.query(`SELECT * FROM daily_settlements WHERE id=$1`, [mine.settlementId]);
    expect(Number(s.gross_collected_pesewas)).toBe(8_000);
    expect(Number(s.charge_fee_pesewas)).toBe(1_000);
    expect(Number(s.remittance_paid_pesewas)).toBe(3_000);
    expect(Number(s.service_fee_pesewas)).toBe(500);
    expect(Number(s.chop_pesewas)).toBe(3_500);
    expect(Number(s.net_to_owner_pesewas)).toBe(3_000);

    expect(await ledger.balance(orgId, { code: 'rider_chop', ownerType: 'rider', ownerId: riderId })).toBe(3_500);
    expect(await ledger.balance(orgId, { code: 'rider_account', ownerType: 'rider', ownerId: riderId })).toBe(0);
    expect(await ledger.balance(orgId, { code: 'owner_account', ownerType: 'owner', ownerId })).toBe(3_000);
    expect(await ledger.balance(orgId, { code: 'hub_collections', ownerType: 'hub', ownerId: hubId })).toBe(8_000);
    const tb = await ledger.trialBalance(orgId);
    expect(tb.balanced).toBe(true);

    // the charge event is now billed
    const [ce] = await ds.query(`SELECT status, settlement_id FROM charge_events WHERE organization_id=$1 AND fee_pesewas > 0`, [orgId]);
    expect(ce).toMatchObject({ status: 'billed', settlement_id: mine.settlementId });
  });

  it('recalculates with versioning and a reversal, never editing history', async () => {
    await ops.recordCollection(hubMgr, { riderId, amountPesewas: 2_000, date: DATE, reference: 'RCPT-3' });
    const before = (await ledger.trialBalance(orgId)).accounts.length;
    const out = await settlements.calculate(hubMgr, { date: DATE, riderId });
    expect(out[0].version).toBe(2);
    const cur = await ds.query(`SELECT version, chop_pesewas FROM daily_settlements WHERE rider_id=$1 AND settlement_date=$2 AND is_current`, [riderId, DATE]);
    expect(cur).toHaveLength(1);
    expect(cur[0].version).toBe(2);
    expect(Number(cur[0].chop_pesewas)).toBe(5_500);
    const all = await ds.query(`SELECT COUNT(*)::int n FROM daily_settlements WHERE rider_id=$1 AND settlement_date=$2`, [riderId, DATE]);
    expect(all[0].n).toBe(2);
    expect(await ledger.balance(orgId, { code: 'rider_chop', ownerType: 'rider', ownerId: riderId })).toBe(5_500);
    expect(await ledger.balance(orgId, { code: 'owner_account', ownerType: 'owner', ownerId })).toBe(3_000);
    const [{ n }] = await ds.query(`SELECT COUNT(*)::int n FROM ledger_transactions WHERE organization_id=$1 AND kind='reversal'`, [orgId]);
    expect(n).toBe(1);
    expect((await ledger.trialBalance(orgId)).balanced).toBe(true);
    expect(before).toBeGreaterThan(0);
  });

  it('flags a shortfall and emits the event', async () => {
    const seen: any[] = [];
    events.on(SETTLEMENT_SHORTFALL_EVENT, (e) => seen.push(e));
    await ops.recordCollection(hubMgr, { riderId: rider2Id, amountPesewas: 1_200, date: DATE, reference: 'RCPT-4' });
    const out = await settlements.calculate(hubMgr, { date: DATE, riderId: rider2Id });
    expect(out[0].status).toBe('shortfall');
    expect(out[0].shortfallPesewas).toBe(1_800);
    expect(seen).toHaveLength(1);
    const [s] = await ds.query(`SELECT chop_pesewas, remittance_paid_pesewas FROM daily_settlements WHERE rider_id=$1 AND is_current`, [rider2Id]);
    expect(Number(s.chop_pesewas)).toBe(0);
    expect(Number(s.remittance_paid_pesewas)).toBe(1_200);
  });

  it('reports the hub day', async () => {
    const r = await reports.hubDailyClose(hubMgr, hubId, DATE);
    expect(r.riders).toBe(2);
    expect(r.totals.grossCollected).toBe(10_000 + 1_200);
    expect(r.shortfalls).toHaveLength(1);
    await rejects(reports.hubDailyClose(hubMgr, otherHubId, DATE), 403);
    const week = await reports.periodSummary(hubMgr, 'week', DATE, hubId);
    expect(week.from).toBe('2026-11-02');
    expect(week.totals.grossCollected).toBe(11_200);
    const month = await reports.periodSummary(admin, 'month', DATE);
    expect(month.to).toBe('2026-11-30');
    const stmt = await reports.riderStatement(hubMgr, riderId, '2026-11-01', '2026-11-30');
    expect(stmt.totals.chop).toBe(5_500);
    const own = await reports.ownerStatement(investor, ownerId, '2026-11-01', '2026-11-30');
    expect(own.totals.netToOwner).toBeGreaterThan(0);
    expect(own.contracts.length).toBe(2);
  });

  it('closes a day and then refuses changes to it', async () => {
    const [cur] = await ds.query(`SELECT id FROM daily_settlements WHERE rider_id=$1 AND is_current`, [riderId]);
    await rejects(settlements.close(otherMgr, cur.id), 403);
    const closed = await settlements.close(hubMgr, cur.id);
    expect(closed.status).toBe('closed');
    await rejects(ops.recordCollection(hubMgr, { riderId, amountPesewas: 100, date: DATE, reference: 'LATE' }), 409);
    const again = await settlements.calculate(hubMgr, { date: DATE, riderId });
    expect(again[0].skipped).toBe('closed');
  });

  it('limits what each role can see', async () => {
    expect((await ops.listRiders(hubMgr, {})).length).toBe(2);
    expect((await ops.listRiders(otherMgr, {})).length).toBe(0);
    await rejects(ops.listRiders(otherMgr, { hubId }), 403);
    const invScope = await scope.forUser(investor);
    expect(invScope.ownerIds).toEqual([ownerId]);
    expect((await contracts.list(orgId, invScope, {})).length).toBe(2);
    const noOne = await scope.forUser(await mkUser(Role.INVESTOR, 'inv2'));
    expect(await contracts.list(orgId, noOne, {})).toEqual([]);
    await rejects(contracts.get(orgId, contractId, noOne), 403);
    expect((await settlements.list(investor, { date: DATE })).length).toBeGreaterThan(0);
    expect((await settlements.list(otherMgr, { date: DATE })).length).toBe(0);
  });

  it('defaults and repossesses only through the proper steps', async () => {
    await rejects(contracts.repossess(admin, contractId), 400); // active, not defaulted
    await contracts.markDefaulted(orgId, contractId);
    // arrears report sees it
    const arrears = await reports.arrears(admin);
    expect(arrears.find((a) => a.contractId === contractId)).toBeTruthy();
    await contracts.repossess(admin, contractId);
    const [v] = await ds.query(`SELECT lifecycle_status, owner_id FROM vehicles WHERE id=$1`, [vehicleIds[0]]);
    expect(v).toEqual({ lifecycle_status: 'returned', owner_id: null });
    const [a] = await ds.query(`SELECT status, ended_reason FROM rider_assignments WHERE id=$1`, [assignmentId]);
    expect(a).toEqual({ status: 'ended', ended_reason: 'repossessed' });
    await rejects(contracts.reinstate(orgId, contractId), 409);
  });
});

describe('database-enforced ledger rules', () => {
  it('forbids updating or deleting ledger rows', async () => {
    const [e] = await ds.query(`SELECT id FROM ledger_entries LIMIT 1`);
    expect(e).toBeTruthy();
    await rejects(ds.query(`UPDATE ledger_entries SET amount_pesewas = amount_pesewas + 1 WHERE id=$1`, [e.id]));
    await rejects(ds.query(`DELETE FROM ledger_entries WHERE id=$1`, [e.id]));
    await rejects(ds.query(`UPDATE ledger_transactions SET description='tampered' WHERE organization_id=$1`, [orgId]));
    await rejects(ds.query(`DELETE FROM ledger_transactions WHERE organization_id=$1`, [orgId]));
  });

  it('rejects an unbalanced transaction at commit', async () => {
    const [acc] = await ds.query(`SELECT id FROM ledger_accounts WHERE organization_id=$1 LIMIT 1`, [orgId]);
    await rejects(ds.transaction(async (m) => {
      const [t] = await m.query(`INSERT INTO ledger_transactions (organization_id, reference, kind) VALUES ($1,$2,'test') RETURNING id`, [orgId, `unbalanced-${randomUUID()}`]);
      await m.query(`INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_pesewas) VALUES ($1,$2,'debit',500)`, [t.id, acc.id]);
    }));
  });

  it('refuses a duplicate reference (idempotent posting)', async () => {
    const ref = `dup-${randomUUID()}`;
    const lines = [
      { account: { code: 'hub_collections', ownerType: 'company' as const, ownerId: null }, direction: 'debit' as const, amount: 100 },
      { account: { code: 'company_fees', ownerType: 'company' as const, ownerId: null }, direction: 'credit' as const, amount: 100 },
    ];
    const a = await ds.transaction((m) => ledger.post(m, { organizationId: orgId, reference: ref, kind: 't', lines }));
    const b = await ds.transaction((m) => ledger.post(m, { organizationId: orgId, reference: ref, kind: 't', lines }));
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.transactionId).toBe(a.transactionId);
  });

  it('keeps the whole ledger balanced', async () => {
    const tb = await ledger.trialBalance(orgId);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebits).toBeGreaterThan(0);
  });
});
