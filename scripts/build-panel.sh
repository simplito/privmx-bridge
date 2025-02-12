#!/bin/bash

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
MAIN_DIR="$(dirname $SCRIPT_DIR)"

cd $MAIN_DIR/modules/privmx-bridge-panel

ENV_FILE="$MAIN_DIR/modules/privmx-bridge-panel/.env.local"

if [ -f $ENV_FILE ]; then
echo "$ENV_FILE already exists."
else
cat > "$ENV_FILE" <<EOL
VITE_PRIVMX_BRIDGE_URL=/
VITE_LOG_LEVEL=error
EOL
echo "$ENV_FILE has been created successfully."
fi

npm install
npm run build

rm -rf $MAIN_DIR/public/panel/
cp -r $MAIN_DIR/modules/privmx-bridge-panel/dist $MAIN_DIR/public/panel/
