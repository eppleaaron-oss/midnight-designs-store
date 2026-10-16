# Factory access without sign-in

Set backend `FACTORY_LOGIN_REQUIRED=false` to open the Factory directly without
an email, password, owner session or browser login. The default is `true` for
existing installations. Invalid values stop startup rather than silently changing
access. The environment setting is read only by the executable backend entry
point; test-created services retain their explicit/default settings.

This setting opens all Factory pages, assets and `/api/owner/ai-factory` controls,
including artwork, the AI workforce, Intelligence, production, pricing, review,
publishing and backup controls. Anyone with the URL can use these controls and
start actions that consume credits or publish products. The storefront does not
gain customer-facing Factory navigation.

Factory login links redirect directly to their destination, and Factory pages
remove their sign-out control. Supplier authorization errors are shown as service
errors rather than sending users back into a login loop. History identifies these
changes as `public_factory` access, not an authenticated master account.

The separate Request Center, customer messages/attachments, order administration,
analytics and general master login keep their existing authorization. Opening the
Factory does not issue an owner cookie or unlock those routes. Provider keys stay
on the backend; validation, budget limits, publishing checks and worker identities
continue to apply.

Keep `OWNER_PASSWORD_HASH` unchanged: the separate master login and encrypted
provider settings/GitHub recovery snapshots still use that backend secret. It is
not entered by someone visiting the open Factory.
