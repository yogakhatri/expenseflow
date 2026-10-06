const BOOTSTRAP_CACHE_KEY = 'expenseflow.bootstrap.v2';

export function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function invalidateBootstrapOnMutation(path, method) {
  if (method === 'GET' || method === 'HEAD') return;
  if (/^\/api\/(settings|categories|payment-methods|accounts)(?:\/|$)/.test(path)) {
    localStorage.removeItem(BOOTSTRAP_CACHE_KEY);
  }
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('X-Local-Date', localDate());

  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    if (typeof body !== 'string') body = JSON.stringify(body);
  }

  const method = String(options.method || 'GET').toUpperCase();
  const response = await fetch(path, { ...options, method, body, headers, cache: 'no-store' });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text();

  if (!response.ok) {
    if (response.status === 401 && data?.code === 'AUTH_REQUIRED') {
      localStorage.removeItem(BOOTSTRAP_CACHE_KEY);
      navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_PRIVATE_CACHE' });
      location.replace('/login');
      throw Object.assign(new Error('Authentication required'), { status: 401, data });
    }
    throw Object.assign(new Error(data?.error || `Request failed (${response.status})`), {
      status: response.status,
      data,
    });
  }
  invalidateBootstrapOnMutation(path, method);
  return data;
}
