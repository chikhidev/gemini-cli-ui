    // ---------- find in conversation ----------
    // Ctrl+F (or the button beside search) opens a bar over the chat: every match of the text in the open
    // conversation is highlighted, the current one stronger; Enter / Shift+Enter (or the arrows) move between them.
    // Matches are painted with the CSS Highlight API, so the messages themselves are never changed. Text inside
    // folded steps is skipped (it is not visible); earlier turns of a long chat are loaded first so all of it is searched.
    const FIND_HL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
    let findHits = [], findAt = -1, findTimer = null;
    function findClear() {
      if (FIND_HL) { CSS.highlights.delete('find-hit'); CSS.highlights.delete('find-cur'); }
      findHits = []; findAt = -1;
    }
    function findRun(keepPlace) {
      const q = $('findInput').value;
      const prev = keepPlace && findHits[findAt] ? findHits[findAt].startContainer : null;
      findClear();
      if (!q.trim()) { findShowCount(); return; }
      $('log').querySelector(':scope > .older-turns')?.loadAll?.();     // a long chat: build the earlier turns too
      const needle = q.toLowerCase(), hits = [];
      const walker = document.createTreeWalker($('log'), NodeFilter.SHOW_TEXT, {acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || p.closest('script, style, svg, .older-turns, #log > .empty')) return NodeFilter.FILTER_REJECT;
        if (!p.getClientRects().length) return NodeFilter.FILTER_REJECT;    // hidden (folded steps, closed cards)
        return n.nodeValue.toLowerCase().includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }});
      while (walker.nextNode()) {
        const n = walker.currentNode, text = n.nodeValue.toLowerCase();
        for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) {
          const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + needle.length); hits.push(r);
          if (hits.length >= 2000) break;
        }
        if (hits.length >= 2000) break;
      }
      findHits = hits;
      if (FIND_HL && hits.length) CSS.highlights.set('find-hit', new Highlight(...hits));
      // start at the same place after the chat changed, otherwise at the match nearest the bottom of the view
      let at = prev ? hits.findIndex(r => r.startContainer === prev) : -1;
      if (at < 0 && hits.length) {
        const bottom = $('chat').getBoundingClientRect().bottom;
        at = hits.length - 1;
        for (let i = 0; i < hits.length; i++) { if (hits[i].getBoundingClientRect().top > bottom) { at = Math.max(0, i - 1); break; } }
      }
      findGo(at, !keepPlace);
    }
    function findGo(i, scroll = true) {
      if (!findHits.length) { findAt = -1; findShowCount(); return; }
      findAt = (i + findHits.length) % findHits.length;
      const r = findHits[findAt];
      if (FIND_HL) CSS.highlights.set('find-cur', new Highlight(r));
      if (scroll) {
        const chat = $('chat'), box = chat.getBoundingClientRect(), rr = r.getBoundingClientRect();
        if (rr.top < box.top + 70 || rr.bottom > box.bottom - 140) chat.scrollTop += rr.top - box.top - box.height / 3;
      }
      findShowCount();
    }
    function findShowCount() {
      const c = $('findCount'), q = $('findInput').value.trim();
      c.textContent = !q ? '' : findHits.length ? `${findAt + 1} of ${findHits.length}${findHits.length >= 2000 ? '+' : ''}` : 'No results';
      c.classList.toggle('none', !!q && !findHits.length);
      $('findPrev').disabled = $('findNext').disabled = findHits.length < 2;
    }
    function openChatFind(text) {
      const bar = $('findBar');
      bar.hidden = false;
      if (typeof text === 'string' && text.trim()) $('findInput').value = text.trim();
      $('findInput').focus(); $('findInput').select();
      findRun();
    }
    function closeChatFind() {
      $('findBar').hidden = true; findClear(); findShowCount();
    }
    $('findBtn').onclick = () => ($('findBar').hidden ? openChatFind() : closeChatFind());
    $('findClose').onclick = closeChatFind;
    $('findPrev').onclick = () => findGo(findAt - 1);
    $('findNext').onclick = () => findGo(findAt + 1);
    $('findInput').addEventListener('input', () => { clearTimeout(findTimer); findTimer = setTimeout(() => findRun(), 120); });
    $('findInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); findGo(findAt + (e.shiftKey ? -1 : 1)); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeChatFind(); }
    });
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return;
      // in the Files view, Ctrl+F belongs to the open file (see files.js)
      const fb = $('filesBody');
      if (fb && $('diffPanel')?.classList.contains('open') && (fb.contains(document.activeElement) || fb.matches(':hover'))) return;
      e.preventDefault(); openChatFind();
    });
    // the conversation changed (a reply streaming in, another chat opened): search again, keeping the place
    let findQueued = false;
    new MutationObserver(() => {
      if ($('findBar').hidden || findQueued) return;
      findQueued = true;
      setTimeout(() => { findQueued = false; if (!$('findBar').hidden) findRun(true); }, 250);
    }).observe($('log'), {childList: true, subtree: true, characterData: true});
