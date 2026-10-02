# Order communication — prepared, not activated

The public order-help page, support topic handoffs and owner message previews are implemented. No order emails are sent, no order lookup exists, and no customer information belongs in this public repository. Checkout remains disabled. support-config.json currently has no inbox.

## Connect before accepting orders

Use a commerce-capable host for checkout and a private backend/database. GitHub Pages serves static assets, not a notification worker. Choose a transactional email service, verify an owned sender domain, publish a monitored support inbox and configure reply-to. Keep all provider credentials on the backend.

Message templates in order-email-templates.json are drafts. order-messages.mjs renders plain text only; it does not authorize, send or store messages. The Master previews use fictional data and must never be treated as order records.

### Confirmation
After a payment provider's authenticated successful-payment event, persist the accepted order and line items. Store product/variant, size, color, quantity, currency, subtotal, shipping, tax, total paid, address and realistic production/delivery estimates. A checkout redirect, browser click, saved bag or payment authorization alone must not trigger confirmation. Queue one confirmation per accepted paid order. Receipt totals must match the paid currency and charge. Use the published support inbox for reply-to.

### Shipment tracking
Receive the production provider's package_shipped event on a private HTTPS backend. Correlate it to an existing paid order and verify the shipment against the provider API before using its data. V1 events must not be assumed to carry a payment-provider-style signature. Keep an unpredictable endpoint secret protected and verify provider-side order/shipment state. Maintain the provider-order/store-order association privately.

Persist each shipment separately, including package ID, shipped items/quantities, carrier, tracking number and HTTPS tracking URL. Queue a tracking message per verified package; do not mark the entire order fulfilled from one partial shipment. For no tracking number or URL, explain that tracking is unavailable; never fabricate a carrier link. Do not announce delivery merely because a label was created. Support requests and production failures must route to the monitored inbox/owner queue.

### Reliability and privacy
Use a durable event/outbox table, unique event keys (confirmation: order ID; shipping: order ID + package ID), retry/backoff and a delivery log containing provider message ID/status. Replay events must not resend notifications. Track provider rejection/bounces and surface failures to the owner. Verify the chosen email provider's webhook authentication. Never claim email delivery from an API acceptance response.

Order-status access needs authenticated customer access or a high-entropy, expiring order-specific link. Do not expose customer records through public JSON, GitHub commits, query-string email addresses or an order-number-only search. Carrier links must be validated HTTPS links without embedded credentials. Use templates as plain-text email; HTML requires escaping every customer-controlled value.

### Launch verification
Use payment and email test modes: accepted payment yields one correct confirmation; repeated payment events produce no duplicate; two packages yield two correct notices; failed email is retried and shown to the owner; invalid shipment data cannot alter the order; order details cannot be read by another customer. Test the actual monitored inbox and replies. Then connect the public order-help page to the real order-status flow and replace its prelaunch wording.

Primary references:
- GitHub Pages hosting: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- Hosting limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- Printful v1 webhook payloads and package_shipped: https://developers.printful.com/docs/#tag/Webhook-API
