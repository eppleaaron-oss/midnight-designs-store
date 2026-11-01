# Tapestry implementation status — November 1, 2026

This branch implements private preparation only. It is not a completed tapestry production integration and must not be represented as one.

Implemented: owner-authenticated preparation API, two persistent edition records per discovered collection, unique collection/edition keys, original-art checksum/reuse/provenance checks, explicit source assignment, revision history, optimistic edit checks, and AI Made preparation controls. Repeating preparation preserves names and edits. Discovery includes unpublished outfits, idea sets and original upload collections without a fixed result limit. No supplier, publication, homepage or order mutation is implemented here.

The preparation routes deliberately use owner session authentication even when the legacy factory is configured open. A real owner login is required.

Verified supplier catalog: live unauthenticated GET /products identifies Indoor Wall Tapestry as catalog 973. GET /products/973 reports variant 24970 (26″×36″, catalog price 16.06 USD), and 24969 (50″×60″, 23.54 USD). These are supplier catalog prices, not retail prices or confirmed landed costs. The product description inconsistently says 50×62; use exact authenticated variant templates before rendering. Both variants reported US availability at retrieval.

Exact blockers observed:
- GET /mockup-generator/printfiles/973 returned HTTP 401 Unauthorized.
- GET /mockup-generator/templates/973 returned HTTP 401 Unauthorized.
- Live backend GET /api/owner/ai-factory/basic timed out after 25 seconds with no response body; product-editor/library timed out after 20 seconds. Live collections and duplicates could not be audited.
- The user confirmed My Workspace (eppleaaron@gmail.com). Render identifies the correct backend service, but its available tools do not expose the backend SQLite records or existing Printful secret. Recent backend logs show repeated worker 429/409 failures and network failures. No restart or credential change was performed.
- Existing idea_sets can infer front/back from upload order, or use supplier preview URLs. Those are not sufficient proof of original source roles. This feature requires an explicitly named original or an owner assignment; missing or ambiguous files stay blocked.

Required continuation: restore authenticated live collection access; use backend Printful access with catalog/template/product/mockup scopes; reconcile all existing supplier/app drafts; verify native size templates and safe areas; implement and run one full front/back pilot. Then integrate the existing pricing and product-studio revision engines, permanent production/mockup storage, approval-bound publication, and approved outfit/category visibility. Only after the pilot succeeds may the remaining collections enter supplier preparation.

Current deployment: none. New supplier products: none. New store listings: none. Orders or production charges: none. Live per-collection status is unavailable; no collection has been claimed created or approved.
