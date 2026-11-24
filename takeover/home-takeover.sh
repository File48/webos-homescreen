#!/bin/sh
# Swaps LG Home's main view for MainView.qml, so LG Home itself opens the launcher on every Home press.
#  - MainView.qml is copied to RAM and bind-mounted over LG Home's MainView_M.qml (nothing on disk changes)
#  - LG Home is stopped; it restores itself from its CRIU snapshot and loads the view from disk
#  - if the new view isn't seen loading within $WAIT seconds, the swap is undone and stock Home comes back
# Usage: sh home-takeover.sh on | off | status | persist | unpersist
DIR="${DIR:-/media/developer/home-takeover}"
APP_DIR="${APP_DIR:-/usr/palm/applications/com.webos.app.home}"
TARGET="${TARGET:-$APP_DIR/qml/UserInterfaceLayer/Containers/MainView_M.qml}"
QML_SRC="${QML_SRC:-$DIR/MainView.qml}"
QML_RAM="${QML_RAM:-/tmp/homescreen-takeover/MainView.qml}"
LAUNCHER_ID="${LAUNCHER_ID:-io.github.file48.homescreen}"
LAUNCHER="${LAUNCHER:-/media/developer/apps/usr/palm/applications/$LAUNCHER_ID}"
LINK="${LINK:-/var/lib/webosbrew/init.d/40-homescreen}"
LOG="${LOG:-/tmp/homescreen-takeover.log}"
HOME_LOG="${HOME_LOG:-/var/log/home}"
MOUNTS="${MOUNTS:-/proc/mounts}"
UPTIME_FILE="${UPTIME_FILE:-/proc/uptime}"
FLAG="$DIR/enabled"
MARK="[homescreen] replacement main view loaded"
WAIT="${WAIT:-15}"
LG_HOME=com.webos.app.home
LUNA="${LUNA_SEND:-luna-send}"
MOUNT="${MOUNT_CMD:-mount}"
UMOUNT="${UMOUNT_CMD:-umount}"
PGREP="${PGREP_CMD:-pgrep}"
KILL="${KILL_CMD:-kill}"

log () { echo "$(date '+%H:%M:%S') [up $(cut -d' ' -f1 "$UPTIME_FILE" 2>/dev/null)] $*" >> "$LOG"; }
lsend () { "$LUNA" -n 1 "$@" </dev/null 2>/dev/null; }
swapped () { grep -q " $TARGET " "$MOUNTS" 2>/dev/null; }
home_pids () { "$PGREP" -f '^/usr/bin/com.webos.app.home' 2>/dev/null; }
log_lines () { wc -l < "$HOME_LOG" 2>/dev/null | tr -d ' '; }

# did LG Home log our view since line $1 of its log? (whole log if it was rotated since)
view_loaded_since () {
    now=$(log_lines); now=${now:-0}
    if [ "$now" -lt "$1" ]; then grep -q -F "$MARK" "$HOME_LOG" 2>/dev/null
    else tail -n +"$(( $1 + 1 ))" "$HOME_LOG" 2>/dev/null | grep -q -F "$MARK"; fi
}

nap () { sleep 0.2 2>/dev/null || sleep 1; }   # busybox without fractional sleep falls back to 1 s
ask_home () {
    r=$(lsend luna://com.webos.applicationManager/launch "{\"id\":\"$LG_HOME\"}" | tr -d '\n' | tr -s ' ')
    log "asked sam for LG Home: ${r:-no reply}"
}

# stop LG Home and wait for it to come back with the view now on disk; 0 if ours was logged
restart_home () {
    want="$1"; before=$(log_lines); before=${before:-0}
    pids=$(home_pids)
    log "stopping LG Home (pids: ${pids:-none})"
    [ -n "$pids" ] && $KILL $pids 2>/dev/null
    # let the old process exit, then ask for Home straight away (CRIU restores it under the same pid,
    # so a pid that is still there after ~2 s is taken as already back)
    i=0; while [ "$i" -lt 10 ] && [ -n "$(home_pids)" ]; do nap; i=$((i+1)); done
    asked=0
    if [ -z "$(home_pids)" ]; then asked=1; ask_home; fi
    n=0
    while [ "$n" -lt "$WAIT" ]; do
        sleep 1; n=$((n+1))
        # nothing brings a stopped Home back promptly unless it is asked for (seen at boot on HDMI input)
        if [ "$asked" = 0 ] && [ "$n" -ge 2 ] && { [ -z "$(home_pids)" ] || { [ "$want" = ours ] && ! view_loaded_since "$before"; }; }; then
            asked=1; ask_home
        fi
        [ -n "$(home_pids)" ] || continue
        if [ "$want" = ours ]; then view_loaded_since "$before" && { log "our view loaded after ${n}s"; return 0; }
        else [ "$n" -ge 2 ] && { log "LG Home back after ${n}s"; return 0; }; fi
    done
    [ -n "$(home_pids)" ] || log "LG Home did not come back within ${WAIT}s"
    return 1
}

cmd_on () {
    [ -f "$LAUNCHER/appinfo.json" ] || { echo launcher-missing; return 2; }
    [ -f "$QML_SRC" ] || { echo qml-missing; return 2; }
    [ -f "$TARGET" ] || { echo target-missing; return 2; }
    : > "$LOG"; : > "$FLAG"
    if swapped; then log "already swapped"; echo applied; return 0; fi
    mkdir -p "${QML_RAM%/*}" && cp "$QML_SRC" "$QML_RAM" || { echo copy-failed; rm -f "$FLAG"; return 1; }
    $MOUNT --bind "$QML_RAM" "$TARGET" 2>>"$LOG"
    swapped || { log "mount failed"; echo mount-failed; rm -f "$FLAG"; return 1; }
    if restart_home ours; then
        log "applied"; echo applied
    else
        log "our view was not seen: undoing"
        $UMOUNT "$TARGET" 2>>"$LOG" || $UMOUNT -l "$TARGET" 2>>"$LOG"
        restart_home lg
        rm -f "$FLAG"
        echo view-not-loaded; return 3
    fi
}

cmd_off () {
    log "off"
    rm -f "$FLAG" "$LINK"
    if swapped; then
        $UMOUNT "$TARGET" 2>>"$LOG" || $UMOUNT -l "$TARGET" 2>>"$LOG"
        if swapped; then log "unmount failed: reboot to finish"; echo reboot-needed; return 1; fi
        restart_home lg || { echo reboot-needed; return 1; }
        log "LG Home is back"
    fi
    echo removed
}

cmd_status () {
    [ -f "$FLAG" ] && echo enabled
    swapped && echo swapped
    [ -L "$LINK" ] && echo "linked -> $(readlink "$LINK")"
    echo "lg-home pids: $(home_pids | tr '\n' ' ')"
    echo "view loads logged: $(grep -c -F "$MARK" "$HOME_LOG" 2>/dev/null)"
    echo "front: $(lsend luna://com.webos.applicationManager/getForegroundAppInfo '{}' | tr -d '\n' | sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p')"
    tail -n 15 "$LOG" 2>/dev/null
}

case "${1:-status}" in
    on) cmd_on ;; off) cmd_off ;; status) cmd_status ;;
    persist) ln -sf "$DIR/boot.sh" "$LINK" && echo linked ;;
    unpersist) rm -f "$LINK" && echo unlinked ;;
    *) echo "usage: home-takeover.sh on|off|status|persist|unpersist"; exit 1 ;;
esac
