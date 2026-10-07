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
