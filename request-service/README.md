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
