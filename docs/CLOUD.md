# Cloud mode

Cloud mode uses the shared PWA, Cloudflare Workers Static Assets, a Worker API and D1.

For a fresh deployment, follow the complete README Cloudflare section.

Key rules:

- Built-in single-user authentication is required before financial APIs are available.
- The password is represented only by a secret-peppered HMAC-SHA256 verifier in Cloudflare Secrets.
- The session signing key is a separate Cloudflare Secret.
- Sessions use `HttpOnly`, `Secure`, `SameSite=Strict` cookies.
- Failed logins are temporarily rate-limited using hashed source identifiers in D1.
- Cloudflare Access is optional defense-in-depth, not required by ExpenseFlow.
- Versioned static JS/CSS/icons stay edge-cacheable; protected navigation and `/api/*` execute the Worker first.
- API responses are `no-store`.
- Run `schema.sql` only for a brand-new D1 database.
- For upgrades, keep the same `database_id`, export a safety backup, apply `cloud/migrations/`, then deploy.
- Cloud mode does not use your local Ollama while the computer is off.
