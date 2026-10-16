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

The job runs through the existing authenticated, leased backend worker. Basic
requires persistent live storage, a current worker heartbeat, supplier and
store publishing access, review mode, configured budgets and confirmed pricing.
GitHub recovery snapshots do **not** satisfy the live-storage requirement.
Missing prerequisites appear on Basic and block creation. The page never calls
an AI provider for this fixed recipe or silently enables automatic publishing.

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

Approval preserves the product and all approved storefront images. Print files,
download staging and working blueprints are cleared only after supplier file
processing and the live storefront's IDs, variants, prices and images have been
verified. Disapproval checks ownership and deletes only that job's unpublished
supplier draft, then clears its generated pixels. Source design sets, originals,
decisions, recipe, template/file metadata and supplier/store IDs remain.

Cleanup records before/after BLOB usage, reclaimed bytes and reusable SQLite
pages. A failed cleanup retains the open lane; retrying it cannot start another
product. SQLite can reuse freed pages without shrinking its allocated file.
Published photos remain available at their original `/factory-media/` URLs.

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
