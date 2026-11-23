    // ---------- sending ----------
    // attach: {runId, prompt} of a run that is already going on the server (e.g. after a reload). Its user
    // message is already on screen; the reply is rebuilt from all of the run's events, then continues live.
    // ---------- folder access ----------
    // Gemini's rules may use folders outside the project (~/.gemini/memory, ~/.gemini/scratch). The first
    // time a chat starts in a folder, ask which of them Gemini may use there; the server then adds the
    // allowed ones to its workspace on every run. Settings → Folder access changes the answer later.
    // a short message at the bottom of the window that fades away
    function toast(text) {
      let t = document.querySelector('.toast');
      if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
      t.textContent = text;
      t.classList.add('on');
      clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 3200);
    }
    const accessChecked = new Set();
    let accessOpen = null;
    function accessDialog(cwd, dirs, manage) {
      return new Promise((resolve) => {
        $('accTitle').textContent = manage ? 'Folders Gemini may use' : 'Allow Gemini to use these folders?';
        $('accProject').textContent = baseName(cwd) || cwd;
        $('accProject').title = cwd;
        $('accList').innerHTML = dirs.map((d, i) => `<label class="acc-item"><input type="checkbox" data-i="${i}"${manage ? (d.allowed ? ' checked' : '') : ' checked'}>`
          + `<svg><use href="#i-folder"/></svg><span>${esc(d.path)}</span></label>`).join('');
        $('accLater').textContent = manage ? 'Cancel' : 'Not now';
        $('accAllow').textContent = manage ? 'Save' : 'Allow';
        const done = async (save) => {
          $('accessModal').classList.remove('open');
          accessOpen = null;
          if (save !== null) {
            const boxes = [...$('accList').querySelectorAll('input')];
            const allow = save ? dirs.filter((_, i) => boxes[i].checked).map(d => d.path) : [];
            try {
              await fetch('/api/access', {method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({cwd, allow: manage && !save ? dirs.filter(d => d.allowed).map(d => d.path) : allow, offered: dirs.map(d => d.path)})});
            } catch { }
          }
          resolve();
        };
        // "Not now" records the answer (so it is not asked again); in Manage, Cancel changes nothing
        $('accLater').onclick = () => done(manage ? null : false);
        $('accAllow').onclick = () => done(true);
        accessOpen = () => done(manage ? null : false);
        $('accessModal').classList.add('open');
        $('accAllow').focus();
      });
    }
    $('accessModal').addEventListener('mousedown', (e) => { if (e.target === $('accessModal')) accessOpen?.(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && accessOpen) { e.stopPropagation(); accessOpen(); } }, true);
    // (No popup any more: Gemini asks for access to outside folders itself. Settings -> Folder access still lists them.)
    async function ensureFolderAccess() {}
    function manageFolderAccess() { toast('Gemini asks for access to outside folders itself'); }

    // ---------- "/" commands ----------
    // Typing "/" in the message box opens a menu of commands, filtered as you type (↑ ↓ to move, Tab or Enter to
    // pick, Esc to close). App commands run here in the page; Gemini commands (/init and your custom .toml
    // commands, listed by the server) are sent to Gemini, which expands them into their prompt.
    const APP_COMMANDS = [
      {name: 'whatsnew', desc: 'See what changed in the latest update', run: () => whatsNewDialog()},
      {name: 'find', args: '[text]', desc: 'Find text in this conversation', run: (a) => openChatFind(a)},
      {name: 'help', desc: 'List all commands', run: () => { $('input').value = '/'; autosize(); slashUpdate(); }},
      {name: 'new', desc: 'Start a new chat', alias: ['clear'], run: () => newChat()},
      {name: 'plan', args: '[task]', desc: 'Plan mode: Gemini only reads and writes a plan (with a task: plan it now)'},
      {name: 'auto-approve', desc: 'Mode: edit files and run commands without asking', alias: ['yolo'], run: () => setMode('yolo')},
      {name: 'auto-edit', desc: 'Mode: edit files without asking', run: () => setMode('auto_edit')},
      {name: 'model', args: '<model>', desc: 'Choose the model for the next messages',
        complete: () => [...$('model').options].map(o => ({value: o.value || 'auto', desc: o.text})),
        run: (a) => {
          const want = a.trim().toLowerCase();
          if (!want) { toast('Type a model after /model'); return; }
          const o = [...$('model').options].find(o => (o.value || 'auto').toLowerCase() === want || o.text.toLowerCase() === want);
          if (!o) { toast('No model called ' + a.trim()); return; }
          $('model').value = o.value; $('model').dispatchEvent(new Event('change', {bubbles: true}));
          toast('Model: ' + o.text);
        }},
      {name: 'directory', args: 'add <path> | list', desc: 'Let Gemini use a folder outside the project',
        complete: () => [{value: 'add ', desc: 'Allow a folder for this project'}, {value: 'list', desc: 'See and change the allowed folders'}],
        run: async (a) => {
          const m = a.trim().match(/^(add|list|show)\b\s*(.*)$/i);
          if (!m || m[1].toLowerCase() !== 'add') return manageFolderAccess();
          const cwd = $('cwd').value.trim(), dir = m[2].trim().replace(/^"(.*)"$/, '$1');
          if (!cwd) return toast('Choose a folder first');
          if (!dir) return toast('Type a folder after /directory add');
          let r;
          try { const res = await fetch('/api/access', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({cwd, add: dir})}); r = res.ok ? await res.json() : {error: 'Restart Gemini Studio to use this'}; }
          catch { r = {error: 'Could not reach the server'}; }
          toast(r.error || `Gemini can now use ${r.added} (from the next message)`);
        }},
      {name: 'files', desc: 'Open the file explorer', run: () => openFiles()},
      {name: 'changes', desc: 'Show the changed files', run: () => openChanges(panelFiles, panelCwd)},
      {name: 'copy', desc: "Copy Gemini's last reply", run: () => {
        const b = [...$('log').querySelectorAll('.msg.ai [data-a=copy]')].pop();
        if (b) { b.click(); toast('Copied the last reply'); } else toast('No reply to copy yet');
      }},
      {name: 'theme', desc: 'Switch between dark and light', run: () => {
        const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        store.set('gui.theme', t); applyTheme(t); syncThemeSeg();
      }},
      {name: 'settings', desc: 'Open Settings', run: () => setTimeout(openSettings)},
    ];
    // Gemini's own commands that work without its terminal UI
    const GEMINI_BUILTIN = [{name: 'init', desc: 'Analyze the project and create a tailored GEMINI.md', gemini: true}];
    let geminiCommands = [], commandsFor = null;
    async function loadCommands() {
      const cwd = $('cwd').value.trim();
      if (commandsFor === cwd) return;
      commandsFor = cwd;
      try {
        const r = await fetch('/api/commands?cwd=' + encodeURIComponent(cwd));
        const d = r.ok ? await r.json() : {};
        geminiCommands = (d.commands || []).map(c => ({name: c.name, desc: c.description || 'Custom command', args: c.args ? '<args>' : '', gemini: true, source: c.source}));
      } catch { geminiCommands = []; }
      if (!slashMenu.hidden) slashUpdate();
    }
    const allCommands = () => [...APP_COMMANDS, ...GEMINI_BUILTIN, ...geminiCommands];
    const findCommand = (name) => { const n = name.toLowerCase(); return allCommands().find(c => c.name.toLowerCase() === n || c.alias?.includes(n)); };

    const slashMenu = document.createElement('div');
    slashMenu.className = 'slash-menu'; slashMenu.hidden = true; slashMenu.setAttribute('role', 'listbox');
    document.querySelector('.composer').appendChild(slashMenu);
    let slashItems = [], slashHi = 0, slashCtx = null;
    function slashClose() { slashMenu.hidden = true; slashItems = []; slashCtx = null; }
    function slashUpdate() {
      const v = $('input').value, caret = $('input').selectionStart;
      const m = v.match(/^\/([^\s]*)(\s+([\s\S]*))?$/);
      if (!m || v.includes('\n') || caret === 0) return slashClose();
      loadCommands();
      let items;
      if (m[2] === undefined) {
        // still typing the command name
        const q = m[1].toLowerCase();
        const all = allCommands();
        items = all.filter(c => c.name.toLowerCase().startsWith(q) || c.alias?.some(a => a.startsWith(q)))
          .concat(q ? all.filter(c => !c.name.toLowerCase().startsWith(q) && !c.alias?.some(a => a.startsWith(q)) && c.name.toLowerCase().includes(q)) : []);
        slashCtx = {kind: 'cmd'};
        items = items.map(c => ({cmd: c, label: '/' + c.name, hint: c.args || '', desc: c.desc, tag: c.gemini ? (c.source && c.source !== 'user' && c.source !== 'project' ? c.source : 'Gemini') : ''}));
      } else {
        // after the command: its argument choices, if it has any
        const c = findCommand(m[1]);
        if (!c?.complete) return slashClose();
        const q = (m[3] || '').toLowerCase();
        items = c.complete().filter(o => o.value.toLowerCase().startsWith(q) && o.value.toLowerCase() !== q)
          .map(o => ({arg: o.value, cmd: c, label: o.value.trim(), desc: o.desc}));
        slashCtx = {kind: 'arg', cmd: c};
      }
      if (!items.length) return slashClose();
      slashItems = items.slice(0, 50);
      slashHi = Math.min(slashHi, slashItems.length - 1);
      slashMenu.innerHTML = slashItems.map((it, i) => `<div class="sm-item${i === slashHi ? ' hi' : ''}" role="option" data-i="${i}">`
        + `<span class="sm-name">${esc(it.label)}</span>${it.hint ? `<span class="sm-args">${esc(it.hint)}</span>` : ''}`
        + `<span class="sm-desc">${esc(it.desc || '')}</span>${it.tag ? `<span class="sm-tag">${esc(it.tag)}</span>` : ''}</div>`).join('');
      slashMenu.hidden = false;
      slashMenu.querySelector('.hi')?.scrollIntoView({block: 'nearest'});
    }
    function slashMove(d) {
      slashHi = (slashHi + d + slashItems.length) % slashItems.length;
      slashMenu.querySelectorAll('.sm-item').forEach((el, i) => el.classList.toggle('hi', i === slashHi));
      slashMenu.querySelector('.hi')?.scrollIntoView({block: 'nearest'});
    }
    // pick: fill it in; with Enter, a command that needs nothing more runs right away
    function slashPick(i, run) {
      const it = slashItems[i]; if (!it) return;
      const inp = $('input');
      if (slashCtx.kind === 'arg') inp.value = `/${it.cmd.name} ${it.arg}`;
      else inp.value = '/' + it.cmd.name + (it.cmd.args || it.cmd.complete ? ' ' : '');
      autosize(); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
      slashHi = 0; slashClose();
      if (run && !inp.value.endsWith(' ')) send();          // nothing more to type: run it
      else slashUpdate();                                   // e.g. /model → its choices
    }
    slashMenu.addEventListener('mousedown', (e) => e.preventDefault());     // keep the focus in the message box
    slashMenu.addEventListener('click', (e) => { const el = e.target.closest('.sm-item'); if (el) slashPick(+el.dataset.i, true); });
    slashMenu.addEventListener('mousemove', (e) => {
      const el = e.target.closest('.sm-item'); if (!el || +el.dataset.i === slashHi) return;
      slashHi = +el.dataset.i; slashMenu.querySelectorAll('.sm-item').forEach((x, i) => x.classList.toggle('hi', i === slashHi));
    });
    $('input').addEventListener('input', () => { slashHi = 0; slashUpdate(); });
    $('input').addEventListener('click', slashUpdate);
    $('input').addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $('input')) slashClose(); }, 120));
    $('input').addEventListener('keydown', (e) => {
      if (slashMenu.hidden || e.isComposing) return;
      const k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') slashMove(k === 'ArrowDown' ? 1 : -1);
      else if ((k === 'Tab' && !e.shiftKey) || (k === 'Enter' && !e.shiftKey)) {
        // Enter on a command already typed out in full just sends it
        const typed = $('input').value.trim().slice(1).toLowerCase();
        if (k === 'Enter' && slashCtx?.kind === 'cmd' && findCommand(typed)) { slashClose(); return; }
        slashPick(slashHi, k === 'Enter');
      } else if (k === 'Escape') slashClose();
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
    $('cwd').addEventListener('change', () => { commandsFor = null; });

    // Runs an app command; returns false when the message should go to Gemini as typed.
    async function runSlash(text) {
      const m = text.match(/^\/([^\s/\\]+)(?:\s+([\s\S]*))?$/);
      if (!m) return false;                               // "/usr/bin/…" and the like: just text
      const c = findCommand(m[1]);
      if (!c) { toast(`Unknown command /${m[1]}. Type / to see the commands.`); return true; }
      if (c.gemini) return false;
      await c.run?.(m[2] || '');
      $('input').value = ''; autosize(); slashClose();
      return true;
    }

    async function send(retry, attach) {
      let text = attach ? splitAttachments(attach.prompt).text : retry ? retry.text : $('input').value.trim();
      const cwd = attach ? (attach.cwd || $('cwd').value.trim()) : $('cwd').value.trim();
      if (busy) return;
      // "/plan" switches to Plan mode (and shows the latest plan); "/plan <task>" plans that task
      const slash = !attach && !retry && text.match(/^\/plan(?:\s+([\s\S]*))?$/i);
      if (slash) {
        setMode('plan');
        text = (slash[1] || '').trim();
        $('input').value = text; autosize();
        if (!text && !attachments.length) { showLatestPlan(); $('input').focus(); return; }
      }
      // other "/" commands: app ones run here; Gemini ones (/init, custom commands) are sent as typed
      if (!slash && !attach && !retry && text.startsWith('/') && await runSlash(text)) return;
      if (!attach) {
        if (!text && !(retry ? retry.files : attachments).length) return;
        if (!cwd) {$('browse').click(); return;}
        if (accessOpen) return;
        await ensureFolderAccess(cwd);           // first chat in this folder: ask about outside folders
        if (busy) return;
        stopDictation();
        saveSettings();
      }

      if (!current) {
        current = {id: null, title: text.slice(0, 80), cwd};
      }
      $('cwd').disabled = true; syncPills();
      // Gemini reads attachments through @"path" references placed before the message.
      const files = attach ? [] : retry ? retry.files : attachments.slice();
      const importing = !attach && !current?.id ? pendingSessionFile : null;
      if (importing) { pendingSessionFile = null; renderImportChip(); $('input').placeholder = 'Ask anything, / for actions'; }
      const prompt = buildPrompt(files, text);
      let userEl = null;
      if (!retry && !attach) {
        // earlier turns stop being the one Gemini continues from: their versions become view-only
        $('log').querySelectorAll('.msg.user').forEach(u => { if (u._turn) u._turn.latest = false; });
        userEl = addUser(text, files);
        setDelivery(userEl, 'sending');
        const sentDraft = draftKey();
        attachments = []; renderAttachments();
        $('input').value = ''; autosize();
        dropDraft(sentDraft);
      }

      // phase, until Gemini produces something: sending (the request is on its way to the app's server) →
      // starting (the server is launching Gemini) → waiting (Gemini has the message and is waiting on Google)
      setNextPrompt(null);                                 // a new reply starts: the old suggestion goes
      const msg = {role: 'assistant', parts: [], pending: true, phase: attach ? 'starting' : 'sending', attached: !!attach, lastEventAt: Date.now()};
      const view = new AssistantView(msg);
      if (attach?.startedAt) view.start = attach.startedAt;      // the timer counts from when Gemini really started
      view.render();
      renderSessions(); scrollDown(true);
      setBusy(true);

      const session = current, tools = {};
      let raf = null;
      const rerender = () => {if (!raf) raf = requestAnimationFrame(() => {raf = null; view.render(); scrollDown();});};

      // Refresh the changes panel while Gemini works, so edits appear as they are made.
      const watch = setInterval(() => loadChanges(true), 2000);
      runId = attach ? attach.runId : crypto.randomUUID();
      if (!attach && !session.id) store.set('gui.newRun', runId);  // a reload before the new chat has an id can still find it
      controller = new AbortController();
      try {
        const res = attach
          ? await fetch('/api/attach?runId=' + encodeURIComponent(runId), {signal: controller.signal})
          : await fetch('/api/chat', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, signal: controller.signal,
            body: JSON.stringify({prompt, cwd, sessionId: session.id, sessionFile: session.id ? undefined : importing?.path, model: $('model').value, approvalMode: $('approval').value, runId}),
          });
        if (!res.ok) throw new Error((await res.json()).error || res.statusText);
        if (msg.phase === 'sending') { msg.phase = 'starting'; msg.lastEventAt = Date.now(); setDelivery(userEl, 'starting'); rerender(); }
        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
        while (true) {
          const {value, done} = await reader.read(); if (done) break;
          buf += dec.decode(value, {stream: true});
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 2);
            if (line.startsWith('data: ')) handleEvent(JSON.parse(line.slice(6)));
          }
        }
      } catch (e) {
        msg.parts.push({kind: 'err', text: e.name === 'AbortError' ? 'Stopped by you.' : e.message});
        if (msg.phase === 'sending' || msg.phase === 'starting') setDelivery(userEl, 'failed');
      }
      if (msg.phase === 'sending' || msg.phase === 'starting') setDelivery(userEl, null);
      clearInterval(watch);
      if (raf) cancelAnimationFrame(raf);
      // Preview models sometimes end a turn with an empty reply (0 output tokens), often right after a tool
      // call. The tool results are already in the session, so a short nudge usually gets the answer without
      // redoing the work.
      if (!msg.parts.some(p => (p.kind === 'text' && p.text.trim()) || p.kind === 'err' || p.kind === 'auth')) {
        const ranTools = msg.parts.some(p => p.kind === 'tool');
        msg.parts.push({kind: 'empty', prompt: text, ranTools});
      }
      msg.pending = false;
      if (!msg.stats) { msg.secs = (Date.now() - view.start) / 1000; msg.stats = [fmtDuration(msg.secs)]; }
      await loadContext(session.id);
      loadQuota(true);
      const warn = ctxBanner();
      if (warn) view.body.appendChild(warn);
      view.render(); addQuickReplies(view, msg); setBusy(false); updateHint(); scrollDown(); loadSessions(); loadChanges(); refreshTreeSoon();
      if (current === session) setNextPrompt(findNextPrompt(msg.parts.filter(p => p.kind === 'text').map(p => p.text).join('\n')));
      if (retry) finishRetry(retry.turn, view, msg);
      // An imported chat now exists as its own session: reopen it so the imported history is shown above.
      if (importing && session.id && current === session) openSession({id: session.id, title: session.title, cwd: session.cwd});
      notifyFinished(session, msg);

      function handleEvent(ev) {
        msg.lastEventAt = Date.now();
        if (msg.phase !== 'working') {
          // Gemini started (init) or already answers: the message has arrived
          if (ev.type === 'init' || ev.type === 'message') { if (msg.phase !== 'waiting') setDelivery(userEl, 'received'); msg.phase = 'waiting'; }
          if (['thought', 'tool_use'].includes(ev.type) || (ev.type === 'message' && ev.role === 'assistant')) msg.phase = 'working';
        }
        switch (ev.type) {
          case 'init': if (ev.session_id && !session.id) {session.id = ev.session_id; if (current === session) {updateHint(); setUrlSession(session.id);}} break;
          case 'message': {
            if (ev.role !== 'assistant') break;
            const last = msg.parts[msg.parts.length - 1];
            if (last && last.kind === 'text') last.text += ev.content; else msg.parts.push({kind: 'text', text: ev.content});
            break;
          }
          case 'tool_use': {
            const t = {kind: 'tool', id: ev.tool_id, name: ev.tool_name, params: ev.parameters};
            tools[ev.tool_id] = t; msg.parts.push(t); break;
          }
          case 'tool_result': {
            const t = tools[ev.tool_id]; if (t) {t.status = ev.status; t.output = ev.output; t.error = ev.error;}
            // Only tools that can touch files are worth a git check.
            if (t && /write|replace|edit|shell|delete|move|create/i.test(t.name)) { loadChanges(true); refreshOpenFile(); refreshTreeSoon(); }
            break;
          }
          case 'result': {
            const s = ev.stats || {};
            // total_tokens re-counts the whole conversation on every model call in this run; most of it is
            // served from Gemini's cache, so show how much was cached to make the number meaningful.
            const cachedPct = s.input_tokens ? Math.round(100 * (s.cached || 0) / s.input_tokens) : 0;
            msg.secs = (s.duration_ms || 0) / 1000;
            msg.stats = [fmtDuration(msg.secs), (s.total_tokens || 0).toLocaleString() + ' tokens' + (cachedPct ? ` (${cachedPct}% cached)` : '')];
            if (s.tool_calls) msg.stats.push(`${s.tool_calls} tool call${s.tool_calls > 1 ? 's' : ''}`);
            if (s.models) msg.stats.push(Object.keys(s.models).join(' + '));
            if (ev.status && ev.status !== 'success') if (!msg.parts.some(p => p.kind === 'err')) msg.parts.push({kind: 'err', text: cleanError(ev.error?.message || JSON.stringify(ev.error || ev.status))});
            break;
          }
          case 'net_retry': msg.netRetry = {attempt: ev.attempt, reason: ev.reason, at: Date.now()}; break;
          case 'net_error':
            if (!msg.parts.some(p => p.kind === 'err' && p.net)) msg.parts.push({kind: 'err', net: true, text: netMessage(ev.reason)});
            break;
          case 'thought': {
            // Thoughts are shown between steps; skip them once the answer text is streaming.
            const lastPart = msg.parts[msg.parts.length - 1];
            if (lastPart && lastPart.kind === 'text' && lastPart.text.trim()) break;
            msg.parts.push({kind: 'thought', subject: ev.subject, description: ev.description});
            break;
          }
          case 'changed_files': if (ev.files?.length) msg.parts.push({kind: 'changes', files: ev.files, cwd}); break;
          case 'auth_required': if (!msg.parts.some(p => p.kind === 'auth')) msg.parts.push({kind: 'auth'}); break;
          case 'error': case 'stderr': msg.parts.push({kind: 'err', text: cleanError(ev.content || ev.message || JSON.stringify(ev))}); break;
          case 'done': if (ev.code && !msg.parts.length) msg.parts.push({kind: 'err', text: 'gemini exited with code ' + ev.code}); break;
        }
        rerender();
      }
    }
    // ---------- reply versions ----------
    // Retry regenerates the latest reply in place: the chat's last turn is rewound in Gemini's own session file
    // (nothing is deleted), the old reply is hidden, and a new one is written below the same message.
    // ‹ 1/2 › in the reply's footer flips between versions; on the latest turn the version you pick is also the
    // one Gemini continues from.
    function repliesAfter(userEl) {
      const out = [];
      for (let n = userEl.nextElementSibling; n && !n.classList.contains('user'); n = n.nextElementSibling)
        if (n.classList.contains('ai')) out.push(n);
      return out;
    }
    function setupTurn(userEl, entries, active, latest) {
      const turn = {userEl, entries, active, latest};
      userEl._turn = turn;
      showVersion(turn, active);
      return turn;
    }
    function showVersion(turn, idx) {
      turn.active = idx;
      const n = turn.entries.length;
      turn.entries.forEach((e, i) => {
        e.view.el.hidden = i !== idx;
        let nav = e.view.el.querySelector('.vnav');
        if (n < 2) { nav?.remove(); return; }
        if (!nav) {
          nav = document.createElement('span');
          nav.className = 'vnav';
          nav.innerHTML = '<button data-d="-1" title="Previous version"><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14.5 17.5 9 12l5.5-5.5"/></svg></button><span class="vn"></span><button data-d="1" title="Next version"><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9.5 6.5 15 12l-5.5 5.5"/></svg></button>';
          nav.querySelectorAll('button').forEach(b => b.onclick = () => pickVersion(turn, turn.active + Number(b.dataset.d)));
          const actions = e.view.el.querySelector('.actions');
          actions.prepend(nav);
        }
        nav.querySelector('.vn').textContent = `${i + 1}/${n}`;
        nav.querySelector('[data-d="-1"]').disabled = i === 0;
        nav.querySelector('[data-d="1"]').disabled = i === n - 1;
      });
    }
    async function pickVersion(turn, idx) {
      if (busy || idx < 0 || idx >= turn.entries.length || idx === turn.active) return;
      const e = turn.entries[idx];
      // the latest turn: make Gemini continue from this version too (older turns are only shown)
      if (turn.latest && current?.id && e.key) {
        try {
          const res = await fetch('/api/version', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: current.id, key: e.key})});
          if (res.status === 404) return alert('Switching versions needs the updated server: stop gemini-ui (Ctrl+C) and start it again.');
          const d = await res.json();
          if (d.error) return alert(d.error);
        } catch { return alert('Could not reach the server. Is gemini-ui running?'); }
      }
      showVersion(turn, idx);
    }
    async function retryTurn(userEl, text, files) {
      if (busy) return;
      // a brand-new chat that never got a session id cannot be rewound: just send it again
      if (!current?.id) { files.forEach(f => addAttachment(f)); $('input').value = text; autosize(); return send(); }
      try {
        const res = await fetch('/api/rewind', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: current.id})});
        if (res.status === 404) return alert('Retry needs the updated server: stop gemini-ui (Ctrl+C) and start it again.');
        const d = await res.json();
        if (d.error) return alert(d.error);
      } catch { return alert('Could not reach the server. Is gemini-ui running?'); }
      let turn = userEl._turn;
      if (!turn) turn = setupTurn(userEl, repliesAfter(userEl).map(el => ({key: null, view: {el}})), 0, true);
      turn.entries.forEach(e => { e.view.el.hidden = true; });
      $('log').querySelectorAll('.quick').forEach(q => q.remove());
      send({text, files, turn});
    }
    // after a retry: the new reply joins the turn; the versions' ids come from the session file
    async function finishRetry(turn, view, msg) {
      turn.entries.push({key: null, view, msg});
      showVersion(turn, turn.entries.length - 1);
      try {
        const d = await (await fetch('/api/history?id=' + encodeURIComponent(current?.id || ''))).json();
        const u = [...(d.messages || [])].reverse().find(m => m.role === 'user');
        if (u?.versions && u.versions.length === turn.entries.length) u.versions.forEach((v, i) => { turn.entries[i].key = v.key; });
      } catch {}
    }

    // Gemini returned nothing: offer the cheap nudge first, then a full retry.
    function emptyReplyCard(p) {
      const el = document.createElement('div');
      el.className = 'empty-card';
      el.innerHTML = `<div>Gemini ended without a reply (the model returned an empty response`
        + `${p.ranTools ? ', right after its tool calls' : ''}).</div>
        <div class="row">
          <button class="btn" data-a="continue">Continue</button>
          <button class="btn" data-a="retry">Send again</button>
          <span class="set-label" style="flex:0 1 auto">${p.ranTools ? 'Continue asks it to answer from work it already did.' : 'Or pick another model if it keeps happening.'}</span>
        </div>`;
      el.querySelector('[data-a=continue]').onclick = () => {
        if (busy) return;
        $('input').value = 'continue'; autosize(); send();
      };
      el.querySelector('[data-a=retry]').onclick = () => {
        if (busy || !p.prompt) return;
        $('input').value = p.prompt; autosize(); send();
      };
      return el;
    }

    // ---------- topics and inline edits ----------
    // update_topic is Gemini's running commentary ("Topic: … " + a summary); it is shown as text in the reply.
    const isTopicPart = (p) => p && p.kind === 'tool' && p.name === 'update_topic';
    function topicNote(p) {
      const el = document.createElement('div'); el.className = 'topic-note';
      const title = p.params?.title || '', summary = p.params?.summary || p.params?.description || '';
      el.innerHTML = (title ? `<div class="tn-title">${esc(title)}</div>` : '') + (summary ? `<div class="md">${renderMarkdown(summary)}</div>` : '');
      if (!title && !summary) el.hidden = true;
      return el;
    }
    // Line diff (LCS) of two texts -> [{t:' '|'+'|'-', s}]. Large inputs skip the table and show old then new.
    function lineDiff(a, b) {
      const A = a ? a.split('\n') : [], B = b ? b.split('\n') : [];
      if (A.length * B.length > 2_000_000) return [...A.map(s => ({t: '-', s})), ...B.map(s => ({t: '+', s}))];
      const n = A.length, m = B.length, L = Array.from({length: n + 1}, () => new Uint32Array(m + 1));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      const out = []; let i = 0, j = 0;
      while (i < n && j < m) {
        if (A[i] === B[j]) { out.push({t: ' ', s: A[i]}); i++; j++; }
        else if (L[i + 1][j] >= L[i][j + 1]) out.push({t: '-', s: A[i++]});
        else out.push({t: '+', s: B[j++]});
      }
      while (i < n) out.push({t: '-', s: A[i++]});
      while (j < m) out.push({t: '+', s: B[j++]});
      return out;
    }
    // The change an edit tool makes, shown right under its step: write_file (the new content) or replace
    // (old_string -> new_string). Plan files have their own card.
    function editCard(p) {
      const prm = p.params || {}, fp = prm.file_path || prm.path || prm.absolute_path;
      if (typeof fp !== 'string' || PLAN_PATH_RE.test(fp)) return null;
      let lines;
      if (/^(replace|edit)$/i.test(p.name) && typeof prm.new_string === 'string') lines = lineDiff((prm.old_string || '').replace(/\r\n?/g, '\n'), prm.new_string.replace(/\r\n?/g, '\n'));
      else if (/^write_file$/i.test(p.name) && typeof prm.content === 'string') lines = prm.content.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(s => ({t: '+', s}));
      else return null;
      const added = lines.filter(l => l.t === '+').length, removed = lines.filter(l => l.t === '-').length;
      const el = document.createElement('div'); el.className = 'edit-card';
      const cwd = $('cwd').value.trim();
      const rel = relPath(fp, cwd), name = baseName(fp), dir = rel.slice(0, Math.max(0, rel.length - name.length)).replace(/[\\/]$/, '');
      // one line ("Edited index.html +15 −2 ›") that opens to the diff; the file name opens the file
      // notes Gemini keeps for itself: ~/.gemini/scratch (a pencil) and ~/.gemini/memory (memorized); clicking still
      // opens the changes, like any other edit
      const gem = (fp.match(/[\\/]\.gemini[\\/](scratch|memory|backups)[\\/]/i) || [])[1]?.toLowerCase() || (/(^|[\\/])RESTORE[^\\/]*\.md$/i.test(fp) ? 'restore' : '');
      const SVG = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
      const state = gem === 'scratch' ? SVG('<path d="M15 4.5 19.5 9 9 19.5 4 20l.5-5zM12.5 7l4.5 4.5"/>') + 'Scratch'
        : gem === 'memory' ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h4V6.5a2 2 0 1 1 4 0V8h4.5a.5.5 0 0 1 .5.5V12h1.5a2 2 0 1 1 0 4H18v3.5a.5.5 0 0 1-.5.5h-12a.5.5 0 0 1-.5-.5z"/></svg>` + 'Memorized'
        : gem === 'backups' || gem === 'restore' ? SVG('<path d="M9 5 4.5 9.5 9 14M5 9.5h8.5a5 5 0 0 1 0 10H11"/>') + 'Restore note'
        : (p.name === 'write_file' ? 'Wrote' : 'Edited');
      if (gem) el.classList.add('gem-' + gem, 'quiet');       // Gemini's own notes: inside the steps, not shown as a change
      el.innerHTML = `<button class="ec-head" title="${esc(fp)}">
          <span class="ec-state">${state}</span>
          <span class="nm">${esc(name)}</span>${dir && !gem ? `<span class="dir">${esc(dir)}</span>` : ''}
          <span class="ch-nums"><span class="plus">+${added}</span><span class="minus">−${removed}</span></span>
          <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 6.5 15 12l-5.5 5.5"/></svg>
        </button>
        <div class="ec-box">
          <div class="ec-body"><pre></pre></div>
          <button class="ec-more" hidden></button>
        </div>`;
      const head = el.querySelector('.ec-head'), nm = el.querySelector('.nm');
      nm.dataset.fpath = fp; nm.dataset.fcwd = cwd; nm.title = 'Open ' + fp;
      head.onclick = (e) => {
        if (e.target === nm) return viewFile(fp, cwd);
        el.classList.toggle('open');
      };
      const MAX = 400;   // lines drawn at most; the rest are a click away in the file view
      el.querySelector('pre').innerHTML = lines.slice(0, MAX).map(l =>
        `<span class="dl ${l.t === '+' ? 'add' : l.t === '-' ? 'del' : 'ctx'}"><span class="sg">${l.t === ' ' ? '' : l.t}</span>${esc(l.s) || ' '}</span>`).join('')
        + (lines.length > MAX ? `<span class="dl ctx"><span class="sg"></span>… ${lines.length - MAX} more lines, open the file to see them</span>` : '');
      const more = el.querySelector('.ec-more');
      if (lines.length > 12) {
        more.hidden = false; more.textContent = `Show all ${Math.min(lines.length, MAX)} lines`;
        more.onclick = () => { const open = el.classList.toggle('expanded'); more.textContent = open ? 'Show less' : `Show all ${Math.min(lines.length, MAX)} lines`; };
      } else el.classList.add('short');
      return el;
    }

    // ---------- plan mode ----------
    // In Plan mode Gemini only reads and writes a plan to ~/.gemini/tmp/<project>/<session>/plans/*.md; the
    // server's policy stops the run there. The reply then gets a card to approve the plan (run it in an
    // editing mode) or ask for changes (stay in Plan mode).
    const PLAN_PATH_RE = /[\\/]\.gemini[\\/]tmp[\\/][^\\/]+[\\/](?:([\w-]+)[\\/])?plans[\\/]([^\\/]+\.md)$/i;
    function planRef(m) {
      let ref = null;
      for (const p of m.parts || []) {
        if (p.kind !== 'tool') continue;
        const fp = p.params?.file_path;
        const hit = typeof fp === 'string' && fp.match(PLAN_PATH_RE);
        if (hit && /write|replace|edit/i.test(p.name)) ref = {path: fp, name: hit[2], sessionId: hit[1] || null};
        else if (p.name === 'exit_plan_mode' && p.params?.plan_filename) {
          const name = String(p.params.plan_filename).split(/[\\/]/).pop();
          if (!ref || ref.name !== name) ref = {path: null, name, sessionId: null};
        }
      }
      return ref;
    }
    function setMode(mode) {
      if ($('approval').value === mode) return;
      $('approval').value = mode; saveSettings();
      $('approvalPill').classList.remove('pulse'); void $('approvalPill').offsetWidth; $('approvalPill').classList.add('pulse');
    }
    const MODE_CYCLE = ['yolo', 'auto_edit', 'plan'];
    function cycleMode() { setMode(MODE_CYCLE[(MODE_CYCLE.indexOf($('approval').value) + 1) % MODE_CYCLE.length]); }
    function planCard(ref) {
      const el = document.createElement('div'); el.className = 'plan-card';
      el.innerHTML = `<div class="pc-head">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 5.5H7A1.5 1.5 0 0 0 5.5 7v12A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V7A1.5 1.5 0 0 0 17 5.5h-2.5"/><rect x="9.5" y="3.5" width="5" height="4" rx="1"/><path d="m9.5 14 2 2 3.5-3.5"/></svg>
          <b>Plan ready for review</b><span class="pc-name"></span>
          <button class="pc-more" hidden>Show all</button>
        </div>
        <div class="pc-body md"><div class="fmsg">Loading the plan…</div></div>
        <div class="pc-actions">
          <div class="pc-go">
            <button class="pc-approve">Approve and build</button>
            <select class="pc-mode" title="How Gemini works once the plan is approved">
              <option value="yolo">Auto-approve</option>
              <option value="auto_edit">Auto-edit</option>
            </select>
          </div>
          <button class="pc-changes">Request changes</button>
        </div>
        <div class="pc-feedback" hidden>
          <textarea rows="2" placeholder="What should change in the plan?"></textarea>
          <button class="pc-send">Send feedback</button>
        </div>`;
      const q = (s) => el.querySelector(s);
      q('.pc-name').textContent = ref.name;
      q('.pc-name').title = ref.path || ref.name;
      const where = ref.path || ref.name;
      const lastExec = store.get('gui.planExec', 'yolo');
      q('.pc-mode').value = MODE_CYCLE.includes(lastExec) && lastExec !== 'plan' ? lastExec : 'yolo';
      const body = q('.pc-body');
      const sid = ref.sessionId || current?.id || '';
      fetch(`/api/plan?sessionId=${encodeURIComponent(sid)}&name=${encodeURIComponent(ref.name)}`)
        .then(r => r.status === 404 ? {error: 'Showing plans needs the updated server: restart Gemini Studio'} : r.json())
        .catch(() => ({error: 'Could not reach the server'}))
        .then(d => {
          if (d.error) { body.innerHTML = `<div class="fmsg">${esc(d.error)}. Gemini still has the plan in this chat, so you can approve it.</div>`; return; }
          body.innerHTML = renderMarkdown(d.text);
          highlight(body); enhanceTables(body); markLabels(body);
          if (d.path) q('.pc-name').title = d.path;
          requestAnimationFrame(() => { if (body.scrollHeight > body.clientHeight + 8) q('.pc-more').hidden = false; });
        });
      q('.pc-more').onclick = () => {
        const open = el.classList.toggle('expanded');
        q('.pc-more').textContent = open ? 'Show less' : 'Show all';
      };
      const go = (mode, text) => {
        if (busy) return;
        setMode(mode);
        $('input').value = text; autosize();
        send();
      };
      q('.pc-mode').onchange = () => store.set('gui.planExec', q('.pc-mode').value);
      q('.pc-approve').onclick = () => {
        const mode = q('.pc-mode').value;
        store.set('gui.planExec', mode);
        go(mode, `Plan approved: ${where}\nImplement it now. Read the plan and follow it strictly.`);
      };
      q('.pc-changes').onclick = () => {
        q('.pc-feedback').hidden = false; q('.pc-actions').hidden = true;
        q('.pc-feedback textarea').focus();
      };
      const sendFeedback = () => {
        const fb = q('.pc-feedback textarea').value.trim();
        if (!fb) return q('.pc-feedback textarea').focus();
        go('plan', `Revise the plan (${where}) based on this feedback:\n${fb}`);
      };
      q('.pc-send').onclick = sendFeedback;
      q('.pc-feedback textarea').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFeedback(); }
        if (e.key === 'Escape') { q('.pc-feedback').hidden = true; q('.pc-actions').hidden = false; }
      });
      return el;
    }
    // "/plan" alone: switch to Plan mode and show the latest plan
    function showLatestPlan() {
      const cards = $('log').querySelectorAll('.plan-card');
      const last = cards[cards.length - 1];
      if (!last) return;
      last.scrollIntoView({behavior: 'smooth', block: 'center'});
      last.classList.remove('flash'); void last.offsetWidth; last.classList.add('flash');
    }

    // Shown when the Gemini CLI's Google login has expired (it can only be renewed interactively).
    function authCard() {
      const el = document.createElement('div'); el.className = 'auth-card';
      el.innerHTML = `<div class="auth-title">Gemini needs you to sign in again OR turn on VPN of turned off.</div>
        <div class="auth-text">Your Google login for Gemini CLI has expired. Open a terminal, run <code>gemini</code> and sign in again, then send your message again here.</div>`;
      return el;
    }
