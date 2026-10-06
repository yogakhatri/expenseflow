import { createHmac, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function hiddenPrompt(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in an interactive terminal.');
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = '';
    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const finish = error => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };

    const onData = key => {
      if (key === '\u0003') return finish(new Error('Cancelled.'));
      if (key === '\r' || key === '\n') return finish();
      if (key === '\u007f' || key === '\b') {
        if (value.length) {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      if (key >= ' ') {
        value += key;
        process.stdout.write('•');
      }
    };
    stdin.on('data', onData);
  });
}

function setSecret(name, value) {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(command, ['wrangler', 'secret', 'put', name], {
    input: `${value}\n`,
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not set ${name}.`);
}

try {
  const password = await hiddenPrompt('New ExpenseFlow cloud password: ');
  if (password.length < 16) throw new Error('Use at least 16 characters. A long passphrase is recommended.');
  if (password.length > 256) throw new Error('Password must be 256 characters or fewer.');
  const confirm = await hiddenPrompt('Confirm password: ');
  if (password !== confirm) throw new Error('Passwords do not match.');

  const pepper = base64url(randomBytes(32));
  const verifier = base64url(createHmac('sha256', pepper).update(password, 'utf8').digest());
  const sessionSecret = base64url(randomBytes(32));

  process.stdout.write('\nSaving encrypted Worker secrets…\n');
  setSecret('AUTH_PASSWORD_VERIFIER', verifier);
  setSecret('AUTH_PASSWORD_PEPPER', pepper);
  setSecret('SESSION_SECRET', sessionSecret);
  process.stdout.write('\nAuthentication secrets configured. Now run: npx wrangler deploy\n');
} catch (error) {
  process.stderr.write(`\n${error.message}\n`);
  process.exitCode = 1;
}
