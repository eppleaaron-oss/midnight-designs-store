# Search visibility and optional analytics

## Published search content
21 products have descriptive unique garment titles and product-specific descriptions. catalog-copy.json preserves this editorial copy during supplier sync. Generated products/ID.html pages contain the real product heading, description, front image alt text, available sizes/base colors, materials, fit/care and Product JSON-LD before JavaScript runs. Client scripts keep variant/photo/cart behavior on these routes; original product.html?id= links still work and point to the canonical product page.

Product markup deliberately omits offers, reviews and ratings while checkout is unavailable. It does not claim inventory, purchases or rich-result eligibility. sitemap.xml includes customer content and individual products; admin screens, carts, personal design drafts and the generic product loader are not indexed. No promise of search ranking or immediate indexing. Submit https://midnight-designs.store/sitemap.xml to the owner's Search Console property.

Run node scripts/build-search-pages.mjs after product, price, photo, product-description or template changes. The sync, price and catalog-management workflows regenerate pages and remove snapshots of deleted products. For photo/information-only updates, regenerate before publishing. The generator reads actual catalog data and verified galleries, not generated replacement garment photos.

## Analytics connection — not activated
analytics-config.json has measurementId: null. No analytics provider is loaded and no events are transmitted in that state. To connect a Google Analytics 4 web property, publish its public G-... measurement ID. An API key or secret is not needed in this file.

Before enabling: disable GA4 Enhanced Measurement in the web stream so the provider does not collect automatic URL/search/outbound/form events outside the explicit event list. This app sends clean pathname-only locations with no query strings or referrers. Review data retention in the GA property and restrict reporting access to the owner. Analytics is not a customer/order database.

The tag loads only on shopping pages (home, shop, product and bag), and only after opt-in. It does not load on customer-upload/design, support, or admin pages. Analytics preferences are accessible in customer footers; visitors can decline or revoke. Browser Global Privacy Control or Do Not Track keeps analytics off. Consent write failure fails closed. Revoking stops new event sending, removes analytics activity state and clears accessible GA cookies; it cannot delete events already collected by Google.

## Events
- page_view: a sanitized shopping path.
- view_item: a product and initially selected retail variant; once per document.
- add_to_cart / remove_from_cart: only after a successful saved bag change, with the changed quantity. Blocked storage does not produce a successful-add event.
- view_cart: valid current items, quantities and prices; unavailable variants excluded.
- cart_inactive: a nonempty, consented bag has not changed for 30 minutes. At most once per stored bag activity period.
- cart_returned: a bag changes after its inactivity event.

Items include only public retail product ID/name/category, variant ID, quantity, price and currency. No customer email, support message, uploaded artwork, address or payment information is included. Mixed currencies omit a combined value. No purchase or begin_checkout event is emitted because checkout is disabled.

## Limits of inactive-bag measurement
cart_inactive is a proxy for an unfinished saved bag, not proof of abandoned checkout or lost revenue. A page must still run, or a visitor must return, to observe the elapsed time. If a browser closes and never returns, client-side code cannot send a reliable later event. Activity expires after seven days. Clearing cookies/storage, opting out, blockers and disabled JavaScript reduce coverage.

The report for now is product views → add to bag → view bag, plus inactive/returned bag events. A true paid-order abandonment funnel needs the checkout backend and verified order/purchase events. Customer recovery emails need a permitted email workflow and private backend; they are not implemented here.

Primary references:
- https://developers.google.com/search/docs/appearance/structured-data/generate-structured-data-with-javascript
- https://developers.google.com/search/docs/appearance/structured-data/product
- https://developers.google.com/analytics/devguides/collection/ga4/ecommerce
