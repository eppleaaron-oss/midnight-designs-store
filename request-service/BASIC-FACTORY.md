# Basic: one set → one tracked product

Open `/ai-factory/basic` from **Basic** in the Factory navigation. The existing
full Factory, Artwork Editor, Intelligence and History remain available. The
page follows the installation's existing `FACTORY_LOGIN_REQUIRED` setting.

Basic selects an existing uploaded or Printful design set, checks an exact live
all-over-print product, selects available sizes, and creates one product recipe.
Random selection attempts a bounded number of live compatible products. The
fixed recipe preserves exact panel assignments and proportions, fills unused
supported panels black, and never substitutes exterior brand graphics. Native
variant blueprints, original artwork permissions and measured source DPI still
control rendering.

Basic has an optional **GitHub working space** mode for one fixed-artwork item
at a time. It uses the existing backend and an authenticated loopback worker,
with no additional Render disk or paid worker. Enable it in Basic using the
private backup connection and a store-scoped GitHub token if needed. Tokens
supplied in the app are encrypted on the backend and never returned.

Encrypted working pixels are stored as deletable attachments on a private draft
GitHub release. They do not enter Git history. Before external effects the
backend confirms a GitHub database checkpoint containing the recipe, lease,
file pointers and intent. Accepted mockup task keys are checkpointed immediately.
A changed remote checkpoint holds the old backend before another effect.
Recovery authenticates the original attachment checksums.

Only deterministic original-artwork recipes run in this mode, so a zero AI
budget is valid. Creative AI and the full batch factory keep their existing
persistent-disk, worker and budget requirements. No automatic publishing is
enabled. Free hosting can sleep; opening the app wakes it and resumes tracked
work. This is not an always-on service or unlimited usage.

One open Basic item is enforced by a database unique index. A stable creation
request ID returns the existing item after a repeated click or uncertain client
response. While that lane is open, the worker cannot claim other queued jobs.
Supplier external IDs, mockup task keys, publication receipts and existing
bounded retries stay attached to that same job. Unknown external outcomes hold
for reconciliation rather than resubmitting blindly.

The technical-quality and pricing checkpoints prepare an unpublished Printful
draft and real mockups. Printful's current `option_groups` select recognized
people/model styles where reported. Missing recognized model options are shown
as a warning and require explicit owner acknowledgement. The saved gallery is
reviewed before **Approve & publish** can queue the final store handoff.

Approval preserves the product and all approved storefront images. GitHub mode
copies approved photos to `images/factory/<supplier-id>/` in the store repository
and verifies their actual live bytes before cleanup. The listing then no longer
depends on the backend staying awake. Temporary private attachments are deleted
after either decision, with deletion verified before closing the lane. Print files,
download staging and working blueprints are cleared only after supplier file
processing and the live storefront's IDs, variants, prices and images have been
verified. Disapproval checks ownership and deletes only that job's unpublished
supplier draft, then clears its generated pixels. Source design sets, originals,
decisions, recipe, template/file metadata and supplier/store IDs remain.

Cleanup records before/after BLOB usage, reclaimed bytes and reusable SQLite
pages. A failed cleanup retains the open lane; retrying it cannot start another
product. SQLite can reuse freed pages without shrinking its allocated file.
Existing `/factory-media/` links redirect to the final store image where present.

New GitHub snapshots retain reproducible print file identities/checksums with
empty pixel placeholders, omit unapproved preview pixels and staging downloads,
and retain approved storefront photos. Existing repository history is not
rewritten. After recovery, **Resume** rebuilds print pixels from the same recipe
with the same IDs and expected checksums, and restores previews from their
recorded supplier URLs without resubmitting accepted tasks. Expired or changed
supplier sources hold for review. Unattended recovery still requires live
persistent storage and the background worker.

## Verification and current limits

`factory-basic-test.mjs` exercises the full native-render → supplier-draft →
accepted-mockup → owner-decision → verified-store → cleanup cycle using local
supplier/store adapters, plus rejection, cleanup failure, deduplication,
temporary-pixel recovery, source permissions and missing-model review. The
browser test checks navigation, actual local API selection, honest blockers and
six responsive screen sizes.

These fixtures do not establish a real live Printful acceptance test. Basic's
history reports a live-cycle receipt only after an actual job verifies its store
listing and cleanup. No product or customer order is created by deploying this
page. A real selected design and garment must still complete that live cycle.

Backup startup also checks the original key derivation from the currently
configured backend credential when a new explicit backup key would otherwise
strand a snapshot. Every candidate must pass
AES-GCM authentication. The successful original key is retained for subsequent
snapshots; no database is reset or unverified plaintext accepted. When none
works, startup reports only the key-source name and a one-way credential
fingerprint so the original configuration can be restored without logging keys.

## Automatic GitHub publishing connection

The public store repository's `basic-github-publisher.yml` workflow authenticates
itself with a signed GitHub OIDC identity pinned to this repository ID, exact
workflow, main branch, public visibility and GitHub-hosted runner. It lends its
short-lived store-scoped workflow credential to the backend over HTTPS; the
credential stays in memory and is revoked/discarded after the publishing window.
No additional owner PAT or Render environment edit is required for this path.

The workflow checks periodically and stays connected while an approved listing
is waiting. Approval queues publication, which may wait for the next GitHub run
and Pages deployment. It never grants owner approval or creates customer orders.
Private artwork storage continues to use the existing separate backup credential.
Optional app-entered store tokens remain supported. No private-repository or
larger-runner jobs are enabled by this workflow.


## Coordinated outfits on GitHub working storage

Basic defaults to the outfit builder. Choose one existing set and 2–11 distinct
supplier categories, with exact garments and optional per-piece size filters.
Starting verifies every choice before creating any work. The saved outfit plan
feeds the same one-item lane; other pieces are metadata until their turn.
Each piece keeps the shared outfit ID and store collection. Originals remain
separate. The optional, explicit primary-panel adaptation uses the set's main
artwork on front/default/leg panels without overriding exact assignments,
changing proportions or inserting branding.

Owner decisions, pricing holds, mockup retrieval and verified cleanup remain
per item. The next piece starts after cleanup, without a second Start click.
The queue can pause or cancel remaining pieces after the active item is settled.
A restart reconciles stable piece request IDs before submitting another job.
A changed set or selected variants holds the pending piece for review.
A disapproved piece prevents the complete outfit group from being advertised;
approved individual products stay live. When every piece is published and
cleaned, the existing public outfit API exposes the coordinated group.
This uses fixed artwork, not creative AI generation or simultaneous paid workers.
