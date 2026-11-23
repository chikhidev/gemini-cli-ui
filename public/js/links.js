    // ---------- links: a warning unless the link's domain is trusted ----------
    // No domain is trusted by default (a reply, or anything Gemini read, could contain a look-alike address). Every web
    // link on a domain you have not trusted shows a warning sign, and clicking it asks first: Cancel, Open once, or
    // Trust the domain. Trusted domains (and their subdomains) are managed in Settings → General → Trusted domains and
    // kept in this browser only.
    // the warning sign: a rounded triangle with an exclamation mark (drawn here)
    const ICON_WARN = (c) => `<svg viewBox="0 0 24 24"><path d="M12 3.6 21.2 19.6H2.8z" fill="${c}" stroke="${c}" stroke-width="2.6" stroke-linejoin="round"/>`
      + `<path d="M12 9.4v4.9" stroke="#17171a" stroke-width="2.1" stroke-linecap="round"/><circle cx="12" cy="17" r="1.25" fill="#17171a"/></svg>`;
    const WARN_COLOR = {warn: '#e8a33d', bad: '#ff6b6b'};
    const SHORTENERS = /^(bit\.ly|t\.co|tinyurl\.com|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|t\.ly|rb\.gy|lnkd\.in)$/i;

    // "Example.com", "https://docs.example.com/a?b", "*.example.com" -> "example.com" / "docs.example.com" (or '' if not a domain)
    function cleanDomain(v) {
      let t = String(v || '').trim().toLowerCase().replace(/^\*\./, '');
      if (!t) return '';
      if (!/^[a-z][a-z0-9+.-]*:\/\//.test(t)) t = 'https://' + t;
      let h; try { h = new URL(t).hostname; } catch { return ''; }
      h = h.replace(/\.$/, '');
      if (!h || (!h.includes('.') && h !== 'localhost')) return '';       // "com" alone would trust half the web
      return h;
    }
    const trustedDomains = () => store.get('gui.trustedDomains', []);
    // the domain that trusts this host, if any (a domain covers its subdomains)
    function trustedBy(host) {
      host = String(host || '').toLowerCase();
      return trustedDomains().find(d => host === d || host.endsWith('.' + d)) || '';
    }
    function isTrustedLink(href) {
      let u; try { u = new URL(href); } catch { return false; }
      if (u.origin === location.origin) return true;                     // a page of this app itself
      return !!trustedBy(u.hostname);
    }
    // Atlassian sites (and the site of a Jira link on a trusted domain) may be drawn as a Jira / Confluence chip
    function chipHostOk(u) {
      const h = u.hostname.toLowerCase();
      if (/(^|\.)atlassian\.(net|com)$/.test(h)) return true;
      const j = jiraInfo();
      try { if (j.base && new URL(j.base).hostname.toLowerCase() === h) return true; } catch { }
      return false;
    }
    function trustDomain(d) {
      d = cleanDomain(d); if (!d) return false;
      const list = trustedDomains().filter(x => x !== d);
      list.push(d); list.sort();
      store.set('gui.trustedDomains', list.slice(0, 500));
      linksChanged(); return true;
    }
    function untrustDomain(d) {
      store.set('gui.trustedDomains', trustedDomains().filter(x => x !== d));
      linksChanged();
    }
    // the earlier version trusted single links: keep their domains
    (() => {
      const old = store.get('gui.trustedLinks', null); if (!Array.isArray(old)) return;
      const set = new Set(trustedDomains());
      old.forEach(h => { try { const d = cleanDomain(new URL(h).hostname); if (d) set.add(d); } catch { } });
      store.set('gui.trustedDomains', [...set].sort());
      try { localStorage.removeItem('gui.trustedLinks'); } catch { }
    })();

    // what is odd about an address (shown in the dialog), beyond "its domain is not trusted"
    function linkFlags(href) {
      const out = []; let u; try { u = new URL(href); } catch { return ['Not a valid address']; }
      const h = u.hostname;
      if (u.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(h)) out.push('Not encrypted (http)');
      if (u.username || u.password) out.push('Contains a user name or password before the site name');
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.startsWith('[')) out.push('A bare IP address, not a site name');
      if (/(^|\.)xn--/i.test(h)) out.push('Contains look-alike (international) characters');
      if (SHORTENERS.test(h)) out.push('A link shortener: you cannot see where it goes');
      if (u.port && !['80', '443'].includes(u.port)) out.push('Unusual port ' + u.port);
      return out;
    }
    // 'ok' (domain trusted), 'warn' (not trusted), 'bad' (not trusted and something looks wrong)
    function linkLevel(href) {
      if (isTrustedLink(href)) return 'ok';
      return linkFlags(href).length ? 'bad' : 'warn';
    }

    // ---- warning sign on every web link in the page (also on links that appear later) ----
    function markLinks(root) {
      (root || document).querySelectorAll('a[href]').forEach(a => {
        if (!/^https?:/i.test(a.getAttribute('href') || '')) return;
        const lv = linkLevel(a.href);
        if (a.dataset.lk === lv) return;
        a.dataset.lk = lv;
        const base = (a.dataset.lkTitle ?? (a.dataset.lkTitle = a.title || ''));
        a.title = lv === 'ok' ? base : (base ? base + '\n' : '')
          + (lv === 'bad' ? 'Warning: this link looks suspicious, and its domain is not trusted' : 'The domain of this link is not trusted');
      });
    }
    function refreshLinkMarks() { document.querySelectorAll('a[data-lk]').forEach(a => delete a.dataset.lk); markLinks(); }
    let markQueued = false;
    new MutationObserver(() => {
      if (markQueued) return; markQueued = true;
      setTimeout(() => { markQueued = false; markLinks(); }, 30);
    }).observe(document.body, {childList: true, subtree: true});
    function linksChanged() { refreshLinkMarks(); renderTrustedDomains(); }

    // ---- the question when you click a link whose domain is not trusted ----
    let linkAsk = null;
    function askLink(href) {
      return new Promise((resolve) => {
        let u; try { u = new URL(href); } catch { return resolve('cancel'); }
        const lv = linkLevel(href), flags = linkFlags(href);
        linkAsk?.('cancel');
        const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
        const modal = el('div', 'modal open lk-modal');
        const dlg = el('div', 'dialog lk-dialog'); dlg.setAttribute('role', 'dialog');
        const body = el('div', 'acc-body');
        const h = el('h3', 'lk-title');
        const sign = el('span', 'lk-sign'); sign.innerHTML = ICON_WARN(WARN_COLOR[lv === 'bad' ? 'bad' : 'warn']);
        h.append(sign, lv === 'bad' ? 'This link looks suspicious' : 'Open this link?');
        const sub = el('p', 'acc-sub', `${u.hostname} is not a trusted domain. Make sure you know where this link goes before opening it.`);
        const box = el('div', 'lk-url' + (lv === 'bad' ? ' bad' : ''));
        const rest = u.pathname + u.search + u.hash;
        box.append(el('span', '', u.protocol + '//'), el('b', '', u.host), el('span', '', rest.length > 300 ? rest.slice(0, 300) + '…' : rest));
        body.append(h, sub, box);
        if (flags.length) {
          const ul = el('ul', 'lk-flags');
          flags.forEach(f => ul.append(el('li', '', f)));
          body.append(ul);
        }
        const bot = el('div', 'bot');
        const mk = (label, cls, val, title) => { const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label); if (title) b.title = title; b.onclick = () => done(val); return b; };
        // the safe choice sits on the right and is the highlighted one
        const cancel = mk('Cancel', 'primary', 'cancel');
        bot.append(mk('Trust ' + u.hostname, '', 'trust', 'Stop warning about links on ' + u.hostname + ' (you can remove it in Settings)'), mk('Open once', '', 'once'), cancel);
        dlg.append(body, bot); modal.append(dlg); document.body.append(modal);
        const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done('cancel'); } };
        const done = (v) => { document.removeEventListener('keydown', key, true); modal.remove(); linkAsk = null; resolve(v); };
        linkAsk = done;
        modal.addEventListener('mousedown', (e) => { if (e.target === modal) done('cancel'); });
        document.addEventListener('keydown', key, true);
        cancel.focus();
      });
    }
    function openLink(href) { window.open(href, '_blank', 'noopener,noreferrer'); }
    async function followLink(href) {
      if (isTrustedLink(href)) return openLink(href);
      const v = await askLink(href);
      if (v === 'trust') { trustDomain(new URL(href).hostname); openLink(href); }
      else if (v === 'once') openLink(href);
    }
    // every click on a web link in the page goes through here (before anything else sees it)
    function linkClick(e) {
      if (e.type === 'auxclick' && e.button !== 1) return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || !/^https?:/i.test(a.getAttribute('href') || '')) return;
      e.preventDefault(); e.stopPropagation();
      followLink(a.href);
    }
    document.addEventListener('click', linkClick, true);
    document.addEventListener('auxclick', linkClick, true);

    // ---- Settings → General → Trusted domains ----
    function renderTrustedDomains() {
      const list = $('tdList'); if (!list) return;
      const ds = trustedDomains();
      list.textContent = '';
      if (!ds.length) {
        const row = document.createElement('div'); row.className = 'set-row td-empty';
        row.textContent = 'No trusted domains yet: every link shows a warning.';
        list.append(row); return;
      }
      ds.forEach(d => {
        const row = document.createElement('div'); row.className = 'set-row td-row';
        const name = document.createElement('div'); name.className = 'set-label';
        const t = document.createElement('span'); t.className = 'set-label-text td-name'; t.textContent = d;
        const s = document.createElement('span'); s.className = 'set-desc'; s.textContent = 'Also covers *.' + d;
        name.append(t, s);
        const rm = document.createElement('button'); rm.className = 'set-reset glass-btn'; rm.textContent = 'Remove';
        rm.title = 'Show the warning again for links on ' + d;
        rm.onclick = () => untrustDomain(d);
        row.append(name, rm); list.append(row);
      });
    }
    function addTrustedFromInput() {
      const inp = $('tdInput'), d = cleanDomain(inp.value);
      $('tdError').textContent = '';
      if (!d) { $('tdError').textContent = 'Type a domain such as example.com'; inp.focus(); return; }
      trustDomain(d); inp.value = ''; inp.focus();
    }
    if ($('tdAdd')) {
      $('tdAdd').onclick = addTrustedFromInput;
      $('tdInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTrustedFromInput(); } });
    }
    markLinks(); renderTrustedDomains();
