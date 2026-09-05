// Munnesir 1.0.1 - Cloudflare D1 tek şifreli anlık senkron (Düzeltilmiş Sürüm)
(function () {
  const CONFIG_KEY = 'munnesir-cloudflare-sync-config';
  const BOOKS_KEY = 'munnesir-books';
  const DELETED_KEY = 'munnesir-sync-deleted-ids';
  const DEFAULT_API_BASE = 'https://munnesir.pages.dev'; // <-- Cloudflare canlı adresin
  const POLL_MS = 4500;
  const PUSH_DEBOUNCE_MS = 1200;

  let pushTimer = null;
  let pollTimer = null;
  let isSyncing = false;
  let lastLocalHash = '';
  let initialHashReady = false;

  const qs = (s) => document.querySelector(s);

  function safeJsonParse(value, fallback) {
    try { return JSON.parse(value || ''); } catch (_) { return fallback; }
  }

  function normalizeBase(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      // Localhost/Live Server üzerindeysek 405 hatasını engellemek için direkt Cloudflare'a yönlendir
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        return DEFAULT_API_BASE;
      }
      if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
      return DEFAULT_API_BASE;
    }
    return raw.replace(/\/+$/, '');
  }

  function loadConfig() {
    const cfg = safeJsonParse(localStorage.getItem(CONFIG_KEY), {}) || {};
    return {
      apiBase: normalizeBase(cfg.apiBase || ''),
      token: cfg.token || '',
      auto: cfg.auto !== false,
      revision: Number(cfg.revision || 0),
      lastSyncAt: cfg.lastSyncAt || '',
    };
  }

  function saveConfig(next) {
    const old = loadConfig();
    const merged = { ...old, ...next };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
    return merged;
  }

  function readBooks() {
    return safeJsonParse(localStorage.getItem(BOOKS_KEY), []) || [];
  }

  function writeBooks(books) {
    localStorage.setItem(BOOKS_KEY, JSON.stringify(Array.isArray(books) ? books : []));
  }

  function readDeleted() {
    const arr = safeJsonParse(localStorage.getItem(DELETED_KEY), []) || [];
    return Array.isArray(arr) ? arr : [];
  }

  function writeDeleted(items) {
    localStorage.setItem(DELETED_KEY, JSON.stringify(Array.isArray(items) ? items : []));
  }

  function addTombstones(ids) {
    const stamp = new Date().toISOString();
    const map = new Map(readDeleted().map((item) => [item.id, item]));
    (ids || []).filter(Boolean).forEach((id) => map.set(id, { id, deletedAt: stamp }));
    writeDeleted([...map.values()].slice(-5000));
  }

  function stamp() { return new Date().toISOString(); }

  function showToast(text) {
    if (typeof window.toast === 'function') window.toast(text);
    else console.log(text); 
  }

  function setStatus(msg, type = 'info') {
    const icons = {
      working: '<svg class="uiIcon spin"><use href="#icon-sync"></use></svg>',
      ok: '<svg class="uiIcon" style="color: #22c55e;"><use href="#icon-check"></use></svg>',
      error: '<svg class="uiIcon" style="color: #ef4444;"><use href="#icon-close"></use></svg>',
      info: '<svg class="uiIcon"><use href="#icon-sync"></use></svg>'
    };

    const html = `${icons[type] || ''}<span>${msg}</span>`;

    const statusEl = document.getElementById('syncStatusText');
    const advStatusEl = document.getElementById('syncAdvStatusText');

    if (statusEl) statusEl.innerHTML = html;
    if (advStatusEl) advStatusEl.innerHTML = html;
  }

  async function api(path, options = {}) {
    const cfg = loadConfig();
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
    
    let res = await fetch(`${cfg.apiBase}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
    });

    // 401 Unauthorized ise, kaydedilmiş şifreyle otomatik yeniden Token al (Şifre Unutma ve Çökme Fixi)
    if (res.status === 401 && path !== '/api/auth/login') {
      const savedPass = localStorage.getItem('munnesir_sync_pass');
      if (savedPass) {
         const loginRes = await fetch(`${cfg.apiBase}/api/auth/login`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ password: savedPass })
         });
         if (loginRes.ok) {
           const loginData = await loginRes.json();
           saveConfig({ token: loginData.token });
           headers.Authorization = `Bearer ${loginData.token}`;
           
           // İlk patlayan isteği yeni token ile tekrarla
           res = await fetch(`${cfg.apiBase}${path}`, {
             method: options.method || 'GET',
             headers,
             body: options.body ? JSON.stringify(options.body) : undefined,
             cache: 'no-store',
           });
         }
      }
    }

    const text = await res.text();
    const data = text ? safeJsonParse(text, { raw: text }) : {};
    if (!res.ok) {
      const msg = data && data.error ? data.error : `Bulut hatası: ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  function normalizePoem(p) {
    if (!p || typeof p !== 'object') return null;
    const content = String(p.content || p.text || p.textContent || '').replace(/\r\n/g, '\n').trim();
    const title = String(p.title || '').trim() || content.split('\n').find(Boolean) || 'Başlıksız şiir';
    if (!content) return null;
    return {
      ...p,
      id: p.id || (crypto.randomUUID ? crypto.randomUUID() : `poem-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      title,
      content,
      tags: Array.isArray(p.tags) ? p.tags : (Array.isArray(p.labels) ? p.labels : []),
      status: p.status || 'archive',
      fontFamily: p.fontFamily || 'font-tinos', 
      favorite: Boolean(p.favorite),
      source: p.source || 'sync',
      createdAt: p.createdAt || p.created_at || stamp(),
      updatedAt: p.updatedAt || p.updated_at || p.createdAt || stamp(),
      ...(p.trashedAt || p.trashed_at ? { trashedAt: p.trashedAt || p.trashed_at } : {}),
    };
  }

  function normalizeBook(book) {
    if (!book || typeof book !== 'object') return null;
    const title = String(book.title || book.name || 'Kitap Adayı').trim() || 'Kitap Adayı';
    return {
      ...book,
      id: book.id || (crypto.randomUUID ? crypto.randomUUID() : `book-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      title,
      poemIds: [...new Set(Array.isArray(book.poemIds) ? book.poemIds.filter(Boolean) : [])],
      createdAt: book.createdAt || book.created_at || stamp(),
      updatedAt: book.updatedAt || book.updated_at || stamp(),
    };
  }

  function asPayload(raw) {
    if (!raw) return { poems: [], books: [], deleted: [] };
    if (Array.isArray(raw)) return { poems: raw.map(normalizePoem).filter(Boolean), books: [], deleted: [] };
    const poems = Array.isArray(raw.poems) ? raw.poems.map(normalizePoem).filter(Boolean) : [];
    const books = Array.isArray(raw.books) ? raw.books.map(normalizeBook).filter(Boolean) : [];
    const deleted = Array.isArray(raw.deleted) ? raw.deleted.filter((x) => x && x.id) : [];
    return { ...raw, poems, books, deleted };
  }

  function timeOf(item) {
    const t = new Date(item && (item.updatedAt || item.updated_at || item.deletedAt || item.deleted_at || item.createdAt || item.created_at || 0)).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  function mergeById(localItems, cloudItems, normalizer) {
    const map = new Map();
    [...(cloudItems || []), ...(localItems || [])].forEach((item) => {
      const normalized = normalizer(item);
      if (!normalized || !normalized.id) return;
      const old = map.get(normalized.id);
      if (!old || timeOf(normalized) >= timeOf(old)) map.set(normalized.id, normalized);
    });
    return [...map.values()];
  }

  function mergeDeleted(localDeleted, cloudDeleted) {
    const map = new Map();
    [...(cloudDeleted || []), ...(localDeleted || [])].forEach((item) => {
      if (!item || !item.id) return;
      const old = map.get(item.id);
      if (!old || timeOf(item) >= timeOf(old)) map.set(item.id, { id: item.id, deletedAt: item.deletedAt || item.deleted_at || stamp() });
    });
    return [...map.values()].slice(-5000);
  }

  function enforceSingleBookPerPoem(books) {
    const normalized = (books || []).map(normalizeBook).filter(Boolean).sort((a, b) => timeOf(b) - timeOf(a));
    const used = new Set();
    const result = normalized.map((book) => {
      const poemIds = [];
      (book.poemIds || []).forEach((id) => {
        if (!used.has(id)) {
          used.add(id);
          poemIds.push(id);
        }
      });
      return { ...book, poemIds };
    });
    return result.sort((a, b) => a.title.localeCompare(b.title, 'tr'));
  }

  async function localSnapshot() {
    const poems = typeof window.getAllPoems === 'function' ? await window.getAllPoems() : [];
    return {
      app: 'munnesir',
      version: '1.0.1',
      schema: 3,
      exportedAt: stamp(),
      poems: poems.map(normalizePoem).filter(Boolean),
      books: readBooks().map(normalizeBook).filter(Boolean),
      deleted: readDeleted(),
    };
  }

  function mergeSnapshots(localRaw, cloudRaw) {
    const local = asPayload(localRaw);
    const cloud = asPayload(cloudRaw);
    const deleted = mergeDeleted(local.deleted, cloud.deleted);
    const deletedMap = new Map(deleted.map((x) => [x.id, timeOf(x)]));
    let poems = mergeById(local.poems, cloud.poems, normalizePoem).filter((poem) => {
      const deletedTime = deletedMap.get(poem.id);
      return !deletedTime || timeOf(poem) > deletedTime;
    });
    const activeIds = new Set(poems.map((p) => p.id));
    const books = enforceSingleBookPerPoem(mergeById(local.books, cloud.books, normalizeBook).map((book) => ({
      ...book,
      poemIds: (book.poemIds || []).filter((id) => activeIds.has(id)),
    })));
    return {
      app: 'munnesir',
      version: '1.0.1',
      schema: 3,
      exportedAt: stamp(),
      poems,
      books,
      deleted,
      poemCount: poems.length,
    };
  }

  async function applySnapshot(payload) {
    const normalized = asPayload(payload);
    writeBooks(normalized.books);
    writeDeleted(normalized.deleted);
    if (typeof window.importJsonPayloads === 'function') {
      await window.importJsonPayloads([{ name: 'munnesir-bulut.json', raw: normalized }], 'buluttan');
      const deletedIds = new Set(normalized.deleted.map((item) => item.id));
      if (deletedIds.size && typeof window.deleteMany === 'function') await window.deleteMany([...deletedIds]);
    } else if (typeof window.saveMany === 'function') {
      await window.saveMany(normalized.poems);
      if (typeof window.refresh === 'function') await window.refresh();
    }
  }

  async function fetchCloudSnapshot() {
    const data = await api('/api/snapshot');
    return data || { revision: 0, payload: null };
  }

  async function uploadSnapshot(payload) {
    const cfg = loadConfig();
    const data = await api('/api/snapshot', {
      method: 'PUT',
      body: { payload, clientRevision: cfg.revision || 0 },
    });
    saveConfig({ revision: data.revision || 0, lastSyncAt: stamp() });
    return data;
  }

  async function syncMerge(silent = false) {
    if (isSyncing) return;
    isSyncing = true;
    try {
      if (!silent) setStatus('Senkron başlıyor...', 'working');
      const local = await localSnapshot();
      const remote = await fetchCloudSnapshot();
      const merged = mergeSnapshots(local, remote.payload);
      await applySnapshot(merged);
      const result = await uploadSnapshot(merged);
      lastLocalHash = await localHash();
      initialHashReady = true;
      setStatus(`Senkron tamam: ${merged.poems.length} şiir.`, 'ok');
      return result;
    } finally {
      isSyncing = false;
    }
  }

  async function uploadLocalOnly() {
    setStatus('Yerel arşiv buluta gönderiliyor...', 'working');
    const payload = await localSnapshot();
    const result = await uploadSnapshot(payload);
    lastLocalHash = await localHash();
    initialHashReady = true;
    setStatus('Yerel arşiv buluta gönderildi.', 'ok');
    return result;
  }

  async function downloadCloudOnly() {
    setStatus('Bulut arşivi indiriliyor...', 'working');
    const row = await fetchCloudSnapshot();
    if (!row || !row.payload) throw new Error('Bulutta henüz Munnesir yedeği yok.');
    await applySnapshot(row.payload);
    saveConfig({ revision: row.revision || 0, lastSyncAt: stamp() });
    lastLocalHash = await localHash();
    initialHashReady = true;
    setStatus('Bulut arşivi bu cihaza alındı.', 'ok');
  }

  async function runSafely(fn, silent = false) {
    try { return await fn(); }
    catch (err) {
      console.error(err);
      const message = err.message || 'Senkron hatası.';
      setStatus(`${message}`, 'error');
    }
  }

  async function localHash() {
    const snap = await localSnapshot();
    return JSON.stringify({ poems: snap.poems, books: snap.books, deleted: snap.deleted });
  }

  function scheduleSync() {
    const cfg = loadConfig();
    if (!cfg.auto || !cfg.token || !navigator.onLine) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => runSafely(() => syncMerge(true), true), PUSH_DEBOUNCE_MS);
  }

  function patchLocalMutations() {
    const names = ['savePoem', 'saveMany', 'deletePoem', 'deleteMany', 'moveManyToTrash', 'restoreMany', 'importJsonPayloads'];
    names.forEach((name) => {
      if (typeof window[name] !== 'function' || window[name].__munnesirPatched) return;
      const original = window[name];
      const wrapped = async function (...args) {
        if (name === 'deletePoem') addTombstones([args[0]]);
        if (name === 'deleteMany') addTombstones(args[0] || []);
        const result = await original.apply(this, args);
        scheduleSync();
        return result;
      };
      wrapped.__munnesirPatched = true;
      window[name] = wrapped;
    });
  }

  async function watchLocalChanges() {
    const cfg = loadConfig();
    if (!cfg.auto || !cfg.token || !navigator.onLine || isSyncing) return;
    const hash = await localHash().catch(() => '');
    if (!hash) return;
    if (!initialHashReady) {
      lastLocalHash = hash;
      initialHashReady = true;
      return;
    }
    if (hash !== lastLocalHash) {
      lastLocalHash = hash;
      scheduleSync();
    }
  }

  async function checkRemote() {
    const cfg = loadConfig();
    if (!cfg.auto || !cfg.token || !navigator.onLine || isSyncing) return;
    const meta = await api('/api/snapshot/meta').catch(() => null);
    if (!meta) return;
    if ((meta.revision || 0) > (cfg.revision || 0)) await syncMerge(true);
  }

  function startRealtimeLoop() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      runSafely(watchLocalChanges, true);
      runSafely(checkRemote, true);
    }, POLL_MS);
    setTimeout(() => runSafely(() => syncMerge(true), true), 1600);
  }

  function bindUi() {
    // Arayüzdeki butonları HTML ile eşleyerek tam yetki verdik
    qs('#syncUploadBtn')?.addEventListener('click', () => {
      if (!confirm('Bu cihazdaki arşiv buluttaki kopyanın üzerine yazılsın mı?')) return;
      runSafely(uploadLocalOnly);
    });
    qs('#syncDownloadBtn')?.addEventListener('click', () => {
      if (!confirm('Buluttaki arşiv bu cihaza alınsın mı? Yerel şiirlerle birleştirilir.')) return;
      runSafely(downloadCloudOnly);
    });
    qs('#syncSignInBtn')?.addEventListener('click', () => runSafely(async () => {
      const apiBase = normalizeBase();
      const auto = Boolean(qs('#syncAutoInput')?.checked);
      const password = qs('#syncPasswordInput')?.value || '';
      saveConfig({ apiBase, auto });
      const data = await api('/api/auth/login', { method: 'POST', body: { password } });
      saveConfig({ token: data.token || '', revision: Number(data.revision || 0), lastSyncAt: stamp() });
      
      // ŞİFREYİ LOKALDE YEDEKLE
      localStorage.setItem('munnesir_sync_pass', password);
      
      if (qs('#syncPasswordInput')) qs('#syncPasswordInput').value = '';
      setStatus('✓ Giriş yapıldı. Anlık senkron açık.', 'ok');
      startRealtimeLoop();
      await syncMerge(true);
    }));
    qs('#syncSignOutBtn')?.addEventListener('click', () => {
      saveConfig({ token: '', revision: 0 });
      localStorage.removeItem('munnesir_sync_pass'); // Şifreyi unut
      setStatus('⚠️ Çıkış yapıldı. Oturum kapalı.', 'idle');
    });
    qs('#syncAutoInput')?.addEventListener('change', () => {
      saveConfig({ auto: Boolean(qs('#syncAutoInput')?.checked), apiBase: normalizeBase() });
      startRealtimeLoop();
    });
  }

  async function restoreStatus() {
    const cfg = loadConfig();
    if (!cfg.token) {
      setStatus('Bulut girişi bekleniyor.', 'idle');
      return;
    }
    const ok = await api('/api/auth/status').catch(() => null);
    if (ok && ok.ok) {
      setStatus('Bağlı. Anlık senkron açık.', 'ok');
      saveConfig({ revision: ok.revision || cfg.revision || 0 });
      startRealtimeLoop();
    } else {
      // Token patlamış ama şifre duruyorsa otomatik giriş yap
      const savedPass = localStorage.getItem('munnesir_sync_pass');
      if (savedPass) {
        setStatus('Oturum yenileniyor...', 'working');
        try {
          const data = await api('/api/auth/login', { method: 'POST', body: { password: savedPass } });
          saveConfig({ token: data.token || '', revision: Number(data.revision || 0), lastSyncAt: stamp() });
          setStatus('Bağlı. Anlık senkron açık.', 'ok');
          startRealtimeLoop();
        } catch(e) {
          setStatus('Oturum yenilenemedi. Şifre ile tekrar gir.', 'error');
        }
      } else {
        setStatus('Oturum süresi dolmuş. Şifre ile tekrar gir.', 'error');
      }
    }
  }

  function bootSync() {
    bindUi();
    patchLocalMutations();
    restoreStatus();
    window.addEventListener('online', () => runSafely(() => syncMerge(true), true));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootSync);
  else bootSync();

  window.MunnesirSync = { syncMerge, uploadLocalOnly, downloadCloudOnly, localSnapshot, mergeSnapshots, scheduleSync };
})();