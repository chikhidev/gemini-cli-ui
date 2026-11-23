    // ---------- settings ----------
    $('cwd').value = store.get('gui.cwd', '');
    $('approval').value = store.get('gui.approval', 'yolo');
    $('model').value = store.get('gui.model', '');
    if (!$('cwd').value) fetch('/api/info').then(r => r.json()).then(i => {$('cwd').value = i.cwd; saveSettings();});
    ['cwd', 'approval', 'model'].forEach(id => $(id).addEventListener('change', () => { saveSettings(); if (id === 'cwd') fetchAppInfo(); }));
    // mode pill icons: Auto-approve = check circle, Auto-edit = pencil, Plan = clipboard list
    const MODE_ICONS = {
      yolo: '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM8.5 12.3l2.5 2.5 4.5-5"/>',
      auto_edit: '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M15 4.5 19.5 9 9 19.5 4 20l.5-5zM12.5 7l4.5 4.5"/>',
      plan: '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v13a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V6A1.5 1.5 0 0 1 7 4.5zM9 9.5h6M9 13h6M9 16.5h3.5"/>',
    };
    function updateBranch(branch) {
      const pill = $('branchPill');
      const label = $('branchLabel');
      if (!pill || !label) return;
      if (branch) {
        label.textContent = branch;
        pill.hidden = false;
        pill.title = 'Git branch: ' + branch + ' — click to copy';
      } else {
        pill.hidden = true;
      }
    }
    async function fetchBranch() {
      const cwd = $('cwd').value.trim();
      if (!cwd) { updateBranch(''); return; }
      try {
        const r = await fetch('/api/branch?cwd=' + encodeURIComponent(cwd));
        if (r.ok) {
          const d = await r.json();
          if (cwd === $('cwd').value.trim()) updateBranch(d.branch || '');
        }
      } catch {}
    }
    function syncPills() {
      const c = $('cwd').value.trim();
      fetchBranch();
      $('cwdLabel').textContent = c ? (c.split(/[\\/]/).filter(Boolean).pop() || c) : 'Choose folder';
      $('browse').title = c ? 'Working directory: ' + c : 'Choose working directory';
      $('browse').hidden = $('cwd').disabled;
      updateHeader();
      $('approvalLabel').textContent = $('approval').selectedOptions[0]?.text || '';
      const planning = $('approval').value === 'plan';
      $('approvalIcon').innerHTML = MODE_ICONS[$('approval').value] || MODE_ICONS.yolo;
      $('approvalPill').classList.toggle('plan', planning);
      $('approvalPill').dataset.tip = planning                  // the pill tooltip (see .c-bar [data-tip])
        ? 'Plan mode: you approve the plan before anything changes  ·  Shift+Tab'
        : 'Approval mode  ·  Shift+Tab';
      if (!pendingSessionFile && !nextPrompt) $('input').placeholder = planning ? 'Describe the task; Gemini plans it first, you approve' : 'Ask anything, / for actions';
      // A saved model that is no longer in the list (e.g. the old invalid "gemini-3.5-pro") falls back to Auto.
      if ($('model').selectedIndex < 0) {$('model').value = ''; store.set('gui.model', '');}
      $('modelLabel').textContent = ($('model').selectedOptions[0]?.text || 'Auto').replace(' (CLI default)', '');
      $('browse').classList.toggle('need', !$('cwd').value.trim());   // no folder yet: the pill asks for one
    }
    function updateHeader() {
      const elCwd = $('headerCwdLabel');
      const elTitle = $('headerTitleLabel');
      if (elCwd) {
        const c = $('cwd').value.trim();
        elCwd.textContent = c ? (c.split(/[\\/]/).filter(Boolean).pop() || c) : 'No folder';
      }
      if (elTitle) {
        elTitle.textContent = current && current.title ? current.title : 'New Chat';
      }
    }
    
    function saveSettings() {
      syncPills();
      loadChanges();
      store.set('gui.cwd', $('cwd').value.trim());
      store.set('gui.approval', $('approval').value);
      store.set('gui.model', $('model').value);
      updateHint();
    }
    function updateHint() {}   // the session line under the input was removed; kept so callers stay valid

    // ---------- sessions ----------
    // Wrap case-insensitive matches of q in <mark>, escaping everything else (no regex needed).
    function highlightText(text, q) {
      if (!q) return esc(text);
      const lower = String(text).toLowerCase(); let out = '', i = 0, j;
      while ((j = lower.indexOf(q, i)) >= 0) {
        out += esc(text.slice(i, j)) + '<mark>' + esc(text.slice(j, j + q.length)) + '</mark>';
        i = j + q.length;
      }
      return out + esc(text.slice(i));
    }
    // Inline markdown (bold, italics, `code`) in chat titles; nothing else survives, so a title can never inject markup.
    function titleHtml(t) {
      return DOMPurify.sanitize(marked.parseInline(String(t || '')), {ALLOWED_TAGS: ['strong', 'b', 'em', 'i', 'code', 'del'], ALLOWED_ATTR: []});
    }

    // ---------- search ----------
    let searchQuery = '', searchHits = new Map(), searchBusy = false, searchTimer = null, searchSeq = 0;
    function onSearchInput() {
      searchQuery = $('search').value;
      $('searchClear').hidden = !searchQuery;
      $('search').parentElement.classList.toggle('has-text', !!searchQuery);
      clearTimeout(searchTimer);
      const q = searchQuery.trim();
      if (q.length < 2) { searchHits = new Map(); searchBusy = false; renderSessions(); return; }
      renderSessions();                       // instant: title matches
      searchBusy = true;
      searchTimer = setTimeout(async () => {  // then: matches inside conversations
        const seq = ++searchSeq;
        try {
          const hits = await (await fetch('/api/search?q=' + encodeURIComponent(q))).json();
          if (seq !== searchSeq) return;      // a newer query won
          searchHits = new Map(hits.map(h => [h.id, (h.role === 'you' ? 'You: ' : '') + h.snippet]));
        } catch { searchHits = new Map(); }
        searchBusy = false;
        renderSessions();
      }, 250);
    }
    $('search').addEventListener('input', onSearchInput);
    $('searchClear').onclick = () => { $('search').value = ''; onSearchInput(); $('search').focus(); };
    $('search').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); if ($('search').value) { $('search').value = ''; onSearchInput(); } else $('search').blur(); }
      if (e.key === 'Enter') { const first = document.querySelector('#sessions .sess'); if (first) first.click(); }
    });
    // The search button (top left, beside the sidebar button) and Ctrl+K open a box over the chat: type to narrow the
    // chats down by name, ↑ ↓ to move, Enter or a click to open one, Esc to close. (The old search field in the
    // sidebar is hidden; the code above it is kept as it was.)
    const pal = $('palette'), palInput = $('palInput'), palList = $('palList');
    let palIdx = 0, palItems = [];
    const agoLong = (t) => {
      const d = (Date.now() - t) / 86400000;
      if (d < 1) return ago(t);
      return d < 30 ? Math.floor(d) + 'd' : d < 365 ? Math.floor(d / 30) + 'mo' : Math.floor(d / 365) + 'y';
    };
    const PAL_CHAT = '<svg class="pi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16h-.5A2.5 2.5 0 0 1 5 13.5z"/></svg>';
    function palRender() {
      const q = palInput.value.trim().toLowerCase();
      palItems = sessions.filter(s => !q || s.title.toLowerCase().includes(q)).sort((a, b) => b.updated - a.updated).slice(0, 80);
      palIdx = Math.min(palIdx, Math.max(0, palItems.length - 1));
      palList.innerHTML = palItems.length ? '' : `<div class="pal-empty">${q ? 'No chats match "' + esc(palInput.value.trim()) + '"' : 'No chats yet'}</div>`;
      palItems.forEach((s, i) => {
        const row = document.createElement('div');
        row.className = 'pal-row' + (i === palIdx ? ' hi' : '');
        const folder = baseName(s.cwd || '');
        row.innerHTML = PAL_CHAT + `<span class="pt">${q ? highlightText(s.title, q) : titleHtml(s.title)}</span>`
          + (folder ? `<span class="pf">${ICON_FOLDER}${esc(folder)}</span>` : '<span class="pf"></span>') + `<span class="pw">${agoLong(s.updated)}</span>`;
        row.onmouseenter = () => palHi(i);
        row.onclick = () => palOpen(i);
        palList.appendChild(row);
      });
    }
    function palHi(i, scroll) {
      palIdx = i;
      [...palList.children].forEach((r, k) => r.classList.toggle('hi', k === i));
      if (scroll) palList.children[i]?.scrollIntoView({block: 'nearest'});
    }
    function palOpen(i) { const s = palItems[i]; if (!s) return; closePalette(); if (!busy) openSession(s); }
    function openPalette() { pal.hidden = false; palInput.value = ''; palIdx = 0; palRender(); palInput.focus(); }
    function closePalette() { pal.hidden = true; }
    $('searchBtn').onclick = openPalette;
    pal.addEventListener('mousedown', (e) => { if (!e.target.closest('.pal-box')) closePalette(); });
    palInput.addEventListener('input', () => { palIdx = 0; palRender(); });
    palInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closePalette(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); palHi(Math.min(palItems.length - 1, palIdx + 1), true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palHi(Math.max(0, palIdx - 1), true); }
      else if (e.key === 'Enter') { e.preventDefault(); palOpen(palIdx); }
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPalette() : closePalette(); }
    });

    async function loadSessions() {
      try {sessions = await (await fetch('/api/history')).json();} catch {sessions = [];}
      renderSessions();
    }
    const ago = (t) => {
      const s = (Date.now() - t) / 1000;
      if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h';
      return Math.floor(s / 86400) + 'd';
    };
    function renderSessions() {
      $('sessions').innerHTML = '';
      // One-shot runs started by other tools (e.g. Aurelia) are hidden unless the toggle is on.
      const showAuto = store.get('gui.showAuto', false);
      const autoCount = sessions.filter(s => s.automated).length;
      const toggle = $('autoToggle');
      toggle.hidden = !autoCount;
      toggle.textContent = showAuto ? `Hide ${autoCount} automated` : `${autoCount} automated hidden`;
      toggle.title = 'Single-prompt Gemini runs started by other tools (not from this app)';
      toggle.onclick = () => { store.set('gui.showAuto', !showAuto); renderSessions(); };
      const q = searchQuery.trim().toLowerCase();
      // While searching, every chat is eligible (including automated ones): match on title, or on
      // a server-side hit inside the conversation.
      const visible = q
        ? sessions.filter(s => s.title.toLowerCase().includes(q) || searchHits.has(s.id))
        : sessions.filter(s => showAuto || !s.automated || (current && s.id === current.id));
      const list = current && !current.id ? [{title: current.title, cwd: current.cwd, updated: Date.now(), draft: true}, ...visible] : visible;
      if (!list.length) {
        $('sessions').innerHTML = q
          ? `<div class="sess-empty">${searchBusy ? '<span class="shimmer">Searching</span>' : 'No chats match "' + esc(searchQuery.trim()) + '"'}</div>`
          : '<div class="sess-empty">No chats yet</div>';
        return;
      }

      // Group by working directory, newest group first (like Claude's sidebar).
      const groups = new Map();
      list.forEach(s => { if (!groups.has(s.cwd)) groups.set(s.cwd, []); groups.get(s.cwd).push(s); });
      const collapsed = store.get('gui.collapsedGroups', []);
      const order = [...groups.entries()].sort((a, b) => Math.max(...b[1].map(s => s.updated)) - Math.max(...a[1].map(s => s.updated)));

      let n = 0;
      order.forEach(([cwd, items]) => {
        const folder = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
        const hasActive = items.some(s => current && (s.draft || s.id === current.id));
        const isOpen = hasActive || !!q || !collapsed.includes(cwd);

        const g = document.createElement('div'); g.className = 'group' + (isOpen ? ' open' : '');
        g.innerHTML = `<div class="g-head" title="${esc(cwd)}">
            <svg class="g-ic"><use href="#i-folder"/></svg>
            <span class="g-name">${esc(folder)}</span>
            <span class="g-count">${items.length}</span>
            <button class="g-add" title="New chat in ${esc(folder)}">+</button>
            <span class="g-caret"></span>
          </div><div class="g-items"></div>`;
        g.querySelector('.g-head').onclick = (e) => {
          if (e.target.closest('.g-add')) return;
          const next = collapsed.includes(cwd) ? collapsed.filter(c => c !== cwd) : [...collapsed, cwd];
          store.set('gui.collapsedGroups', next); renderSessions();
        };
        g.querySelector('.g-add').onclick = (e) => {
          e.stopPropagation();
          if (busy) return;
          newChat();
          $('cwd').value = cwd; saveSettings();
        };

        const box = g.querySelector('.g-items');
        const LIMIT = 5, STEP = 10;
        const shown = q ? Infinity : Math.max(LIMIT, store.get('gui.shown:' + cwd, LIMIT));
        // the open chat is always listed, even if it is older than the limit
        const openIdx = items.findIndex(s => current && (s.draft || s.id === current.id));
        const visibleItems = items.filter((s, i) => i < shown || i === openIdx);
        visibleItems.forEach((s) => {
          const el = document.createElement('div');
          const active = current && (s.draft || s.id === current.id);
          el.className = 'sess' + (active ? ' active' : '');
          const hit = q ? searchHits.get(s.id) : null;
          const hl = (t) => highlightText(t, q);
          el.innerHTML = `<div class="t">${q ? hl(s.title) : titleHtml(s.title)}</div>${hit && !s.title.toLowerCase().includes(q) ? `<div class="snip">${hl(hit)}</div>` : ''}<span class="when">${s.draft ? '' : ago(s.updated)}</span>${s.draft ? '' : '<button class="more" title="More"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg></button>'}`;
          el.title = s.title;
          el.addEventListener('mouseenter', () => describeSession(s, el), {once: true});
          el.onclick = () => { if (!busy && !s.draft) openSession(s); closeSide(); };
          el.querySelector('.more')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openChatMenu(e.currentTarget, s, el);
          });
          if (!s.draft) el.addEventListener('contextmenu', (e) => {
            if (el.querySelector('.t input')) return;          // renaming: keep the text box's own menu
            e.preventDefault();
            openChatMenu(null, s, el, {x: e.clientX, y: e.clientY});
          });
          box.appendChild(el);
        });
        const hidden = items.length - visibleItems.length;
        if (!q && (hidden > 0 || shown > LIMIT)) {
          const more = document.createElement('div');
          more.className = 'g-more';
          if (hidden > 0) {
            const b = document.createElement('button');
            b.textContent = `Show ${Math.min(STEP, hidden)} more` + (hidden > STEP ? ` (${hidden} hidden)` : '');
            b.onclick = () => { store.set('gui.shown:' + cwd, shown + STEP); renderSessions(); };
            more.appendChild(b);
          }
          if (shown > LIMIT) {
            const b = document.createElement('button');
            b.textContent = 'Show less';
            b.onclick = () => { store.set('gui.shown:' + cwd, LIMIT); renderSessions(); };
            more.appendChild(b);
          }
          box.appendChild(more);
        }
        $('sessions').appendChild(g);
      });
    }
    // ---------- import a session file ----------
    // Gemini's --session-file loads a saved conversation (.json / .jsonl) into a NEW session in the chosen
    // folder, on the next send.
    let pendingSessionFile = null; // {name, path}
    function renderImportChip() {
      $('attachRow').querySelector('.import-chip')?.remove();
      if (!pendingSessionFile) return;
      const chip = document.createElement('span');
      chip.className = 'import-chip';
      chip.title = pendingSessionFile.path;
      chip.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4M12 15V4.5M8 8l4-4 4 4" /></svg><span>Continue from <b>${esc(pendingSessionFile.name)}</b></span><button title="Cancel">✕</button>`;
      chip.querySelector('button').onclick = () => { pendingSessionFile = null; renderImportChip(); };
      $('attachRow').prepend(chip);
    }
    $('importSession').onclick = () => { if (!busy) $('importFile').click(); };
    $('importFile').onchange = async () => {
      const file = $('importFile').files[0];
      $('importFile').value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const first = text.trimStart();
        const looksRight = first.startsWith('{') && /"sessionId"|"messages"/.test(text.slice(0, 4000));
        if (!looksRight) { alert('This does not look like a Gemini session file (expected JSON with "sessionId" and "messages").'); return; }
      } catch {}
      const buf = await file.arrayBuffer();
      let bin = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const res = await fetch('/api/upload', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: file.name, data: btoa(bin)})});
      const d = await res.json();
      if (d.error) { alert(d.error); return; }
      newChat();
      pendingSessionFile = {name: file.name, path: d.path};
      renderImportChip();
      $('input').placeholder = 'Ask something to continue the imported chat…';
      $('input').focus();
    };

