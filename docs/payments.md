# Stripe checkout setup

The storefront uses hosted Stripe Checkout, Printful shipping quotes, server-verified catalog prices, a private SQLite order database, and signed Stripe webhooks. The Master dashboard displays the latest 100 payment records after owner sign-in. Payment confirmation does not automatically submit an order to Printful. Fulfill verified live paid orders manually in Printful; never fulfill test or pending orders.

## Connect the backend

1. Create your Stripe account at https://dashboard.stripe.com/register and complete business/payout verification before enabling live payments. Configure Stripe Tax registrations and settings for your business before checkout testing; this checkout enables automatic tax.
2. Deploy `request-service/Dockerfile` on a HTTPS container host using Node 24. Mount persistent storage at `/data`, backed up securely. Follow the existing request-service README for owner password generation and base service setup.
3. Set backend environment variables through your host's secret manager:

```
APP_ORIGIN=https://YOUR-BACKEND-HOST
OWNER_PASSWORD_HASH=generated-with-password.mjs
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PRINTFUL_TOKEN=your-private-printful-token
PRINTFUL_STORE_ID=your-store-id-if-using-an-account-token
CHECKOUT_COUNTRIES=US
PAYMENTS_ENABLED=true
PAYMENTS_LIVE=false
```

`APP_ORIGIN` is the private service origin. The supported storefront origin defaults to `https://midnight-designs.store`. `CHECKOUT_COUNTRIES` is a comma-separated uppercase country list. Only enable countries you actually serve. Secrets belong on the backend, never in browser JavaScript, the public repository, or chat.

4. Create a Stripe webhook for `https://YOUR-BACKEND-HOST/api/payments/webhook` in the same test environment as the API key. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`. Copy its signing secret into the backend environment.
5. Update root `request-service-config.json` to `{"url":"https://YOUR-BACKEND-HOST"}`. This also connects the existing private request/owner features, so preserve their configuration and data. Backend hosting is necessary: GitHub Pages cannot run the payment API.
6. Test a complete checkout using Stripe test cards: calculate shipping, cancel and retain the bag, complete payment, verify the signed webhook is delivered, verify the result page and owner order list, and confirm actual shipping/tax calculations. Do not enable live mode until this succeeds with your provider accounts. The automated integration tests mock provider responses and do not validate your credentials or account setup.
7. For live launch replace the key with `sk_live_...`, configure a live-mode webhook and its signing secret, and set `PAYMENTS_LIVE=true`. Restart the backend. Never mix test and live keys/events.

## Behavior and limits

Prices and availability are loaded from published `products.json` on the server, checked again before checkout. USD checkout supports active Printful variants with size and catalog variant IDs; studio/custom builds require published products first. Shipping quotes expire after ten minutes. Delivery addresses are collected in the app and fixed for that shipping quote; Stripe collects billing details and card payment. Stripe computes tax; final totals appear on its hosted checkout.

Orders become paid only after signature verification and fetching the matching Stripe session with exact amount checks. A redirect alone cannot mark an order paid. Failed/cancelled checkout retains the bag. Receipt access uses an unguessable token and contains no delivery/contact details; those are visible only to the authenticated owner. Share confirmation links only with the purchaser.

Refunds, disputes, transactional email, shipment tracking and automatic Printful fulfillment are not automated by this change. Manage refunds and disputes in Stripe and verify provider status before fulfillment. The current owner queue records initial payment status, so refunded orders need manual reconciliation. Keep backups of the private order database and restrict its host access.

Run `cd request-service && npm test` to check the existing private request system and payment integrity tests. The integration suite validates pricing, shipping failures, receipt authorization, changed prices, retry payload stability, forged webhooks, incorrect amounts/modes, duplicate events, pending payments and owner isolation.
