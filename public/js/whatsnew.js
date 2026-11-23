    // ---------- what's new ----------
    // Shown once, the first time the page opens after an update (the id below is remembered in this browser).
    // To announce a new round of changes: change WHATS_NEW_ID and the list. Settings -> General -> What's new, or
    // /whatsnew, shows it again.
    const WHATS_NEW_ID = '2026-11-ui-refactor';
    const WHATS_NEW = [
      {title: 'A new look', items: [
        ['Redesigned interface', 'Floating message box, rounded controls, a darker theme and a soft glass edge on cards and buttons.'],
        ['Google Sans Flex', 'The default font now ships with the app, and every icon is drawn in-house.'],
        ['Sidebar and search', 'The sidebar button sits top left. Search chats by name with Ctrl+K, with the import button beside it.'],
        ['Settings as a dialog', 'General, Appearance, Security and Usage pages, each with its own icon.'],
        ['Code colours', 'Atom One is the default code theme, and Robot Framework files are highlighted and get their own icon.'],
      ]},
      {title: 'In the chat', items: [
        ['Find in conversation', 'Ctrl+F, the button beside search, or /find. Matches are highlighted and you can step through them.'],
        ['Markdown in your message', 'Lists, headings, quotes, italics and strikethrough render in what you send, and are coloured while you type.'],
        ['Links and files at a glance', 'Jira, Confluence and whiteboard links, and files and folders (even in nested folders), show as an icon with the name.'],
        ['Review-style changes', 'Edited files appear as a tidy card with a Review button. Gemini\'s own notes (memory, scratch, restore) stay out of the way until you open them.'],
        ['Clearer progress', '"Calling Gemini CLI" while a message is sent, a red stop button that shows a spinner while stopping, and rounded suggested replies.'],
        ['New chats start empty', 'No default folder: pick one with the folder pill above the message box. The folder-access popup is gone.'],
      ]},
      {title: 'Usage', items: [
        ['Usage page', 'Click the quota ring (or open Settings) to see each model\'s daily usage as a progress ring, grouped by tier. Green while plenty is left, orange then red as it runs out.'],
      ]},
      {title: 'Security', items: [
        ['Link warnings', 'Links on a domain you have not trusted show a warning and ask before opening. Manage trusted domains in Settings -> Security.'],
        ['Nothing from outside', 'All scripts, styles and fonts are bundled with the app and checked. The page cannot load from, or send to, other sites, and pictures from the web show as links.'],
      ]},
    ];

    function whatsNewDialog() {
      const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
      const modal = el('div', 'modal open wn-modal');
      const dlg = el('div', 'dialog wn-dialog'); dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-label', 'What\'s new');
      const head = el('div', 'wn-head');
      head.append(el('h3', '', 'What\'s new'), el('p', '', 'The interface was refactored. Here is everything that changed.'));
      const body = el('div', 'wn-body');
      const grid = el('div', 'wn-grid');
      WHATS_NEW.forEach(sec => {
        const group = el('section', 'wn-group');
        group.append(el('h4', 'wn-sec', sec.title));
        const ul = el('ul', 'wn-list');
        sec.items.forEach(([t, d]) => {
          const li = el('li');
          li.append(el('span', 'wn-t', t), el('span', 'wn-d', d));
          ul.append(li);
        });
        group.append(ul); grid.append(group);
      });
      body.append(grid);
      const bot = el('div', 'bot');
      const ok = el('button', 'btn wn-ok', 'Got it');
      bot.append(ok);
      dlg.append(head, body, bot); modal.append(dlg); document.body.append(modal);
      // "Got it", Enter, Escape or a click outside all close it, and mark it as read
      const key = (e) => {
        if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); close(); }
      };
      const close = () => {
        document.removeEventListener('keydown', key, true); modal.remove();
        store.set('gui.whatsNew', WHATS_NEW_ID);
      };
      ok.onclick = close;
      modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
      document.addEventListener('keydown', key, true);
      ok.focus();
    }
    if ($('whatsNewBtn')) $('whatsNewBtn').onclick = () => { closeSettings(); whatsNewDialog(); };
    // first time after an update (a moment after the page is ready, so it does not fight the first paint)
    if (store.get('gui.whatsNew', '') !== WHATS_NEW_ID) setTimeout(whatsNewDialog, 700);
