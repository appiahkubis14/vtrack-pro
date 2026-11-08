# Business-layer API

All routes are under `/api`, need a bearer token, and return `{ "data": ... }`. Amounts are integer pesewas. Roles are
checked on every route; hub managers and investors are further limited to their own data.

| Area | Method and path | Purpose |
|---|---|---|
| Hubs | `GET/POST /hubs` (with `gracePeriodHours`), `GET/PUT /hubs/:id`, `GET/POST /hubs/:id/charge-points` | hubs and their charge points |
| Models | `GET/POST /vehicle-models`, `PUT /vehicle-models/:id` | vehicle models and list prices |
| Consignments | `GET/POST /consignments`, `GET /consignments/:id` | container orders with lines |
| | `POST /consignments/:id/advance` | shipped, at_port, cleared, closed |
| | `POST /consignments/:id/receive` | register units into stock |
| | `PUT /consignments/:id/landed-cost`, `GET /consignments/:id/profitability` | cost and margin |
| Owners | `GET/POST /owners`, `GET/PUT /owners/:id` | investors (secrets encrypted, masked on read) |
| Contracts | `GET/POST /contracts`, `GET /contracts/:id` | contracts with installments and arrears |
| | `POST /contracts/:id/activate` `/payments` `/cancel` `/default` `/reinstate` `/repossess` | lifecycle |
| Riders | `GET/POST /riders`, `GET/PUT /riders/:id` | riders |
| Assignments | `GET/POST /assignments`, `POST /assignments/:id/end` | rider to vehicle |
| Batteries | `GET/POST /batteries`, `POST /batteries/:id/fit` | packs |
| | `GET/POST /battery-swaps` | swaps |
| Charging | `GET/POST /charge-events`, `POST /charge-events/:id/finish` | charge sessions and fees |
| Takings | `GET/POST /collections` | fares handed over by riders |
| Settlements | `POST /settlements/calculate`, `GET /settlements`, `POST /settlements/:id/close` | the daily division |
| Ledger | `GET /ledger/trial-balance`, `GET /ledger/accounts/:id/entries`, `POST /ledger/transactions/:id/reverse` | read-only plus reversal |
| | `POST /consignments/:id/write-offs` | write off lost or damaged units (reason required) |
| Suppliers | `GET/POST /suppliers`, `PUT /suppliers/:id` | supplier records |
| Vehicles | `GET /business/vehicles`, `PUT /business/vehicles/:id`, `POST /business/vehicles/:id/retire` | stock list, plate/chassis/motor edit, retire |
| Payments | `GET /payments`, `GET /payments/balances` | every payment with purpose and payer; what is owed and held |
| | `POST /payouts/owners/:id`, `POST /payouts/riders/:id` | pay out what is owed (cannot exceed it) |
| | `POST /hubs/:id/cash-deposits`, `POST /charge-events/:id/pay` | hub cash deposit; rider pays a charge directly |
| Safe lock | `GET /enforcement/states`, `GET/POST /enforcement/lock-requests` | grace/lock state; request a lock |
| | `POST /enforcement/lock-requests/:id/approve` `/reject`, `POST /enforcement/unlock` | admin decision; unlock with reason |
| | `GET/POST /enforcement/exceptions`, `POST /enforcement/exceptions/:id/cancel` | rider exceptions (BR17, proposed) |
| Team | `GET/POST /team/users`, `POST /team/users/:id/deactivate` `/activate` `/reset-password` | logins (administrators) |
| Account | `GET /account/me`, `POST /account/change-password` | any signed-in user |
| Portals | `GET /portal/investor`, `GET /portal/rider` | the signed-in investor's or rider's own data |
| Audit | `GET /audit/logs`, `GET /audit/logs/:id` | administrators and auditors |
| Reports | `GET /business-reports/hub-daily-close`, `rider-statement` (with daily routes), `owner-statement` (with payback), `arrears`, `weekly-summary`, `monthly-summary` | reports |
| | `GET /business-reports/summary-by?dimension=vehicle\|region\|vehicle_type`, `GET /business-reports/fleet-health` | earnings grouped; fleet and battery condition |

Swagger lists every route with its request shape at `/docs`.
