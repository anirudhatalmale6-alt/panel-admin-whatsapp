/* Panel Admin WhatsApp — frontend.
   Vanilla JS, tanpa build step: file ini langsung dilayani apa adanya. */
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  me: null,
  contacts: [],
  activeContactId: null,
  messages: [],
  rules: [],
  settings: {},
  waStatus: {},
  socket: null,
};

const DAY_NAMES = { 1: 'Sen', 2: 'Sel', 3: 'Rab', 4: 'Kam', 5: 'Jum', 6: 'Sab', 7: 'Min' };

// ---------------------------------------------------------------- utilities

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Gagal (HTTP ${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

let toastTimer = null;
function toast(message, isError = false) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = isError ? 'err' : '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4200);
}

function timeAgo(value) {
  if (!value) return '';
  const d = new Date(value);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

function fullTime(value) {
  return new Date(value).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function initials(name) {
  const clean = String(name || '?').replace(/^\+?\d+$/, '#');
  return clean.trim().charAt(0).toUpperCase() || '?';
}

function openModal({ title, bodyHtml, okLabel = 'Simpan', onOk, wide = false }) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" ${wide ? 'style="max-width:760px"' : ''}>
        <header>${esc(title)}</header>
        <div class="body">${bodyHtml}</div>
        <footer>
          <button class="btn ghost" data-act="cancel">Batal</button>
          <button class="btn" data-act="ok">${esc(okLabel)}</button>
        </footer>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelector('[data-act=cancel]').onclick = close;
  root.querySelector('.modal-backdrop').onclick = (e) => { if (e.target.classList.contains('modal-backdrop')) close(); };
  root.querySelector('[data-act=ok]').onclick = async () => {
    try { if (await onOk(root) !== false) close(); } catch (err) { toast(err.message, true); }
  };
  return { root, close };
}

// ---------------------------------------------------------------- auth + boot

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').classList.add('hidden');
  try {
    const { user } = await api('/auth/login', {
      method: 'POST',
      body: { email: $('#login-email').value, password: $('#login-password').value },
    });
    state.me = user;
    await boot();
  } catch (err) {
    $('#login-error').textContent = err.message;
    $('#login-error').classList.remove('hidden');
  }
});

$('#btn-logout').onclick = async () => {
  await api('/auth/logout', { method: 'POST' });
  location.reload();
};

async function start() {
  try {
    const { user } = await api('/auth/me');
    state.me = user;
    await boot();
  } catch {
    $('#login-view').classList.remove('hidden');
    $('#app-view').classList.add('hidden');
  }
}

async function boot() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#me-name').textContent = `${state.me.name} (${state.me.role === 'ADMIN' ? 'Admin' : 'Agen'})`;

  connectSocket();
  await Promise.all([loadContacts(), loadWaStatus(), loadSettings()]);
  renderDaysPicker();
}

function connectSocket() {
  state.socket = io({ path: '/socket.io' });

  state.socket.on('message:new', ({ message, contact }) => {
    // sekalian perbarui cuplikan di daftar kiri, kalau tidak isinya tetap
    // "belum ada pesan" sampai halaman dimuat ulang
    upsertContact({
      ...contact,
      lastMessage: { body: message.body, direction: message.direction, isAuto: message.isAuto },
    });
    if (message.contactId === state.activeContactId) {
      state.messages.push(message);
      renderMessages();
      if (message.direction === 'IN') api(`/contacts/${contact.id}/read`, { method: 'POST' }).catch(() => {});
    }
    renderContacts();
  });

  state.socket.on('message:update', (message) => {
    const idx = state.messages.findIndex((m) => m.id === message.id);
    if (idx >= 0) { state.messages[idx] = message; renderMessages(); }
  });

  state.socket.on('contact:new', (c) => { upsertContact(c); renderContacts(); });
  state.socket.on('contact:update', (c) => { upsertContact(c); renderContacts(); });
  state.socket.on('wa:status', (s) => { state.waStatus = s; renderWaStatus(); });
}

// ---------------------------------------------------------------- navigation

$$('.nav-item').forEach((btn) => {
  btn.onclick = () => {
    $$('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    $$('.view').forEach((v) => v.classList.add('hidden'));
    $(`#view-${view}`).classList.remove('hidden');
    if (view === 'rules') loadRules();
    if (view === 'settings') { loadSettings(); loadStats(); loadWaStatus(); }
    if (view === 'users') loadUsers();
  };
});

// ---------------------------------------------------------------- inbox

function upsertContact(contact) {
  if (!contact) return;
  const idx = state.contacts.findIndex((c) => c.id === contact.id);
  const merged = idx >= 0 ? { ...state.contacts[idx], ...contact } : { ...contact };
  merged.displayName = merged.name || merged.pushName || `+${merged.waId}`;
  if (idx >= 0) state.contacts[idx] = merged; else state.contacts.unshift(merged);
  state.contacts.sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
}

async function loadContacts(query = '') {
  const { contacts } = await api(`/contacts?q=${encodeURIComponent(query)}`);
  state.contacts = contacts;
  renderContacts();
}

function renderContacts() {
  const box = $('#contact-scroll');
  if (!state.contacts.length) {
    box.innerHTML = '<div class="empty" style="height:auto;padding:36px 20px">Belum ada percakapan.<br>Pesan masuk akan muncul di sini otomatis.</div>';
  } else {
    box.innerHTML = state.contacts.map((c) => {
      const preview = c.lastMessage
        ? `${c.lastMessage.direction === 'OUT' ? (c.lastMessage.isAuto ? '🤖 ' : '↩ ') : ''}${esc(c.lastMessage.body).slice(0, 60)}`
        : '<i>belum ada pesan</i>';
      return `
        <div class="contact-item ${c.id === state.activeContactId ? 'active' : ''}" data-id="${c.id}">
          <div class="avatar">${esc(initials(c.displayName))}</div>
          <div class="contact-body">
            <div class="contact-top">
              <span class="contact-name">${esc(c.displayName)}${c.botEnabled === false ? ' 🔕' : ''}</span>
              <span class="contact-time">${timeAgo(c.lastMessageAt)}</span>
            </div>
            <div class="contact-preview">${preview}${c.unreadCount ? `<span class="unread">${c.unreadCount}</span>` : ''}</div>
          </div>
        </div>`;
    }).join('');
    box.querySelectorAll('.contact-item').forEach((el) => {
      el.onclick = () => selectContact(Number(el.dataset.id));
    });
  }

  const unread = state.contacts.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  const badge = $('#nav-unread');
  badge.textContent = unread;
  badge.classList.toggle('hidden', unread === 0);
}

async function selectContact(id) {
  state.activeContactId = id;
  const { contact, messages } = await api(`/contacts/${id}/messages`);
  state.messages = messages;

  $('#chat-header').classList.remove('hidden');
  $('#composer').classList.remove('hidden');
  const display = contact.name || contact.pushName || `+${contact.waId}`;
  $('#chat-avatar').textContent = initials(display);
  $('#chat-name').textContent = display;
  $('#chat-number').textContent = `+${contact.waId}`;
  $('#chat-bot-toggle').checked = contact.botEnabled;

  renderMessages();
  await api(`/contacts/${id}/read`, { method: 'POST' }).catch(() => {});
  upsertContact({ ...contact, unreadCount: 0 });
  renderContacts();
}

function renderMessages() {
  const box = $('#messages');
  if (!state.messages.length) {
    box.innerHTML = '<div class="empty">Belum ada pesan di percakapan ini.</div>';
    return;
  }
  box.innerHTML = state.messages.map((m) => {
    const out = m.direction === 'OUT';
    let meta = fullTime(m.timestamp);
    if (out) {
      if (m.status === 'failed') meta += ` · <span class="failed">GAGAL: ${esc(m.errorText || 'tidak terkirim')}</span>`;
      else meta += ` · ${m.status === 'read' ? 'dibaca' : m.status === 'delivered' ? 'terkirim' : 'dikirim'}`;
      meta += m.isAuto ? ' · 🤖 otomatis' : (m.sentBy?.name ? ` · ${esc(m.sentBy.name)}` : '');
    }
    return `<div class="msg ${out ? 'out' : 'in'} ${m.isAuto ? 'auto' : ''}">
      <div class="bubble">${esc(m.body)}</div>
      <div class="meta">${meta}</div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendCurrent() {
  const text = $('#composer-text').value.trim();
  if (!text || !state.activeContactId) return;
  $('#btn-send').disabled = true;
  try {
    await api(`/contacts/${state.activeContactId}/messages`, { method: 'POST', body: { text } });
    $('#composer-text').value = '';
  } catch (err) {
    // pesan tetap tersimpan dengan status gagal, jadi tetap muncul di layar
    toast(err.message, true);
    $('#composer-text').value = '';
  } finally {
    $('#btn-send').disabled = false;
  }
}

$('#btn-send').onclick = sendCurrent;
$('#composer-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrent(); }
});

let searchTimer = null;
$('#contact-search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadContacts(e.target.value), 250);
});

$('#chat-bot-toggle').onchange = async (e) => {
  await api(`/contacts/${state.activeContactId}`, { method: 'PATCH', body: { botEnabled: e.target.checked } });
  toast(e.target.checked ? 'Auto-response dinyalakan untuk chat ini' : 'Auto-response dimatikan untuk chat ini');
};

$('#btn-rename').onclick = () => {
  const contact = state.contacts.find((c) => c.id === state.activeContactId);
  if (!contact) return;
  openModal({
    title: 'Ubah nama kontak',
    bodyHtml: `<div class="field"><label>Nama</label><input type="text" id="m-name" value="${esc(contact.name || '')}"></div>`,
    onOk: async (root) => {
      const name = root.querySelector('#m-name').value.trim();
      const { contact: updated } = await api(`/contacts/${contact.id}`, { method: 'PATCH', body: { name } });
      upsertContact(updated);
      renderContacts();
      $('#chat-name').textContent = updated.name || updated.pushName || `+${updated.waId}`;
    },
  });
};

$('#btn-new-chat').onclick = () => {
  openModal({
    title: 'Mulai chat baru',
    bodyHtml: `
      <div class="field"><label>Nomor WhatsApp</label>
        <input type="text" id="m-phone" placeholder="08123456789 atau 628123456789">
        <div class="help">Awalan 0 otomatis diubah menjadi 62.</div>
      </div>
      <div class="field"><label>Nama (opsional)</label><input type="text" id="m-cname"></div>`,
    okLabel: 'Buat',
    onOk: async (root) => {
      const { contact } = await api('/contacts', {
        method: 'POST',
        body: { phone: root.querySelector('#m-phone').value, name: root.querySelector('#m-cname').value },
      });
      upsertContact(contact);
      renderContacts();
      selectContact(contact.id);
    },
  });
};

$('#btn-simulate').onclick = () => {
  openModal({
    title: 'Simulasi pesan masuk',
    bodyHtml: `
      <p class="hint">Mode simulasi aktif (WA_PROVIDER=mock). Pesan ini akan diperlakukan persis seperti pesan asli dari pelanggan, termasuk memicu auto-response.</p>
      <div class="field"><label>Nomor pengirim</label><input type="text" id="m-sim-phone" value="628123456789"></div>
      <div class="field"><label>Nama pengirim</label><input type="text" id="m-sim-name" value="Pelanggan Demo"></div>
      <div class="field"><label>Isi pesan</label><textarea id="m-sim-text">halo, berapa harga paket A?</textarea></div>`,
    okLabel: 'Kirim',
    onOk: async (root) => {
      await api('/wa/simulate', {
        method: 'POST',
        body: {
          phone: root.querySelector('#m-sim-phone').value,
          pushName: root.querySelector('#m-sim-name').value,
          text: root.querySelector('#m-sim-text').value,
        },
      });
      toast('Pesan simulasi dikirim');
      return false; // biarkan modal terbuka supaya gampang kirim beberapa kali
    },
  });
};

// ---------------------------------------------------------------- auto-response

async function loadRules() {
  const { rules } = await api('/rules');
  state.rules = rules;
  renderRules();
}

const MATCH_LABELS = {
  CONTAINS: 'Mengandung kata',
  EXACT: 'Sama persis',
  STARTS_WITH: 'Diawali dengan',
  REGEX: 'Regex',
  FIRST_MESSAGE: 'Pesan pertama kontak baru',
  FALLBACK: 'Semua pesan (fallback)',
};

function scheduleLabel(rule) {
  const days = String(rule.days || '').split(',').filter(Boolean).map(Number);
  const dayText = days.length === 7 ? 'Setiap hari' : days.map((d) => DAY_NAMES[d]).join(' ');
  const hours = rule.startTime && rule.endTime ? `${rule.startTime}–${rule.endTime}` : '24 jam';
  return `${dayText}<br><span style="color:var(--muted)">${hours}</span>`;
}

function renderRules() {
  const isAdmin = state.me.role === 'ADMIN';
  $('#btn-new-rule').classList.toggle('hidden', !isAdmin);
  $('#rules-body').innerHTML = state.rules.map((r) => `
    <tr class="${r.enabled ? '' : 'off'}">
      <td>${r.priority}</td>
      <td><strong>${esc(r.name)}</strong><br><span style="color:var(--muted);font-size:12px">${esc(r.replyText).slice(0, 70)}${r.replyText.length > 70 ? '…' : ''}</span></td>
      <td><span class="tag">${MATCH_LABELS[r.matchType] || r.matchType}</span>${r.keywords ? `<br><span style="font-size:12px;color:var(--muted)">${esc(r.keywords)}</span>` : ''}</td>
      <td style="font-size:12px">${scheduleLabel(r)}</td>
      <td>${r.hitCount}×</td>
      <td>${r.enabled ? '<span class="tag green">aktif</span>' : '<span class="tag">mati</span>'}</td>
      <td style="white-space:nowrap">
        ${isAdmin ? `
          <button class="btn ghost sm" data-edit="${r.id}">Ubah</button>
          <button class="btn ghost sm" data-toggle="${r.id}">${r.enabled ? 'Matikan' : 'Nyalakan'}</button>
          <button class="btn ghost sm" data-del="${r.id}" title="Hapus">🗑</button>` : ''}
      </td>
    </tr>`).join('');

  $$('#rules-body [data-edit]').forEach((b) => {
    b.onclick = () => ruleEditor(state.rules.find((r) => r.id === Number(b.dataset.edit)));
  });
  $$('#rules-body [data-toggle]').forEach((b) => {
    b.onclick = async () => {
      const rule = state.rules.find((r) => r.id === Number(b.dataset.toggle));
      await api(`/rules/${rule.id}`, { method: 'PATCH', body: { enabled: !rule.enabled } });
      loadRules();
    };
  });
  $$('#rules-body [data-del]').forEach((b) => {
    b.onclick = async () => {
      const rule = state.rules.find((r) => r.id === Number(b.dataset.del));
      if (!confirm(`Hapus aturan "${rule.name}"?`)) return;
      await api(`/rules/${rule.id}`, { method: 'DELETE' });
      loadRules();
    };
  });
}

function daysCheckboxes(idPrefix, selected) {
  const set = new Set(String(selected || '1,2,3,4,5,6,7').split(',').map(Number));
  return Object.entries(DAY_NAMES).map(([n, label]) => `
    <label class="${set.has(Number(n)) ? 'on' : ''}">
      <input type="checkbox" name="${idPrefix}" value="${n}" ${set.has(Number(n)) ? 'checked' : ''}>${label}
    </label>`).join('');
}

function wireDayToggles(root) {
  root.querySelectorAll('.days label').forEach((label) => {
    label.onclick = () => setTimeout(() => label.classList.toggle('on', label.querySelector('input').checked), 0);
  });
}

function ruleEditor(rule) {
  const r = rule || {
    name: '', matchType: 'CONTAINS', keywords: '', replyText: '', priority: 100,
    days: '1,2,3,4,5,6,7', startTime: '', endTime: '', timezone: 'Asia/Jakarta',
    cooldownSeconds: 300, maxPerContact: 0, enabled: true, caseSensitive: false,
  };

  const { root } = openModal({
    title: rule ? `Ubah aturan: ${rule.name}` : 'Aturan auto-response baru',
    wide: true,
    okLabel: rule ? 'Simpan perubahan' : 'Buat aturan',
    bodyHtml: `
      <div class="row">
        <div class="field" style="flex:2"><label>Nama aturan</label>
          <input type="text" id="r-name" value="${esc(r.name)}" placeholder="Contoh: Tanya harga"></div>
        <div class="field" style="flex:0 0 110px"><label>Prioritas</label>
          <input type="number" id="r-priority" value="${r.priority}">
          <div class="help">kecil = duluan</div></div>
      </div>

      <div class="field"><label>Kapan aturan ini dipakai</label>
        <select id="r-match">
          ${Object.entries(MATCH_LABELS).map(([v, l]) => `<option value="${v}" ${r.matchType === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>

      <div class="field" id="r-kw-field"><label>Kata kunci</label>
        <input type="text" id="r-keywords" value="${esc(r.keywords)}" placeholder="harga, price, berapa">
        <div class="help" id="r-kw-help">Pisahkan dengan koma. Cocok kalau salah satu kata ada di pesan pelanggan.</div>
      </div>

      <div class="field"><label>Teks balasan</label>
        <textarea id="r-reply" placeholder="Halo {{nama}}, terima kasih sudah menghubungi kami…">${esc(r.replyText)}</textarea>
        <div class="help">Variabel: {{nama}} {{jam}} {{tanggal}} {{nomor}} {{pesan}}</div>
      </div>

      <div class="field"><label>Hari aktif</label><div class="days" id="r-days">${daysCheckboxes('r-day', r.days)}</div></div>

      <div class="row">
        <div class="field"><label>Jam mulai</label><input type="time" id="r-start" value="${r.startTime || ''}"></div>
        <div class="field"><label>Jam selesai</label><input type="time" id="r-end" value="${r.endTime || ''}"></div>
        <div class="field"><label>Zona waktu</label>
          <select id="r-tz">
            ${['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'UTC'].map((tz) => `<option ${r.timezone === tz ? 'selected' : ''}>${tz}</option>`).join('')}
          </select></div>
      </div>
      <div class="help" style="margin:-6px 0 14px">Kosongkan jam mulai dan selesai supaya aturan berlaku 24 jam.</div>

      <div class="row">
        <div class="field"><label>Jeda antar balasan (detik)</label>
          <input type="number" id="r-cooldown" value="${r.cooldownSeconds}" min="0">
          <div class="help">0 = tanpa jeda</div></div>
        <div class="field"><label>Maksimal per kontak</label>
          <input type="number" id="r-max" value="${r.maxPerContact}" min="0">
          <div class="help">0 = tanpa batas</div></div>
      </div>

      <label class="switch" style="margin-right:18px"><input type="checkbox" id="r-enabled" ${r.enabled ? 'checked' : ''}><span class="track"></span><span>Aktif</span></label>
      <label class="switch"><input type="checkbox" id="r-case" ${r.caseSensitive ? 'checked' : ''}><span class="track"></span><span>Bedakan huruf besar/kecil</span></label>
    `,
    onOk: async (modalRoot) => {
      const days = Array.from(modalRoot.querySelectorAll('input[name=r-day]:checked')).map((i) => Number(i.value));
      const body = {
        name: modalRoot.querySelector('#r-name').value,
        matchType: modalRoot.querySelector('#r-match').value,
        keywords: modalRoot.querySelector('#r-keywords').value,
        replyText: modalRoot.querySelector('#r-reply').value,
        priority: Number(modalRoot.querySelector('#r-priority').value),
        days,
        startTime: modalRoot.querySelector('#r-start').value || null,
        endTime: modalRoot.querySelector('#r-end').value || null,
        timezone: modalRoot.querySelector('#r-tz').value,
        cooldownSeconds: Number(modalRoot.querySelector('#r-cooldown').value),
        maxPerContact: Number(modalRoot.querySelector('#r-max').value),
        enabled: modalRoot.querySelector('#r-enabled').checked,
        caseSensitive: modalRoot.querySelector('#r-case').checked,
      };
      if (rule) await api(`/rules/${rule.id}`, { method: 'PATCH', body });
      else await api('/rules', { method: 'POST', body });
      await loadRules();
      toast('Aturan tersimpan');
    },
  });

  wireDayToggles(root);

  const matchSel = root.querySelector('#r-match');
  const syncKeywordField = () => {
    const v = matchSel.value;
    const needsKeywords = ['CONTAINS', 'EXACT', 'STARTS_WITH', 'REGEX'].includes(v);
    root.querySelector('#r-kw-field').classList.toggle('hidden', !needsKeywords);
    const help = root.querySelector('#r-kw-help');
    if (v === 'REGEX') help.textContent = 'Seluruh isi kotak ini dipakai sebagai satu pola regex, tidak dipecah per koma. Contoh: ^(halo|hai|hi)\\b';
    else if (v === 'EXACT') help.textContent = 'Pisahkan dengan koma. Cocok hanya kalau isi pesan sama persis dengan salah satunya.';
    else if (v === 'STARTS_WITH') help.textContent = 'Pisahkan dengan koma. Cocok kalau pesan diawali salah satunya.';
    else help.textContent = 'Pisahkan dengan koma. Cocok kalau salah satu kata ada di pesan pelanggan.';
  };
  matchSel.onchange = syncKeywordField;
  syncKeywordField();
}

$('#btn-new-rule').onclick = () => ruleEditor(null);

$('#btn-test').onclick = async () => {
  const text = $('#test-text').value;
  if (!text.trim()) return;
  const result = await api('/rules/test', {
    method: 'POST',
    body: { text, isFirstMessage: $('#test-first').checked },
  });

  const hoursNote = result.inBusinessHours
    ? '<span class="tag green">sekarang jam kerja</span>'
    : '<span class="tag amber">sekarang di luar jam kerja</span>';

  if (!result.matched) {
    $('#test-result').innerHTML = `<div class="notice warn" style="margin-top:14px">${hoursNote}
      <br><br>Tidak ada aturan yang cocok — bot tidak akan membalas pesan ini. Pesannya tetap masuk ke inbox untuk dibalas manual.</div>`;
    return;
  }

  $('#test-result').innerHTML = `
    <div class="notice info" style="margin-top:14px">
      ${hoursNote} <span class="tag blue">${esc(result.ruleName)}</span>
      <div style="margin-top:10px;background:#fff;padding:11px 13px;border-radius:8px;white-space:pre-wrap">${esc(result.reply)}</div>
      <div style="margin-top:8px;font-size:12px;opacity:.8">Catatan: mode tes tidak menghitung jeda antar balasan. Di percakapan asli, kalau aturan ini baru saja dipakai ke kontak yang sama, bot akan lompat ke aturan berikutnya yang cocok.</div>
    </div>`;
};

$('#test-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-test').click(); });

// ---------------------------------------------------------------- settings

function renderDaysPicker() {
  $('#set-days').innerHTML = daysCheckboxes('set-day', state.settings.business_days);
  wireDayToggles(document);
}

async function loadSettings() {
  const { settings } = await api('/settings');
  state.settings = settings;
  $('#set-bot-enabled').checked = settings.bot_enabled === 'true';
  $('#set-start').value = settings.business_start;
  $('#set-end').value = settings.business_end;
  $('#set-tz').value = settings.timezone;
  $('#set-oh-enabled').checked = settings.outside_hours_enabled === 'true';
  $('#set-oh-text').value = settings.outside_hours_text;
  $('#set-oh-cooldown').value = settings.outside_hours_cooldown;
  renderDaysPicker();

  const isAdmin = state.me.role === 'ADMIN';
  ['#set-bot-enabled', '#set-start', '#set-end', '#set-tz', '#set-oh-enabled', '#set-oh-text', '#set-oh-cooldown', '#btn-save-settings']
    .forEach((sel) => { const el = $(sel); if (el) el.disabled = !isAdmin; });
}

$('#btn-save-settings').onclick = async () => {
  const days = Array.from(document.querySelectorAll('input[name=set-day]:checked')).map((i) => Number(i.value));
  try {
    await api('/settings', {
      method: 'PUT',
      body: {
        bot_enabled: $('#set-bot-enabled').checked,
        business_days: days,
        business_start: $('#set-start').value,
        business_end: $('#set-end').value,
        timezone: $('#set-tz').value,
        outside_hours_enabled: $('#set-oh-enabled').checked,
        outside_hours_text: $('#set-oh-text').value,
        outside_hours_cooldown: $('#set-oh-cooldown').value,
      },
    });
    toast('Pengaturan tersimpan');
  } catch (err) { toast(err.message, true); }
};

async function loadStats() {
  const s = await api('/settings/stats');
  $('#stats').innerHTML = `
    <div class="stat"><div class="n">${s.contacts}</div><div class="l">Total kontak</div></div>
    <div class="stat"><div class="n">${s.unread}</div><div class="l">Chat belum dibaca</div></div>
    <div class="stat"><div class="n">${s.inToday}</div><div class="l">Pesan masuk hari ini</div></div>
    <div class="stat"><div class="n">${s.autoToday}</div><div class="l">Dibalas bot hari ini</div></div>
    <div class="stat"><div class="n">${s.activeRules}</div><div class="l">Aturan aktif</div></div>
    <div class="stat"><div class="n" style="${s.failed ? 'color:var(--danger)' : ''}">${s.failed}</div><div class="l">Gagal kirim hari ini</div></div>`;
}

async function loadWaStatus() {
  state.waStatus = await api('/wa/status');
  renderWaStatus();
}

function renderWaStatus() {
  const s = state.waStatus || {};
  $('#conn-dot').classList.toggle('on', Boolean(s.connected));
  $('#conn-text').textContent = s.connected ? 'WhatsApp tersambung' : 'WhatsApp terputus';
  const note = $('#conn-note');
  if (note) {
    note.innerHTML = `Penyedia: <strong>${esc(s.provider || '-')}</strong> · ${s.connected ? 'tersambung' : 'belum tersambung'}
      ${s.me?.id ? ` · nomor ${esc(s.me.id)}` : ''}<br>${esc(s.note || '')}`;
  }
  const qr = $('#qr-area');
  if (qr) {
    qr.innerHTML = s.qr
      ? `<div class="qr-box"><img src="${s.qr}" alt="QR WhatsApp"><div class="help" style="margin-top:8px">QR berganti setiap ~20 detik, halaman ini memperbaruinya otomatis.</div></div>`
      : '';
  }
  $('#btn-simulate').classList.toggle('hidden', s.provider !== 'mock');
}

$('#btn-wa-refresh').onclick = () => loadWaStatus();
$('#btn-wa-restart').onclick = async () => {
  try { state.waStatus = await api('/wa/restart', { method: 'POST' }); renderWaStatus(); toast('Menyambung ulang…'); }
  catch (err) { toast(err.message, true); }
};
$('#btn-wa-logout').onclick = async () => {
  if (!confirm('Keluar dari WhatsApp? Anda perlu scan QR lagi untuk menyambung.')) return;
  try { state.waStatus = await api('/wa/logout', { method: 'POST' }); renderWaStatus(); }
  catch (err) { toast(err.message, true); }
};

// ---------------------------------------------------------------- users

async function loadUsers() {
  const { users } = await api('/users');
  const isAdmin = state.me.role === 'ADMIN';
  $('#btn-new-user').classList.toggle('hidden', !isAdmin);
  $('#users-body').innerHTML = users.map((u) => `
    <tr class="${u.active ? '' : 'off'}">
      <td><strong>${esc(u.name)}</strong></td>
      <td>${esc(u.email)}</td>
      <td><span class="tag ${u.role === 'ADMIN' ? 'blue' : ''}">${u.role === 'ADMIN' ? 'Admin' : 'Agen'}</span></td>
      <td style="font-size:12px;color:var(--muted)">${u.lastLoginAt ? fullTime(u.lastLoginAt) : 'belum pernah'}</td>
      <td>${u.active ? '<span class="tag green">aktif</span>' : '<span class="tag">nonaktif</span>'}</td>
      <td>${isAdmin ? `<button class="btn ghost sm" data-uedit="${u.id}">Ubah</button>
        <button class="btn ghost sm" data-utoggle="${u.id}" data-active="${u.active}">${u.active ? 'Nonaktifkan' : 'Aktifkan'}</button>` : ''}</td>
    </tr>`).join('');

  $$('#users-body [data-uedit]').forEach((b) => {
    b.onclick = () => userEditor(users.find((u) => u.id === Number(b.dataset.uedit)));
  });
  $$('#users-body [data-utoggle]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/users/${b.dataset.utoggle}`, { method: 'PATCH', body: { active: b.dataset.active !== 'true' } });
        loadUsers();
      } catch (err) { toast(err.message, true); }
    };
  });
}

function userEditor(user) {
  openModal({
    title: user ? `Ubah pengguna: ${user.name}` : 'Tambah pengguna',
    okLabel: user ? 'Simpan' : 'Buat akun',
    bodyHtml: `
      <div class="field"><label>Nama</label><input type="text" id="u-name" value="${esc(user?.name || '')}"></div>
      ${user ? '' : '<div class="field"><label>Email</label><input type="email" id="u-email"></div>'}
      <div class="field"><label>Password${user ? ' baru (kosongkan kalau tidak diganti)' : ''}</label>
        <input type="password" id="u-pass" autocomplete="new-password"><div class="help">Minimal 6 karakter.</div></div>
      <div class="field"><label>Peran</label>
        <select id="u-role">
          <option value="AGENT" ${user?.role === 'AGENT' ? 'selected' : ''}>Agen — hanya membalas chat</option>
          <option value="ADMIN" ${user?.role === 'ADMIN' ? 'selected' : ''}>Admin — akses penuh</option>
        </select></div>`,
    onOk: async (root) => {
      const body = {
        name: root.querySelector('#u-name').value,
        role: root.querySelector('#u-role').value,
      };
      const pass = root.querySelector('#u-pass').value;
      if (pass) body.password = pass;
      if (user) {
        await api(`/users/${user.id}`, { method: 'PATCH', body });
      } else {
        body.email = root.querySelector('#u-email').value;
        if (!body.password) throw new Error('Password wajib diisi untuk akun baru');
        await api('/users', { method: 'POST', body });
      }
      await loadUsers();
      toast('Pengguna tersimpan');
    },
  });
}

$('#btn-new-user').onclick = () => userEditor(null);

$('#btn-my-password').onclick = () => {
  openModal({
    title: 'Ganti password saya',
    bodyHtml: '<div class="field"><label>Password baru</label><input type="password" id="p-new" autocomplete="new-password"><div class="help">Minimal 6 karakter.</div></div>',
    onOk: async (root) => {
      await api('/users/me/password', { method: 'POST', body: { password: root.querySelector('#p-new').value } });
      toast('Password diganti');
    },
  });
};

// ----------------------------------------------------------------------------

start();
