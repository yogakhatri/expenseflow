# Contributing

Keep changes small, readable and dependency-light.

1. Create a branch.
2. Run `go fmt ./...`, `go test -race ./...`, `go vet ./...`, and `npm test --prefix cloud`.
   The cloud tests require Node.js 22.13 or newer and use the real Worker handlers
   with a temporary SQLite fixture. Both backends use `testdata/input-contract.json`
   to check date validation and categorization rules.
3. Add tests for behavior changes.
4. Do not add frameworks or dependencies without a concrete need.
5. Never log expense text, secrets, cookies or database contents.

Local SQLite schemas are defined by `db/migrations/`; keep numbered migrations,
including historical no-op migrations, so existing installations can upgrade.
`cloud/schema.sql` bootstraps new D1 databases, and `cloud/migrations/` upgrades
existing ones. Keep exports, local data, caches, and build output out of Git.
Use `npm ci --prefix cloud` to install the locked development dependencies.
