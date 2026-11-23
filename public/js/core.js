    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
    const store = {
      get(k, d) {try {return JSON.parse(localStorage.getItem(k)) ?? d;} catch {return d;} },
      set(k, v) {try {localStorage.setItem(k, JSON.stringify(v));} catch { } },
    };
    let nextPrompt = null;   // Gemini's "Next prompt" suggestion for the empty message box (see setNextPrompt)
    // long chats are built in batches (see showOlderTurns)
    const CHAT_PAGE = 15;
    const OLD_TURN_ACTIONS = '.u-actions [data-a=retry], .u-actions [data-a=edit], .quick, .plan-card .pc-actions, .plan-card .pc-feedback';
    let logTarget = null;            // set while building earlier turns: addUser / AssistantView put messages there
    const logAppend = (el) => (logTarget || $('log')).appendChild(el);
    let olderObserver = null;
    marked.setOptions({breaks: true, gfm: true});
    marked.use({renderer: {
      image({href, text}) {      // marked 13+ passes a token object
        const h = String(href || '').trim();
        const alt = esc(text || '');
        if (/^data:image\//i.test(h)) return `<img class="chat-img" src="${esc(h)}" alt="${alt}">`;
        // a picture from the web is shown as a link: the page never loads anything from outside (it could track you)
        if (/^https?:/i.test(h)) return `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${alt || 'image'}</a>`;
        return `<img class="chat-img img-wait" data-local="${esc(h)}" alt="${alt}">`;
      },
    }});

    // ---------- markdown + math ----------
    // Gemini writes LaTeX such as $x^2$, \(a+b\) and $$...$$. marked would mangle it (it treats "\(" as an
    // escape and "_" as emphasis), so math is lifted out first, replaced by a placeholder, and put back as KaTeX
    // output once the markdown has been rendered and sanitized.
    function extractMath(text) {
      const math = [];
      const stash = (tex, display) => { math.push({tex: tex.trim(), display}); return `@@MATH${math.length - 1}@@`; };
      // leave code alone: split on fenced blocks and inline code, only touch the text between them
      const parts = String(text).split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
      const out = parts.map((seg, i) => {
        if (i % 2) return seg;                                           // a code segment
        return seg
          .replace(/\\\$/g, '@@DOLLAR@@')                                // \$ is a literal dollar sign
          .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => stash(t, true))
          .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => stash(t, true))
          .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => stash(t, false))
          // single $...$: must not start or end with a space and the closing $ must not be followed by a digit or
          // letter, so prices like "$5 and $10" stay plain text
          .replace(/(^|[^\w$])\$(?!\s)([^$\n]*?[^\s$\\])\$(?![\d\w])/g, (m, pre, t) => pre + stash(t, false));
      });
      return {text: out.join(''), math};
    }
    function restoreMath(html, math) {
      return html
        .replace(/@@MATH(\d+)@@/g, (m, i) => {
          const item = math[+i]; if (!item) return m;
          if (typeof katex === 'undefined') return esc((item.display ? '$$' : '$') + item.tex + (item.display ? '$$' : '$'));
          try { return katex.renderToString(item.tex, {displayMode: item.display, throwOnError: false, output: 'html', trust: false}); }
          catch { return esc(item.tex); }
        })
        .replace(/@@DOLLAR@@/g, '$');
    }
    // ---------- Jira tickets and Confluence pages ----------
    // A Jira or Confluence link becomes a chip: the product's icon and the ticket key / page title. A bare ticket key
    // (RICOMS-13719) is highlighted too once a Jira link has been seen (that gives the site and the project keys).
    const ICON_JIRA = '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path stroke="#4c9aff" d="M3 11h10v10"/><path stroke="#2684FF" d="M9.5 3h11.5v11.5"/></svg>';
    const ICON_CONF = '<svg viewBox="0 0 24 24"><path fill="#2684FF" d="M6.5 2.5h8.2L20 7.8v11.7a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z"/><path fill="#fff" fill-opacity=".45" d="M14.7 2.5 20 7.8h-3.3a2 2 0 0 1-2-2z"/><path fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" d="M8 12.2q1.5-1.4 3 0t3 0 2.5-.3M8 16.2q1.5-1.4 3 0t3 0 2.5-.3"/></svg>';
    const ICON_WB = '<svg viewBox="0 0 24 24" fill="none" stroke="#2684FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4M7.5 12.5c1.5-3 3-3 4 0s2.5 2.5 4.5-1"/></svg>';
    const refIcon = (k) => k === 'jira' ? ICON_JIRA : k === 'wb' ? ICON_WB : ICON_CONF;
    const JIRA_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
    function jiraInfo() { const j = store.get('gui.jira', null); return j && j.base ? j : {base: '', keys: []}; }
    function refFromUrl(href) {
      let u; try { u = new URL(href); } catch { return null; }
      if (!/^https?:$/.test(u.protocol)) return null;
      const path = decodeURIComponent(u.pathname.replace(/\+/g, ' '));
      let m = path.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/) || path.match(/\/issues\/([A-Z][A-Z0-9_]+-\d+)/)
        || (u.searchParams.get('selectedIssue') || '').match(/^([A-Z][A-Z0-9_]+-\d+)$/);
      if (m) {
        const j = jiraInfo(), key = m[1], prefix = key.replace(/-\d+$/, '');
        if (j.base !== u.origin || !j.keys.includes(prefix)) store.set('gui.jira', {base: u.origin, keys: [...new Set([...(j.base === u.origin ? j.keys : []), prefix])].slice(-30)});
        return {kind: 'jira', label: key};
      }
      if (/\/whiteboards?\/[^/]+/.test(path)) return {kind: 'wb', label: 'Whiteboard'};
      m = path.match(/\/wiki\/spaces\/[^/]+\/pages\/\d+(?:\/([^/]+))?/) || path.match(/\/display\/[^/]+\/([^/]+)/);
      if (m) return {kind: 'conf', label: (m[1] || 'Confluence page').trim()};
      if (/\/wiki\/x\//.test(path)) return {kind: 'conf', label: 'Confluence page'};
      return null;
    }
    function refChip(kind, label, href) {
      const a = document.createElement('a');
      a.className = 'aref ' + kind; a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = href;
      a.innerHTML = '<span class="ai">' + refIcon(kind) + '</span>';
      a.append(label);
      return a;
    }
    // chips for the links in a rendered reply, and for bare keys of known Jira projects
    function linkTickets(root) {
      root.querySelectorAll('a[href]').forEach(a => {
        if (a.classList.contains('aref') || a.closest('pre')) return;
        const ref = refFromUrl(a.href); if (!ref) return;
        const t = a.textContent.trim(), label = (!t || /^https?:\/\//.test(t)) ? ref.label : t;
        a.className = 'aref ' + ref.kind; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = a.href;
        a.innerHTML = '<span class="ai">' + refIcon(ref.kind) + '</span>'; a.append(label);
      });
      const j = jiraInfo(); if (!j.base) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode: (n) =>
        n.parentElement.closest('a, code, pre, .aref, .fi') || !/[A-Z][A-Z0-9_]+-\d+/.test(n.nodeValue) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
      const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(n => {
        const parts = n.nodeValue.split(/\b([A-Z][A-Z0-9_]+-\d+)\b/);
        if (parts.length < 2) return;
        const frag = document.createDocumentFragment(); let any = false;
        parts.forEach((part, i) => {
          if (i % 2 && j.keys.includes(part.replace(/-\d+$/, ''))) { frag.append(refChip('jira', part, j.base + '/browse/' + part)); any = true; }
          else if (part) frag.append(part);
        });
        if (any) n.replaceWith(frag);
      });
    }
    // Your own message: `code`, **bold**, ``` blocks, links and ticket keys are shown formatted (all built as DOM
    // nodes from the text, so nothing you type can inject markup).
    function inlineMd(seg, parent) {
      const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|(?<![*\w])\*([^*\s][^*\n]*?)\*(?![*\w])|(https?:\/\/[^\s<>"')\]]*[^\s<>"')\].,;:!?])|\b([A-Z][A-Z0-9_]+-\d{1,7})\b/g;
      const j = jiraInfo(); let last = 0, m;
      const wrap = (tag, text) => { const e = document.createElement(tag); e.textContent = text; parent.append(e); };
      while ((m = re.exec(seg))) {
        if (m.index > last) parent.append(seg.slice(last, m.index));
        if (m[1] !== undefined) wrap('code', m[1]);
        else if (m[2] !== undefined) wrap('strong', m[2]);
        else if (m[3] !== undefined) wrap('del', m[3]);
        else if (m[4] !== undefined) wrap('em', m[4]);
        else if (m[5]) {
          const ref = refFromUrl(m[5]);
          if (ref) parent.append(refChip(ref.kind, ref.label, m[5]));
          else { const a = document.createElement('a'); a.href = m[5]; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = m[5]; parent.append(a); }
        } else if (j.base && j.keys.includes(m[6].replace(/-\d+$/, ''))) parent.append(refChip('jira', m[6], j.base + '/browse/' + m[6]));
        else parent.append(m[6]);
        last = re.lastIndex;
      }
      if (last < seg.length) parent.append(seg.slice(last));
    }
    // Your own message: lists (- * + and 1.), # headings, > quotes, `code`, **bold**, *italic*, ~~strike~~, ``` blocks,
    // links and ticket keys are shown formatted. Everything is built as DOM nodes from the text, so nothing you
    // type can inject markup; plain lines keep their line breaks.
    function renderUserText(text, bubble) {
      bubble.textContent = '';
      String(text).split(/(```[\s\S]*?```)/g).forEach((seg, i) => {
        if (i % 2) {
          const m = seg.match(/^```[^\n]*\n?([\s\S]*?)\n?```$/);
          const pre = document.createElement('pre'), code = document.createElement('code');
          pre.className = 'ub-pre'; code.textContent = m ? m[1] : seg; pre.append(code); bubble.append(pre);
          return;
        }
        let buf = [], stack = [];
        const flush = () => { const t = buf.join('\n'); buf = []; if (t.trim()) inlineMd(t.replace(/^\n+|\n+$/g, ''), bubble); };
        seg.split('\n').forEach(line => {
          let m;
          if ((m = line.match(/^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/))) {
            flush();
            const indent = m[1].replace(/\t/g, '  ').length, ordered = /\d/.test(m[2]);
            while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
            if (stack.length && indent === stack[stack.length - 1].indent && stack[stack.length - 1].el.tagName !== (ordered ? 'OL' : 'UL')) stack.pop();
            if (!stack.length || indent > stack[stack.length - 1].indent) {
              const el = document.createElement(ordered ? 'ol' : 'ul'); el.className = 'ub-list';
              if (ordered && parseInt(m[2]) > 1) el.start = parseInt(m[2]);
              (stack.length ? stack[stack.length - 1].el.lastElementChild : bubble).append(el);
              stack.push({indent, el});
            }
            const li = document.createElement('li'); inlineMd(m[3], li); stack[stack.length - 1].el.append(li);
          } else if ((m = line.match(/^(#{1,6})[ \t]+(.+)$/))) {
            flush(); stack = [];
            const h = document.createElement('div'); h.className = 'ub-h'; inlineMd(m[2], h); bubble.append(h);
          } else if ((m = line.match(/^>[ \t]?(.*)$/))) {
            flush(); stack = [];
            const q = document.createElement('div'); q.className = 'ub-q'; inlineMd(m[1], q); bubble.append(q);
          } else { if (line.trim() || buf.length) stack = []; buf.push(line); }
        });
        flush();
      });
      linkFileRefs(bubble);
    }
    // The message box shows the same formatting while you type: a copy of the text sits behind the (transparent)
    // text box and colours the pieces. Only colours change, never widths, so both always wrap the same way.
    function mirrorUpdate() {
      const mir = $('inMirror'); if (!mir) return;
      const text = $('input').value, j = jiraInfo();
      const re = /(```[\s\S]*?(?:```|(?![\s\S])))|(`[^`\n]+`?)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|((?<![*\w])\*[^*\s][^*\n]*?\*(?![*\w]))|(https?:\/\/[^\s<>"')\]]*[^\s<>"')\].,;:!?])|(\b[A-Z][A-Z0-9_]+-\d{1,7}\b)|(^[ \t]*(?:[-*+]|\d+[.)])[ \t]+)|(^#{1,6}[ \t].*$)|(^>[ \t]?)|((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/])[^\s"'`<>|*?]*[^\s"'`<>|*?.,;:!)]|\b[\w.-]+(?:[\\/][\w.-]+)+(?:\.\w{1,8})?\b|\b[\w-]+\.(?:csv|tsv|json|ya?ml|xml|md|txt|log|js|ts|tsx|jsx|py|java|kt|go|rs|c|h|cpp|cs|sql|sh|ps1|bat|html?|css|robot|resource|properties|gradle|toml|ini|env|pdf|docx?|xlsx?|pptx?|zip|png|jpe?g|gif|svg|webp|ico)\b)/gm;
      let out = '', last = 0, m;
      while ((m = re.exec(text))) {
        out += esc(text.slice(last, m.index));
        const t = esc(m[0]);
        if (m[1] || m[2]) out += `<span class="mi-code">${t}</span>`;
        else if (m[3]) out += `<span class="mi-b">${t}</span>`;
        else if (m[4]) out += `<span class="mi-s">${t}</span>`;
        else if (m[5]) out += `<span class="mi-i">${t}</span>`;
        else if (m[6]) out += `<span class="${refFromUrl(m[0]) ? 'mi-ref' : 'mi-url'}">${t}</span>`;
        else if (m[7]) out += j.base && j.keys.includes(m[0].replace(/-\d+$/, '')) ? `<span class="mi-ref">${t}</span>` : t;
        else if (m[8]) out += `<span class="mi-mark">${t}</span>`;
        else if (m[9]) out += `<span class="mi-h">${t}</span>`;
        else if (m[10]) out += `<span class="mi-q">${t}</span>`;
        else out += `<span class="mi-file">${t}</span>`;
        last = re.lastIndex;
        if (m[0] === '') re.lastIndex++;
      }
      mir.innerHTML = out + esc(text.slice(last)) + '​';
      mir.scrollTop = $('input').scrollTop;
    }

    // A short "Label:" line that comes right after a list item (no blank line) is read by Markdown as part of that
    // item: "Not done:" ended up inside the bullet above it, unformatted. When such a line is followed by a list, a
    // blank line goes before it, so it is a paragraph of its own and gets the label style (see markLabels).
    function separateLabels(text) {
      const item = /^\s*(?:[*+-]|\d+[.)])\s+\S/;
      const label = /^(?:\*\*|__)?\p{L}[^\n`]{0,38}?:(?:\*\*|__)?\s*$/u;
      const lines = String(text).split('\n'), out = [];
      let fence = null;
      lines.forEach((ln, i) => {
        const f = ln.match(/^\s*(```|~~~)/);
        if (f) { fence = !fence ? f[1] : (f[1] === fence ? null : fence); out.push(ln); return; }
        const prev = out[out.length - 1];
        if (!fence && prev && prev.trim() && label.test(ln) && item.test(lines[i + 1] || '') && (item.test(prev) || /^\s{2,}\S/.test(prev))) out.push('');
        out.push(ln);
      });
      return out.join('\n');
    }
    function renderMarkdown(text) {
      const {text: prepared, math} = extractMath(separateLabels(text));
      const html = DOMPurify.sanitize(marked.parse(prepared));
      return restoreMath(html, math);
    }

    const ICON_SEND = '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>';
    const ICON_STOP = '<svg viewBox="0 0 24 24" style="width:12px;height:12px"><rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor"/></svg>';

    let sessions = []; // from Gemini CLI's session files: [{id, title, cwd, updated}]
    let current = null;
    let busy = false, runId = null, controller = null;

