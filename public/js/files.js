    // ---------- file changes ----------
    // The pill shows what is uncommitted in the chat's folder; each reply also lists what that run touched.
    let changedFiles = [], changedCwd = null, notARepo = false;
    // The panel belongs to one folder: drop stale files when the chat (and folder) changes.
    function resetChangesPanel() {
      panelFiles = null; panelCwd = null; changedFiles = []; notARepo = false; renderedKey = null;
      syncDiffButton();
      $('diffBody').innerHTML = ''; diffCache.clear();
      
      setTimeout(() => {
        loadChanges();
        if (store.get('gui.diffOpen', false)) {
          if (store.get('gui.panelTab', 'changes') === 'files') openFiles();
          else openChanges();
        } else {
          $('diffPanel').classList.remove('open');
        }
      }, 0); // after the new folder is in place
    }
    let lastChangeCheck = 0;
    async function loadChanges(quiet) {
      if (quiet && Date.now() - lastChangeCheck < 1500) return;
      lastChangeCheck = Date.now();
      const cwd = $('cwd').value.trim();
      changedCwd = cwd;
      if (!quiet) panelLoading(true, 'Loading changes');
      else if (busy) panelLoading(true, 'Watching for changes');
      if (!cwd) { changedFiles = []; syncDiffButton(); return; }
      let repo = true;
      try {
        const d = await (await fetch('/api/changes?cwd=' + encodeURIComponent(cwd))).json();
        changedFiles = d.files || [];
        repo = d.repo !== false;
        if (cwd === $('cwd').value.trim()) updateBranch(repo ? (d.branch || '') : '');
      } catch { changedFiles = []; }
      panelLoading(busy, 'Watching for changes');
      if (cwd !== $('cwd').value.trim()) return; // folder changed while we were loading
      notARepo = !repo;
      syncDiffButton();
      if (overviewMenu.classList.contains('open')) renderOverviewMenu();
      markTreeChanges();
      if (panelTab !== 'changes') return;
      if ($('diffPanel').classList.contains('open') && !panelFiles) openChanges();
    }
    // Same shimmer as the chat's "Thinking" line.
    function panelLoading(on, label) {
      const st = $('diffStatus');
      st.innerHTML = on ? `<span class="shimmer">${esc(label || 'Updating')}</span>` : '';
    }

    // "Viewed" files collapse out of the way. A file re-appears automatically if it changes again,
    // because the stored mark includes its +/- counts.
    const viewedKey = () => 'gui.viewed:' + (panelCwd || '');
    const fileSig = (f) => `${f.status}:${f.added}:${f.removed}`;
    function getViewed() { return store.get(viewedKey(), {}); }
    function isViewed(f) { return getViewed()[f.path] === fileSig(f); }
    function setViewed(f, on) {
      const all = getViewed();
      if (on) all[f.path] = fileSig(f); else delete all[f.path];
      store.set(viewedKey(), all);
    }
    const ICON_EYE = '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m4 12.5 5 5L20 6.5"/></svg>';

    let panelFiles = null;   // null = show the folder's full change list
    let panelCwd = null;     // folder the panel's files belong to
    const diffCache = new Map(); // "sig|path" -> diff text, so refreshes don't refetch or flicker
    let diffObserver = null;

    const EXT_LANG = {
      py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
      ts: 'typescript', tsx: 'typescript', json: 'json', yml: 'yaml', yaml: 'yaml', md: 'markdown',
      html: 'xml', htm: 'xml', xml: 'xml', css: 'css', scss: 'scss', sh: 'bash', bash: 'bash',
      ps1: 'powershell', bat: 'dos', java: 'java', go: 'go', rb: 'ruby', rs: 'rust', php: 'php',
      sql: 'sql', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', kt: 'kotlin', swift: 'swift',
      toml: 'ini', ini: 'ini', cfg: 'ini', feature: 'gherkin', vue: 'xml', tf: 'hcl',
      robot: 'robot', resource: 'robot',
    };
    function langFor(path) {
      const ext = String(path).split('.').pop().toLowerCase();
      const lang = EXT_LANG[ext];
      return lang && hljs.getLanguage(lang) ? lang : null;
    }
    // Highlights the code on each diff line, keeping the +/- marker outside the highlighting.
    // A diff drawn like a review: numbered lines (each in the file it belongs to), added ones green, removed ones
    // red; git's header lines are dropped and each jump between hunks says how many lines it skips. An untracked
    // file comes as all-added lines without a hunk; anything else (an error, "binary file") is shown as a note.
    function diffToHtml(text, path) {
      const lang = langFor(path || '');
      if (!text || !text.trim()) return '<div class="diff-empty">No textual changes (binary file, or already committed).</div>';
      const code = (t) => { if (!lang) return esc(t); try { return hljs.highlight(t, {language: lang, ignoreIllegals: true}).value; } catch { return esc(t); } };
      const row = (cls, no, t) => `<div class="dl${cls ? ' ' + cls : ''}"><span class="no">${no}</span><span class="c">${code(t) || ' '}</span></div>`;
      const out = [];
      let oldNo = 1, newNo = 1, started = false, hunks = 0;
      text.split('\n').forEach(line => {
        const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
        if (h) {
          const skipped = +h[2] - (hunks ? newNo : 1);
          if (skipped > 0) out.push(`<div class="dgap">${skipped} unchanged line${skipped > 1 ? 's' : ''}${h[3].trim() ? ' · ' + esc(h[3].trim()) : ''}</div>`);
          oldNo = +h[1]; newNo = +h[2]; started = true; hunks++;
          return;
        }
        if (line.startsWith('+++ ')) { started = true; return; }
        if (!started || line.startsWith('\\') || line === '') return;   // headers, "\ No newline at end of file"
        if (line[0] === '+') out.push(row('add', newNo++, line.slice(1)));
        else if (line[0] === '-') out.push(row('del', oldNo++, line.slice(1)));
        else { out.push(row('', newNo++, line.slice(1))); oldNo++; }
      });
      if (!out.length) return `<div class="diff-empty">${esc(text.trim())}</div>`;
      return '<div class="dcode hljs">' + out.join('') + '</div>';
    }

    async function fillDiff(section, f) {
      const key = fileSig(f) + '|' + f.path;
      const body = section.querySelector('.dfile-body');
      if (diffCache.has(key)) { body.innerHTML = diffCache.get(key); return; }
      body.innerHTML = '<div class="diff-empty loading"><span class="shimmer">Loading diff</span></div>';
      try {
        const cwd = panelCwd || $('cwd').value.trim();
        const d = await (await fetch(`/api/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(f.path)}`)).json();
        const html = diffToHtml(d.error ? d.error : d.diff, f.path);
        diffCache.set(key, html);
        body.innerHTML = html;
      } catch (e) {
        body.innerHTML = `<div class="diff-empty">Could not load the diff: ${esc(e.message)}</div>`;
      }
    }

    // Bring one file's section into view (used by the per-reply cards).
    function scrollToFile(path) {
      const sec = [...$('diffBody').querySelectorAll('.dfile')].find(el => el._file?.path === path);
      if (!sec) return;
      sec.classList.remove('collapsed');
      if (!sec.querySelector('.dfile-body').innerHTML) fillDiff(sec, sec._file);
      sec.scrollIntoView({block: 'start', behavior: 'smooth'});
    }
    let renderedKey = null; // signature of what the panel currently shows
    function openChanges(files, cwd, force) {
      panelFiles = files && files.length ? files : null;
      panelCwd = cwd || $('cwd').value.trim();
      const list = panelFiles || changedFiles;
      $('diffPanel').classList.add('open');
      store.set('gui.diffOpen', true);
      setPanelTab('changes');
      syncDiffButton();

      // A live refresh with identical files must not rebuild the DOM (that is what made it blink).
      const key = panelCwd + '|' + list.map(f => f.path + ':' + fileSig(f) + ':' + (isViewed(f) ? 'v' : '')).join(',');
      const sameAsRendered = key === renderedKey && !force;
      renderedKey = key;

      const folder = (panelCwd || '').split(/[\\/]/).filter(Boolean).pop() || '';
      const left = list.filter(f => !isViewed(f)).length;
      $('diffTitle').textContent = (list.length === 1 ? '1 file changed' : list.length + ' files changed')
        + (left !== list.length ? ` · ${left} left` : '') + (folder ? ' · ' + folder : '');
      $('diffTitle').title = panelCwd || '';

      if (sameAsRendered) return;

      const box = $('diffBody');
      const prevScroll = box.scrollTop;
      box.innerHTML = '';
      diffObserver?.disconnect();
      diffObserver = new IntersectionObserver((entries) => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          diffObserver.unobserve(en.target);
          fillDiff(en.target, en.target._file);
        });
      }, { root: box, rootMargin: '400px' });

      if (!list.length) {
        box.innerHTML = notARepo
          ? '<div class="diff-empty">This folder is not a git repository, so file changes cannot be shown.</div>'
          : '<div class="diff-empty">Nothing has changed in this folder.</div>';
        return;
      }

      list.forEach(f => {
        const seen = isViewed(f);
        const sec = document.createElement('section');
        sec.className = 'dfile' + (seen ? ' viewed collapsed' : '');
        sec._file = f;
        const dir = f.path.includes('/') || f.path.includes('\\') ? f.path.replace(/[\\/][^\\/]*$/, '') : '';
        sec.innerHTML = `<div class="dfile-head" title="${esc(f.path)}">
            <span class="ic">${fileIcon(baseName(f.path))}</span>
            <span class="name">${esc(baseName(f.path))}</span>
            <span class="dir">${esc(dir)}</span>
            ${f.status && f.status !== 'modified' ? `<span class="ch-tag ${esc(f.status)}">${esc(f.status)}</span>` : ''}
            ${f.added || f.removed ? `<span class="ch-nums"><span class="plus">+${f.added}</span><span class="minus">−${f.removed}</span></span>` : ''}
            <button class="seen" title="${seen ? 'Mark as not viewed' : 'Mark as viewed (collapses it)'}">${ICON_EYE}</button>
            <span class="caret"></span>
          </div><div class="dfile-body"></div>`;
        if (f.status !== 'deleted') Object.assign(sec.querySelector('.dfile-head').dataset, {fpath: f.path, fcwd: panelCwd || ''});
        sec.querySelector('.dfile-head').onclick = (e) => {
          if (e.target.closest('.seen')) return;
          sec.classList.toggle('collapsed');
          if (!sec.classList.contains('collapsed') && !sec.querySelector('.dfile-body').innerHTML) fillDiff(sec, f);
        };
        sec.querySelector('.seen').onclick = (e) => {
          e.stopPropagation();
          setViewed(f, !isViewed(f));
          openChanges(panelFiles, panelCwd);
        };
        box.appendChild(sec);
        if (!seen) diffObserver.observe(sec); // load when it comes near the viewport
      });
      box.scrollTop = prevScroll;
    }

    // ---------- Overview menu (top-right: Review & Files) ----------
    const ICON_OV_REVIEW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5h8.5L20 7v11a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 18V5A1.5 1.5 0 0 1 8 3.5z"/><path d="M16 3.5V7h3.5M13.2 10.5v4.4M11 12.7h4.4"/><path d="M4 7.5v12A1.5 1.5 0 0 0 5.5 21H16"/></svg>';
    const ICON_OV_FILES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4.5a1 1 0 0 1 1-1H14l4.5 4.5v11.5a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1z"/><path d="M14 3.5V8h4.5"/></svg>';
    const overviewMenu = document.createElement('div');
    overviewMenu.className = 'chatmenu ov-menu';
    document.body.appendChild(overviewMenu);
    function closeOverviewMenu() {
      overviewMenu.classList.remove('open');
      syncDiffButton();
    }
    function renderOverviewMenu() {
      const open = $('diffPanel').classList.contains('open');
      const added = changedFiles.reduce((a, f) => a + (f.added || 0), 0);
      const removed = changedFiles.reduce((a, f) => a + (f.removed || 0), 0);
      const nums = (added || removed)
        ? `<span class="ov-nums"><span class="plus">+${added}</span><span class="minus">-${removed}</span></span>`
        : (changedFiles.length ? `<span class="ov-nums"><span class="plus">${changedFiles.length}</span></span>` : '');
      overviewMenu.innerHTML = `<div class="ov-head">Overview</div>`
        + `<button data-tab="changes" class="${open && panelTab === 'changes' ? 'on' : ''}">${ICON_OV_REVIEW}<span>Review</span>${nums}</button>`
        + `<button data-tab="files" class="${open && panelTab === 'files' ? 'on' : ''}">${ICON_OV_FILES}<span>Files</span></button>`;
      overviewMenu.querySelectorAll('button[data-tab]').forEach(b => b.onclick = (e) => {
        e.stopPropagation();
        const tab = b.dataset.tab;
        const isOpen = $('diffPanel').classList.contains('open');
        closeOverviewMenu();
        // If the other view is open, take its place; if this view is already open, close it.
        if (tab === 'files') {
          if (isOpen && panelTab === 'files') closeDiffPanel();
          else openFiles();
        } else {
          if (isOpen && panelTab === 'changes' && !panelFiles && panelCwd === $('cwd').value.trim()) closeDiffPanel();
          else openChanges();
        }
      });
    }
    function openOverviewMenu() {
      renderOverviewMenu();
      overviewMenu.classList.add('open');
      syncDiffButton();
      const r = $('overviewBtn').getBoundingClientRect(), w = overviewMenu.offsetWidth, h = overviewMenu.offsetHeight;
      overviewMenu.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
      overviewMenu.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - h - 8)) + 'px';
    }
    if ($('overviewBtn')) {
      $('overviewBtn').onclick = (e) => {
        e.stopPropagation();
        overviewMenu.classList.contains('open') ? closeOverviewMenu() : openOverviewMenu();
      };
    }
    document.addEventListener('mousedown', (e) => {
      if (overviewMenu.classList.contains('open') && !e.target.closest('.ov-menu, #overviewBtn')) closeOverviewMenu();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overviewMenu.classList.contains('open')) { e.stopPropagation(); closeOverviewMenu(); }
    }, true);
    window.addEventListener('resize', closeOverviewMenu);

    function closeDiffPanel() {
      $('diffPanel').classList.remove('open');
      document.body.classList.remove('panel-max'); $('diffMax').title = 'Expand over the chat';   // closing an expanded panel must bring the chat back
      store.set('gui.diffOpen', false);
      syncDiffButton();
    }
    function syncDiffButton() {
      const btn = $('overviewBtn'); if (!btn) return;
      const open = $('diffPanel').classList.contains('open');
      btn.hidden = !$('cwd').value.trim();
      btn.classList.toggle('on', open || overviewMenu.classList.contains('open'));
      btn.classList.toggle('changed', !!changedFiles.length);
    }
    $('diffClose').onclick = closeDiffPanel;
    $('diffRefresh').onclick = async () => {
      if (panelTab === 'files') { renderTree(); return viewing && viewFile(viewing.path, viewing.cwd); }
      diffCache.clear(); await loadChanges(); openChanges(panelFiles, panelCwd, true);
    };

    // drag the panel's left edge to resize
    $('diffResizer').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startX = e.clientX, startW = $('diffPanel').getBoundingClientRect().width;
      document.body.classList.add('resizing-diff');
      const move = (ev) => {
        const files = panelTab === 'files';     // the Files view keeps its own, wider width
        const w = Math.min(Math.max(320, startW + startX - ev.clientX), files ? innerWidth - 300 : Math.min(900, innerWidth - 380));
        document.documentElement.style.setProperty(files ? '--files-w' : '--diff-w', Math.round(w) + 'px');
        if (files) fitFilesLayout();
      };
      const up = () => {
        document.body.classList.remove('resizing-diff');
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        const files = panelTab === 'files';
        store.set(files ? 'gui.filesW' : 'gui.diffW', getComputedStyle(document.documentElement).getPropertyValue(files ? '--files-w' : '--diff-w').trim());
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    { const w = store.get('gui.diffW', ''); if (w) document.documentElement.style.setProperty('--diff-w', w); }
    { const w = store.get('gui.filesW', ''); if (w) document.documentElement.style.setProperty('--files-w', w); }

    // Card under a reply: "2 files changed +119 −0 ›" (click to list them) and a Review button that opens the
    // changes panel. Each listed file opens the panel at that file.
    const ICON_REVIEW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>';
    function changesCard(files, cwd) {
      const el = document.createElement('div'); el.className = 'changed-card';
      const total = files.reduce((a, f) => a + (f.added || 0), 0), gone = files.reduce((a, f) => a + (f.removed || 0), 0);
      const nums = (a, r) => `<span class="ch-nums"><span class="plus">+${a}</span><span class="minus">−${r}</span></span>`;
      el.innerHTML = `<div class="ch-top"><button class="ch-sum" title="Show the files">${files.length} file${files.length > 1 ? 's' : ''} changed ${nums(total, gone)}<span class="ch-chev"></span></button>`
        + `<button class="ch-review" title="Open the changes">${ICON_REVIEW}Review</button></div><div class="ch-list"></div>`;
      const list = el.querySelector('.ch-list');
      files.forEach(f => {
        const row = document.createElement('div');
        row.className = 'ch-file' + (f.status === 'deleted' ? ' gone' : '');
        row.title = f.path + (f.status && f.status !== 'modified' ? ' (' + f.status + ')' : '');
        if (f.status !== 'deleted') { row.dataset.fpath = f.path; row.dataset.fcwd = cwd || ''; }
        row.innerHTML = `<span class="ic">${fileIcon(baseName(f.path))}</span><span class="name">${esc(baseName(f.path))}</span>` +
          (f.status === 'new' || f.status === 'added' ? '<span class="ch-new">new</span>' : '') + nums(f.added || 0, f.removed || 0);
        row.addEventListener('click', () => { openChanges(files, cwd); scrollToFile(f.path); });
        list.appendChild(row);
      });
      el.querySelector('.ch-sum').onclick = () => el.classList.toggle('open');
      el.querySelector('.ch-review').onclick = () => openChanges(files, cwd);
      return el;
    }

    // ---------- files view ----------
    // An editor-like view of the working folder in the right panel: a file sidebar (tree + filter) on the left,
    // the open files as tabs on the right. Right-click any file (in the tree, a step, a change card, an attachment,
    // or a path Gemini mentions) for the file menu.
    let panelTab = 'changes';
    let treeCwd = null;                   // folder the tree shows
    const treeOpen = new Set();           // expanded folders (relative, "/"-separated), kept across re-renders
    let openTabs = [];                    // [{path, cwd, rel}]
    let viewing = null;                   // the active tab, plus {text, mode} once loaded
    const WIN = /Windows/.test(navigator.userAgent);
    const SEP = WIN ? '\\' : '/';
    const isAbs = (p) => /^([A-Za-z]:[\\/]|[\\/])/.test(p);
    function absPath(p, cwd) {
      let s = String(p || '');
      if (!isAbs(s)) s = String(cwd || '').replace(/[\\/]+$/, '') + SEP + s.replace(/^\.[\\/]/, '');
      return WIN ? s.replace(/\//g, '\\') : s;
    }
    function relPath(abs, cwd) {
      if (!cwd) return abs;
      const root = absPath(String(cwd || '').replace(/[\\/]+$/, ''), '');
      const a = WIN ? abs.toLowerCase() : abs, r = WIN ? root.toLowerCase() : root;
      return root && a.startsWith(r + SEP) ? abs.slice(root.length + 1) : abs;
    }
    const samePath = (a, b) => WIN ? String(a).toLowerCase() === String(b).toLowerCase() : a === b;
    const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.5h8.8A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" /></svg>';
    const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 7l10 10M17 7 7 17" /></svg>';

    // A small coloured badge per file type, like an editor's file icons.
    const FTYPES = [
      [/\.(m?js|cjs)$/i, 'JS', '#e8c547'], [/\.jsx$/i, 'JSX', '#5fc4e8'], [/\.tsx?$/i, 'TS', '#4992ea'],
      [/\.json5?$/i, '{}', '#e8a33d', 1], [/\.html?$/i, '#', '#e8743d', 1], [/\.(s?css|less)$/i, '#', '#5f9ee8', 1],
      [/\.mdx?$/i, 'M↓', '#8fa3b8'], [/\.py$/i, 'PY', '#5f9ee8'], [/\.(ya?ml)$/i, 'YML', '#d9534f'],
      [/\.(sh|bash|zsh|ps1|bat|cmd)$/i, '>_', '#7ec27e'], [/\.(java|kt)$/i, 'JV', '#e8743d'], [/\.go$/i, 'GO', '#5fc4e8'],
      [/\.rs$/i, 'RS', '#e8a33d'], [/\.(c|h|cpp|hpp|cc)$/i, 'C', '#5f9ee8'], [/\.cs$/i, 'C#', '#9b72d9'],
      [/\.(xml|svg)$/i, '<>', '#e8a33d'], [/\.(toml|ini|cfg|conf|env)$/i, '⚙', '#8fa3b8', 1], [/\.sql$/i, 'SQL', '#e8c547'],
      [/\.(feature)$/i, 'FT', '#7ec27e'], [/\.(txt|log)$/i, '≡', '#8fa3b8', 1], [/\.lock$/i, '🔒', '#8fa3b8'],
    ];
    const ICON_IMAGE = '<svg viewBox="0 0 24 24" fill="none" stroke="#e86f9b" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4 17l4.5-4.5 3 3 3-3.5L20 17" /></svg>';
    // Python: a 16×16 pixel-art icon drawn here (two interlocking snakes, the yellow one is the blue one turned
    // 180°), no external image.
    const ICON_PY = '<svg viewBox="0 0 24 24"><path fill="#3b77a8" d="M9 3h5a3 3 0 0 1 3 3v3a2 2 0 0 1-2 2H9a2 2 0 0 0-2 2v1.5H6a3 3 0 0 1-3-3V9a6 6 0 0 1 6-6z"/><circle cx="9.3" cy="6.6" r="1.1" fill="#fff"/><g transform="rotate(180 12 12)"><path fill="#f2c83a" d="M9 3h5a3 3 0 0 1 3 3v3a2 2 0 0 1-2 2H9a2 2 0 0 0-2 2v1.5H6a3 3 0 0 1-3-3V9a6 6 0 0 1 6-6z"/><circle cx="9.3" cy="6.6" r="1.1" fill="#fff"/></g></svg>';
    // Robot Framework (.robot, .resource): a small robot head with antenna and ears, drawn for this app.
    const ICON_ROBOT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="currentColor"><path fill-rule="evenodd" d="M16 3.500a1.7 1.7 0 0 1 .9 3.150V8.500H22a4 4 0 0 1 4 4V22a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4v-9.500a4 4 0 0 1 4-4h5.100V6.650A1.7 1.7 0 0 1 16 3.500zM11.5 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM20.5 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 21h8v1.600h-8z"/><path d="M3 13.500h1.800v6H3zM27.2 13.500H29v6h-1.800z"/></svg>';
    function fileIcon(name) {
      if (/\.(robot|resource)$/i.test(name)) return `<span class="ftype">${ICON_ROBOT}</span>`;
      if (IMG_RE.test(name)) return `<span class="ftype">${ICON_IMAGE}</span>`;
      if (/\.pyw?$/i.test(name)) return `<span class="ftype">${ICON_PY}</span>`;
      const t = FTYPES.find(([re]) => re.test(name));
      if (!t) return DOC_ICON;
      return `<span class="ftype${t[3] ? ' big' : ''}" style="color:${t[2]}">${esc(t[1])}</span>`;
    }

    function setPanelTab(tab) {
      panelTab = tab;
      store.set('gui.panelTab', tab);
      $('diffBody').hidden = tab !== 'changes';
      $('filesBody').hidden = tab !== 'files';
      $('diffPanel').classList.toggle('files', tab === 'files');
      $('fxTreeToggle').hidden = tab !== 'files';
      $('diffRefresh').title = tab === 'files' ? 'Reload' : 'Refresh';
    }

    // expand the panel over the chat, and back
    const syncMaxTitle = () => { $('diffMax').title = document.body.classList.contains('panel-max') ? 'Back to the chat' : 'Expand over the chat'; };
    $('diffMax').onclick = () => {
      document.body.classList.toggle('panel-max');
      syncMaxTitle();
      fitFilesLayout();
    };

    function openFiles() {
      const cwd = $('cwd').value.trim();
      $('diffPanel').classList.add('open');
      store.set('gui.diffOpen', true);
      setPanelTab('files');
      syncDiffButton();
      $('diffTitle').textContent = baseName(cwd || '');
      $('diffTitle').title = cwd;
      if (treeCwd !== cwd) resetTree(cwd);
      if (!$('fileTree').childElementCount) renderTree(); else refreshTreeSoon();
      fitFilesLayout();
    }
    function saveTabsState() {
      if (!treeCwd) return;
      store.set('gui.tabs:' + treeCwd, {
        tabs: openTabs.map(t => t.path),
        active: viewing ? viewing.path : null
      });
    }
    function resetTree(cwd) {
      treeCwd = cwd; treeOpen.clear();
      $('fileTree').innerHTML = '';
      $('fxFilter').value = '';
      const saved = store.get('gui.tabs:' + cwd, null);
      if (saved && Array.isArray(saved.tabs)) {
        openTabs = saved.tabs.map(p => ({path: p, cwd}));
        viewing = null;
        renderTabs();
        if (saved.active) setTimeout(() => viewFile(saved.active, cwd), 0);
        else showEmptyView();
      } else {
        openTabs = []; viewing = null;
        renderTabs(); showEmptyView();
      }
    }

    // The sidebar sits beside the file when there is room, and over it when the panel is narrow.
    let sideHidden = store.get('gui.fxSideHidden', false);
    function fitFilesLayout() {
      const fb = $('filesBody');
      const narrow = $('diffPanel').getBoundingClientRect().width < 600;
      fb.classList.toggle('narrow', narrow);
      fb.classList.toggle('noside', narrow ? (!!viewing && fb.dataset.sideOpen !== '1') : sideHidden);
      $('fxTreeToggle').classList.toggle('on', !fb.classList.contains('noside'));
    }
    $('fxTreeToggle').onclick = () => {
      const fb = $('filesBody');
      if (fb.classList.contains('narrow')) fb.dataset.sideOpen = fb.classList.contains('noside') ? '1' : '';
      else { sideHidden = !sideHidden; store.set('gui.fxSideHidden', sideHidden); }
      fitFilesLayout();
    };
    window.addEventListener('resize', () => { if (panelTab === 'files') fitFilesLayout(); });

    // drag the file list's left edge to resize it (it sits on the right, so dragging left widens it)
    $('fxSideResizer').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startX = e.clientX, startW = $('fxSide').getBoundingClientRect().width;
      document.body.classList.add('resizing-side');
      const move = (ev) => document.documentElement.style.setProperty('--fx-side', Math.round(Math.min(Math.max(150, startW - (ev.clientX - startX)), 480)) + 'px');
      const up = () => {
        document.body.classList.remove('resizing-side');
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        store.set('gui.fxSide', getComputedStyle(document.documentElement).getPropertyValue('--fx-side').trim());
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    { const w = store.get('gui.fxSide', ''); if (w) document.documentElement.style.setProperty('--fx-side', w); }

    async function renderTree() {
      const box = $('fileTree');
      box.innerHTML = '';
      if (!treeCwd) { box.innerHTML = '<div class="fmsg">Choose a working folder first.</div>'; return; }
      if ($('fxFilter').value.trim()) return runFilter();
      const kids = document.createElement('div');
      box.appendChild(kids);
      await fillDir(kids, '', 0);
    }
    const joinRel = (a, b) => a ? a + '/' + b : b;
    // quiet: refresh an already shown folder; leaves it untouched when nothing in it changed (no "Loading…")
    async function fillDir(container, rel, depth, quiet) {
      container.dataset.dir = rel; container.dataset.depth = depth;
      if (!quiet) container.innerHTML = `<div class="fmsg" style="padding-left:${18 + depth * 14}px">Loading…</div>`;
      let d;
      try {
        const res = await fetch(`/api/tree?cwd=${encodeURIComponent(treeCwd)}&path=${encodeURIComponent(rel || '.')}`);
        d = res.status === 404 ? {error: 'The Files view needs the updated server: stop gemini-ui (Ctrl+C) and start it again.'} : await res.json();
      } catch (e) { d = {error: 'Could not reach the server.'}; }
      const key = d.error ? 'error' : JSON.stringify([d.dirs.map(x => x.name), d.files.map(x => x.name)]);
      if (quiet && (d.error || container.dataset.key === key)) return;
      container.dataset.key = key;
      container.innerHTML = '';
      if (d.error) { container.innerHTML = `<div class="fmsg">${esc(d.error)}</div>`; return; }
      if (!d.dirs.length && !d.files.length) container.innerHTML = `<div class="fmsg" style="padding-left:${18 + depth * 14}px">Empty</div>`;
      d.dirs.forEach(x => container.appendChild(treeRow(x, true, depth, joinRel(rel, x.name))));
      d.files.forEach(x => container.appendChild(treeRow(x, false, depth, joinRel(rel, x.name))));
      markTreeChanges();
      markActiveRow();
    }
    function treeRow(x, dir, depth, rel, sub) {
      const wrap = document.createElement('div');
      const row = document.createElement('div');
      row.className = 'frow' + (dir ? ' dir' : '') + (x.name.startsWith('.') ? ' dotfile' : '');
      row.style.paddingLeft = (6 + depth * 14) + 'px';
      row.style.setProperty('--depth', depth);   // draws one indent guide line per level
      row.dataset.rel = rel;
      row.dataset.fpath = x.path;
      row.dataset.fcwd = treeCwd;
      if (dir) row.dataset.fdir = '1';
      row.title = rel + (x.size != null ? ' · ' + fmtSize(x.size) : '');
      row.innerHTML = `<span class="tw"></span>${dir ? ICON_FOLDER : fileIcon(x.name)}<span class="fn">${esc(x.name)}</span>`
        + (sub ? `<span class="fsub">${esc(sub)}</span>` : '') + (dir ? '' : '<span class="ftag"></span>');
      wrap.appendChild(row);
      if (dir) {
        const kids = document.createElement('div');
        kids.hidden = true;
        wrap.appendChild(kids);
        const toggle = () => {
          const open = !row.classList.contains('open');
          row.classList.toggle('open', open);
          kids.hidden = !open;
          if (!open) return treeOpen.delete(rel);
          treeOpen.add(rel);
          if (!kids.dataset.loaded) { kids.dataset.loaded = 1; fillDir(kids, rel, depth + 1); }
        };
        row.onclick = toggle;
        if (treeOpen.has(rel)) toggle();      // re-rendering keeps expanded folders open
      } else row.onclick = () => viewFile(x.path, treeCwd);
      return wrap;
    }
    function markActiveRow() {
      $('fileTree').querySelectorAll('.frow').forEach(r => r.classList.toggle('active', !!viewing && samePath(r.dataset.fpath, viewing.path)));
    }
    // Files Gemini creates, deletes or renames show up in the list: every folder that is shown is checked
    // again (top-level first) and redrawn only if its contents changed. Open folders and scroll stay as they are.
    let treeRefreshTimer = null;
    function refreshTreeSoon() { clearTimeout(treeRefreshTimer); treeRefreshTimer = setTimeout(refreshTree, 400); }
    async function refreshTree() {
      const box = $('fileTree');
      if (!treeCwd || treeCwd !== $('cwd').value.trim() || !box.childElementCount || $('fxFilter').value.trim()) return;
      const scroll = box.scrollTop;
      const shown = () => [...box.querySelectorAll('[data-dir]')].filter(c => !c.hidden && !c.closest('[hidden]'));
      const done = new Set();
      for (let pass = 0; pass < 6; pass++) {           // a redrawn folder can bring back open sub-folders
        const todo = shown().filter(c => !done.has(c.dataset.dir));
        if (!todo.length) break;
        for (const c of todo) { done.add(c.dataset.dir); if (c.isConnected) await fillDir(c, c.dataset.dir, +c.dataset.depth, true); }
      }
      box.scrollTop = scroll;
      markTreeChanges(); markActiveRow();
    }
    // The open file is shown in the list: its folders are expanded (loading them as needed), and the row is
    // highlighted and scrolled into view. Skipped while the list is filtered or for files outside the folder.
    let revealSeq = 0;
    async function revealInTree(abs, cwd) {
      if (!treeCwd || (cwd || '') !== treeCwd || $('fxFilter').value.trim()) return;
      const rel = relPath(abs, cwd).replace(/\\/g, '/');
      if (!rel || isAbs(rel) || rel.startsWith('..')) return;
      const seq = ++revealSeq, parts = rel.split('/').filter(Boolean);
      const box = $('fileTree');
      const rowFor = (r) => [...box.querySelectorAll('.frow')].find(x => x.dataset.rel === r);
      // wait (briefly) for a row that is still being loaded
      const waitRow = async (r) => {
        for (let i = 0; i < 60; i++) {
          const row = rowFor(r);
          if (row || seq !== revealSeq) return row;
          await new Promise(res => setTimeout(res, 50));
        }
        return null;
      };
      for (let i = 1; i < parts.length; i++) {
        const dirRow = await waitRow(parts.slice(0, i).join('/'));
        if (!dirRow || seq !== revealSeq) return;
        if (!dirRow.classList.contains('open')) dirRow.click();
      }
      const row = await waitRow(parts.join('/'));
      if (!row || seq !== revealSeq) return;
      markActiveRow();
      row.scrollIntoView({block: 'nearest'});
    }

    // Filter: searches the whole folder by name (not only the folders that are expanded).
    let filterTimer = null, filterSeq = 0;
    $('fxFilter').addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(renderTree, 180); });
    $('fxFilter').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.target.value) { e.stopPropagation(); e.target.value = ''; renderTree(); }
      if (e.key === 'Enter') $('fileTree').querySelector('.frow:not(.dir)')?.click();
    });
    async function runFilter() {
      const q = $('fxFilter').value.trim(), seq = ++filterSeq, box = $('fileTree');
      box.innerHTML = '<div class="fmsg">Searching…</div>';
      let d;
      try {
        const res = await fetch(`/api/find?cwd=${encodeURIComponent(treeCwd)}&q=${encodeURIComponent(q)}`);
        d = res.status === 404 ? {error: 'Filtering needs the updated server: restart gemini-ui.'} : await res.json();
      } catch { d = {error: 'Could not reach the server.'}; }
      if (seq !== filterSeq) return;
      box.innerHTML = '';
      if (d.error) { box.innerHTML = `<div class="fmsg">${esc(d.error)}</div>`; return; }
      if (!d.files.length) { box.innerHTML = '<div class="fmsg">No matching files.</div>'; return; }
      d.files.forEach(f => {
        const parts = f.rel.split('/'), name = parts.pop();
        const w = treeRow({name, path: f.path, size: f.size}, !!f.dir, 0, f.rel, parts.join('/'));
        if (f.dir) { const r = w.querySelector('.frow'); r.onclick = () => { $('fxFilter').value = ''; revealFolder(f.path, treeCwd); }; }
        box.appendChild(w);
      });
      if (d.truncated) box.insertAdjacentHTML('beforeend', '<div class="fmsg">More matches not shown; type more to narrow it down.</div>');
      markTreeChanges(); markActiveRow();
    }

    // Open the tree down to a folder (used when a folder reference is clicked).
    function revealFolder(abs, cwd) {
      if ((cwd || '') !== $('cwd').value.trim()) return;
      openFiles();
      const rel = relPath(abs, cwd).replace(/\\/g, '/');
      if (isAbs(rel)) return;
      const parts = rel.split('/').filter(Boolean);
      for (let i = 1; i <= parts.length; i++) treeOpen.add(parts.slice(0, i).join('/'));
      $('fxFilter').value = '';
      const fb = $('filesBody');
      if (fb.classList.contains('narrow')) fb.dataset.sideOpen = '1'; else { sideHidden = false; store.set('gui.fxSideHidden', false); }
      fitFilesLayout();
      renderTree();
    }
    // Files Gemini changed are tinted in the tree, and so are the folders that contain them.
    const STATUS_LETTER = {modified: 'M', added: 'A', new: 'U', renamed: 'R', copied: 'C', conflicted: '!'};
    function markTreeChanges() {
      const cwd = $('cwd').value.trim();
      if (treeCwd !== null && treeCwd !== cwd) {         // the folder changed: start over
        resetTree(cwd);
        if (panelTab === 'files' && $('diffPanel').classList.contains('open')) openFiles();
        return;
      }
      const st = new Map(changedFiles.map(f => [f.path.replace(/\\/g, '/').replace(/\/$/, ''), f.status]));
      const dirs = new Set();
      // a folder takes the colour of the most serious change inside it (like VS Code): conflict/deleted > modified > new
      const rank = (s) => s === 'conflicted' || s === 'deleted' ? 3 : s === 'modified' ? 2 : 1;
      const dirSt = new Map();
      st.forEach((s, p) => {
        const parts = p.split('/');
        for (let i = 1; i < parts.length; i++) {
          const d = parts.slice(0, i).join('/');
          dirs.add(d);
          if (!dirSt.has(d) || rank(s) > rank(dirSt.get(d))) dirSt.set(d, s);
        }
      });
      $('fileTree').querySelectorAll('.frow').forEach(r => {
        const s = st.get(r.dataset.rel);
        r.classList.toggle('changed', !!s || dirs.has(r.dataset.rel));
        if (r.dataset.fdir) { if (dirSt.has(r.dataset.rel)) r.dataset.git = dirSt.get(r.dataset.rel); else delete r.dataset.git; }
        else if (s) r.dataset.git = s; else delete r.dataset.git;
        const tag = r.querySelector('.ftag');
        if (tag) tag.textContent = s ? (STATUS_LETTER[s] || '') : '';
      });
      if (viewing && viewing.mode === 'source') markFileGutter();
    }

    // ---- open files as tabs ----
    function renderTabs() {
      const box = $('fxTabs');
      box.innerHTML = '';
      openTabs.forEach(t => {
        const el = document.createElement('div');
        el.className = 'fx-tab' + (viewing && samePath(viewing.path, t.path) ? ' on' : '');
        el.title = t.path;
        el.dataset.fpath = t.path; el.dataset.fcwd = t.cwd;
        el.innerHTML = `${fileIcon(baseName(t.path))}<span class="nm">${esc(baseName(t.path))}</span><button class="x" title="Close">${ICON_X}</button>`;
        el.onclick = (e) => { if (!e.target.closest('.x')) viewFile(t.path, t.cwd); };
        // middle-click (wheel click) closes, like an editor; stopping the mousedown keeps Chrome's autoscroll
        // from starting and swallowing the click
        el.onmousedown = (e) => { if (e.button === 1) e.preventDefault(); };
        el.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.path); } };
        el.querySelector('.x').onclick = (e) => { e.stopPropagation(); closeTab(t.path); };
        box.appendChild(el);
      });
      box.querySelector('.fx-tab.on')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
      renderFvPath();
    }
    // The path of the open file under the tabs: "project › folder › file". A file outside the project shows its
    // own folders (the last few of them) instead.
    function renderFvPath() {
      const bar = $('fvCrumbs');
      if (!viewing) { bar.hidden = true; bar.innerHTML = ''; return; }
      let parts = String(viewing.rel || viewing.path).split(/[\\/]+/).filter(Boolean);
      if (viewing.rel !== viewing.path) parts.unshift(baseName(viewing.cwd || '') || 'Project');
      else if (parts.length > 4) parts = ['…', ...parts.slice(-3)];
      bar.innerHTML = parts.map((x, i) => i === parts.length - 1
        ? `<span class="cur">${fileIcon(x)}${esc(x)}</span>` : `<span>${esc(x)}</span><i class="sep">›</i>`).join('');
      bar.title = viewing.path;
      bar.hidden = false;
    }
    function closeTab(p) {
      const i = openTabs.findIndex(t => samePath(t.path, p));
      if (i < 0) return;
      const cur = viewing && samePath(viewing.path, p);
      if (cur && viewing.dirty && !confirm(`${baseName(p)} has unsaved table edits. Close it and drop them?`)) return;
      if (cur) viewing.dirty = false;
      openTabs.splice(i, 1);
      if (cur) {
        const next = openTabs[i] || openTabs[i - 1];
        if (next) return viewFile(next.path, next.cwd);
        viewing = null; showEmptyView();
      }
      renderTabs(); markActiveRow(); fitFilesLayout();
      saveTabsState();
    }
    function showEmptyView() {
      $('fvHead').hidden = true; $('fvFindBar').hidden = true; $('fvBody').hidden = true; $('fvCrumbs').hidden = true;
      $('fvBody').innerHTML = ''; $('fvEmpty').hidden = false;
      clearFind();
    }

    // hljs spans can cross lines; close and reopen them at each newline so every line is its own element
    function splitHtmlLines(html) {
      const out = [], open = [];
      let cur = '', m;
      const re = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+|<)/g;
      while ((m = re.exec(html))) {
        if (m[1]) { open.push(m[1]); cur += m[1]; }
        else if (m[2]) { open.pop(); cur += m[2]; }
        else if (m[3]) { out.push(cur + '</span>'.repeat(open.length)); cur = open.join(''); }
        else cur += m[4];
      }
      out.push(cur + '</span>'.repeat(open.length));
      return out;
    }
    // ---------- CSV / TSV table view ----------
    // .csv/.tsv files open as an editable table (the button in the header switches to the source). Edits stay
    // in viewing.csv.rows until saved with Save / Ctrl+S; saving writes the same delimiter and line endings,
    // and the server keeps the file's encoding and refuses if the file changed on disk meanwhile.
    const CSV_RE = /\.(csv|tsv)$/i;
    const CSV_MAX_ROWS = 3000;            // rows drawn; bigger files are edited in the first rows only
    function csvDelimiter(text, name) {
      if (/\.tsv$/i.test(name)) return '\t';
      const sample = text.split('\n').slice(0, 10).join('\n').replace(/"[^"]*"/g, '');   // ignore quoted parts
      let best = ',', n = 0;
      for (const d of [',', ';', '\t', '|']) { const c = sample.split(d).length - 1; if (c > n) { n = c; best = d; } }
      return best;
    }
    function parseCsv(text, d) {
      const rows = []; let row = [], cell = '', q = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
          if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
          else cell += c;
        } else if (c === '"' && cell === '') q = true;
        else if (c === d) { row.push(cell); cell = ''; }
        else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += c;
      }
      if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
      return rows;
    }
    function csvText(eol = '\n') {
      const {rows, d, endNl} = viewing.csv;
      const special = new RegExp('["\\r\\n' + (d === '\t' ? '\\t' : d.replace(/[|\\]/g, '\\$&')) + ']');
      return rows.map(r => r.map(c => special.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c).join(d)).join(eol) + (endNl ? eol : '');
    }
    const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };

    function renderCsvTable(focus) {
      const body = $('fvBody');
      if (!viewing.csv || viewing.csv.src !== viewing.text) {
        const d = csvDelimiter(viewing.text, viewing.path);
        viewing.csv = {d, rows: parseCsv(viewing.text, d), src: viewing.text, endNl: viewing.text.endsWith('\n'), cur: null};
        csvMarkSaved();
      }
      const csv = viewing.csv, rows = csv.rows, shown = rows.slice(0, CSV_MAX_ROWS);
      let cols = 1; shown.forEach(r => { if (r.length > cols) cols = r.length; });
      const prev = body.querySelector('.csv-scroll'), keep = prev ? [prev.scrollTop, prev.scrollLeft] : null;
      const DELIM = {',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe'};
      const md = csvMdOn();
      const cell = (r, c, tag) => {
        const v = rows[r]?.[c] ?? '', h = md ? csvMdHtml(v) : null;
        const cls = [h && 'mdc', csvIsChanged(r, c) && 'chg'].filter(Boolean).join(' ');
        return `<${tag} contenteditable="plaintext-only" spellcheck="false" data-r="${r}" data-c="${c}"${cls ? ` class="${cls}"` : ''}>${h ?? esc(v)}</${tag}>`;
      };
      const line = (r, tag) => `<tr><th class="rn">${r + 1}</th>${Array.from({length: cols}, (_, c) => cell(r, c, tag)).join('')}</tr>`;
      body.innerHTML = `<div class="csv-bar">
          <span class="csv-info">${rows.length.toLocaleString()} row${rows.length === 1 ? '' : 's'} · ${cols} column${cols === 1 ? '' : 's'} · ${DELIM[csv.d] || 'comma'}</span>
          <button data-a="row" title="Add a row below the selected cell (or at the end)">+ Row</button>
          <button data-a="col" title="Add a column right of the selected cell (or at the end)">+ Column</button>
          <button data-a="delrow" title="Delete the selected cell's row" disabled>Delete row</button>
          <button data-a="delcol" title="Delete the selected cell's column" disabled>Delete column</button>
          <button data-a="md" class="csv-md${md ? ' on' : ''}" title="Show Markdown in cells (bold, italics, links, code, lists). The cell you are editing shows its raw text.">Markdown</button>
          <span class="csv-state"></span>
          <button data-a="save" class="csv-save" title="Save (Ctrl+S)" hidden>Save</button>
        </div>
        <div class="csv-scroll"><table class="csv-table">
          <thead><tr class="letters"><th class="rn"></th>${Array.from({length: cols}, (_, c) => `<th>${colName(c)}</th>`).join('')}</tr>
          ${shown.length ? line(0, 'td') : ''}</thead>
          <tbody>${shown.slice(1).map((_, i) => line(i + 1, 'td')).join('')}</tbody>
        </table>
        ${rows.length > CSV_MAX_ROWS ? `<div class="fmsg">Showing the first ${CSV_MAX_ROWS.toLocaleString()} of ${rows.length.toLocaleString()} rows. The rest are kept as they are when you save.</div>` : ''}
        </div>`;
      const sc = body.querySelector('.csv-scroll');
      if (keep) { sc.scrollTop = keep[0]; sc.scrollLeft = keep[1]; }
      updateCsvState();
      if (!$('fvFindBar').hidden) refreshFind(true);       // the old matches pointed into the replaced cells
      const f = focus || csv.cur;
      if (f) body.querySelector(`td[data-r="${f.r}"][data-c="${f.c}"]`)?.focus({preventScroll: !focus});
    }
    // Markdown in cells: a cell whose text looks like Markdown is shown rendered; while it has focus it shows
    // its raw text for editing, and it is rendered again when it loses focus. The file itself is never changed.
    const csvMdOn = () => store.get('gui.csvMd', true);
    const CSV_MD_RE = /[*_`~\[<]|^\s{0,3}(#{1,6}\s|[-+*]\s|\d+[.)]\s|>)|https?:\/\/|www\.|\n/m;
    const CSV_MD_TAGS = ['strong', 'b', 'em', 'i', 'code', 'del', 's', 'a', 'br', 'p', 'ul', 'ol', 'li', 'blockquote',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'hr', 'sub', 'sup', 'mark', 'kbd', 'span', 'input'];
    function csvMdHtml(v) {
      if (!v || !CSV_MD_RE.test(v)) return null;
      let html;
      try { html = /\n|^\s{0,3}(#{1,6}\s|[-+*]\s|\d+[.)]\s|>)/.test(v) ? marked.parse(v) : marked.parseInline(v); }
      catch { return null; }
      html = DOMPurify.sanitize(html, {ALLOWED_TAGS: CSV_MD_TAGS, ALLOWED_ATTR: ['href', 'title', 'type', 'checked', 'disabled']}).trim()
        // editable cells keep line breaks visible (Chrome forces pre-wrap), so drop marked's newlines outside <pre>
        .replace(/(<pre[\s\S]*?<\/pre>)|\n/g, (m, pre) => pre || '');
      return html === esc(v) ? null : html;     // nothing to render: keep it as plain text
    }
    function csvCellShowRaw(td) {
      if (!td.classList.contains('mdc')) return;
      const at = csvCell(td);
      td.classList.remove('mdc');
      td.textContent = viewing.csv.rows[at.r]?.[at.c] ?? '';
      const sel = getSelection(), rg = document.createRange();
      rg.selectNodeContents(td); rg.collapse(false); sel.removeAllRanges(); sel.addRange(rg);
      if (!$('fvFindBar').hidden) refreshFind(true);
    }
    function csvCellShowMd(td) {
      const at = csvCell(td);
      if (!at || !viewing?.csv || !csvMdOn()) return;
      const h = csvMdHtml(viewing.csv.rows[at.r]?.[at.c] ?? '');
      if (h) { td.innerHTML = h; td.classList.add('mdc'); }
      if (!$('fvFindBar').hidden) refreshFind(true);
    }
    // Unsaved edits are tinted in the primary color. Each row array keeps its saved values in row.o (a row
    // added since the save has none); adding or deleting a column splices row.o too, with NEW in the new column.
    const CSV_NEW = {};
    function csvMarkSaved() { viewing.csv.rows.forEach(r => { r.o = r.slice(); }); }
    function csvIsChanged(r, c) {
      const row = viewing.csv.rows[r];
      if (!row) return false;
      if (!row.o) return true;                        // a new row
      const o = row.o[c];
      return o === CSV_NEW || (o ?? '') !== (row[c] ?? '');
    }
    function csvChangedCount() {
      let n = 0;
      viewing.csv.rows.forEach((row, r) => { for (let c = 0; c < Math.max(row.length, row.o?.length || 0); c++) if (csvIsChanged(r, c)) n++; });
      return n;
    }
    function csvCell(td) { return td && td.matches('td[data-r]') ? {r: +td.dataset.r, c: +td.dataset.c} : null; }
    function setCsvCell(r, c, v) {
      const rows = viewing.csv.rows;
      while (rows.length <= r) rows.push([]);
      while (rows[r].length <= c) rows[r].push('');
      rows[r][c] = v;
    }
    function csvChanged() { viewing.dirty = true; updateCsvState(); }
    function updateCsvState(note) {
      const bar = $('fvBody').querySelector('.csv-bar');
      $('fxTabs').querySelector('.fx-tab.on')?.classList.toggle('dirty', !!viewing?.dirty);
      if (!bar) return;
      bar.querySelector('.csv-save').hidden = !viewing.dirty;
      const st = bar.querySelector('.csv-state');
      st.className = 'csv-state' + (note?.cls ? ' ' + note.cls : '');
      let n = 0;
      if (!note && viewing.dirty) n = csvChangedCount();
      st.innerHTML = note?.html ?? (viewing.dirty ? `<span class="chg-dot"></span>Unsaved changes${n ? ` · ${n.toLocaleString()} cell${n === 1 ? '' : 's'}` : ''}` : '');
      const has = !!viewing.csv?.cur;
      bar.querySelector('[data-a=delrow]').disabled = !has;
      bar.querySelector('[data-a=delcol]').disabled = !has;
    }
    async function saveCsv(force) {
      if (!viewing?.csv || !viewing.dirty) return;
      const v = viewing, text = csvText(v.eol || '\n');
      updateCsvState({html: 'Saving…'});
      let r;
      try {
        const res = await fetch('/api/write', {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({cwd: v.cwd, path: v.path, text, mtime: force ? undefined : v.mtime})});
        r = res.status === 404 ? {error: 'Saving needs the updated server: restart Gemini Studio'} : await res.json();
      } catch { r = {error: 'Could not reach the server'}; }
      if (viewing !== v) return;
      if (r.conflict) return updateCsvState({cls: 'warn', html: 'This file changed on disk (Gemini may have edited it). <button data-a="reload">Reload</button> <button data-a="overwrite">Keep mine</button>'});
      if (r.error) return updateCsvState({cls: 'warn', html: esc(r.error)});
      v.mtime = r.mtime; v.dirty = false;
      v.text = v.csv.src = csvText('\n');
      if (viewing === v) { csvMarkSaved(); $('fvBody').querySelectorAll('.csv-table td.chg').forEach(td => td.classList.remove('chg')); }
      updateCsvState({cls: 'ok', html: 'Saved'});
      loadChanges(true);
    }
    // Clicks and edits in the table (one set of listeners on the viewer body).
    $('fvBody').addEventListener('click', (e) => {
      const b = e.target.closest('.csv-bar button');
      if (!b || !viewing?.csv) return;
      const csv = viewing.csv, rows = csv.rows, cur = csv.cur;
      const width = Math.max(1, ...rows.slice(0, CSV_MAX_ROWS).map(r => r.length));
      switch (b.dataset.a) {
        case 'save': return saveCsv();
        case 'overwrite': return saveCsv(true);
        case 'md': store.set('gui.csvMd', !csvMdOn()); return renderCsvTable();
        case 'reload': viewing.dirty = false; viewing.mtime = -1; viewing.csv = null; return refreshOpenFile();   // re-read the table from disk
        case 'row': { const at = cur ? cur.r + 1 : rows.length; rows.splice(at, 0, Array(width).fill('')); csvChanged(); return renderCsvTable({r: at, c: cur ? cur.c : 0}); }
        case 'col': { const at = cur ? cur.c + 1 : width; rows.forEach(r => { while (r.length < at) r.push(''); r.splice(at, 0, ''); if (r.o) { while (r.o.length < at) r.o.push(undefined); r.o.splice(at, 0, CSV_NEW); } }); csvChanged(); return renderCsvTable({r: cur ? cur.r : 0, c: at}); }
        case 'delrow': if (!cur) return; rows.splice(cur.r, 1); csv.cur = null; csvChanged(); return renderCsvTable(rows.length ? {r: Math.min(cur.r, rows.length - 1), c: cur.c} : null);
        case 'delcol': if (!cur) return; rows.forEach(r => { if (r.length > cur.c) r.splice(cur.c, 1); if (r.o && r.o.length > cur.c) r.o.splice(cur.c, 1); }); csv.cur = null; csvChanged(); return renderCsvTable({r: cur.r, c: Math.max(0, cur.c - 1)});
      }
    });
    $('fvBody').addEventListener('input', (e) => {
      const at = csvCell(e.target);
      if (!at || !viewing?.csv) return;
      setCsvCell(at.r, at.c, e.target.textContent);
      e.target.classList.toggle('chg', csvIsChanged(at.r, at.c));
      csvChanged();
    });
    $('fvBody').addEventListener('focusin', (e) => {
      const at = csvCell(e.target);
      if (!at || !viewing?.csv) return;
      csvCellShowRaw(e.target);
      viewing.csv.cur = at;
      $('fvBody').querySelectorAll('.csv-table .cur-row, .csv-table .cur-col').forEach(x => x.classList.remove('cur-row', 'cur-col'));
      e.target.closest('tr').classList.add('cur-row');
      $('fvBody').querySelectorAll(`.csv-table tr.letters th:nth-child(${at.c + 2})`).forEach(x => x.classList.add('cur-col'));
      updateCsvState();
    });
    $('fvBody').addEventListener('focusout', (e) => { if (csvCell(e.target)) csvCellShowMd(e.target); });
    // Ctrl+click a link in a rendered cell opens it (a plain click edits the cell).
    $('fvBody').addEventListener('mousedown', (e) => {
      const a = e.target.closest('.csv-table td.mdc a[href]');
      if (!a || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (/^(https?:|mailto:)/i.test(a.getAttribute('href'))) window.open(a.href, '_blank', 'noopener');
    });
    $('fvBody').addEventListener('click', (e) => { if (e.target.closest('.csv-table td.mdc a')) e.preventDefault(); });
    $('fvBody').addEventListener('keydown', (e) => {
      const at = csvCell(e.target);
      if (!at) return;
      // Enter moves down like a spreadsheet (Shift+Enter: a line break inside the cell); Escape leaves the cell
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        $('fvBody').querySelector(`td[data-r="${at.r + 1}"][data-c="${at.c}"]`)?.focus();
      } else if (e.key === 'Escape') e.target.blur();
    });
    // Pasting a block copied from Excel / another table (tab-separated lines) fills the cells from here on.
    $('fvBody').addEventListener('paste', (e) => {
      const at = csvCell(e.target);
      if (!at || !viewing?.csv) return;
      const txt = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
      if (!/[\t\n]/.test(txt)) return;                     // a single value: the browser pastes it normally
      e.preventDefault();
      parseCsv(txt, '\t').forEach((line, i) => line.forEach((v, j) => setCsvCell(at.r + i, at.c + j, v)));
      csvChanged();
      renderCsvTable(at);
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's' && viewing?.csv && viewing.dirty) { e.preventDefault(); saveCsv(); }
    });
    window.addEventListener('beforeunload', (e) => { if (viewing?.dirty) { e.preventDefault(); e.returnValue = ''; } });

    // When Gemini edits a file that is open in the viewer, show the new version (unless there are unsaved
    // table edits: then say so and offer to reload).
    async function refreshOpenFile() {
      const v = viewing;
      if (!v || typeof v.text !== 'string') return;
      let d;
      try { d = await (await fetch(`/api/read?cwd=${encodeURIComponent(v.cwd)}&path=${encodeURIComponent(v.path)}`)).json(); } catch { return; }
      if (viewing !== v || !d || d.error || d.binary || d.tooBig || d.mtime === v.mtime) return;
      if (v.dirty) return updateCsvState({cls: 'warn', html: 'This file changed on disk (Gemini may have edited it). <button data-a="reload">Reload</button> <button data-a="overwrite">Keep mine</button>'});
      const body = $('fvBody'), sc = body.querySelector('.csv-scroll'), keep = [body.scrollTop, sc?.scrollTop, sc?.scrollLeft];
      v.text = d.text.replace(/\r\n?/g, '\n'); v.eol = /\r\n/.test(d.text) ? '\r\n' : '\n'; v.mtime = d.mtime;
      renderFileBody(v.mode);
      body.scrollTop = keep[0];
      const sc2 = body.querySelector('.csv-scroll'); if (sc2 && keep[1] != null) { sc2.scrollTop = keep[1]; sc2.scrollLeft = keep[2]; }
      if (v.csv) updateCsvState({cls: 'ok', html: 'Updated from disk'});
    }

    async function viewFile(p, cwd, line) {
      cwd = cwd || $('cwd').value.trim();
      const abs = absPath(p, cwd);
      // unsaved table edits are not dropped silently
      if (viewing?.dirty && !samePath(viewing.path, abs) && !confirm(`Discard your unsaved changes to ${baseName(viewing.path)}?`)) return;
      if (!$('diffPanel').classList.contains('open') || panelTab !== 'files') openFiles();
      if (!openTabs.some(t => samePath(t.path, abs))) {
        const at = viewing ? openTabs.findIndex(t => samePath(t.path, viewing.path)) + 1 : openTabs.length;
        openTabs.splice(at, 0, {path: abs, cwd});
      }
      viewing = {path: abs, cwd, rel: relPath(abs, cwd)};
      renderTabs(); markActiveRow(); revealInTree(abs, cwd);
      saveTabsState();
      if ($('filesBody').classList.contains('narrow')) $('filesBody').dataset.sideOpen = '';
      fitFilesLayout();
      $('fvEmpty').hidden = true; $('fvHead').hidden = false; $('fvBody').hidden = false;
      $('fvMode').hidden = true; $('fvWrap').hidden = true;
      wrapLines = false;
      clearFind();
      const body = $('fvBody');
      body.scrollTop = 0;
      const name = baseName(abs);
      if (IMG_RE.test(name)) {
        body.innerHTML = '<div class="img-view"><img alt=""></div>';
        const img = body.querySelector('img');
        img.onerror = () => fvMessage('Could not load this image.', true);
        img.onclick = () => showImage(img.src);
        img.src = '/api/file?path=' + encodeURIComponent(abs) + '&cwd=' + encodeURIComponent(cwd);
        return;
      }
      body.innerHTML = '<div class="fmsg">Opening…</div>';
      let d;
      try {
        const res = await fetch(`/api/read?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(abs)}`);
        d = res.status === 404 ? {error: 'Viewing files needs the updated server: stop gemini-ui (Ctrl+C) and start it again'} : await res.json();
      } catch (e) { d = {error: 'Could not reach the server'}; }
      if (!viewing || viewing.path !== abs) return;      // another file was opened meanwhile
      if (d.error) return fvMessage(d.error + '.');
      if (d.tooBig) return fvMessage(`This file is too large to show here (${fmtSize(d.size)}).`, true);
      if (d.binary) return fvMessage(`This is a binary file (${fmtSize(d.size)}).`, true);
      viewing.text = d.text.replace(/\r\n?/g, '\n');
      viewing.eol = /\r\n/.test(d.text) ? '\r\n' : '\n';      // kept when the table is saved
      viewing.mtime = d.mtime;
      // Markdown has a Preview, CSV/TSV a Table; the button switches between that and the source
      const md = /\.(md|markdown|mdx)$/i.test(name), csv = CSV_RE.test(name);
      viewing.alt = md ? 'preview' : csv ? 'table' : null;
      $('fvMode').hidden = !viewing.alt;
      const altFirst = md ? store.get('gui.mdPreview', true) : csv ? store.get('gui.csvTable', true) : false;
      renderFileBody(viewing.alt && !line && altFirst ? viewing.alt : 'source', line);
    }
    function fvMessage(msg, offerOpen) {
      $('fvBody').innerHTML = `<div class="fmsg">${esc(msg)}${offerOpen ? '<br><button>Open in default app</button>' : ''}</div>`;
      const b = $('fvBody').querySelector('button');
      if (b) b.onclick = () => openWith(viewing.path, viewing.cwd, 'default');
    }
    let wrapLines = false;
    function renderFileBody(mode, line) {
      const body = $('fvBody'), text = viewing.text;
      viewing.mode = mode;
      $('fxTabs').querySelector('.fx-tab.on')?.scrollIntoView({block: 'nearest', inline: 'nearest'});   // after Preview/Wrap appear and narrow the tab strip
      $('fvMode').textContent = mode === viewing.alt ? 'Source' : viewing.alt === 'table' ? 'Table' : 'Preview';
      $('fvWrap').hidden = mode === 'preview' || mode === 'table';
      $('fvWrap').classList.toggle('on', wrapLines);
      body.classList.toggle('nowrap', !wrapLines);
      body.classList.toggle('table-mode', mode === 'table');
      if (mode === 'table') { clearFind(); return renderCsvTable(); }
      if (mode === 'preview') {
        body.innerHTML = `<div class="md-view md">${renderMarkdown(text)}</div>`;
        highlight(body);
        return refreshFind();
      }
      const lang = langFor(viewing.path);
      let html = null;
      if (lang && text.length < 500000) { try { html = hljs.highlight(text, {language: lang, ignoreIllegals: true}).value; } catch {} }
      if (html == null) html = esc(text);
      const lines = splitHtmlLines(html);
      if (text.endsWith('\n') && lines.length > 1) lines.pop();
      body.style.setProperty('--gutter', (String(lines.length).length + 2.4) + 'ch');
      body.innerHTML = '<pre class="fcode hljs">' + lines.map((l, i) =>
        `<span class="l${line === i + 1 ? ' hit' : ''}"><span class="n">${i + 1}</span><span class="c">${l || ' '}</span></span>`).join('') + '</pre>';
      if (line) body.querySelectorAll('.l')[line - 1]?.scrollIntoView({block: 'center'});
      refreshFind();
      markFileGutter();
    }

    // VS Code-style git gutter markers on the left of each changed line in the file viewer:
    // green (git-add) = added line, blue (git-mod) = modified line, red (git-del) = deleted line(s).
    function parseGutterDiff(diffText) {
      const map = new Map();
      if (!diffText || !diffText.trim()) return map;
      const touch = (no) => { if (!map.has(no)) map.set(no, {add: false, mod: false, del: false, delCount: 0}); return map.get(no); };
      const lines = diffText.split('\n');
      if (!lines.some(l => l.startsWith('@@ ')) && lines.some(l => l.startsWith('+++ '))) {
        let no = 1, started = false;
        lines.forEach(l => {
          if (l.startsWith('+++ ')) { started = true; return; }
          if (!started || l.startsWith('\\')) return;
          if (l[0] === '+') touch(no++).add = true;
        });
        return map;
      }
      let newNo = 1, inHunk = false, dels = 0, adds = [];
      const flush = () => {
        if (!dels && !adds.length) return;
        if (!dels) {
          adds.forEach(n => { touch(n).add = true; });
        } else if (!adds.length) {
          const at = Math.max(1, newNo - 1);
          const g = touch(at); g.del = true; g.delCount += dels;
        } else {
          const modN = Math.min(dels, adds.length);
          for (let i = 0; i < modN; i++) touch(adds[i]).mod = true;
          for (let i = modN; i < adds.length; i++) touch(adds[i]).add = true;
          if (dels > adds.length) {
            const g = touch(adds[adds.length - 1]); g.del = true; g.delCount += (dels - adds.length);
          }
        }
        dels = 0; adds = [];
      };
      lines.forEach(line => {
        const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (h) { flush(); newNo = +h[2]; inHunk = true; return; }
        if (!inHunk || line.startsWith('\\') || line === '') return;
        if (line[0] === '-') dels++;
        else if (line[0] === '+') adds.push(newNo++);
        else { flush(); newNo++; }
      });
      flush();
      return map;
    }
    async function markFileGutter() {
      const v = viewing;
      if (!v || v.mode !== 'source') return;
      const code = $('fvBody')?.querySelector('pre.fcode');
      if (!code) return;
      const rel = String(v.rel || '').replace(/\\/g, '/').replace(/\/$/, '');
      if (!rel || isAbs(rel) || rel.startsWith('..')) return;
      let diffText = '';
      try {
        const d = await (await fetch(`/api/diff?cwd=${encodeURIComponent(v.cwd)}&path=${encodeURIComponent(rel)}`)).json();
        diffText = d && !d.error ? (d.diff || '') : '';
      } catch { return; }
      if (viewing !== v || v.mode !== 'source') return;
      const map = parseGutterDiff(diffText);
      code.querySelectorAll('.l').forEach((row, i) => {
        const g = map.get(i + 1);
        row.classList.toggle('git-add', !!g?.add);
        row.classList.toggle('git-mod', !!g?.mod);
        row.classList.toggle('git-del', !!g?.del);
        const n = row.querySelector('.n');
        if (!n) return;
        if (g) {
          const parts = [];
          if (g.mod) parts.push('Modified line (blue)');
          if (g.add) parts.push('Added line (green)');
          if (g.del) parts.push(`${g.delCount} deleted line${g.delCount > 1 ? 's' : ''} (red)`);
          n.title = parts.join(' · ');
        } else {
          n.removeAttribute('title');
        }
      });
    }
    // click a line to mark it as the current line
    $('fvBody').addEventListener('click', (e) => {
      const l = e.target.closest('pre.fcode .l');
      if (!l || getSelection().toString()) return;
      $('fvBody').querySelector('.l.cur')?.classList.remove('cur');
      l.classList.add('cur');
    });

    // ---- add a selection to the prompt: select code in the viewer, then "Add to chat" (or Ctrl+Shift+L) ----
    const addSelBtn = document.createElement('button');
    addSelBtn.className = 'add-sel'; addSelBtn.hidden = true;
    addSelBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Add to chat<kbd>Ctrl+Shift+L</kbd>';
    document.body.appendChild(addSelBtn);
    // What is selected in the viewer: whole lines in the source view, the plain text in the Markdown preview.
    function viewerSelection() {
      const s = getSelection();
      if (!viewing || typeof viewing.text !== 'string' || !s.rangeCount || s.isCollapsed) return null;
      const body = $('fvBody'), r = s.getRangeAt(0);
      if (!body.contains(r.commonAncestorContainer)) return null;
      const rows = [...body.querySelectorAll('pre.fcode .l')];
      if (rows.length) {
        const rowOf = (node) => (node.nodeType === 1 ? node : node.parentElement)?.closest('.l');
        let a = rows.indexOf(rowOf(r.startContainer)), b = rows.indexOf(rowOf(r.endContainer));
        if (a < 0) a = 0;
        if (b < 0) b = rows.length - 1;
        // a selection that ends at the very start of a line does not include that line
        if (b > a) {
          const head = document.createRange();
          head.setStart(rows[b].querySelector('.c') || rows[b], 0);
          head.setEnd(r.endContainer, r.endOffset);
          if (!head.toString()) b--;
        }
        const text = viewing.text.split('\n').slice(a, b + 1).join('\n');
        if (!text.trim()) return null;
        return selectionAttachment(viewing.path, a === b ? String(a + 1) : `${a + 1}-${b + 1}`, text);
      }
      const text = s.toString().trim();
      return text ? selectionAttachment(viewing.path, '', text) : null;
    }
    function placeAddSel() {
      const s = getSelection();
      const sel = !s.isCollapsed && s.rangeCount && $('fvBody').contains(s.getRangeAt(0).commonAncestorContainer) ? s.getRangeAt(0) : null;
      if (!sel || !viewerSelection()) { addSelBtn.hidden = true; return; }
      const rects = [...sel.getClientRects()].filter(x => x.width || x.height);
      const end = rects[rects.length - 1] || sel.getBoundingClientRect();
      const box = $('fvBody').getBoundingClientRect();
      addSelBtn.hidden = false;
      const w = addSelBtn.offsetWidth, h = addSelBtn.offsetHeight;
      let top = end.bottom + 6;
      if (top + h > box.bottom - 4) top = Math.max(box.top + 4, (rects[0] || end).top - h - 6);   // no room below: go above
      addSelBtn.style.top = Math.min(Math.max(top, box.top + 4), box.bottom - h - 4) + 'px';
      addSelBtn.style.left = Math.min(Math.max(end.right - w, box.left + 6), box.right - w - 6) + 'px';
    }
    function addViewerSelection() {
      const f = viewerSelection();
      if (!f) return false;
      addAttachment(f);
      getSelection().removeAllRanges();
      addSelBtn.hidden = true;
      $('input').focus();
      return true;
    }
    addSelBtn.addEventListener('mousedown', (e) => e.preventDefault());   // keep the selection while clicking
    addSelBtn.onclick = addViewerSelection;
    // show it once the mouse is let go, not while the selection is still being dragged out
    let selDragging = false;
    $('fvBody').addEventListener('pointerdown', () => { selDragging = true; addSelBtn.hidden = true; });
    window.addEventListener('pointerup', () => { if (selDragging) { selDragging = false; requestAnimationFrame(placeAddSel); } });
    document.addEventListener('selectionchange', () => { if (!selDragging) requestAnimationFrame(placeAddSel); });
    $('fvBody').addEventListener('scroll', () => { if (!addSelBtn.hidden) placeAddSel(); }, {passive: true});
    window.addEventListener('resize', () => { if (!addSelBtn.hidden) placeAddSel(); });
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l' && addViewerSelection()) e.preventDefault();
    });

    $('fvMode').onclick = () => {
      if (typeof viewing?.text !== 'string' || !viewing.alt) return;
      const next = viewing.mode === viewing.alt ? 'source' : viewing.alt;
      store.set(viewing.alt === 'table' ? 'gui.csvTable' : 'gui.mdPreview', next === viewing.alt);
      // the source view shows the edits too (and the table keeps its rows, so the edits stay marked)
      if (viewing.csv && viewing.dirty) viewing.text = viewing.csv.src = csvText();
      renderFileBody(next);
    };
    $('fvWrap').onclick = () => {
      wrapLines = !wrapLines; store.set('gui.fvWrap', wrapLines);
      $('fvWrap').classList.toggle('on', wrapLines);
      $('fvBody').classList.toggle('nowrap', !wrapLines);
    };
    $('fvMore').onclick = (e) => {
      e.stopPropagation();
      if (!viewing) return;
      const b = e.currentTarget.getBoundingClientRect();
      openFileMenu(b.right, b.bottom + 4, {path: viewing.path, cwd: viewing.cwd, inViewer: true}, null, true);
    };

    // ---- find in file (CSS highlights, so the code's own markup is never touched) ----
    let findRanges = [], findIdx = 0;
    function clearFind() {
      findRanges = []; findIdx = 0;
      try { CSS.highlights.delete('fv-find'); CSS.highlights.delete('fv-find-cur'); } catch {}
      $('fvFindCount').textContent = '';
    }
    function openFind() {
      if (!viewing) return;
      $('fvFindBar').hidden = false;
      const sel = getSelection().toString();
      if (sel && !sel.includes('\n') && $('fvBody').contains(getSelection().anchorNode)) $('fvFindInput').value = sel;
      $('fvFindInput').focus(); $('fvFindInput').select();
      refreshFind();
    }
    function closeFind() { $('fvFindBar').hidden = true; clearFind(); $('fvBody').focus(); }
    function refreshFind(keepPlace) {
      const q = $('fvFindBar').hidden ? '' : $('fvFindInput').value;
      const prev = findIdx;
      clearFind();
      if (!q || !window.Highlight) return;
      const ql = q.toLowerCase();
      // each code line (or the whole markdown preview) is searched as one string, then mapped back to text nodes
      const blocks = $('fvBody').querySelectorAll('pre.fcode .c, .md-view, .fmsg, .csv-table td[data-r]');
      blocks.forEach(b => {
        const nodes = [], walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
        let all = '';
        for (let n; (n = walker.nextNode());) { nodes.push([n, all.length]); all += n.nodeValue; }
        const low = all.toLowerCase();
        const at = (off) => { let k = nodes.length - 1; while (k > 0 && nodes[k][1] > off) k--; return [nodes[k][0], off - nodes[k][1]]; };
        for (let i = low.indexOf(ql); i >= 0 && findRanges.length < 5000; i = low.indexOf(ql, i + ql.length)) {
          const r = new Range();
          const [sn, so] = at(i), [en, eo] = at(i + ql.length - 1);
          r.setStart(sn, so); r.setEnd(en, eo + 1);
          findRanges.push(r);
        }
      });
      try { CSS.highlights.set('fv-find', new Highlight(...findRanges)); } catch {}
      findIdx = keepPlace ? Math.min(prev, findRanges.length - 1) : 0;
      showFindCurrent(!keepPlace);
    }
    function showFindCurrent(scroll = true) {
      const n = findRanges.length;
      $('fvFindCount').textContent = $('fvFindInput').value ? (n ? `${findIdx + 1} of ${n}` : 'No results') : '';
      if (!n) return;
      try { CSS.highlights.set('fv-find-cur', new Highlight(findRanges[findIdx])); } catch {}
      if (scroll) {
        // the table scrolls inside its own box
        const box = $('fvBody').querySelector('.csv-scroll') || $('fvBody'), rr = findRanges[findIdx].getBoundingClientRect(), br = box.getBoundingClientRect();
        if (rr.top < br.top + 30 || rr.bottom > br.bottom - 30) box.scrollTop += rr.top - br.top - br.height / 2;
        if (rr.left < br.left || rr.right > br.right) box.scrollLeft += rr.left - br.left - br.width / 2;
      }
    }
    function stepFind(d) {
      if (!findRanges.length) return;
      findIdx = (findIdx + d + findRanges.length) % findRanges.length;
      showFindCurrent();
    }
    $('fxFind').onclick = () => $('fvFindBar').hidden ? openFind() : closeFind();
    $('fvFindInput').addEventListener('input', () => refreshFind());
    $('fvFindInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
    });
    $('fvFindPrev').onclick = () => stepFind(-1);
    $('fvFindNext').onclick = () => stepFind(1);
    $('fvFindClose').onclick = closeFind;
    // Ctrl+F finds in the open file while you are working in the Files view; elsewhere the browser keeps it.
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f' || e.shiftKey || e.altKey) return;
      if (panelTab !== 'files' || !viewing || !$('diffPanel').classList.contains('open')) return;
      if (!$('filesBody').contains(document.activeElement) && !$('filesBody').matches(':hover')) return;
      e.preventDefault();
      openFind();
    });

    async function openWith(p, cwd, how) {
      try {
        const res = await fetch('/api/open', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({cwd, path: p, how})});
        if (res.status === 404) return alert('This needs the updated server: stop gemini-ui (Ctrl+C) and start it again.');
        const d = await res.json();
        if (d.error) alert(d.error);
      } catch (e) { alert('Could not reach the server. Is gemini-ui running?'); }
    }

    // Paths Gemini writes as `inline code` become links when they are real files or folders in the working folder.
    const refCache = new Map();           // "cwd|text" -> {hit, at}
    // ---- images in replies ----
    const imgFileUrl = (path) => '/api/file?path=' + encodeURIComponent(path) + '&cwd=' + encodeURIComponent($('cwd').value.trim());
    // Where a picture the reply names could be: as written if absolute, else in the project folder, else in the
    // app's uploads folder (Gemini sees that folder as a workspace called "uploads", so it writes "uploads/x.png").
    function localImagePaths(ref) {
      let p = String(ref || '').replace(/^file:\/+/i, '');
      try { p = decodeURI(p); } catch {}
      if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\')) return [p];
      p = p.replace(/^\.[\\/]/, '');
      const out = [];
      const cwd = $('cwd').value.trim().replace(/[\\/]+$/, '');
      if (cwd) out.push(cwd + '/' + p);
      if (appInfo.home) {
        const up = appInfo.home.replace(/[\\/]+$/, '') + '/.gemini-ui/uploads/';
        out.push(up + p.replace(/^uploads[\\/]/i, ''));
        if (/^uploads[\\/]/i.test(p)) out.push(up + p);
      }
      return out.length ? out : [p];
    }
    function zoomable(img) { img.onclick = () => showImage(img.src); return img; }
    function showChatImages(root) {
      root.querySelectorAll('img.chat-img').forEach(img => {
        zoomable(img);
        if (!img.dataset.local || img.getAttribute('src')) return;
        const tries = localImagePaths(img.dataset.local);
        const next = () => {
          const path = tries.shift();
          if (!path) {
            const note = document.createElement('span');
            note.className = 'note'; note.textContent = 'Image not found: ' + img.dataset.local;
            img.replaceWith(note);
            return;
          }
          img.dataset.fpath = path;
          img.src = imgFileUrl(path);
        };
        img.onload = () => img.classList.remove('img-wait');
        img.onerror = next;
        next();
      });
      linkFileRefs(root);        // also lists the image files the reply mentions (see imageStrip)
    }
    // image files the reply mentions by name (e.g. `evidence/01_capture.png`) get a preview under it
    function imageStrip(root) {
      if (root.dataset.imgs !== '1' || !root.isConnected) return;
      root.querySelector(':scope > .chat-imgs')?.remove();
      const shown = new Set([...root.querySelectorAll('img.chat-img[data-fpath]')].map(i => i.dataset.fpath.replace(/\\/g, '/').toLowerCase()));
      const paths = [];
      root.querySelectorAll('code.fileref[data-fpath]:not([data-fdir])').forEach(c => {
        const f = c.dataset.fpath;
        const key = f.replace(/\\/g, '/').toLowerCase();
        if (IMG_RE.test(f) && !shown.has(key)) { shown.add(key); paths.push(f); }
      });
      if (!paths.length) return;
      const strip = document.createElement('div');
      strip.className = 'chat-imgs';
      paths.slice(0, 12).forEach(f => {
        const fig = document.createElement('figure');
        const img = zoomable(document.createElement('img'));
        img.alt = baseName(f); img.loading = 'lazy';
        img.className = 'img-wait';
        img.onload = () => img.classList.remove('img-wait');
        img.onerror = () => { fig.remove(); if (!strip.childElementCount) strip.remove(); };
        img.src = imgFileUrl(f);
        const cap = document.createElement('figcaption');
        cap.textContent = baseName(f); cap.title = f;
        fig.append(img, cap);
        strip.appendChild(fig);
      });
      root.appendChild(strip);
    }
    function linkFileRefs(root) {
      clearTimeout(root._refTimer);
      root._refTimer = setTimeout(() => {
        const cwd = $('cwd').value.trim();
        if (!cwd || !root.isConnected) return;
        const want = new Map();
        // the icon in front of a name: the folder icon, or the file's type badge (as in the file tree)
        const decorate = (c, text, dir) => {
          if (c.querySelector(':scope > .fi')) return;
          // a long path is cut to its last part, the file or folder name (a ":12" line number stays); the full path
          // is in the tooltip
          const tn = [...c.childNodes].find(n => n.nodeType === 3);
          if (tn && text.length > 30 && /[\\/]/.test(text.replace(/[\\/]+$/, ''))) {
            const m = tn.textContent.trim().match(/^(.*?)((?::\d+){1,2})?$/);
            tn.textContent = baseName(m[1]) + (m[2] || '');
            c.title = (c.title ? c.title + '\n' : '') + text;
          }
          const s = document.createElement('span'); s.className = 'fi';
          s.innerHTML = dir ? ICON_FOLDER : fileIcon(baseName(text));
          c.prepend(s);
          // a chip never splits in the middle (CSS: nowrap); one wider than its line wraps inside its own box instead
          requestAnimationFrame(() => {
            const host = c.parentElement;
            if (host && host.clientWidth && c.getBoundingClientRect().width > host.clientWidth - 4) c.classList.add('flong');
          });
        };
        // A name that is not in this folder still gets the icon (dashed, dimmer) when it clearly is a path:
        // a file with a known type, or something that starts like a path ("./x", "~/x", "C:\x") or has two parts.
        const KNOWN_EXT = /\.(csv|tsv|pdf|zip|docx?|xlsx?|pptx?|robot|resource|properties|gradle|mp4|mp3|wav|wasm|ipynb|webp|ico)$/i;
        const looksLikePath = (t) => /\.[A-Za-z0-9]{1,8}$/.test(t)
          ? /[\\/]/.test(t) || (!/^(console|window|document|logger|log|self|this)\./i.test(t)     // code, not files
            && (FTYPES.some(([re]) => re.test(t)) || IMG_RE.test(t) || KNOWN_EXT.test(t)))
          : /^([A-Za-z]:|\.{1,2}[\\/]|~|[\\/])/.test(t) || (t.match(/[\\/]/g) || []).length >= 2 || /[\\/]$/.test(t);
        const apply = (c, hit, line, text) => {
          if (!hit) {
            if (looksLikePath(text)) {
              c.classList.add('fmiss'); c.title = 'Not found in this folder';
              decorate(c, text, /[\\/]$/.test(text) || !/\.[A-Za-z0-9]{1,8}$/.test(text));
            }
            return;
          }
          c.classList.add('fileref');
          c.dataset.fpath = hit.path; c.dataset.fcwd = cwd;
          if (hit.dir) c.dataset.fdir = '1';
          if (line) c.dataset.fline = line;
          // a name found in a folder below (the reply gave no path) says where: "Open OmsLib/envData/x.json"
          c.title = (hit.rel ? (hit.dir ? 'Show ' : 'Open ') + hit.rel + (hit.matches > 1 ? ` (the nearest of ${hit.matches} with this name)` : '')
            : (hit.dir ? 'Show this folder' : 'Open this file')) + ' · right-click for more';
          decorate(c, text, !!hit.dir);
        };
        root.querySelectorAll('code').forEach(c => {
          if (c.closest('pre') || c.classList.contains('fileref') || c.classList.contains('fmiss')) return;
          const t = c.textContent.trim();
          if (t.length > 260 || /^\w+:\/\//.test(t)) return;
          const m = t.match(/^((?:[A-Za-z]:)?[^\s:*?"<>|]+)(?::(\d+)(?::\d+)?)?$/);
          if (!m) return;
          const p = m[1];
          if (!(/[\\/]/.test(p) || /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(p)) || /^[\d.]+$/.test(p)) return;
          const cached = refCache.get(cwd + '|' + p);
          if (cached && (cached.hit || Date.now() - cached.at < 5000)) return apply(c, cached.hit, m[2], p);
          if (!want.has(p)) want.set(p, []);
          want.get(p).push([c, m[2]]);
        });
        if (!want.size) return imageStrip(root);
        fetch('/api/stat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({cwd, paths: [...want.keys()]})})
          .then(r => r.ok ? r.json() : {})
          .then(found => want.forEach((list, p) => {
            const hit = found[p] || null;
            refCache.set(cwd + '|' + p, {hit, at: Date.now()});
            list.forEach(([c, line]) => apply(c, hit, line, p));
          }))
          .then(() => imageStrip(root))
          .catch(() => {});
      }, 400);
    }
    document.addEventListener('click', (e) => {
      const c = e.target.closest('code.fileref');
      if (!c) return;
      e.preventDefault();
      if (c.dataset.fdir === '1') revealFolder(c.dataset.fpath, c.dataset.fcwd);
      else viewFile(c.dataset.fpath, c.dataset.fcwd, +c.dataset.fline || 0);
    });

    // ---------- file menu (right-click) ----------
    const fileMenu = document.createElement('div');
    fileMenu.className = 'chatmenu fmenu';
    document.body.appendChild(fileMenu);
    let fileMenuRow = null;
    function fetchAppInfo() {
      fetch('/api/info?cwd=' + encodeURIComponent($('cwd').value.trim() || '')).then(r => r.json()).then(i => {
        appInfo = i || {};
        showUser(appInfo.user);
        if (appInfo.branch !== undefined) updateBranch(appInfo.branch || '');
      }).catch(() => {});
    }
    let appInfo = {};
    fetchAppInfo();

    $('branchPill').onclick = async () => {
      await fetchBranch();
      const b = $('branchLabel').textContent.trim();
      if (b) {
        await copyText(b);
        toast('Copied branch: ' + b);
      }
    };
    window.addEventListener('focus', () => { fetchBranch(); loadChanges(true); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { fetchBranch(); loadChanges(true); }
    });
    setInterval(() => {
      if (document.visibilityState === 'visible' && !busy) fetchBranch();
    }, 8000);
    // the signed-in account, shown in Settings navigation sidebar
    function showUser(u) {
      if (!u || !(u.name || u.email)) return;
      const name = u.name || u.email;
      $('whoName').textContent = name;
      $('who').title = u.email ? 'Signed in as ' + name + ' (' + u.email + ')' : 'Signed in as ' + name;
      $('accountSec').hidden = false;
    }
    function closeFileMenu() {
      fileMenu.classList.remove('open');
      fileMenuRow?.classList.remove('menu-open');
      fileMenuRow = null;
    }
    const MI = {
      view: lineIcon('eye'),
      attach: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11.5l-7 7a4.5 4.5 0 0 1-6.4-6.4l7.5-7.5a3 3 0 0 1 4.2 4.2L9.7 16.3a1.5 1.5 0 0 1-2.1-2.1l6.6-6.6" /></svg>',
      copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" /><path d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" /></svg>',
      open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M10 5H6a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 6 19h11a1.5 1.5 0 0 0 1.5-1.5V14M13.5 4.5h6v6M19.5 4.5l-8 8" /></svg>',
      reveal: lineIcon('folderOpen'),
    };
    function openFileMenu(x, y, ref, row, alignRight) {
      closeFileMenu();
      closeChatMenu();
      const cwd = ref.cwd || $('cwd').value.trim();
      const abs = absPath(ref.path, cwd), rel = relPath(abs, cwd), name = baseName(abs);
      const item = (a, label, icon = '', off = false) => `<button data-a="${a}"${off ? ' disabled' : ''}>${icon}<span>${esc(label)}</span></button>`;
      const inside = !isAbs(rel);                          // relative path only makes sense inside the folder
      fileMenu.innerHTML =
        (ref.inViewer ? '' : ref.dir ? item('show', 'Show in Files', MI.view) : item('view', 'Open in viewer', MI.view))
        + item('attach', 'Attach as context', MI.attach)
        + `<div class="sub"><button>${MI.copy}<span>Copy</span></button><div class="flyout">`
        + item('abs', 'Absolute path') + item('rel', 'Relative path', '', !inside) + item('name', ref.dir ? 'Folder name' : 'File name')
        + '</div></div><hr>'
        + `<div class="sub"><button>${MI.open}<span>Open in</span></button><div class="flyout">`
        + (ref.dir ? '' : item('default', 'Default app')) + item('vscode', 'VS Code', '', appInfo.vscode === false)
        + '</div></div>'
        + item('reveal', appInfo.platform === 'darwin' ? 'Show in Finder' : 'Show in Explorer', MI.reveal);
      fileMenu.onclick = async (e) => {
        e.stopPropagation();
        const sub = e.target.closest('.sub > button');
        if (sub) return sub.parentElement.classList.toggle('open');
        const b = e.target.closest('button[data-a]');
        if (!b) return;
        const a = b.dataset.a;
        if (a === 'abs' || a === 'rel' || a === 'name') {
          const ok = await copyText(a === 'abs' ? abs : a === 'rel' ? rel : name);
          b.querySelector('span').textContent = ok ? 'Copied ✓' : 'Could not copy';
          return setTimeout(closeFileMenu, 600);
        }
        closeFileMenu();
        if (a === 'view') viewFile(abs, cwd);
        else if (a === 'show') revealFolder(abs, cwd);
        else if (a === 'attach') { addAttachment({path: abs, name}); $('input').focus(); }
        else openWith(abs, cwd, a);
      };
      fileMenuRow = row;
      row?.classList.add('menu-open');
      fileMenu.classList.add('open');
      const w = fileMenu.offsetWidth, h = fileMenu.offsetHeight;
      const left = Math.max(8, Math.min(alignRight ? x - w : x, innerWidth - w - 8));
      fileMenu.style.left = left + 'px';
      fileMenu.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
      fileMenu.classList.toggle('flip', left + w + 170 > innerWidth);     // submenus open to the left near the edge
    }
    document.addEventListener('contextmenu', (e) => {
      const el = e.target.closest('[data-fpath]');
      if (!el || e.target.closest('input, textarea')) return;
      e.preventDefault();
      openFileMenu(e.clientX, e.clientY, {path: el.dataset.fpath, cwd: el.dataset.fcwd, dir: el.dataset.fdir === '1'},
        el.classList.contains('frow') ? el : null);
    });
    document.addEventListener('mousedown', (e) => { if (fileMenu.classList.contains('open') && !e.target.closest('.fmenu')) closeFileMenu(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && fileMenu.classList.contains('open')) { e.stopPropagation(); closeFileMenu(); } }, true);
    document.addEventListener('scroll', (e) => { if (!e.target.closest?.('.fmenu')) closeFileMenu(); }, true);
    window.addEventListener('resize', closeFileMenu);

