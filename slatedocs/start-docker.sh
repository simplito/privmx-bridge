#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

docker run --rm --name slate -p 4567:4567 -v $DIR:/srv/slate/source slatedocs/slate serve
