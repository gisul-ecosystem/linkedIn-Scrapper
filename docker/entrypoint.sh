#!/bin/sh
set -e

export DISPLAY="${DISPLAY:-:99}"

start_vnc() {
  pkill -f 'websockify' >/dev/null 2>&1 || true
  pkill -x x11vnc >/dev/null 2>&1 || true
  pkill -x fluxbox >/dev/null 2>&1 || true
  pkill -x xmessage >/dev/null 2>&1 || true
  sleep 1

  if ! pgrep -x Xvfb >/dev/null 2>&1; then
    Xvfb :99 -screen 0 1440x900x24 -ac +extension GLX +render -noreset >/tmp/xvfb.log 2>&1 &
    sleep 1
  fi

  if command -v xsetroot >/dev/null 2>&1; then
    xsetroot -solid '#2f343f'
  fi

  mkdir -p /root/.fluxbox
  cat > /root/.fluxbox/init <<'EOF'
session.screen0.rootCommand: xsetroot -solid #2f343f
session.screen0.toolbar.visible: false
EOF

  if command -v fluxbox >/dev/null 2>&1; then
    fluxbox >/tmp/fluxbox.log 2>&1 &
    sleep 2
    # Drop fluxbox wallpaper error dialogs, then show our hint
    pkill -x xmessage >/dev/null 2>&1 || true
    sleep 1
  fi

  if command -v xmessage >/dev/null 2>&1; then
    xmessage -geometry 900x220+270+340 -title "LinkedIn viewer" \
      "VNC is working.

Click Connect LinkedIn / Start scrape in the app.
Chromium will appear in this screen.

If this stays empty after Connect, click Reload viewer." \
      >/tmp/xmessage.log 2>&1 &
  fi

  if command -v x11vnc >/dev/null 2>&1; then
    x11vnc -display :99 -forever -shared -nopw -xkb -noxdamage \
      -wait 10 -defer 10 -rfbport 5900 -listen 0.0.0.0 \
      -o /tmp/x11vnc.log >/tmp/x11vnc.out 2>&1 &
    sleep 1
  fi

  if command -v websockify >/dev/null 2>&1; then
    NOVNC_WEB=/usr/share/novnc
    if [ -d "$NOVNC_WEB" ]; then
      websockify --web="$NOVNC_WEB" 0.0.0.0:6080 localhost:5900 >/tmp/novnc.log 2>&1 &
      sleep 1
    fi
  fi

  echo "[docker] DISPLAY=$DISPLAY  VNC=/vnc/ (proxy) and http://localhost:6080/vnc_lite.html?autoconnect=1"
}

if [ -n "$DISPLAY" ]; then
  start_vnc
fi

echo "[docker] MONGODB_URI=$MONGODB_URI  PORT=$PORT"
exec "$@"