    // ---------- theme ----------
    // Code themes from highlight.js (bundled in /vendor). Settings only offers the ones made for the current mode, and
    // each mode remembers its own choice, so a dark code theme never lands on a light page. The default ('') is
    // Atom One: its dark version in dark mode, its light version in light mode. 'auto' is the app's own palette
    // (accent colour, no extra stylesheet). The third value is the mode a theme belongs to (none: both).
    const CODE_THEMES = [
      ['Atom One', ''],
      ['App colors (accent)', 'auto'],
      ['GitHub Dark', 'github-dark', 'dark'],
      ['Monokai', 'monokai', 'dark'],
      ['Dracula', 'base16/dracula', 'dark'],
      ['Nord', 'nord', 'dark'],
      ['Night Owl', 'night-owl', 'dark'],
      ['Tokyo Night Dark', 'tokyo-night-dark', 'dark'],
      ['Visual Studio 2015', 'vs2015', 'dark'],
      ['Solarized Dark', 'base16/solarized-dark', 'dark'],
      ['Gruvbox Dark', 'base16/gruvbox-dark-hard', 'dark'],
      ['GitHub Light', 'github', 'light'],
      ['Visual Studio Light', 'vs', 'light'],
      ['Solarized Light', 'base16/solarized-light', 'light'],
    ];
    const codeMode = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const codeThemesFor = (mode) => CODE_THEMES.filter(t => !t[2] || t[2] === mode);
    function codeTheme() {
      const mode = codeMode();
      // 'gui.codeTheme' is the older single choice: it still counts in the mode it was made for
      const stored = store.get('gui.codeTheme.' + mode, null) ?? store.get('gui.codeTheme', '');
      return codeThemesFor(mode).some(t => t[1] === stored) ? stored : '';
    }
    function applyCodeTheme() {
      const stored = codeTheme();
      const choice = stored === 'auto' ? '' : stored || `atom-one-${codeMode()}`;
      if (choice && stored !== 'auto') {
        document.body.classList.remove('hl-auto');
        $('hlTheme').href = `/vendor/hljs-styles/${choice}.min.css`;
      } else {
        document.body.classList.add('hl-auto');
        $('hlTheme').removeAttribute('href');
      }
    }
    // the dropdown lists the current mode's themes
    function syncCodeThemeSelect() {
      const ct = $('codeTheme');
      ct.innerHTML = codeThemesFor(codeMode()).map(t => `<option value="${esc(t[1])}">${esc(t[0])}</option>`).join('');
      ct.value = codeTheme();
      ct.onchange = () => { store.set('gui.codeTheme.' + codeMode(), ct.value); applyCodeTheme(); };
    }
    function applyTheme(t) {
      document.documentElement.dataset.theme = t;
      applyCodeTheme();
    }
    applyTheme(store.get('gui.theme', 'dark'));
    // Settings → Darker background: a near-black palette for dark mode (light mode ignores it)
    function applyDarker() { document.documentElement.toggleAttribute('data-darker', store.get('gui.darker', false)); }
    applyDarker();

    // ---------- fonts ----------
    // [name, css font-family, optional Google Fonts spec loaded on demand]
    // Only fonts that ship with the app (in /fonts) or are installed on the computer: the page loads nothing from outside.
    const BUNDLED = /^(Google\+Sans\+Flex|Inter|JetBrains\+Mono):/;
    const UI_FONTS = [
      ['Google Sans', '"Google Sans Flex", Inter, system-ui, sans-serif', 'Google+Sans+Flex:wght@1..1000'],
      ['Inter', 'Inter, system-ui, sans-serif', 'Inter:wght@100..700'],
      ['System default', 'system-ui, "Segoe UI", sans-serif'],
      ['Segoe UI', '"Segoe UI", system-ui, sans-serif'],
      ['Roboto', 'Roboto, system-ui, sans-serif', 'Roboto:wght@400;500;700'],
      ['Open Sans', '"Open Sans", system-ui, sans-serif', 'Open+Sans:wght@400;500;600;700'],
      ['IBM Plex Sans', '"IBM Plex Sans", system-ui, sans-serif', 'IBM+Plex+Sans:wght@400;500;600;700'],
      ['Source Sans 3', '"Source Sans 3", system-ui, sans-serif', 'Source+Sans+3:wght@400;500;600;700'],
      ['Georgia (serif)', 'Georgia, "Times New Roman", serif'],
      ['DM Sans', '"DM Sans", system-ui, sans-serif', 'DM+Sans:wght@400;500;600;700'],
      ['Manrope', 'Manrope, system-ui, sans-serif', 'Manrope:wght@400;500;600;700'],
      ['Plus Jakarta Sans', '"Plus Jakarta Sans", system-ui, sans-serif', 'Plus+Jakarta+Sans:wght@400;500;600;700'],
      ['Outfit', 'Outfit, system-ui, sans-serif', 'Outfit:wght@400;500;600;700'],
      ['Poppins', 'Poppins, system-ui, sans-serif', 'Poppins:wght@400;500;600;700'],
      ['Lato', 'Lato, system-ui, sans-serif', 'Lato:wght@400;700'],
      ['Nunito', 'Nunito, system-ui, sans-serif', 'Nunito:wght@400;500;600;700'],
      ['Work Sans', '"Work Sans", system-ui, sans-serif', 'Work+Sans:wght@400;500;600;700'],
      ['Figtree', 'Figtree, system-ui, sans-serif', 'Figtree:wght@400;500;600;700'],
      ['Rubik', 'Rubik, system-ui, sans-serif', 'Rubik:wght@400;500;600;700'],
      ['Karla', 'Karla, system-ui, sans-serif', 'Karla:wght@400;500;600;700'],
      ['Public Sans', '"Public Sans", system-ui, sans-serif', 'Public+Sans:wght@400;500;600;700'],
      ['Merriweather (serif)', 'Merriweather, Georgia, serif', 'Merriweather:wght@400;700'],
      ['Lora (serif)', 'Lora, Georgia, serif', 'Lora:wght@400;500;600;700'],
      ['Source Serif 4 (serif)', '"Source Serif 4", Georgia, serif', 'Source+Serif+4:wght@400;500;600;700'],
      ['Newsreader (serif)', 'Newsreader, Georgia, serif', 'Newsreader:wght@400;500;600;700'],
    ].filter(f => !f[2] || BUNDLED.test(f[2]));
    const MONO_FONTS = [
      ['JetBrains Mono', '"JetBrains Mono", ui-monospace, monospace', 'JetBrains+Mono:wght@400;500'],
      ['System monospace', 'ui-monospace, Consolas, monospace'],
      ['Cascadia Code', '"Cascadia Code", Consolas, monospace'],
      ['Consolas', 'Consolas, ui-monospace, monospace'],
      ['Fira Code', '"Fira Code", ui-monospace, monospace', 'Fira+Code:wght@400;500'],
      ['Source Code Pro', '"Source Code Pro", ui-monospace, monospace', 'Source+Code+Pro:wght@400;500'],
      ['IBM Plex Mono', '"IBM Plex Mono", ui-monospace, monospace', 'IBM+Plex+Mono:wght@400;500'],
      ['Roboto Mono', '"Roboto Mono", ui-monospace, monospace', 'Roboto+Mono:wght@400;500'],
      ['Space Mono', '"Space Mono", ui-monospace, monospace', 'Space+Mono:wght@400;700'],
      ['DM Mono', '"DM Mono", ui-monospace, monospace', 'DM+Mono:wght@400;500'],
      ['Inconsolata', 'Inconsolata, ui-monospace, monospace', 'Inconsolata:wght@400;500;600'],
      ['Ubuntu Mono', '"Ubuntu Mono", ui-monospace, monospace', 'Ubuntu+Mono:wght@400;700'],
      ['Overpass Mono', '"Overpass Mono", ui-monospace, monospace', 'Overpass+Mono:wght@400;500'],
      ['Red Hat Mono', '"Red Hat Mono", ui-monospace, monospace', 'Red+Hat+Mono:wght@400;500'],
      ['Geist Mono', '"Geist Mono", ui-monospace, monospace', 'Geist+Mono:wght@400;500'],
      ['Martian Mono', '"Martian Mono", ui-monospace, monospace', 'Martian+Mono:wght@400;500'],
      ['Anonymous Pro', '"Anonymous Pro", ui-monospace, monospace', 'Anonymous+Pro:wght@400;700'],
    ].filter(f => !f[2] || BUNDLED.test(f[2]));
    function loadGoogleFont(spec) {
      // nothing is loaded from the web: the fonts are bundled in /fonts (see fonts.css)
    }
    function applyFonts() {
      const ui = UI_FONTS.find(f => f[0] === store.get('gui.uiFont', 'Google Sans')) || UI_FONTS[0];
      const mono = MONO_FONTS.find(f => f[0] === store.get('gui.monoFont', 'JetBrains Mono')) || MONO_FONTS[0];
      loadGoogleFont(ui[2]); loadGoogleFont(mono[2]);
      document.documentElement.style.setProperty('--ui-font', ui[1]);
      document.documentElement.style.setProperty('--mono-font', mono[1]);
    }
    // The picker shows each font in its own typeface, so load all families once when Settings first opens.
    let fontsPreloaded = false;
    function preloadFontPreviews() {
      // No preloading any more: nothing is requested from Google unless you pick a font that is not bundled.
      fontsPreloaded = true;
    }
    function fillFontSelect(el, fonts, key, fallback) {
      el.innerHTML = fonts.map(f => '<option value="' + esc(f[0]) + '" style="font-family:' + f[1] + '">' + esc(f[0]) + '</option>').join('');
      el.value = store.get(key, fallback);
      if (el.selectedIndex < 0) el.value = fallback;
      el.onchange = () => { store.set(key, el.value); applyFonts(); };
    }
    applyFonts();

    // Chat column width (messages, input and the rows around it all follow --chat-w).
    function applyChatWidth() {
      const w = store.get('gui.chatW', '940px');
      document.documentElement.style.setProperty('--chat-w', w === '100%' ? 'calc(100% - 8px)' : w);
    }
    applyChatWidth();

    // ---------- finish notifications ----------
    // The bell asks the browser for permission; afterwards a desktop notification fires when a reply
    // finishes while this tab is in the background.
    const canNotify = () => 'Notification' in window;
    const notifyOn = () => canNotify() && Notification.permission === 'granted' && store.get('gui.notify', false);
    function syncBell() {
      const sw = $('notifySwitch'), note = $('notifyNote');
      sw.classList.toggle('on', notifyOn());
      if (!canNotify()) { sw.disabled = true; note.textContent = 'Notifications unsupported'; return; }
      const blocked = Notification.permission === 'denied';
      note.textContent = blocked ? 'Notifications blocked' : 'Notify when finished';
      note.title = blocked
        ? 'Blocked by the browser: allow notifications for this site from the padlock in the address bar.'
        : 'Desktop notification when a reply lands while this tab is in the background';
    }
    $('notifySwitch').onclick = async () => {
      if (!canNotify()) return;
      if (notifyOn()) { store.set('gui.notify', false); return syncBell(); }
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      store.set('gui.notify', perm === 'granted');
      syncBell();
      if (perm === 'granted') new Notification('Gemini UI', {body: 'Notifications are on. You\'ll be told when Gemini finishes.', icon: faviconHref(), silent: true});
    };
    const faviconHref = () => document.querySelector('link[rel=icon]')?.href;
    function notifyFinished(session, msg) {
      if (!notifyOn() || (document.visibilityState === 'visible' && document.hasFocus())) return;
      const text = [...msg.parts].reverse().find(p => p.kind === 'text')?.text;
      const failed = msg.parts.some(p => p.kind === 'err' || p.kind === 'auth');
      const body = (failed ? 'Finished with an error. ' : '') + (text || '').replace(/[#*`>_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
      const n = new Notification(failed ? 'Gemini needs your attention' : 'Gemini finished', {
        body: body || session.title, icon: faviconHref(), tag: 'gemini-' + (session.id || 'new'),
      });
      n.onclick = () => { window.focus(); n.close(); };
    }
    syncBell();

    // ---------- settings dialog ----------
    function syncThemeSeg() {
      const t = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      $('themeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.theme === t));
      $('darkerSwitch').classList.toggle('on', store.get('gui.darker', false));
      $('darkerRow').hidden = t === 'light';          // only means something in dark mode
    }
    $('darkerSwitch').onclick = (e) => {
      e.stopPropagation();
      store.set('gui.darker', !store.get('gui.darker', false)); applyDarker(); syncThemeSeg();
    };
    $('themeSeg').onclick = (e) => {
      const b = e.target.closest('button[data-theme]'); if (!b) return;
      store.set('gui.theme', b.dataset.theme); applyTheme(b.dataset.theme); syncThemeSeg();
      applyGrad(); syncPrimaryColor();      // each mode has its own default accent
      syncCodeThemeSelect();                // ... and its own code themes
    };
    function openSettings() {
      if (typeof renderTrustedDomains === 'function') renderTrustedDomains();
      preloadFontPreviews();
      fillFontSelect($('uiFont'), UI_FONTS, 'gui.uiFont', 'Google Sans');
      fillFontSelect($('monoFont'), MONO_FONTS, 'gui.monoFont', 'JetBrains Mono');
      syncCodeThemeSelect();
      const dl = $('dictLang');
      dl.value = store.get('gui.dictLang', 'en-US');
      if (dl.selectedIndex < 0) dl.value = 'en-US';
      dl.onchange = () => store.set('gui.dictLang', dl.value);
      const cw = $('chatWidth');
      cw.value = store.get('gui.chatW', '940px');
      if (cw.selectedIndex < 0) cw.value = '940px';
      cw.onchange = () => { store.set('gui.chatW', cw.value); applyChatWidth(); };
      const pc = $('primaryColor');
      const rs = $('primaryReset');
      pc.oninput = () => {
        store.set('gui.gradA', pc.value);
        store.set('gui.gradB', mixHex(pc.value, '#000000', 0.15));
        applyGrad(); syncPrimaryColor();
      };
      rs.onclick = (e) => {
        e.stopPropagation();
        try { localStorage.removeItem('gui.gradA'); localStorage.removeItem('gui.gradB'); } catch { }
        applyGrad(); syncPrimaryColor();
      };
      syncPrimaryColor();
      syncThemeSeg(); syncBell();
      $('settings').classList.add('open');
    }
    const closeSettings = () => $('settings').classList.remove('open');

    // ---------- gradient ----------
    // Two colours drive the whole palette (see --grad-a / --grad-b). Colours picked earlier with the (removed)
    // temporary picker are still in this browser's storage and keep applying; otherwise the default periwinkle
    // (the second colour is the first darkened 15%, as the Settings picker does).
    const GRAD_DEFAULT = ['#518af6', '#4575d1'];
    // each mode's default accent (light is Nord Snow), unless a primary colour was picked
    const GRAD_LIGHT = ['#5e81ac', '#506e92'];
    const themeAccent = () => document.documentElement.dataset.theme === 'light' ? GRAD_LIGHT : GRAD_DEFAULT;
    const gradColors = () => {
      const d = themeAccent();
      return [store.get('gui.gradA', d[0]), store.get('gui.gradB', d[1])];
    };
    function syncPrimaryColor() {
      const pc = $('primaryColor');
      pc.value = gradColors()[0];
      $('primaryReset').hidden = pc.value.toLowerCase() === themeAccent()[0];
    }
    function mixHex(a, b, f) {
      const c = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
      const x = c(a), y = c(b);
      return '#' + x.map((v, k) => Math.round(v + (y[k] - v) * f).toString(16).padStart(2, '0')).join('');
    }
    function applyGrad() {
      const [a, b] = gradColors(), root = document.documentElement.style;
      root.setProperty('--grad-a', a);
      root.setProperty('--grad-b', b);
    }
    applyGrad();

    $('settingsBtn').onclick = (e) => {
      e.stopPropagation();
      $('settings').classList.contains('open') ? closeSettings() : openSettings();
    };
    document.addEventListener('click', (e) => {
      if (!$('settings').classList.contains('open')) return;
      if (!e.target.closest('.set-dialog') && !e.target.closest('#settingsBtn') && !e.target.closest('.selmenu')) closeSettings();
    });
    // the dialog's pages (General, Appearance) and its close button
    document.querySelectorAll('.set-nav [data-sec]').forEach(b => b.onclick = () => {
      document.querySelectorAll('.set-nav [data-sec]').forEach(x => x.classList.toggle('on', x === b));
      document.querySelectorAll('.set-sec').forEach(sec => { sec.hidden = sec.dataset.sec !== b.dataset.sec; });
    });
    $('settingsClose').onclick = () => closeSettings();

