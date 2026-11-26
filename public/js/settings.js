    // ---------- settings ----------
    $('cwd').value = store.get('gui.cwd', '');
    $('approval').value = store.get('gui.approval', 'yolo');
    $('model').value = store.get('gui.model', '');
    // the model list is filled from /api/models; until then keep the saved choice as its own entry so it is not lost
    if (store.get('gui.model', '') && $('model').selectedIndex < 0) {
      const o = document.createElement('option'); o.value = o.textContent = store.get('gui.model', '');
      $('model').append(o); $('model').value = o.value;
    }
    // wait for every script: saveSettings() calls functions defined in the files loaded after this one
    if (!$('cwd').value) document.addEventListener('DOMContentLoaded', () =>
      fetch('/api/info').then(r => r.json()).then(i => {$('cwd').value = i.cwd; saveSettings();}));
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
    function palOpen(i) { const s = palItems[i]; if (!s) return; closePalette(); openSession(s); }
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
      const view = sideView();
      // One-shot runs started by other tools (e.g. Aurelia) are hidden unless turned on in the filter menu.
      const showAuto = store.get('gui.showAuto', false);
      $('sideLabel').textContent = view.group === 'none' ? 'Conversations' : 'Projects';
      $('sideViewBtn').classList.toggle('on', view.pinnedOnly || showAuto || view.group !== 'project' || view.sortChats !== 'updated' || view.sortProjects !== 'updated');
      const q = searchQuery.trim().toLowerCase();
      const pins = pinnedChats();
      // While searching, every chat is eligible (including automated ones): match on title, or on
      // a server-side hit inside the conversation.
      const visible = q
        ? sessions.filter(s => s.title.toLowerCase().includes(q) || searchHits.has(s.id))
        : sessions.filter(s => (showAuto || !s.automated || (current && s.id === current.id))
          && (!view.pinnedOnly || pins.includes(s.id) || pinnedFolders().includes(s.cwd) || (current && s.id === current.id)));
      const list = current && !current.id ? [{title: current.title, cwd: current.cwd, updated: Date.now(), draft: true}, ...visible] : visible;
      if (!list.length) {
        $('sessions').innerHTML = q
          ? `<div class="sess-empty">${searchBusy ? '<span class="shimmer">Searching</span>' : 'No chats match "' + esc(searchQuery.trim()) + '"'}</div>`
          : `<div class="sess-empty">${view.pinnedOnly ? 'No pinned chats or folders' : 'No chats yet'}</div>`;
        return;
      }
      // pinned chats first, then newest first (or by name)
      const byName = (a, b) => String(a.title).localeCompare(String(b.title), undefined, {sensitivity: 'base', numeric: true});
      const sortChats = (items) => items.sort((a, b) => (b.draft ? 1 : 0) - (a.draft ? 1 : 0)
        || (pins.includes(b.id) ? 1 : 0) - (pins.includes(a.id) ? 1 : 0)
        || (view.sortChats === 'name' ? byName(a, b) : b.updated - a.updated));

      // one chat row
      const chatRow = (s) => {
        const el = document.createElement('div');
        const active = current && (s.draft || s.id === current.id);
        const pinned = !s.draft && pins.includes(s.id);
        el.className = 'sess' + (active ? ' active' : '') + (pinned ? ' pinned' : '');
        const hit = q ? searchHits.get(s.id) : null;
        const hl = (t) => highlightText(t, q);
        el.innerHTML = (pinned ? `<span class="pin-mark" title="Pinned">${ICON_PIN}</span>` : '')
          + `<div class="t">${q ? hl(s.title) : titleHtml(s.title)}</div>${hit && !s.title.toLowerCase().includes(q) ? `<div class="snip">${hl(hit)}</div>` : ''}${!s.draft && isRunning(s.id) ? '<span class="run-dot" title="Gemini is working in this chat"></span>' : ''}<span class="when">${s.draft ? '' : ago(s.updated)}</span>${s.draft ? '' : '<button class="more" title="More"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg></button>'}`;
        el.title = view.group === 'none' && s.cwd ? s.title + '\n' + s.cwd : s.title;
        el.addEventListener('mouseenter', () => describeSession(s, el), {once: true});
        el.onclick = () => { if (!s.draft) openSession(s); closeSide(); };
        el.querySelector('.more')?.addEventListener('click', (e) => {
          e.stopPropagation();
          openChatMenu(e.currentTarget, s, el);
        });
        if (!s.draft) el.addEventListener('contextmenu', (e) => {
          if (el.querySelector('.t input')) return;          // renaming: keep the text box's own menu
          e.preventDefault();
          openChatMenu(null, s, el, {x: e.clientX, y: e.clientY});
        });
        return el;
      };
      // a list of chats, the first few shown and "Show more" for the rest (key: where the count is kept)
      const fillItems = (box, items, key) => {
        const LIMIT = 5, STEP = 10;
        const shown = q ? Infinity : Math.max(LIMIT, store.get('gui.shown:' + key, LIMIT));
        // the open chat and the pinned ones are always listed, even if they are older than the limit
        const visibleItems = items.filter((s, i) => i < shown || (current && (s.draft || s.id === current.id)) || pins.includes(s.id));
        visibleItems.forEach(s => box.appendChild(chatRow(s)));
        const hidden = items.length - visibleItems.length;
        if (!q && (hidden > 0 || shown > LIMIT)) {
          const more = document.createElement('div');
          more.className = 'g-more';
          if (hidden > 0) {
            const b = document.createElement('button');
            b.textContent = `Show ${Math.min(STEP, hidden)} more` + (hidden > STEP ? ` (${hidden} hidden)` : '');
            b.onclick = () => { store.set('gui.shown:' + key, shown + STEP); renderSessions(); };
            more.appendChild(b);
          }
          if (shown > LIMIT) {
            const b = document.createElement('button');
            b.textContent = 'Show less';
            b.onclick = () => { store.set('gui.shown:' + key, LIMIT); renderSessions(); };
            more.appendChild(b);
          }
          box.appendChild(more);
        }
      };

      // no grouping: one list of every chat
      if (view.group === 'none') {
        const box = document.createElement('div'); box.className = 'g-items flat';
        fillItems(box, sortChats([...list]), '*all');
        $('sessions').appendChild(box);
        return;
      }

      // Group by working directory: pinned folders first, then newest group first (or by name).
      const groups = new Map();
      list.forEach(s => { if (!groups.has(s.cwd)) groups.set(s.cwd, []); groups.get(s.cwd).push(s); });
      const collapsed = store.get('gui.collapsedGroups', []);
      const pinnedDirs = pinnedFolders();
      const folderOf = (cwd) => String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || cwd || '';
      const newest = (items) => Math.max(...items.map(s => s.updated));
      const order = [...groups.entries()].sort((a, b) => (pinnedDirs.includes(b[0]) ? 1 : 0) - (pinnedDirs.includes(a[0]) ? 1 : 0)
        || (view.sortProjects === 'name' ? folderOf(a[0]).localeCompare(folderOf(b[0]), undefined, {sensitivity: 'base', numeric: true}) : newest(b[1]) - newest(a[1])));

      order.forEach(([cwd, items]) => {
        sortChats(items);
        const folder = folderOf(cwd);
        const pinned = pinnedDirs.includes(cwd);
        const hasActive = items.some(s => current && (s.draft || s.id === current.id));
        const isOpen = hasActive || !!q || !collapsed.includes(cwd);

        const g = document.createElement('div'); g.className = 'group' + (isOpen ? ' open' : '') + (pinned ? ' pinned' : '');
        g.innerHTML = `<div class="g-head" title="${esc(cwd)}">
            <svg class="g-ic"><use href="#i-folder"/></svg>
            <span class="g-name">${esc(folder)}</span>
            <span class="g-count">${items.length}</span>
            <button class="g-pin" title="${pinned ? 'Unpin' : 'Pin'} ${esc(folder)}">${ICON_PIN}</button>
            <button class="g-add" title="New chat in ${esc(folder)}">+</button>
            <span class="g-caret"></span>
          </div><div class="g-items"></div>`;
        g.querySelector('.g-head').onclick = (e) => {
          if (e.target.closest('.g-add, .g-pin')) return;
          const next = collapsed.includes(cwd) ? collapsed.filter(c => c !== cwd) : [...collapsed, cwd];
          store.set('gui.collapsedGroups', next); renderSessions();
        };
        g.querySelector('.g-pin').onclick = (e) => { e.stopPropagation(); togglePinFolder(cwd); };
        g.querySelector('.g-head').addEventListener('contextmenu', (e) => {
          e.preventDefault();
          openFolderMenu(cwd, folder, g.querySelector('.g-head'), {x: e.clientX, y: e.clientY});
        });
        g.querySelector('.g-add').onclick = (e) => {
          e.stopPropagation();
          newChat();
          $('cwd').value = cwd; saveSettings();
        };
        fillItems(g.querySelector('.g-items'), items, cwd);
        $('sessions').appendChild(g);
      });
    }

    // ---------- pinning ----------
    // Pinned chats stay at the top of their list and are always shown; pinned folders stay at the top of the
    // sidebar. Both are kept in this browser only.
    const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 6 3.5 3.5v1.5h-11v-1.5L10 10z"/><path d="M12 15v5"/></svg>';
    const pinnedChats = () => store.get('gui.pinnedChats', []);
    const pinnedFolders = () => store.get('gui.pinnedFolders', []);
    const isPinnedChat = (id) => pinnedChats().includes(id);
    function togglePinChat(id) {
      const list = pinnedChats();
      store.set('gui.pinnedChats', list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
      renderSessions();
    }
    function togglePinFolder(cwd) {
      const list = pinnedFolders();
      store.set('gui.pinnedFolders', list.includes(cwd) ? list.filter(x => x !== cwd) : [...list, cwd]);
      renderSessions();
    }
    function openFolderMenu(cwd, folder, row, at) {
      closeChatMenu(); closeSideMenu();
      chatMenuRow = row; row.classList.add('menu-open');
      const pinned = pinnedFolders().includes(cwd);
      const PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
      chatMenu.innerHTML = `<button data-a="pin">${ICON_PIN}<span>${pinned ? 'Unpin project' : 'Pin project'}</span></button>`
        + `<button data-a="new">${PLUS}<span>New chat in ${esc(folder)}</span></button>`;
      chatMenu.querySelector('[data-a=pin]').onclick = (e) => { e.stopPropagation(); closeChatMenu(); togglePinFolder(cwd); };
      chatMenu.querySelector('[data-a=new]').onclick = (e) => {
        e.stopPropagation(); closeChatMenu();
        newChat(); $('cwd').value = cwd; saveSettings();
      };
      chatMenu.classList.add('open');
      const w = chatMenu.offsetWidth, h = chatMenu.offsetHeight;
      chatMenu.style.top = Math.max(8, Math.min(at.y, innerHeight - h - 8)) + 'px';
      chatMenu.style.left = Math.max(8, Math.min(at.x, innerWidth - w - 8)) + 'px';
    }

    // ---------- sidebar view: group, sort, filter ----------
    // Only what the chat list already knows: the folder, the time of the last message, the name, pins and the
    // automated-runs flag.
    const SIDE_VIEW = {group: 'project', sortChats: 'updated', sortProjects: 'updated', pinnedOnly: false};
    const sideView = () => ({...SIDE_VIEW, ...store.get('gui.sideView', {})});
    function setSideView(patch) { store.set('gui.sideView', {...sideView(), ...patch}); renderSessions(); }
    const sideMenu = document.createElement('div');
    sideMenu.className = 'chatmenu fmenu side-menu';
    document.body.appendChild(sideMenu);
    const closeSideMenu = () => { sideMenu.classList.remove('open'); $('sideViewBtn').classList.remove('open'); };
    function openSideMenu() {
      // a submenu that was open stays open when the menu is redrawn after a choice
      const keep = sideMenu.classList.contains('open') ? [...sideMenu.querySelectorAll('.sub.open > button > span')].map(x => x.textContent) : [];
      const v = sideView(), showAuto = store.get('gui.showAuto', false);
      const autoCount = sessions.filter(s => s.automated).length;
      const TICK = '<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
      const opt = (key, val, label, on) => `<button data-k="${key}" data-v="${val}"><span>${label}</span>${on ? TICK : ''}</button>`;
      const sub = (label, value, body, off) => `<div class="sub"><button${off ? ' disabled' : ''}><span>${label}</span><em class="mv">${value}</em></button><div class="flyout">${body}</div></div>`;
      const NAMES = {project: 'Project', none: 'None', updated: 'Last Updated', name: 'Name'};
      const filters = [v.pinnedOnly && 'Pinned', showAuto && autoCount && 'Automated'].filter(Boolean).join(', ');
      sideMenu.innerHTML =
        sub('Group By', NAMES[v.group], opt('group', 'project', 'Project', v.group === 'project') + opt('group', 'none', 'None', v.group === 'none'))
        + sub('Sort Conversations', NAMES[v.sortChats], opt('sortChats', 'updated', 'Last Updated', v.sortChats === 'updated') + opt('sortChats', 'name', 'Name', v.sortChats === 'name'))
        + sub('Sort Projects', NAMES[v.sortProjects], opt('sortProjects', 'updated', 'Last Updated', v.sortProjects === 'updated') + opt('sortProjects', 'name', 'Name', v.sortProjects === 'name'), v.group !== 'project')
        + '<hr>'
        + sub('Filter', filters, opt('pinnedOnly', '', 'Pinned Only', v.pinnedOnly)
          + (autoCount ? opt('showAuto', '', `Automated Runs (${autoCount})`, showAuto) : ''))
        + '<hr>'
        + `<button data-a="collapse"${v.group !== 'project' ? ' disabled' : ''}><span>Collapse All Projects</span></button>`
        + `<button data-a="expand"${v.group !== 'project' ? ' disabled' : ''}><span>Expand All Projects</span></button>`
        + `<button data-a="reset"><span>Reset View</span></button>`;
      sideMenu.onclick = (e) => {
        e.stopPropagation();
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        if (b.parentElement.classList.contains('sub')) return b.parentElement.classList.toggle('open');
        const k = b.dataset.k, a = b.dataset.a;
        if (k === 'pinnedOnly') setSideView({pinnedOnly: !sideView().pinnedOnly});
        else if (k === 'showAuto') { store.set('gui.showAuto', !store.get('gui.showAuto', false)); renderSessions(); }
        else if (k) setSideView({[k]: b.dataset.v});
        else if (a === 'collapse') { store.set('gui.collapsedGroups', [...new Set(sessions.map(s => s.cwd))]); renderSessions(); }
        else if (a === 'expand') { store.set('gui.collapsedGroups', []); renderSessions(); }
        else if (a === 'reset') { store.set('gui.sideView', {}); store.set('gui.showAuto', false); renderSessions(); }
        openSideMenu();                                  // stay open, showing the new state
      };
      sideMenu.classList.add('open'); $('sideViewBtn').classList.add('open');
      const r = $('sideViewBtn').getBoundingClientRect(), w = sideMenu.offsetWidth, h = sideMenu.offsetHeight;
      sideMenu.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
      sideMenu.style.top = Math.max(8, Math.min(r.bottom + 4, innerHeight - h - 8)) + 'px';
      sideMenu.classList.toggle('flip', r.left + w + 180 > innerWidth);
      sideMenu.querySelectorAll('.sub').forEach(x => { if (keep.includes(x.querySelector(':scope > button > span').textContent)) x.classList.add('open'); });
    }
    $('sideViewBtn').onclick = (e) => { e.stopPropagation(); sideMenu.classList.contains('open') ? closeSideMenu() : openSideMenu(); };
    document.addEventListener('mousedown', (e) => { if (sideMenu.classList.contains('open') && !e.target.closest('.side-menu, #sideViewBtn')) closeSideMenu(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sideMenu.classList.contains('open')) { e.stopPropagation(); closeSideMenu(); } }, true);
    window.addEventListener('resize', closeSideMenu);
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
    $('importSession').onclick = () => $('importFile').click();
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

