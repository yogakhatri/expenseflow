export function currentRoute() {
  return (location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard').toLowerCase();
}

export function initRouter(render) {
  addEventListener('hashchange', () => render(currentRoute()));
  if (!location.hash) location.hash = '#/dashboard';
  else render(currentRoute());
}

export function setActiveNav(route) {
  document.querySelectorAll('[data-route]').forEach(link => {
    link.classList.toggle('active', link.getAttribute('data-route') === route);
  });
}
