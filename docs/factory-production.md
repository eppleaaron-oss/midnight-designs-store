# Continuous production activation

The repository includes an independent Node worker (`request-service/factory-worker.mjs`) and a SQLite lease queue hosted by the authenticated backend. The worker polls authenticated machine endpoints, checkpoints one step at a time and drains its current checkpoint on SIGTERM. A browser is not involved in execution.

## Activation and costs

For the large native-area renderer, plan a `1c-2g` backend (2 GB RAM), attach a 5 GB persistent disk at `/var/data`, and create one `0.5c-512mb` background worker from `render.factory.yaml`. At the checked Render prices, this is $25/month for the backend + $7/month for the queue worker + $1.25/month for a 5 GB disk: $33.25/month before bandwidth, workspace fees and AI usage. Pricing sources: https://render.com/pricing and https://render.com/docs/compute-plans. Verify prices before activation. Large native-area rendering also needs enough memory on the backend, where the renderer executes. Do not create a second backend. Worker creation and disk attachment require the Render dashboard because the connected tools do not expose those operations.

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

The worker renders print files, creates approved Printful products, generates and saves supplier mockups, and verifies approved listings on the live storefront. Optional AI-assisted layout uses the Responses API with resized copies of assigned artwork. It records usage and reserves costs before calling a model. The private Artwork Editor adds real generative edits and deterministic background removal before print preparation. Provider charges use verified token usage or manual owner reconciliation; automatic provider billing import and seam-continuity rendering remain outside this implementation.

## Reliability

Claims use SQLite transactions and expiring leases. Expired jobs recover from the last saved checkpoint, with bounded crash/retry counts. Completed checkpoints are unique per job and step. Supplier failures back off exponentially; terminal failures need review. Queue priorities are 0–9, concurrency 1–4, and schedules use an IANA timezone (default America/Denver), including overnight windows. Identical start/end means all day. Zero targets mean unlimited prepared designs; targets count completed preparation, not published products.

Budget reservations are atomic across jobs and count unresolved operations conservatively against both daily and total limits. Settlement records actual cost once. Ambiguous external effects block retry until the owner verifies either a provider result/actual charge or that nothing was created, published, or charged; actual cost exceeding its reservation is recorded and pauses the factory. Fixed layouts use local rendering and supplier/catalog operations. AI-assisted layouts make metered model calls only when enabled and configured.

Production status exposes genuine worker heartbeats and storage readiness. Start/Resume require a live worker, durable storage and spending limits. Pause/Stop prevent further claims, and Emergency Stop cancels queued, retrying, waiting and running work. In-flight provider requests cannot be undone by a stop; leases prevent stale results from being checkpointed.

## Approved product publishing

The owner-only publishing panel saves final title, description, tags, category and collections. The backend checks actual PNG integrity, dimensions, checksums, all assigned variants and current pricing before approval. Preparation stops at owner review; approval queues supplier creation, mockup processing and store publication under the same worker leases and concurrency limit. Files or pricing changed after a supplier product exists require a replacement job.

Activation additionally requires a backend `PRINTFUL_TOKEN` with product-read/write and mockup access (`PRINTFUL_STORE_ID` is needed for account-wide tokens; single-store tokens work without it), and backend `CATALOG_GITHUB_TOKEN` with repository contents write and Actions workflow dispatch access. GitHub Actions needs its existing Printful token/store configuration and working Pages deployment. Keys remain backend-only. Embroidery or techniques needing additional options remain held until a dedicated adapter is added.

Approved print files are shared with Printful through random 256-bit capability URLs expiring after seven days. These links expose only the approved PNG, never owner APIs. Publication waits for Printful to report required files as processed successfully. Temporary Printful mockups are downloaded, checked and stored on the persistent backend before public listing. No customer order or charge is created by this workflow.

Supplier products use stable `midnight-factory-<job UUID>` external IDs. Uncertain supplier writes are reconciled by external-ID lookup, not repeated blindly. Uncertain mockup tasks require verified owner reconciliation. Catalog writes use GitHub's file SHA check, stable supplier IDs and an approved `factory-listings.json` manifest; the importer skips unapproved factory drafts. Existing catalog price overrides cannot override the approved factory variant prices. A store ID and supplier ID are marked published only when the live catalog matches the approved title/description and fulfillment prices.

The backend tests use mocked supplier/GitHub/store APIs; they do not create real products. Run `npm test --prefix request-service` and `node scripts/qa-sync.mjs`. Production execution remains blocked without a persistent disk and connected worker.

## Draft, review and automatic modes

New databases default to `review`. The owner-only mode setting persists in SQLite. `draft` checkpoints completed print-file work and saves jobs as `draft_saved`, without requiring known selling costs and without new supplier/product publication writes. Switching back to review returns saved drafts to the approval queue. Review mode requires final owner approval.

Automatic mode must be explicitly enabled with confirmation. It requires configured durable storage and supplier/store credentials, plus a published review-mode test product that the owner confirms has correct placements, resolution, mockups and fulfillment options. Verification records exact immutable draft geometry, variant, technique, category pricing-rule signature and a backend-only supplier credential fingerprint. Each automatic job still needs complete listing copy, actual validated PNGs and current verified variant costs. Untested templates, changed rules or changed supplier credentials hold the job. Reuse the same verified blueprint for coordinated designs; a new variant blueprint must pass its own review test.

Pending automatic approvals are revoked when switching back to review, including jobs already between supplier and store stages. Draft mode blocks new external writes. Operations already submitted to a supplier cannot be undone by a mode switch; their saved IDs remain available for review/reconciliation. Publication rechecks mode and approval immediately before new external mutations. AI layout is an independent setting. Automatic publishing does not itself enable creative image editing; it publishes only jobs whose files, pricing and reviewed templates pass checks.

## Employee management

`/ai-employees` is owner-only, including its JavaScript asset and all management API routes. Cards combine creator and supporting profiles with collection scope, frozen task guidance, allowed worker stages, completed product links, recorded usage, historical retry/error events and per-employee concurrency (bounded by global concurrency). Separate supporting employee costs are not yet metered; the interface states this instead of duplicating creator charges.

Pause, removal, action permissions and collection scope are enforced at worker claim and checkpoint boundaries, and rechecked before supplier/store mutations. Removal archives the employee while preserving tasks and costs. Restore leaves it paused until explicitly resumed. Supporting task reassignment requires the same role and an active target; creator reassignment revalidates supplier/category compatibility and resets preparation, approval and pricing-cost checkpoints. Active leases, completed products, created supplier products and unresolved external operations cannot be reassigned. Historical charges and retry events retain their original employee attribution. In-flight requests already submitted to a provider cannot be undone by pause or removal.


## Production history and recovery

Master-only `/ai-history` and `/api/owner/ai-factory/history` provide product records, version/file downloads, lineage, worker/master attribution and cursor-paginated factory activity. Database triggers keep append-only before/after metadata for factory changes, including reassignment, costs, retries, policy changes and publication. Baselines imported on upgrade identify unknown original authors rather than attributing them to an employee. Worker events identify the assigned creator and frozen supporting profiles; this records shared worker processing, not separate AI generation calls. Heartbeat/lease renewals and secret capability links are excluded.

Listing creation, approval/status changes and publication freeze exact template/area definitions, the latest print-file IDs and checksums, artwork references, instructions, supplier cost confirmations, pricing rules, employee assignments and usage. Original artwork, edited versions, PNG exports and mockups are immutable binary rows. Metadata revisions remain in the audit log. History and file bytes persist only when the service uses durable storage; the current free deployment still requires downloads and storage activation.

Duplicate/revise makes a linked, unapproved draft with independent copied blueprints and PNG versions, the original creator/audience guidance and listing copy. It does not copy supplier IDs, store IDs, outfit membership, cost confirmations, charges, checkpoints or approvals. Revisions require a new brief. New drafts have an explicit queue action. Interrupted restored jobs retain their checkpoints and require Resume; exhausted retries need a revision. Live/running jobs and unresolved cost/supplier effects cannot be archived. Archive retains all data and disables processing; restore never silently publishes.

Unpublish retains the Printful product and order history. It writes an ID tombstone in `factory-listings.json`, requests catalog synchronization, and remains `unpublishing` until public `products.json` omits that ID and its product page returns 404. The importer honors withdrawals even when Printful does not expose factory external IDs, and allows an empty catalog when withdrawals removed the last product. The existing page builder removes stale product pages. Retries reuse the same tombstone and cannot recreate the supplier product. Withdrawn originals cannot be reapproved; make a replacement draft. Store withdrawal requires durable storage and backend GitHub publishing access.


## Backend print-file preparation

Install dependencies before the backend build checks: `npm ci --prefix request-service && npm test --prefix request-service`. The backend renderer uses the pinned Sharp dependency. Updating source code without changing the existing Render web-service build command will not install this dependency. The worker Blueprint now uses the install-and-test command as well.

In the private blueprint library, save an exact product/variant blueprint and select artwork, fit, background fill and transform controls. **Prepare this print file on the backend** executes those controls on the server and stores a real PNG. The private Artwork Editor can create background-removed versions on the backend. Optional browser edits must still be saved as a version before server preparation. The original upload is never overwritten.

Production runs save structured rendering settings alongside their jobs. When a creator has blueprints for exactly one supported supplier product, the run assigns that product and clones its variant print-file sets for each job. For verified all-over-print products, the worker's `files` checkpoint prepares every required area from the saved placement plan and run color. Other garment types require selection of the actual fabric color; printing a black rectangle cannot change the unprinted fabric. Separate jobs do not overwrite each other's exports. Unknown products, missing placements, inadequate resolution and revoked artwork permissions hold the job with a reason. Busy renderers retry through the queue's existing bounded retry policy.

The renderer supports permission-controlled recolor tinting, PNG/JPEG/WebP inputs, exact pixel dimensions, solid or transparent fill, proportional contain/cover, scale, position, rotation, horizontal mirroring, percentage crop, patterns and spacing. Source DPI is checked before enlargement. Crop and Modify permissions and pixel protection are enforced. Outputs include original source checksums and immutable recipes, are cached only for matching recipes/permissions/blueprints, and are saved atomically. Each area is limited to 40 million pixels, each PNG to 25 MB and one atomic rendering batch to 64 MB, within configured print-file storage limits. Automatic jobs save one native area at a time and resume matching completed areas after interruption; manual multi-area requests remain atomic.

Raster rendering applies real pixels; the optional model planner produces structured renderer recipes, not new generative artwork. Opaque backgrounds embedded in artwork remain part of that artwork; background fill only affects uncovered pixels. Cross-panel seam continuity still needs an approved layout: switch off **Continue artwork across panels** for independent-area rendering. Garment fit, safe areas, bleed and aesthetics still need review. The Idea Room now uses this same worker workflow and cannot bypass rendering, review, pricing or mockup generation. Existing products made through the older direct path are labeled supplier-created; their IDs are retained and they are not recreated as duplicates. This code update does not activate paid infrastructure or change the live storefront by itself.


## Unified five-engine workflow

Idea Room approval and preparation now both create one real job per requested piece. A 14-piece outfit means 14 product jobs; accepted pieces are retained when another piece fails. The job records an outfit ID, exact available variants, independently saved live blueprints, original artwork references, print/fabric color mode and draft listing copy. Supplier imports use original Printful-hosted image bytes, retain originals separately, and default to no Crop/Modify/Recolor permission. Other file hosts require an owner upload.

For all-over-print products, the native print areas receive the chosen printable background plus the artwork. For regular garments, available fabric-color variants are selected and unassigned optional print placements are omitted; the print-file background remains transparent. Missing audiences, unsupported variants/areas, snapshot-only blueprints, unknown original files, low DPI and storage quotas produce explicit holds. Labels require a separately assigned label file. Independent-area rendering does not solve matching pockets, seams, safe areas or bleed automatically; reviewed templates are still necessary.

Each selected variant receives a supplier base quote in USD. Unknown extra-print charges and absorbed shipping hold pricing. The master can confirm charges for all quoted sizes in one action and optionally remember them for the identical product, technique and placements for seven days. Category fee/margin/discount/price-cap rules still apply to every variant. This avoids assuming zero extras or inventing a fallback supplier cost.

Mockup tasks use the actual saved native print files. Task IDs are persisted; each variant's downloaded images are committed atomically so one successful download does not hide another failed image. Saved images are available through a master-only preview; public image routes become available for catalog publication. Live verification includes saved image URLs as well as listing and fulfillment prices. The Idea Room reports actual worker holds/states; supplier product creation alone is not labeled published.

### Optional AI-assisted layout

Enable **AI-assisted artwork layout** in the private Idea Room after configuring these backend environment values:

- `OPENAI_API_KEY`: private provider credential.
- `FACTORY_AI_MODEL`: an accessible vision model that supports Responses structured outputs.
- `FACTORY_AI_INPUT_CENTS_PER_MILLION` and `FACTORY_AI_OUTPUT_CENTS_PER_MILLION`: verified current model prices in **cents per million tokens**, not dollars.
- `FACTORY_AI_MAX_JOB_CENTS`: per-product reservation cap in cents (default 100).

The model receives resized copies of assigned images, exact blueprint area dimensions, protected assignments and owner/creator instructions. Its response can choose contain/cover, scale, offset, rotation, mirror, patterns/spacing and tint colors. Backend validation rejects unsupported areas, changed assignments, denied permissions and invalid ranges before rendering. Crop clipping and source DPI are checked again against the real originals. Fixed mode performs the explicit saved recipes without a model call; the interface never calls that AI generation.

Reservations include serialized request size and conservative image-token headroom; actual provider input/output usage is recorded once at the configured rates, rounding upward to cents. Missing configuration or insufficient budget holds the request. Unknown provider outcomes retain reserved spending and need owner reconciliation before retrying. Successful layout results are persisted by job, blueprint, artwork, permissions, guidance and model fingerprint; an engine restart does not repeat a paid call. Model output that is refused/invalid may still incur recorded provider usage and requires review rather than repeated automatic paid attempts.

Deployment still requires preserving the current SQLite/artwork data, installing Sharp on the existing Render web service, attaching durable storage, and activating the authenticated worker. The provider credentials and model-rate configuration live on the backend only. Run `npm ci --prefix request-service && npm test --prefix request-service`; the integration tests simulate supplier/provider/store responses and do not spend money or publish real products.

Print-file limits default to 512 MB and 8,192 saved files. `FACTORY_PRINT_STORAGE_MB` (64–10,240 MB) and `FACTORY_MAX_PRINT_FILES` (256–32,768) can raise those limits for durable storage. For large outfit/size batches, the proposed 5 GB disk can use a 3,072 MB print-file budget; leave space for artwork, mockups, history and SQLite overhead. Archiving records preserves their bytes and does not reclaim storage. Watch actual disk capacity and back up before migration or increasing quotas. Owner GET `/api/owner/ai-factory/rendering` exposes the quota, current usage and model configuration readiness without keys.

The command center Start Factory button now starts the authenticated backend queue before submitting Idea Room outfits. Explicit master preparation enables the chosen creator roles; removed roles remain blocked. Autopilot does not reactivate paused roles. Quick runs and the command center report the actual provider configuration status instead of a hard-coded disconnected flag. `factory-start-browser-test.mjs` verifies the real page controls against an isolated service; the dedicated GitHub factory check installs its browser dependencies separately from the Render backend.

The private Idea Room has a persistent base garment / print background color setting (Black initially). New ideas use that setting for actual printable fills or fabric-variant selection. Changing it rebuilds waiting ideas; already queued, reviewed or published items keep their original color.


## Clothing color verification

Automatic production verifies the live Printful product type and selected printing method before deciding between fabric colors and full-panel print backgrounds. A product name alone cannot authorize all-over printing, and sublimation on a mug does not imply garment-wide coverage. Native blueprint requests use the resolved supplier method; mockups use the resulting native files and actual variant IDs. Missing or conflicting AOP evidence holds the job.

Regular garments select an actual available supplier variant in the requested color for each size. Quick production remaps its unrendered per-job blueprint to that real color variant; missing black stock holds rather than falling back to white. Only assigned artwork areas receive transparent-background print files. Color and variant availability are checked again before supplier creation.

Verified AOP jobs render every native supported panel, including panels with no assigned artwork, to an opaque selected background over the complete supplier file dimensions. This fills native bleed pixels where included in the supplied print file; safe zones, seams and cross-panel art alignment still need template review. Unsupported hood/sleeve requests hold. Prepared files cannot silently be reassigned when supplier geometry changes. Hardware, zippers and unprintable surfaces are not recolored, and sublimation on white fabric can still show lighter seams or become lighter when stretched.

Store listings show the actual printed background color for AOP garments while preserving `supplierBaseColor`, fulfillment IDs and size variants. Approval fingerprints include the color mode and garment color, and live publication verification checks the displayed color. Tests verify native dimensions, DPI and all four black panel edges, regular black variant selection with transparent uncovered pixels, missing-color holds, capability holds and preservation of printed colors during catalog sync.


## Private backend artwork editor

Open `/ai-artwork` from AI Factory. Both the page/script and every editor action require the authenticated master account. The page provides original uploads, permission/guidance controls, source analysis and previews, background removal, recolor tint, proportional resize, creative AI instructions/references, future-job rules, worker controls, budget/provider setup, queued tasks, saved versions, and native print-area transform/export controls. Deterministic artwork analysis estimates a flat border background and edge-connected foreground bounds; it is not semantic recognition. Optional AI-assisted layouts now also save vision estimates of subject, background and palette for their assigned images. Those estimates appear in the editor.

Deterministic editing uses Sharp and preserves original bytes. Flat-background removal floods from all edges while preserving enclosed matching-color subject features. Complex backgrounds hold for a reviewed AI edit rather than removing arbitrary subject pixels. Recolor is a tint, not semantic object-by-object replacement. Resize stays within proportional bounds without enlarging the source. Exact print rendering remains separate: containment/cover, position, percentage crop, rotation, mirroring, pattern repetition/spacing and opaque/transparent background run on the native blueprint canvas. A tested 4,000 × 4,000 PNG canvas has exact dimensions/DPI; image generation does not invent source resolution. Edited images can be fitted at their actual resolution in automatic jobs, and inadequate resolution still holds larger requested artwork.

Creative changes call OpenAI `POST /v1/images/edits` with permitted source/reference image data, owner instructions, collection palette, selected model/size/quality/background and PNG output. Up to three references must be in the source collection. Models are not guessed. The owner explicitly confirms provider processing before a creative standalone edit or future-job rule is saved. Creative edits require Reuse, Modify, Recolor and Crop on source and references, with pixel protection off, because a generative model can change colors and framing. Root-original permissions are intersected with edited-version permissions and rechecked when saving/rendering/publishing. Pixel locks are enforced by denying creative submission, not by promising a prompt will preserve exact pixels. When combined, creative editing happens first, followed by the selected deterministic finishing operations.

Configure the image connection **inside the private editor** using a model accessible to the API account, its verified current token prices in cents per million, a per-edit reservation and an optional key. Keys entered here are AES-256-GCM encrypted in the backend SQLite database using a key derived from the private server owner-password hash; they are never returned in API snapshots or saved in the browser. Persistent storage is required before saving this connection. Back up that database and preserve the server password hash; changing the hash requires re-entering the image key. Model/rate edits apply to new submissions; an in-flight call uses its captured configuration. Responses layout settings are separate from image-edit settings.

Existing backend environment configuration also works:

- `OPENAI_API_KEY` (or the legacy `AI_IMAGE_API_KEY` with OpenAI provider).
- `FACTORY_AI_IMAGE_MODEL`: exact accessible GPT image model ID.
- `FACTORY_AI_IMAGE_TEXT_INPUT_CENTS_PER_MILLION`, `FACTORY_AI_IMAGE_INPUT_CENTS_PER_MILLION`, `FACTORY_AI_IMAGE_OUTPUT_CENTS_PER_MILLION`: verified prices, not guessed defaults.
- `FACTORY_AI_IMAGE_MAX_EDIT_CENTS`: conservative per-edit reservation, default 200 cents.

The worker reserves that configured amount atomically against factory budgets, submits the image request on the backend, then defers the job while a saved response is produced. Outstanding calls still consume a global concurrency slot. Success stores PNG bytes, analysis, provenance and the provider request reference. Verified text/image/output token usage settles the reservation exactly once, rounded upward to cents. The reservation is an application check, **not a provider-enforced spending cap**; a returned charge above it is recorded and pauses the factory. In-flight provider work cannot be canceled retroactively by Emergency Stop.

A restart or lost response retains an uncertain reservation and never repeats a paid edit blindly. Missing usage preserves a valid returned image but holds its application until master reconciliation on the same page. Reconciliation is blocked while the request is running. A saved provider image cannot be declared “no external effect.” Valid images that fail transparency/finishing checks remain previewable for review and do not automatically become approved artwork. Rejected 400/401/403/404/422/429 requests release their reservation but require an explicit owner retry; they do not loop automatically.

Standalone artwork jobs use creator permissions/queue controls and stop after their editing/file checkpoint; they never enter supplier or publishing stages or count as manufactured products. Future product jobs freeze their editing recipe when queued, save/reuse the edited source first, then prepare independent native files for front/back/sleeves/hood only where supported. The same source, permitted recipe, guidance, palette and image model reuse the cached result across outfit pieces. Changed source guidance/permissions during a started job requires review/new work instead of silently paying again. Originals, edited versions, output checksums and recipes are retained, with worker/master history. Storage bounds are 16 million pixels per artwork edit, 25 MB per edited PNG, 200 MB cached edit results and the existing artwork library limit of 256 files / 200 MB. Hitting quotas holds rather than deleting files; archiving does not reclaim bytes.

API reference: https://developers.openai.com/api/reference/resources/images/methods/edit and https://developers.openai.com/api/docs/guides/image-generation (checked October 13, 2026). The image request uses high input fidelity only for GPT image 1/1.5; later models use their supported defaults. Tests use provider/supplier fixtures without actual AI charges or live products. `npm test --prefix request-service` covers real-pixel edits/exports, worker checkpoints, permissions, encrypted credentials, paid-request recovery, usage, concurrency and native panels. `node request-service/factory-start-browser-test.mjs` exercises the private page controls at desktop/mobile widths.

**Code readiness is not production activation.** The existing free service still needs a safe backup/migration, the approved disk/worker setup and an install-and-test build. Do not deploy over existing ephemeral uploads while a full current SQLite backup cannot be obtained.
