// Owner-supplied sizing policy. Versioned migration adds separate Brain records.
export const SIZING_RULES=[
  [
    "blueprint",
    "Supplier geometry is authoritative",
    "Before preparing artwork, resolve the exact Printful catalog product, printing technique, selected variant IDs, and supported print placements. Load native print-file dimensions and required resolution for each distinct variant/template combination. Load the applicable product File guidelines and safe-zone information. Never substitute dimensions from a different garment, printing method, or size. If a required template or safe-zone mapping is missing, stop and identify the missing information.",
    1
  ],
  [
    "blueprint",
    "Separate garment size, print canvas, and artwork size",
    "Garment size means XS, S, M, and so on. Print canvas means the supplier's complete output image for a particular panel. Artwork size means the physical size and position of the graphic within that canvas. Changing graphic size must not change the supplier's required output canvas. Do not stretch artwork to fill a panel just because the panel is large.",
    1
  ],
  [
    "placement",
    "A layout is a saved placement recipe",
    "Every chosen layout must resolve into explicit per-panel data: source artwork, destination placement, intended physical width/height or approved proportional bounds, horizontal and vertical anchor, position, aspect-ratio behavior, background, crop permission, rotation, and mirror setting. Terms such as small, large, and centered must resolve through a numeric preset. Store the resolved layout with that individual job; changing a global default must not alter an item already being reviewed.",
    1
  ],
  [
    "placement",
    "Preset measurements are targets, not supplier limits",
    "Use the approved Midnight Designs sizing presets as starting targets. Supplier print boundaries, safe zones, seams, and supported placements take priority. Verify every selected variant. Show any proposed size reduction and resulting measurements before production. If a design cannot fit safely or would become unreadable, ask for another layout or artwork rather than silently shrinking it.",
    1
  ],
  [
    "artwork",
    "Preserve the artwork's proportions",
    "Fit the approved artwork proportionally within its layout bounds. Do not stretch a square image into a sleeve strip or squash a tall design into a chest rectangle. Cropping, cutting out a motif, removing a background, recoloring, mirroring, and reusing artwork require the appropriate owner permissions. Detect large blank or black margins and flag them when they make the visible graphic smaller than the requested size. Preserve the original file.",
    1
  ],
  [
    "qc",
    "Measure resolution at the final printed size",
    "Use the supplier's resolution requirement for the selected product and technique. Effective horizontal resolution equals usable source pixels across the artwork divided by its printed width in inches; check height as well and use the lower value. Enlarging an image or changing a DPI metadata label does not restore missing detail. Reject files below the required effective resolution unless the supplier explicitly supports a different validated requirement.",
    1
  ],
  [
    "placement",
    "Safe zones, seams, and wearer orientation",
    "Keep essential artwork and text inside the product's actual safe area. Account for zippers, pockets, hems, cuffs, waistbands, and hood seams. Define left and right from the wearer's perspective, then map them to the supplier's panel orientation. Never infer anatomical chest position from the center of an irregular cut-and-sew canvas. Use a reviewed product-specific anchor map. Do not promise perfect alignment across sewn panels.",
    1
  ],
  [
    "color",
    "Black background and intentional blank space",
    "For this Basic AOP workflow, composite a black background across every required exterior print panel, including the required bleed, then place the selected artwork. An intentionally blank panel stays solid black. A missing required graphic is an error, not an intentional blank. Do not assume choosing a black garment dropdown colors white cut-and-sew fabric. For other print methods, use that method's own transparency and background rules rather than applying this AOP rule automatically.",
    1
  ],
  [
    "qc",
    "Required artwork must never disappear silently",
    "If the layout requires a front graphic and the selected set cannot be mapped to that front panel, stop and display which artwork and panel are missing. Do not continue with a black-only front. A black-only front is valid when the owner selected a back-only or intentionally blank-front layout. Do not move back artwork onto a front, sleeve artwork onto a leg, or any other fallback without explicit permission.",
    1
  ],
  [
    "brand-dna",
    "Keep the design set and branding rules",
    "Use original printable artwork from the chosen design set. Never print a product mockup or a photo of a garment as if it were source artwork. Keep the set's style and palette together. Midnight Designs branding normally belongs on a supplier-supported internal label. Small chest artwork means a thematic graphic, not the company logo. Flag unsupported or unassigned labels instead of substituting exterior branding.",
    1
  ],
  [
    "supplier",
    "Validate all selected sizes",
    "Check the variant-to-printfile mapping for every selected size. Reuse a rendered file when variants truly share the same template and artwork geometry. Generate separate files when the supplier requires different dimensions or positioning. By default, keep graphic dimensions consistent in physical inches where they fit safely; proportional scaling must be an explicit layout option. Review affected variants when scaling or placement differs.",
    1
  ],
  [
    "publishing",
    "Preview and production must agree",
    "Show final physical artwork dimensions, output pixel dimensions, effective resolution, destination panels, and warnings before creation or approval. Generate supplier mockups from the actual production files and the actual selected variants. Prefer available people/model views and include front, back, and useful details. If a preview is unavailable or the file-to-panel mapping is unresolved, show the problem. Never treat an attractive mockup as proof that the underlying print files are correct.",
    1
  ],
  [
    "placement",
    "Adult artwork sizing targets",
    "Adult starting targets in inches: tiny accent 2–2.5; small chest 3–4 (default 3.5); centered front 6–8 (7); large front 10–12 (11); statement back 10–13 (12); upper back 8–11; sleeve strip at most 3×12; sleeve/cuff and hood accents 2–3; thigh 3–5 (4); long leg at most 4×16; shorts 2.5–4. These are Midnight Designs targets, never supplier limits. Exact internal-label dimensions come only from supplier guidelines. Use reviewed profiles for children, cropped/fitted cuts, hats and accessories. Numeric Basic recipes enforce the chosen measurements; a source-resolution reduction must be shown and explicitly accepted.",
    1
  ]
];
