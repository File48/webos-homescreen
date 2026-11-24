/* Minimal Luna bus client. Mirrors the bridge usage in LG's @enact/webos LS2Request:
   window.WebOSServiceBridge, falling back to window.PalmServiceBridge. */
(function () {
  'use strict';

  var Bridge = window.WebOSServiceBridge || window.PalmServiceBridge;
  var TIMEOUT_MS = 8000;

  /* luna('luna://service/method', params, function (errorText, response) {}) */
  function luna(uri, params, done) {
    if (typeof Bridge !== 'function') {
      done('Luna bridge not available (not running on a TV)');
      return;
    }
    var finished = false;
    var bridge = new Bridge();
    var timer = setTimeout(function () { finish('timed out'); }, TIMEOUT_MS);

    function finish(err, res) {
      if (finished) { return; }
      finished = true;
      clearTimeout(timer);
      try { bridge.cancel(); } catch (e) { /* already closed */ }
      done(err, res);
    }

    bridge.onservicecallback = function (msg) {
      var res;
      try { res = JSON.parse(msg); } catch (e) { finish('invalid response'); return; }
      if (res.returnValue === false || res.errorCode) {
        finish(res.errorText || ('error ' + res.errorCode), res);
        return;
      }
      finish(null, res);
    };
    bridge.call(uri, JSON.stringify(params || {}));
  }

  luna.available = typeof Bridge === 'function';
  window.luna = luna;
}());
