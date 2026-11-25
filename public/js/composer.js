    // ---------- attachments ----------
    // Gemini reads files given as @path, so an attachment is just a path. Files dropped from the desktop
    // are uploaded first (the browser never exposes their real path), files picked from the browse dialog
    // are referenced where they already are.
    let attachments = []; // [{name, path, size}]
    const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i;
    const fileUrl = (f) => '/api/file?path=' + encodeURIComponent(f.path) + '&cwd=' + encodeURIComponent($('cwd').value.trim());
    function thumbFor(f) {
      if (!IMG_RE.test(f.name || f.path)) return '';
      return `<img class="thumb" src="${esc(fileUrl(f))}" alt="">`;
    }
    let lightboxScale = 0.75;
    $('lightbox').onclick = () => $('lightbox').classList.remove('on');
    $('lightbox').addEventListener('wheel', (e) => {
      e.preventDefault();
      lightboxScale *= e.deltaY < 0 ? 1.15 : 0.85;
      lightboxScale = Math.max(0.1, Math.min(lightboxScale, 15));
      $('lightbox').querySelector('img').style.transform = `scale(${lightboxScale})`;
    });
    function showImage(src) {
      lightboxScale = 0.75;
      const img = $('lightbox').querySelector('img');
      img.style.transform = `scale(${lightboxScale})`;
      img.src = src;
      $('lightbox').classList.add('on');
    }
    const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
    function renderAttachments() {
      const row = $('attachRow');
      row.innerHTML = '';
      attachments.forEach((f, i) => {
        const el = document.createElement('span');
        el.className = 'attach-chip';
        el.title = f.sel ? f.path + (f.lines ? ' · lines ' + f.lines : '') + '\n\n' + f.text.slice(0, 600) : f.path;
        if (f.sel) el.classList.add('sel');
        el.innerHTML = (f.sel ? SEL_ICON : thumbFor(f)) + `<span class="n">${esc(f.name)}</span>`
          + (f.size ? `<span class="sz">${esc(fmtSize(f.size))}</span>` : '') + '<button title="Remove">✕</button>';
        el.querySelector('img')?.addEventListener('click', (e) => { e.stopPropagation(); showImage(e.target.src); });
        el.querySelector('button').onclick = () => { attachments.splice(i, 1); renderAttachments(); autosize(); };
        row.appendChild(el);
      });
      saveDraft();
    }
    const SEL_ICON = '<svg class="sel-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7.5 4.5 12 9 16.5M15 7.5l4.5 4.5-4.5 4.5"/></svg>';
    function addAttachment(f) {
      if (!f?.path || attachments.some(a => a.path === f.path && !!a.sel === !!f.sel && (!f.sel || (a.lines === f.lines && a.text === f.text)))) return;
      attachments.push(f);
      renderAttachments();
      autosize();
    }
    async function uploadFile(file) {
      const buf = await file.arrayBuffer();
      let bin = '';
      new Uint8Array(buf).forEach(b => bin += String.fromCharCode(b));
      const res = await fetch('/api/upload', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: file.name, data: btoa(bin)}),
      });
      const d = await res.json();
      if (d.error) { alert(d.error); return; }
      addAttachment(d);
    }
    // drag & drop anywhere over the window
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
      dragDepth++; $('dropVeil').classList.add('on');
    });
    window.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropVeil').classList.remove('on'); } });
    window.addEventListener('drop', async (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
      e.preventDefault();
      dragDepth = 0; $('dropVeil').classList.remove('on');
      for (const f of e.dataTransfer.files) await uploadFile(f);
      $('input').focus();
    });
    // pasted files (screenshots, copied documents)
    $('input').addEventListener('paste', async (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (!files.length) return;
      e.preventDefault();
      for (const f of files) await uploadFile(f);
    });

    // ---------- live model list ----------
    // "gemini-3.1-pro-preview" -> "Gemini 3.1 Pro (preview)"
    // "gemma-4-26b-a4b-it" -> "Gemma 4 26B A4B IT"
    function modelLabel(id) {
      const g = String(id).match(/^gemma-(.+)$/);
      if (g) return 'Gemma ' + g[1].split('-').map(w => w.toUpperCase()).join(' ');
      const m = String(id).match(/^gemini-(\d+(?:\.\d+)?)-(.+?)(-preview)?$/);
      if (!m) return id;
      const kind = m[2].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return `Gemini ${m[1]} ${kind}` + (m[3] ? ' (preview)' : '');
    }
    const modelVersion = (id) => parseFloat((String(id).match(/(\d+(?:\.\d+)?)/) || [])[1]) || 0;
    async function loadModels(force) {
      let d;
      try { d = await (await fetch('/api/models' + (force ? '?force=1' : ''))).json(); } catch { return; }
      if (!d || (!(d.models && d.models.length) && !(d.auto && d.auto.length))) return;
      const sel = $('model'), keep = store.get('gui.model', sel.value);
      const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
      let html = opt('', 'Auto (CLI default)');
      const autos = [...(d.auto || [])].sort((a, b) => modelVersion(b) - modelVersion(a));
      if (autos.length) html += `<optgroup label="Auto routing">${autos.map(a => opt(a, 'Auto · Gemini ' + a.replace('auto-gemini-', ''))).join('')}</optgroup>`;
      // same order as the CLI's /model manage picker (the server already picked and ordered them)
      if (d.models && d.models.length) html += `<optgroup label="Models">${d.models.map(id => opt(id, modelLabel(id))).join('')}</optgroup>`;
      sel.innerHTML = html;
      sel.value = keep;
      if (sel.selectedIndex < 0) sel.value = '';                // a saved model that is no longer offered
      syncPills();
    }

    // ---------- model quota ----------
    // Same source as the CLI's "/model manage": Code Assist reports how much of each model's daily
    // allowance is left, and when it resets.
    let quotaData = null;
    const shortModel = (m) => m.replace(/^gemini-/, '').replace(/-preview$/, '');
    function whenReset(iso) {
      if (!iso) return '';
      const ms = Date.parse(iso) - Date.now();
      if (!(ms > 0)) return 'resets soon';
      const total = Math.max(1, Math.round(ms / 60000)), h = Math.floor(total / 60), m = total % 60;
      return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
    }
    // Google reports "x" and "x-preview" as separate buckets with identical numbers; show each model once.
    function uniqueQuotaModels(models) {
      const byName = new Map();
      models.forEach(m => {
        const key = shortModel(m.model), prev = byName.get(key);
        if (!prev || m.used > prev.used || m.model === $('model').value) byName.set(key, m);
      });
      return [...byName.values()];
    }
    function renderQuota() { renderQuotaPop(); renderUsage(); }
    // Settings -> Usage: one row per model with its share used today, a bar and the time until it resets
    function renderUsage() {
      const box = $('usageBody'); if (!box) return;
      if (!quotaData) { box.innerHTML = '<p class="set-foot"><span class="shimmer">Loading quota</span></p>'; return; }
      if (quotaData.error || !quotaData.models?.length) { box.innerHTML = `<p class="set-foot">${esc(quotaData.error || 'No quota information for this account.')}</p>`; return; }
      const mine = $('model').value;
      const row = (m) => {
        const pct = Math.round(m.used * 100);
        const cls = m.remaining <= 0.1 ? 'low' : m.remaining <= 0.25 ? 'warn' : '';
        const inUse = mine && (m.model === mine || m.model === mine.replace(/-preview$/, ''));
        const C = 2 * Math.PI * 15.5;
        return `<div class="set-row use-row ${cls}">
            <div class="use-main">
              <div class="use-name" title="${esc(m.model)}">${esc(shortModel(m.model))}${inUse ? '<span class="use-tag">In use</span>' : ''}</div>
              <div class="use-reset">${m.resetTime ? 'Resets in ' + esc(whenReset(m.resetTime)) : ''}</div>
            </div>
            <div class="use-ring" title="${pct}% used today"><svg viewBox="0 0 36 36"><circle class="t" cx="18" cy="18" r="15.5" fill="none" stroke-width="3.6"/><circle class="f" cx="18" cy="18" r="15.5" fill="none" stroke-width="3.6" stroke-linecap="round" transform="rotate(-90 18 18)" stroke-dasharray="${(C * m.used).toFixed(1)} ${C.toFixed(1)}"/></svg><span>${pct}%</span></div>
          </div>`;
      };
      // one card per tier (Pro, Flash, Flash Lite), newest model first
      const tierOf = (name) => /flash-lite/i.test(name) ? 'Flash Lite' : /flash/i.test(name) ? 'Flash' : /pro/i.test(name) ? 'Pro' : 'Other';
      const tiers = {};
      uniqueQuotaModels(quotaData.models).forEach(m => (tiers[tierOf(m.model)] = tiers[tierOf(m.model)] || []).push(m));
      box.innerHTML = ['Pro', 'Flash', 'Flash Lite', 'Other'].filter(t => tiers[t]).map(t =>
        `<h3 class="use-tier">${t}</h3><div class="set-card">${tiers[t].sort((a, b) => shortModel(b.model).localeCompare(shortModel(a.model), undefined, {numeric: true})).map(row).join('')}</div>`).join('')
        + (quotaData.project ? `<p class="set-foot">Project ${esc(quotaData.project)} · requests per day</p>` : '');
    }
    function renderQuotaPop() {
      const box = $('quotaBody');
      if (!quotaData) { box.innerHTML = '<div class="qnote"><span class="shimmer">Loading quota</span></div>'; return; }
      if (quotaData.error) { box.innerHTML = `<div class="qnote">${esc(quotaData.error)}</div>`; return; }
      const mine = $('model').value;
      const rows = uniqueQuotaModels(quotaData.models).map(m => {
        const usedPct = Math.round(m.used * 100);
        const cls = m.remaining <= 0.1 ? 'low' : m.remaining <= 0.25 ? 'warn' : '';
        const current = mine && (m.model === mine || m.model === mine.replace(/-preview$/, '')) ? ' current' : '';
        return `<div class="qrow ${cls}${current}">
            <div class="top"><span class="m" title="${esc(m.model)}">${esc(shortModel(m.model))}</span>
              <span class="c">${usedPct}%</span><span class="c r">${esc(whenReset(m.resetTime))}</span></div>
            <div class="qbar"><i style="width:${usedPct}%"></i></div>
          </div>`;
      }).join('');
      box.innerHTML = `<div class="qcols"><span>Model</span><span class="c">Used</span><span class="c r">Resets in</span></div>`
        + rows + `<div class="qnote">Project ${esc(quotaData.project)} · requests per day</div>`;
    }
    async function loadQuota(force) {
      const ring = $('quotaPill');
      ring.hidden = false;           // show the ring straight away so the spinner is visible
      ring.classList.add('loading');
      try {
        const d = await (await fetch('/api/quota' + (force ? '?force=1' : ''))).json();
        quotaData = d;
      } catch { quotaData = { error: 'Quota is unavailable.' }; }
      const pill = $('quotaPill');
      pill.classList.remove('loading');
      if (quotaData.error || !quotaData.models?.length) { pill.hidden = true; }
      else {
        // The pill shows the model in use (or the most used one).
        const mine = $('model').value;
        const m = quotaData.models.find(x => x.model === mine)
          || [...quotaData.models].sort((a, b) => b.used - a.used)[0];
        const usedPct = Math.round(m.used * 100);
        pill.hidden = false;
        pill.classList.toggle('warn', m.remaining <= 0.25 && m.remaining > 0.1);
        pill.classList.toggle('low', m.remaining <= 0.1);
        const C = 2 * Math.PI * 15.5; // ring circumference
        $('quotaArc').style.strokeDasharray = `${(C * m.used).toFixed(1)} ${C.toFixed(1)}`;

        pill.title = `${usedPct}% of today's ${shortModel(m.model)} requests used · ${whenReset(m.resetTime)}`;
      }
      renderQuota();
    }
    // the ring opens Settings on the Usage page (no popover any more)
    $('quotaPill').onclick = (e) => {
      e.stopPropagation();
      openSettings();
      document.querySelector('.set-nav [data-sec=usage]').click();
      renderUsage(); loadQuota();
    };
    $('usageRefresh').onclick = () => { quotaData = null; renderQuota(); loadQuota(true); loadModels(true); };
    $('quotaRefresh').onclick = (e) => { e.stopPropagation(); quotaData = null; renderQuota(); loadQuota(true); loadModels(true); };
    document.addEventListener('click', (e) => {
      if ($('quotaPop').classList.contains('open') && !e.target.closest('#quotaPop') && !e.target.closest('#quotaPill')) {
        $('quotaPop').classList.remove('open');
      }
    });

    // ---------- context window ----------
    // Gemini re-sends the whole conversation on every call, so a long chat eventually hits the model's
    // input limit and replies start failing. Show how full it is and warn in red before that happens.
    const CTX_LIMIT = 1048576; // 1M input tokens for current Gemini models
    let ctxInput = 0;
    function setContext(input) {
      ctxInput = input || 0;
      const pill = $('ctxPill'), pct = Math.round(100 * ctxInput / CTX_LIMIT);
      pill.hidden = !ctxInput;
      pill.classList.toggle('ctx-warn', pct >= 50 && pct < 80); // Gemini starts compressing at 50%
      pill.classList.toggle('ctx-full', pct >= 80);
      $('ctxLabel').textContent = `Context ${pct}%`;
      pill.title = `${ctxInput.toLocaleString()} of ${CTX_LIMIT.toLocaleString()} input tokens used by this chat.\n`
        + (pct >= 80 ? 'Nearly full: replies may start failing. Click to start a new chat.'
          : pct >= 50 ? 'Past half: Gemini starts compressing older messages, which can lose detail.'
            : 'Gemini re-sends the whole conversation on each call, so this grows as the chat gets longer.');
    }
    $('ctxPill').onclick = () => newChat();
    // Hovering a chat shows how full its context window is (fetched once per chat).
    const ctxBySession = new Map();
    async function describeSession(s, el) {
      const base = `${s.title}
${s.cwd}`;
      let pct = ctxBySession.get(s.id);
      if (pct === undefined) {
        try {
          const d = await (await fetch('/api/context?id=' + encodeURIComponent(s.id))).json();
          pct = d.input ? Math.round(100 * d.input / CTX_LIMIT) : null;
        } catch { pct = null; }
        ctxBySession.set(s.id, pct);
      }
      el.title = pct === null ? base : `${base}
Context ${pct}% of the model's window`;
    }
    async function loadContext(id) {
      if (!id) return setContext(0);
      try {
        const d = await (await fetch('/api/context?id=' + encodeURIComponent(id))).json();
        setContext(d.input || 0);
        ctxBySession.set(id, d.input ? Math.round(100 * d.input / CTX_LIMIT) : null);
      } catch { setContext(0); }
    }
    // Red banner under a reply once the chat is nearly full.
    function ctxBanner() {
      const pct = Math.round(100 * ctxInput / CTX_LIMIT);
      if (pct < 80) return null;
      const el = document.createElement('div');
      el.className = 'ctx-banner';
      el.innerHTML = `<b>Context window ${pct}% full</b> — this chat has grown to ${ctxInput.toLocaleString()} tokens. `
        + 'Gemini may start returning empty or failed replies. Start a new chat to reset it.';
      return el;
    }

