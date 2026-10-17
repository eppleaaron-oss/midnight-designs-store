# Basic sizing and layout recipes

Basic supports numeric, versioned recipes from the existing 66-layout library. Layouts that require a multi-element collage, split chest, pocket continuity, borders, or reviewed full-panel cropping are explicitly unavailable. Adult presets are design targets, never supplier limits. Children's numeric layouts remain held until a separate reviewed sizing profile exists.

## Geometry

Supplier `variant_printfiles` mappings determine each variant's canvas, panel and DPI. Artwork inches determine its pixel size inside that complete canvas. For example, 3.5 inches at 150 DPI is 525 artwork pixels; the exported panel retains its full supplier dimensions. Aspect ratio and source-resolution checks are enforced before enlarging anything. A reduction caused by source pixels or a safe region is shown and requires explicit acceptance and another inspection.

API mockup templates do not establish anatomical coordinates or native safe masks. In Basic, review the exact garment's file guideline and save the safe rectangle plus named anatomical anchor. The map is keyed by product, technique, placement, printfile ID, native dimensions and DPI; only truly identical mapped variants share it. Wearer left/right is explicit. No chest/thigh coordinate is guessed from an irregular canvas center. The reviewer records the guideline/reference used. These are reviewed regions, not a claim of supplier-certified masks.

## Inspection and production

1. Choose a design set, garment and sizes.
2. Select a supported layout and explicitly map its required artwork. Optional blank panels are black. Required missing artwork stops inspection.
3. Review missing garment maps in the app. Adjust artwork inches and positions if needed.
4. Inspect the placement plan. The preview draws the original source image at the exact saved native coordinates; it is labeled a placement preview. Production PNGs are exported after creation, and real Printful mockups use those exported files.
5. Inspection returns a stored receipt for the complete source/layout/variant/profile signature. Changed inputs or stale receipts require inspection again.
6. Creation stores the frozen numeric plan in the Basic recipe, renderer plan and job layout history. Its geometry controls the renderer. Technical QC rejects files that differ from that inspected recipe.

Outfit pieces carry their own layout and receipt. An outfit is checked before queueing, then advances through the existing one-product lane with owner review and verified cleanup. A trusted queued piece uses its saved preflight signature; it does not depend on an old receipt surviving indefinitely. Replacing a rejected numeric piece requires a fresh inspection for its replacement source set.

Existing products and legacy jobs retain their saved recipes. Global layout or garment-map changes do not move artwork in an existing numeric job. Named layouts cannot silently fall back to generic contain fitting. Basic's previous API shape remains compatible for existing integrations; the new Basic controls require a numeric layout inspection before creation.

## Brain and costs

The versioned migration installs 12 separate owner-supplied sizing rules and one adult-target rule into the appropriate Brain sections. A concise sizing policy stays in short worker briefs, while the full records remain visible in AI Intelligence. This is explicit knowledge and deterministic enforcement, not model training.

No AI-provider call, new worker service, paid storage, automatic publishing, price assumptions, or approval bypass is introduced. The current owner review, pricing, supplier-operation recovery and cleanup contract remains in place.


## Combined trouser panels

Pants can use one native front PNG containing two separate cut legs. Leg layouts bind logical wearer-left and wearer-right targets to independently reviewed regions inside that shared canvas. These become separate composition elements in one supplier file; they are never centered across the crotch gap. Sleeve strips from the same design set are offered as matching leg sources, with independent source selectors, inch targets and position presets. Source pixels are not automatically cropped or mirrored.

Conservative rectangles have been checked against the exact front guideline images for Printful 1479 (cotton wide-leg pants) and 618 (track pants), and are bound to their product, printfile and template identities and geometry. An unknown guideline does not inherit these regions. Other combined pants need separately reviewed leg maps. Existing saved owner maps remain preferred. These rectangles are technical placement regions, not supplier certification of the finished garment.

The same multi-element recipe controls the preview, export, source hashes, permissions, minimum effective DPI and quality proof. The complete native canvas is retained up to 90 million pixels for generated supplier files; input artwork keeps its existing 40-million-pixel bound. PNG export composes small resized artwork overlays onto the native canvas without a full JavaScript raw-pixel allocation. Originals and legacy saved jobs retain their recipes. Automatic publishing stays disabled.

All-over cotton must use the live supplier `DIRECT-TO-FABRIC` catalog type together with its `direct-to-fabric` technique. This is recognized as printable fabric coverage; an unverified product name or an unrelated direct-print method cannot bypass coverage checks. Rendering and supplier preparation accept this verified cotton method.
