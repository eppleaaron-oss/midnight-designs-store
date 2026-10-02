# Shipping information reference
Reviewed 2026-10-02. Public shipping.html is a planning guide while checkout remains disabled. No customer shipping rate, free shipping threshold or active country offer has been set.

Production: https://www.printful.com/shipping (2–5 business days). Route transit: https://help.printful.com/hc/en-us/articles/50265078577041-What-shipping-options-are-available (standard domestic US/Canada 3–4; international from US/Canada/Europe 5–20). Combined ranges are arithmetic sums, not destination quotes. Custom design review adds time before production.

Current destination exceptions: https://help.printful.com/hc/en-us/articles/50265153665681-Which-countries-does-Printful-not-ship-to . Use the Help Center restriction list; the general shipping landing page currently conflicts on some countries. Do not assume a non-excluded country guarantees any item is deliverable.

Limited destinations: https://help.printful.com/hc/en-us/articles/50263168837137-Are-there-shipping-restrictions-for-certain-outsourced-products . Retail catalog 963 (utility backpack) has a product-page notice. Selected custom items can also have restrictions. Revalidate country, territory, source, carrier and variant availability before accepting an order.

Launch requirements: protected server-side shipping quote integration with exact items and address, published retail shipping policy, complete shipping/tax payable total, payment and order submission, carrier tracking notifications, and an actual customer support channel. Never expose supplier credentials in static JS. Keep checkout disabled until these are connected. No shipping quote or order is submitted by these pages.
