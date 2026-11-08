# V-Track Pro — Ghana EV Edition, Phase 1 Additions

Extends the base platform with the Work & Pay auto-debit safety machine
and Rider ID infrastructure, scoped for the September MVP test run.

## What's here

**Backend** — `backend/src/modules/ev-fleet/`
- `entities/` — `Rider`, `RiderSession`, `PaymentLog`, `ImmobilizerState`
- `processors/work-and-pay.processor.ts` — the 6pm BullMQ scheduler + safety-gated immobilization state machine
- `processors/payment-gateway.service.ts` — mock/sandbox payment adapter (see the file's own docblock for why this must not be mistaken for real-sandbox testing)
- Migration `1700000000025-CreateEvFleetGhana.ts` — ran clean against a real Postgres instance before delivery

**Frontend** — `frontend/app/js/vtrack-realtime-client.js`
- Resilient WebSocket client distinguishing brief network blips from sustained outages, with exponential backoff + jitter and an outbound event queue for offline periods. Plain vanilla JS (no build step), matching the rest of this frontend.

## Real bugs caught while building this — not written to look good, actually found

Every one of these would have shipped silently broken if the code had only been "written to compile" rather than checked against the real project and simulated at runtime:

1. **A fictional `NotificationsService.send()` method** — doesn't exist in this codebase. The real dispatch mechanism is `ChannelFactory.get(channel).send(payload)`. Fixed before this ever hit a test run.
2. **`DeviceTargetDto` has no `vehicleId` field**, only `deviceId`/`deviceIds`. The processor now resolves the device from the vehicle first.
3. **`remote_commands.user_id` is a real foreign key into `users(id)`** — the original draft used a `'system:work-and-pay'` sentinel string, which isn't a valid UUID and would have thrown a hard database error the first time a real immobilize command tried to fire. Fixed to require a genuinely seeded system user via `WORK_AND_PAY_SYSTEM_USER_ID`, failing loudly at runtime if unset rather than silently sending garbage.
4. **A logic bug in the WebSocket client's blip-detection guard** — the condition gating the "show reconnecting" transition could never actually become true, meaning sustained outages would never surface a warning to the user. Caught by actually simulating the timer behavior in Node (not just `node -c` syntax checking), not by inspection.
5. **A factual error in a code comment** — an early draft called Ghana's mobile money provider "Telecash." Verified via search: it's **Telecel Cash**, rebranded from Vodafone Cash in February 2024. Fixed before delivery.

## Before the September test run, you still need

- Real Hubtel/Paystack merchant KYC completed and their actual sandbox tested (the mock gateway here validates the *state machine's logic*, not real-world MoMo timeout/webhook behavior — these are different things, see the payment-gateway.service.ts docblock)
- A seeded system user for `WORK_AND_PAY_SYSTEM_USER_ID`
- A policy decision on the two Socratic questions raised in the architecture response (NFC vs. Bluetooth-only trust level for Phase 1; whether a maximum grace period ceiling overrides the safety gate)
- SMS aggregator credentials (Africa's Talking or Hubtel SMS) wired into the existing `SmsChannel`
