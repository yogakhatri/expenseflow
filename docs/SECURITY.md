# Security implementation notes

ExpenseFlow keeps the attack surface intentionally small.

Local mode binds to localhost by default, uses parameterized SQL, enforces foreign keys and request limits, and does not expose Ollama publicly.

Cloud mode includes built-in single-user authentication. Financial APIs require a valid signed session server-side. Passwords are verified using a secret-peppered HMAC-SHA256 verifier stored in Cloudflare Secrets; a separate secret signs `HttpOnly`, `Secure`, `SameSite=Strict` session cookies. Cross-site mutations are rejected and repeated failed logins are temporarily throttled using HMAC-hashed source identifiers stored in D1.

Cloudflare Access can be added as defense-in-depth but is not required for the built-in login.

Cloud authentication intentionally uses a fast keyed verifier rather than an expensive server-side KDF so it remains reliable on the tight CPU budget of Workers Free. Compensating controls are a minimum 16-character passphrase, a separate secret pepper, online lockout, TLS-only secure cookies and server-side route enforcement. Use a long unique passphrase.

The microphone permission policy allows only the same origin so supported browsers can provide voice transcription. ExpenseFlow does not intentionally store audio. Web Speech Recognition may use browser/OS vendor services, so users should not assume speech transcription is fully local.

Never commit Worker secrets, `.dev.vars`, database exports, backup databases or real credentials.
