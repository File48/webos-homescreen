#!/bin/sh
# Start-at-boot for the home takeover. Called from /var/lib/webosbrew/init.d/ by the Homebrew Channel.
# Safeguard: a marker file is present while a boot takeover is unfinished. If the next boot finds it, the last
# one never completed (TV left black and power-cycled), so the takeover is switched off and LG Home stays.
DIR="${DIR:-/media/developer/home-takeover}"
T="$DIR/home-takeover.sh"
FLAG="$DIR/enabled"
ATTEMPT="$DIR/boot-attempt"
LINK="${LINK:-/var/lib/webosbrew/init.d/40-homescreen}"
BLOG="${BLOG:-/tmp/homescreen-boot.log}"
UPTIME="${UPTIME_FILE:-/proc/uptime}"
LUNA="${LUNA_SEND:-luna-send}"
PGREP="${PGREP_CMD:-pgrep}"
LAUNCHER_ID="${LAUNCHER_ID:-io.github.file48.homescreen}"
log () { echo "$(date '+%H:%M:%S') boot: $*" >> "$BLOG"; }
up () { cut -d. -f1 "$UPTIME" 2>/dev/null; }

[ -f "$FLAG" ] || exit 0
if [ -f "$ATTEMPT" ]; then
    log "the last boot takeover was not seen to finish: switching it off, LG Home stays"
    rm -f "$ATTEMPT" "$FLAG" "$LINK"
    exit 0
fi
log "starting (uptime $(up)s)"
(
    : > "$ATTEMPT"; sync
    # wait until sam answers with its app list and LG Home is running (short floor on uptime as a guard)
    n=0
    while [ "$n" -lt 150 ]; do
        u=$(up)
        sig=$("$LUNA" -n 1 luna://com.webos.applicationManager/listLaunchPoints '{}' </dev/null 2>/dev/null | wc -c | tr -d ' ')
        home=$("$PGREP" -f '^/usr/bin/com.webos.app.home' 2>/dev/null | head -n 1)
        [ "${u:-0}" -ge "${MIN_UPTIME:-20}" ] && [ "${sig:-0}" -gt 100 ] && [ -n "$home" ] && break
        n=$((n+1)); sleep 1
    done
    log "ready after ${n}s (uptime $(up)s)"
    t=0
    while [ "$t" -lt 2 ]; do
        r=$(sh "$T" on </dev/null 2>&1 | tail -n 1)
        log "try $((t+1)): $r"
        if [ "$r" = applied ]; then
            l=$("$LUNA" -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$LAUNCHER_ID\",\"params\":{}}" </dev/null 2>&1 | tr -d '\n')
            log "launcher opened (uptime $(up)s): $l"
            break
        fi
        case "$r" in launcher-missing|qml-missing|target-missing) break ;; esac   # retrying won't help
        t=$((t+1)); [ "$t" -lt 2 ] && sleep 10
    done
    rm -f "$ATTEMPT"; sync
    log "finished"
) >/dev/null 2>&1 &
exit 0
