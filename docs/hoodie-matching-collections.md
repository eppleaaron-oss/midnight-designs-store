# Matching hoodie collections

The matching-collection preset reuses the existing published hoodie and selects 19 exact supplier products: oversized tee, long sleeve, crewneck, bomber, windbreaker, pants, shorts, leggings, crop top, backpack, fanny pack, tote, men's and women's high-top shoes, gaiter, bandana, reversible bucket hat, beanie and flag.

Basic now permits 20 distinct supplier products and multiple products handled by one creator. Each piece retains its own audience. An explicit option includes supplier products whose audience is unspecified; it never modifies supplier metadata, overrides a declared fit, permits unknown children's fits, or adds an unsupported unisex marketing tag. Product availability is not proof of supported native print files: inspection still verifies the live blueprint and printing method.

The legacy unique constraint on (outfit, creator role) is migrated without dropping item IDs, links or history. The existing hoodie is linked as an already published product, with no duplicate manufacturing job. Existing request IDs and per-item review/cleanup gates remain.

`POST /api/owner/ai-factory/basic/outfits/plan-hoodie-collections` saves metadata-only requests using selected source set IDs and the verified store catalog. It may run while another item is active. Requests have status `planned`, explicitly state that production has not started, and retain missing-source/catalog/layout errors. Repeating the same source request does not duplicate it. Planning makes no paid AI call, supplier mockup request, supplier product, order or storefront write.

Basic shows saved requests separately from production. Load a request to inspect the actual native layout for every selected garment. A preset or plan is not an inspection receipt. Converting a request into production requires current numeric layout inspections, reuses its hoodie and preserves the existing one-item production lane. Review and verified cleanup still precede the next item. Existing artwork can use the deterministic renderer without a paid image model; creative redrawing still requires a configured provider.

An unmatched request stays blocked until an owner selects the correct original artwork set and uses **Attach selected original artwork set**. Rebinding clears prior inspection receipts and does not start production. A different request already using that source is reported instead of duplicated. A photographed garment is never silently substituted for its original print artwork.
