# Tapestry implementation status — November 1, 2026

This branch implements private preparation only. It is not a completed tapestry production integration and must not be represented as one.

Implemented: owner-authenticated preparation API, two persistent edition records per discovered collection, unique collection/edition keys, original-art checksum/reuse/provenance checks, explicit source assignment, revision history, optimistic edit checks, and AI Made preparation controls. Repeating preparation preserves names and edits. Discovery includes unpublished outfits, idea sets and original upload collections without a fixed result limit. No supplier, publication, homepage or order mutation is implemented here.

The preparation routes deliberately use owner session authentication even when the legacy factory is configured open. A real owner login is required.

Verified supplier catalog: live unauthenticated GET /products identifies Indoor Wall Tapestry as catalog 973. GET /products/973 reports variant 24970 (26″×36″, catalog price 16.06 USD), and 24969 (50″×60″, 23.54 USD). These are supplier catalog prices, not retail prices or confirmed landed costs. The product description inconsistently says 50×62; use exact authenticated variant templates before rendering. Both variants reported US availability at retrieval.

Exact blockers observed:
- GET /mockup-generator/printfiles/973 returned HTTP 401 Unauthorized.
- GET /mockup-generator/templates/973 returned HTTP 401 Unauthorized.
- Live backend GET /api/owner/ai-factory/basic timed out after 25 seconds with no response body; product-editor/library timed out after 20 seconds. Unauthenticated reads subsequently returned HTTP 401. The browser's AI Made view later loaded 205 products and 29 collection filters; private underlying records and supplier duplicate reconciliation were not available through the terminal session.
- The user confirmed My Workspace (eppleaaron@gmail.com). Render identifies the correct backend service, but its available tools do not expose the backend SQLite records or existing Printful secret. Recent backend logs show repeated worker 429/409 failures and network failures. No restart or credential change was performed.
- Existing idea_sets can infer front/back from upload order, or use supplier preview URLs. Those are not sufficient proof of original source roles. This feature requires an explicitly named original or an owner assignment; missing or ambiguous files stay blocked.

Required continuation: restore authenticated live collection access; use backend Printful access with catalog/template/product/mockup scopes; reconcile all existing supplier/app drafts; verify native size templates and safe areas; implement and run one full front/back pilot. Then integrate the existing pricing and product-studio revision engines, permanent production/mockup storage, approval-bound publication, and approved outfit/category visibility. Only after the pilot succeeds may the remaining collections enter supplier preparation.

Current deployment: none. New supplier products: none. New store listings: none. Orders or production charges: none. No collection has been claimed created or approved. The live AI Made pilot detail shows Printful preview thumbnails for Rose Eclipse's displayed original-art images. This does not prove original production files are absent; it means their provenance remains unverified.

Validation: npm test --prefix request-service completed: 423 tests, 421 passed, 2 skipped, 0 failures. The four new tapestry tests passed. Syntax and git whitespace checks passed. No browser QA of the new undeployed preparation panel was performed.

Collection report from live AI Made filters (not a complete backend collection audit): blocked means production preparation cannot proceed until originals, supplier duplicates and authenticated templates are verified; it does not mean a missing original was proven for each collection.

| Collection | Front tapestry | Back tapestry |
|---|---|---|
| Abyssal Voyage | Blocked — verification pending | Blocked — verification pending |
| After the Last Light | Blocked — verification pending | Blocked — verification pending |
| All Things Fade | Blocked — verification pending | Blocked — verification pending |
| Astral Wanderer | Blocked — verification pending | Blocked — verification pending |
| Beauty in Decay | Blocked — verification pending | Blocked — verification pending |
| Blood Moon Covenant | Blocked — verification pending | Blocked — verification pending |
| Blood Moon Reaper outfit | Blocked — verification pending | Blocked — verification pending |
| Borrowed Time | Blocked — verification pending | Blocked — verification pending |
| Crowned Wilds | Blocked — verification pending | Blocked — verification pending |
| Dead Air | Blocked — verification pending | Blocked — verification pending |
| Death’s-Head | Blocked — verification pending | Blocked — verification pending |
| Even in Darkness / Still Growing | Blocked — verification pending | Blocked — verification pending |
| Fate Favors the Fearless | Blocked — verification pending | Blocked — verification pending |
| Kings Never Fall | Blocked — verification pending | Blocked — verification pending |
| Love Leaves Scars | Blocked — verification pending | Blocked — verification pending |
| Loyalty Until Death | Blocked — verification pending | Blocked — verification pending |
| Never Surrender | Blocked — verification pending | Blocked — verification pending |
| No Mercy for Betrayal | Blocked — verification pending | Blocked — verification pending |
| Omens Never Lie | Blocked — verification pending | Blocked — verification pending |
| Raven Sanctum | Blocked — verification pending | Blocked — verification pending |
| Rose Eclipse | Blocked — verification pending | Blocked — verification pending |
| Serpent’s Requiem | Blocked — verification pending | Blocked — verification pending |
| Silence Is Power | Blocked — verification pending | Blocked — verification pending |
| Still Waters Run Deep | Blocked — verification pending | Blocked — verification pending |
| Time Takes All | Blocked — verification pending | Blocked — verification pending |
| Violet Fang | Blocked — verification pending | Blocked — verification pending |
| What Lies Within | Blocked — verification pending | Blocked — verification pending |
| Where Shadows Bloom | Blocked — verification pending | Blocked — verification pending |
| Winter Wolf | Blocked — verification pending | Blocked — verification pending |
