    // ---------- quick replies ----------
    // Gemini CLI disables its interactive ask_user tool in headless mode, so it asks in plain text.
    // When the reply ends with a question, offer its options (or Yes/No) as one-click answers.
    function questionOptions(text) {
      const lines = String(text || '').trim().split('\n');
      const clean = (s) => s.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
      let q = -1;
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
        if (/\?\s*$/.test(clean(lines[i]))) { q = i; break; }
      }
      if (q < 0) return [];
      const ITEM = /^\s*(?:\d+[.)]|[-*•]|[a-z][.)])\s+(.+)$/i;
      const collect = (from, step) => {
        const out = [];
        for (let i = from; i >= 0 && i < lines.length; i += step) {
          if (!lines[i].trim()) { if (out.length) break; else continue; }
          const m = lines[i].match(ITEM);
          if (!m) break;
          out.push(clean(m[1]));
        }
        return step < 0 ? out.reverse() : out;
      };
      let opts = collect(q + 1, 1);                   // question, then the options
      if (opts.length < 2) opts = collect(q - 1, -1); // options, then the question
      opts = opts.filter(o => o.length && o.length <= 140).slice(0, 6);
      if (opts.length >= 2) return opts;
      const question = clean(lines[q]).replace(/^.*[.:!]\s+(?=\S[^.:!]*\?$)/, ''); // last sentence only
      if (/^(do|does|did|should|shall|would|will|can|could|may|is|are|want)\b|\b(proceed|go ahead|continue|confirm|like me to|want me to|should i|shall i)\b/i.test(question)) return ['Yes', 'No'];
      return [];
    }
    function addQuickReplies(view, msg) {
      if (!view || !msg || msg.pending) return;
      const last = [...msg.parts].reverse().find(p => p.kind === 'text');
      const opts = last ? questionOptions(last.text) : [];
      if (!opts.length) return;
      const box = document.createElement('div'); box.className = 'quick';
      opts.forEach((o, i) => {
        const b = document.createElement('button'); b.className = 'quick-btn';
        b.style.animationDelay = (i * 50) + 'ms';
        b.textContent = o; b.title = 'Answer: ' + o;
        b.onclick = () => { if (busy) return; $('input').value = o; autosize(); send(); };
        box.appendChild(b);
      });
      const other = document.createElement('button'); other.className = 'quick-btn ghosted';
      other.textContent = 'Something else…';
      other.onclick = () => $('input').focus();
      box.appendChild(other);
      view.body.appendChild(box);
    }

    // Turn CLI stack traces into one readable line.
    function netMessage(reason) {
      return `Can't reach Google's Gemini service (${reason || 'the connection was dropped'}). `
        + 'This is a network problem between this PC and Google, not the app: the connection goes through your company '
        + 'VPN/proxy, which dropped it. Check the VPN is connected (reconnect it if needed), then send again.';
    }
    function cleanError(text) {
      const t = String(text);
      if (/ECONNRESET|socket hang up|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|TLS connection|network socket disconnected/i.test(t)) {
        return netMessage((t.match(/reason: ([^\n]+)/) || [])[1]);
      }
      if (/ending with a model turn are not supported/.test(t)) {
        return 'This chat is in a state Gemini cannot resume: its last saved turn is the model\'s, usually after a '
          + 'reply that failed or came back empty. Send another message to continue, or start a new chat if it repeats.';
      }
      if (/ModelNotFoundError|Requested entity was not found/.test(t)) return `Model "${$('model').value}" isn't available for your account. Pick another model from the model menu.`;
      if (/429|RESOURCE_EXHAUSTED|quota/i.test(t)) return 'Rate limit or quota reached. Wait a moment or switch to a Flash model.';
      const lines = t.split('\n').filter(l => !/^\s+at\s|^\s*[{}]\s*$|^\s*code:/.test(l));
      return lines.join('\n').replace(/Full report available at: \S+\s*/, '').trim() || t;
    }
    function setBusy(b) {
      busy = b;
      const s = $('send');
      s.classList.remove('stopping');
      s.classList.toggle('stop', b);
      s.title = b ? 'Stop' : 'Send';
      s.innerHTML = b ? ICON_STOP : ICON_SEND;
      s.disabled = !b && !$('input').value.trim() && !attachments.length;
      if (typeof updateToBottom === 'function') updateToBottom();
    }
    $('send').onclick = () => {
      if (busy) {
        if ($('send').classList.contains('stopping')) return;
        $('send').classList.add('stopping'); $('send').title = 'Stopping…';
        $('send').innerHTML = '<span class="stop-spin"></span>';        // a spinner until the run has really ended
        fetch('/api/stop', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({runId})}); controller?.abort();
      }
      else send();
    };
    // At a zoom other than 100% scrollHeight is rounded and can sit a pixel over the box, which showed an empty
    // scrollbar; the scrollbar only appears once the text is taller than the box's max height.
    function autosize() {const t = $('input'); t.style.height = 'auto'; const h = t.scrollHeight; t.style.height = h + 'px';
      t.style.overflowY = h > parseFloat(getComputedStyle(t).maxHeight) + 1 ? 'auto' : 'hidden'; if (!busy) $('send').disabled = !t.value.trim() && !attachments.length;
      mirrorUpdate();}
    $('input').addEventListener('scroll', () => { $('inMirror').scrollTop = $('input').scrollTop; });
    $('input').addEventListener('input', (e) => {
      autosize(); saveDraft();
      if (e.isTrusted && dictation && !e.inputType?.startsWith('insertFromDictation')) stopDictation();   // typing takes over
    });

    // ---------- drafts ----------
    // What you type (and attach) is kept per chat, so a refresh or switching chats never loses it.
    // Cleared when the message is sent; drafts untouched for 30 days are dropped.
    const draftKey = () => 'gui.draft:' + (current?.id || 'new');
    let draftRestoring = false;
    function dropDraft(key) { try { localStorage.removeItem(key); } catch {} }
    function saveDraft() {
      if (draftRestoring) return;
      const text = $('input').value;
      if (text.trim() || attachments.length) store.set(draftKey(), {text, attachments, at: Date.now()});
      else dropDraft(draftKey());
    }
    function restoreDraft() {
      stopDictation();
      const d = store.get(draftKey(), null);
      draftRestoring = true;
      $('input').value = d?.text || '';
      attachments = Array.isArray(d?.attachments) ? d.attachments : [];
      renderAttachments(); autosize();
      draftRestoring = false;
    }
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith('gui.draft:') && Date.now() - (store.get(k, {}).at || 0) > 30 * 864e5) dropDraft(k);
      }
    } catch {}

    // ---------- voice input ----------
    // Uses the browser's speech recognition (Chrome / Edge; the browser sends the audio to its speech service).
    // Words appear live at the cursor; click the mic again, press Esc, start typing, or send to stop.
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    let dictation = null;
    $('micBtn').hidden = !SpeechRec;
    function stopDictation() { if (dictation) { dictation._endChime?.(); dictation.stop(); } }   // the stop sound plays at once too
    // Two soft, warm notes made on the fly (no sound files): up = listening, down = stopped. Each note is a
    // low sine with a quiet triangle an octave below for body, through a low-pass so it is round, not bright.
    // The audio engine is woken on pointerdown, so the sound plays the moment you click.
    let chimeCtx = null;
    function chimeReady() {
      try {
        chimeCtx = chimeCtx || new (window.AudioContext || window.webkitAudioContext)({latencyHint: 'interactive'});
        if (chimeCtx.state === 'suspended') chimeCtx.resume();
      } catch {}
      return chimeCtx;
    }
    function chime(up) {
      const ctx = chimeReady();
      if (!ctx) return;
      try {
        const t0 = ctx.currentTime + .005;
        const out = ctx.createBiquadFilter();
        out.type = 'lowpass'; out.frequency.value = 1600; out.Q.value = .4;
        out.connect(ctx.destination);
        (up ? [392, 523.25] : [523.25, 392]).forEach((freq, i) => {     // G4 → C5, or back down
          const at = t0 + i * .075;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(.16, at + .01);
          gain.gain.exponentialRampToValueAtTime(.0001, at + .42);
          gain.connect(out);
          [['sine', freq, 1], ['triangle', freq / 2, .35]].forEach(([type, f, level]) => {
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.type = type; osc.frequency.value = f; g.gain.value = level;
            osc.connect(g).connect(gain);
            osc.start(at); osc.stop(at + .45);
          });
        });
      } catch {}
    }
    $('micBtn').addEventListener('pointerdown', chimeReady);
    function startDictation() {
      const t = $('input');
      const rec = new SpeechRec();
      rec.lang = store.get('gui.dictLang', 'en-US') || navigator.language || 'en-US';
      rec.interimResults = true;
      rec.continuous = true;
      const before = t.value.slice(0, t.selectionStart), after = t.value.slice(t.selectionEnd);
      const prevPlaceholder = t.placeholder;
      const sep = before && !/\s$/.test(before) ? ' ' : '';
      let heard = '', ended = false;
      chime(true);                                               // right away, not when the speech service answers
      const endChime = () => { if (!ended) { ended = true; chime(false); } };
      rec._endChime = endChime;
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) heard += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
        }
        const spoken = (heard + interim).replace(/^\s+/, '').replace(/\s+/g, ' ');
        const tail = spoken && after && !/^\s/.test(after) ? ' ' : '';
        t.value = before + (spoken ? sep : '') + spoken + tail + after;
        const pos = (before + (spoken ? sep : '') + spoken).length;
        t.setSelectionRange(pos, pos);
        autosize(); saveDraft();
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
          alert('The microphone is blocked for this page. Allow it from the icon at the left of the address bar, then try again.');
        else if (e.error === 'network') alert('Voice input needs an internet connection: the browser sends the audio to its speech service.');
        else if (e.error === 'audio-capture') alert('No microphone was found.');
      };
      rec.onend = () => {
        endChime();
        if (dictation === rec) dictation = null;
        $('micBtn').classList.remove('on');
        if (t.placeholder === 'Listening… speak now') t.placeholder = prevPlaceholder;
      };
      dictation = rec;
      rec.start();
      $('micBtn').classList.add('on');
      t.placeholder = 'Listening… speak now';
      t.focus();
    }
    $('micBtn').onclick = () => (dictation ? stopDictation() : startDictation());
    $('input').addEventListener('keydown', (e) => { if (e.key === 'Escape' && dictation) { e.preventDefault(); stopDictation(); } });
    $('input').addEventListener('keydown', e => {if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {e.preventDefault(); send();} });
    // Shift+Tab cycles the mode like the CLI: Auto-approve → Auto-edit → Plan
    $('input').addEventListener('keydown', e => { if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); cycleMode(); } });

    // ---------- "Next prompt" suggestion ----------
    // Gemini's replies end with a "Next prompt:" line and a code block holding a ready-to-send message. Once the
    // reply is done, that message is shown as the empty box's placeholder; Tab puts it in the box (it is not
    // sent), Esc dismisses it. It belongs to the last reply only: sending, a new reply, or another chat clears it.
    const NEXT_PROMPT_LINES = 3, NEXT_PROMPT_CHARS = 240;
    // Reads the reply's own markdown (not the rendered page), so code fences are seen as fences.
    const NP_LABEL = /^\s*(?:[*_]{1,2}\s*)?next prompt\s*:?\s*(?:[*_]{1,2})?\s*:?\s*$/i;
    const NP_FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;        // ``` or ```vbnet (also ~~~)
    const NP_STEP = /^\s*(?:[*_]{1,2})?\s*(?:topic|step)\s*:\s*(?:[*_]{1,2})?\s*/i;
    function findNextPrompt(text) {
      const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
      // which lines sit inside a code block, and where each block closes
      const inBlock = [], closeOf = [];
      let open = -1, mark = '';
      lines.forEach((l, i) => {
        const f = l.match(NP_FENCE);
        if (open < 0 && f) { open = i; mark = f[1]; inBlock[i] = false; return; }
        if (open >= 0 && f && f[1][0] === mark[0] && f[1].length >= mark.length && !f[2]) { closeOf[open] = i; open = -1; inBlock[i] = false; return; }
        inBlock[i] = open >= 0;
      });
      let at = -1;
      for (let i = lines.length - 1; i >= 0; i--) if (NP_LABEL.test(lines[i])) { at = i; break; }
      if (at < 0) return null;
      let body;
      if (inBlock[at]) {
        // "Next prompt:" is the first line inside the block: the rest of that block
        let end = at + 1;
        while (end < lines.length && !(lines[end].match(NP_FENCE) && !inBlock[end])) end++;
        body = lines.slice(at + 1, end);
      } else {
        let i = at + 1;
        while (i < lines.length && !lines[i].trim()) i++;
        if (i < lines.length && lines[i].match(NP_FENCE)) body = lines.slice(i + 1, closeOf[i] ?? lines.length);
        else body = lines.slice(i);
      }
      // never keep fence lines (or a fence stuck to the end of the text), nor a repeated label
      body = body.filter(l => !NP_FENCE.test(l)).map(l => l.replace(/\s*(`{3,}|~{3,})\s*$/, ''));
      while (body.length && (!body[0].trim() || NP_LABEL.test(body[0]))) body.shift();
      // "Topic: …" / "Step: …" on every line: drop the labels and make one sentence of them
      const used = body.filter(l => l.trim());
      if (used.length && used.every(l => NP_STEP.test(l))) {
        const parts = used.map(l => l.replace(NP_STEP, '').trim()).filter(Boolean);
        return parts.map((p, k) => k < parts.length - 1 && !/[.!?:;,]$/.test(p) ? p + '.' : p).join(' ') || null;
      }
      const s = body.join('\n').trim();
      return s || null;
    }
    function nextPromptPreview(s) {
      const lines = s.split('\n');
      let out = lines.slice(0, NEXT_PROMPT_LINES).join('\n');
      const cut = lines.length > NEXT_PROMPT_LINES || out.length > NEXT_PROMPT_CHARS;
      if (out.length > NEXT_PROMPT_CHARS) out = out.slice(0, NEXT_PROMPT_CHARS).trimEnd();
      return out + (cut ? '…' : '');
    }
    function setNextPrompt(s) {
      const had = nextPrompt !== null;
      nextPrompt = s || null;
      if (nextPrompt) $('input').placeholder = nextPromptPreview(nextPrompt);
      else if (had) syncPills();                         // back to "Ask anything, / for actions" (or the mode's text)
      autosize();
    }
    $('input').addEventListener('keydown', (e) => {
      if (!nextPrompt || $('input').value || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const t = $('input'), s = nextPrompt;
        t.value = s; t.setSelectionRange(s.length, s.length);
        t.dispatchEvent(new Event('input', {bubbles: true}));    // resize and keep the draft, like typing
      } else if (e.key === 'Escape' && !dictation) { e.preventDefault(); setNextPrompt(null); }
    });
    $('newChat').onclick = newChat;
    const closeSide = () => {$('side').classList.remove('open'); $('scrim').classList.remove('open');};
    const isMobile = () => matchMedia('(max-width:760px)').matches;
    const SIDE_MIN = 200, SIDE_MAX = 520, SIDE_DEFAULT = 264;
    function setSideWidth(w, persist) {
      w = Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, w)));
      document.documentElement.style.setProperty('--side-w', w + 'px');
      if (persist) store.set('gui.sideW', w);
    }
    setSideWidth(store.get('gui.sideW', SIDE_DEFAULT));
    $('resizer').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startX = e.clientX, startW = $('side').getBoundingClientRect().width;
      document.body.classList.add('resizing');
      const move = (ev) => {
        const w = startW + ev.clientX - startX;
        if (w < SIDE_MIN - 80) {setCollapsed(true); up(); return;} // drag far left to collapse
        setSideWidth(w);
      };
      const up = () => {
        document.body.classList.remove('resizing');
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        setSideWidth($('side').getBoundingClientRect().width || SIDE_DEFAULT, true);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    $('resizer').addEventListener('dblclick', () => setSideWidth(SIDE_DEFAULT, true));
    // Tight window: the sidebar is always "collapsed" (out of the layout, floating over the chat when shown) and
    // starts closed; opening it pins it over the page until you close it. The saved open/closed choice is only
    // used on wide windows.
    const tight = matchMedia('(min-width:761px) and (max-width:1100px)');
    function setCollapsed(c) {
      const b = document.body;
      b.classList.remove('peek', 'pinned');
      if (tight.matches) {
        b.classList.add('collapsed');
        if (!c) b.classList.add('peek', 'pinned');
        return;
      }
      b.classList.toggle('collapsed', c); store.set('gui.collapsed', c);
    }
    const sideIsOpen = () => tight.matches ? document.body.classList.contains('pinned') : !document.body.classList.contains('collapsed');
    function applyWindowMode() {
      const b = document.body;
      b.classList.remove('peek', 'pinned');
      if (tight.matches) { b.classList.add('collapsed'); if ($('diffPanel').classList.contains('open')) closeDiffPanel(); }
      else b.classList.toggle('collapsed', !!store.get('gui.collapsed', false));
    }
    // Peek: while the sidebar is closed, hovering the left edge or the open-sidebar button shows it over the page;
    // it hides again shortly after the pointer leaves it (not while one of its menus is open).
    {
      let peekOff = 0;
      const peek = () => {
        clearTimeout(peekOff);
        if (document.body.classList.contains('collapsed') && !isMobile()) document.body.classList.add('peek');
      };
      const unpeek = () => {
        clearTimeout(peekOff);
        peekOff = setTimeout(() => {
          if (document.body.classList.contains('pinned') || chatMenuRow || $('side').matches(':hover') || $('settings').classList.contains('open')) return;
          document.body.classList.remove('peek');
        }, 300);
      };
      $('side').addEventListener('pointerenter', () => clearTimeout(peekOff));
      $('side').addEventListener('pointerleave', unpeek);
    }
    applyWindowMode();
    tight.addEventListener('change', applyWindowMode);
    // a pinned floating sidebar closes when you click the page behind it
    document.addEventListener('pointerdown', (e) => {
      if (document.body.classList.contains('pinned') && !$('side').contains(e.target) && !$('menu').contains(e.target)) setCollapsed(true);
    });
    $('menu').onclick = () => {if (isMobile()) {$('side').classList.add('open'); $('scrim').classList.add('open');} else setCollapsed(sideIsOpen());};
    // While the sidebar is only peeking (shown over the page by hovering), this same button pins it open.
    $('collapse').onclick = () => {
      if (isMobile()) closeSide();
      else if (tight.matches) setCollapsed(document.body.classList.contains('pinned'));
      else setCollapsed(!document.body.classList.contains('peek'));
    };
    $('collapse').addEventListener('pointerenter', () => {
      $('collapse').title = document.body.classList.contains('peek') ? 'Keep sidebar open (Ctrl+B)' : 'Close sidebar (Ctrl+B)';
    });
    document.addEventListener('keydown', e => {if ((e.ctrlKey || e.metaKey) && e.key === 'b') {e.preventDefault(); isMobile() ? $('menu').click() : setCollapsed(sideIsOpen());} });
    $('scrim').onclick = closeSide;
    document.addEventListener('keydown', e => {if (e.key === 'Escape') {$('picker').classList.remove('open'); $('quotaPop').classList.remove('open'); closeDiffPanel(); closeSettings(); closeSide(); if (document.body.classList.contains('pinned')) setCollapsed(true);} });

    // ---------- folder / file picker ----------
    // mode 'folder' picks the working directory; mode 'file' attaches files for Gemini to read.
    let pickPath = '', pickMode = 'folder';
    async function loadDir(p) {
      const d = await (await fetch('/api/dirs?path=' + encodeURIComponent(p || ''))).json();
      if (d.error) {$('dirs').innerHTML = `<div class="note">${esc(d.error)}</div>`; return;}
      pickPath = d.path;
      $('pPath').value = d.path || ''; $('pTag').innerHTML = d.isGit ? '<span class="tag">git</span>' : '';
      $('up').disabled = d.parent === null; $('up').style.opacity = d.parent === null ? .3 : 1;
      $('up').onclick = () => loadDir(d.parent);
      $('dirs').innerHTML = '';
      d.dirs.forEach((x, i) => {
        const el = document.createElement('div'); el.className = 'dir';
        el.style.animationDelay = Math.min(i * 12, 240) + 'ms';
        el.innerHTML = `<svg><use href="#i-folder"/></svg>${esc(x.name)}`;
        el.onclick = () => loadDir(x.path);
        $('dirs').appendChild(el);
      });
      if (pickMode === 'file') {
        (d.files || []).forEach(f => {
          const el = document.createElement('div'); el.className = 'dfile-pick';
          el.title = f.path;
          el.innerHTML = (IMG_RE.test(f.name)
            ? `<img class="thumb" style="width:20px;height:20px;border-radius:4px;object-fit:cover" src="${esc(fileUrl(f))}" alt="">`
            : `<svg style="width:14px;height:14px;color:var(--muted)" viewBox="0 0 24 24">
              <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"
                d="M6.5 4.5a1 1 0 0 1 1-1H14l4.5 4.5v11.5a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1z"/></svg>`)
            + `<span class="n">${esc(f.name)}</span><span class="sz">${esc(fmtSize(f.size))}</span>`;
          el.onclick = () => { addAttachment(f); $('picker').classList.remove('open'); $('input').focus(); };
          $('dirs').appendChild(el);
        });
      }
    }
    function openPicker(mode) {
      pickMode = mode || 'folder';
      $('pTitle').textContent = pickMode === 'file' ? 'Attach a file' : 'Choose working directory';
      $('pSelect').hidden = pickMode === 'file';
      $('picker').classList.add('open');
      loadDir($('cwd').value.trim());
    }
    // The real Windows dialogs (asked of the server, which can return real paths); the in-page picker is the
    // fallback when they are not available (another OS, or a server that has not been restarted yet).
    async function nativePick(mode) {
      let r;
      try {
        const res = await fetch('/api/pick', {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({mode, start: $('cwd').value.trim(), title: mode === 'folder' ? 'Choose the working folder' : 'Attach files'})});
        r = res.ok ? await res.json() : {unsupported: true};
      } catch { r = {unsupported: true}; }
      if (r.busy) { toast('A Windows dialog is already open (it may be behind this window)'); return null; }
      return r.unsupported ? false : r;
    }
    let picking = false;
    async function pickWith(btn, mode, fallback, use) {
      if (picking) return;
      picking = true; btn.classList.add('picking');
      const r = await nativePick(mode);
      picking = false; btn.classList.remove('picking');
      if (r === false) return fallback();
      if (r?.paths?.length) use(r);
    }
    $('browse').onclick = () => {
      if ($('cwd').disabled) return;
      pickWith($('browse'), 'folder', () => openPicker('folder'), (r) => { $('cwd').value = r.paths[0]; saveSettings(); });
    };
    $('attachBtn').onclick = () => pickWith($('attachBtn'), 'files', () => openPicker('file'),
      (r) => { r.files.forEach(addAttachment); $('input').focus(); });
    $('pPath').addEventListener('keydown', e => {if (e.key === 'Enter') loadDir($('pPath').value.trim());});
    $('pCancel').onclick = () => $('picker').classList.remove('open');
    $('picker').onclick = (e) => {if (e.target === $('picker')) $('picker').classList.remove('open');};
    $('pSelect').onclick = () => {if (!pickPath) return; $('cwd').value = pickPath; saveSettings(); $('picker').classList.remove('open');};

    // ---------- themed dropdown ----------
    // Replaces the browser's native <select> popup. The <select> stays in the page as the source of truth
    // (value + change events), so existing code is untouched; only its popup is swapped for this menu.
    const selMenu = document.createElement('div');
    selMenu.className = 'selmenu';
    document.body.appendChild(selMenu);
    let selTarget = null, selItems = [], selHi = -1;
    const CHECK = '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

    function closeSelMenu() {
      selMenu.classList.remove('open');
      selTarget = null; selItems = []; selHi = -1;
    }
    function highlightSel(i) {
      selHi = i;
      selItems.forEach((it, k) => it.el.classList.toggle('hi', k === i));
      selItems[i]?.el.scrollIntoView({block: 'nearest'});
    }
    function chooseSel(i) {
      const it = selItems[i]; if (!it || !selTarget) return;
      const sel = selTarget;
      closeSelMenu();
      if (sel.value !== it.value) {
        sel.value = it.value;
        sel.dispatchEvent(new Event('change', {bubbles: true}));
      }
      sel.focus();
    }
    function openSelMenu(sel) {
      if (selTarget === sel) return closeSelMenu();
      closeSelMenu();
      selTarget = sel;
      selMenu.innerHTML = '';
      const addOpt = (o) => {
        const el = document.createElement('div');
        el.className = 'opt' + (o.value === sel.value ? ' sel' : '');
        el.innerHTML = `<span>${esc(o.textContent)}</span>` + (o.value === sel.value ? CHECK : '');
        if (o.style.fontFamily) el.style.fontFamily = o.style.fontFamily; // font pickers preview each font
        const idx = selItems.length;
        el.onmouseenter = () => highlightSel(idx);
        el.onclick = (e) => { e.stopPropagation(); chooseSel(idx); };
        selItems.push({value: o.value, el});
        selMenu.appendChild(el);
      };
      [...sel.children].forEach(ch => {
        if (ch.tagName === 'OPTGROUP') {
          const g = document.createElement('div'); g.className = 'grp'; g.textContent = ch.label;
          selMenu.appendChild(g);
          [...ch.children].forEach(addOpt);
        } else addOpt(ch);
      });

      selMenu.classList.add('open');
      placeSelMenu(true);
      highlightSel(Math.max(0, selItems.findIndex(it => it.value === sel.value)));
    }
    // Position next to the pill/field, flipping upward near the bottom and right-aligning near the edge.
    // Runs again on page scroll/resize so the menu follows its button instead of vanishing.
    function placeSelMenu(first) {
      if (!selTarget) return;
      const anchorEl = selTarget.closest('.pill') || selTarget;
      const anchor = anchorEl.getBoundingClientRect();
      if (!first && (anchor.bottom < 0 || anchor.top > innerHeight)) return closeSelMenu(); // button scrolled away
      if (first) selMenu.style.minWidth = Math.max(170, Math.round(anchor.width)) + 'px';
      const w = selMenu.offsetWidth, h = selMenu.offsetHeight;
      const below = innerHeight - anchor.bottom, above = anchor.top;
      const top = below >= h + 8 || below >= above ? Math.min(anchor.bottom + 6, innerHeight - h - 8) : Math.max(8, anchor.top - h - 6);
      let left = anchor.left;
      if (left + w > innerWidth - 8) left = Math.max(8, anchor.right - w);
      selMenu.style.top = top + 'px';
      selMenu.style.left = left + 'px';
    }
    // take over the native popup
    document.addEventListener('mousedown', (e) => {
      const sel = e.target.closest?.('select');
      if (sel) { e.preventDefault(); sel.focus(); openSelMenu(sel); return; }
      if (selTarget && !e.target.closest('.selmenu')) closeSelMenu();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (selTarget) {
        if (e.key === 'ArrowDown') { e.preventDefault(); highlightSel(Math.min(selItems.length - 1, selHi + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); highlightSel(Math.max(0, selHi - 1)); }
        else if (e.key === 'Enter') { e.preventDefault(); chooseSel(selHi); }
        else if (e.key === 'Escape') { e.stopPropagation(); closeSelMenu(); }
        else if (e.key === 'Tab') closeSelMenu();
        return;
      }
      const sel = document.activeElement;
      if (sel?.tagName === 'SELECT' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSelMenu(sel); }
    }, true);
    window.addEventListener('resize', () => placeSelMenu());
    // Scrolling inside the menu (long lists) must not close it; other scrolling just moves it with its button.
    document.addEventListener('scroll', (e) => {
      if (!selTarget || (e.target instanceof Node && selMenu.contains(e.target))) return;
      placeSelMenu();
    }, true);

    // A new, empty chat centres the welcome screen and the message box; any message moves the box to the bottom.
    new MutationObserver(() => document.querySelector('main').classList.toggle('fresh', !!$('log').querySelector(':scope > .empty')))
      .observe($('log'), {childList: true});
    const startChat = new URLSearchParams(location.search).get('chat');
    syncPills(); setBusy(false); if (startChat) renderLoading(); else renderEmpty(); updateHint(); restoreDraft(); loadChanges(); loadQuota(); loadModels();

    // Restore the chat from the URL (?chat=<session id>) so a reload lands where you were.
    (async () => {
      await loadSessions();
      let wanted = new URLSearchParams(location.search).get('chat');
      if (!wanted) {
        // reloaded right after starting a new chat, before it got its id: wait for that run to report it
        const newRun = store.get('gui.newRun', null);
        store.set('gui.newRun', null);
        if (!newRun) return;
        for (let i = 0; i < 20 && !wanted && !current; i++) {
          let r = null;
          try { r = (await (await fetch('/api/runs')).json()).find(x => x.runId === newRun); } catch {}
          if (!r || r.done) break;
          if (r.sessionId) wanted = r.sessionId; else await new Promise(ok => setTimeout(ok, 500));
        }
        if (!wanted || current) return;
        await loadSessions();
      }
      const found = sessions.find(s => s.id === wanted);
      if (found) return openSession(found);
      const gone = () => { setUrlSession(null); if (!current) renderEmpty(); };   // the chat no longer exists
      try { // not in the list (e.g. an automated run): load it directly
        const d = await (await fetch('/api/history?id=' + encodeURIComponent(wanted))).json();
        if (d.cwd) openSession({id: wanted, title: d.messages?.[0]?.text?.slice(0, 80) || 'Chat', cwd: d.cwd});
        else gone();
      } catch { gone(); }
    })();
