(function () {
  'use strict';

  var cfg = window.HOME_CONFIG;
  var LAUNCH = 'luna://com.webos.applicationManager/launch';
  var LIST_LAUNCH_POINTS = 'luna://com.webos.applicationManager/listLaunchPoints';
  var RUNNING = 'luna://com.webos.applicationManager/running';
  var CLOSE_APP = 'luna://com.webos.applicationManager/closeByAppId';
  var HBCHANNEL_EXEC = 'luna://org.webosbrew.hbchannel.service/exec';

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, BACKSPACE: 8, ESC: 27 };

  function byId(id) { return document.getElementById(id); }

  var cols = [
    { key: 'apps', el: byId('col-apps'), items: [], row: 0 },
    { key: 'inputs', el: byId('col-inputs'), items: [], row: 0, horizontal: true },
    { key: 'settings', el: byId('col-settings'), items: [], row: 0 }
  ];
  var active = 0;
  var zone = 'cols'; /* 'cols', 'bar' (the buttons along the top) or an open panel: 'tray', 'menu', 'config' */
  var bar = { el: byId('actions'), items: [], index: 0 };
  var menu = { el: byId('menu'), list: byId('menu-list'), items: [], index: 0, open: false };
  var config = { el: byId('config'), list: byId('cfg-list'), title: byId('cfg-title'), hint: byId('cfg-hint'), open: false, screen: 'home', items: [], index: 0 };
  var lastPoints = []; /* every app the TV listed, for the customise screen */
  var tray = { el: byId('tray'), list: byId('tray-list'), items: [], index: 0, open: false, token: 0 };
  var appIndex = {}; /* id -> { label, icon } for every app in the list, used to name running apps */
  var armedKey = null;
  var armTimer = null;
  var CONFIRM_MS = 2000; /* second press must land within this */
  var toastTimer = null;

  /* ---------- saved choices: theme, and which apps are hidden ----------
     Kept in the page's own storage for a fast start, and in a file on the TV (written through the root service)
     so they survive a reinstall. Only a theme id from the list, app ids matching SAFE_ID and 0/1 are ever kept,
     so nothing else can reach the shell command that writes the file. */

  var SETTINGS_KEY = 'homescreen-settings';
  var SETTINGS_FILE = '/media/developer/homescreen-settings.json';
  var THEME_IDS = cfg.themes.map(function (t) { return t.id; });
  var settings = { theme: THEME_IDS[0], apps: {} }; /* apps[id]: 1 = hidden, 0 = shown, absent = the default rule */
  var settingsTouched = false;
  var saveErrorShown = false;

  function cleanSettings(raw) {
    var out = { theme: THEME_IDS[0], apps: {} };
    if (!raw || typeof raw !== 'object') { return out; }
    if (THEME_IDS.indexOf(raw.theme) >= 0) { out.theme = raw.theme; }
    var apps = raw.apps && typeof raw.apps === 'object' ? raw.apps : {};
    Object.keys(apps).forEach(function (id) {
      if (SAFE_ID.test(id) && (apps[id] === 0 || apps[id] === 1)) { out.apps[id] = apps[id]; }
    });
    return out;
  }

  function applyTheme(id) {
    document.documentElement.setAttribute('data-theme', id);
  }

  function storeLocal() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* storage unavailable: the file still holds it */ }
  }

  function loadSettings() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { raw = null; }
    settings = cleanSettings(raw);
    applyTheme(settings.theme);
  }

  function saveSettings() {
    settingsTouched = true;
    storeLocal();
    if (!luna.available) { return; }
    var command = "printf '%s' '" + JSON.stringify(settings) + "' > '" + SETTINGS_FILE + "'";
    luna(HBCHANNEL_EXEC, { command: command }, function (err) {
      if (err && !saveErrorShown) {
        saveErrorShown = true;
        toast('Could not save your choices to the TV: ' + err);
      }
    });
  }

  /* The file wins over the page's own copy, unless something was changed since the page opened. */
  function loadSettingsFile() {
    if (!luna.available) { return; }
    luna(HBCHANNEL_EXEC, { command: "cat '" + SETTINGS_FILE + "' 2>/dev/null" }, function (err, res) {
      if (err || !res || settingsTouched) { return; }
      var raw;
      try { raw = JSON.parse(execOutput(res)); } catch (e) { return; }
      var next = cleanSettings(raw);
      if (JSON.stringify(next) === JSON.stringify(settings)) { return; }
      settings = next;
      applyTheme(settings.theme);
      storeLocal();
      if (lastPoints.length) { rebuildApps(); }
    });
  }

  /* ---------- rendering ---------- */

  function setItems(col, items) {
    col.items = items;
    if (col.row >= items.length) { col.row = Math.max(0, items.length - 1); }
    var list = col.el.querySelector('.list');
    list.textContent = '';
    list.classList.toggle('tiles', !!col.horizontal);
    items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'row' + (item.note ? ' is-note' : '') + (item.tile ? ' tile' : '');
      if (item.ariaLabel) { li.setAttribute('aria-label', item.ariaLabel); }
      if (item.tile) {
        li.textContent = item.tile;
      } else {
        if (!item.note) { li.appendChild(makeIcon(item)); }
        var label = document.createElement('span');
        label.className = 'label';
        label.textContent = item.label;
        li.appendChild(label);
      }
      list.appendChild(li);
    });
    paint();
  }

  /* Icon box: inline SVG (our own constants), the app's icon image, or a letter tile
     when the image is missing or fails to load. */
  function makeIcon(item) {
    var box = document.createElement('span');
    box.className = 'ico';
    box.setAttribute('aria-hidden', 'true');
    if (item.svg) {
      box.innerHTML = item.svg;
      if (item.tint) { box.className += ' tint p' + item.tint; }
      return box;
    }
    if (!item.icon) {
      showLetter(box, item);
      return box;
    }
    /* Read the cached copy inside our own folder; ask root to copy it there if it is missing. */
    var img = new Image();
    img.alt = '';
    img.onerror = function () { iconMissing(box, item); };
    img.src = item.icon.rel;
    box.appendChild(img);
    return box;
  }

  /* Each app gets the same pastel every time, picked from its id. */
  function pastelFor(item) {
    var key = String(item.id || item.label || '?');
    var sum = 0;
    for (var i = 0; i < key.length; i++) { sum += key.charCodeAt(i); }
    return 'p' + (sum % 6 + 1);
  }

  function showLetter(box, item) {
    box.textContent = (item.label || '?').charAt(0).toUpperCase();
    box.classList.add('mono');
    box.classList.add(pastelFor(item));
  }

  /* ---------- app icon cache ----------
     launchPoints give absolute paths such as /media/cryptofs/..., and the TV does not let this
     page read files outside its own folder (every icon failed to load when tried directly).
     So the root service copies each icon into <app folder>/icons/ and the page reads it from there. */

  var SAFE_ID = /^[A-Za-z0-9._-]+$/;
  var SAFE_PATH = /^\/[A-Za-z0-9._\/-]+\.(png|jpg|jpeg|svg|webp)$/i;
  var APP_DIR = location.pathname.slice(0, location.pathname.lastIndexOf('/'));
  var CAN_COPY = location.protocol === 'file:' && /^\/[A-Za-z0-9._\/-]+$/.test(APP_DIR);
  var missingIcons = [];
  var copyTimer = null;
  var copyTried = {};
  var copyErrorShown = false;

  /* The ids and paths end up inside a root shell command, so only plain characters are accepted. */
  function iconInfo(point) {
    var src = point.largeIcon || point.icon || '';
    if (!SAFE_ID.test(point.id || '') || !SAFE_PATH.test(src)) { return null; }
    var ext = src.slice(src.lastIndexOf('.') + 1).toLowerCase();
    return { src: src, rel: 'icons/' + point.id + '.' + ext };
  }

  function iconMissing(box, item) {
    showLetter(box, item);
    if (!CAN_COPY || copyTried[item.icon.rel]) { return; }
    copyTried[item.icon.rel] = true;
    missingIcons.push({ box: box, item: item });
    clearTimeout(copyTimer);
    copyTimer = setTimeout(copyIcons, 60);
  }

  function copyIcons() {
    var batch = missingIcons;
    missingIcons = [];
    var dir = APP_DIR + '/icons';
    var seen = {};
    var steps = ["mkdir -p '" + dir + "'"];
    batch.forEach(function (m) {
      var rel = m.item.icon.rel;
      if (seen[rel]) { return; }
      seen[rel] = true;
      steps.push("cp -f '" + m.item.icon.src + "' '" + APP_DIR + '/' + rel + "'");
    });
    steps.push("chmod -R a+r '" + dir + "'");
    luna(HBCHANNEL_EXEC, { command: steps.join(' ; ') }, function (err) {
      if (err && !copyErrorShown) {
        copyErrorShown = true;
        toast('Could not copy app icons: ' + err);
      }
      var stamp = Date.now();
      batch.forEach(function (m) {
        var img = new Image();
        img.alt = '';
        img.onload = function () {
          m.box.classList.remove('mono');
          m.box.className = m.box.className.replace(/ ?\bp[1-6]\b/g, '');
          m.box.textContent = '';
          m.box.appendChild(img);
        };
        img.src = m.item.icon.rel + '?v=' + stamp;
      });
    });
  }

  /* keepScroll is true when focus moved because the pointer did: scrolling the list
     under a moving cursor would make rows chase it. */
  function paint(keepScroll) {
    /* A confirm that is no longer under focus is cancelled. */
    if (armedKey && (zone !== 'menu' || !menu.items[menu.index] || menu.items[menu.index].key !== armedKey)) {
      armedKey = null;
      clearTimeout(armTimer);
    }
    paintBar();
    paintMenu();
    cols.forEach(function (col, ci) {
      col.el.classList.toggle('is-active', zone === 'cols' && ci === active);
      var rows = col.el.querySelectorAll('.row');
      for (var i = 0; i < rows.length; i++) {
        rows[i].classList.toggle('is-focus', i === col.row);
      }
      var list = col.el.querySelector('.list');
      var focused = rows[col.row];
      if (focused && !keepScroll) {
        list.scrollTop = focused.offsetTop - (list.clientHeight - focused.offsetHeight) / 2;
      }
    });
  }

  function toast(message) {
    var el = byId('toast');
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 5000);
  }

  /* ---------- launching ---------- */

  function launch(appId, params, label, fallbackIds) {
    var payload = { id: appId };
    if (params) { payload.params = params; }
    luna(LAUNCH, payload, function (err) {
      if (!err) { return; }
      if (fallbackIds && fallbackIds.length) {
        launch(fallbackIds[0], params, label, fallbackIds.slice(1));
        return;
      }
      toast('Could not open ' + label + ': ' + err);
    });
  }

  /* ---------- columns ---------- */

  function buildInputs() {
    setItems(cols[1], cfg.inputs.map(function (input) {
      return {
        label: input.label,
        ariaLabel: input.label,
        tile: input.short,
        run: function () { launch(input.appId, null, input.label); }
      };
    }));
  }

  function buildSettings() {
    setItems(cols[2], cfg.settings.map(function (entry, i) {
      return {
        label: entry.label,
        tint: i % 6 + 1,
        svg: icon(entry.icon),
        run: function () {
          if (entry.appId) { launch(entry.appId, entry.params || null, entry.label, entry.fallbackIds || []); return; }
          var ids = cfg.settingsAppIds;
          launch(ids[0], entry.target ? (entry.item ? { target: entry.target, item: entry.item } : { target: entry.target }) : null, entry.label, ids.slice(1));
        }
      };
    }));
  }

  function defaultHidden(id) {
    return cfg.hideApps.some(function (re) { return re.test(id); });
  }

  /* The launcher itself and the Home stand-in are never listed, and cannot be shown. */
  function alwaysHidden(id) {
    return id === cfg.selfId || cfg.alwaysHidden.some(function (re) { return re.test(id); });
  }

  function isHidden(id) {
    if (alwaysHidden(id)) { return true; }
    if (Object.prototype.hasOwnProperty.call(settings.apps, id)) { return settings.apps[id] === 1; }
    return defaultHidden(id);
  }

  function appsFromLaunchPoints(points) {
    var seen = {};
    appIndex = {};
    lastPoints = points.filter(function (p) { return p && p.id; });
    return lastPoints
      .filter(function (p) {
        if (isHidden(p.id) || seen[p.id]) { return false; }
        seen[p.id] = true;
        return true;
      })
      .map(function (p) {
        var label = p.title || p.id;
        var icon = iconInfo(p);
        appIndex[p.id] = { label: label, icon: icon };
        return { id: p.id, label: label, icon: icon, run: function () { launch(p.id, null, label); } };
      })
      .sort(function (a, b) { return a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1; });
  }

  function rebuildApps() {
    showApps(appsFromLaunchPoints(lastPoints));
  }

  function showApps(items) {
    if (!items.length) {
      items = [{ label: 'No apps found. Select to check again.', note: true, run: loadApps }];
    }
    setItems(cols[0], items);
  }

  function showAppsError(reason) {
    setItems(cols[0], [{
      label: 'Cannot read the app list (' + reason + '). Select to try again.',
      note: true,
      run: loadApps
    }]);
  }

  /* The root service returns the command's stdout as plain text or base64, depending on version. */
  function execOutput(res) {
    if (typeof res.stdoutString === 'string') { return res.stdoutString; }
    if (typeof res.stdoutBytes === 'string') {
      try { return atob(res.stdoutBytes); } catch (e) { return ''; }
    }
    return '';
  }

  function loadAppsViaRoot(firstError) {
    var command = "luna-send -n 1 -f luna://com.webos.service.applicationmanager/listLaunchPoints '{}'";
    luna(HBCHANNEL_EXEC, { command: command }, function (err, res) {
      if (err) { showAppsError(firstError + '; root fallback: ' + err); return; }
      var parsed;
      try { parsed = JSON.parse(execOutput(res)); } catch (e) { parsed = null; }
      if (!parsed || !parsed.launchPoints) {
        showAppsError(firstError + '; root fallback returned no app list');
        return;
      }
      showApps(appsFromLaunchPoints(parsed.launchPoints));
    });
  }

  function loadApps() {
    if (!luna.available) {
      /* Browser preview only. */
      showApps(appsFromLaunchPoints([
        { id: 'youtube.leanback.v4', title: 'YouTube' },
        { id: 'netflix', title: 'Netflix' },
        { id: 'com.webos.app.browser', title: 'Web Browser' },
        { id: 'org.webosbrew.hbchannel', title: 'Homebrew Channel' },
        { id: 'com.webos.app.hdmi1', title: 'HDMI 1' }
      ]));
      return;
    }
    luna(LIST_LAUNCH_POINTS, {}, function (err, res) {
      if (err || !res || !res.launchPoints) {
        loadAppsViaRoot(err || 'no launch points returned');
        return;
      }
      showApps(appsFromLaunchPoints(res.launchPoints));
    });
  }

  /* ---------- top bar: system gauges and power buttons ---------- */

  var RING_R = 21;
  var RING_C = 2 * Math.PI * RING_R;
  var gaugeEls = {};

  function ringSvg() {
    return '<svg class="ring" viewBox="0 0 48 48" aria-hidden="true">' +
      '<circle class="plate" cx="24" cy="24" r="22.5"/>' +
      '<circle class="track" cx="24" cy="24" r="' + RING_R + '"/>' +
      '<circle class="arc" cx="24" cy="24" r="' + RING_R + '" transform="rotate(-90 24 24)" ' +
      'stroke-dasharray="0 ' + RING_C.toFixed(2) + '"/></svg>';
  }

  function buildGauges() {
    var list = byId('gauges');
    list.textContent = '';
    cfg.gauges.forEach(function (g) {
      var li = document.createElement('li');
      li.className = 'gauge';
      li.innerHTML = ringSvg() + '<span class="gico" aria-hidden="true">' + icon(g.icon) + '</span>';
      li.setAttribute('aria-label', g.label);
      list.appendChild(li);
      gaugeEls[g.key] = { li: li, arc: li.querySelector('.arc'), label: g.label };
    });
  }

  function setGauge(key, pct) {
    var g = gaugeEls[key];
    if (!g) { return; }
    var ok = typeof pct === 'number' && isFinite(pct);
    var value = ok ? Math.max(0, Math.min(100, pct)) : 0;
    g.arc.setAttribute('stroke-dasharray', (value * RING_C / 100).toFixed(2) + ' ' + RING_C.toFixed(2));
    g.li.classList.toggle('is-hot', ok && value >= 90);
    var text = g.label + (ok ? ' ' + Math.round(value) + '%' : ' unknown');
    g.li.setAttribute('aria-label', text);
    g.li.title = text;
  }

  /* One root command prints: the cpu line of /proc/stat, MemTotal, MemAvailable, and the df line for the
     user storage partition. No input from the page goes into it. */
  var STATS_CMD = "head -1 /proc/stat; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo; df -k /media/developer | tail -1";
  var cpuPrev = null;
  var statsBusy = false;
  var statsTimer = null;

  function parseStats(text) {
    var out = { cpuRaw: null, mem: null, disk: null };
    var total = null;
    var avail = null;
    String(text || '').split('\n').forEach(function (line) {
      var m;
      if ((m = /^cpu\s+(.+)$/.exec(line))) {
        var n = m[1].trim().split(/\s+/).slice(0, 8).map(Number);
        if (n.length >= 4 && n.every(isFinite)) {
          out.cpuRaw = {
            total: n.reduce(function (x, y) { return x + y; }, 0),
            idle: n[3] + (n[4] || 0)
          };
        }
      } else if ((m = /^MemTotal:\s+(\d+)/.exec(line))) {
        total = Number(m[1]);
      } else if ((m = /^MemAvailable:\s+(\d+)/.exec(line))) {
        avail = Number(m[1]);
      } else {
        var t = line.trim().split(/\s+/);
        if (t.length >= 5 && /^\d+$/.test(t[2]) && /^\d+$/.test(t[3]) && /^\//.test(t[0])) {
          var used = Number(t[2]);
          var free = Number(t[3]);
          if (used + free > 0) { out.disk = 100 * used / (used + free); }
        }
      }
    });
    if (total && avail !== null) { out.mem = 100 * (total - avail) / total; }
    return out;
  }

  function cpuPercent(prev, now) {
    if (!prev || !now) { return null; }
    var dTotal = now.total - prev.total;
    var dIdle = now.idle - prev.idle;
    if (dTotal <= 0) { return null; }
    return 100 * (1 - dIdle / dTotal);
  }

  function pollStats() {
    if (!luna.available) {
      setGauge('cpu', 32); setGauge('mem', 55); setGauge('disk', 50); /* browser preview only */
      return;
    }
    if (statsBusy) { return; }
    statsBusy = true;
    luna(HBCHANNEL_EXEC, { command: STATS_CMD }, function (err, res) {
      statsBusy = false;
      if (err || !res) { return; }
      var s = parseStats(execOutput(res));
      var hadPrev = !!cpuPrev;
      var cpu = cpuPercent(cpuPrev, s.cpuRaw);
      if (s.cpuRaw) { cpuPrev = s.cpuRaw; }
      if (cpu !== null) { setGauge('cpu', cpu); }
      setGauge('mem', s.mem);
      setGauge('disk', s.disk);
      if (!hadPrev && s.cpuRaw) { setTimeout(pollStats, 1500); } /* a second sample gives the first reading */
    });
  }

  function startStats() {
    stopStats();
    pollStats();
    statsTimer = setInterval(pollStats, cfg.statsEveryMs || 5000);
  }

  function stopStats() {
    if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
    cpuPrev = null; /* the gap while hidden would skew the next reading */
  }

  /* Every icon carries its standard drawing and, where one exists, the Desktop theme's pixel drawing.
     The stylesheet shows one or the other, so switching theme needs no re-render. */
  function icon(name) {
    var std = (window.ICONS && window.ICONS[name]) || '';
    var px = window.ICONS95 && window.ICONS95[name];
    if (!px) { return std; }
    return std.replace('<svg ', '<svg class="ic-std" ') + px;
  }

  function buildBar() {
    bar.el.textContent = '';
    bar.items = cfg.bar.map(function (b) { return { key: b.key, label: b.label, svg: icon(b.icon) }; });
    bar.items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'btn';
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', item.label);
      li.innerHTML = item.svg;
      bar.el.appendChild(li);
    });
  }

  function barIndex(key) {
    for (var i = 0; i < bar.items.length; i++) { if (bar.items[i].key === key) { return i; } }
    return 0;
  }

  function overlayOpen(key) {
    return (key === 'tray' && tray.open) || (key === 'config' && config.open) || (key === 'power' && menu.open);
  }

  function paintBar() {
    var lis = bar.el.children;
    for (var i = 0; i < lis.length; i++) {
      lis[i].classList.toggle('is-focus', zone === 'bar' && i === bar.index);
      lis[i].classList.toggle('is-open', overlayOpen(bar.items[i].key));
    }
  }

  function runBarItem(item) {
    if (!item) { return; }
    if (item.key === 'tray') { openTray(); }
    else if (item.key === 'config') { openConfig(); }
    else if (item.key === 'power') { openMenu(); }
  }

  /* ---------- power menu ---------- */

  function buildMenu() {
    menu.items = cfg.power.map(function (p) {
      return { key: p.key, label: p.label, svg: icon(p.icon), confirm: !!p.confirm, shell: p.shell };
    });
  }

  function renderMenu() {
    menu.list.textContent = '';
    menu.items.forEach(function () {
      var li = document.createElement('li');
      li.className = 'mrow';
      li.setAttribute('role', 'button');
      menu.list.appendChild(li);
    });
    paintMenu();
  }

  function paintMenu() {
    var lis = menu.list.children;
    for (var i = 0; i < lis.length; i++) {
      var item = menu.items[i];
      var armed = item.key === armedKey;
      lis[i].classList.toggle('is-focus', i === menu.index);
      lis[i].classList.toggle('is-armed', armed);
      lis[i].setAttribute('aria-label', armed ? 'Confirm ' + item.label : item.label);
      var state = armed ? 'confirm' : 'icon';
      if (lis[i].getAttribute('data-state') !== state) {
        lis[i].innerHTML = armed ? icon('confirm') : item.svg;
        var text = document.createElement('span');
        text.textContent = armed ? 'Press again' : item.label;
        lis[i].appendChild(text);
        lis[i].setAttribute('data-state', state);
      }
    }
  }

  function disarm() {
    armedKey = null;
    clearTimeout(armTimer);
    paintMenu();
  }

  function runPower(item) {
    if (!item) { return; }
    if (item.confirm && armedKey !== item.key) {
      armedKey = item.key;
      clearTimeout(armTimer);
      armTimer = setTimeout(disarm, CONFIRM_MS);
      toast('Press again to ' + item.label.toLowerCase());
      paintMenu();
      return;
    }
    disarm();
    closeMenu();
    toast(item.label + '...');
    luna(HBCHANNEL_EXEC, { command: item.shell }, function (err, res) {
      /* Reboot and power off can end the call by taking the TV down, so a late timeout is not news.
         Anything else the command says is shown, so a no-op is visible instead of silent. */
      var said = res && (res.stderrString || '').trim();
      if (err && err !== 'timed out') { toast(item.label + ' failed: ' + err); }
      else if (said) { toast(item.label + ': ' + said); }
      else if (!err && !item.confirm) { return; }
      else if (!err) { toast(item.label + ' sent, TV did not respond'); }
    });
  }

  function closeAll() {
    tray.open = false;
    tray.token++;
    tray.el.hidden = true;
    menu.open = false;
    menu.el.hidden = true;
    config.open = false;
    config.el.hidden = true;
    armedKey = null;
    clearTimeout(armTimer);
  }

  function openMenu() {
    if (menu.open) { closeMenu(); return; }
    closeAll();
    menu.open = true;
    menu.el.hidden = false;
    menu.index = 0;
    zone = 'menu';
    renderMenu();
    paint();
  }

  function closeMenu() {
    menu.open = false;
    menu.el.hidden = true;
    armedKey = null;
    clearTimeout(armTimer);
    zone = 'bar';
    bar.index = barIndex('power');
    paint();
  }

  /* ---------- customise: apps and themes ---------- */

  var CONFIG_TITLES = { home: 'Customise', apps: 'Apps', themes: 'Themes' };
  var CONFIG_HINTS = {
    home: 'Choose what to change.',
    apps: 'Select an app to show or hide it. Changes apply straight away.',
    themes: 'Select a theme to switch to it. Press Green to close.'
  };

  function backItem() { return { back: true, label: 'Back', svg: icon('back'), tint: 3 }; }

  function configItems(screen) {
    var items;
    if (screen === 'apps') {
      items = [backItem()];
      var seen = {};
      var apps = [];
      lastPoints.forEach(function (p) {
        if (!SAFE_ID.test(p.id) || alwaysHidden(p.id) || seen[p.id]) { return; }
        seen[p.id] = true;
        apps.push({ id: p.id, label: p.title || p.id, icon: iconInfo(p), hidden: isHidden(p.id), app: true });
      });
      apps.sort(function (a, b) { return a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1; });
      if (!apps.length) { items.push({ note: true, label: 'No apps loaded yet.' }); }
      return items.concat(apps);
    }
    if (screen === 'themes') {
      items = [backItem()];
      cfg.themes.forEach(function (t) {
        items.push({ theme: t.id, label: t.label, sub: t.note, swatch: t.swatch, active: t.id === settings.theme });
      });
      return items;
    }
    return [
      { go: 'apps', label: 'Apps', sub: 'Choose which apps are listed', svg: icon('apps'), tint: 1 },
      { go: 'themes', label: 'Themes', sub: 'Pick a colour scheme', svg: icon('themes'), tint: 2 }
    ];
  }

  function renderConfig() {
    config.title.textContent = CONFIG_TITLES[config.screen];
    config.hint.textContent = CONFIG_HINTS[config.screen];
    config.list.textContent = '';
    config.items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'crow' + (item.hidden ? ' is-off' : '');
      li.setAttribute('role', 'button');
      if (item.swatch) {
        var sw = document.createElement('span');
        sw.className = 'swatch';
        sw.setAttribute('aria-hidden', 'true');
        item.swatch.forEach(function (colour) {
          var stripe = document.createElement('span');
          stripe.style.background = colour;
          sw.appendChild(stripe);
        });
        li.appendChild(sw);
      } else if (!item.note) {
        li.appendChild(makeIcon(item));
      }
      var text = document.createElement('span');
      text.className = 'ctext';
      text.appendChild(document.createTextNode(item.label));
      if (item.sub) {
        var sub = document.createElement('span');
        sub.className = 'csub';
        sub.textContent = item.sub;
        text.appendChild(sub);
      }
      li.appendChild(text);
      var right = document.createElement('span');
      right.className = 'cright';
      if (item.go) { right.innerHTML = icon('next'); }
      else if (item.app) { right.innerHTML = icon(item.hidden ? 'hidden' : 'shown'); right.appendChild(document.createTextNode(item.hidden ? 'Hidden' : 'Shown')); }
      else if (item.active) { right.innerHTML = icon('confirm'); }
      li.appendChild(right);
      li.setAttribute('aria-label', item.app ? item.label + ', ' + (item.hidden ? 'hidden' : 'shown') : item.label);
      config.list.appendChild(li);
    });
    paintConfig();
  }

  function paintConfig() {
    var rows = config.list.children;
    if (config.index >= rows.length) { config.index = Math.max(0, rows.length - 1); }
    for (var i = 0; i < rows.length; i++) { rows[i].classList.toggle('is-focus', i === config.index); }
    var row = rows[config.index];
    if (row) { config.list.scrollTop = row.offsetTop - (config.list.clientHeight - row.offsetHeight) / 2; }
  }

  function configGo(screen, index) {
    config.screen = screen;
    config.items = configItems(screen);
    if (index === undefined) {
      index = 1;
      if (screen === 'themes') {
        config.items.forEach(function (it, i) { if (it.active) { index = i; } });
      }
    }
    config.index = index;
    renderConfig();
  }

  function openConfig() {
    if (config.open) { closeConfig(); return; }
    closeAll();
    config.open = true;
    config.el.hidden = false;
    zone = 'config';
    configGo('home', 0);
    paint();
  }

  /* Straight to Customise > Themes (the Green button). Pressing it again closes the panel. */
  function openThemes() {
    if (config.open && config.screen === 'themes') { closeConfig(); return; }
    if (!config.open) {
      closeAll();
      config.open = true;
      config.el.hidden = false;
      zone = 'config';
    }
    configGo('themes');
    paint();
  }

  function closeConfig() {
    config.open = false;
    config.el.hidden = true;
    zone = 'bar';
    bar.index = barIndex('config');
    paint();
  }

  function configBack() {
    if (config.screen === 'home') { closeConfig(); return; }
    configGo('home', config.screen === 'themes' ? 1 : 0);
  }

  function toggleApp(id) {
    var next = isHidden(id) ? 0 : 1;
    if ((next === 1) === defaultHidden(id)) { delete settings.apps[id]; } else { settings.apps[id] = next; }
    saveSettings();
    rebuildApps();
  }

  function configActivate(item) {
    if (!item || item.note) { return; }
    if (item.back) { configBack(); return; }
    if (item.go) { configGo(item.go); return; }
    if (item.app) {
      toggleApp(item.id);
      config.items = configItems('apps');
      renderConfig();
      return;
    }
    if (item.theme) {
      settings.theme = item.theme;
      applyTheme(item.theme);
      saveSettings();
      config.items = configItems('themes');
      renderConfig();
    }
  }

  /* ---------- running apps tray ----------
     Replaces the recent-apps tray of LG's own Home. `running` lists every app the TV holds open; only
     the ones found in the app list are shown (that leaves out the Home stand-in, this launcher, AirPlay
     and the HDMI inputs) and they get the app list's names and icons. Selecting one closes it. */

  function parseRunning(res) {
    var list = (res && res.running) || [];
    var seen = {};
    var out = [];
    list.forEach(function (r) {
      var id = r && r.id;
      if (!id || seen[id] || !SAFE_ID.test(id) || !appIndex[id]) { return; }
      seen[id] = true;
      out.push({ id: id, label: appIndex[id].label, icon: appIndex[id].icon });
    });
    out.sort(function (a, b) { return a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1; });
    return out;
  }

  /* Same pattern as the app list: ask the TV directly, then through the root service if that is refused. */
  function fetchRunning(done) {
    if (!luna.available) {
      done(null, { running: [{ id: 'youtube.leanback.v4' }, { id: 'netflix' }, { id: 'org.webosbrew.hbchannel' }] }); /* browser preview */
      return;
    }
    luna(RUNNING, {}, function (err, res) {
      if (!err && res && res.running) { done(null, res); return; }
      var command = "luna-send -n 1 " + RUNNING + " '{}' </dev/null";
      luna(HBCHANNEL_EXEC, { command: command }, function (err2, res2) {
        if (err2) { done(err || err2); return; }
        var parsed;
        try { parsed = JSON.parse(execOutput(res2)); } catch (e) { parsed = null; }
        if (!parsed || !parsed.running) { done('no list returned'); return; }
        done(null, parsed);
      });
    });
  }

  function closeById(id, done) {
    if (!SAFE_ID.test(id)) { done('bad id'); return; }
    if (!luna.available) { done(null); return; }
    luna(CLOSE_APP, { id: id }, function (err) {
      if (!err) { done(null); return; }
      var command = "luna-send -n 1 " + CLOSE_APP + " '{\"id\":\"" + id + "\"}' </dev/null";
      luna(HBCHANNEL_EXEC, { command: command }, function (err2) { done(err2 || null); });
    });
  }

  function renderTray() {
    tray.list.textContent = '';
    if (!tray.items.length) {
      var empty = document.createElement('li');
      empty.className = 'rempty';
      empty.textContent = tray.loading ? 'Reading running apps...' : 'No apps running in the background.';
      tray.list.appendChild(empty);
      return;
    }
    tray.items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'rtile' + (item.all ? ' is-all' : '');
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', item.all ? 'Close all apps' : 'Close ' + item.label);
      li.appendChild(makeIcon(item));
      var label = document.createElement('span');
      label.className = 'rlabel';
      label.textContent = item.label;
      li.appendChild(label);
      tray.list.appendChild(li);
    });
    paintTray();
  }

  function paintTray() {
    var tiles = tray.list.children;
    if (tray.index >= tray.items.length) { tray.index = Math.max(0, tray.items.length - 1); }
    for (var i = 0; i < tiles.length; i++) {
      if (!tray.items.length) { break; }
      tiles[i].classList.toggle('is-focus', i === tray.index);
    }
    var t = tiles[tray.index];
    if (t && tray.items.length) {
      tray.list.scrollLeft = t.offsetLeft - (tray.list.clientWidth - t.offsetWidth) / 2;
    }
  }

  function withCloseAll(apps) {
    var items = apps.slice();
    if (apps.length > 1) {
      items.push({ all: true, label: 'Close all', svg: icon('close') });
    }
    return items;
  }

  function loadRunning() {
    var token = ++tray.token;
    tray.loading = true;
    tray.items = [];
    renderTray();
    fetchRunning(function (err, res) {
      if (token !== tray.token) { return; }
      tray.loading = false;
      if (err) { toast('Cannot read running apps: ' + err); }
      tray.items = err ? [] : withCloseAll(parseRunning(res));
      tray.index = 0;
      renderTray();
    });
  }

  function openTray() {
    if (tray.open) { closeTray(); return; }
    closeAll();
    tray.open = true;
    tray.el.hidden = false;
    zone = 'tray';
    paint();
    loadRunning();
  }

  function closeTray() {
    tray.open = false;
    tray.token++;
    tray.el.hidden = true;
    zone = 'bar';
    bar.index = barIndex('tray');
    paint();
  }

  function closeApp(item) {
    if (!item) { return; }
    if (item.all) {
      var apps = tray.items.filter(function (i) { return !i.all; });
      var left = apps.length;
      apps.forEach(function (a) {
        closeById(a.id, function () {
          left--;
          if (left === 0) { loadRunning(); }
        });
      });
      return;
    }
    if (item.closing) { return; }
    item.closing = true;
    closeById(item.id, function (err) {
      item.closing = false;
      if (err) { toast('Could not close ' + item.label + ': ' + err); return; }
      var at = tray.items.indexOf(item);
      if (at < 0) { return; }
      tray.items.splice(at, 1);
      if (tray.items.length === 1 && tray.items[0].all) { tray.items = []; }
      tray.index = Math.min(at, Math.max(0, tray.items.length - 1));
      renderTray();
    });
  }

  /* ---------- navigation ---------- */

  function enterBar() {
    zone = 'bar';
    bar.index = Math.min(active, bar.items.length - 1);
    paint();
  }

  function move(dx, dy) {
    if (zone === 'menu') {
      if (dy) { menu.index = Math.max(0, Math.min(menu.items.length - 1, menu.index + dy)); paint(); }
      else if (dx < 0) { closeMenu(); }
      return;
    }
    if (zone === 'config') {
      if (dy) { config.index = Math.max(0, Math.min(config.items.length - 1, config.index + dy)); paintConfig(); }
      else if (dx < 0) { configBack(); }
      return;
    }
    if (zone === 'tray') {
      if (dx) { tray.index = Math.max(0, Math.min(tray.items.length - 1, tray.index + dx)); paintTray(); }
      else { closeTray(); }
      return;
    }
    if (zone === 'bar') {
      if (dx) { bar.index = Math.max(0, Math.min(bar.items.length - 1, bar.index + dx)); }
      else if (dy > 0) { zone = 'cols'; }
      paint();
      return;
    }
    if (dx) {
      var here = cols[active];
      if (here.horizontal) {
        /* Left and right step through the tiles first, and leave the column from either end. */
        var tile = here.row + dx;
        if (tile >= 0 && tile < here.items.length) {
          here.row = tile;
          paint();
          return;
        }
      }
      var next = active + dx;
      if (next < 0 || next >= cols.length) { return; }
      active = next;
    }
    if (dy) {
      var col = cols[active];
      if (dy < 0 && (col.horizontal || col.row === 0)) { enterBar(); return; }
      if (col.horizontal) { return; }
      var row = col.row + dy;
      if (row < 0 || row >= col.items.length) { return; }
      col.row = row;
    }
    paint();
  }

  function activate() {
    if (zone === 'tray') { closeApp(tray.items[tray.index]); return; }
    if (zone === 'menu') { runPower(menu.items[menu.index]); return; }
    if (zone === 'config') { configActivate(config.items[config.index]); return; }
    if (zone === 'bar') { runBarItem(bar.items[bar.index]); return; }
    var item = cols[active].items[cols[active].row];
    if (item && item.run) { item.run(); }
  }

  function back() {
    if (zone === 'tray') { closeTray(); }
    else if (zone === 'menu') { closeMenu(); }
    else if (zone === 'config') { configBack(); }
  }

  document.addEventListener('keydown', function (e) {
    /* Red button (403, documented for the MR26GB remote): opens or closes the running-apps tray from anywhere. */
    if (cfg.trayKey && e.keyCode === cfg.trayKey) {
      openTray(); /* toggles */
      e.preventDefault();
      return;
    }
    if (cfg.themesKey && e.keyCode === cfg.themesKey) {
      openThemes(); /* toggles */
      e.preventDefault();
      return;
    }
    switch (e.keyCode) {
      case KEY.LEFT: move(-1, 0); break;
      case KEY.RIGHT: move(1, 0); break;
      case KEY.UP: move(0, -1); break;
      case KEY.DOWN: move(0, 1); break;
      case KEY.OK: activate(); break;
      case KEY.BACK:
      case KEY.BACKSPACE:
      case KEY.ESC: back(); break; /* on the home screen itself Back stays here */
      default: return;
    }
    e.preventDefault();
  }, true);

  /* ---------- Magic Remote pointer ---------- */

  /* Hover focuses a row, click opens it, the wheel scrolls the list.
     LG's Magic Remote guide names the standard mouseover and click events for pointer mode. */
  var lastPointer = { x: null, y: null };

  document.addEventListener('mousemove', function (e) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
  }, true);

  cols.forEach(function (col, ci) {
    var list = col.el.querySelector('.list');

    function rowIndex(e) {
      var row = e.target.closest ? e.target.closest('.row') : null;
      return row ? Array.prototype.indexOf.call(list.children, row) : -1;
    }

    list.addEventListener('mouseover', function (e) {
      /* Rows slide under a still cursor when the D-pad scrolls the list. That mouseover
         reports the same pointer position as before; a real move reports a new one.
         (mouseover fires before mousemove, so the position is compared here, not timed.) */
      var moved = e.clientX !== lastPointer.x || e.clientY !== lastPointer.y;
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
      if (!moved) { return; }
      var index = rowIndex(e);
      if (index < 0 || (zone === 'cols' && active === ci && col.row === index)) { return; }
      zone = 'cols';
      active = ci;
      col.row = index;
      paint(true);
    });

    list.addEventListener('click', function (e) {
      var index = rowIndex(e);
      if (index < 0) { return; }
      zone = 'cols';
      active = ci;
      col.row = index;
      paint(true);
      activate();
    });

    list.addEventListener('wheel', function (e) {
      list.scrollTop += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  });

  function barIndexOf(e) {
    var btn = e.target.closest ? e.target.closest('.btn') : null;
    return btn ? Array.prototype.indexOf.call(bar.el.children, btn) : -1;
  }

  bar.el.addEventListener('mouseover', function (e) {
    var moved = e.clientX !== lastPointer.x || e.clientY !== lastPointer.y;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    if (!moved) { return; }
    var index = barIndexOf(e);
    if (index < 0 || (zone === 'bar' && bar.index === index)) { return; }
    zone = 'bar';
    bar.index = index;
    paint(true);
  });

  bar.el.addEventListener('click', function (e) {
    var index = barIndexOf(e);
    if (index < 0) { return; }
    zone = 'bar';
    bar.index = index;
    paint(true);
    activate();
  });

  function trayIndexOf(e) {
    var t = e.target.closest ? e.target.closest('.rtile') : null;
    return t ? Array.prototype.indexOf.call(tray.list.children, t) : -1;
  }

  tray.list.addEventListener('mouseover', function (e) {
    var moved = e.clientX !== lastPointer.x || e.clientY !== lastPointer.y;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    var index = trayIndexOf(e);
    if (!moved || index < 0 || index === tray.index) { return; }
    tray.index = index;
    paintTray();
  });

  tray.el.addEventListener('click', function (e) {
    var index = trayIndexOf(e);
    if (index < 0) {
      if (!e.target.closest || !e.target.closest('.tray-panel')) { closeTray(); } /* click on the dimmed area */
      return;
    }
    tray.index = index;
    paintTray();
    closeApp(tray.items[index]);
  });

  function listIndexOf(e, list, cls) {
    var t = e.target.closest ? e.target.closest(cls) : null;
    return t ? Array.prototype.indexOf.call(list.children, t) : -1;
  }

  menu.list.addEventListener('mouseover', function (e) {
    var moved = e.clientX !== lastPointer.x || e.clientY !== lastPointer.y;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    var index = listIndexOf(e, menu.list, '.mrow');
    if (!moved || index < 0 || index === menu.index) { return; }
    menu.index = index;
    paint();
  });

  menu.el.addEventListener('click', function (e) {
    var index = listIndexOf(e, menu.list, '.mrow');
    if (index < 0) {
      if (!e.target.closest || !e.target.closest('.menu')) { closeMenu(); } /* click outside the list */
      return;
    }
    menu.index = index;
    paint();
    runPower(menu.items[index]);
  });

  config.list.addEventListener('mouseover', function (e) {
    var moved = e.clientX !== lastPointer.x || e.clientY !== lastPointer.y;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    var index = listIndexOf(e, config.list, '.crow');
    if (!moved || index < 0 || index === config.index) { return; }
    config.index = index;
    var rows = config.list.children;
    for (var i = 0; i < rows.length; i++) { rows[i].classList.toggle('is-focus', i === index); } /* no scrolling under the cursor */
  });

  config.el.addEventListener('click', function (e) {
    var index = listIndexOf(e, config.list, '.crow');
    if (index < 0) {
      if (!e.target.closest || !e.target.closest('.cfg-panel')) { closeConfig(); }
      return;
    }
    config.index = index;
    configActivate(config.items[index]);
  });

  config.list.addEventListener('wheel', function (e) {
    config.list.scrollTop += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  /* Refresh the app list and the gauges whenever the home screen comes back into view;
     stop reading the TV while it is not. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { loadApps(); startStats(); } else { stopStats(); }
  });
  document.addEventListener('webOSRelaunch', function () { loadApps(); startStats(); });

  /* ---------- start ---------- */

  loadSettings();
  buildGauges();
  buildBar();
  buildMenu();
  buildInputs();
  buildSettings();
  loadApps();
  paint();
  startStats();
  loadSettingsFile();
}());
