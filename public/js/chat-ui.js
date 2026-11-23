    // ---------- per-chat menu (⋯) ----------
    const chatMenu = document.createElement('div');
    chatMenu.className = 'chatmenu';
    document.body.appendChild(chatMenu);
    let chatMenuRow = null;
    function closeChatMenu() {
      chatMenu.classList.remove('open');
      chatMenuRow?.classList.remove('menu-open');
      chatMenuRow = null;
    }
    async function copyText(text) {
      try { await navigator.clipboard.writeText(text); return true; } catch {}
      const t = document.createElement('textarea');       // fallback when the clipboard API is blocked
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch {}
      t.remove(); return ok;
    }
    // Rename in place: the title turns into a text box. Enter saves, Esc cancels, an empty name restores the automatic one.
    function renameChat(s, row) {
      const t = row.querySelector('.t');
      if (!t || t.querySelector('input')) return;
      const input = document.createElement('input');
      input.value = s.title; input.placeholder = 'Chat name (empty = automatic)'; input.maxLength = 200;
      t.textContent = ''; t.appendChild(input);
      row.title = '';
      let done = false;
      const finish = async (save) => {
        if (done) return; done = true;
        const next = input.value.replace(/\s+/g, ' ').trim();
        if (!save || next === s.title) return renderSessions();
        const old = s.title;
        if (next) { s.title = next; renderSessions(); if (current && current.id === s.id) { current.title = next; updateHeader(); } }            // show it right away
        let ok = false, msg = '';
        try {
          const res = await fetch('/api/rename', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: s.id, title: next})});
          ok = res.ok;
          if (res.status === 404) msg = 'Renaming needs the updated server: stop gemini-ui (Ctrl+C) and start it again.';
          else if (!ok) msg = 'Could not save the new name (' + res.status + ').';
        } catch (e) { msg = 'Could not reach the server to save the new name. Is gemini-ui running?'; }
        if (!ok) { s.title = old; renderSessions(); alert(msg); return; }
        await loadSessions();
      };
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
      input.focus(); input.setSelectionRange(0, input.value.length, 'backward');   // all selected, start of the name in view
    }
    async function deleteChat(s, row) {
      if (busy || !confirm(`Delete "${s.title}"?\n\nThis removes the Gemini CLI session file from disk.`)) return;
      row.style.transition = 'all .25s'; row.style.opacity = 0; row.style.transform = 'translateX(-10px)';
      await fetch('/api/history?id=' + encodeURIComponent(s.id), {method: 'DELETE'});
      if (current?.id === s.id) newChat();
      loadSessions();
    }
    // From the ⋯ button (toggles, opens under it) or from a right-click (opens at the pointer).
    function openChatMenu(btn, s, row, at) {
      if (chatMenuRow === row && !at) return closeChatMenu();
      closeChatMenu();
      chatMenuRow = row; row.classList.add('menu-open');
      const COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/></svg>';
      const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5"/></svg>';
      const PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4.5 19.5 9 9 19.5 4 20l.5-5zM12.5 7l4.5 4.5"/></svg>';
      chatMenu.innerHTML = `<button data-a="rename">${PENCIL}<span>Rename</span></button>`
        + `<button data-a="copy">${COPY}<span>Copy session ID</span></button>`
        + `<div class="sid" title="${esc(s.id)}">${esc(s.id)}</div><hr>`
        + `<button data-a="delete" class="danger">${TRASH}<span>Delete</span></button>`;
      chatMenu.querySelector('[data-a=copy]').onclick = async (e) => {
        e.stopPropagation();
        const span = e.currentTarget.querySelector('span');
        span.textContent = (await copyText(s.id)) ? 'Copied ✓' : 'Could not copy';
        setTimeout(closeChatMenu, 700);
      };
      chatMenu.querySelector('[data-a=rename]').onclick = (e) => { e.stopPropagation(); closeChatMenu(); renameChat(s, row); };
      chatMenu.querySelector('[data-a=delete]').onclick = (e) => { e.stopPropagation(); closeChatMenu(); deleteChat(s, row); };
      // below the button, right-aligned with it; flips up near the bottom of the window
      chatMenu.classList.add('open');
      const w = chatMenu.offsetWidth, h = chatMenu.offsetHeight;
      if (at) {
        chatMenu.style.top = Math.max(8, Math.min(at.y, innerHeight - h - 8)) + 'px';
        chatMenu.style.left = Math.max(8, Math.min(at.x, innerWidth - w - 8)) + 'px';
        return;
      }
      const b = btn.getBoundingClientRect();
      const top = b.bottom + 4 + h > innerHeight - 8 ? Math.max(8, b.top - h - 4) : b.bottom + 4;
      chatMenu.style.top = top + 'px';
      chatMenu.style.left = Math.max(8, Math.min(b.right - w, innerWidth - w - 8)) + 'px';
    }
    document.addEventListener('mousedown', (e) => { if (chatMenuRow && !e.target.closest('.chatmenu') && !e.target.closest('.more')) closeChatMenu(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && chatMenuRow) { e.stopPropagation(); closeChatMenu(); } }, true);
    $('sessions').addEventListener('scroll', closeChatMenu);
    window.addEventListener('resize', closeChatMenu);

    function newChat() {
      if (busy) return;
      setNextPrompt(null);
      pendingSessionFile = null; renderImportChip(); $('input').placeholder = 'Ask anything, / for actions';
      setUrlSession(null);
      setContext(0);
      resetChangesPanel();
      current = null; renderEmpty(); renderSessions(); updateHint(); restoreDraft();
      $('cwd').value = ''; saveSettings();          // no default folder: you pick one (the pill above the message box)
      $('cwd').disabled = false; syncPills(); updateHeader(); $('input').focus(); closeSide();
    }
    function setUrlSession(id) {
      const u = new URL(location.href);
      if (id) u.searchParams.set('chat', id); else u.searchParams.delete('chat');
      history.replaceState(null, '', u);
    }
    const LOADING_MIN_MS = 900;
    async function openSession(s) {
      setNextPrompt(null);
      current = {id: s.id, title: s.title, cwd: s.cwd};
      updateHeader();
      setUrlSession(s.id);
      restoreDraft();
      loadContext(s.id);
      resetChangesPanel();
      $('cwd').value = s.cwd; $('cwd').disabled = true; syncPills();
      renderSessions(); updateHint();
      renderLoading();
      const shownAt = performance.now();
      const res = await fetch('/api/history?id=' + encodeURIComponent(s.id));
      if (current?.id !== s.id) return; // user clicked elsewhere meanwhile
      const data = res.ok ? await res.json() : null;
      // a reply still being written: leave its turn out of the saved history (it may hold half of it) and
      // rebuild it from the live run instead
      const live = busy || !data ? null : await liveRun(s.id);
      // keep the loading screen up for a moment even when the chat arrives instantly: a flash looks like a glitch
      const left = LOADING_MIN_MS - (performance.now() - shownAt);
      if (left > 0) await new Promise(ok => setTimeout(ok, left));
      if (current?.id !== s.id) return;
      $('log').innerHTML = '';
      if (!data) {$('log').innerHTML = '<div class="note">Could not load this chat.</div>'; return;}
      if (live) {
        let users = 0;
        const cut = data.messages.findIndex(m => m.role === 'user' && users++ === live.turnsBefore);
        if (cut >= 0) data.messages = data.messages.slice(0, cut);
      }
      let lastView = null, lastMsg = null, pendingTurn = null;
      // bring back the time / tokens line and the "Worked for …" summary that a live reply has
      const showReply = (m) => {
        if (m.stats && !Array.isArray(m.stats)) { m.secs = m.stats.secs || 0; m.stats = statsFromSaved(m.stats); }
        const v = new AssistantView(m); v.render(); return v;
      };
      // a turn with several versions: all are rendered in order, only the active one is shown
      const flushTurn = (currentReply) => {
        const t = pendingTurn; pendingTurn = null;
        const entries = t.versions.map(ver => {
          const msg = ver.current ? (currentReply || {role: 'assistant', parts: []}) : ver.reply;
          return {key: ver.key, view: showReply(msg), msg};
        });
        setupTurn(t.userEl, entries, t.active, t.latest);
        lastView = entries[t.active].view; lastMsg = entries[t.active].msg;
      };
      const renderTurns = (list) => {
        list.flat().forEach(m => {
          if (m.role === 'user') {
            if (pendingTurn) flushTurn(null);
            const userEl = addUser(m.text); lastView = null;
            if (m.versions?.length > 1) pendingTurn = {userEl, versions: m.versions, active: m.active, latest: m.latest};
          }
          else if (pendingTurn) flushTurn(m);
          else { lastView = showReply(m); lastMsg = m; }
        });
        if (pendingTurn) flushTurn(null);
      };
      // A long chat is built in batches: the last CHAT_PAGE turns now, earlier ones as you scroll up.
      const turns = [];
      data.messages.forEach(m => { if (m.role === 'user' || !turns.length) turns.push([]); turns[turns.length - 1].push(m); });
      const first = Math.max(0, turns.length - CHAT_PAGE);
      renderTurns(turns.slice(first));
      const endView = lastView, endMsg = lastMsg;
      const older = () => { if (first > 0) showOlderTurns(s.id, turns, first, renderTurns); };
      if (live) {
        // Gemini is still answering this chat (the page was reloaded or reopened): show its message and pick
        // the reply back up, with everything it already wrote, thought and ran
        addUser(live.prompt);
        $('chat').scrollTop = $('chat').scrollHeight;
        older();
        send(null, live);
        return;
      }
      if (endView) addQuickReplies(endView, endMsg);
      $('chat').scrollTop = $('chat').scrollHeight;
      older();
    }

    // ---------- long chats: earlier turns on demand ----------
    // Building every message of a long chat at once (markdown, code highlighting, tables) slows the page down, so
    // a chat opens with its last CHAT_PAGE turns; a marker sits above them and, when you scroll near it, the
    // previous batch is built above (keeping your scroll position), until the start of the chat.
    function showOlderTurns(id, turns, start, renderTurns) {
      olderObserver?.disconnect();
      const chat = $('chat');
      const mark = document.createElement('div');
      mark.className = 'older-turns';
      mark.innerHTML = '<span class="dl-spin"></span>Loading earlier messages…';
      $('log').prepend(mark);
      const loadMore = () => {
        if (current?.id !== id || !mark.isConnected) { olderObserver?.disconnect(); return; }
        const from = Math.max(0, start - CHAT_PAGE);
        const fromBottom = chat.scrollHeight - chat.scrollTop;
        const box = document.createElement('div');
        mark.after(box);
        logTarget = box;
        try { renderTurns(turns.slice(from, start)); } finally { logTarget = null; }
        box.querySelectorAll(OLD_TURN_ACTIONS).forEach(a => a.remove());   // only the newest turn keeps these
        box.replaceWith(...box.childNodes);
        start = from;
        chat.scrollTop = chat.scrollHeight - fromBottom;                   // what you were reading stays put
        if (!start) { olderObserver.disconnect(); mark.remove(); return; }
        olderObserver.unobserve(mark); olderObserver.observe(mark);         // still close to the top? next batch
      };
      // find in conversation builds every remaining batch at once, so its search covers the whole chat
      mark.loadAll = () => { while (mark.isConnected && current?.id === id) loadMore(); };
      olderObserver = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) loadMore(); },
        {root: chat, rootMargin: '800px 0px 0px 0px'});
      olderObserver.observe(mark);
    }
    // the run still going on the server for this chat, if any
    async function liveRun(id) {
      if (!id) return null;
      try {
        const list = await (await fetch('/api/runs')).json();
        return (Array.isArray(list) && list.filter(r => r.sessionId === id && !r.done).pop()) || null;
      } catch { return null; }
    }

    // ---------- message dots ----------
    // A column of dots at the chat's left edge, one per message you sent (of the turns built so far). The one
    // you are reading is lit; hovering a dot shows that message and the start of Gemini's answer; a click
    // scrolls to it.
    const turnNav = document.createElement('div'); turnNav.className = 'turn-nav'; turnNav.hidden = true;
    const turnTip = document.createElement('div'); turnTip.className = 'turn-tip'; turnTip.hidden = true;
    document.querySelector('main').append(turnNav, turnTip);
    let turnDots = [];
    function buildTurnNav() {
      const users = [...$('log').querySelectorAll(':scope > .msg.user')];
      turnNav.innerHTML = ''; turnDots = []; turnTip.hidden = true;
      turnNav.hidden = users.length < 2;
      if (turnNav.hidden) return;
      turnNav.style.setProperty('--pitch', Math.max(4, Math.min(10, Math.floor($('chat').clientHeight * .6 / users.length))) + 'px');
      users.forEach((u, i) => {
        const d = document.createElement('button'); d.type = 'button'; d.className = 'tn-dot';
        d.setAttribute('aria-label', `Go to message ${i + 1} of ${users.length}`);
        d.onclick = () => {
          const chat = $('chat');
          chat.scrollTo({top: chat.scrollTop + u.getBoundingClientRect().top - chat.getBoundingClientRect().top - 20, behavior: 'smooth'});
        };
        d.onmouseenter = () => showTurnTip(d, u, i, users.length);
        d.onmouseleave = () => { turnTip.hidden = true; };
        turnNav.appendChild(d); turnDots.push({d, u});
      });
      markTurnNav();
    }
    function markTurnNav() {
      if (turnNav.hidden) return;
      const line = $('chat').getBoundingClientRect().top + $('chat').clientHeight / 3;
      let on = 0;
      turnDots.forEach(({u}, i) => { if (u.getBoundingClientRect().top <= line) on = i; });
      turnDots.forEach(({d}, i) => d.classList.toggle('on', i === on));
    }
    function showTurnTip(dot, u, i, n) {
      let ai = u.nextElementSibling;
      while (ai && (ai.hidden || !ai.classList.contains('msg'))) ai = ai.nextElementSibling;
      if (ai && !ai.classList.contains('ai')) ai = null;
      const q = u.querySelector('.bubble')?.textContent.trim() || '';
      const a = ai ? [...ai.querySelectorAll('.md')].map(m => m.textContent).join(' ').replace(/\s+/g, ' ').trim() : '';
      turnTip.innerHTML = `<div class="tt-q">${esc(q)}</div>` + (a ? `<div class="tt-a">${esc(a.slice(0, 320))}</div>` : '')
        + `<div class="tt-n">${i + 1} of ${n}</div>`;
      turnTip.hidden = false;
      const r = dot.getBoundingClientRect(), m = document.querySelector('main').getBoundingClientRect();
      turnTip.style.left = Math.round(r.right - m.left + 8) + 'px';
      turnTip.style.top = Math.round(Math.max(8, Math.min(r.top - m.top - 24, m.height - turnTip.offsetHeight - 8))) + 'px';
    }
    {
      let t = 0, raf = 0;
      new MutationObserver(() => { clearTimeout(t); t = setTimeout(buildTurnNav, 150); }).observe($('log'), {childList: true});
      $('chat').addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; markTurnNav(); }); }, {passive: true});
      addEventListener('resize', () => { clearTimeout(t); t = setTimeout(buildTurnNav, 150); });
    }

    // ---------- empty state ----------
    // Shown while a chat is being opened (also right after a reload), instead of the new-chat screen.
    function renderLoading() {
      $('log').innerHTML = '<div class="chat-loading" role="progressbar" aria-label="Loading chat"><span class="cl-bar"></span></div>';
    }
    function renderEmpty() {
      $('log').innerHTML = '<div class="empty"><h1>What are we building?</h1></div>';
    }
    // Long messages collapse to a fixed height with a fade-out and a chevron to expand.
    const CLAMP_PX = 200;
    function clampIfLong(bubble) {
      const apply = () => {
        // Wait for a real layout: a collapsed/zero-width column would make every message look long.
        if (!bubble.isConnected || !bubble.scrollHeight || bubble.clientWidth < 120) return requestAnimationFrame(apply);
        if (bubble.scrollHeight <= CLAMP_PX + 40) return; // short enough to leave alone
        bubble.classList.add('clamped', 'expandable');
        const btn = document.createElement('button');
        btn.className = 'bubble-toggle';
        btn.title = 'Show the whole message';
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M6.5 9.5 12 15l5.5-5.5"/></svg>';
        btn.onclick = (e) => {
          e.stopPropagation();
          const open = bubble.classList.toggle('open');
          bubble.classList.toggle('clamped', !open);
          btn.title = open ? 'Collapse this message' : 'Show the whole message';
        };
        bubble.appendChild(btn);
      };
      apply();
    }
    // Same wording as a live reply's stats line, for chats reloaded from Gemini's saved session.
    function statsFromSaved(st) {
      if (!st) return null;
      const out = [];
      if (st.secs != null) out.push(fmtDuration(st.secs));
      if (st.tokens) out.push(st.tokens.toLocaleString() + ' tokens' + (st.cachedPct ? ` (${st.cachedPct}% cached)` : ''));
      if (st.tools) out.push(`${st.tools} tool call${st.tools > 1 ? 's' : ''}`);
      if (st.models?.length) out.push(st.models.join(' + '));
      return out.length ? out : null;
    }

    // Attachments are sent as leading @"path" references. When a chat is reopened the saved prompt still has
    // them, so split them back out into files and the text the user actually typed.
    function splitAttachments(raw) {
      const files = [];
      let rest = String(raw || '');
      const re = /^\s*@(?:"([^"]+)"|(\S+))/;
      let m;
      while ((m = rest.match(re))) {
        const path = m[1] || m[2];
        files.push({path, name: path.split(/[\\/]/).pop()});
        rest = rest.slice(m[0].length);
      }
      // code selections added from the file viewer (see selectionPrompt)
      const selRe = /^\s*<selection path="([^"]*)"(?: lines="([^"]*)")?>\r?\n([\s\S]*?)\r?\n<\/selection>/;
      while ((m = rest.match(selRe))) {
        files.push(selectionAttachment(m[1], m[2] || '', m[3]));
        rest = rest.slice(m[0].length);
      }
      return {files, text: rest.replace(/^[ \t]*\r?\n/, '').trim()};
    }
    // A selection from the file viewer travels as an attachment: {sel: true, path, lines: "12-20", text}.
    function selectionAttachment(path, lines, text) {
      const base = path.split(/[\\/]/).pop();
      return {sel: true, path, lines, text, name: base + (lines ? ':' + lines : '')};
    }
    // How a selection is written into the prompt Gemini gets (and parsed back by splitAttachments).
    const selectionPrompt = (f) => `<selection path="${f.path}"${f.lines ? ` lines="${f.lines}"` : ''}>\n${f.text}\n</selection>`;
    function buildPrompt(files, text) {
      const refs = files.filter(f => !f.sel).map(f => `@"${f.path}"`).join(' ');
      const sels = files.filter(f => f.sel).map(selectionPrompt).join('\n');
      // a "/command" must come first for Gemini to see it as one; the attachments follow it
      if (/^\/[^\s/\\]/.test(text)) return [text, refs, sels].filter(Boolean).join('\n');
      return [refs, sels, text].filter(Boolean).join('\n');
    }
    const DOC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M6.5 4.5a1 1 0 0 1 1-1H14l4.5 4.5v11.5a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1zM14 3.5V8h4.5M9.5 13h5M9.5 16.5h3" /></svg>';
    // Images as real previews, other files as a small file card.
    function messageAttachments(files) {
      const box = document.createElement('div');
      box.className = 'msg-atts';
      files.forEach(f => {
        if (IMG_RE.test(f.name || f.path)) {
          const img = document.createElement('img');
          img.className = 'att-img'; img.alt = f.name; img.title = f.path; img.loading = 'lazy';
          // Saved chats keep the reference relative to a workspace folder (e.g. "2026-11-10\x.png" inside the
          // uploads folder), so try the same places as pictures in replies; show the file card only if none works.
          const tries = localImagePaths(f.path);
          let at = 0;
          const next = () => { img.dataset.fpath = tries[at]; img.src = imgFileUrl(tries[at]); };
          img.onclick = () => showImage(img.src);
          img.onerror = () => { if (++at < tries.length) next(); else img.replaceWith(fileCard(f)); };
          next();
          box.appendChild(img);
        } else box.appendChild(fileCard(f));
      });
      return box;
    }
    function fileCard(f) {
      const el = document.createElement('div');
      el.className = 'att-file'; el.title = f.path; el.dataset.fpath = f.path;
      const ext = f.sel ? (f.lines ? 'lines ' + f.lines.replace('-', '–') : 'selection')
        : (f.name.includes('.') ? f.name.split('.').pop() : 'file');
      if (f.sel) {
        el.classList.add('sel'); el.title = f.path + (f.lines ? ' · lines ' + f.lines : '') + '\n\n' + f.text.slice(0, 600);
        el.onclick = () => viewFile(f.path, null, parseInt(f.lines) || 0);   // jump back to the selected lines
      }
      // one compact line: type icon, name, then type/size in muted text
      const ico = f.sel ? SEL_ICON : fileIcon(f.name || '');
      el.innerHTML = `<span class="ic">${ico}</span><span class="nm">${esc(f.name)}</span>`
        + `<span class="ex">${esc(ext)}${f.size ? ' · ' + esc(fmtSize(f.size)) : ''}</span>`;
      return el;
    }

    // Delivery status under a message you just sent: "Sending…" until Gemini has started on it, then a short
    // "Received by Gemini" that fades away. "failed" stays (the error is shown in the reply).
    // Only "Not delivered" is shown now: the sending / starting progress lives in Gemini's status line instead.
    function setDelivery(el, state) {
      if (!el) return;
      let d = el.querySelector(':scope > .delivery');
      if (state !== 'failed') { if (d && !d.classList.contains('failed')) d.remove(); return; }
      if (!d) { d = document.createElement('div'); el.querySelector('.bubble').after(d); }
      clearTimeout(d._t);
      const TEXT = {sending: 'Sending…', starting: 'Sent · starting Gemini…', received: 'Received by Gemini', failed: 'Not delivered'};
      d.className = 'delivery ' + (state === 'received' ? 'ok' : state);
      d.innerHTML = (state === 'received'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>'
        : state === 'failed' ? '' : '<span class="dl-spin"></span>') + `<span>${TEXT[state]}</span>`;
      if (state === 'received') d._t = setTimeout(() => { d.classList.add('gone'); d._t = setTimeout(() => d.remove(), 400); }, 2500);
    }
    // Gemini CLI hooks (e.g. a BeforeAgent hook) put <hook_context>…</hook_context> into the saved prompt. That is
    // not what you typed, so it is taken out of the message and shown as a small "Hook context" tag instead.
    function splitHookContext(text) {
      const hooks = [];
      const rest = String(text || '').replace(/<hook_context>([\s\S]*?)<\/hook_context>\s*/g, (_, h) => {
        const t = document.createElement('textarea'); t.innerHTML = h;   // decode &lt; &gt; &amp; (nothing runs)
        hooks.push(t.value.trim()); return '';
      });
      return hooks.length ? {text: rest.trim(), hooks} : {text, hooks};
    }
    const HOOK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3 6 13.5h5l-1 7.5 7.5-10.5h-5z"/></svg>';
    function hookTag(hooks) {
      const wrap = document.createElement('div'); wrap.className = 'hook-wrap';
      const tag = document.createElement('button'); tag.type = 'button'; tag.className = 'hook-tag';
      tag.title = 'Context added to this message by a Gemini hook. Click to show it.';
      tag.innerHTML = `<span class="ic">${HOOK_ICON}</span><span class="nm">Hook context</span>`
        + (hooks.length > 1 ? `<span class="ex">${hooks.length}</span>` : '')
        + '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5 12 15l5.5-5.5"/></svg>';
      const body = document.createElement('div'); body.className = 'hook-body'; body.hidden = true;
      body.textContent = hooks.join('\n\n');
      tag.onclick = () => { body.hidden = !body.hidden; tag.classList.toggle('open', !body.hidden); };
      wrap.append(tag, body);
      return wrap;
    }
    function addUser(text, files) {
      const hk = splitHookContext(text); text = hk.text;
      if (!files) { const split = splitAttachments(text); files = split.files; text = split.text; }
      $('log').querySelector('.empty')?.remove();
      const el = document.createElement('div'); el.className = 'msg user';
      el.innerHTML = `<div class="bubble"></div>
        <div class="u-actions">
          <button class="u-btn" data-a="copy" title="Copy this message">
            <svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/></svg>Copy
          </button>
          <button class="u-btn" data-a="edit" title="Edit this message in the box below">Edit</button>
          <button class="u-btn" data-a="retry" title="Send this message again">
            <svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M19 12a7 7 0 1 1-2.1-5M19 4.5v4h-4"/></svg>Retry
          </button>
        </div>`;
      const bubble = el.querySelector('.bubble');
      renderUserText(text, bubble);
      if (!text) bubble.hidden = true;           // attachment-only message
      if (files && files.length) el.insertBefore(messageAttachments(files), bubble);
      if (hk.hooks.length) el.insertBefore(hookTag(hk.hooks), el.firstChild);
      el.querySelector('[data-a=copy]').onclick = (e) => {
        navigator.clipboard.writeText(text);
        const btn = e.currentTarget;
        const orig = btn.innerHTML;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.innerHTML = orig; btn.blur(); }, 1500);
      };
      el.querySelector('[data-a=retry]').onclick = () => retryTurn(el, text, files || []);
      el.querySelector('[data-a=edit]').onclick = () => { $('input').value = text; autosize(); $('input').focus(); };
      // Retry/Edit only make sense on the newest message, so drop them from previous messages, keeping Copy on all.
      // (Earlier turns added while scrolling up go above the newest one, which keeps its buttons: see showOlderTurns.)
      if (!logTarget) $('log').querySelectorAll(OLD_TURN_ACTIONS).forEach(a => a.remove());
      logAppend(el);
      clampIfLong(bubble);
      return el;
    }

    // ---------- assistant message (incremental DOM so animations don't replay) ----------
    function shortArg(p) {
      if (!p) return '';
      const v = p.command || p.file_path || p.absolute_path || p.dir_path || p.path || p.pattern || p.query || p.url || Object.values(p)[0];
      return typeof v === 'string' ? v : JSON.stringify(p);
    }
    const TOOL_LABEL = {read_file: 'Read', read_many_files: 'Read files', list_directory: 'List', glob: 'Find files', grep: 'Search', search_file_content: 'Search', run_shell_command: 'Run', write_file: 'Write', replace: 'Edit', web_fetch: 'Fetch', google_web_search: 'Web search', save_memory: 'Remember'};
    const toolLabel = (n) => TOOL_LABEL[n] || (mcpParts(n) ? prettyServer(mcpParts(n).server) : n.replace(/_/g, ' '));
    const baseName = (s) => String(s).split(/[\\/]/).filter(Boolean).pop() || s;

    function highlight(root) {
      root.querySelectorAll('pre code').forEach(c => {
        if (c.dataset.done) return; c.dataset.done = 1;
        try {hljs.highlightElement(c);} catch { }
        const lang = (c.className.match(/language-(\w+)/) || [])[1] || 'code';
        const bar = document.createElement('div'); bar.className = 'bar';
        bar.innerHTML = `<span>${esc(lang)}</span><button class="copy">Copy</button>`;
        bar.querySelector('button').onclick = (e) => {navigator.clipboard.writeText(c.innerText); e.target.textContent = 'Copied ✓'; setTimeout(() => e.target.textContent = 'Copy', 1400);};
        c.parentElement.prepend(bar);
      });
    }

    // ---------- tables ----------
    // A long or wide table scrolls in place (header stays visible) and gets a button to open it in full.
    const ICON_EXPAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4 10V4h6M20 10V4h-6M4 14v6h6M20 14v6h-6" /></svg>';
    // A short line ending with ":" right before a list ("Done:", "Next action:") labels that list: it is shown
    // bold and sits close to the list, like a small heading.
    function markLabels(root) {
      root.querySelectorAll('p').forEach(p => {
        const t = p.textContent.trim(), next = p.nextElementSibling;
        if (t.length <= 40 && t.endsWith(':') && !t.includes('\n') && /^(UL|OL)$/.test(next?.tagName || '')
          && !p.querySelector('code, a, img')) p.classList.add('md-label');
      });
    }
    function enhanceTables(root) {
      root.querySelectorAll('table').forEach(t => {
        if (t.closest('.tbl')) return;
        const wrap = document.createElement('div'); wrap.className = 'tbl';
        const sc = document.createElement('div'); sc.className = 'tbl-scroll';
        t.replaceWith(wrap); sc.appendChild(t); wrap.appendChild(sc);
        const rows = t.tBodies[0]?.rows.length || 0;
        const btn = document.createElement('button');
        btn.className = 'tbl-expand'; btn.hidden = true;
        btn.innerHTML = `${ICON_EXPAND}<span>Show full table · ${rows} row${rows === 1 ? '' : 's'}</span>`;
        btn.onclick = () => openTable(t);
        wrap.appendChild(btn);
        checkTable(wrap);                                 // now if it is on the page, and again after layout settles
        requestAnimationFrame(() => checkTable(wrap));
      });
    }
    function checkTable(wrap) {
      const sc = wrap.firstElementChild;
      if (!sc?.isConnected) return;
      const long = sc.scrollHeight > sc.clientHeight + 2 || sc.scrollWidth > sc.clientWidth + 2;
      wrap.classList.toggle('long', long);
      wrap.querySelector('.tbl-expand').hidden = !long;
    }
    // the chat width can change (window, sidebar, panel), which can make a table fit or overflow
    new ResizeObserver(() => document.querySelectorAll('#log .tbl').forEach(checkTable)).observe($('log'));

    function openTable(t) {
      const body = $('tblBody');
      body.innerHTML = '';
      body.appendChild(t.cloneNode(true));
      const rows = t.tBodies[0]?.rows.length || 0, cols = t.rows[0]?.cells.length || 0;
      $('tblMeta').textContent = `${rows} row${rows === 1 ? '' : 's'} · ${cols} column${cols === 1 ? '' : 's'}`;
      $('tblCopy').textContent = 'Copy';
      $('tblModal').classList.add('on');
      body.scrollTop = 0; body.scrollLeft = 0;
    }
    const closeTable = () => $('tblModal').classList.remove('on');
    $('tblClose').onclick = closeTable;
    $('tblModal').addEventListener('mousedown', (e) => { if (e.target === $('tblModal')) closeTable(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('tblModal').classList.contains('on')) { e.stopPropagation(); closeTable(); }
    }, true);
    $('tblCopy').onclick = async () => {
      const t = $('tblBody').querySelector('table');
      if (!t) return;
      const tsv = [...t.rows].map(r => [...r.cells].map(c => c.innerText.replace(/\s+/g, ' ').trim()).join('\t')).join('\n');
      $('tblCopy').textContent = (await copyText(tsv)) ? 'Copied ✓' : 'Could not copy';
      setTimeout(() => { $('tblCopy').textContent = 'Copy'; }, 1400);
    };

    // ---------- step cards ----------
    // Header: status · kind · Gemini's own description (falls back to the command/path). Body: what was run
    // and what came back, laid out for reading instead of a raw JSON dump.
    // our own line icons, 24px (stroke-based, drawn for this app)
    const ICONS = {
      eye: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 12c2-4 5.5-6 9-6s7 2 9 6c-2 4-5.5 6-9 6s-7-2-9-6z" /><circle cx="12" cy="12" r="2.8" stroke-linecap="round" stroke-linejoin="round" />',
      commandLine: '<rect x="3" y="4.5" width="18" height="15" rx="2.5" stroke-linecap="round" stroke-linejoin="round" /><path stroke-linecap="round" stroke-linejoin="round" d="M7 10l3 2.5L7 15M12.5 15H17" />',
      pencilSquare: '<path stroke-linecap="round" stroke-linejoin="round" d="M15 4.5 19.5 9 9 19.5 4 20l.5-5zM12.5 7l4.5 4.5" />',
      documentPlus: '<path stroke-linecap="round" stroke-linejoin="round" d="M6.5 4.5a1 1 0 0 1 1-1H14l4.5 4.5v11.5a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1zM14 3.5V8h4.5M12.5 12v6M9.5 15h6" />',
      magnifyingGlass: '<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5l5 5" />',
      folderOpen: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 19V6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v1.5M3 19l2.3-8.5h17.2L20.2 19z" />',
      globeAlt: '<circle cx="12" cy="12" r="9" stroke-linecap="round" stroke-linejoin="round" /><ellipse cx="12" cy="12" rx="4" ry="9" stroke-linecap="round" stroke-linejoin="round" /><path stroke-linecap="round" stroke-linejoin="round" d="M3 12h18" />',
      sparkles: '<path stroke-linecap="round" stroke-linejoin="round" d="M10 4c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7zM18.5 3v4M16.5 5h4M18 16v4M16 18h4" />',
      bookmark: '<path stroke-linecap="round" stroke-linejoin="round" d="M6.5 3.5h11v17L12 16.5l-5.5 4z" />',
      cpuChip: '<rect x="6" y="6" width="12" height="12" rx="2" stroke-linecap="round" stroke-linejoin="round" /><rect x="9.5" y="9.5" width="5" height="5" rx=".8" stroke-linecap="round" stroke-linejoin="round" /><path stroke-linecap="round" stroke-linejoin="round" d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" />',
      wrench: '<path stroke-linecap="round" stroke-linejoin="round" d="M16.9 4.7A4 4 0 1 0 19.3 7.1L17.2 7.2 16.6 5.6zM12.7 11.3 5.5 18.5M5 19l1-1" />',
      lightBulb: '<path stroke-linecap="round" stroke-linejoin="round" d="M9 17.5h6M10 21h4M8.5 14.5C6.8 13.3 6 11.7 6 10a6 6 0 0 1 12 0c0 1.7-.8 3.3-2.5 4.5-.6.5-1 1.2-1 2v1h-5v-1c0-.8-.4-1.5-1-2z" />',
      check: '<path stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5" />',
      xMark: '<path stroke-linecap="round" stroke-linejoin="round" d="M7 7l10 10M17 7 7 17" />',
      ellipsisH: '<path stroke-linecap="round" stroke-linejoin="round" d="M6 12h.01M12 12h.01M18 12h.01" />',
      puzzlePiece: '<path stroke-linecap="round" stroke-linejoin="round" d="M5 8h4V6.5a2 2 0 1 1 4 0V8h4.5a.5.5 0 0 1 .5.5V12h1.5a2 2 0 1 1 0 4H18v3.5a.5.5 0 0 1-.5.5h-12a.5.5 0 0 1-.5-.5z" />',
      chevronDown: '<path stroke-linecap="round" stroke-linejoin="round" d="M6.5 9.5 12 15l5.5-5.5" />',
    };
    // our own four-point sparkle (plus a small companion) and paper-plane glyphs
    const GEM_PATH = 'M12 1.5Q13.2 11.3 21.5 12.5Q13.2 13.7 12 23Q10.8 13.7 2.5 12.5Q10.8 11.3 12 1.5z';
    // our own simple rocket, drawn upright then rotated 45deg to point top-right
    const POSTMAN_PLANE = '<g transform="rotate(45 12 12)"><path fill="#fff" d="M12 5.2C14.7 7.8 15.1 11 14.3 14.6H9.7C8.9 11 9.3 7.8 12 5.2zM9.8 11.8 7.4 15.4 9.9 14.9zM14.2 11.8 16.6 15.4 14.1 14.9zM10.8 15.6H13.2L12 18.4z"/><circle cx="12" cy="10.4" r="1.3" fill="#FF6C37"/></g>';
    const lineIcon = (name, sw = 1.6) => name === 'postman'
      ? `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#FF6C37"/>${POSTMAN_PLANE}</svg>`
      : name === 'gemini'
      ? `<svg viewBox="0 0 24 24"><path fill="currentColor" d="${GEM_PATH}"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}">${ICONS[name]}</svg>`;
    // one meaningful icon per kind of action
    // 4.3s, 45s, 2m 14s, 1h 02m 05s: only as many units as needed
    function fmtDuration(secs) {
      if (!(secs >= 0)) return '';
      if (secs < 9.95) return secs.toFixed(1) + 's';
      secs = Math.round(secs);
      const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), sec = secs % 60;
      if (h) return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
      if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
      return sec + 's';
    }
    // MCP tools are named mcp_<server>_<action> (e.g. mcp_postman_getCollection).
    function mcpParts(name) {
      const m = String(name || '').match(/^mcp_([^_]+)_(.+)$/);
      return m ? { server: m[1], action: m[2] } : null;
    }
    const prettyServer = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    // "getCollectionRequest" -> "Get collection request"
    function prettyAction(a) {
      const t = String(a).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    function stepIcon(tool) {
      const n = String(tool || '');
      const mcp = mcpParts(n);
      if (mcp) return mcp.server === 'postman' ? 'postman' : 'puzzlePiece';   // before the name tests below ("duplicate" contains "cat")
      if (/read|view|cat/.test(n)) return 'eye';
      if (/shell|command|exec|run/.test(n)) return 'commandLine';
      if (/write|create_file/.test(n)) return 'documentPlus';
      if (/replace|edit|patch/.test(n)) return 'pencilSquare';
      if (/grep|search_file|glob|find/.test(n)) return 'magnifyingGlass';
      if (/list|dir|ls/.test(n)) return 'folderOpen';
      if (/web|fetch|google|url/.test(n)) return 'globeAlt';
      if (/skill/.test(n)) return 'gemini';
      if (/topic|memory|note/.test(n)) return 'bookmark';
      if (/agent/.test(n)) return 'cpuChip';
      return 'wrench';
    }

    // A readable phrase for a step Gemini did not describe: "Read index.html", "Searched for \"foo\"", "Ran npm test".
    function stepPhrase(p) {
      const q = p.params || {}, n = String(p.name || '');
      const arg = shortArg(q), base = arg ? baseName(arg) : '';
      const quote = (t) => '"' + String(t).slice(0, 80) + '"';
      if (/^read_many_files/.test(n)) return 'Read ' + ((q.paths || q.include || []).length || 'several') + ' files';
      if (/read_file|view/.test(n)) return 'Read ' + base;
      if (/list_dir/.test(n)) return 'Listed ' + (base || 'the folder');
      if (/glob|find_files/.test(n)) return 'Found files' + (q.pattern ? ' matching ' + quote(q.pattern) : '');
      if (/grep|search_file/.test(n)) return 'Searched for ' + quote(q.pattern || q.query || arg);
      if (/write_file|create_file/.test(n)) return 'Wrote ' + base;
      if (/replace|edit|patch/.test(n)) return 'Edited ' + base;
      if (/shell|command/.test(n)) return 'Ran ' + String(q.command || arg).split('\n')[0].slice(0, 120);
      if (/web_fetch|fetch/.test(n)) { try { return 'Fetched ' + new URL(String(q.url || q.prompt || arg).match(/https?:\/\/\S+/)[0]).host; } catch { return 'Fetched a web page'; } }
      if (/google_web_search|web_search/.test(n)) return 'Searched the web' + (q.query ? ' for ' + quote(q.query) : '');
      if (/save_memory/.test(n)) return 'Saved a memory';
      if (/skill/.test(n)) return 'Loaded ' + (q.name || q.skill || arg || 'a') + ' skill';
      if (/topic/.test(n)) return String(q.title || q.topic || q.summary || arg || 'Updated the topic');
      const mcp = mcpParts(n);
      if (mcp) return prettyServer(mcp.server) + ' · ' + prettyAction(mcp.action);
      return toolLabel(n) + (base ? ' ' + base : '');
    }
    // A step on the timeline: icon on the rail, Gemini's own description, duration and status on the right.
    // Click it to see what was run and what came back.
    function toolCard(p) {
      const node = document.createElement('div');
      node.className = 'tool step';
      const mcp = mcpParts(p.name);
      const desc = p.params?.description || (mcp ? prettyAction(mcp.action) : '');
      const icon = stepIcon(p.name);
      node.innerHTML = `<div class="rail"><span class="ico${icon === 'gemini' ? ' gem' : ''}" title="${esc(toolLabel(p.name))}">${lineIcon(icon)}</span><span class="line"></span></div>
        <div class="main">
          <div class="head" title="Click to show details"><span class="desc" title="${esc(shortArg(p.params))}">${esc(desc || stepPhrase(p))}</span>
            <span class="dur"></span></div>
          <div class="tool-body"></div>
        </div>`;
      node._started = Date.now();
      // file steps get the file menu on right-click
      const pp = p.params || {};
      const fp = pp.file_path || pp.absolute_path || pp.dir_path || pp.path;
      if (typeof fp === 'string' && fp && !mcp) {
        const h = node.querySelector('.head');
        h.dataset.fpath = fp;
        if (pp.dir_path || /list_dir|glob|grep|search/.test(p.name)) h.dataset.fdir = '1';
      }
      node.querySelector('.head').onclick = () => {
        node.classList.toggle('open');
        if (node.classList.contains('open')) fillToolBody(node, node._part);
      };
      return node;
    }
    function updateToolCard(node, p) {
      node._part = p;
      const state = p.status === 'success' ? 'ok' : p.status ? 'err' : 'run';
      node.classList.toggle('running', state === 'run');
      node.classList.toggle('failed', state === 'err');
      const dur = node.querySelector('.dur');
      if (state === 'run') {
        if (!node._tick) node._tick = setInterval(() => { dur.textContent = fmtDuration((Date.now() - node._started) / 1000); }, 500);
      } else if (node._tick) {
        clearInterval(node._tick); node._tick = null;
        const secs = (Date.now() - node._started) / 1000;
        dur.textContent = secs >= 1 ? fmtDuration(secs) : '';
      }
      if (node.classList.contains('open')) fillToolBody(node, p);
    }
    function copyBtn(text) {
      const b = document.createElement('button'); b.textContent = 'Copy';
      b.onclick = (e) => { e.preventDefault(); navigator.clipboard.writeText(text); b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200); };
      return b;
    }
    function section(label, content, opts = {}) {
      const sec = document.createElement('div'); sec.className = 'tool-sec' + (opts.err ? ' err' : '');
      const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.textContent = label;
      if (opts.copy) lbl.appendChild(copyBtn(opts.copy));
      sec.appendChild(lbl); sec.appendChild(content);
      return sec;
    }
    function fillToolBody(node, p) {
      if (!p) return;
      const key = (p.status || 'run') + '|' + (p.output || '').length;
      if (node._filled === key) return;
      node._filled = key;
      const body = node.querySelector('.tool-body'); body.innerHTML = '';
      const params = {...(p.params || {})};
      delete params.description;
      if (p.name === 'run_shell_command' && params.command) {
        const pre = document.createElement('pre');
        pre.innerHTML = '<span class="prompt">$ </span>' + esc(params.command);
        body.appendChild(section('Command', pre, {copy: params.command}));
        delete params.command;
      }
      const rest = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
      if (rest.length) {
        const kv = document.createElement('div'); kv.className = 'kv';
        rest.forEach(([k, v]) => {
          kv.insertAdjacentHTML('beforeend', `<span class="k">${esc(k.replace(/_/g, ' '))}</span><span class="v">${esc(typeof v === 'string' ? v : JSON.stringify(v))}</span>`);
        });
        body.appendChild(section('Input', kv));
      }
      if (!p.status) {
        const w = document.createElement('div'); w.className = 'waiting'; w.innerHTML = '<span class="shimmer">Running</span>';
        body.appendChild(section('Output', w));
      } else {
        const failed = p.status !== 'success';
        const text = [p.output, p.error ? (p.error.message || JSON.stringify(p.error)) : ''].filter(Boolean).join('\n').trim();
        const pre = document.createElement('pre'); pre.textContent = text || '(no output)';
        body.appendChild(section(failed ? 'Error' : 'Output', pre, {err: failed, copy: text || undefined}));
      }
    }
    function thoughtLine(p) {
      const el = document.createElement('div');
      el.className = 'thought step';
      el.innerHTML = `<div class="rail"><span class="ico">${lineIcon('lightBulb')}</span><span class="line"></span></div>
        <div class="main"><div class="d" title="Click to read the full thought"><span class="s">${esc(p.subject || 'Thinking')}</span></div>${p.description ? `<div class="more">${esc(p.description)}</div>` : ''}</div>`;
      el.querySelector('.main').onclick = () => el.classList.toggle('full');
      return el;
    }

    // The working Gemini logo. Its gradient drifts softly between the app's light and darker red (each stop on its
    // own clock, so the blend keeps changing); the turn and the hops are CSS.
    let gwSeq = 0;
    function gemWalker() {
      const id = 'gwg' + (++gwSeq);
      const [a, b] = gradColors(), mid = (f) => mixHex(a, b, f);
      const css = getComputedStyle(document.documentElement);
      const green = css.getPropertyValue('--gem-green').trim() || '#81c995', red = css.getPropertyValue('--gem-red').trim() || '#e5534b';
      const vals = [a, green, mid(.5), b, red, a].join(';');      // light red → green → red family → deeper red
      const stop = (offset, begin) => `<stop offset="${offset}" stop-color="${a}"><animate attributeName="stop-color" values="${vals}" dur="7s" begin="${begin}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.2;.4;.6;.8;1" keySplines=".4 0 .6 1;.4 0 .6 1;.4 0 .6 1;.4 0 .6 1;.4 0 .6 1"/></stop>`;
      const w = document.createElement('div');
      w.className = 'gem-walker';
      w.setAttribute('aria-hidden', 'true');
      w.innerHTML = `<div class="gw-hop"><div class="gw-bob"><svg viewBox="0 0 24 24"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">`
        + stop(0, 0) + stop(.5, -2.3) + stop(1, -4.6)
        + `</linearGradient></defs><path fill="url(#${id})" d="${GEM_PATH}"/></svg></div></div>`;
      return w;
    }
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

    // ---- text being written ----
    // Each render of a streaming reply rebuilds its markdown, so "how old is each letter" is tracked by length:
    // every render records how much text there was and when. Letters younger than INK_MS are wrapped in .ink spans
    // whose animation is started back in time by their age, so the fade continues smoothly across re-renders.
    const INK_MS = 700;                    // = the .ink animation length
    const inkSkip = (n) => n.parentElement?.closest('.bar, .katex, .tbl-expand, .copy') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    function textNodes(root) {
      const out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode: inkSkip});
      let total = 0;
      for (let n; (n = w.nextNode());) { out.push([n, total]); total += n.nodeValue.length; }
      return {nodes: out, total};
    }
    function inkFresh(node) {
      const {nodes, total} = textNodes(node);
      const now = performance.now();
      const hist = node._ink || (node._ink = [{len: 0, at: now}]);
      if (total > hist[hist.length - 1].len) hist.push({len: total, at: now});
      while (hist.length > 1 && now - hist[1].at > INK_MS) hist.shift();   // keep one older boundary
      if (reduceMotion.matches) return;
      // newest batch first: splitting a text node keeps its first part, so earlier offsets stay valid
      const rows = new Set();
      for (let i = hist.length - 1; i >= 1; i--) {
        const from = hist[i - 1].len, to = Math.min(hist[i].len, total), age = Math.round(now - hist[i].at);
        if (from >= to || age > INK_MS) continue;
        for (let k = nodes.length - 1; k >= 0; k--) {
          const [n, start] = nodes[k], end = start + n.nodeValue.length;
          if (end <= from) break;
          if (start >= to) continue;
          const a = Math.max(from, start) - start, b = Math.min(to, end) - start;
          if (!/\S/.test(n.nodeValue.slice(a, b))) continue;      // never wrap the whitespace between table parts
          let seg = n;
          if (b < seg.nodeValue.length) seg.splitText(b);
          if (a > 0) seg = seg.splitText(a);
          const span = document.createElement('span');
          span.className = 'ink';
          span.style.animationDelay = -age + 'ms';
          seg.replaceWith(span); span.appendChild(seg);
          const tr = span.closest('tr');
          if (tr && !rows.has(tr)) { rows.add(tr); tr.classList.add('ink-row'); tr.style.animationDelay = -age + 'ms'; }
        }
      }
    }
    class AssistantView {
      constructor(m) {
        this.m = m; this.nodes = new Map(); this.edits = new Map(); this.quietEdits = new Map();   // edits: tool part -> its inline diff card
        this.el = document.createElement('div'); this.el.className = 'msg ai';
        this.el.innerHTML = `<div class="body"></div>
          <div class="actions">
            <button class="u-btn a-copy" data-a="copy" title="Copy reply">
              <svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/></svg>
            </button>
          </div>`;
        this.body = this.el.querySelector('.body');
        this.el.querySelector('[data-a=copy]').onclick = (e) => {
          const text = this.m.parts
            ? this.m.parts.filter(p => p.kind === 'text' || p.kind === 'err' || (!p.kind && p.text)).map(p => p.text).join('\n\n')
            : '';
          const toCopy = text || this.body.innerText.trim();
          navigator.clipboard.writeText(toCopy);
          const btn = e.currentTarget;
          const orig = btn.innerHTML;
          btn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
          btn.title = 'Copied';
          setTimeout(() => { btn.innerHTML = orig; btn.title = 'Copy reply'; btn.blur(); }, 1500);
        };
        logAppend(this.el);
        this.start = Date.now();
      }
      render() {
        const m = this.m;
        this.el.classList.toggle('pending', !!m.pending);
        let group = null, prev = null;
        m.parts.forEach((p, i) => {
          if (p.kind === 'tool' && p.name === 'exit_plan_mode') return;   // shown as the plan card instead
          let node = this.nodes.get(p);
          // Gemini's running commentary ("Topic: … / summary") reads like text, so it sits between the steps
          if (isTopicPart(p)) {
            if (!node) { node = topicNote(p); this.insert(node); this.nodes.set(p, node); }
            prev = p; return;
          }
          if (p.kind === 'tool' || p.kind === 'thought') {
            if (!node) {
              // steps (actions + thoughts) that follow each other share one foldable group; a step that shows its
              // edit inline ends the group, so the next steps continue in a new group below the diff
              const prevIsStep = prev && (prev.kind === 'tool' || prev.kind === 'thought') && this.nodes.get(prev)
                && !isTopicPart(prev) && !this.edits.has(prev);
              if (!prevIsStep) {
                group = document.createElement('div'); group.className = 'tools';
                const head = document.createElement('button');
                head.className = 'tools-head';
                head.innerHTML = '<span class="caret"></span><span class="sum"></span>';
                const own = group;          // this header opens its own group (the shared `group` moves on to the next one)
                head.onclick = () => { own.classList.toggle('open'); own.dataset.touched = '1'; };
                group.appendChild(head);
                this.insert(group);
              }
              else group = this.nodes.get(prev).parentElement;
              node = p.kind === 'tool' ? toolCard(p) : thoughtLine(p);
              group.appendChild(node); this.nodes.set(p, node);
              const edit = p.kind === 'tool' && editCard(p);
              if (edit && edit.classList.contains('quiet')) {
                // memory / scratch / backup notes stay in the steps (hidden while they are folded) and keep their diff
                node.classList.add('has-edit'); group.appendChild(edit); this.quietEdits.set(p, edit);
              } else if (edit) { this.insert(edit); this.edits.set(p, edit); }
            }
            if (p.kind === 'tool') updateToolCard(node, p);
            (this.edits.get(p) || this.quietEdits.get(p))?.classList.toggle('failed', !!p.status && p.status !== 'success');
          } else if (p.kind === 'text') {
            if (!node) {node = document.createElement('div'); node.className = 'md'; this.insert(node); this.nodes.set(p, node);}
            if (node.dataset.len != p.text.length) {
              node.innerHTML = renderMarkdown(p.text);
              highlight(node);
              enhanceTables(node);
              markLabels(node);
              if (m.pending) {
                inkFresh(node);
                const sc = [...node.querySelectorAll('.tbl-scroll')].pop();
                if (sc && p.text.trimEnd().endsWith('|')) sc.scrollTop = sc.scrollHeight;   // a table is being written
              }
              linkFileRefs(node);
              linkTickets(node);
              node.dataset.len = p.text.length;
              node.dataset.imgs = '';
            }
            // images load once the reply is done, so the stream does not reload them on every update
            if (!m.pending && node.dataset.imgs !== '1') { node.dataset.imgs = '1'; showChatImages(node); }
          } else if (p.kind === 'changes') {
            if (!node) { node = changesCard(p.files, p.cwd); this.insert(node); this.nodes.set(p, node); }
          } else if (p.kind === 'empty') {
            if (!node) { node = emptyReplyCard(p); this.insert(node); this.nodes.set(p, node); }
          } else if (p.kind === 'auth') {
            if (!node) {node = authCard(); this.insert(node); this.nodes.set(p, node);}
          } else if (!node && !p.dismissed) {
            // error / warning notes can be closed with an x; a closed note stays closed for this view
            node = document.createElement('div'); node.className = 'note closable';
            const txt = document.createElement('span'); txt.textContent = p.text;
            const x = document.createElement('button');
            x.className = 'note-x'; x.title = 'Dismiss'; x.setAttribute('aria-label', 'Dismiss');
            x.innerHTML = '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/></svg>';
            x.onclick = () => { p.dismissed = true; node.remove(); };
            node.append(txt, x);
            this.insert(node); this.nodes.set(p, node);
          }
          prev = p;
        });
        this.foldToolGroups();
        this.renderThinking();
        this.placeWalker();
        if (!m.pending && !this.planEl) {
          const ref = planRef(m);
          if (ref) { this.planEl = planCard(ref); this.body.insertBefore(this.planEl, this.statsEl || null); }
        }
        if (m.stats && !this.statsEl) {
          this.statsEl = document.createElement('div'); this.statsEl.className = 'stats';
          this.statsEl.innerHTML = [].concat(m.stats).map(s => `<span>${esc(s)}</span>`).join('');
          this.body.appendChild(this.statsEl);
          const actions = this.el.querySelector('.actions');
          if (actions) this.statsEl.appendChild(actions);
        }
      }
      // Steps stay open while they run; once text follows them (or the turn ends) they fold into one row.
      foldToolGroups() {
        const m = this.m;
        this.body.querySelectorAll('.tools').forEach(group => {
          const inGroup = m.parts.filter(p => (p.kind === 'tool' || p.kind === 'thought') && this.nodes.get(p)?.parentElement === group);
          const parts = inGroup.filter(p => p.kind === 'tool');
          if (!inGroup.length) return;
          // a group that is just one edit says nothing its diff card below does not, so it is not shown
          group.classList.toggle('only-edit', inGroup.length === 1 && this.edits.has(inGroup[0]));
          const running = parts.some(p => !p.status);
          const failed = parts.filter(p => p.status && p.status !== 'success').length;
          const lastIndex = Math.max(...inGroup.map(p => m.parts.indexOf(p)));
          // anything after this group (text, a topic, an edit's diff, the next group of steps) means it is done
          const textAfter = m.parts.slice(lastIndex + 1).some(p => (p.kind === 'text' && p.text.trim()) || ((p.kind === 'tool' || p.kind === 'thought') && p.name !== 'exit_plan_mode'));
          const fold = !running && (textAfter || !m.pending);

          group.classList.toggle('folded', fold);
          if (fold && !group.dataset.touched) group.classList.remove('open');
          if (!fold) group.classList.add('open');

          // While Gemini is still working, keep the timeline short: show the last 2 steps plus the current one
          // and fold everything older into one clickable "N earlier steps" row.
          const rows = [...group.children].filter(el => el.classList.contains('step') && !el.classList.contains('earlier'));
          const KEEP = 3;
          const overflow = !fold && rows.length > KEEP ? rows.length - KEEP : 0;
          const expanded = !!group.dataset.showAll;
          const hideCount = expanded ? 0 : overflow;
          rows.forEach((el, i) => el.classList.toggle('early', i < hideCount));
          let earlier = group.querySelector('.earlier');
          if (overflow) {
            if (!earlier) {
              earlier = document.createElement('div');
              earlier.className = 'step earlier';
              earlier.innerHTML = `<div class="rail"><span class="ico">${lineIcon('ellipsisH', 2)}</span><span class="line"></span></div>`
                + '<div class="main"><div class="head"><span class="desc"></span></div></div>';
              // one row that toggles: shows the older steps, and hides them again
              earlier.onclick = () => {
                if (group.dataset.showAll) delete group.dataset.showAll; else group.dataset.showAll = '1';
                this.foldToolGroups();
              };
            }
            if (earlier.nextElementSibling !== rows[hideCount]) group.insertBefore(earlier, rows[hideCount]);
            const noun = `earlier step${overflow > 1 ? 's' : ''}`;
            const label = expanded ? `Hide ${overflow} ${noun}` : `${overflow} ${noun}`;
            const d = earlier.querySelector('.desc');
            if (d.textContent !== label) d.textContent = label;
            earlier.querySelector('.head').title = expanded ? 'Hide the older steps' : 'Show all steps';
          } else earlier?.remove();

          const byName = {};
          parts.forEach(p => { const n = toolLabel(p.name); byName[n] = (byName[n] || 0) + 1; });
          const detail = Object.entries(byName).sort((a, b) => b[1] - a[1])
            .map(([n, c]) => c > 1 ? `${n} ×${c}` : n).join(', ');
          const head = group.querySelector('.tools-head .sum');
          if (head) {
            // "Worked for 1m 12s" when we know the run time (single group in a finished reply), else "36 steps".
            const groups = this.body.querySelectorAll('.tools').length;
            const secs = m.secs || 0;
            const lead = !m.pending && groups === 1 && secs >= 1 ? `Worked for ${fmtDuration(secs)}`
              : parts.length ? `${parts.length} step${parts.length > 1 ? 's' : ''}` : `${inGroup.length} thought${inGroup.length > 1 ? 's' : ''}`;
            // one icon per kind of action, with how many times it ran
            const byIcon = new Map();
            parts.forEach(p => {
              const ic = stepIcon(p.name), e = byIcon.get(ic) || {n: 0, names: new Set()};
              e.n++; e.names.add(toolLabel(p.name)); byIcon.set(ic, e);
            });
            const items = [...byIcon.entries()].sort((a, b) => b[1].n - a[1].n);
            const shown = items.slice(0, 6), extra = items.slice(6).reduce((a, [, e]) => a + e.n, 0);
            const html = `<span class="lead">${esc(lead)}</span>`
              + shown.map(([ic, e]) => `<span class="ti${ic === 'gemini' ? ' gem' : ''}" title="${esc([...e.names].join(', '))} ×${e.n}">${lineIcon(ic)}<b>${e.n}</b></span>`).join('')
              + (extra ? `<span class="ti more">+${extra}</span>` : '')
              + (failed ? `<span class="ti fail" title="${failed} step${failed > 1 ? 's' : ''} failed">${lineIcon('xMark', 2)}<b>${failed}</b></span>` : '');
            if (head.dataset.html !== html) { head.dataset.html = html; head.innerHTML = html; }
            group.querySelector('.tools-head').title = 'Show the steps Gemini took';
          }
        });
      }
      insert(node) {this.thinkEl && this.thinkEl.parentElement ? this.body.insertBefore(node, this.thinkEl) : this.body.appendChild(node);}
      // While Gemini works, its logo stands on the newest step (or at the "Thinking" line when there is no step
      // yet) and hops down to each new step, like going down stairs. While it writes the answer, the logo stays put
      // on the last step (or beside the start of the answer when there were no steps). Gone when the reply is done.
      placeWalker() {
        const m = this.m, last = m.parts[m.parts.length - 1];
        // Until Gemini has the message (sending / starting), the status line shows a plain spinner; the logo
        // takes its place, fading in, once Gemini is working.
        const pre = m.pending && (m.phase === 'sending' || m.phase === 'starting') && this.thinkEl;
        if (this.thinkEl) this.thinkEl.classList.toggle('pre', !!pre);
        if (pre) {
          if (this.walkerAt && this.walkerAt !== this.thinkEl) this.walkerAt.classList.remove('gw-here', 'gw-host');
          this.walker?.remove();
          this.walker = null; this.walkerPos = null;
          this.thinkEl.classList.add('gw-host'); this.walkerAt = this.thinkEl;
          return;
        }
        let owner = null, pt = null;
        const centre = (el) => { const r = el.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; };
        if (m.pending && last && (last.kind === 'tool' || last.kind === 'thought')) {
          const ico = this.nodes.get(last)?.querySelector('.ico');
          if (ico && ico.getClientRects().length) { owner = ico.closest('.step'); pt = centre(ico); }
        } else if (m.pending && last && last.kind === 'text') {
          const lastStep = [...m.parts].reverse().find(q => q.kind === 'tool' || q.kind === 'thought');
          const stepEl = lastStep && this.nodes.get(lastStep);
          const ico = stepEl?.querySelector('.ico');
          // the steps fold into their summary row once the answer starts: stand on that row, where its arrow is
          const head = stepEl?.closest('.tools.folded')?.querySelector('.tools-head');
          if (ico && ico.getClientRects().length) { owner = stepEl; pt = centre(ico); }
          else if (head && head.getClientRects().length) { owner = head; pt = centre(head.querySelector('.caret') || head); }
          else {
            const node = this.nodes.get(last), r = node?.getBoundingClientRect();
            if (r && r.height) { owner = node; pt = {x: r.left - 14, y: r.top + 11}; }   // in the margin, by the first line
          }
        }
        if (!owner && m.pending && this.thinkEl) {
          this.thinkEl.classList.add('gw-host');            // shows the slot, so it can be measured
          owner = this.thinkEl; pt = centre(this.thinkEl.querySelector('.gw-slot'));
        }
        if (this.walkerAt && this.walkerAt !== owner) this.walkerAt.classList.remove('gw-here', 'gw-host');
        if (!owner) {
          this.walker?.remove();
          this.walker = null; this.walkerAt = null; this.walkerPos = null;
          return;
        }
        if (owner.classList.contains('step') || owner.classList.contains('tools-head')) owner.classList.add('gw-here');
        if (!this.walker) {
          this.walker = gemWalker(); this.el.appendChild(this.walker);
          if (!reduceMotion.matches) {
            this.walker.animate([{opacity: 0, filter: 'blur(3px)'}, {opacity: 1, filter: 'blur(0)'}],
              {duration: 420, easing: 'cubic-bezier(.22, 1, .36, 1)'});
            this.flipWalker(true);                          // it arrives flipping like a tossed coin
          }
        }
        const host = this.el.getBoundingClientRect();
        const x = Math.round(pt.x - host.left - 10), y = Math.round(pt.y - host.top - 10);
        const prev = this.walkerPos, moved = this.walkerAt !== owner;
        this.walkerAt = owner;
        if (prev && prev.x === x && prev.y === y) return;
        this.walkerPos = {x, y};
        const to = `translate(${x}px, ${y}px)`;
        const hopNow = prev && !reduceMotion.matches && moved;
        this.walker.style.transform = to;                 // first placement or a page reflow: straight into place
        if (!hopNow) return;
        // the hop: glide to the new spot while jumping up and coming down on it, then squash on landing
        const dist = Math.hypot(x - prev.x, y - prev.y);
        const dur = Math.round(Math.min(720, 380 + dist * 2.2));
        const lift = Math.round(Math.min(22, 9 + dist * .12));
        this.walker.animate([{transform: `translate(${prev.x}px, ${prev.y}px)`}, {transform: to}],
          {duration: dur, easing: 'cubic-bezier(.45, 0, .25, 1)'});
        const hop = this.walker.firstElementChild;
        hop.getAnimations().forEach(a => a.cancel());
        hop.animate([
          {transform: 'translateY(0) scale(1.08, .92)', easing: 'cubic-bezier(.2, .7, .4, 1)'},
          {transform: `translateY(${-lift}px) scale(.94, 1.07)`, offset: .45, easing: 'cubic-bezier(.6, 0, .8, .4)'},
          {transform: 'translateY(0) scale(1, 1)'},
        ], {duration: dur}).onfinish = () => hop.animate([
          {transform: 'scale(1.16, .84)'}, {transform: 'scale(.95, 1.05)'}, {transform: 'none'},
        ], {duration: 300, easing: 'ease-out'});
      }
      // A coin flip of the logo: two turns around its vertical axis, slowing as it lands. On arrival it also
      // grows into place; while Gemini thinks it flips again every few seconds (never in the middle of a hop).
      flipWalker(arrive) {
        const hop = this.walker?.firstElementChild;
        if (!hop || reduceMotion.matches) return;
        this.nextFlip = Date.now() + 3500 + Math.random() * 2500;
        if (!arrive && hop.getAnimations().some(a => a.playState === 'running')) return;
        const s = arrive ? [.7, 1.1] : [1, 1.08];
        hop.animate([
          {transform: `perspective(60px) rotateY(0deg) scale(${s[0]})`},
          {transform: `perspective(60px) rotateY(540deg) scale(${s[1]})`, offset: .65},
          {transform: 'perspective(60px) rotateY(720deg) scale(1)'},
        ], {duration: 900, easing: 'cubic-bezier(.2, .7, .3, 1)'});
      }
      renderThinking() {
        const m = this.m, last = m.parts[m.parts.length - 1];
        
        // Find the user message element (it's immediately before this assistant message wrapper)
        const userMsg = this.el.previousElementSibling;
        if (userMsg && userMsg.classList.contains('user')) {
          userMsg.classList.toggle('sending', !!m.pending && m.phase === 'sending');
        }

        const show = m.pending && (!last || last.kind !== 'text');
        if (!show) {if (this.thinkEl) {this.thinkEl.remove(); this.thinkEl = null; clearInterval(this.tick);} return;}
        // "Thinking" while Gemini works on its answer (before its first output and between steps); "Waiting"
        // only while it waits for a command it ran to finish.
        let label = 'Thinking', sub = '', waiting = false;
        const idle = (Date.now() - (m.lastEventAt || this.start)) / 1000;
        const toolRunning = last && last.kind === 'tool' && !last.status;
        if (m.netRetry && Date.now() - m.netRetry.at < 90000) {
          label = 'Reconnecting to Google';
          sub = `attempt ${m.netRetry.attempt + 1} · ${m.netRetry.reason}`;
        } else if (m.phase === 'sending' || m.phase === 'starting') {
          // the request is on its way to the app, which is launching the Gemini CLI: shown with the same shimmer
          // as "Thinking" (a reopened running chat is reconnecting instead)
          label = m.attached ? 'Reconnecting to Gemini CLI' : 'Calling Gemini CLI'; waiting = true;
        } else if (toolRunning && /shell|command/i.test(last.name)) {
          label = 'Waiting for the command to finish'; waiting = true;
          sub = last.params?.description || shortArg(last.params);
        } else if (toolRunning) {
          label = ({Read: 'Reading', List: 'Listing', Search: 'Searching', Run: 'Running', Write: 'Writing', Edit: 'Editing', Fetch: 'Fetching', 'Find files': 'Finding files', 'Read files': 'Reading files', 'Web search': 'Searching the web'})[toolLabel(last.name)] || (mcpParts(last.name) ? 'Using ' + prettyServer(mcpParts(last.name).server) : 'Working');
          sub = last.params?.description || baseName(shortArg(last.params));
        } else if (last && last.kind === 'thought') {
          label = last.subject || 'Thinking';
        }
        // nothing has come back for a while: say so, so a stuck request is easy to tell apart from work
        if (!toolRunning && !sub && idle >= 20) sub = `no reply for ${fmtDuration(idle)}`;
        if (!this.thinkEl) {
          this.thinkEl = document.createElement('div'); this.thinkEl.className = 'thinking';
          this.thinkEl.innerHTML = `<span class="gw-slot"></span><span class="shimmer"></span><span class="sub"></span><span class="timer"></span>`;
          this.body.appendChild(this.thinkEl);
          const timer = this.thinkEl.querySelector('.timer');
          this.tick = setInterval(() => {timer.textContent = fmtDuration((Date.now() - this.start) / 1000); this.renderThinking(); this.placeWalker();}, 250);
        }
        this.thinkEl.classList.toggle('waiting', waiting);
        // Only real thinking makes the logo flip now and then: before the first step, or on a thought step.
        // Doing a task (a tool or command running, or just finished with the next step not yet in) does not.
        const thinking = !waiting && !m.netRetry && (!last || last.kind === 'thought');
        if (thinking && this.walker && Date.now() >= (this.nextFlip || 0)) this.flipWalker();
        else if (!thinking) this.nextFlip = Date.now() + 1500;   // after a task, a short pause before flipping again
        const sh = this.thinkEl.querySelector('.shimmer'), sb = this.thinkEl.querySelector('.sub');
        if (sh.textContent !== label) sh.textContent = label;
        if (sb.textContent !== sub) {
          const ticking = sub.startsWith('no reply') && sb.textContent.startsWith('no reply');   // only the count moved
          sb.textContent = sub;
          if (!ticking) { sb.style.animation = 'none'; sb.offsetHeight; sb.style.animation = ''; }
        }
      }
    }

    function updateToBottom() {
      const c = $('chat'), far = c.scrollHeight - c.scrollTop - c.clientHeight > 300;
      $('toBottom').classList.toggle('show', far);
      $('toBottom').classList.toggle('live', far && busy);
    }
    $('chat').addEventListener('scroll', updateToBottom, {passive: true});
    $('toBottom').onclick = () => $('chat').scrollTo({top: $('chat').scrollHeight, behavior: 'smooth'});
    new ResizeObserver(updateToBottom).observe($('log'));
    // the message box floats over the chat; keep the chat's bottom padding equal to its height (it grows with
    // long messages and attachments), and stay at the bottom if that is where the reader was
    new ResizeObserver(() => {
      const c = $('chat'), atBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 40;
      document.querySelector('main').style.setProperty('--composer-h', document.querySelector('.composer-wrap').offsetHeight + 'px');
      if (atBottom) c.scrollTop = c.scrollHeight;
    }).observe(document.querySelector('.composer-wrap'));
    function scrollDown(force) {
      const c = $('chat');
      if (force || c.scrollHeight - c.scrollTop - c.clientHeight < 180) c.scrollTo({top: c.scrollHeight, behavior: force ? 'smooth' : 'auto'});
    }

