# Restore the owner email field before launch

Requested October 15, 2026: temporarily remove the email field from the private owner sign-in form. The owner password and authenticated owner session are still required. The backend already accepts a password-only request, so this change does not modify its authentication checks.

Before the planned October 25 launch:

- Restore the email field in `request-service/public/login.html` and include it in the request in `request-service/public/login.js`.
- Update `request-service/login-browser-test.mjs` to verify that an incorrect email is rejected even with the correct password, and that the intended email and correct password grant owner access.
- Verify the owner sign-in and private AI pages against the deployed backend.

Deployment prerequisite: the current Render backend reports no attached persistent disk. Preserve the full private SQLite database, including uploaded artwork, factory records, and any WAL data, before restarting or redeploying it. A private conversation JSON export does not include all factory records.

Removing the email field will not resolve an incorrect owner password, missing persistent factory storage, or a disconnected production worker.
