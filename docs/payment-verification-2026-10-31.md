# Midnight Designs payment verification — October 31, 2026

## Verdict

**Not yet fully launch-verified.** Separate local provider simulations verify the buying and fulfillment logic without charges. Live mode is enabled, but there is no completed live payment in the account to reconcile. Automatic store order email is explicitly disabled on the running backend. This change adds a durable email queue, but its sender is not connected or live-delivery verified. These are remaining work, not passed checks.

## Read-only live evidence

- Backend `/api/checkout/config`: enabled=true, testMode=false, orderStorageReady=true, storage=stripe-and-encrypted-order-journal, fulfillment=owner-confirmed-printful, automaticOrderEmail=false.
- Stripe live account: midnight-designs, account ending QjShQ.
- One enabled webhook destination: `https://midnight-designs-backend.onrender.com/api/payments/webhook`.
- Enabled events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired.
- Stripe lists one expired, unpaid store Checkout Session; no completed/paid sessions. Checkout expiry event `evt_1UWQ5FRAa9NQjShQYfe24Z2B` appears in the delivery_success=true query with no pending webhooks. This verifies delivery of expiry, not paid-order processing.
- Stripe lists zero active Tax registrations. The checkout code requests automatic tax. A configured flag does not establish that tax is actually collected. Registration settings require owner resolution; this audit did not register the business or change tax settings.
- Live account inspection used GET operations only. No live checkout, payment, supplier draft, production charge, or customer/owner email was created by this audit.

## Isolated no-charge exercises

The provider fixture starts a separate local service and temporary SQLite database. It uses fake Stripe credentials, signed fixture webhooks and in-memory Stripe/Printful responses; its network adapter rejects unknown providers. This is **not an actual Stripe-hosted sandbox-card exercise**. Production settings were not switched to test mode.

Focused server tests cover:

| Area | Verified behavior |
| --- | --- |
| Server authority | Client prices ignored; prices/sizes/quantities and shipping options checked on server; invalid quantities and destinations rejected |
| Signature | Missing/forged/stale/modified authentication rejected; signed events retrieve the authoritative session |
| Duplicate/recovery | Same session/order after repeated webhooks, lost acknowledgement, process restart and restore; conflicting writers held |
| Supplier identity | Correct sync and catalog variant IDs required; ignored/unsynced/unavailable variants held |
| Artwork | Front, back and both sleeves frozen into the paid order; changed file IDs or sleeve position versus saved published release held before payment |
| Approval | Draft/review/private/rejected states blocked; unknown saved artwork release blocked |
| Printful | One unconfirmed draft; immutable files/variants/quantity/address checked; unknown outcomes reconciled without another create |
| Supplier charge | Owner must confirm exact draft ID, cost and version; changed costs rejected; lost confirmation reconciled without a second charge |
| Order access | Receipt capability required; private recipient details and print files excluded from customer response |
| Tracking | Split shipments, tracking persistence and safe HTTPS URLs after restart |
| Test/live isolation | Test payments cannot create/charge real production; simulation only with injected provider adapter |

Browser exercise (Payment integrity workflow) covers product → bag → shipping failure/retry → failed payment → preserved bag → same-session recovery → paid receipt → simulated owner cost approval → tracking. It checks 320/390/844/768/1024/1440 screen widths and cancellation handling. See the workflow result for the current commit; do not infer browser success from unit tests alone.

## Repair in this change

Checkout compares supplier print files (IDs, placement types, options and position) with the saved published studio revision before quoting or opening payment. A supplier-only private edit cannot silently replace the public listing's approved artwork. Missing saved revisions fail closed and must be recovered; they are not silently treated as approved. Pre-studio legacy products have no immutable approved file baseline and remain a separate audit limitation.

Email notice state is stored in payment_fulfillment.details and therefore in the encrypted payment journal. Retries/restarts retain event identity; provider acceptance is distinct from delivery; uncertain sends are held without replay. Real test-order email is blocked except in the isolated injected-provider fixture.

Payment browser CI is pinned to Ubuntu 24.04 because the installed Playwright version cannot install Chromium on the newer ubuntu-latest runner. This change does not alter live Stripe credentials or tax settings.

## Remaining gates

1. **Order emails:** the new durable payment/shipment outbox is tested with an injected fake provider. Connect a verified sender using ORDER_EMAIL_ENABLED=true, ORDER_EMAIL_API_KEY (or RESEND_API_KEY), ORDER_EMAIL_FROM and ORDER_OWNER_EMAIL. Prove actual provider acceptance and inbox delivery separately. Existing unconfigured notices are retained and are not silently backfilled. Request Center email is a separate pipeline; Stripe receipt_email is not a store confirmation/tracking system.
2. **Owner alerts:** the queue now records paid-order and supplier-cost review notices, visible with their email statuses in Payments & orders. No live sender is connected. Verify a new paid order reaches the owner without manually searching Stripe.
3. **Tax:** resolve actual registrations and product tax categorization before claiming tax collection is ready. No registration was invented.
4. **Real Stripe sandbox:** run a separate, reachable sandbox backend with sandbox credentials/signing secret and actual hosted Stripe Checkout. Prove signed paid-event delivery even if the return page is never opened. Current local exercises simulate the provider.
5. **Live paid order:** after the preceding gates, reconcile the first authorized genuine paid order against Stripe, the encrypted journal and the exact Printful draft. No real purchase is required for the current audit, and none was made.
6. **Actual fulfillment:** owner approves the real supplier cost, then verify confirmation and carrier tracking on the same customer order. Do not approve production merely to test it.
7. **Legacy approved files:** records without saved studio revision snapshots need an owner-approved file baseline before claiming every legacy product's production art matches its listing.
8. **Backend deployment:** require a confirmed recoverable artwork backup before replacing the running free-tier backend. Recent editor revisions have previously failed large backup upload. The compact payment journal is ready but does not protect artwork revisions. Repository merge is not deployment proof.

## Commands

```sh
node --test request-service/payments-test.mjs request-service/payment-fulfillment-test.mjs request-service/payment-journal-test.mjs request-service/payment-notifications-test.mjs
node request-service/payment-browser-test.mjs
```

No credentials, receipt capabilities, customer addresses or payment details are stored in this report.
