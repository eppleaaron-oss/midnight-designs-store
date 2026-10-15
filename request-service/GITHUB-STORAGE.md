# Private GitHub recovery storage

GitHub stores encrypted, versioned recovery snapshots of the entire SQLite
database, including original artwork, edited images, native print files, mockups,
customer requests, Factory settings and production history. GitHub is not the live
job database. The existing persistent-storage checks for unattended workers and
automatic publishing remain in force.

## Configuration

Configure these backend environment variables, keeping all credentials off the
storefront and out of both repositories:

- `FACTORY_BACKUP_REPO=eppleaaron-oss/midnight-designs-data`
- `FACTORY_BACKUP_GITHUB_TOKEN`: GitHub token with Contents read/write access to
  this private repository. If omitted, the existing `CATALOG_GITHUB_TOKEN` is used
  only if it has the necessary private-repository permissions. The ChatGPT GitHub
  connector does not automatically grant access to the deployed application.
- `FACTORY_BACKUP_ENCRYPTION_KEY`: optional independent 32-byte key encoded as
  64 hexadecimal characters. If omitted, encryption is derived from the existing
  backend `OWNER_PASSWORD_HASH`. Preserve that exact hash across recovery and
  password changes, or preserve the independent key when one is configured.
- `FACTORY_BACKUP_INTERVAL_SECONDS`: default 300, minimum 60. Changes since the
  last completed backup can be lost in an abrupt restart, termination or spin-down.
- `FACTORY_BACKUP_MAX_MB`: default 512, maximum 2048. Oversized databases are held,
  not silently truncated. Repository growth is also held at the 1 GB safety limit.

Do not enable this configuration for the first time on an empty ephemeral
deployment and expect it to retrieve data from the previous deployment. It cannot
access the previous instance's filesystem.

## First production backup and migration

1. Obtain a complete, consistent copy of the current running database before any
   restart, disk attachment or redeployment. The existing `/api/owner/export`
   route exports customer conversations only and is NOT a complete Factory backup.
2. Run the new backend with that existing local database and the configuration
   above, using the same backend owner password hash and provider credentials.
3. Open the private Factory's **Storage** section and select **Save first backup**.
   The confirmation makes initialization explicit. Nothing is uploaded to GitHub
   until initialization or a previously initialized snapshot is present.
4. Wait for a confirmed timestamp and commit ID. Verify recovery on a separate
   temporary copy before deleting or replacing the source database.
5. A subsequent deployment with a missing local database restores this snapshot
   before opening the HTTP listener. Missing, unreadable, oversized or corrupted
   snapshots stop startup instead of producing an apparently empty workspace.

On Render's Free service there is no SSH/Shell or persistent disk. With the
currently deployed application lacking a full-database export, the initial live
copy cannot be downloaded through the Render/GitHub connectors. This is an
unresolved migration blocker, not a completed transfer. No empty test database
should be substituted for the owner's current records.

### Explicitly starting a new, empty workspace

If the owner expressly approves losing the previous runtime's records and
starting fresh, `FACTORY_BACKUP_INITIALIZE_FROM_COMMIT` may be set to the exact
current commit SHA of the empty private backup repository. This does not transfer
or recover the previous data. The backend creates its new default database and
saves its first encrypted GitHub snapshot **before accepting HTTP requests**.
If the save fails, startup stops. That snapshot advances the repository branch;
the old initialization pin cannot authorize another empty start on a later
restart, even if the manifest goes missing. Never enable this mode as a substitute
for a preservation-first migration without the owner's explicit approval.

## Backup integrity and limits

- Only repositories confirmed private by GitHub are accepted.
- SQLite's native backup API captures a consistent snapshot, including WAL writes.
- Each chunk and the manifest are authenticated with AES-256-GCM. Plaintext
  artwork, customer records, keys and database files are never committed.
- Unchanged encrypted chunks are reused; current snapshots use immutable Git
  blobs and one atomic, non-forced branch update. Older snapshots remain in Git
  history, so repository size grows as data changes.
- A timestamp advances only after the remote branch confirms the new commit.
  Conflicts hold backups for owner review rather than overwriting another writer.
- Transient failures retry with limits. Rate-limit headers postpone retries, and
  content-writing requests are paced at least one second apart.
- Restore streams to a separate temporary file, authenticates every chunk,
  checks the full SHA-256 and SQLite integrity, then atomically installs it without
  overwriting an existing database.
- The UI displays unsaved changes and errors. It does not claim zero data loss,
  unlimited storage, continuous production or a passed live garment acceptance test.

Run `npm test --prefix request-service` for backup, corruption, privacy,
authentication, conflict and full-schema recovery tests.
