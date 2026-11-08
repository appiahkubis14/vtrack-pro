# Business rules enforced by the system

Rules are enforced in the database wherever a rule is a hard fact, and again in the service code so people get a readable
message. Rule ids (BR1, BR2...) match the Project Model PDF and the comments in the code.

## Money
- Every amount is whole **pesewas** (GHS 1 = 100 pesewas), stored as `BIGINT`. No floating point anywhere in money code.
- Currency is GHS only (assumption A6).

## The ledger (append-only, double entry)
- Every posting has at least two lines and total debits equal total credits. Checked in code **and** by a deferred
  constraint trigger at commit.
- `UPDATE` and `DELETE` on ledger tables are blocked by a trigger. A mistake is corrected by a **reversing transaction**
  (`POST /ledger/transactions/:id/reverse`, which needs a reason). History is never edited.
- Posting the same `reference` twice for one organisation is a safe no-op, so a retried request cannot double-count (BR6).

## Stock and contracts
- A consignment moves ordered, shipped, at port, cleared, received, closed, one step at a time. Units are registered as vehicles
  in stock when received. A consignment cannot close while any ordered unit is neither registered nor **written off with a
  reason** (BR14). A write-off is permanent and stored in `write_offs`. Consignments can reference a **supplier**.
- A vehicle's real plate, chassis and motor numbers replace the placeholder given at receipt (unique, edit refused once retired).
  A vehicle in stock, returned, in maintenance or stolen can be **retired** with a reason; retiring is final.
- A contract's price may not be below the unit cost (goods cost plus an equal share of landed cost) unless an administrator
  explicitly allows it (BR15).
- A vehicle can be sold only from stock. Activating a contract moves it to sold, records the owner, creates the installment
  schedule and posts any deposit. **One live contract per vehicle** is a unique index.
- Payments are applied to the oldest unpaid installment first; a payment larger than the balance is refused; the same
  payment reference twice is ignored.
- A contract with arrears older than its limit is **flagged** defaulted by a daily job. **Repossession is deliberate and
  administrator-only**; it returns the vehicle and ends any rider assignment.

## Riders, vehicles, batteries
- One active assignment per rider and one per vehicle (BR1, BR2): unique indexes plus readable checks. Only a sold vehicle can be assigned.
- One battery per vehicle (BR3): a unique index, and swaps change both batteries in one transaction.
- A charge is recorded with its fee. The fee is collected in the daily settlement, **or** the rider pays it at once
  (`POST /charge-events/:id/pay`): the charge becomes `paid`, is linked to that payment, and is never charged again in a settlement.

## Daily settlement
Order of deduction (assumption A2, one place in code: `settlement.engine.ts`):
1. charging fee, 2. daily remittance to the owner (anything the rider already paid directly counts first), 3. company service
fee, 4. the remainder is the rider's chop money. Status is `shortfall` only if the remittance is not fully met.
- One current settlement per rider, vehicle and day. Recalculating before close creates a new version and reverses the old
  postings. A **closed** day is final, and takings cannot be added to it.
- A nightly run (23:30 Accra) exists but is **off** until `AUTO_SETTLEMENT=true`.

## Grace period, safe lock and unlock (BR8, BR9, BR16)
- A settlement that ends in `shortfall` starts a **grace period** for that rider's vehicle and sends the warning SMS
  (the SMS provider must be configured; if it is not, the failure is logged and the clock still runs).
- Grace length: the **contract's** setting if it has one, otherwise the **hub's**, otherwise **12 hours** (1 to 168 allowed).
- When it ends unpaid the vehicle is locked **only if it is stationary** (speed 5 km/h or less). If it is moving the check
  repeats every 5 minutes. A vehicle is never locked while moving.
- If a later recalculation of that day is no longer a shortfall, the grace period stops and a lock is released automatically.
- A **manual lock** is requested by a hub manager (own hub only) or fleet manager and needs an **administrator's approval**.
  Without a linked tracker the approval reports a clear failure instead of pretending the vehicle is locked.
- **Unlocking** needs a reason, which is stored with who did it and when. A hub manager can unlock only their own hub.
- Automatic commands are attributed to a per-organisation internal `system` account, created on first use. It cannot sign in.
- **BR17 (proposed, awaiting the client):** an administrator, fleet manager or hub manager can approve an *exception*
  (sickness, breakdown, leave, other) with dates and a reason. While active, the rider gets no grace period and no lock, and
  a running grace period stops.

## Payments and payouts (BR6)
- Every cash movement outside the daily settlement is a `business_payments` row with a **purpose** (deposit, installment,
  charge, payout, hub deposit), direction, method (cash, mobile money, bank), payer or payee, a **unique reference** and the
  ledger transaction it created. The same reference twice changes nothing.
- A **payout** to an owner or rider cannot exceed what the ledger says is owed to them (checked under a lock, so two payouts
  cannot both pass). A **hub cash deposit** cannot exceed the cash the hub's recorded collections say it holds.
- Payouts and hub deposits move money through the `company_cash` account. It can show a negative balance when payouts were
  made before deposits were recorded; that is a signal to record the deposits, not an error.

## Audit trail
- Every change (any request that is not a read) and every **read of personal data** (owners, riders, users, contracts,
  statements, ledger, settlements, portals, the audit trail itself) is recorded with who, when, what and from where.
  Passwords, tokens, mobile money numbers, ID numbers and codes are removed before saving.
- `audit_logs` cannot be updated or deleted (database trigger). Only administrators and auditors can read it, and only their own organisation.
- The lock flow also writes its own entries (`enforcement.grace_started`, `locked`, `released`, `lock_deferred`, ...).

## Logins and portals
- Administrators create logins (**Team & Logins**) with a role and a one-time temporary password. Investors are linked to
  an owner, hub managers to a hub, riders to a rider record. The new user must choose their own password at first sign-in
  (10+ characters with upper, lower, digit and symbol). Deactivating a login ends its sessions.
- **Investors** see only their own vehicles, contracts, payments and statements (with payback progress). **Riders** see only
  their own assignment, last 14 days and any lock warning. The menu shows each role only its own screens; the server
  enforces permissions regardless of the menu.
- The first-login password change is enforced by the web pages. The server does not yet block other calls until the
  password is changed (planned for the next release).

## Who sees what (BR11, BR12)
- Admin, finance, fleet manager, auditor: the whole organisation. Hub manager: only their hubs. Investor: only their own owner
  record, contracts and settlements. Enforced by `DataScopeService` on every read.
- Owners' mobile money numbers and ID numbers are encrypted at rest (AES-256-GCM) and returned only masked.

## Platform hardening in this release
- Registration can no longer place a new user inside an existing organisation (an invitation flow is needed for that).
- Organisation endpoints are limited to administrators and to their own organisation; the user list never returns password
  hashes or two-factor secrets.
- In production the app refuses to start without a strong `JWT_SECRET`, `JWT_REFRESH_SECRET` and a `FIELD_ENCRYPTION_KEY`.

## Open assumptions awaiting the client
| Id | Assumption | Needed from |
|---|---|---|
| A1 | How an owner relates to a rider (same person, or separate) | client |
| A2 | Deduction order and the amounts (remittance, service fee, charging fee) | client |
| A3 | Whether fares are collected through wallets or as cash at the hub | client |
| A4 | Grace period (12 hours assumed) and the rider-exception rule (BR17) | client |
| A5 | Deposit, term and amounts for each sale mode | client |
| A6 | GHS only | client |
| A7 | Whether the battery's built-in GPS lock or our own immobiliser is the lock | supplier |

## Known limits
- The payment gateway is a mock; real mobile money integration is not built.
- SIM-swap detection is webhook-only. Only test country polygons exist for roaming.
- Logins are created by an administrator; there is no self-service invitation by email. The battery's GPS protocol is unknown, so battery location is not yet read.
- Legal and registration requirements for operating in Ghana are not verified (see the data protection notes in `docs/deployment-ghana.md`; this is not legal advice).
- Trip distance is shown exactly as stored by the tracking layer (assumed kilometres); confirm with the tracker's output.
- SMS warnings need a configured SMS provider; until then they are skipped.
