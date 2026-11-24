# Replacing LG Home (experimental)

Makes LG's Home button open the launcher instead of LG's home screen. It depends on LG's internal file layout and boot behaviour, and has only been tested on one TV (LG C2, webOS 24 9.2.2, software 23.25.55).

## How it works

`home-takeover.sh on`:
1. Copies `MainView.qml` to RAM and bind-mounts it over LG Home's `qml/UserInterfaceLayer/Containers/MainView_M.qml`. Nothing on disk changes.
2. Stops LG Home and asks the app manager to launch it again. Home restores from its CRIU snapshot and loads the new view.
3. The new view is a black screen that opens the launcher whenever Home becomes active.
4. If the view isn't seen loading within 15 s, it undoes everything and brings stock Home back.

`boot.sh` re-applies this at every boot. LG's own home screen still shows for the first ~25 s of a cold boot, until Homebrew Channel's startup scripts run.

## Install

```sh
scp -r takeover root@TV_IP:/media/developer/home-takeover
ssh root@TV_IP 'sh /media/developer/home-takeover/home-takeover.sh on'       # should print "applied"
ssh root@TV_IP 'sh /media/developer/home-takeover/home-takeover.sh persist'  # apply at every boot
```

## Undo

```sh
ssh root@TV_IP 'sh /media/developer/home-takeover/home-takeover.sh off'
```

That unmounts the view, restores LG Home and removes the boot hook. Everything lives in RAM, `/media/developer/home-takeover` and one link in `/var/lib/webosbrew/init.d/`, so a reboot without the hook always gives you stock LG Home. If a boot-time takeover starts but never finishes, the next boot switches it off by itself.

## Warnings

- **Never mark LG Home's CRIU snapshot invalid** (an `invalid_img` file in `/mnt/lg/cmn_data/checkpoint/com.webos.app.home/`). On the test TV, LG Home then didn't start at all. To recover, delete that file and `/tmp/checkpoint/com.webos.app.home/invalid_img`, then reboot.
- SSH only starts ~24 s into boot, so a broken app manager can leave you without a shell. That's why this runs late, stays in RAM and has a failsafe.
- Other firmware may use a different file name for the main view. The script checks the file exists and rolls back if the view doesn't load, but it can't foresee everything.
