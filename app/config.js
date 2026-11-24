/* Edit this file to change what the home screen shows. */
window.HOME_CONFIG = {
  selfId: 'io.github.file48.homescreen',

  /* Inputs column. HDMI 1-4 tested on an LG C2 (webOS 24). */
  inputs: [
    { label: 'HDMI 1', short: '1', appId: 'com.webos.app.hdmi1' },
    { label: 'HDMI 2', short: '2', appId: 'com.webos.app.hdmi2' },
    { label: 'HDMI 3', short: '3', appId: 'com.webos.app.hdmi3' },
    { label: 'HDMI 4', short: '4', appId: 'com.webos.app.hdmi4' }
  ],

  /* Settings column. Each row opens the matching page of LG's settings app. */
  settingsAppIds: ['com.palm.app.settings', 'com.webos.app.settings'],
  settings: [
    { label: 'Picture', target: 'picture', icon: 'picture' },
    { label: 'Sound', target: 'sound', icon: 'sound' },
    /* Same call the settings app itself makes for its network screen (read from its code on the TV). */
    { label: 'Network', icon: 'network', appId: 'com.webos.app.firstuse-overlay',
      params: { target: 'network', appReturn: { appId: 'com.palm.app.settings', params: { target: 'general', item: 'network' } } },
      fallbackIds: [] },
    { label: 'General', target: 'general', icon: 'general' },
    { label: 'Accessibility', target: 'accessibility', icon: 'accessibility' },
    { label: 'All settings', target: null, icon: 'all' }
  ],

  /* Buttons along the top right, in order. 'tray' opens the running apps, 'config' the Customise panel,
     'power' the power menu. */
  bar: [
    { key: 'tray', label: 'Running apps', icon: 'tray' },
    { key: 'config', label: 'Customise', icon: 'customise' },
    { key: 'power', label: 'Power', icon: 'poweroff' }
  ],

  /* Colour schemes for Customise > Themes. The first is the default (Classic is flat, with no panels; the rest are rounded and coloured). The colours themselves live in
     style.css (:root[data-theme=...]); swatch is only the preview: background, panel, highlight. */
  themes: [
    { id: 'classic', label: 'Classic', note: 'The original flat look', swatch: ['#0c0e11', '#1b1f25', '#eef1f4'] },
    { id: 'dusk', label: 'Dusk', note: 'Soft violet with amber', swatch: ['#1e1b2e', '#2a2640', '#ffc857'] },
    { id: 'harbour', label: 'Harbour', note: 'Deep blue with mint', swatch: ['#0f1f2b', '#17303f', '#7fd6c2'] },
    { id: 'woodland', label: 'Woodland', note: 'Forest green with sand', swatch: ['#17221b', '#223229', '#f0d98a'] },
    { id: 'retro', label: 'Retro', note: 'A 90s desktop, windows and all', swatch: ['#9a93a8', '#f4e9d6', '#f59ac4'] },
    { id: 'win95', label: 'Desktop', note: 'Teal, silver and navy, 95 style', swatch: ['#008080', '#c0c0c0', '#000080'] },
    { id: 'poster', label: 'Poster', note: 'Giant type, cobalt and yellow', swatch: ['#2330e8', '#ffffff', '#ffe14d'] },
    { id: 'satellite', label: 'Satellite', note: 'Noughties planner, blue cells, yellow bar', swatch: ['#081a4a', '#1d4a9e', '#ffcf1a'] }
  ],

  /* Never listed, and not offered in Customise > Apps. */
  alwaysHidden: [/^com\.webos\.app\.home$/],

  /* Power menu, run as root through the Homebrew Channel service, because the sleep and power services
     refuse calls from a normal app. confirm: press twice within 2 seconds.
     Screen off is the documented tvpower "turn off screen" call (any remote key wakes it).
     Reboot is the sleep service's machineReboot, so LG's software shuts down cleanly first. Power off is the sleep service's machineOff, which the sleep
     service docs say needs a reason (remoteKey, offTimer or localKey) and shuts the machine down. */
  power: [
    { key: 'standby', label: 'Screen off', icon: 'screenoff', confirm: false,
      shell: "luna-send -n 1 luna://com.webos.service.tvpower/power/turnOffScreen '{}' </dev/null" },
    { key: 'reboot', label: 'Reboot', icon: 'reboot', confirm: true, 
      shell: "luna-send -a webosbrew -n 1 luna://com.webos.service.sleep/shutdown/machineReboot '{\"reason\":\"remoteKey\"}' </dev/null" },
    { key: 'off', label: 'Power off', icon: 'poweroff', confirm: true,
      shell: "luna-send -n 1 luna://com.webos.service.sleep/shutdown/machineOff '{\"reason\":\"localKey\"}' </dev/null" }
  ],

  /* Key that opens and closes the running-apps tray: 403 is the Red button. */
  trayKey: 403,

  /* Key that opens and closes Customise > Themes: 404 is the Green button. */
  themesKey: 404,

  /* Gauges (top left): hollow rings, filled by how much is in use. Read every statsEveryMs while visible. */
  gauges: [
    { key: 'cpu', label: 'CPU', icon: 'cpu' },
    { key: 'mem', label: 'Memory', icon: 'memory' },
    { key: 'disk', label: 'Storage', icon: 'storage' }
  ],
  statsEveryMs: 5000,

  /* Apps column. Anything whose id matches is left out of the list. */
  hideApps: [
    /^com\.webos\.app\.hdmi/,
    /^com\.webos\.app\.livetv$/,
    /^com\.webos\.app\.home$/,
    /^com\.palm\.app\.settings$/,
    /^com\.webos\.app\.settings$/,
    /^com\.webos\.app\.discovery$/,         /* Apps (LG content store) */
    /^com\.webos\.app\.sportsteamsettings$/, /* Sports */
    /^com\.webos\.app\.homeconnect$/,        /* Home Hub */
    /^com\.webos\.app\.lgchannels$/,         /* LG Channels */
    /^com\.webos\.app\.lifeonscreen$/,       /* Always Ready */
    /^com\.webos\.app\.camera$/,             /* Camera */
    /^amazon\.alexa\.view$/,                 /* Amazon Alexa */
    /^com\.webos\.app\.mediadiscovery$/      /* Media Player */
  ]
};
