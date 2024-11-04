#!/bin/bash

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

cd $DIR/..
npm run gen-docs
rm -rf $DIR/../public/docs
docker run --rm --name slate -p 4567:4567 -v $DIR:/srv/slate/source -v $DIR/../public/docs:/srv/slate/build slatedocs/slate build
