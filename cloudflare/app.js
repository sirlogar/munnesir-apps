(function() {
  let db = null;
  let currentEditingId = null;
  let currentEditorTags = []; // Pop-up'ta seçilen etiketleri hafızada tutar
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
    const tagDisplayMap = {};

    activePoems.forEach(p => {
      if (Array.isArray(p.tags)) {
        // Şiir içindeki mükerrer etiketleri tekilleştir (1 şiirde 2 kez #deneme varsa 1 sayılsın)
        const seenInPoem = new Set();
        p.tags.forEach(rawTag => {
          if (!rawTag || rawTag === '(boş)') return;
          const clean = rawTag.trim();
          const key = clean.toLowerCase('tr');
          if (!seenInPoem.has(key)) {
            seenInPoem.add(key);
            tagCounts[key] = (tagCounts[key] || 0) + 1;
            if (!tagDisplayMap[key]) tagDisplayMap[key] = clean;
          }
        });
      }
    });

    const sortedKeys = Object.keys(tagCounts).sort((a, b) => a.localeCompare(b, 'tr'));
    
    let html = `
      <button class="tagItem ${!state.selectedTag ? 'active' : ''}" data-tag="">
        <span>#(tümü)</span>
        <small style="opacity:0.6;">${activePoems.length}</small>
      </button>
    `;

    sortedKeys.forEach(key => {
      const displayTag = tagDisplayMap[key];
      const active = state.selectedTag && state.selectedTag.toLowerCase('tr') === key ? 'active' : '';
      html += `
        <button class="tagItem ${active}" data-tag="${plain(displayTag)}">
          <span>#${plain(displayTag)}</span>
          <small style="opacity:0.6;">${tagCounts[key]}</small>
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
      const target = state.selectedTag.trim().toLowerCase('tr');
      list = list.filter(p => 
        Array.isArray(p.tags) && 
        p.tags.some(t => t && t.trim().toLowerCase('tr') === target)
      );
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

    if (poemId) {
      const poem = state.poems.find(p => p.id === poemId);
      currentEditorTags = poem && Array.isArray(poem.tags) ? [...poem.tags] : [];
    } else {
      currentEditorTags = [];
    }
    updateEditorTagsDisplay();

  }

  function updateEditorTagsDisplay() {
    const displayEl = $('#editorTagsDisplay');
    if (!displayEl) return;
    displayEl.innerHTML = currentEditorTags.map(tag => 
      `<span class="editorTagBadge">#${plain(tag)}</span>`
    ).join('');
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

    // SİDEBAR DIŞINA (BOŞLUĞA) TIKLAYINCA KAPATMA
    document.addEventListener('click', (e) => {
      const sidebar = $('#sidebar');
      const toggleBtn = $('#sidebarToggle');

      if (sidebar?.classList.contains('open')) {
        const isAnyModalOpen = document.querySelector('dialog[open]');
        
        // Tıklanan yer menü, buton veya HERHANGİ BİR POP-UP'IN İÇİ (çarpı butonu dahil) DEĞİLSE kapat
        if (!sidebar.contains(e.target) && !toggleBtn?.contains(e.target) && !isAnyModalOpen && !e.target.closest('dialog')) {
          sidebar.classList.remove('open');
        }
      }
    });


    // LOGO VE YAZIYA TIKLAYINCA ANA SAYFAYA DÖNME (RESET)
    $('#homeLogoBtn')?.addEventListener('click', () => {
      // 1. Editör açıksa güvenlice arşive dön
      const editor = $('#editorView');
      if (editor && !editor.hidden && typeof hideEditor === 'function') {
        hideEditor();
      }
      
      // 2. Ekranda açık okuma veya ayarlar penceresi varsa kapat
      $$('dialog[open]').forEach(d => d.close());

      // 3. Filtreleri, aramaları ve etiketleri sıfırla
      state.selectedTag = '';
      state.selectedStatus = 'all';
      state.searchQuery = '';
      
      if ($('#searchInput')) $('#searchInput').value = '';
      if ($('#tagEditBox')) $('#tagEditBox').hidden = true;
      
      // 4. Sol menüdeki buton görünümünü "Tümü"ne al
      $$('#statusFilters button').forEach(b => b.classList.remove('active'));
      const allBtn = document.querySelector('#statusFilters button[data-status="all"]');
      if (allBtn) allBtn.classList.add('active');

      // 5. Sidebar'ı kapat
      $('#sidebar')?.classList.remove('open');

      // 6. En üste kaydır ve akışı yenile
      window.scrollTo({ top: 0, behavior: 'smooth' });
      renderTags();
      renderFeed();
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
    
    // SADECE OKUMA PENCERESİNDE ARKA PLANA (BOŞLUĞA) TIKLAYINCA KAPANMA
    const readerDialog = $('#readerDialog');
    readerDialog?.addEventListener('click', (e) => {
      // Eğer tıklanan nokta doğrudan arka plan karartmasıysa pencereyi kapat
      if (e.target === readerDialog) {
        readerDialog.close();
      }
    });

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



    // KİTAP ADAYLARI POP-UP VE YÖNETİM MERKEZİ
    let tempCandidateIds = new Set();

    function renderBookListModal() {
      const localBooks = JSON.parse(localStorage.getItem('munnesir-books') || '[]');
      const bookPoemIds = new Set();
      localBooks.forEach(b => (b.poemIds || []).forEach(id => bookPoemIds.add(id)));

      const books = state.poems.filter(p => !p.trashedAt && (p.isBookCandidate || p.status === 'book' || bookPoemIds.has(p.id)));
      const container = $('#bookListContainer');

      if (!container) return;

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
        container.innerHTML = '<p style="text-align: center; opacity: 0.7; padding: 20px 0;">Henüz kitap adayı olarak işaretlenmiş bir çalışma bulunamadı.<br>Yukarıdaki butonla şiir seçebilirsiniz.</p>';
      }
    }

    function renderCandidateChecklist(filterQuery = '') {
      const listEl = $('#bookCandidateCheckList');
      if (!listEl) return;

      const activePoems = state.poems.filter(p => !p.trashedAt && p.status !== 'trash');
      const q = filterQuery.toLowerCase('tr');
      const filtered = q ? activePoems.filter(p => (p.title || '').toLowerCase('tr').includes(q) || (p.content || '').toLowerCase('tr').includes(q)) : activePoems;

      listEl.innerHTML = filtered.map(p => {
        const isChecked = tempCandidateIds.has(p.id);
        return `
          <div class="bookPickRow">
            <label>
              <input type="checkbox" class="bookCandidateCheckbox" data-id="${p.id}" ${isChecked ? 'checked' : ''} />
              <span>${plain(p.title || 'Başlıksız')}</span>
            </label>
          </div>
        `;
      }).join('');

      $('#selectedCandidatesBadge').textContent = `${tempCandidateIds.size} Aday Seçili`;
    }

    // Kitap Adayları Butonuna Basınca
    $('#bookViewBtn')?.addEventListener('click', () => {
      document.body.classList.add('modal-open');
      $('#bookSelectorPanel').hidden = true;
      renderBookListModal();
      $('#bookDialog')?.showModal();
    });

    // Şiir Ekle / Çıkar Panelini Aç/Kapat
    $('#toggleBookSelectorBtn')?.addEventListener('click', () => {
      const panel = $('#bookSelectorPanel');
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        // Mevcut adayları kümeye topla
        tempCandidateIds = new Set(
          state.poems
            .filter(p => !p.trashedAt && (p.isBookCandidate || p.status === 'book'))
            .map(p => p.id)
        );
        $('#bookSearchInput').value = '';
        renderCandidateChecklist();
      }
    });

    // Arama Girişi
    $('#bookSearchInput')?.addEventListener('input', (e) => {
      renderCandidateChecklist(e.target.value.trim());
    });

    // Seçim Kutusuna Tıklama (Delegation)
    $('#bookCandidateCheckList')?.addEventListener('change', (e) => {
      if (e.target.classList.contains('bookCandidateCheckbox')) {
        const id = e.target.dataset.id;
        if (e.target.checked) tempCandidateIds.add(id);
        else tempCandidateIds.delete(id);
        $('#selectedCandidatesBadge').textContent = `${tempCandidateIds.size} Aday Seçili`;
      }
    });

    // Vazgeç Butonu
    $('#cancelBookSelectionBtn')?.addEventListener('click', () => {
      $('#bookSelectorPanel').hidden = true;
    });

    // Adayları Kaydet Butonu
    $('#saveBookSelectionBtn')?.addEventListener('click', async () => {
      const changed = [];
      state.poems.forEach(p => {
        const shouldBeCandidate = tempCandidateIds.has(p.id);
        if (Boolean(p.isBookCandidate) !== shouldBeCandidate) {
          p.isBookCandidate = shouldBeCandidate;
          p.updatedAt = new Date().toISOString();
          changed.push(p);
        }
      });

      if (changed.length > 0) {
        if (typeof window.saveMany === 'function') await window.saveMany(changed);
        else {
          for (const p of changed) await savePoemToDB(p);
        }
      }

      $('#bookSelectorPanel').hidden = true;
      renderBookListModal();
      refresh();
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
      
      // Eski şiirin fontunu koru, yeni şiirse Tinos yap
      let existingFont = 'font-tinos';
      if (currentEditingId) {
        const oldPoem = state.poems.find(p => p.id === currentEditingId);
        if (oldPoem && oldPoem.fontFamily) existingFont = oldPoem.fontFamily;
      }

      // Hatalı kısımlar temizlendi, tek ve doğru data objesi:
      const poemData = {
        id: currentEditingId || `poem-${Date.now()}`,
        title,
        content,
        tags: currentEditorTags.length > 0 ? currentEditorTags : ['(boş)'], // Pop-up'tan gelenler
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
      if (saveBtn) {
        const originalText = saveBtn.innerHTML;

        saveBtn.innerHTML = '<svg class="uiIcon"><use href="#icon-check"></use></svg><span>Kaydedildi</span>';

        saveBtn.classList.add('active');
        
        setTimeout(() => {
          saveBtn.innerHTML = originalText;
          saveBtn.classList.remove('active');
        }, 2000);
      }
    });

    // ETİKET YÖNETİMİ POP-UP'INI AÇMA VE DOLDURMA
    $('#editorAddTagBtn')?.addEventListener('click', () => {
      const listEl = $('#tagSelectionList');
      const allTags = new Set();
      
      // Veritabanındaki mevcut tüm etiketleri topla
      state.poems.forEach(p => {
        if (!p.trashedAt && p.status !== 'trash' && p.status !== 'deleted' && Array.isArray(p.tags)) {
          p.tags.forEach(t => { if (t && t !== '(boş)') allTags.add(t.trim()); });
        }
      });
      // O an eklenmiş ama henüz veritabanına inmemiş yeni etiketleri de listeye kat
      currentEditorTags.forEach(t => { if (t && t !== '(boş)') allTags.add(t.trim()); });

      const sortedTags = Array.from(allTags).sort((a, b) => a.localeCompare(b, 'tr'));

      // Editördeki mevcut durumu ve favori bilgisini al
      const currentStatus = $('#editorStatusSelect')?.value || 'ready';
      const currentPoem = currentEditingId ? state.poems.find(p => p.id === currentEditingId) : null;
      const isFavorite = currentPoem ? currentPoem.favorite : false;

      if (listEl) {
        let html = sortedTags.map(tag => {
          const isChecked = currentEditorTags.includes(tag);
          return `
            <label class="tagSelectionItem">
              <!-- Sadece etiketleri ayırmak için tagCheck sınıfı eklendi -->
              <input type="checkbox" class="tagCheck" value="${plain(tag)}" ${isChecked ? 'checked' : ''} />
              <span>${plain(tag)}</span>
            </label>
          `;
        }).join('');

        // Etiketlerin hemen altına ayrım çizgisi ve ikonlu durum/favori göstergeçleri eklendi
        html += `
          <div style="margin: 16px 0 8px 0; border-top: 1px solid var(--border-color);"></div>
          
          <label class="tagSelectionItem" style="opacity: 0.9;">
            <input type="radio" name="popStatus" value="ready" ${currentStatus === 'ready' ? 'checked' : ''} />
            <span style="display:flex; align-items:center; gap:8px;">
              <svg class="uiIcon"><use href="#icon-ready"></use></svg> Yayına Hazır
            </span>
          </label>
          
          <label class="tagSelectionItem" style="opacity: 0.9;">
            <input type="radio" name="popStatus" value="draft" ${currentStatus === 'draft' ? 'checked' : ''} />
            <span style="display:flex; align-items:center; gap:8px;">
              <svg class="uiIcon"><use href="#icon-taslak"></use></svg> Taslak
            </span>
          </label>
          
          <label class="tagSelectionItem" style="opacity: 0.9;">
            <input type="radio" name="popStatus" value="archive" ${currentStatus === 'archive' ? 'checked' : ''} />
            <span style="display:flex; align-items:center; gap:8px;">
              <svg class="uiIcon"><use href="#icon-archive"></use></svg> Arşiv
            </span>
          </label>
          
          <label class="tagSelectionItem" style="opacity: 0.9;">
            <input type="checkbox" id="popFavoriteCheck" ${isFavorite ? 'checked' : ''} />
            <span style="display:flex; align-items:center; gap:8px; color: var(--accent-color);">
              <svg class="uiIcon"><use href="#icon-fav"></use></svg> Seçmeler (Favori)
            </span>
          </label>
        `;
        listEl.innerHTML = html;
      }

      document.body.classList.add('modal-open');
      $('#tagSelectionDialog')?.showModal();
    });

    // POP-UP İÇİ BUTON FONKSİYONLARI
    $('#closeTagSelectionBtn')?.addEventListener('click', () => $('#tagSelectionDialog')?.close());

    $('#saveSelectedTagsBtn')?.addEventListener('click', () => {
      // 1. Yalnızca "tagCheck" sınıfına sahip etiket onay kutularını topla
      const checkedBoxes = $$('#tagSelectionList .tagCheck:checked');
      currentEditorTags = checkedBoxes.map(cb => cb.value);
      updateEditorTagsDisplay();
      
      // 2. Durum (Status) seçimini editörün sağ üstündeki görsel menüye yansıt
      const selectedRadio = $('#tagSelectionList input[name="popStatus"]:checked');
      if (selectedRadio && typeof setEditorStatus === 'function') {
        setEditorStatus(selectedRadio.value);
      }
      
      // 3. Favori seçimini doğrudan şiirin kalbine (objeye) yansıt
      const favCheck = $('#popFavoriteCheck');
      if (favCheck && currentEditingId) {
        const poem = state.poems.find(p => p.id === currentEditingId);
        if (poem) poem.favorite = favCheck.checked;
      }

      $('#tagSelectionDialog')?.close();
    });




    $('#addNewTagBtn')?.addEventListener('click', () => {
      let newVal = $('#newTagCreateInput')?.value.trim();
      if (newVal) {
        // Boşlukları alt tire yapar, kullanıcı # yazdıysa otomatik temizler
        newVal = newVal.replace(/\s+/g, '_').replace(/^#/, '');
        if (!currentEditorTags.includes(newVal)) currentEditorTags.push(newVal);
        $('#newTagCreateInput').value = '';
        $('#editorAddTagBtn').click(); // Listeyi güncelleyerek yeniden açar
      }
    });

    $('#editorShareBtn')?.addEventListener('click', () => {
      const title = $('#editorTitleInput').value.trim();
      const content = $('#editorContentInput').value.trim();
      if (!content) return;
      const shareText = `${title}\n\n${content}\n\n— Munnesir`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(shareText).then(() => {
          alert('Metin kopyalandı!');
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




    // ANDROID VE WEB UYUMLU DİNAMİK KİTAP YÖNETİMİ
    function getAllAvailableBooks() {
      const bookSet = new Set();
      const localBooks = JSON.parse(localStorage.getItem('munnesir-books') || '[]');
      localBooks.forEach(b => { if (b.title) bookSet.add(b.title.trim()); });

      // Şiirlerin üstündeki Android etiketlerini ve kitap dizilerini topla
      state.poems.forEach(p => {
        if (!p.trashedAt && p.status !== 'trash') {
          if (Array.isArray(p.books)) p.books.forEach(b => bookSet.add(b.trim()));
          if (p.bookTitle) bookSet.add(p.bookTitle.trim());
          if (p.isBookCandidate || p.status === 'book') bookSet.add('Bir Sevdanın Kanadından');
        }
      });

      if (!bookSet.size) bookSet.add('Bir Sevdanın Kanadından');
      return Array.from(bookSet);
    }

    let activeAssignPoemId = null;

    // ŞİİRİ KİTABA ATA MODALINI AÇ
    window.openBookAssigner = function(poemId) {
      if (!poemId) return;
      activeAssignPoemId = poemId;
      const poem = state.poems.find(p => String(p.id) === String(poemId));
      const poemBooks = Array.isArray(poem?.books) ? poem.books : (poem?.isBookCandidate ? ['Bir Sevdanın Kanadından'] : []);
      const allBooks = getAllAvailableBooks();
      const listEl = $('#bookAssignList');

      if (listEl) {
        listEl.innerHTML = allBooks.map(bTitle => {
          const isChecked = poemBooks.includes(bTitle);
          return `
            <label class="tagSelectionItem">
              <input type="checkbox" class="bookAssignCheck" value="${plain(bTitle)}" ${isChecked ? 'checked' : ''} />
              <span>${plain(bTitle)}</span>
            </label>
          `;
        }).join('');
      }

      document.body.classList.add('modal-open');
      $('#bookAssignDialog')?.showModal();
    };

    $('#readerBookBtn')?.addEventListener('click', () => {
      if (currentReadingId) window.openBookAssigner(currentReadingId);
    });

    $('#editorAddBookBtn')?.addEventListener('click', () => {
      if (!currentEditingId) {
        alert('Lütfen önce şiiri bir kez kaydedin.');
        return;
      }
      window.openBookAssigner(currentEditingId);
    });

    $('#closeBookAssignBtn')?.addEventListener('click', () => $('#bookAssignDialog')?.close());

    // YENİ KİTAP EKLEME (POP-UP İÇİNDEN)
    $('#createBookBtn')?.addEventListener('click', () => {
      const val = $('#newBookTitleInput')?.value.trim();
      if (!val) return;
      const localBooks = JSON.parse(localStorage.getItem('munnesir-books') || '[]');
      if (!localBooks.some(b => b.title === val)) {
        localBooks.push({ id: `book-${Date.now()}`, title: val });
        localStorage.setItem('munnesir-books', JSON.stringify(localBooks));
      }
      $('#newBookTitleInput').value = '';
      window.openBookAssigner(activeAssignPoemId);
    });

    // ATAMALARI BULUT VE ANDROID UYUMLU KAYDET
    $('#saveBookAssignBtn')?.addEventListener('click', async () => {
      const poem = state.poems.find(p => String(p.id) === String(activeAssignPoemId));
      if (!poem) return;

      const checked = $$('#bookAssignList .bookAssignCheck:checked').map(cb => cb.value);
      poem.books = checked;
      poem.isBookCandidate = checked.length > 0;
      poem.updatedAt = new Date().toISOString();

      await savePoemToDB(poem);
      $('#bookAssignDialog')?.close();
      refresh();
      alert('✓ Şiirin kitap atamaları güncellendi.');
    });

    // KİTAP PROJELERİ PENCERESİNİ DOLDURMA
    function renderBookModalView() {
      const allBooks = getAllAvailableBooks();
      const selectEl = $('#activeBookFilterSelect');
      const container = $('#bookListContainer');

      if (!allBooks.length) {
        if (selectEl) selectEl.innerHTML = '<option>Kitap Yok</option>';
        if (container) {
          container.className = 'modalBody bookModalBody';
          container.innerHTML = '<p style="text-align:center; opacity:0.7;">Henüz bir kitap adayı bulunmuyor.</p>';
        }
        return;
      }

      if (selectEl) {
        const currentVal = selectEl.value;
        selectEl.innerHTML = allBooks.map(b => {
          const count = state.poems.filter(p => !p.trashedAt && (
            (Array.isArray(p.books) && p.books.includes(b)) ||
            (b === 'Bir Sevdanın Kanadından' && p.isBookCandidate)
          )).length;
          return `<option value="${plain(b)}">${plain(b)} (${count} şiir)</option>`;
        }).join('');

        if (allBooks.includes(currentVal)) selectEl.value = currentVal;
      }

      displayPoemsOfBook(selectEl ? selectEl.value : allBooks[0]);

      if ($('#bookPoemSearchInput')) $('#bookPoemSearchInput').value = '';
      if ($('#bookPoemAssignChecklist')) $('#bookPoemAssignChecklist').style.display = 'none';

    }

    function displayPoemsOfBook(bookTitle) {
      const container = $('#bookListContainer');
      if (!container || !bookTitle) return;

      const poems = state.poems.filter(p => !p.trashedAt && (
        (Array.isArray(p.books) && p.books.includes(bookTitle)) ||
        (bookTitle === 'Bir Sevdanın Kanadından' && p.isBookCandidate)
      ));

      if (poems.length) {
        container.className = 'modalBody bookModalBody poemGrid';
        container.innerHTML = poems.map(b => `
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
        container.className = 'modalBody bookModalBody';
        container.innerHTML = `<p style="text-align:center; opacity:0.7; padding:20px 0;">Bu kitapta henüz şiir yok. Şiir içinden 'Kitaba Ekle' diyerek ekleyebilirsiniz.</p>`;
      }
    }

    $('#activeBookFilterSelect')?.addEventListener('change', (e) => {
      displayPoemsOfBook(e.target.value);
    });

    // KİTAP PROJELERİ PENCERESİNDEN YENİ KİTAP EKLE
    $('#addNewBookBtn')?.addEventListener('click', () => {
      const name = prompt('Yeni kitap projesinin adını girin:');
      if (name && name.trim()) {
        const val = name.trim();
        const localBooks = JSON.parse(localStorage.getItem('munnesir-books') || '[]');
        if (!localBooks.some(b => b.title === val)) {
          localBooks.push({ id: `book-${Date.now()}`, title: val });
          localStorage.setItem('munnesir-books', JSON.stringify(localBooks));
        }
        renderBookModalView();
        const selectEl = $('#activeBookFilterSelect');
        if (selectEl) {
          selectEl.value = val;
          displayPoemsOfBook(val);
        }
      }
    });


    // KİTAP ADINI DEĞİŞTİR
    $('#renameActiveBookBtn')?.addEventListener('click', async () => {
      const selectEl = $('#activeBookFilterSelect');
      const oldTitle = selectEl?.value;
      if (!oldTitle) return;

      const newTitle = prompt(`'${oldTitle}' kitabının yeni adını girin:`, oldTitle);
      if (!newTitle || newTitle.trim() === '' || newTitle.trim() === oldTitle) return;
      const cleanNewTitle = newTitle.trim();

      // Yerel listedeki ismi güncelle
      let localBooks = JSON.parse(localStorage.getItem('munnesir-books') || '[]');
      const bookObj = localBooks.find(b => b.title === oldTitle);
      if (bookObj) bookObj.title = cleanNewTitle;
      else if (oldTitle !== 'Bir Sevdanın Kanadından') localBooks.push({ id: `book-${Date.now()}`, title: cleanNewTitle });
      localStorage.setItem('munnesir-books', JSON.stringify(localBooks));

      // Tüm şiirlerin içindeki etiketleri bul ve değiştir
      const changed = [];
      state.poems.forEach(p => {
        let wasChanged = false;
        if (Array.isArray(p.books) && p.books.includes(oldTitle)) {
          p.books = p.books.filter(b => b !== oldTitle);
          p.books.push(cleanNewTitle);
          wasChanged = true;
        }
        if (oldTitle === 'Bir Sevdanın Kanadından' && p.isBookCandidate) {
           p.isBookCandidate = false;
           if (!Array.isArray(p.books)) p.books = [];
           p.books.push(cleanNewTitle);
           wasChanged = true;
        }
        if (wasChanged) {
          p.updatedAt = new Date().toISOString();
          changed.push(p);
        }
      });

      if (changed.length) {
        if (typeof window.saveMany === 'function') await window.saveMany(changed);
        else {
          for (const p of changed) await savePoemToDB(p);
        }
      }

      renderBookModalView();
      if ($('#activeBookFilterSelect')) $('#activeBookFilterSelect').value = cleanNewTitle;
      displayPoemsOfBook(cleanNewTitle);
      refresh();
    });




    // KİTAP PROJELERİ İÇİNDEN CANLI ŞİİR ARAMA VE DOĞRUDAN EKLEME
    function renderBookPoemSearchList(query = '') {
      const listEl = $('#bookPoemAssignChecklist');
      const bookTitle = $('#activeBookFilterSelect')?.value;
      if (!listEl || !bookTitle) return;

      const q = query.trim().toLowerCase('tr');
      if (!q) {
        listEl.style.display = 'none';
        return;
      }

      const activePoems = state.poems.filter(p => !p.trashedAt && p.status !== 'trash');
      const filtered = activePoems.filter(p => (p.title || '').toLowerCase('tr').includes(q) || (p.content || '').toLowerCase('tr').includes(q));

      if (!filtered.length) {
        listEl.style.display = 'block';
        listEl.innerHTML = '<div style="padding: 12px; opacity: 0.6; text-align: center;">Bu aramayla eşleşen şiir bulunamadı.</div>';
        return;
      }

      listEl.style.display = 'block';
      listEl.innerHTML = filtered.map(p => {
        const inBook = (Array.isArray(p.books) && p.books.includes(bookTitle)) || (bookTitle === 'Bir Sevdanın Kanadından' && p.isBookCandidate);
        return `
          <label class="tagSelectionItem">
            <input type="checkbox" class="bookDirectAssignCheck" data-poem-id="${p.id}" ${inBook ? 'checked' : ''} />
            <span style="font-size: 0.9rem;">${plain(p.title || 'Başlıksız')}</span>
          </label>
        `;
      }).join('');
    }

    // Arama kutusuna yazı yazıldıkça listeyi filtrele
    $('#bookPoemSearchInput')?.addEventListener('input', (e) => {
      renderBookPoemSearchList(e.target.value);
    });

    // Listeden şiir seçildiğinde (veya çıkarıldığında) anında kitaba kaydet
    $('#bookPoemAssignChecklist')?.addEventListener('change', async (e) => {
      if (e.target.classList.contains('bookDirectAssignCheck')) {
        const poemId = e.target.dataset.poemId;
        const bookTitle = $('#activeBookFilterSelect')?.value;
        const isChecked = e.target.checked;
        if (!poemId || !bookTitle) return;

        const poem = state.poems.find(p => String(p.id) === String(poemId));
        if (!poem) return;

        if (!Array.isArray(poem.books)) poem.books = [];

        if (isChecked) {
          if (!poem.books.includes(bookTitle)) poem.books.push(bookTitle);
          if (bookTitle === 'Bir Sevdanın Kanadından') poem.isBookCandidate = true;
        } else {
          poem.books = poem.books.filter(b => b !== bookTitle);
          if (bookTitle === 'Bir Sevdanın Kanadından') poem.isBookCandidate = false;
        }

        poem.updatedAt = new Date().toISOString();
        await savePoemToDB(poem);
        
        // Kutucuğu işaretlediğiniz anda aşağıdaki ızgarayı anında yeniler
        displayPoemsOfBook(bookTitle);
        refresh();
      }
    });



    // SEÇİLİ KİTABI SİL (ŞİİRLER SİLİNMEZ, SADECE KİTAPTAN ÇIKARILIR)
    $('#deleteActiveBookBtn')?.addEventListener('click', async () => {
      const selectEl = $('#activeBookFilterSelect');
      const bookTitle = selectEl?.value;
      if (!bookTitle) return;

      if (!confirm(`'${bookTitle}' projesini silmek istediğinize emin misiniz?\n(Şiirleriniz silinmez, yalnızca bu kitaptan ayrılır.)`)) return;

      // Yerel listeden temizle
      let localBooks = JSON.parse(localStorage.getItem('munnesir-books') || '[]');
      localBooks = localBooks.filter(b => b.title !== bookTitle);
      localStorage.setItem('munnesir-books', JSON.stringify(localBooks));

      // Şiir nesnelerinin içinden bu kitabı temizle
      const changed = [];
      state.poems.forEach(p => {
        let wasChanged = false;
        if (Array.isArray(p.books) && p.books.includes(bookTitle)) {
          p.books = p.books.filter(b => b !== bookTitle);
          wasChanged = true;
        }
        if (bookTitle === 'Bir Sevdanın Kanadından' && p.isBookCandidate) {
          p.isBookCandidate = false;
          wasChanged = true;
        }
        if (wasChanged) {
          p.updatedAt = new Date().toISOString();
          changed.push(p);
        }
      });

      if (changed.length) {
        if (typeof window.saveMany === 'function') await window.saveMany(changed);
        else {
          for (const p of changed) await savePoemToDB(p);
        }
      }

      renderBookModalView();
      refresh();
    });

    $('#bookViewBtn')?.addEventListener('click', () => {
      document.body.classList.add('modal-open');
      renderBookModalView();
      $('#bookDialog')?.showModal();
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
  // OKUMA PENCERESİ AÇICI
  window.openReader = function(id, isTrash = false) {
    const poem = state.poems.find(p => String(p.id) === String(id));
    if (!poem) return;
    currentReadingId = poem.id;

    $('#readerTitle').textContent = poem.title;
    
    const metaEl = $('#readerMeta');
    if (metaEl) {
      // 1. Tarih Mantığı
      const hasBeenEdited = poem.updatedAt && poem.createdAt && (poem.updatedAt !== poem.createdAt) && (typeof isBulkImportDate === 'function' ? !isBulkImportDate(poem.updatedAt) : true);
      
      // 2. Etiket Mantığı
      let tagsText = "Yok";
      if (Array.isArray(poem.tags)) {
        const validTags = poem.tags.filter(t => t && t !== '(boş)');
        if (validTags.length > 0) tagsText = validTags.map(t => `#${plain(t)}`).join(', ');
      }

      // 3. Durum ve Seçme (Favori) Mantığı
      const statusMap = { 'ready': 'Yayına Hazır', 'draft': 'Taslak', 'archive': 'Arşiv', 'trash': 'Çöp Kutusu', 'deleted': 'Silinmiş' };
      let statusText = statusMap[poem.status] || 'Yayına Hazır';
      if (poem.favorite) statusText += ' (Seçmeler)';

      // 4. Kitap Mantığı
      let booksList = [];
      if (Array.isArray(poem.books)) booksList.push(...poem.books);
      if (poem.isBookCandidate && !booksList.includes('Bir Sevdanın Kanadından')) booksList.push('Bir Sevdanın Kanadından');
      let booksText = booksList.length > 0 ? booksList.map(b => plain(b)).join(', ') : 'Yok';

      // Künyeyi Ekrana Basma
      metaEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; opacity: 0.75; margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border-color);">
          <span><strong>İlk Düzenlenen Tarih:</strong> ${formatDetailedDate(poem.createdAt || poem.updatedAt)}</span>
          <span><strong>Son Düzenleme:</strong> ${hasBeenEdited ? formatDetailedDate(poem.updatedAt) : 'Düzenlenmedi'}</span>
          <span><strong>Etiketler:</strong> ${tagsText}</span>
          <span><strong>Durum:</strong> ${statusText}</span>
          <span><strong>Bulunduğu Kitap:</strong> ${booksText}</span>
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