# Private request conversations

This is a separately hosted service, not a GitHub Pages script. It serves the customer portal and signed-in owner workspace from one origin. Node 24+, no npm dependencies. SQLite stores requests, messages, private images, hashed links and sessions on a persistent disk.

## What works once hosted

- Submit a request directly and enter its conversation.
- Customer and owner replies, private PNG/JPG/WebP images (8 MB each, 30 per request), in-thread status updates.
- Owner publishes an uploaded artwork version; customer approves that exact version or requests revisions. A replacement design invalidates approval. Polling retrieves updates every 15 seconds while the page is visible.
- Owner queue, search, replacement customer links and private JSON exports.
- Ready for Production requires current customer approval and owner confirmation of quote, payment and exact production files. It does not charge or fulfill orders.

## Deployment requirements

1. Deploy `request-service` as its own Node 24 or Docker web service. GitHub Pages continues serving the storefront. Connect a persistent writable disk at `/data` (UID 1000 in the Docker image); run one instance only. Ephemeral disk or multiple independent instances will lose/diverge data.
2. Set `APP_ORIGIN` to the service's exact HTTPS origin, with no trailing slash. Configure TLS at the host. Set `DATA_PATH=/data/requests.sqlite` and the host-provided `PORT`.
3. Generate the owner hash locally with `npm run password --silent`, passing a password of at least 16 characters on stdin. Save only the resulting hash as the service's secret `OWNER_PASSWORD_HASH`. Do not commit passwords, hashes, links or customer data. The app refuses to start without a valid hash/origin.
4. Start with `npm start`; health check `/health`. Log in through Owner sign-in. Test in separate owner/customer browsers before opening intake.
5. Set the public storefront's `request-service-config.json` URL to this HTTPS origin after validating the deployed service. The storefront then shows a conversation link. Leave it null while unhosted; it never pretends the backend is connected.

Local development: use a throwaway password hash, `DEV_HTTP=1`, `APP_ORIGIN=http://localhost:3000`, and `DATA_PATH=./private-data/requests.sqlite`. `npm test` runs authentication, cross-request isolation, approvals, revision history, revocation and persistence checks. Browser CI tests separate customer and owner contexts and responsive layouts.

## Access and operations

Customer links are 256-bit bearer credentials, hashed in the database and valid for seven days. Anyone holding a link can open that one request. They are exchanged into HttpOnly SameSite cookies; fragment tokens are removed from the address bar and are never sent in HTTP URLs. Replacing a link revokes previous customer links and sessions. Owner sessions last eight hours; customer sessions seven days. Customers can reopen an unexpired private link on another device. Do not send access links publicly.

Email addresses are customer-supplied, not verified identities. Verify the customer and agreed details before accepting money or production. This service does not send invitation emails, password recovery, email/push notifications or Printful orders. Owners deliver replacement links through their existing verified contact method. There is no multi-owner role management yet.

Use host-level monitoring and backups. JSON export is a private data export, not an automatic restore mechanism. For disaster recovery, snapshot the persistent volume consistently, including SQLite WAL files, or use SQLite's online backup tooling. Test restoration before launch. Do not place exports/DBs in the public repository. Set a retention policy before using real customer data. Public intake has basic request/login/upload rate limits; add host-level abuse controls for advertising-scale traffic.

Existing device-local owner records do not sync into this service automatically. Add their briefs manually using Add customer request; do not treat locally edited approval statuses as verified customer approvals. Customer artwork uploads here are images; keep full garment maps and production files in your private order storage.

## Design feedback

The storefront records Like / Not for me on standalone artwork. Once its service URL is connected, customer clicks POST only a design ID, preference and random browser ID to /api/design-votes. One preference per artwork/browser is updated or removed; identifiers are hashed in storage. Cross-origin access is limited to this vote endpoint and the configured storefront origin. Owner sign-in is required for aggregate rankings; identifiers are never returned with totals. These are browser preferences, not verified unique shoppers or sales.

The server validates IDs against design-catalog.json. Refresh that snapshot from the current designs.json and redeploy when artwork is added or removed. Reference mockups do not receive votes. Until hosting is connected, choices stay on the device and do not create shared totals. The existing request and messaging service hosting requirements still apply.

## Detailed artwork ratings

The storefront's `design-ratings.js` collects Overall, Artwork, Colors and Style (integer 1–5), wear intent (Yes/No), purchase intent (Yes/Maybe/No) and complexity (Too simple/Just right/Too busy). It uses the existing HTTPS `request-service-config.json` connection. Until hosted and configured, ratings remain browser-local. Updates replace one rating per artwork/browser identity; removal deletes that rating. Like/Not for me votes remain independent.

`POST /api/design-ratings` accepts `{designId,voterId,rating}` with all seven fields, or `rating:null` for deletion, only from the configured storefront or service origin. Reference mockups are excluded. `GET /api/design-ratings` requires owner authentication and returns response counts, separate averages (null with no responses) and answer distributions without browser IDs. The owner portal displays these separately from Like/Not for me totals. Browser identities are not verified unique customers; purchase intent is not revenue.

The SQLite volume backup includes rating and vote tables. The existing conversation JSON export does not include them. Refresh `design-catalog.json` and redeploy when adding standalone artwork.

## Product reviews

Product reviews are independent of artwork feedback. `product-reviews.js` collects seven required scores (product quality, print quality, fit, comfort, value, shipping and overall), written text, public display name, optional size/color worn and up to three customer photos. Photos are resized to JPEG in the browser. IndexedDB keeps a local draft and photo copies. Until the existing HTTPS backend configuration is hosted and connected, saving is device-only, not submission or publication.

`POST /api/product-reviews` accepts `{productId,voterId,review}` from the storefront or service origin. All seven integers must be 1–5; written text, display name, photo array and `consent:true` are required. `review:null` removes that browser identity's review. Identities are hashed; repeating a submission replaces its review rather than creating a second one. There is no purchase verification while checkout/order integration is unavailable. Public copy explicitly states that reviews are not verified purchases.

`GET /api/product-reviews?productId=...` returns only approved reviews (latest 50), plus counts and seven averages across all approved reviews. Photo URLs load separately; pending/rejected photos require owner access. `GET /api/owner/product-reviews` requires owner authentication and returns the latest 100 submissions. Owner `POST` requires the current review revision and an approved/rejected status. Updates return to pending and stale owner decisions return 409. Moderate authenticity, privacy and inappropriate content consistently, without hiding legitimate negative reviews merely for their score.

Refresh `product-catalog.json` from the synchronized storefront product IDs/names when deploying new products. The SQLite volume backup includes reviews/photos; the conversation JSON export does not. Browser identities are not verified people and can be reset. Hosting abuse protection and owner moderation remain necessary before opening shared submissions.


## Owner Design Analytics

The owner dashboard links to `/analytics.html`. Anonymous/customer sessions are redirected to sign-in and all report/link APIs require owner authentication. `/api/owner/design-analytics?period=7|30|90|all&device=all|phone|tablet|desktop|unknown` returns aggregate data without visitor IDs, contact details, uploads or message text. Current likes/dislikes are explicitly all-time/all-screen rankings. Current editable ratings are selected by their last update time and coarse viewport category, with response counts. Legacy ratings have unknown screen size. Verified customer-type segmentation is unavailable.

`design-events.js` is a separate first-party, optional collection path independent of the unconfigured Google Analytics measurement ID. It runs on shopping/design pages only after consent and an HTTPS backend connection, respects Global Privacy Control/Do Not Track, and removes its browser ID when disabled. `POST /api/design-events` accepts only view/like/cart signals, known product/artwork IDs, random event/browser IDs and coarse viewport size. The server hashes browser IDs, stamps receipt time, deduplicates event IDs and retains events for 180 days. It rejects client purchase events. IDs are anonymous browser identities, not verified people; blocked/unconsented traffic is absent.

Owner-confirmed product/artwork links (`/api/owner/design-links`) determine attribution at event receipt time. Product events without an association remain unattributed; adding/removing a link never changes past rows. A product can use several artworks, so the aggregate strict funnel counts browser+design pairs rather than unique people. Viewed → Liked → Cart stages must occur in that order during the selected period and screen cohort. Independent cart rankings include direct shoppers who skipped Like. The dashboard never claims cart conversion is sales conversion. Purchased counts/revenue/conversion remain null until verified payment and order attribution exist.

Optional structured preferences on request creation (`preferences:{style,colors,placements,productId,designId}`) feed request trends. Validation and insertion are inside the request transaction. Trends exclude owner-created requests and unstructured legacy briefs, and include all screen sizes. Multi-selected colors/placements can total more than the request count. Requested placement popularity is not proven placement sales performance. Refresh both catalog snapshots when deploying new items/artwork.

SQLite volume backups include events, associations, request traits and rating screen-size metadata. The conversation JSON export excludes these tables. Aggregate analytics JSON downloads contain no browser or customer identities. Protect the single-instance persistent Node service with HTTPS and hosting-level abuse controls before connecting it to the storefront.

## Customer feedback and suggestions

`feedback.html` collects Design idea, Product request, Clothing request, Site problem, Feature suggestion, Complaint and General comment. Connected submissions create New records in the same private Requests queue and conversation system; owner filters include every intake type. Feedback and Question / comment can be marked Completed directly and cannot become Ready for Production. Clothing/design production requests retain their approval safeguards.

The public POST /api/requests permits only the configured storefront origin or service origin. Owner reads remain authenticated. An optional UUID submissionId is hashed in request_intake alongside a payload digest. Retrying identical details returns the same request and rotates its private access link; changed details with the same key return 409. SQLite volume backups include this table. Never share private access links.

The service is not yet hosted or connected. With a null service URL, feedback stays on the device until the customer prepares an email to midnightdesign107@gmail.com or downloads a request file for manual owner import. Preparing email does not send it or confirm delivery. No automatic email confirmations are configured.


## Unified Request Center filters

Both owner queues offer quick views for New, Custom Design, Uploaded Design, Create Your Own, Custom Clothing, Revision (type or status), Feedback, Problem (site problems and complaints), High Priority, Awaiting Customer (Customer Review), Approved and Completed. Customer/email and product search combine with inclusive original creation-date filters in UTC. Clear filters resets all controls. The private queue loads the latest 500; exports contain all requests.

Priority defaults to Normal, including migrated records. Only an authenticated owner can update priority/product using POST /api/requests/:id/metadata. Customer input cannot mark itself high priority. Product labels on legacy requests must be entered by the owner; brief text is not guessed. These organization changes do not charge, publish a product, create an order or trigger fulfillment. The private service remains unhosted; local queues require manual import and device backups. Ratings and Analytics remain beside the Request Center.
