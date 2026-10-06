import { api, localDate } from './api.js?v=7';
import { initRouter, setActiveNav } from './router.js?v=7';
import { donutChart, groupedBarChart, horizontalBarChart, lineChart } from './charts.js?v=7';

const root = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const BOOTSTRAP_CACHE_KEY = 'expenseflow.bootstrap.v2';
let bootstrapRefreshPromise = null;
const state = {
  mode: 'local',
  settings: null,
  lookups: null,
  inputMode: 'comma',
  preview: [],
  pendingID: null,
  planMonth: localDate().slice(0, 7),
  tx: {
    search: '', category: '', payment: '', account: '', from: '', to: '',
    min: '', max: '', sort: '', preset: 'month', offset: 0,
    selected: new Set(), filtersOpen: false,
  },
};

const money = paise => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
}).format((Number(paise) || 0) / 100);

const toPaise = value => Math.round((Number(value) || 0) * 100);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value ?? '';
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'checked') node.checked = Boolean(value);
    else if (key === 'value') node.value = value ?? '';
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child instanceof Node) node.append(child);
    else if (child !== undefined && child !== null) node.append(document.createTextNode(String(child)));
  }
  return node;
}

function pageTitle(title, subtitle = '', actions = []) {
  const left = el('div', {}, el('h1', {}, title));
  if (subtitle) left.append(el('p', {}, subtitle));
  const box = el('div', { class: 'page-title' }, left);
  if (actions.length) box.append(el('div', { class: 'page-actions' }, ...actions));
  return box;
}

function field(label, control, help = '') {
  const box = el('div', { class: 'field' }, el('label', {}, label), control);
  if (help) box.append(el('small', {}, help));
  return box;
}

function compactField(label, control, className = '') {
  return el('label', { class: `compact-field${className ? ` ${className}` : ''}` },
    el('span', {}, label),
    control,
  );
}

function settingRow(title, description, control, toggle = false) {
  return el('div', { class: `setting-row${toggle ? ' toggle' : ''}` },
    el('div', { class: 'setting-copy' },
      el('strong', {}, title),
      description ? el('small', {}, description) : null,
    ),
    control,
  );
}

function selectFor(items, value, placeholder = '') {
  const select = el('select');
  if (placeholder) select.append(el('option', { value: '' }, placeholder));
  for (const item of items.filter(x => x.enabled !== false)) {
    const option = el('option', { value: item.id }, item.name);
    option.selected = String(item.id) === String(value ?? '');
    select.append(option);
  }
  return select;
}

function progress(label, current, target) {
  const pct = target > 0 ? clamp((current / target) * 100, 0, 100) : 0;
  const klass = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : '';
  return el('div', { class: 'progress-line' },
    el('div', { class: 'meta' },
      el('span', {}, label),
      el('span', {}, `${money(current)} / ${money(target)}`),
    ),
    el('progress', { class: klass, max: '100', value: String(pct), 'aria-label': `${label} ${Math.round(pct)} percent` }),
  );
}

let toastTimer;
let viewCleanup = () => {};
function toast(message, undo) {
  clearTimeout(toastTimer);
  const children = [document.createTextNode(message)];
  if (undo) {
    const button = el('button', { type: 'button' }, 'Undo');
    button.onclick = async () => {
      clearTimeout(toastTimer);
      try {
        await undo();
        toast('Restored');
      } catch (error) {
        toast(error.message);
      }
    };
    children.push(button);
  }
  toastEl.replaceChildren(...children);
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), undo ? 5000 : 2800);
}

function showError(error) {
  root.replaceChildren(el('div', { class: 'card error' }, error?.message || 'Something went wrong.'));
}

function setLoading() {
  root.replaceChildren(el('div', { class: 'card' }, 'Loading…'));
}

function fmtDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthRange() {
  const now = new Date();
  return [fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), fmtDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
}

function weekRange() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return [fmtDate(start), fmtDate(end)];
}

function applyPreset(name) {
  state.tx.preset = name;
  state.tx.offset = 0;
  state.tx.selected.clear();
  if (name === 'today') state.tx.from = state.tx.to = localDate();
  else if (name === 'week') [state.tx.from, state.tx.to] = weekRange();
  else if (name === 'month') [state.tx.from, state.tx.to] = monthRange();
  else state.tx.from = state.tx.to = '';
}

function hydrateBase(data) {
  if (!data?.settings || !Array.isArray(data.categories) || !Array.isArray(data.payments) || !Array.isArray(data.accounts)) return false;
  state.mode = data.mode || state.mode || 'local';
  state.settings = data.settings;
  state.lookups = { categories: data.categories, payments: data.payments, accounts: data.accounts };
  const status = document.querySelector('#connectionStateDesktop');
  if (status) status.textContent = state.mode === 'cloud' ? 'Cloud · signed in' : 'Local & private';
  return true;
}

function cachedBase() {
  try {
    const cached = JSON.parse(localStorage.getItem(BOOTSTRAP_CACHE_KEY) || 'null');
    return cached?.version === 2 && hydrateBase(cached.data) ? cached.data : null;
  } catch {
    localStorage.removeItem(BOOTSTRAP_CACHE_KEY);
    return null;
  }
}

function saveBase(data) {
  try {
    localStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify({ version: 2, saved_at: Date.now(), data }));
  } catch {
    // Storage can be unavailable in private browsing; the app still works normally.
  }
}

async function refreshBase() {
  if (bootstrapRefreshPromise) return bootstrapRefreshPromise;
  bootstrapRefreshPromise = api('/api/bootstrap')
    .then(data => {
      if (!hydrateBase(data)) throw new Error('Invalid startup data');
      saveBase(data);
      applySettings();
      return data;
    })
    .finally(() => { bootstrapRefreshPromise = null; });
  return bootstrapRefreshPromise;
}

async function loadBase() {
  if (state.lookups && state.settings) return;
  const cached = cachedBase();
  if (!cached) {
    await refreshBase();
    return;
  }
  refreshBase().catch(() => {
    const status = document.querySelector('#connectionStateDesktop');
    if (status) status.textContent = 'Offline · cached UI';
  });
}

function resolvedTheme() {
  const saved = state.settings?.theme || 'system';
  if (saved === 'light' || saved === 'dark') return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function syncThemeChrome() {
  const dark = resolvedTheme() === 'dark';
  const meta = document.querySelector('#themeColor');
  const toggle = document.querySelector('#themeToggle');
  if (meta) meta.setAttribute('content', dark ? '#000000' : '#f7f7f8');
  if (toggle) {
    const saved = state.settings?.theme || 'system';
    toggle.textContent = saved === 'system' ? '◐' : dark ? '☾' : '☀';
    toggle.setAttribute('title', `Theme: ${saved[0].toUpperCase()}${saved.slice(1)}`);
    toggle.setAttribute('aria-label', `Theme: ${saved}. Change theme`);
  }
}

function applySettings() {
  const theme = state.settings?.theme || 'system';
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
  document.body.classList.toggle('compact', state.settings?.compact_rows === 'true');
  syncThemeChrome();
}

async function render(route) {
  viewCleanup();
  viewCleanup = () => {};
  const primary = ['dashboard', 'transactions', 'add', 'plan', 'more'].includes(route) ? route : 'more';
  setActiveNav(primary);
  setLoading();
  try {
    await loadBase();
    localStorage.setItem('expenseflow.last_route', route);
    if (route === 'dashboard') return renderDashboard();
    if (route === 'add') return renderAdd();
    if (route === 'transactions') return renderTransactions();
    if (route === 'plan') return renderPlan();
    if (route === 'more') return renderMore();
    if (route === 'settings') return renderSettings();
    if (route === 'manage') return renderManage();
    if (route === 'recurring') return renderRecurring();
    if (route === 'favorites') return renderFavorites();
    if (route === 'pending') return renderPending();
    if (route === 'backup') return renderBackup();
    location.hash = '#/dashboard';
  } catch (error) {
    showError(error);
  }
}

function transactionPayload(item, overrides = {}) {
  return {
    amount_paise: item.amount_paise,
    description: item.description || '',
    category_id: item.category_id,
    payment_method_id: item.payment_method_id,
    account_id: item.account_id ?? null,
    transaction_date: item.transaction_date || localDate(),
    notes: item.notes || '',
    raw_input: item.raw_input || '',
    source: item.source || 'manual',
    ai_confidence: item.ai_confidence ?? null,
    ai_model: item.ai_model || '',
    ai_processed: Boolean(item.ai_processed),
    ...(item.version ? { version: item.version } : {}),
    ...overrides,
  };
}

function editorControls(item) {
  const amount = el('input', { type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', value: (item.amount_paise / 100).toFixed(2) });
  const description = el('input', { maxlength: '300', value: item.description || '' });
  const category = selectFor(state.lookups.categories, item.category_id);
  const payment = selectFor(state.lookups.payments, item.payment_method_id);
  const account = selectFor(state.lookups.accounts, item.account_id, 'No account');
  const date = el('input', { type: 'date', value: item.transaction_date || localDate() });
  const notes = el('textarea', { maxlength: '2000', placeholder: 'Optional notes' });
  notes.value = item.notes || '';
  return {
    amount, description, category, payment, account, date, notes,
    values: () => transactionPayload(item, {
      amount_paise: toPaise(amount.value),
      description: description.value.trim(),
      category_id: Number(category.value),
      payment_method_id: Number(payment.value),
      account_id: account.value ? Number(account.value) : null,
      transaction_date: date.value,
      notes: notes.value.trim(),
    }),
  };
}

function openEditor(item, options = {}) {
  const controls = editorControls(item);
  const dialog = el('dialog', { class: 'dialog' });
  const close = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close' }, '×');
  close.onclick = () => dialog.close();
  const body = el('div', { class: 'dialog-body' },
    field('Amount', controls.amount),
    field('Description', controls.description),
    field('Category', controls.category),
    field('Payment', controls.payment),
    field('Account', controls.account),
    field('Date', controls.date),
    field('Notes', controls.notes),
  );
  const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
  const save = el('button', { class: 'btn primary', type: 'button' }, options.saveLabel || 'Save');
  cancel.onclick = () => dialog.close();
  save.onclick = async () => {
    const values = controls.values();
    if (!values.description || values.amount_paise <= 0) return toast('Enter a valid amount and description');
    save.disabled = true;
    try {
      await options.onSave(values);
      dialog.close();
    } catch (error) {
      toast(error.message);
    } finally {
      save.disabled = false;
    }
  };
  const actions = el('div', { class: 'dialog-actions' }, el('div'), el('div', { class: 'row' }, cancel, save));
  if (options.onDelete) {
    const del = el('button', { class: 'btn danger', type: 'button' }, 'Delete');
    del.onclick = async () => {
      if (!confirm('Delete this transaction?')) return;
      del.disabled = true;
      try {
        await options.onDelete();
        dialog.close();
      } catch (error) {
        toast(error.message);
      } finally {
        del.disabled = false;
      }
    };
    actions.firstChild.replaceWith(del);
  }
  dialog.append(
    el('div', { class: 'dialog-head' }, el('h2', {}, options.title || 'Edit expense'), close),
    body,
    actions,
  );
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}

let activeRecognition = null;

function voiceButton(textarea, draftKey) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return null;
  const button = el('button', { class: 'btn voice-btn', type: 'button', title: 'Speak expense', 'aria-label': 'Speak expense' }, '🎤 Speak');
  button.onclick = () => {
    if (activeRecognition) {
      activeRecognition.stop();
      return;
    }
    const recognition = new Recognition();
    const base = textarea.value.trim();
    let finalText = '';
    recognition.lang = 'en-IN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => {
      activeRecognition = recognition;
      button.classList.add('listening');
      button.textContent = '■ Stop';
    };
    recognition.onresult = event => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript?.trim() || '';
        if (event.results[i].isFinal) finalText += `${finalText ? ' ' : ''}${transcript}`;
        else interim += `${interim ? ' ' : ''}${transcript}`;
      }
      textarea.value = [base, finalText, interim].filter(Boolean).join(base ? '\n' : ' ').trim();
      localStorage.setItem(draftKey, textarea.value);
    };
    recognition.onerror = event => {
      if (event.error !== 'aborted' && event.error !== 'no-speech') toast(`Voice input: ${event.error}`);
    };
    recognition.onend = () => {
      if (activeRecognition === recognition) activeRecognition = null;
      button.classList.remove('listening');
      button.textContent = '🎤 Speak';
      textarea.focus();
    };
    recognition.start();
  };
  return button;
}

function renderAdd() {
  if (state.settings.ai_enabled !== 'true') state.inputMode = 'comma';
  root.replaceChildren(pageTitle('Add expense', 'Paste one expense or many. Review only what needs attention.'));

  const inputCard = el('section', { class: `card add-input${state.preview.length ? ' compact' : ''}` });
  const modes = el('div', { class: 'segmented' });
  const commaButton = el('button', { type: 'button', class: state.inputMode === 'comma' ? 'active' : '' }, 'Quick input');
  commaButton.onclick = () => { state.inputMode = 'comma'; renderAdd(); };
  modes.append(commaButton);
  if (state.mode === 'local' && state.settings.ai_enabled === 'true') {
    const aiButton = el('button', { type: 'button', class: state.inputMode === 'ai' ? 'active' : '' }, 'AI input');
    aiButton.onclick = () => { state.inputMode = 'ai'; renderAdd(); };
    modes.append(aiButton);
  }

  const textarea = el('textarea', {
    placeholder: state.inputMode === 'comma'
      ? '500, petrol, upi\n40, chai, cash\n899, mouse, card'
      : 'aaj petrol ke 500 lage\nkal medicine ke 320 upi se diye',
  });
  const draftKey = `draft_${state.inputMode}`;
  textarea.value = localStorage.getItem(draftKey) || '';
  textarea.oninput = () => localStorage.setItem(draftKey, textarea.value);

  const parse = el('button', { class: 'btn primary', type: 'button' }, state.inputMode === 'comma' ? 'Parse expenses' : 'Parse with AI');
  parse.onclick = async () => {
    const text = textarea.value.trim();
    if (!text) return toast('Enter at least one expense');
    parse.disabled = true;
    parse.textContent = 'Parsing…';
    try {
      const endpoint = state.inputMode === 'comma' ? '/api/parse' : '/api/ai/parse';
      const result = await api(endpoint, { method: 'POST', body: { text, local_date: localDate() } });
      state.preview = result.items || [];
      const pending = await api('/api/pending', {
        method: 'PUT',
        body: {
          status: state.preview.some(x => x.needs_review) ? 'REVIEW_NEEDED' : 'PARSED',
          raw_input: text,
          payload: state.preview,
        },
      });
      state.pendingID = pending.id;
      renderAdd();
    } catch (error) {
      toast(error.message);
    } finally {
      parse.disabled = false;
    }
  };

  inputCard.append(modes);
  if (!state.preview.length) {
    inputCard.append(field(
      state.inputMode === 'comma' ? 'Expenses' : 'Natural-language expenses',
      textarea,
      state.inputMode === 'comma'
        ? 'One per line: amount, description, payment[, date, category]'
        : 'English, Hindi or Hinglish. Nothing is saved automatically.',
    ));
    const inputActions = el('div', { class: 'row wrap end' });
    if (state.inputMode === 'ai') {
      const voice = voiceButton(textarea, draftKey);
      if (voice) inputActions.append(voice);
    }
    inputActions.append(parse);
    inputCard.append(el('div', { class: 'row between wrap add-actions' }, el('small', {}, 'You always review before saving.'), inputActions));
  } else {
    const editInput = el('button', { class: 'btn small', type: 'button' }, 'Edit original input');
    editInput.onclick = () => {
      state.preview = [];
      renderAdd();
    };
    inputCard.append(el('div', { class: 'row between wrap' }, el('small', {}, 'Input parsed successfully.'), editInput));
  }
  root.append(inputCard);
  if (state.preview.length) renderPreview();
}

function previewDesktopRow(item, index) {
  const amount = el('input', { type: 'number', min: '0.01', step: '0.01', value: (item.amount_paise / 100).toFixed(2) });
  const description = el('input', { maxlength: '300', value: item.description || '', title: item.description || '' });
  const category = selectFor(state.lookups.categories, item.category_id);
  const payment = selectFor(state.lookups.payments, item.payment_method_id);
  const date = el('input', { type: 'date', value: item.transaction_date || localDate() });
  const sync = () => {
    item.amount_paise = toPaise(amount.value);
    item.description = description.value.trim();
    item.category_id = Number(category.value);
    item.payment_method_id = Number(payment.value);
    item.transaction_date = date.value;
  };
  for (const control of [amount, description, category, payment, date]) {
    control.oninput = sync;
    control.onchange = sync;
  }
  const details = el('button', { class: 'btn small', type: 'button' }, 'Details');
  details.onclick = () => openEditor(item, {
    title: 'Expense details',
    onSave: async values => { Object.assign(item, values); renderAdd(); },
  });
  const remove = el('button', { class: 'btn small danger', type: 'button', 'aria-label': 'Remove expense' }, '×');
  remove.onclick = () => { state.preview.splice(index, 1); renderAdd(); };
  return el('tr', { class: item.needs_review || item.warning ? 'needs-review' : '' },
    el('td', { class: 'amount-cell' }, amount),
    el('td', {}, description),
    el('td', {}, category),
    el('td', {}, payment),
    el('td', { class: 'date-cell' }, date),
    el('td', { class: 'action-cell' }, el('div', { class: 'row end' }, details, remove)),
  );
}

function previewMobileRow(item, index) {
  let card;
  const category = selectFor(state.lookups.categories, item.category_id);
  const payment = selectFor(state.lookups.payments, item.payment_method_id);
  const date = el('input', { type: 'date', value: item.transaction_date || localDate() });
  const markReviewed = () => {
    item.category_id = Number(category.value);
    item.category_name = categoryName(item.category_id);
    item.payment_method_id = Number(payment.value);
    item.payment_method_name = paymentName(item.payment_method_id);
    item.transaction_date = date.value;
    item.needs_review = false;
    item.warning = '';
    card?.classList.remove('needs-review');
    card?.querySelector('.preview-warning')?.remove();
    const compactDate = card?.querySelector('.preview-date-compact');
    if (compactDate) compactDate.textContent = item.transaction_date;
    refreshPreviewSummary();
  };
  category.onchange = markReviewed;
  payment.onchange = markReviewed;
  date.onchange = markReviewed;

  const edit = el('button', { class: 'btn small', type: 'button' }, 'More');
  edit.onclick = () => openEditor(item, {
    title: 'Expense details',
    onSave: async values => {
      Object.assign(item, values, { needs_review: false, warning: '' });
      renderAdd();
    },
  });
  const remove = el('button', { class: 'btn small danger', type: 'button' }, 'Remove');
  remove.onclick = () => { state.preview.splice(index, 1); renderAdd(); };

  const fields = el('div', { class: 'preview-mobile-fields' },
    compactField('Category', category),
    compactField('Payment', payment, 'preview-field-optional'),
    compactField('Date', date, 'preview-field-wide'),
  );

  card = el('div', { class: `preview-item${item.needs_review || item.warning ? ' needs-review' : ''}` },
    el('div', { class: 'preview-item-main' },
      el('div', { class: 'grow' },
        el('strong', { class: 'preview-item-title', title: item.description || '' }, item.description || 'Untitled'),
        item.warning ? el('div', { class: 'preview-warning' }, item.warning) : null,
      ),
      el('strong', { class: 'money preview-item-amount' }, money(item.amount_paise)),
    ),
    fields,
    el('div', { class: 'preview-item-footer' },
      el('span', { class: 'preview-date-compact' }, item.transaction_date || localDate()),
      el('div', { class: 'tx-mobile-actions' }, edit, remove),
    ),
  );
  return card;
}

function refreshPreviewSummary() {
  const flagged = state.preview.filter(item => item.needs_review || item.warning).length;
  const warning = document.querySelector('[data-preview-warning]');
  if (warning) {
    warning.textContent = flagged ? `${flagged} need attention` : 'Ready to save';
    warning.classList.toggle('warn', flagged > 0);
  }
  const note = document.querySelector('[data-save-note]');
  if (note) note.textContent = flagged ? `${flagged} item(s) should be checked` : 'Everything is ready';
}

function categoryName(id) {
  return state.lookups.categories.find(x => String(x.id) === String(id))?.name || 'Category';
}

function paymentName(id) {
  return state.lookups.payments.find(x => String(x.id) === String(id))?.name || 'Payment';
}

function renderPreview() {
  const total = state.preview.reduce((sum, item) => sum + (Number(item.amount_paise) || 0), 0);
  const flagged = state.preview.filter(item => item.needs_review || item.warning).length;
  root.append(el('div', { class: 'preview-head' },
    el('h2', {}, `Review ${state.preview.length} expense${state.preview.length === 1 ? '' : 's'}`),
    el('div', { class: 'summary-chips' },
      el('span', { class: 'chip' }, money(total)),
      el('span', { class: `chip${flagged ? ' warn' : ''}`, 'data-preview-warning': '1' }, flagged ? `${flagged} need attention` : 'Ready to save'),
    ),
  ));

  const tbody = el('tbody');
  state.preview.forEach((item, index) => tbody.append(previewDesktopRow(item, index)));
  const table = el('table', {},
    el('thead', {}, el('tr', {},
      el('th', {}, 'Amount'), el('th', {}, 'Description'), el('th', {}, 'Category'),
      el('th', {}, 'Payment'), el('th', {}, 'Date'), el('th', {}, ''),
    )),
    tbody,
  );
  root.append(el('div', { class: 'table-wrap preview-desktop' }, table));

  const mobile = el('div', { class: 'preview-mobile' });
  state.preview.forEach((item, index) => mobile.append(previewMobileRow(item, index)));
  root.append(mobile);

  const save = el('button', { class: 'btn primary', type: 'button' }, `Save all ${state.preview.length}`);
  save.onclick = () => savePreview(save);
  root.append(el('div', { class: 'save-bar' },
    el('div', { class: 'save-bar-copy' },
      el('strong', {}, `${state.preview.length} items · ${money(total)}`),
      el('small', { 'data-save-note': '1' }, flagged ? `${flagged} item(s) should be checked` : 'Everything is ready'),
    ),
    save,
  ));
}

async function savePreview(button) {
  const items = state.preview.map(item => ({
    amount_paise: item.amount_paise,
    description: item.description,
    category_id: item.category_id,
    payment_method_id: item.payment_method_id,
    account_id: item.account_id ?? null,
    transaction_date: item.transaction_date,
    notes: item.notes || '',
    raw_input: item.raw_input || '',
    source: item.source || state.inputMode,
    ai_model: item.source === 'ai' ? (state.settings.ai_model || '') : '',
    ai_processed: item.source === 'ai',
  }));
  if (!items.length) return;
  button.disabled = true;
  try {
    try {
      await api('/api/transactions/bulk', { method: 'POST', body: { items } });
    } catch (error) {
      if (error.status !== 409 || !confirm('Possible duplicate transaction(s) found. Save them anyway?')) throw error;
      await api('/api/transactions/bulk', { method: 'POST', body: { items, allow_duplicates: true } });
    }
    if (state.pendingID) {
      api('/api/pending', { method: 'PUT', body: { id: state.pendingID, status: 'SAVED', raw_input: '', payload: [] } }).catch(() => {});
      state.pendingID = null;
    }
    state.preview = [];
    localStorage.removeItem(`draft_${state.inputMode}`);
    toast('Expenses saved');
    location.hash = '#/transactions';
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function renderDashboard() {
  const data = await api(`/api/stats?date=${localDate()}`);
  const plan = el('a', { class: 'btn', href: '#/plan' }, 'Budget & income');
  root.replaceChildren(pageTitle('Overview', 'Your month at a glance.', [plan]));

  const planned = data.income_paise || data.expected_income_paise || data.spending_limit_paise || data.savings_target_paise;
  if (!planned) {
    root.append(el('section', { class: 'card' },
      el('div', { class: 'row between wrap' },
        el('div', {}, el('strong', {}, 'Set up your monthly plan'), el('div', { class: 'muted' }, 'Add income, a spending limit and a savings target to calculate what is safe to spend.')),
        el('a', { class: 'btn primary', href: '#/plan' }, 'Set up plan'),
      ),
    ));
  }

  const saved = data.net_savings_paise || 0;
  root.append(el('div', { class: 'stats-grid' },
    el('div', { class: 'stat primary-stat' },
      el('span', { class: 'label' }, 'Free to spend'),
      el('strong', {}, planned ? money(data.free_to_spend_paise) : '—'),
      el('small', {}, planned && data.days_remaining ? `${money(data.safe_daily_paise)}/day · ${data.days_remaining} days left` : 'Set a monthly plan'),
    ),
    el('div', { class: 'stat' },
      el('span', { class: 'label' }, 'Spent this month'),
      el('strong', {}, money(data.this_month_paise)),
      el('small', {}, `Projected ${money(data.projected_month_end_paise)}`),
    ),
    el('div', { class: 'stat' },
      el('span', { class: 'label' }, 'Saved so far'),
      el('strong', { class: saved >= 0 ? 'positive' : 'negative' }, money(saved)),
      el('small', {}, data.savings_target_paise ? `Target ${money(data.savings_target_paise)}` : 'No savings target'),
    ),
    el('div', { class: 'stat' },
      el('span', { class: 'label' }, 'Income received'),
      el('strong', {}, money(data.income_paise)),
      el('small', {}, data.expected_income_paise ? `Expected ${money(data.expected_income_paise)}` : 'No expected income set'),
    ),
  ));

  const cashflow = el('section', { class: 'card wide' },
    el('div', { class: 'row between wrap' },
      el('h2', {}, 'Income vs spending'),
      el('div', { class: 'chart-legend' },
        el('span', {}, el('i', { class: 'legend-dot income' }), 'Income'),
        el('span', {}, el('i', { class: 'legend-dot expense' }), 'Spending'),
      ),
    ),
    el('div', { class: 'chart-wrap tall' }, el('canvas', { id: 'cashChart', role: 'img', 'aria-label': 'Six month income versus spending' })),
  );

  const budget = el('section', { class: 'card' }, el('h2', {}, 'Monthly plan'));
  if (data.spending_limit_paise) budget.append(progress('Spending limit', data.this_month_paise, data.spending_limit_paise));
  else budget.append(el('p', { class: 'muted' }, 'No spending limit set.'));
  if (data.savings_target_paise) budget.append(progress('Savings target', Math.max(0, saved), data.savings_target_paise));
  budget.append(el('div', { class: 'insight-list' },
    el('div', { class: 'insight' }, el('span', { class: 'muted' }, 'Upcoming recurring'), el('strong', {}, money(data.upcoming_commitments_paise))),
    el('div', { class: 'insight' }, el('span', { class: 'muted' }, 'Today'), el('strong', {}, money(data.today_paise))),
    el('div', { class: 'insight' }, el('span', { class: 'muted' }, 'Transactions'), el('strong', {}, String(data.transaction_count || 0))),
  ));

  const category = el('section', { class: 'card' }, el('h2', {}, 'Spending by category'), el('div', { class: 'chart-wrap' }, el('canvas', { id: 'categoryChart', role: 'img', 'aria-label': 'Spending by category' })));
  const daily = el('section', { class: 'card' }, el('h2', {}, 'Daily spending'), el('div', { class: 'chart-wrap' }, el('canvas', { id: 'dailyChart', role: 'img', 'aria-label': 'Daily spending' })));
  const payment = el('section', { class: 'card' }, el('h2', {}, 'Payment methods'), el('div', { class: 'chart-wrap' }, el('canvas', { id: 'paymentChart', role: 'img', 'aria-label': 'Spending by payment method' })));

  const grid = el('div', { class: 'dashboard-grid' }, cashflow, budget, category, daily, payment);
  if (data.category_budgets?.length) {
    const categories = el('section', { class: 'card wide' }, el('h2', {}, 'Category budgets'));
    data.category_budgets.forEach(item => categories.append(progress(item.category_name, item.spent_paise, item.limit_paise)));
    grid.append(categories);
  }
  root.append(grid);

  const draw = () => {
    groupedBarChart(document.querySelector('#cashChart'), data.cashflow);
    donutChart(document.querySelector('#categoryChart'), data.categories);
    lineChart(document.querySelector('#dailyChart'), data.daily);
    horizontalBarChart(document.querySelector('#paymentChart'), data.payments);
  };
  let timer;
  const observer = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(draw, 80);
  });
  observer.observe(grid);
  viewCleanup = () => { clearTimeout(timer); observer.disconnect(); };
  requestAnimationFrame(draw);
}

async function renderPlan() {
  const month = state.planMonth || localDate().slice(0, 7);
  const [budget, income] = await Promise.all([
    api(`/api/budget?month=${month}`),
    api(`/api/income?month=${month}`),
  ]);
  const monthInput = el('input', { type: 'month', value: month });
  monthInput.onchange = () => { state.planMonth = monthInput.value; renderPlan(); };
  root.replaceChildren(pageTitle('Budget & income', 'Plan the month and record income when it arrives.', [monthInput]));

  const expected = el('input', { type: 'number', min: '0', step: '0.01', value: budget.expected_income_paise ? budget.expected_income_paise / 100 : '' });
  const limit = el('input', { type: 'number', min: '0', step: '0.01', value: budget.spending_limit_paise ? budget.spending_limit_paise / 100 : '' });
  const savings = el('input', { type: 'number', min: '0', step: '0.01', value: budget.savings_target_paise ? budget.savings_target_paise / 100 : '' });
  const savePlan = el('button', { class: 'btn primary', type: 'button' }, 'Save plan');

  const categoryInputs = budget.categories.map(category => {
    const input = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'No limit', value: category.limit_paise ? category.limit_paise / 100 : '' });
    return [category, input];
  });
  savePlan.onclick = async () => {
    savePlan.disabled = true;
    try {
      await api('/api/budget', {
        method: 'PUT',
        body: {
          month,
          expected_income_paise: toPaise(expected.value),
          spending_limit_paise: toPaise(limit.value),
          savings_target_paise: toPaise(savings.value),
          categories: categoryInputs.map(([category, input]) => ({ category_id: category.category_id, limit_paise: toPaise(input.value) })),
        },
      });
      toast('Monthly plan saved');
      renderPlan();
    } catch (error) {
      toast(error.message);
    } finally {
      savePlan.disabled = false;
    }
  };

  const planCard = el('section', { class: 'card' },
    el('h2', {}, 'Monthly plan'),
    el('div', { class: 'form-grid' },
      field('Expected income', expected),
      field('Spending limit', limit),
      field('Savings target', savings),
    ),
    el('div', { class: 'row end mt-14' }, savePlan),
  );

  const source = el('input', { placeholder: 'Salary, freelance, interest…' });
  const amount = el('input', { type: 'number', min: '0.01', step: '0.01', placeholder: 'Amount' });
  const account = selectFor(state.lookups.accounts, '', 'No account');
  const date = el('input', { type: 'date', value: month === localDate().slice(0, 7) ? localDate() : `${month}-01` });
  const addIncome = el('button', { class: 'btn primary', type: 'button' }, 'Add income');
  addIncome.onclick = async () => {
    if (!source.value.trim() || toPaise(amount.value) <= 0) return toast('Enter income source and amount');
    try {
      await api('/api/income', {
        method: 'POST',
        body: {
          amount_paise: toPaise(amount.value),
          source: source.value.trim(),
          account_id: account.value ? Number(account.value) : null,
          income_date: date.value,
          notes: '',
        },
      });
      toast('Income added');
      renderPlan();
    } catch (error) {
      toast(error.message);
    }
  };

  const incomeCard = el('section', { class: 'card' },
    el('div', { class: 'row between' }, el('h2', {}, 'Income received'), el('strong', { class: 'positive' }, money(income.total_paise))),
    el('div', { class: 'form-grid' }, field('Source', source), field('Amount', amount), field('Account', account), field('Date', date)),
    el('div', { class: 'row end mt-14' }, addIncome),
  );
  if (income.items.length) {
    const list = el('div', { class: 'income-list' });
    for (const item of income.items) {
      const del = el('button', { class: 'btn small danger', type: 'button' }, 'Delete');
      del.onclick = async () => {
        if (!confirm(`Delete ${item.source} income?`)) return;
        await api(`/api/income/${item.id}`, { method: 'DELETE' });
        toast('Income deleted');
        renderPlan();
      };
      list.append(el('div', { class: 'income-row' },
        el('div', { class: 'grow' }, el('strong', { class: 'truncate', title: item.source }, item.source), el('small', {}, `${item.income_date}${item.account_name ? ` · ${item.account_name}` : ''}`)),
        el('div', { class: 'row' }, el('strong', { class: 'money positive' }, money(item.amount_paise)), del),
      ));
    }
    incomeCard.append(el('hr'), list);
  }

  root.append(el('div', { class: 'plan-grid' }, planCard, incomeCard));

  const categoryCard = el('section', { class: 'card mt-12' },
    el('h2', {}, 'Category limits'),
    el('p', { class: 'muted' }, 'Optional. Leave blank for categories you do not want to limit.'),
  );
  const categoryGrid = el('div', { class: 'budget-category-grid' });
  for (const [category, input] of categoryInputs) {
    categoryGrid.append(el('div', { class: 'budget-category' },
      el('div', {}, el('strong', {}, category.category_name), el('small', {}, `Spent ${money(category.spent_paise)}`)),
      input,
    ));
  }
  categoryCard.append(categoryGrid);
  root.append(categoryCard);
}

async function renderTransactions() {
  if (!state.tx.from && !state.tx.to && state.tx.preset === 'month') applyPreset('month');
  root.replaceChildren(pageTitle('Transactions', 'Search, filter and manage expenses.'));

  const f = state.tx;
  const search = el('input', { placeholder: 'Search description or notes', value: f.search });
  const activeFilterCount = [f.category, f.payment, f.account, f.min, f.max].filter(Boolean).length + (f.preset === 'custom' && (f.from || f.to) ? 1 : 0);
  const filterButton = el('button', { class: 'btn', type: 'button' }, activeFilterCount ? `Filters (${activeFilterCount})` : 'Filters');
  const filterPanel = el('section', { class: 'panel filter-panel' });
  const quick = el('div', { class: 'quick-filters' });
  for (const [name, label] of [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']]) {
    const button = el('button', { class: `btn small${f.preset === name ? ' primary' : ''}`, type: 'button' }, label);
    button.onclick = () => { applyPreset(name); renderTransactions(); };
    quick.append(button);
  }

  const category = selectFor(state.lookups.categories, f.category, 'All categories');
  const payment = selectFor(state.lookups.payments, f.payment, 'All payments');
  const account = selectFor(state.lookups.accounts, f.account, 'All accounts');
  const from = el('input', { type: 'date', value: f.from });
  const to = el('input', { type: 'date', value: f.to });
  const min = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'Minimum ₹', value: f.min });
  const max = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'Maximum ₹', value: f.max });
  const sort = el('select');
  [['', 'Newest first'], ['amount_desc', 'Highest amount'], ['amount_asc', 'Lowest amount']].forEach(([value, label]) => {
    const option = el('option', { value }, label);
    option.selected = f.sort === value;
    sort.append(option);
  });
  const advanced = el('div', { class: `advanced-filters${f.filtersOpen ? ' open' : ''}` }, category, payment, account, sort, from, to, min, max);
  filterButton.onclick = () => {
    f.filtersOpen = !f.filtersOpen;
    advanced.classList.toggle('open', f.filtersOpen);
  };

  const active = el('div', { class: 'active-filters' });
  const labels = [];
  if (f.search) labels.push(`Search: ${f.search}`);
  if (f.category) labels.push(categoryName(f.category));
  if (f.payment) labels.push(paymentName(f.payment));
  if (f.account) labels.push(state.lookups.accounts.find(x => String(x.id) === String(f.account))?.name || 'Account');
  if (f.min) labels.push(`Min ${money(toPaise(f.min))}`);
  if (f.max) labels.push(`Max ${money(toPaise(f.max))}`);
  if (f.preset === 'custom' && (f.from || f.to)) labels.push(`${f.from || '…'} → ${f.to || '…'}`);
  labels.forEach(label => active.append(el('span', { class: 'chip' }, label)));
  if (labels.length) {
    const clear = el('button', { class: 'btn small', type: 'button' }, 'Clear');
    clear.onclick = () => {
      Object.assign(f, { search: '', category: '', payment: '', account: '', from: '', to: '', min: '', max: '', sort: '', preset: 'all', offset: 0, filtersOpen: false });
      renderTransactions();
    };
    active.append(clear);
  }

  filterPanel.append(el('div', { class: 'filter-toolbar' }, search, filterButton), quick, advanced, active);
  root.append(filterPanel);

  let timer;
  search.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { f.search = search.value.trim(); f.offset = 0; f.selected.clear(); renderTransactions(); }, 250);
  };
  const updateFilters = () => {
    f.category = category.value;
    f.payment = payment.value;
    f.account = account.value;
    f.from = from.value;
    f.to = to.value;
    f.min = min.value;
    f.max = max.value;
    f.sort = sort.value;
    f.preset = 'custom';
    f.offset = 0;
    f.selected.clear();
    f.filtersOpen = true;
    renderTransactions();
  };
  for (const control of [category, payment, account, sort, from, to, min, max]) control.onchange = updateFilters;

  const host = el('div');
  root.append(host);
  await loadTransactions(host);
}

function transactionQuery() {
  const f = state.tx;
  const params = new URLSearchParams({ limit: '51', offset: String(f.offset) });
  if (f.search) params.set('search', f.search);
  if (f.category) params.set('category', f.category);
  if (f.payment) params.set('payment', f.payment);
  if (f.account) params.set('account', f.account);
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.min) params.set('min', String(toPaise(f.min)));
  if (f.max) params.set('max', String(toPaise(f.max)));
  if (f.sort) params.set('sort', f.sort);
  return params;
}

async function loadTransactions(host) {
  host.replaceChildren(el('div', { class: 'card' }, 'Loading…'));
  try {
    const data = await api(`/api/transactions?${transactionQuery()}`);
    const hasNext = data.items.length > 50;
    const items = data.items.slice(0, 50);
    host.replaceChildren();

    const visibleIDs = items.map(item => item.id);
    const selectAllDesktop = el('input', { type: 'checkbox', 'aria-label': 'Select all visible transactions' });
    const selectAllMobile = el('input', { type: 'checkbox', 'aria-label': 'Select all visible transactions' });
    const info = el('span', { class: 'muted' }, items.length ? `${state.tx.offset + 1}–${state.tx.offset + items.length}` : '0 transactions');
    const selection = el('div', { class: `selection-bar${state.tx.selected.size ? ' show' : ''}` });
    const selectionCount = el('strong', {}, `${state.tx.selected.size} selected`);
    const deleteSelected = el('button', { class: 'btn small danger', type: 'button' }, 'Delete selected');
    selection.append(selectionCount, deleteSelected);
    const mobileSelectAll = el('label', { class: 'mobile-select-all' }, selectAllMobile, el('span', {}, 'Select all'));
    const toolbarRight = el('div', { class: 'transaction-toolbar-right' }, mobileSelectAll, selection);
    const toolbar = el('div', { class: 'transaction-toolbar' }, info, toolbarRight);
    host.append(toolbar);

    const updateSelection = () => {
      selectionCount.textContent = `${state.tx.selected.size} selected`;
      selection.classList.toggle('show', state.tx.selected.size > 0);
      const selectedVisible = visibleIDs.filter(id => state.tx.selected.has(id)).length;
      const allSelected = visibleIDs.length > 0 && selectedVisible === visibleIDs.length;
      const partlySelected = selectedVisible > 0 && selectedVisible < visibleIDs.length;
      for (const checkbox of [selectAllDesktop, selectAllMobile]) {
        checkbox.checked = allSelected;
        checkbox.indeterminate = partlySelected;
      }
    };
    const setVisibleSelection = checked => {
      visibleIDs.forEach(id => checked ? state.tx.selected.add(id) : state.tx.selected.delete(id));
      updateSelection();
    };
    selectAllDesktop.onchange = () => setVisibleSelection(selectAllDesktop.checked);
    selectAllMobile.onchange = () => setVisibleSelection(selectAllMobile.checked);
    updateSelection();
    deleteSelected.onclick = async () => {
      const ids = [...state.tx.selected];
      if (!ids.length || !confirm(`Delete ${ids.length} selected transactions?`)) return;
      await api('/api/transactions/bulk-delete', { method: 'POST', body: { ids } });
      state.tx.selected.clear();
      toast('Transactions deleted');
      renderTransactions();
    };

    if (!items.length) {
      host.append(el('div', { class: 'card empty' }, 'No transactions match these filters.'));
      return;
    }

    const tableBody = el('tbody');
    const mobile = el('div', { class: 'tx-mobile-list' });
    for (const item of items) {
      tableBody.append(transactionTableRow(item, updateSelection));
      mobile.append(transactionMobileRow(item, updateSelection));
    }
    const table = el('table', {},
      el('thead', {}, el('tr', {},
        el('th', { class: 'check-cell' }, selectAllDesktop), el('th', {}, 'Date'), el('th', {}, 'Description'),
        el('th', {}, 'Category'), el('th', {}, 'Payment'), el('th', { class: 'amount-cell' }, 'Amount'),
        el('th', { class: 'action-cell' }, ''),
      )),
      tableBody,
    );
    host.append(el('div', { class: 'table-wrap transaction-table-wrap' }, table), mobile);

    const previous = el('button', { class: 'btn', type: 'button' }, '← Previous');
    const next = el('button', { class: 'btn', type: 'button' }, 'Next →');
    previous.disabled = state.tx.offset === 0;
    next.disabled = !hasNext;
    previous.onclick = () => { state.tx.selected.clear(); state.tx.offset = Math.max(0, state.tx.offset - 50); renderTransactions(); };
    next.onclick = () => { state.tx.selected.clear(); state.tx.offset += 50; renderTransactions(); };
    host.append(el('div', { class: 'pagination' }, previous, next));
  } catch (error) {
    host.replaceChildren(el('div', { class: 'card error' }, error.message));
  }
}

function selectionCheckbox(item, updateSelection) {
  const checkbox = el('input', { type: 'checkbox', checked: state.tx.selected.has(item.id), 'aria-label': `Select ${item.description}` });
  checkbox.onchange = () => {
    if (checkbox.checked) state.tx.selected.add(item.id);
    else state.tx.selected.delete(item.id);
    updateSelection();
  };
  return checkbox;
}

function transactionTableRow(item, updateSelection) {
  const repeat = el('button', { class: 'btn small', type: 'button' }, 'Repeat');
  const edit = el('button', { class: 'btn small', type: 'button' }, 'Edit');
  repeat.onclick = () => repeatTransaction(item);
  edit.onclick = () => editTransaction(item);
  return el('tr', {},
    el('td', { class: 'check-cell' }, selectionCheckbox(item, updateSelection)),
    el('td', {}, item.transaction_date),
    el('td', {}, el('span', { class: 'truncate', title: item.description }, item.description)),
    el('td', {}, item.category_name),
    el('td', {}, item.payment_method_name),
    el('td', { class: 'amount-cell' }, money(item.amount_paise)),
    el('td', { class: 'action-cell' }, el('div', { class: 'row end' }, repeat, edit)),
  );
}

function repeatTransaction(item) {
  state.preview = [{ ...item, transaction_date: localDate(), source: 'repeat', raw_input: `repeat:${item.id}` }];
  location.hash = '#/add';
}

function transactionMobileRow(item, updateSelection) {
  const edit = el('button', { class: 'btn small', type: 'button' }, 'Edit');
  const repeat = el('button', { class: 'btn small', type: 'button' }, 'Repeat');
  edit.onclick = () => editTransaction(item);
  repeat.onclick = () => repeatTransaction(item);

  return el('div', { class: 'tx-mobile-row' },
    el('label', { class: 'tx-mobile-select' }, selectionCheckbox(item, updateSelection)),
    el('div', { class: 'tx-mobile-main' },
      el('div', { class: 'tx-mobile-head' },
        el('div', { class: 'tx-mobile-title', title: item.description }, item.description),
        el('strong', { class: 'money tx-mobile-amount' }, money(item.amount_paise)),
      ),
      el('div', { class: 'tx-mobile-meta' }, `${item.transaction_date} · ${item.category_name} · ${item.payment_method_name}`),
      el('div', { class: 'tx-mobile-actions' }, repeat, edit),
    ),
  );
}

function editTransaction(item) {
  openEditor(item, {
    title: 'Edit transaction',
    onSave: async values => {
      await api(`/api/transactions/${item.id}`, { method: 'PUT', body: values });
      toast('Transaction updated');
      renderTransactions();
    },
    onDelete: async () => {
      const backup = transactionPayload(item);
      delete backup.version;
      await api(`/api/transactions/${item.id}`, { method: 'DELETE' });
      renderTransactions();
      toast('Transaction deleted', async () => {
        await api('/api/transactions', { method: 'POST', body: backup });
        renderTransactions();
      });
    },
  });
}

function navCard(href, title, subtitle) {
  return el('a', { class: 'nav-card', href },
    el('div', {}, el('strong', {}, title), el('small', {}, subtitle)),
    el('span', { class: 'arrow' }, '›'),
  );
}

function renderMore() {
  root.replaceChildren(
    pageTitle('More', 'Less-used tools stay out of the main navigation.'),
    el('div', { class: 'section-links' },
      navCard('#/pending', 'Pending inbox', 'Resume parsed drafts'),
      navCard('#/favorites', 'Favorites', 'Templates for frequent expenses'),
      navCard('#/recurring', 'Recurring expenses', 'Rent, subscriptions and scheduled costs'),
      navCard('#/manage', 'Categories & rules', 'Categories, payments, accounts and rules'),
      navCard('#/backup', 'Import & backup', 'CSV, backups and restore'),
      navCard('#/settings', 'Settings', 'Appearance, defaults and optional AI'),
    ),
  );
}

function renderSettings() {
  root.replaceChildren(pageTitle('Settings', 'Only settings that change real behavior are shown.'));
  const layout = el('div', { class: 'settings-layout' });

  const start = el('select');
  [['dashboard', 'Overview'], ['add', 'Add expense'], ['transactions', 'Transactions'], ['plan', 'Budget & income'], ['last', 'Last visited']].forEach(([value, label]) => {
    const option = el('option', { value }, label);
    option.selected = state.settings.start_page === value;
    start.append(option);
  });
  const theme = el('select');
  ['system', 'light', 'dark'].forEach(value => {
    const option = el('option', { value }, value[0].toUpperCase() + value.slice(1));
    option.selected = (state.settings.theme || 'system') === value;
    theme.append(option);
  });
  const compact = el('input', { type: 'checkbox', checked: state.settings.compact_rows === 'true' });
  layout.append(el('section', { class: 'setting-group' },
    el('h3', {}, 'General'),
    settingRow('Start page', 'Choose what opens first.', start),
    settingRow('Theme', 'System, light or dark.', theme),
    settingRow('Compact transaction rows', 'Fit more transactions on desktop.', compact, true),
  ));

  let backupSchedule, backupDaily, backupWeekly, aiEnabled, aiModel, aiURL, aiUnload;
  if (state.mode === 'cloud') {
    const signOut = el('button', { class: 'btn danger', type: 'button' }, 'Sign out');
    signOut.onclick = async () => {
      signOut.disabled = true;
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch {
        // Clear local state even if the network response is interrupted.
      }
      localStorage.removeItem(BOOTSTRAP_CACHE_KEY);
      navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_PRIVATE_CACHE' });
      location.replace('/login');
    };
    layout.append(el('section', { class: 'setting-group' },
      el('h3', {}, 'Cloud security'),
      settingRow('Signed in', 'This browser has a secure HttpOnly session. Sign out on shared devices.', signOut),
    ));
  }

  if (state.mode === 'local') {
    backupSchedule = el('select');
    [['off', 'Off'], ['daily', 'Daily'], ['weekly', 'Weekly']].forEach(([value, label]) => {
      const option = el('option', { value }, label);
      option.selected = (state.settings.backup_schedule || 'off') === value;
      backupSchedule.append(option);
    });
    backupDaily = el('input', { type: 'number', min: '1', max: '90', value: state.settings.backup_retention_daily || '7' });
    backupWeekly = el('input', { type: 'number', min: '1', max: '52', value: state.settings.backup_retention_weekly || '4' });
    layout.append(el('section', { class: 'setting-group' },
      el('h3', {}, 'Backup'),
      settingRow('Automatic backup', 'Runs when the app opens and a backup is due.', backupSchedule),
      settingRow('Daily copies', 'Daily backups to retain.', backupDaily),
      settingRow('Weekly copies', 'Weekly backups to retain.', backupWeekly),
    ));

    aiEnabled = el('input', { type: 'checkbox', checked: state.settings.ai_enabled === 'true' });
    aiModel = el('input', { value: state.settings.ai_model || 'qwen3.5:4b', placeholder: 'qwen3.5:4b', list: 'recommendedAiModels' });
    const modelList = el('datalist', { id: 'recommendedAiModels' },
      el('option', { value: 'qwen3.5:2b' }),
      el('option', { value: 'qwen3.5:4b' }),
      el('option', { value: 'qwen3.5:9b' }),
    );
    aiURL = el('input', { value: state.settings.ai_url || 'http://127.0.0.1:11434' });
    aiUnload = el('input', { type: 'checkbox', checked: state.settings.ai_unload !== 'false' });
    const details = el('div');
    details.hidden = !aiEnabled.checked;
    details.append(
      settingRow('Model', 'Recommended: qwen3.5:4b. Use 2b for lower memory or 9b for higher accuracy.', el('div', {}, aiModel, modelList)),
      settingRow('Ollama URL', 'Compose AI: http://ollama:11434 · Ollama on your Mac: http://host.docker.internal:11434', aiURL),
      settingRow('Unload immediately', 'Off keeps the model warm for about 5 minutes, making repeated parsing faster.', aiUnload, true),
    );
    const test = el('button', { class: 'btn small', type: 'button' }, 'Test connection');
    test.onclick = async () => {
      test.disabled = true;
      test.textContent = 'Testing…';
      try {
        const aiValues = {
          ai_enabled: String(aiEnabled.checked),
          ai_model: aiModel.value.trim(),
          ai_url: aiURL.value.trim(),
          ai_unload: String(aiUnload.checked),
        };
        await api('/api/settings', { method: 'PUT', body: aiValues });
        Object.assign(state.settings, aiValues);
        const result = await api('/api/ai/test', { method: 'POST' });
        toast(`${result.state || 'AI Ready'}${result.detail ? ` · ${result.detail}` : ''}`);
      } catch (error) {
        toast(error.message);
      } finally {
        test.disabled = false;
        test.textContent = 'Test connection';
      }
    };
    details.append(settingRow('Connection test', 'Runs a real schema-constrained JSON test; AI Ready now means parsing compatibility passed.', test));
    aiEnabled.onchange = () => { details.hidden = !aiEnabled.checked; };
    layout.append(el('section', { class: 'setting-group' }, el('h3', {}, 'Optional local AI'), settingRow('Enable AI', 'Show natural-language parsing on Add.', aiEnabled, true), details));
  }

  root.append(layout);
  const save = el('button', { class: 'btn primary', type: 'button' }, 'Save settings');
  save.onclick = async () => {
    const values = {
      start_page: start.value,
      theme: theme.value,
      compact_rows: String(compact.checked),
    };
    if (state.mode === 'local') Object.assign(values, {
      backup_schedule: backupSchedule.value,
      backup_retention_daily: String(backupDaily.value || 7),
      backup_retention_weekly: String(backupWeekly.value || 4),
      ai_enabled: String(aiEnabled.checked),
      ai_model: aiModel.value.trim(),
      ai_url: aiURL.value.trim(),
      ai_unload: String(aiUnload.checked),
    });
    try {
      await api('/api/settings', { method: 'PUT', body: values });
      Object.assign(state.settings, values);
      applySettings();
      toast('Settings saved');
    } catch (error) {
      toast(error.message);
    }
  };
  root.append(el('div', { class: 'settings-actions' }, save));
}

async function renderManage() {
  const rules = await api('/api/rules');
  root.replaceChildren(pageTitle('Categories & rules', 'Keep labels simple and reusable.'));
  const layout = el('div', { class: 'settings-layout' });

  for (const [title, key, path] of [
    ['Categories', 'categories', 'categories'],
    ['Payment methods', 'payments', 'payment-methods'],
    ['Accounts', 'accounts', 'accounts'],
  ]) {
    const group = el('section', { class: 'setting-group' }, el('h3', {}, title));
    for (const item of state.lookups[key]) {
      const toggle = el('input', { type: 'checkbox', checked: item.enabled });
      toggle.onchange = async () => {
        try {
          await api(`/api/${path}/${item.id}`, {
            method: 'PUT',
            body: { name: item.name, enabled: toggle.checked, icon: item.icon || 'tag', color: item.color || '#64748b' },
          });
          state.lookups = null;
          await loadBase();
          renderManage();
        } catch (error) {
          toggle.checked = !toggle.checked;
          toast(error.message);
        }
      };
      group.append(settingRow(item.name, item.enabled ? 'Active' : 'Disabled', toggle, true));
    }
    const name = el('input', { placeholder: `New ${title.toLowerCase().replace(/s$/, '')}` });
    const add = el('button', { class: 'btn small primary', type: 'button' }, 'Add');
    add.onclick = async () => {
      if (!name.value.trim()) return;
      try {
        await api(`/api/${path}`, { method: 'POST', body: { name: name.value.trim() } });
        state.lookups = null;
        await loadBase();
        renderManage();
      } catch (error) {
        toast(error.message);
      }
    };
    group.append(el('div', { class: 'setting-row' }, name, add));
    layout.append(group);
  }

  const ruleGroup = el('section', { class: 'setting-group' }, el('h3', {}, 'Categorization rules'));
  for (const rule of rules.items) {
    const del = el('button', { class: 'btn small danger', type: 'button' }, 'Delete');
    del.onclick = async () => { await api(`/api/rules/${rule.id}`, { method: 'DELETE' }); renderManage(); };
    ruleGroup.append(settingRow(rule.keyword || rule.merchant, `→ ${rule.category_name}`, del));
  }
  const keyword = el('input', { placeholder: 'Keyword e.g. petrol' });
  const category = selectFor(state.lookups.categories, '');
  const addRule = el('button', { class: 'btn small primary', type: 'button' }, 'Add rule');
  addRule.onclick = async () => {
    if (!keyword.value.trim()) return;
    await api('/api/rules', { method: 'POST', body: { keyword: keyword.value.trim(), merchant: '', category_id: Number(category.value), priority: 100, enabled: true } });
    renderManage();
  };
  ruleGroup.append(el('div', { class: 'setting-row' }, el('div', { class: 'row grow' }, keyword, category), addRule));
  layout.append(ruleGroup);
  root.append(layout);
}

async function renderRecurring() {
  const data = await api('/api/recurring');
  root.replaceChildren(pageTitle('Recurring expenses', 'Scheduled costs are included in your monthly plan.'));

  const list = el('section', { class: 'card' }, el('h2', {}, 'Recurring expenses'));
  if (!data.items.length) list.append(el('div', { class: 'empty' }, 'No recurring expenses yet.'));
  for (const item of data.items) {
    const del = el('button', { class: 'btn small danger', type: 'button' }, 'Delete');
    del.onclick = async () => {
      if (!confirm('Delete recurring expense?')) return;
      await api(`/api/recurring/${item.id}`, { method: 'DELETE' });
      renderRecurring();
    };
    list.append(el('div', { class: 'income-row' },
      el('div', { class: 'grow' }, el('strong', { class: 'truncate', title: item.description }, item.description), el('small', {}, `${item.frequency} · next ${item.next_date} · ${item.category_name}`)),
      el('div', { class: 'row' }, el('strong', { class: 'money' }, money(item.amount_paise)), del),
    ));
  }
  root.append(list);

  const description = el('input', { placeholder: 'Rent' });
  const amount = el('input', { type: 'number', min: '0.01', step: '0.01' });
  const category = selectFor(state.lookups.categories, '');
  const payment = selectFor(state.lookups.payments, '');
  const account = selectFor(state.lookups.accounts, '', 'No account');
  const frequency = el('select');
  ['monthly', 'weekly', 'yearly'].forEach(value => frequency.append(el('option', { value }, value[0].toUpperCase() + value.slice(1))));
  const nextDate = el('input', { type: 'date', value: localDate() });
  const add = el('button', { class: 'btn primary', type: 'button' }, 'Add recurring expense');
  add.onclick = async () => {
    const date = new Date(`${nextDate.value}T00:00:00`);
    try {
      await api('/api/recurring', {
        method: 'POST',
        body: {
          description: description.value.trim(), amount_paise: toPaise(amount.value), category_id: Number(category.value),
          payment_method_id: Number(payment.value), account_id: account.value ? Number(account.value) : null,
          frequency: frequency.value, anchor_day: date.getDate(), next_date: nextDate.value, enabled: true,
        },
      });
      toast('Recurring expense added');
      renderRecurring();
    } catch (error) {
      toast(error.message);
    }
  };
  root.append(el('section', { class: 'card mt-12' },
    el('h2', {}, 'Add recurring expense'),
    el('div', { class: 'form-grid' }, field('Description', description), field('Amount', amount), field('Category', category), field('Payment', payment), field('Account', account), field('Frequency', frequency), field('Next date', nextDate)),
    el('div', { class: 'row end mt-14' }, add),
  ));
}

async function renderFavorites() {
  const data = await api('/api/favorites');
  root.replaceChildren(pageTitle('Favorites', 'Reusable templates for expenses you enter often.'));
  const list = el('section', { class: 'card' });
  if (!data.items.length) list.append(el('div', { class: 'empty' }, 'No favorites yet.'));
  for (const item of data.items) {
    const use = el('button', { class: 'btn small', type: 'button' }, 'Use');
    const del = el('button', { class: 'btn small danger', type: 'button' }, 'Delete');
    use.onclick = () => {
      state.preview = [{
        amount_paise: item.amount_paise || 0,
        description: item.description,
        category_id: item.category_id || state.lookups.categories.find(x => x.enabled)?.id,
        payment_method_id: item.payment_method_id || state.lookups.payments.find(x => x.enabled)?.id,
        account_id: item.account_id || null,
        transaction_date: localDate(), notes: '', raw_input: `favorite:${item.id}`, source: 'favorite', needs_review: !item.amount_paise,
      }];
      location.hash = '#/add';
    };
    del.onclick = async () => { await api(`/api/favorites/${item.id}`, { method: 'DELETE' }); renderFavorites(); };
    list.append(el('div', { class: 'income-row' },
      el('div', { class: 'grow' }, el('strong', { class: 'truncate', title: item.description }, item.description), el('small', {}, `${item.category_name || 'No category'}${item.amount_paise ? ` · ${money(item.amount_paise)}` : ''}`)),
      el('div', { class: 'row' }, use, del),
    ));
  }
  root.append(list);

  const description = el('input', { placeholder: 'Petrol' });
  const amount = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'Optional amount' });
  const category = selectFor(state.lookups.categories, '');
  const payment = selectFor(state.lookups.payments, '');
  const account = selectFor(state.lookups.accounts, '', 'No account');
  const add = el('button', { class: 'btn primary', type: 'button' }, 'Add favorite');
  add.onclick = async () => {
    try {
      await api('/api/favorites', { method: 'POST', body: {
        description: description.value.trim(), amount_paise: amount.value ? toPaise(amount.value) : null,
        category_id: Number(category.value), payment_method_id: Number(payment.value), account_id: account.value ? Number(account.value) : null,
      } });
      toast('Favorite added');
      renderFavorites();
    } catch (error) {
      toast(error.message);
    }
  };
  root.append(el('section', { class: 'card mt-12' },
    el('h2', {}, 'Add favorite'),
    el('div', { class: 'form-grid' }, field('Description', description), field('Amount', amount), field('Category', category), field('Payment', payment), field('Account', account)),
    el('div', { class: 'row end mt-14' }, add),
  ));
}

async function renderPending() {
  const data = await api('/api/pending');
  root.replaceChildren(pageTitle('Pending inbox', 'Resume drafts that were parsed but not saved.'));
  const list = el('section', { class: 'card' });
  if (!data.items.length) list.append(el('div', { class: 'empty' }, 'No pending entries.'));
  for (const item of data.items) {
    const resume = el('button', { class: 'btn small', type: 'button' }, 'Resume');
    resume.onclick = () => {
      state.pendingID = item.id;
      state.preview = Array.isArray(item.payload) ? item.payload : [];
      location.hash = '#/add';
    };
    list.append(el('div', { class: 'income-row' },
      el('div', { class: 'grow' }, el('strong', {}, item.status), el('small', { class: 'truncate', title: item.raw_input || '' }, item.raw_input || '')),
      Array.isArray(item.payload) && item.payload.length ? resume : el('span', { class: 'muted' }, 'Empty'),
    ));
  }
  root.append(list);
}

async function renderBackup() {
  root.replaceChildren(pageTitle('Import & backup', 'Move data safely without bypassing validation.'));
  const card = el('section', { class: 'card' });
  const actions = el('div', { class: 'row wrap' });
  if (state.mode === 'local') {
    const backup = el('button', { class: 'btn primary', type: 'button' }, 'Backup now');
    backup.onclick = async () => {
      try { await api('/api/backup', { method: 'POST' }); toast('Backup created'); renderBackup(); }
      catch (error) { toast(error.message); }
    };
    actions.append(backup);
  }
  const exportCSV = el('button', { class: 'btn', type: 'button' }, 'Export CSV');
  exportCSV.onclick = () => { location.href = '/api/export'; };
  actions.append(exportCSV);
  card.append(actions, el('hr'));

  const file = el('input', { type: 'file', accept: '.csv,text/csv' });
  const preview = el('button', { class: 'btn', type: 'button' }, 'Preview CSV import');
  preview.onclick = async () => {
    if (!file.files[0]) return toast('Choose a CSV file');
    const form = new FormData();
    form.append('file', file.files[0]);
    try {
      const result = await api('/api/import', { method: 'POST', body: form });
      state.preview = result.items || [];
      toast(`${state.preview.length} rows ready to review`);
      location.hash = '#/add';
    } catch (error) {
      toast(error.message);
    }
  };
  card.append(field('Import CSV', file, 'Nothing imports until you review and save.'), el('div', { class: 'mt-10' }, preview));
  root.append(card);

  if (state.mode === 'local') {
    const data = await api('/api/backup');
    const list = el('section', { class: 'card mt-12' }, el('h2', {}, 'Available backups'));
    if (!data.items.length) list.append(el('div', { class: 'empty' }, 'No backups yet.'));
    for (const name of data.items) {
      const restore = el('button', { class: 'btn small', type: 'button' }, 'Restore');
      restore.onclick = async () => {
        if (!confirm(`Restore ${name}? A safety backup is created first.`)) return;
        try { await api('/api/restore', { method: 'POST', body: { name } }); location.reload(); }
        catch (error) { toast(error.message); }
      };
      list.append(settingRow(name, '', restore));
    }
    root.append(list);
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || sessionStorage.getItem('expenseflow.sw.reloaded') === '1') return;
    reloading = true;
    sessionStorage.setItem('expenseflow.sw.reloaded', '1');
    location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register('/sw.js?v=7', { updateViaCache: 'none' });
    registration.update().catch(() => {});
  } catch {
    // Service workers are an optimization; core features must not depend on them.
  }
}

async function boot() {
  await loadBase();
  applySettings();
  registerServiceWorker();
  const today = localDate();
  if (localStorage.getItem('expenseflow.recurring.processed') !== today) {
    api('/api/recurring/process', { method: 'POST', body: { until: today } })
      .then(() => localStorage.setItem('expenseflow.recurring.processed', today))
      .catch(() => {});
  }

  document.querySelector('#themeToggle').addEventListener('click', async () => {
    const current = state.settings.theme || 'system';
    const next = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
    state.settings.theme = next;
    applySettings();
    toast(`Theme: ${next}`);
    api('/api/settings', { method: 'PUT', body: { theme: next } }).catch(() => {});
  });

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((state.settings.theme || 'system') === 'system') syncThemeChrome();
  });

  if (!location.hash) {
    const start = state.settings.start_page || 'dashboard';
    location.hash = start === 'last' ? `#/${localStorage.getItem('expenseflow.last_route') || 'dashboard'}` : `#/${start}`;
  }
  initRouter(render);
}

boot().catch(showError);
