#!/bin/bash
# Double-click to start the dev server and open the game.
# Close this window (or press Ctrl-C) to stop the server.
cd "$(dirname "$0")" || exit 1
PORT=8341

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 isn't installed."
  echo "Run this in Terminal, click Install, then try again:"
  echo "    xcode-select --install"
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

# If something already holds the port, walk up until we find a free one.
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  echo "Port $PORT is busy, trying $((PORT+1))..."
  PORT=$((PORT+1))
done

URL="http://localhost:$PORT/?sampleAudio=1"
clear
echo "RUSH HOUR"
echo "========="
echo
echo "  Serving on $URL"
echo
echo "  RACING DISCIPLINES on the main menu for street / GT / stock car /"
echo "  hypercar / Nordschleife.  C cycles cameras, H shows the controls."
echo
echo "  Leave this window open while you play. Ctrl-C here stops the server."
echo

# Give the server a moment to bind, then open the browser.
( sleep 1.5; open "$URL" ) &

python3 tools/devserver.py "$PORT" .
