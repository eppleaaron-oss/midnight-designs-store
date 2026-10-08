# Continuous production activation

The repository includes an independent Node worker (`request-service/factory-worker.mjs`) and a SQLite lease queue hosted by the authenticated backend. The worker polls authenticated machine endpoints, checkpoints one step at a time and drains its current checkpoint on SIGTERM. A browser is not involved in execution.

## Activation and costs

Upgrade the existing `midnight-designs-backend` service to Starter, attach a 1 GB persistent disk at `/var/data`, and create one Starter background worker from `render.factory.yaml`. Estimated compute and disk cost: $7 + $7 + $0.25 = $14.25/month, before bandwidth and provider charges. Do not create a second backend. Worker creation and disk attachment require the Render dashboard because the connected tools do not expose those operations.

Before changing DATA_PATH, download current factory exports and original/edited artwork. Ephemeral data must be migrated from the old SQLite database while it still exists; changing the path does not import it. Preserve the database using SQLite's backup API before stopping the old process, then place the backup at `/var/data/requests.sqlite` with restrictive permissions. Never copy only a live WAL database's main file. If the old free instance has already lost its files, restore the saved exports/uploads instead.

Backend environment:

- `DATA_PATH=/var/data/requests.sqlite`
- `FACTORY_DISK_MOUNT=/var/data`
- `FACTORY_WORKER_TOKEN`: random secret, at least 32 characters, shared only by backend and worker. Generate with `openssl rand -hex 32` and enter through Render secrets, never the repository or customer UI.

Worker environment:

- `FACTORY_BACKEND_URL=https://midnight-designs-backend.onrender.com`
- `FACTORY_WORKER_TOKEN`: the same backend-only secret.

The backend verifies that DATA_PATH is inside a distinct mounted filesystem; an environment flag alone does not claim durability. The worker cannot claim jobs on ephemeral storage. Keep one backend instance because a Render disk is exclusive to its service; workers coordinate through the backend's lease API, never by sharing its SQLite files.

## What runs

The implemented pipeline validates saved artwork/permissions and exact blueprints, refreshes supplier variants, checks each native area's saved print file, and moves prepared work to owner review. Missing print files pause the job with an explicit reason. Artwork uploads remain independent of the queue.

Automatic image generation, new Printful product creation, provider billing reconciliation and automatic supplier publishing are not connected. No private artwork is sent to an external AI. The worker does not pretend these steps have run. A future provider adapter must use the reserve/settle ledger and stable effect IDs, reconcile ambiguous outcomes before retrying, and checkpoint verified provider references.

## Reliability

Claims use SQLite transactions and expiring leases. Expired jobs recover from the last saved checkpoint, with bounded crash/retry counts. Completed checkpoints are unique per job and step. Supplier failures back off exponentially; terminal failures need review. Queue priorities are 0–9, concurrency 1–4, and schedules use an IANA timezone (default America/Denver), including overnight windows. Identical start/end means all day. Zero targets mean unlimited prepared designs; targets count completed preparation, not published products.

Budget reservations are atomic across jobs and count unresolved operations conservatively against both daily and total limits. Settlement records actual cost once. Ambiguous external effects block retry until the owner verifies either a provider result/actual charge or that nothing was created, published, or charged; actual cost exceeding its reservation is recorded and pauses the factory. Currently the implemented pipeline performs only zero-cost local checks and read-only catalog calls.

Production status exposes genuine worker heartbeats and storage readiness. Start/Resume require a live worker, durable storage and spending limits. Pause/Stop prevent further claims, and Emergency Stop cancels queued, retrying, waiting and running work. In-flight provider requests cannot be undone by a stop; leases prevent stale results from being checkpointed.

## Approved product publishing

The owner-only publishing panel saves final title, description, tags, category and collections. The backend checks actual PNG integrity, dimensions, checksums, all assigned variants and current pricing before approval. Preparation stops at owner review; approval queues supplier creation, mockup processing and store publication under the same worker leases and concurrency limit. Files or pricing changed after a supplier product exists require a replacement job.

Activation additionally requires `PRINTFUL_STORE_ID` for a Manual Order/API store, a backend `PRINTFUL_TOKEN` with product-read/write and mockup access, and backend `CATALOG_GITHUB_TOKEN` with repository contents write and Actions workflow dispatch access. GitHub Actions needs its existing Printful token/store configuration and working Pages deployment. Keys remain backend-only. Embroidery or techniques needing additional options remain held until a dedicated adapter is added.

Approved print files are shared with Printful through random 256-bit capability URLs expiring after seven days. These links expose only the approved PNG, never owner APIs. Publication waits for Printful to report required files as processed successfully. Temporary Printful mockups are downloaded, checked and stored on the persistent backend before public listing. No customer order or charge is created by this workflow.

Supplier products use stable `midnight-factory-<job UUID>` external IDs. Uncertain supplier writes are reconciled by external-ID lookup, not repeated blindly. Uncertain mockup tasks require verified owner reconciliation. Catalog writes use GitHub's file SHA check, stable supplier IDs and an approved `factory-listings.json` manifest; the importer skips unapproved factory drafts. Existing catalog price overrides cannot override the approved factory variant prices. A store ID and supplier ID are marked published only when the live catalog matches the approved title/description and fulfillment prices.

The backend tests use mocked supplier/GitHub/store APIs; they do not create real products. Run `npm test --prefix request-service` and `node scripts/qa-sync.mjs`. Production execution remains blocked without a persistent disk and connected worker.

## Draft, review and automatic modes

New databases default to `review`. The owner-only mode setting persists in SQLite. `draft` checkpoints completed print-file work and saves jobs as `draft_saved`, without requiring known selling costs and without new supplier/product publication writes. Switching back to review returns saved drafts to the approval queue. Review mode requires final owner approval.

Automatic mode must be explicitly enabled with confirmation. It requires configured durable storage and supplier/store credentials, plus a published review-mode test product that the owner confirms has correct placements, resolution, mockups and fulfillment options. Verification records exact immutable draft geometry, variant, technique, category pricing-rule signature and a backend-only supplier credential fingerprint. Each automatic job still needs complete listing copy, actual validated PNGs and current verified variant costs. Untested templates, changed rules or changed supplier credentials hold the job. Reuse the same verified blueprint for coordinated designs; a new variant blueprint must pass its own review test.

Pending automatic approvals are revoked when switching back to review, including jobs already between supplier and store stages. Draft mode blocks new external writes. Operations already submitted to a supplier cannot be undone by a mode switch; their saved IDs remain available for review/reconciliation. Publication rechecks mode and approval immediately before new external mutations. Automatic mode does not connect an artwork generator or a merchandising AI.
