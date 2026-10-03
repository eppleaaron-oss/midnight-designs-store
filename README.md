# Midnight Designs

Dark vintage streetwear storefront for GitHub Pages. Public product data lives in `products.json`; Printful credentials never enter the browser or repository.

## Connect your Printful products

1. In the Printful developer dashboard, create a private token for the store holding your products with read access to sync products. Prefer a store-level token.
2. GitHub repository → Settings → Secrets and variables → Actions → New repository secret. Name it `PRINTFUL_TOKEN`; paste the token there, not in chat or a source file.
3. If using an account-level token, add an Actions variable named `PRINTFUL_STORE_ID` with the intended store ID.
4. For an API/manual store, use the default `/store/products` endpoint. For an ecommerce integration store, set the Actions variable `PRINTFUL_PRODUCTS_ENDPOINT` to `sync`.
5. Add any saved Printful product templates to that store first. The importer reads store products, not standalone templates. Set retail prices and currency on all variants.
6. Actions → Sync Printful catalog → Run workflow. Select the branch containing these changes. This imports names, preview mockups, retail prices, and synced variants. Draft/ignored products and variants without positive retail prices are excluded. After merging, run it on main. Run it again after changing products or prices.

The catalog refreshes approximately every six hours and can be refreshed manually on main. It imports and enriches product data, regenerates product pages, checks the refreshed storefront before committing, explicitly requests a Pages build, and verifies the live products.json matches the saved catalog. Failed imports or checks preserve the committed catalog and timestamp. GitHub schedules may be delayed. lastSyncedAt records the last successful supplier fetch; updatedAt also covers local catalog edits. Owner retail pricing overrides remain authoritative over imported supplier retail prices.

The token remains in GitHub Actions secrets. The importer publishes an allowlist of customer-facing fields and does not copy print files or authorization headers. An empty, invalid, or failed import preserves the existing catalog.

## Current scope

- Responsive homepage, searchable/filterable catalog, product image gallery and actual Printful variant selection.
- Device-local bag using current catalog prices and validated quantities.
- No sample products, invented reviews, discounts or shipping promises.
- Checkout is explicitly unavailable. Payment, server-side order validation, shipping/taxes and Printful fulfillment still need to be connected before selling. Never send paid fulfillment orders from browser code.

Local preview: `python -m http.server 8000` from the repository root. Open `http://localhost:8000`.
Printful API reference: https://developers.printful.com/docs/

## Custom studio
- `catalog.html`: 101 curated AOP clothing/item options from the reviewed Printful catalog. Garment illustrations are concepts, not supplier mockups. Availability and prices must be confirmed; this is separate from the 10 purchasable synced products.
- `designs.html`: four original Midnight artwork images, device-local like/dislike preferences, Choose design flow.
- `custom.html`: gallery or local PNG/JPG/WebP upload (20 MB max), garment selection, placement/size/color concept, quantity/size notes, IndexedDB draft persistence, and downloadable JSON brief with artwork and preview.
- Uploads remain on the customer's device. Drafts are NOT orders; there is no server submission or payment. Never use a generic illustrated concept as a manufacturing file.
- To enable orders: add authenticated server storage, artwork validation, confirmed Printful catalog variant mappings, panel-specific print files and supplier mockup generation, shipping/tax quotes, payment webhook verification and server-side fulfillment. Keep API tokens server-side. Display a final price and exact approved mockup before payment.
- Clothing catalog reference: https://www.printful.com/custom/collections/all-over-print (reviewed September 2026; regional availability changes).
- Run `node scripts/qa-studio.mjs` with Playwright and the static server on port 8000. GitHub Actions checks studio and existing storefront.
