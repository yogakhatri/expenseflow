# Security Policy

## Supported versions

The latest released version receives security fixes.

## Reporting

Please report suspected vulnerabilities privately to the project maintainer. Include the affected version, reproduction steps, impact and any suggested mitigation. Do not open a public issue for an active vulnerability before coordination.

## Cloud authentication

ExpenseFlow cloud mode uses a built-in single-user authentication layer:

- the password is represented only by a secret-peppered HMAC-SHA256 verifier in Cloudflare Secrets;
- a separate random Cloudflare Secret signs sessions;
- sessions are `HttpOnly`, `Secure`, `SameSite=Strict` cookies;
- all financial API routes require a valid session server-side;
- cross-site mutations are rejected using request-origin signals;
- repeated failed logins trigger a temporary per-source lockout;
- source addresses used for lockout state are HMAC-hashed before D1 storage;
- financial/API responses are `no-store`;
- strict CSP, frame protection, MIME sniffing protection and referrer restrictions are enabled.

Do not commit `.dev.vars`, secrets, database exports or real credentials. If the session secret may be exposed, rotate it with `npm run auth:setup` and redeploy; this invalidates existing sessions.

Cloudflare Access can be added as an additional outer layer but is not required for the built-in login.

No software can promise absolute security. ExpenseFlow minimizes exposure through simple architecture, server-side validation, parameterized SQL, low dependency count and explicit authentication boundaries.
