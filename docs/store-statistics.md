# Store statistics

The owner-only `/analytics.html` page now starts with a store-wide report; existing artwork-specific analytics remain below it. The master dashboard links to this report. Its API is `/api/owner/store-statistics?period=30&device=all` and requires owner authentication.

## Counting rules

- Traffic represents **consenting browsers**, not all people. Random visitor/session IDs are hashed server-side. No IP address, email, full referrer URL, receipt token or payment identifier is accepted as a browsing attribute. Only a referrer hostname is stored. Session inactivity threshold is 30 minutes; browsing retention is 180 days. Privacy signals and denied consent disable the collector.
- Events have stable UUIDs. Retries reuse the same UUID; database uniqueness prevents duplicate counts. Product-card links, product views, add-to-bag activity and checkout starts use stable product IDs. A checkout start is counted once per browsing session on the bag page.
- The client cannot report purchases. Sales originate only from Stripe-retrieved sessions that passed mode, signature/proof and amount validation. Facts are saved in the encrypted payment journal and deduplicated by Stripe Checkout Session ID. Test/sandbox purchases are counted as excluded, never as sales.
- Paid units and product/collection revenue are **gross merchandise sales**, excluding shipping/tax. Payment totals, shipping, tax and refund deltas are separate. Paid time uses the verified Stripe charge timestamp when available, otherwise first verification; refund deltas use the time observed and are labeled accordingly. Partial refunds cannot be assigned to specific products without line-level refund data, so no product-level net revenue or net units are invented.
- Product and collection IDs are frozen with order lines. Current catalog names are labels only. Renaming cannot re-key history. Records lacking a stable collection ID are not guessed into a collection.
- Conversion numerator is distinct attributed buying browsers; denominator is distinct observed consenting visitors or product viewers in the selected period/cohort. Orders without consented attribution are reported separately. A missing denominator is unavailable, not 0%. All-customer conversion is not inferred from this subset.
- Sales are date-filtered but not device-filtered. Device selection narrows browsing denominators, not unknown sale devices. Feedback reaction choices are current all-time choices; reviews/ratings/requests use their update/create dates. Feedback is not device-filtered. Operations describe all saved live paid orders, including older orders. Shipped is cumulative, not currently in transit.
- Existing historical paid records without verified saved facts are counted as unclassified; they are not fabricated as zero-value sales. A trusted Stripe reconciliation must populate facts before those orders enter rankings. Traffic starts when the collector is deployed; historical visits cannot be reconstructed.

## Verification

`store-statistics-test.mjs` exercises visit/click event replay, reaction replay, a test payment and webhook replay, then checks live sales remain zero with one excluded test order. A separate isolated live-mode provider fixture verifies gross sales, taxes/shipping, refunds without duplicate totals, stable IDs after product/collection renames, and explicit conversion denominators. No real payment/provider write is involved.

`store-statistics-browser-test.mjs` uses the actual storefront collector and private statistics page in an isolated temporary database: visit → product click → add to bag → feedback → test payment → owner report, with duplicate events/reactions/webhooks and four responsive widths. The production database is not seeded with test activity.

## Deployment

This requires both frontend collector and backend report/payment-fact support. The running backend is separate from GitHub Pages. Do not call the report live merely because frontend assets have deployed. Preserve a verified recoverable artwork backup before replacing the backend; its last observed storage state had an upload running and unsaved edits. Until the backend update is safely deployed, the new report must show a useful unavailable error, never invented zero totals.

The event tables and feedback use the main SQLite backup. Verified sales/refund facts use the independent encrypted payment journal. Neither is a substitute for persistent always-on storage or backup verification.
