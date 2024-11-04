#!/bin/sh

set -e

SCRIPT_DIR=$(dirname $(readlink -f "$0"))
MAIN_DIR="$(dirname $SCRIPT_DIR)"
WORK_DIR=$MAIN_DIR/docker-tmp
DOCKERFILE=$WORK_DIR/Dockerfile

if [ "$#" -ne 3 ]; then
    echo "Illegal number of parameters"
    exit 1
fi

BASE_IMAGE=$1
ARCH=$2
OUT_IMAGE=$3

rm -rf $WORK_DIR
mkdir -p $WORK_DIR
cp -r $MAIN_DIR/docker/bin $WORK_DIR

tee $DOCKERFILE > /dev/null << END
FROM --platform=linux/$ARCH node:22-bullseye-slim

COPY bin /usr/bin
COPY work /work
# RUN cd /work/privmx-bridge && npm ci --omit=dev --omit=optional

# HEALTHCHECK --interval=10s --start-interval=2s --start-period=20s --timeout=5s --retries=5 CMD pmxbridge_up
HEALTHCHECK CMD pmxbridge_up
EXPOSE 3000

CMD ["pmxbridge"]
END

cat $DOCKERFILE
docker create --name=tmp $1
docker cp tmp:/work $WORK_DIR/work
docker rm tmp
rm -rf $WORK_DIR/work/privmx-bridge/node_modules/privmx-native

docker build --progress=plain -t $OUT_IMAGE -f $DOCKERFILE $WORK_DIR
rm -rf $WORK_DIR
