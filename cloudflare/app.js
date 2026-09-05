(function() {
  let db = null;
  let currentEditingId = null;
  let currentSelectedFont = 'font-tinos';
  let currentReadingId = null;

  const state = {
    poems: [],
    selectedStatus: 'all',
    selectedTag: '',
    searchQuery: '',
    sortOrder: 'updatedDesc'
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  function openDB() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('munnesir-db', 1);
        req.onupgradeneeded = (e) => {
          const d = e.target.result;
          if (!d.objectStoreNames.contains('poems')) {
            d.createObjectStore('poems', { keyPath: 'id' });
          }
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(db); };
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }

  function getAllPoems() {
    return new Promise((resolve) => {
      if (!db) return resolve([]);
      try {
        const tx = db.transaction('poems', 'readonly');
        const store = tx.objectStore('poems');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  function savePoemToDB(poem) {
    return new Promise((resolve) => {
      if (!db) return resolve();
      try {
        const tx = db.transaction('poems', 'readwrite');
        const store = tx.objectStore('poems');
        store.put(poem);
        tx.oncomplete = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }

// Kartların sol altı: Şiirin orijinal yazılış tarihi
  function getPoemDate(p) {
    const rawDate = p.createdAt || p.updatedAt;
    if (!rawDate) return '';
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  // Okuma penceresi için saatli ve tam tarih formatı
  function formatDetailedDate(dStr) {
    if (!dStr) return '-';
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }


  // 4 Eylül 2026'daki toplu aktarma/içe alma damgasını tespit eder
  function isBulkImportDate(dStr) {
    if (!dStr) return false;
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return false;
    return d.getFullYear() === 2026 && d.getMonth() === 8 && d.getDate() === 4;
  }


  function plain(str) {
    return String(str || '').replace(/[&<>'"]/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
    }[c]));
  }

  async function refresh() {
    state.poems = await getAllPoems();
    renderTags();
    renderFeed();
  }

  function renderTags() {
    const container = $('#tagCloud');
    if (!container) return;
    
    // Yalnızca silinmemiş (aktif) şiirleri filtrele
    const activePoems = state.poems.filter(p => !p.trashedAt && p.status !== 'trash' && p.status !== 'deleted');

    const tagCounts = {};
    activePoems.forEach(p => {
      if (Array.isArray(p.tags)) {
        p.tags.forEach(t => {
          if (t && t !== '(boş)') {
            const clean = t.trim();
            tagCounts[clean] = (tagCounts[clean] || 0) + 1;
          }
        });
      }
    });

    const sortedTags = Object.keys(tagCounts).sort((a, b) => a.localeCompare(b, 'tr'));
    
    // Sayıyı tamamen aktif şiirlerin sayısına eşitle
    let html = `
      <button class="tagItem ${!state.selectedTag ? 'active' : ''}" data-tag="">
        <span>#(tümü)</span>
        <small style="opacity:0.6;">${activePoems.length}</small>
      </button>
    `;

    sortedTags.forEach(tag => {
      const active = state.selectedTag === tag ? 'active' : '';
      html += `
        <button class="tagItem ${active}" data-tag="${tag}">
          <span>#${plain(tag)}</span>
          <small style="opacity:0.6;">${tagCounts[tag]}</small>
        </button>
      `;
    });

    container.innerHTML = html;

    // Etiket Tıklama Dinleyicileri
    $$('#tagCloud .tagItem').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const clickedTag = btn.dataset.tag;
        state.selectedTag = clickedTag;
        
        const editBox = $('#tagEditBox');
        const editInput = $('#editTagInput');
        if (editBox && editInput) {
          if (clickedTag) {
            editBox.hidden = false;
            editInput.value = clickedTag;
          } else {
            editBox.hidden = true;
          }
        }

        renderTags();
        renderFeed();
      });
    });
  }

  function renderFeed() {
    const grid = $('#poemGrid');
    const emptyState = $('#emptyState');
    if (!grid) return;

    let list = state.poems.filter(p => !p.trashedAt && p.status !== 'trash' && p.status !== 'deleted');
    if (state.selectedStatus !== 'all') {
      if (state.selectedStatus === 'favorite') list = list.filter(p => p.favorite);
      else list = list.filter(p => p.status === state.selectedStatus);
    }

    if (state.selectedTag) {
      // Sadece kesin etiket dizisine bakar, metin içindeki boşluklu tesadüfleri eler
      list = list.filter(p => Array.isArray(p.tags) && p.tags.includes(state.selectedTag));
    }

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase('tr');
      list = list.filter(p => 
        (p.title || '').toLowerCase('tr').includes(q) || 
        (p.content || '').toLowerCase('tr').includes(q)
      );
    }

    list.sort((a, b) => {
      if (state.sortOrder === 'titleAsc') {
        return (a.title || '').localeCompare(b.title || '', 'tr');
      } else if (state.sortOrder === 'createdDesc') {
        const dateA = new Date(a.createdAt || a.updatedAt || 0);
        const dateB = new Date(b.createdAt || b.updatedAt || 0);
        return dateB - dateA;
      } else {
        // Son Düzenlenen: Sahte 4 Eylül damgası varsa orijinal doğum tarihine göre diz
        const getRealUpdated = (p) => (!p.updatedAt || isBulkImportDate(p.updatedAt)) ? (p.createdAt || 0) : p.updatedAt;
        const dateA = new Date(getRealUpdated(a));
        const dateB = new Date(getRealUpdated(b));
        return dateB - dateA;
      }
    });

    const statsLine = $('#statsLine');
    if (statsLine) statsLine.textContent = `${list.length} şiir`;

    if (!list.length) {
      grid.innerHTML = '';
      if (emptyState) emptyState.hidden = false;
      return;
    }

    if (emptyState) emptyState.hidden = true;

    // SAĞA YASLI DÜZENLE VE PAYLAŞ BUTONLU KART YAPISI
    grid.innerHTML = list.map((p) => `
      <article class="poemCard" data-id="${p.id}">
        <div class="cardMainClick" onclick="window.openReader('${p.id}')">
          <h3>${p.favorite ? '★ ' : ''}${plain(p.title)}</h3>
          <p class="${p.fontFamily || 'font-tinos'}">${plain(p.content).slice(0, 140)}...</p>
        </div>
        <div class="cardFooterActions">
          <span style="font-size:0.75rem; opacity:0.6;">${getPoemDate(p)}</span>
          <div class="cardActionBtns">
            <button class="stdBtn cardActionBtn" onclick="window.sharePoem('${p.id}', event)">
              <svg class="uiIcon"><use href="#icon-share"></use></svg>
              <span>Paylaş</span>
            </button>
            <button class="stdBtn cardActionBtn" onclick="window.editPoem('${p.id}', event)">
              <svg class="uiIcon"><use href="#icon-pen"></use></svg>
              <span>Düzenle</span>
            </button>
          </div>
        </div>
        </div>
      </article>
    `).join('');
  }

  function applyTheme(t) {
  const selected = ['light', 'purple', 'black'].includes(t) ? t : 'purple';
  document.documentElement.className = `theme-${selected}`;
  localStorage.setItem('munnesir-theme', selected);
  }

  function openReader(id) {
    const poem = state.poems.find(p => p.id === id);
    if (!poem) return;
    currentReadingId = id;

    $('#readerTitle').textContent = poem.title;
    
    const metaEl = $('#readerMeta');
    if (metaEl) {
      // Sadece oluşturulma ve güncelleme tarihleri birbirinden farklıysa düzenleme say
      const hasBeenEdited = poem.updatedAt && poem.createdAt && (poem.updatedAt !== poem.createdAt);
      
      metaEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; opacity: 0.75; margin-bottom: 12px;">
          <span><strong>İlk Düzenlenen Tarih:</strong> ${formatDetailedDate(poem.createdAt || poem.updatedAt)}</span>
          <span><strong>Son Düzenleme:</strong> ${hasBeenEdited ? formatDetailedDate(poem.updatedAt) : 'Düzenlenmedi'}</span>
        </div>
      `;
    }

    const content = $('#readerContent');
    content.textContent = poem.content;
    content.className = `readerContent ${poem.fontFamily || 'font-tinos'}`;

    document.body.classList.add('modal-open');
    $('#readerDialog')?.showModal();
  }


  function setEditorStatus(status = 'ready') {
    const input = $('#editorStatusSelect');
    if (input) input.value = status;
    
    const labels = {
      ready: 'Yayına Hazır',
      draft: 'Taslak',
      archive: 'Arşiv'
    };
    
    const labelEl = $('#statusDropdownLabel');
    if (labelEl) labelEl.textContent = labels[status] || 'Yayına Hazır';
    
    $$('#statusDropdownMenu .dropdownOption').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.value === status);
    });
  }

  function showEditor(poemId = null) {
    currentEditingId = poemId;
    const feed = $('#feedView');
    const editor = $('#editorView');

    // Akışı, Okları ve + butonunu gizle
    if (feed) feed.style.display = 'none';
    const scrollNav = $('.scrollNavContainer');
    if (scrollNav) scrollNav.style.display = 'none';
    const fabBtn = $('#newPoemFabBtn');
    if (fabBtn) fabBtn.style.display = 'none';

    document.body.style.overflow = 'hidden';

    if (editor) {
      editor.hidden = false;
      editor.removeAttribute('hidden');
      editor.style.display = 'flex';
    }

    if (poemId) {
      const poem = state.poems.find(p => p.id === poemId);
      if (poem) {
        if ($('#editorTitleInput')) $('#editorTitleInput').value = poem.title || '';
        if ($('#editorContentInput')) $('#editorContentInput').value = poem.content || '';
        if ($('setEditorStatus')) $('setEditorStatus').value = poem.status || 'ready';
      }
    } else {
      if ($('#editorTitleInput')) $('#editorTitleInput').value = '';
      if ($('#editorContentInput')) $('#editorContentInput').value = '';
      if ($('setEditorStatus')) $('setEditorStatus').value = 'ready';
    }
    updateEditorStats();
  }

  function hideEditor() {
    const feed = $('#feedView');
    const editor = $('#editorView');

    // Okları ve + butonunu geri getir
    document.body.style.overflow = '';
    const scrollNav = $('.scrollNavContainer');
    if (scrollNav) scrollNav.style.display = 'flex';
    const fabBtn = $('#newPoemFabBtn');
    if (fabBtn) fabBtn.style.display = 'flex';

    if (editor) {
      editor.hidden = true;
      editor.setAttribute('hidden', '');
      editor.style.display = 'none';
    }
    if (feed) feed.style.display = 'block';
    
    currentEditingId = null;
    refresh();
  }

  function initEvents() {

    $('#sidebarToggle')?.addEventListener('click', () => {
      $('#sidebar')?.classList.toggle('open');
    });

    $('#scrollTopBtn')?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    $('#scrollBottomBtn')?.addEventListener('click', () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });


    // ARKA PLAN DONDURMA KÖPRÜLERİ
    const openModal = (dialogId) => {
      document.body.classList.add('modal-open');
      $(dialogId)?.showModal();
    };

    // TÜM MODALLAR İÇİN OTOMATİK SCROLL KİLİDİ AÇICI (ESC tuşu dahil)
    $$('dialog').forEach(dialog => {
      dialog.addEventListener('close', () => {
        // Eğer ekranda başka açık modal kalmadıysa arka plan kilidini kaldır
        if (!document.querySelector('dialog[open]')) {
          document.body.classList.remove('modal-open');
        }
      });
    });

    // TEKİL MODAL VE EDİTÖR KÖPRÜLERİ
    $('#newPoemFabBtn')?.addEventListener('click', () => showEditor(null));
    $('#closeEditorBtn')?.addEventListener('click', () => hideEditor());

    $('#settingsOpenBtn')?.addEventListener('click', () => openModal('#settingsDialog'));
    $('#closeSettingsBtn')?.addEventListener('click', () => $('#settingsDialog')?.close());

    $('#openSyncAdvBtn')?.addEventListener('click', () => openModal('#syncAdvDialog'));
    $('#closeSyncAdvBtn')?.addEventListener('click', () => $('#syncAdvDialog')?.close());

    $('#closeReaderBtn')?.addEventListener('click', () => $('#readerDialog')?.close());
    $('#closeBookBtn')?.addEventListener('click', () => $('#bookDialog')?.close());
    $('#closeTrashBtn')?.addEventListener('click', () => $('#trashDialog')?.close());


    // AUTOFILL (OTOMATİK DOLDURMA) ENGELLEMELİ ARAMA
    const searchEl = $('#searchInput');
    if (searchEl) {
      // Sayfa ilk açıldığında tarayıcı otomatik doldurduysa temizle
      if (searchEl.value.includes('http') || searchEl.value.includes('munnesir')) {
        searchEl.value = '';
        state.searchQuery = '';
      }

      searchEl.addEventListener('input', (e) => {
        // Eğer kullanıcı kendisi odaklanıp yazmadıysa (autofill sapmasıysa) temizle
        if (e.target.value.includes('http://') || e.target.value.includes('https://')) {
          e.target.value = '';
          state.searchQuery = '';
          renderFeed();
          return;
        }
        state.searchQuery = e.target.value.trim();
        renderFeed();
      });
    }

    // ARKA PLANA TIKLANINCA EDİTÖRÜN KAPANMASINI ENGELLEME
    const poemDlg = $('#poemDialog');
    poemDlg?.addEventListener('click', (e) => {
      const rect = poemDlg.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        e.preventDefault(); // Dışarı tıklansa bile kapanmaz
      }
    });


    // KİTAP ADAYLARI
    $('#bookViewBtn')?.addEventListener('click', () => {
      document.body.classList.add('modal-open'); // ARKA PLAN KAYMA KİLİDİ
      const localBooks = JSON.parse(localStorage.getItem('munnesir-books') || '[]');
      const bookPoemIds = new Set();
      localBooks.forEach(b => (b.poemIds || []).forEach(id => bookPoemIds.add(id)));

      const books = state.poems.filter(p => p.isBookCandidate || p.status === 'book' || bookPoemIds.has(p.id));
      const container = $('#bookListContainer');

      if (books.length) {
        container.className = "poemGrid";
        container.innerHTML = books.map(b => `
          <article class="poemCard" data-id="${b.id}">
            <div class="cardMainClick" onclick="window.openReader('${b.id}')">
              <h3>${plain(b.title)}</h3>
              <p class="${b.fontFamily || 'font-tinos'}">${plain(b.content).slice(0, 140)}...</p>
            </div>
            <div class="cardFooterActions">
              <span style="font-size:0.75rem; opacity:0.6;">${getPoemDate(b)}</span>
              <div class="cardActionBtns">
                <button class="stdBtn cardActionBtn" onclick="window.sharePoem('${b.id}', event)">
                  <svg class="uiIcon"><use href="#icon-share"></use></svg><span>Paylaş</span>
                </button>
                <button class="stdBtn cardActionBtn" onclick="window.editPoem('${b.id}', event)">
                  <svg class="uiIcon"><use href="#icon-pen"></use></svg><span>Düzenle</span>
                </button>
              </div>
            </div>
          </article>
        `).join('');
      } else {
        container.className = "modalBody";
        container.innerHTML = '<p>Henüz kitap adayı olarak işaretlenmiş bir çalışma bulunamadı.</p>';
      }
      $('#bookDialog')?.showModal();
    });



    // ÇÖP KUTUSU
    $('#trashViewBtn')?.addEventListener('click', async () => {
      document.body.classList.add('modal-open'); // ARKA PLAN KAYMA KİLİDİ
      const deletedSyncIds = new Set(JSON.parse(localStorage.getItem('munnesir-sync-deleted-ids') || '[]').map(x => x.id));
      const trashed = state.poems.filter(p => p.trashedAt || p.status === 'trash' || p.status === 'deleted' || deletedSyncIds.has(p.id));
      const container = $('#trashListContainer');

      if (trashed.length) {
        container.className = "poemGrid";
        container.innerHTML = trashed.map(t => `
          <article class="poemCard" data-id="${t.id}">
            <div class="cardMainClick" onclick="window.openReader('${t.id}', true)">
              <h3>${plain(t.title)}</h3>
              <p class="${t.fontFamily || 'font-tinos'}">${plain(t.content).slice(0, 140)}...</p>
            </div>
            <div class="cardFooterActions">
              <span style="font-size:0.75rem; opacity:0.6;">${getPoemDate(t)}</span>
              <div class="cardActionBtns">
                <button class="stdBtn cardActionBtn" onclick="window.restorePoem('${t.id}', event)">
                  <svg class="uiIcon"><use href="#icon-restore"></use></svg><span>Geri Yükle</span>
                </button>
                <button class="stdBtn cardActionBtn btn-danger" onclick="window.hardDeletePoem('${t.id}', event)">
                  <svg class="uiIcon"><use href="#icon-trash"></use></svg><span>Kalıcı Sil</span>
                </button>
              </div>
            </div>
          </article>
        `).join('');
      } else {
        container.className = "modalBody";
        container.innerHTML = '<p>Çöp kutusu boş.</p>';
      }
      $('#trashDialog')?.showModal();
    });

    
    // TEMA VE DURUM FİLTRESİ KÖPRÜLERİ
    $$('.themeChoice').forEach(btn => {
      btn.addEventListener('click', () => applyTheme(btn.dataset.themeChoice));
    });

    $$('#statusFilters button').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#statusFilters button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedStatus = btn.dataset.status;
        renderFeed();
      });
    });

    // Kaydedilmiş temayı ilk açılışta uygular
    applyTheme(localStorage.getItem('munnesir-theme') || 'purple');


    // JSON DIŞA AKTAR (YEDEK AL)
    $('#exportJsonBtn')?.addEventListener('click', async () => {
      const all = await getAllPoems();
      const advStatus = $('#syncAdvStatusText');
      if (!all || all.length === 0) {
        if (advStatus) advStatus.textContent = '⚠️ İndirilecek şiir bulunamadı.';
        return;
      }
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ poems: all }, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `munnesir_arsiv_${new Date().toISOString().slice(0,10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      if (advStatus) advStatus.textContent = `✓ ${all.length} şiir JSON olarak indirildi.`;
    });

    // ANDROID & WEB UYUMLU GELİŞMİŞ JSON IMPORT PARSER
    const jsonInput = document.getElementById('jsonFileInput');
    
    $('#importJsonBtn')?.addEventListener('click', () => {
      if (jsonInput) {
        jsonInput.value = '';
        jsonInput.click();
      }
    });

    jsonInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      const advStatus = document.getElementById('syncAdvStatusText');
      if (!file) return;

      if (advStatus) advStatus.textContent = '⏳ JSON okunuyor ve veritabanı hazırlanıyor...';

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          let rawPoems = [];

          // 1. FORMAT TESPİTİ (Munnesir v1.0, Keep Export, Dizi)
          if (parsed && Array.isArray(parsed.poems)) {
            rawPoems = parsed.poems;
          } else if (Array.isArray(parsed)) {
            rawPoems = parsed;
          } else if (typeof parsed === 'object') {
            rawPoems = [parsed];
          }

          if (!rawPoems.length) {
            if (advStatus) advStatus.textContent = '⚠️ Geçerli şiir verisi bulunamadı.';
            return;
          }

          // 2. VERİ RESTORASYONU VE ETİKET DÜZENLEME
          const formattedPoems = rawPoems.map((item, idx) => {
            let tags = Array.isArray(item.tags) ? item.tags.filter(t => t && t !== '(boş)') : [];
            
            const contentText = item.content || item.textContent || item.text || '';
            const titleText = item.title || item.userTitle || 'Başlıksız Şiir';

            // İçerikten dinamik #etiket çıkarma
            const bodyTags = contentText.match(/#([\wğüşıöçGÜŞİÖÇ-]+)/g);
            if (bodyTags) {
              bodyTags.forEach(bt => {
                const cleanTag = bt.replace('#', '').trim();
                if (cleanTag && !tags.includes(cleanTag)) tags.push(cleanTag);
              });
            }

            return {
              id: item.id || `poem_${Date.now()}_${idx}`,
              title: titleText,
              content: contentText,
              status: item.status || 'ready',
              favorite: Boolean(item.favorite),
              source: item.source || 'manual',
              tags: tags.length ? tags : ['(boş)'],
              // app.js (JSON Yükleme Bloğu)
              createdAt: item.createdAt || new Date().toISOString(),
              updatedAt: item.updatedAt || item.createdAt || new Date().toISOString() // Boşsa bugünü değil, oluşturulma tarihini alsın
            };
          }).filter(p => p.content && p.content.trim() !== '');

          // 3. ANDROID WEBVIEW INDEXEDDB YAZMA KİLİDİ
          const currentDb = await openDB();
          if (!currentDb) {
            if (advStatus) advStatus.textContent = '❌ Veritabanı bağlantısı kurulamadı.';
            return;
          }

          const tx = currentDb.transaction('poems', 'readwrite');
          const store = tx.objectStore('poems');

          formattedPoems.forEach(p => store.put(p));

          tx.oncomplete = async () => {
            await refresh();
            const allInDb = await getAllPoems();
            
            if (advStatus) {
              advStatus.textContent = `✓ Başarılı! ${formattedPoems.length} şiir yüklendi (Toplam: ${allInDb.length}).`;
            }

            if (typeof renderTags === 'function') renderTags();
          };

          tx.onerror = (err) => {
            console.error('DB Write Error:', err);
            if (advStatus) advStatus.textContent = '❌ Veritabanına yazılırken hata oluştu.';
          };

        } catch (err) {
          console.error('JSON Parsing Error:', err);
          if (advStatus) advStatus.textContent = '❌ Dosya okunamadı. Geçersiz JSON formatı.';
        }
      };

      reader.readAsText(file, 'UTF-8');
    });


    // ETİKET İSMİNİ DEĞİŞTİRME VE BOZUKLARI OTOMATİK ONARMA
    $('#saveTagRenameBtn')?.addEventListener('click', async () => {
      const oldTag = state.selectedTag;
      let newTag = $('#editTagInput')?.value.trim();

      if (!oldTag || !newTag || oldTag === newTag) return;

      // Boşlukları otomatik alt tire yap (Kritik Koruma)
      newTag = newTag.replace(/\s+/g, '_');

      const escapedOldTag = oldTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const tagRegex = new RegExp('#' + escapedOldTag + '(?![\\wığüşöçİĞÜŞÖÇ0-9_])', 'g');

      const changedPoems = [];

      for (const poem of state.poems) {
        let changed = false;

        // 1. Şiir içeriğindeki bozuk metni bul ve değiştir
        if (poem.content && poem.content.includes(`#${oldTag}`)) {
          poem.content = poem.content.replace(tagRegex, `#${newTag}`);
          changed = true;
        }

        // 2. Etiket dizisini onar (Eskiyi sil, yeniyi ekle ve 24 şiiri kurtar)
        if (changed || (Array.isArray(poem.tags) && poem.tags.includes(oldTag))) {
          if (!Array.isArray(poem.tags)) poem.tags = [];
          poem.tags = poem.tags.filter(t => t !== oldTag); 
          if (!poem.tags.includes(newTag)) poem.tags.push(newTag); 
          changed = true;
        }

        if (changed) {
          poem.updatedAt = new Date().toISOString();
          changedPoems.push(poem);
        }
      }

      if (changedPoems.length > 0) {
        if (typeof window.saveMany === 'function') {
          await window.saveMany(changedPoems);
        } else {
          for (const p of changedPoems) await savePoemToDB(p);
        }
        
        state.selectedTag = newTag;
        await refresh();
        
        alert(`✓ Başarılı! '${oldTag}' etiketi '${newTag}' yapıldı ve ${changedPoems.length} şiir onarılarak eşitlendi.`);
        const editBox = $('#tagEditBox');
        if (editBox) editBox.hidden = true;
      }
    });


    // SIRALAMA SEKME DİNLEYİCİLERİ
    const sortTabButtons = $$('#sortTabsContainer .sortTabBtn');
    sortTabButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        sortTabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        state.sortOrder = btn.dataset.value;
        renderFeed();
      });
    });

    // TAM EKRAN EDİTÖR KAYDET BUTONU
    $('#editorSaveBtn')?.addEventListener('click', async () => {
      const title = $('#editorTitleInput')?.value.trim() || 'Başlıksız Şiir';
      const content = $('#editorContentInput')?.value.trim() || '';
      if (!content) return;

      const selectedStatus = $('#editorStatusSelect')?.value || 'ready';
      // Rakamlar (0-9) ve alt tire (_) eklendi, boşluklarda otomatik keser
      const extractedTags = (content.match(/#[\wığüşöçİĞÜŞÖÇ0-9_]+/g) || []).map(t => t.replace('#', ''));

      // Eski şiirin fontunu koru, yeni şiirse Tinos yap
      let existingFont = 'font-tinos';
      if (currentEditingId) {
        const oldPoem = state.poems.find(p => p.id === currentEditingId);
        if (oldPoem && oldPoem.fontFamily) existingFont = oldPoem.fontFamily;
      }

      const poemData = {
        id: currentEditingId || `poem-${Date.now()}`,
        title,
        content,
        tags: extractedTags,
        fontFamily: existingFont,
        status: selectedStatus,
        updatedAt: new Date().toISOString(),
        createdAt: currentEditingId ? (state.poems.find(p => p.id === currentEditingId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
        favorite: currentEditingId ? (state.poems.find(p => p.id === currentEditingId)?.favorite || false) : false
      };

      await savePoemToDB(poemData);
      
      // ID'yi sabit tut, editörü kapatma
      currentEditingId = poemData.id; 
      refresh(); 

      // Görsel Geri Bildirim
      const saveBtn = $('#editorSaveBtn');
      const originalText = saveBtn.innerHTML;
      saveBtn.innerHTML = '✓ Kaydedildi';
      saveBtn.classList.add('active');
      
      setTimeout(() => {
        saveBtn.innerHTML = originalText;
        saveBtn.classList.remove('active');
      }, 2000);
    });

    $('#editorAddTagBtn')?.addEventListener('click', () => {
      const input = $('#editorContentInput');
      if (input) {
        input.value += ' #yeniEtiket';
        input.focus();
        updateEditorStats();
      }
    });

    $('#editorShareBtn')?.addEventListener('click', () => {
      const title = $('#editorTitleInput').value.trim();
      const content = $('#editorContentInput').value.trim();
      if (!content) return;
      const shareText = `${title}\n\n${content}\n\n— Munnesir`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(shareText).then(() => {
          alert('Şiir metni kopyalandı!');
        });
      }
    });
    // YAZI EDİTÖRÜ DİNLEYİCİLERİ SONU


    $('#readerShareBtn')?.addEventListener('click', (e) => {
        if (currentReadingId) window.sharePoem(currentReadingId, e);
    });

    $('#readerEditBtn')?.addEventListener('click', (e) => {
      if (currentReadingId) {
        $('#readerDialog')?.close();
        window.editPoem(currentReadingId, e);
      }
    });

    $('#readerSoftDeleteBtn')?.addEventListener('click', (e) => {
      if (currentReadingId) window.moveToTrash(currentReadingId, e);
    });

    $('#readerDeleteBtn')?.addEventListener('click', (e) => {
      if (currentReadingId) window.hardDeletePoem(currentReadingId, e);
    });

    $('#readerRestoreBtn')?.addEventListener('click', (e) => {
    if (currentReadingId) window.restorePoem(currentReadingId, e);
    });


    // DURUM AÇILIR MENÜSÜ DİNLEYİCİSİ
    const statusDropdown = $('#statusDropdown');
    $('#statusDropdownBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      statusDropdown?.classList.toggle('open');
    });

    $$('#statusDropdownMenu .dropdownOption').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        setEditorStatus(opt.dataset.value);
        statusDropdown?.classList.remove('open');
      });
    });

    // Menü dışına tıklandığında otomatik kapatma
    document.addEventListener('click', (e) => {
      if (!statusDropdown?.contains(e.target)) {
        statusDropdown?.classList.remove('open');
      }
    });

  }//****** initEvents sonu ******



  // SYNC VE VERİ TABANI KÖPRÜSÜ (1276 ŞİİRİ EKRANA DÖKER)
  window.getAllPoems = getAllPoems;
  window.savePoem = savePoemToDB;
  window.refresh = refresh;
  window.refreshAll = refresh;

  // Sync.js veriyi indirince veritabanına toplu yazar ve ekranı günceller
  window.saveMany = async function(poems) {
    if (!poems || !Array.isArray(poems)) return;
    await openDB();
    if (!db) return;

    return new Promise((resolve) => {
      const tx = db.transaction('poems', 'readwrite');
      const store = tx.objectStore('poems');
      poems.forEach(p => {
        if (p && p.id) store.put(p);
      });
      tx.oncomplete = async () => {
        await refresh();
        resolve();
      };
    });
  };

  // SYNC SNAPSHOT PAYLOAD ÇÖZÜCÜ (STRING/JSON GARANTİLİ PARSER)
  window.importJsonPayloads = async function(payloads) {
    if (!payloads || !payloads.length) return;
    let allPoems = [];

    for (const item of payloads) {
      let raw = item.raw || item.payload || item.data || item;
      
      // Eğer Cloudflare KV'den gelen 'raw' verisi bir JSON String ise çöz
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch (e) {
          console.error('Snapshot Parse Error:', e);
        }
      }

      let poems = [];
      if (raw && Array.isArray(raw.poems)) {
        poems = raw.poems;
      } else if (Array.isArray(raw)) {
        poems = raw;
      } else if (raw && typeof raw === 'object' && raw.content) {
        poems = [raw];
      }

      if (poems.length) allPoems.push(...poems);
    }

    if (allPoems.length) {
      await window.saveMany(allPoems);
      await refresh();
    } else {
      await refresh();
    }
  };

  function applyEditorFont(fontClass) {
    const title = $('#editorTitleInput');
    const content = $('#editorContentInput');
    if (title && content) {
      title.className = `editorTitleInput ${fontClass}`;
      content.className = `editorContentArea ${fontClass}`;
    }
  }

  function updateEditorStats() {
    const content = $('#editorContentInput')?.value || '';
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const chars = content.length;
    const statsEl = $('#editorStats');
    if (statsEl) statsEl.textContent = `${words} kelime | ${chars} karakter`;
  }

  // GLOBAL DÜZENLEME VE PAYLAŞMA KÖPRÜLERİ

  // OKUMA PENCERESİ AÇICI
  window.openReader = function(id, isTrash = false) {
    const poem = state.poems.find(p => String(p.id) === String(id));
    if (!poem) return;
    currentReadingId = poem.id;

    $('#readerTitle').textContent = poem.title;
    
    const metaEl = $('#readerMeta');
    if (metaEl) {
      const hasBeenEdited = poem.updatedAt && poem.createdAt && (poem.updatedAt !== poem.createdAt) && (typeof isBulkImportDate === 'function' ? !isBulkImportDate(poem.updatedAt) : true);
      metaEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; opacity: 0.75; margin-bottom: 12px;">
          <span><strong>İlk Düzenlenen Tarih:</strong> ${formatDetailedDate(poem.createdAt || poem.updatedAt)}</span>
          <span><strong>Son Düzenleme:</strong> ${hasBeenEdited ? formatDetailedDate(poem.updatedAt) : 'Düzenlenmedi'}</span>
        </div>
      `;
    }

    const content = $('#readerContent');
    content.textContent = poem.content;
    content.className = `readerContent ${poem.fontFamily || 'font-tinos'}`;

    // BUTON GÖSTER/GİZLE MANTIĞI
    const stdActions = $('#readerStandardActions');
    const trashActions = $('#readerTrashActions');
    
    // Şiir çöp kutusundaysa veya açıkça çöp kutusu modunda çağrıldıysa
    const isTrashedPoem = isTrash || poem.trashedAt || poem.status === 'trash' || poem.status === 'deleted';

    if (isTrashedPoem) {
      if (stdActions) stdActions.style.display = 'none';
      if (trashActions) trashActions.style.display = 'flex';
    } else {
      if (stdActions) stdActions.style.display = 'flex';
      if (trashActions) trashActions.style.display = 'none';
    }

    document.body.classList.add('modal-open');
    $('#readerDialog')?.showModal();
  };

  window.editPoem = function(id, e) {
    if (e) e.stopPropagation();
    showEditor(id);
  };

  window.sharePoem = function(id, e) {
    if (e) e.stopPropagation();
    const poem = state.poems.find(p => p.id === id);
    if (!poem) return;

    const shareText = `${poem.title}\n\n${poem.content}\n\n— Munnesir`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareText).then(() => {
        alert('Şiir metni panoya kopyalandı!');
      });
    }
  };

  window.restorePoem = async function(id, e) {
    if (e) e.stopPropagation();
    const poem = state.poems.find(p => String(p.id) === String(id));
    if (!poem) return;

    poem.trashedAt = null;
    if (poem.status === 'trash' || poem.status === 'deleted') {
      poem.status = 'archive'; // Geri dönen şiir güvende kalsın diye arşive alınır
    }
    poem.updatedAt = new Date().toISOString();

    await window.savePoem(poem);
    await window.refresh();

    // Eğer çöp kutusu veya okuma penceresi açıksa UI'ı yenile
    $('#readerDialog')?.close();
    const trashBtn = $('#trashViewBtn');
    if (trashBtn && $('#trashDialog')?.open) trashBtn.click();
  };

  window.moveToTrash = async function(id, e) {
    if (e) e.stopPropagation();
    if (!confirm('Bu şiiri çöp kutusuna taşımak istediğinize emin misiniz?')) return;

    const poem = state.poems.find(p => String(p.id) === String(id));
    if (!poem) return;

    // Şiiri çöp kutusuna gönderen etiketleri basıyoruz
    poem.trashedAt = new Date().toISOString();
    poem.status = 'trash';
    poem.updatedAt = new Date().toISOString();

    await window.savePoem(poem);
    await window.refresh();

    // İşlem bitince pencereyi kapat
    $('#readerDialog')?.close();
  };

  window.hardDeletePoem = async function(id, e) {
    if (e) e.stopPropagation();
    
    // 1. "Kalıcı" kelimesi çıkarıldı ve metin sadeleştirildi
    if (!confirm('Bu şiiri silmek istediğinize emin misiniz?')) return;

    // 2. Tip Uyuşmazlığı Çözümü (Silinmeme sorununun ana nedeni)
    const poem = state.poems.find(p => String(p.id) === String(id));
    if (!poem) return;

    // Veritabanından kazıma işlemi
    const tx = db.transaction('poems', 'readwrite');
    const store = tx.objectStore('poems');
    
    // Ham id yerine, eşleşen orijinal poem.id'yi kullanarak tip uyuşmazlığını aşıyoruz
    store.delete(poem.id); 
    
    tx.oncomplete = async () => {
      await window.refresh();
      $('#readerDialog')?.close();
      const trashBtn = $('#trashViewBtn');
      if (trashBtn && $('#trashDialog')?.open) trashBtn.click();
    };
  };

// SAYFA İLK AÇILDIĞINDA EDİTÖRÜ GİZLİ TUT, AKIŞI GÖSTER
  document.addEventListener('DOMContentLoaded', async () => {
    await openDB();
    initEvents();
    
    const editor = $('#editorView');
    const feed = $('#feedView');
    if (editor) {
      editor.hidden = true;
      editor.style.display = 'none';
    }
    if (feed) feed.style.display = 'block';

    await refresh();
  });

})();