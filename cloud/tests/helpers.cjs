const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const compiled = fs.mkdtempSync(path.join(os.tmpdir(), 'expenseflow-worker-test-'));
for (const file of fs.readdirSync(path.join(root, 'cloud')).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, 'cloud', file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  fs.writeFileSync(path.join(compiled, file.replace(/\.ts$/, '.js')), output.outputText);
}
process.on('exit', () => fs.rmSync(compiled, { recursive: true, force: true }));
const worker = require(path.join(compiled, 'worker.js')).default;
const { readJSON } = require(path.join(compiled, 'request.js'));
const { validDate } = require(path.join(compiled, 'db.js'));

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(root, 'cloud/schema.sql'), 'utf8'));
  for (const file of fs.readdirSync(path.join(root, 'cloud/migrations')).sort()) {
    db.exec(fs.readFileSync(path.join(root, 'cloud/migrations', file), 'utf8'));
  }
  t.after(() => db.close());
  let beforeWrite = null;
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return db.prepare(this.sql).get(...this.values) || null; }
    async all() { return this.execute(); }
    execute() {
      const query = db.prepare(this.sql);
      if (/^\s*SELECT/i.test(this.sql)) return { results: query.all(...this.values), meta: {} };
      const result = query.run(...this.values);
      return { results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    }
    async run() {
      if (beforeWrite && /(?:INSERT INTO transactions|UPDATE transactions)/.test(this.sql)) await beforeWrite();
      return this.execute();
    }
  }
  const pepper = 'fixture-password-pepper-'.repeat(3);
  const secret = 'fixture-session-signing-secret-'.repeat(3);
  const password = 'fixture-password-long';
  const env = {
    AUTH_PASSWORD_PEPPER: pepper,
    AUTH_PASSWORD_VERIFIER: createHmac('sha256', pepper).update(password).digest('base64url'),
    SESSION_SECRET: secret,
    ASSETS: { fetch: async () => new Response('shell') },
    DB: {
      prepare: sql => new Statement(sql),
      batch: async statements => {
        db.exec('BEGIN');
        try { const results = statements.map(s => s.execute()); db.exec('COMMIT'); return results; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    },
  };
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, iat: now, exp: now + 3600 })).toString('base64url');
  const token = `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
  const cookie = `__Host-expenseflow_session=${token}`;
  async function request(pathname, method = 'GET', body, headers = {}) {
    const response = await worker.fetch(new Request(`https://expenseflow.test${pathname}`, {
      method, headers: { cookie, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }), env);
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, headers: response.headers, data };
  }
  return { db, env, request, password, synchronizeWrites(count) {
    let arrived = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    beforeWrite = () => { if (++arrived === count) release(); return gate; };
  } };
}
const expense = (description = 'Fixture') => ({
  amount_paise: 50000, description, category_id: 3, payment_method_id: 1,
  account_id: 1, transaction_date: '2026-10-15', notes: '', raw_input: '', source: 'manual',
});
module.exports = { fixture, expense, root, readJSON, validDate };
