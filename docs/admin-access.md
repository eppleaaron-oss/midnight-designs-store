# Customer deployment and owner access

## Enforced now
- Customer navigation is Store / Designs / Create yours, plus Bag and support links. No public customer page links to Master, Pricing, Layout or AI owner controls.
- _config.yml excludes owner HTML, JavaScript, CSS, AI endpoint configuration, email drafts, owner previews and scripts/docs from the GitHub Pages build. Direct owner-page requests return HTTP 404. Removing links alone is not protection.
- Catalog mutation, price publishing and paid AI workflows run only on main and only when github.actor equals github.repository_owner. GitHub itself requires repository write permission for manual workflow dispatch.
- /admin.html is a public explanation and link to GitHub Actions, not a login implementation. It does not unlock screens, read private records or collect credentials.
- Customer manual garment editing, uploads and saved drafts remain available. They do not grant access to paid AI or order administration.

## Existing owner screens
Files remain in git for local work; no deletion of the owner's tools. On your own trusted computer, from a checked-out copy of the repository:
```bash
python3 -m http.server 8000 --bind 127.0.0.1
```
Open http://127.0.0.1:8000/master.html. This is a local preview, not an authenticated online admin service. Publishing changes and running paid AI still require the owner GitHub account. Do not expose this server on a network or deploy the repository root without exclusions.

## Online dashboard requirement
GitHub Pages is static hosting and cannot enforce per-route server sessions. The full online Master/Pricing/AI dashboard is deliberately unavailable until an authenticated backend or access proxy exists.

For that host, require an authenticated server session and owner allowlist for every admin document, asset, API and paid AI operation. Validate identity on the server, fail closed, issue Secure/HttpOnly/SameSite session cookies, protect mutations against CSRF, rate-limit paid generation, authorize every order/customer read, and provide logout/session expiry. An ordinary customer session is not an admin session. Never use a localStorage flag, browser password comparison or frontend-only redirect as authorization.

No revenue/customer database is currently connected. Real financial or customer records must be private, outside this public git repository. Repository source, history and workflow logs remain public; deployment exclusions are not repository privacy. Do not put credentials or future customer records in source/history/logs.

## Verification
admin-check.yml builds with the same Jekyll action as GitHub Pages, asserts every excluded path is absent from _site, checks 404 for direct owner pages/assets, and exercises public pages, navigation and garment editing against the built deployment. Existing source-based owner tests continue to verify preserved local tools. No real paid AI or store mutations are invoked in these tests.

References:
- https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- https://jekyllrb.com/docs/configuration/options/
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
