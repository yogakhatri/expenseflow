# Upgrade guide

The README contains the beginner-friendly instructions. This file summarizes the safety rules.

## Local

1. Create a backup.
2. Stop the application.
3. Keep `data/expenseflow.db` and `data/backups/`.
4. Replace application code only.
5. Start the new version.
6. ExpenseFlow creates one pre-migration safety backup and runs only missing numbered migrations.

Never delete the local database just to upgrade.

## Cloudflare D1

For an existing deployment, keep the existing D1 `database_id` in the new `wrangler.toml` and never recreate the database.

```bash
cd cloud
npm install
npx wrangler login
npx wrangler d1 export expenseflow --remote --output=expenseflow-before-upgrade.sql
npx wrangler d1 migrations list expenseflow --remote
npx wrangler d1 migrations apply expenseflow --remote
```

When upgrading from v0.5.x to v0.6.x, configure built-in authentication once:

```bash
npm run auth:setup
```

Then deploy:

```bash
npx wrangler deploy
```

Do not run `schema.sql` as the normal upgrade path. It is for initial database creation only.
