import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../common/auth/auth-user';
import { BusinessReportsService } from '../finance/business-reports.service';
import { todayAccra, monthRange } from '../../common/dates/dates';

/** Money columns come back from Postgres as strings; the portals return numbers. */
const num = <T extends Record<string, any>>(row: T): T => {
  const out: Record<string, any> = { ...row };
  for (const k of Object.keys(out)) if (/Pesewas$/.test(k) && out[k] != null) out[k] = Number(out[k]);
  return out as T;
};

/** What an investor or a rider sees after signing in: only their own records. */
@Injectable()
export class PortalService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly reports: BusinessReportsService) {}

  async investor(user: AuthUser) {
    const owners = await this.ds.query(`SELECT id, name, phone, owner_type AS "ownerType", kyc_status AS "kycStatus" FROM owners WHERE user_id=$1 AND organization_id=$2`, [user.sub, user.organizationId]);
    if (!owners.length) throw new NotFoundException('No investor record is linked to this login');
    const ids = owners.map((o: any) => o.id);
    const vehicles = await this.ds.query(
      `SELECT v.id, v.plate_number AS "plateNumber", v.lifecycle_status AS "lifecycleStatus", vm.brand, vm.name AS model, vm.vehicle_type AS "vehicleType"
         FROM vehicles v LEFT JOIN vehicle_models vm ON vm.id=v.vehicle_model_id WHERE v.owner_id = ANY($1) ORDER BY v.plate_number`, [ids]);
    const contracts = await this.ds.query(
      `SELECT c.id, c.contract_no AS "contractNo", c.mode, c.status, c.price_pesewas AS "pricePesewas", c.deposit_pesewas AS "depositPesewas", c.start_date::text AS "startDate",
              COALESCE((SELECT SUM(paid_pesewas) FROM installments WHERE contract_id=c.id),0) + c.deposit_pesewas AS "paidPesewas",
              COALESCE((SELECT SUM(amount_pesewas - paid_pesewas) FROM installments WHERE contract_id=c.id),0) AS "outstandingPesewas",
              (SELECT MIN(due_date)::text FROM installments WHERE contract_id=c.id AND paid_pesewas < amount_pesewas) AS "nextDue"
         FROM sale_contracts c WHERE c.owner_id = ANY($1) AND c.status <> 'cancelled' ORDER BY c.created_at DESC`, [ids]);
    const payments = await this.ds.query(
      `SELECT purpose, direction, amount_pesewas AS "amountPesewas", method, reference, created_at AS "createdAt" FROM business_payments WHERE party_type='owner' AND party_id = ANY($1) ORDER BY created_at DESC LIMIT 100`, [ids]);
    const { from, to } = monthRange(todayAccra());
    const statements: unknown[] = [];
    for (const id of ids) statements.push(await this.reports.ownerStatement(user, id, from, to));
    return { owners, vehicles, contracts: contracts.map(num), payments: payments.map(num), statementPeriod: { from, to }, statements };
  }

  async rider(user: AuthUser) {
    const [r] = await this.ds.query(
      `SELECT r.id, r.full_name AS "fullName", r.phone, r.status, r.assigned_vehicle_id AS "vehicleId", v.plate_number AS "plateNumber", h.name AS "hubName"
         FROM riders r LEFT JOIN vehicles v ON v.id=r.assigned_vehicle_id LEFT JOIN hubs h ON h.id=r.hub_id WHERE r.user_id=$1 AND r.organization_id=$2`, [user.sub, user.organizationId]);
    if (!r) throw new NotFoundException('No rider record is linked to this login');
    const [assignment] = await this.ds.query(
      `SELECT daily_target_pesewas AS "dailyTargetPesewas", daily_remittance_pesewas AS "dailyRemittancePesewas", service_fee_pesewas AS "serviceFeePesewas", start_date::text AS "startDate"
         FROM rider_assignments WHERE rider_id=$1 AND end_date IS NULL ORDER BY start_date DESC LIMIT 1`, [r.id]);
    const settlements = await this.ds.query(
      `SELECT settlement_date::text AS date, gross_collected_pesewas AS "grossCollectedPesewas", charge_fee_pesewas AS "chargeFeePesewas", remittance_due_pesewas AS "remittanceDuePesewas",
              remittance_paid_pesewas AS "remittancePaidPesewas", service_fee_pesewas AS "serviceFeePesewas", chop_pesewas AS "chopPesewas", shortfall_pesewas AS "shortfallPesewas", status
         FROM daily_settlements WHERE rider_id=$1 AND is_current=true ORDER BY settlement_date DESC LIMIT 14`, [r.id]);
    const [{ chop }] = await this.ds.query(
      `SELECT COALESCE(SUM(CASE WHEN e.direction='credit' THEN e.amount_pesewas ELSE -e.amount_pesewas END),0) AS chop
         FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id WHERE a.code='rider_chop' AND a.owner_type='rider' AND a.owner_id=$1`, [r.id]);
    const [lock] = r.vehicleId ? await this.ds.query(`SELECT state, grace_period_hours AS "graceHours", grace_period_started_at AS "graceStartedAt", immobilized_at AS "lockedAt" FROM immobilizer_state WHERE vehicle_id=$1`, [r.vehicleId]) : [];
    const [{ owed }] = await this.ds.query(`SELECT COALESCE(SUM(shortfall_pesewas),0) AS owed FROM daily_settlements WHERE rider_id=$1 AND is_current=true AND status='shortfall'`, [r.id]);
    return { rider: r, assignment: assignment ? num(assignment) : null, settlements: settlements.map(num), chopBalancePesewas: Number(chop), shortfallOwedPesewas: Number(owed), vehicleState: lock ?? { state: 'none' } };
  }

  assertRole(user: AuthUser, role: string) { if (user.role !== role && user.role !== 'org_admin' && user.role !== 'super_admin') throw new ForbiddenException(); }
}
