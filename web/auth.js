const form = document.querySelector('#loginForm');
const password = document.querySelector('#password');
const button = document.querySelector('#loginButton');
const message = document.querySelector('#message');
const toggle = document.querySelector('#togglePassword');

function show(text) { message.textContent = text || ''; }

async function status() {
  try {
    const response = await fetch('/api/auth/status', { cache: 'no-store' });
    const data = await response.json();
    if (data.authenticated) return location.replace('/');
    if (!data.configured) {
      show('Authentication is not configured yet. Complete the v0.6 Cloud setup in README.md.');
      button.disabled = true;
    }
  } catch {
    show('Could not reach ExpenseFlow. Check your connection and deployment.');
  }
}

toggle.addEventListener('click', () => {
  const visible = password.type === 'text';
  password.type = visible ? 'password' : 'text';
  toggle.textContent = visible ? 'Show' : 'Hide';
  toggle.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
  password.focus();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  show('');
  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Sign in failed (${response.status})`);
    password.value = '';
    location.replace('/');
  } catch (error) {
    show(error.message || 'Sign in failed.');
    password.select();
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in';
  }
});

status();
