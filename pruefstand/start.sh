#!/bin/bash
# Prüfstand hochfahren: echtes Postgres, Kickbase abgeklemmt.
set -e
export PATH=$PATH:/usr/lib/postgresql/16/bin
D=/var/lib/pgtest
PORT=${1:-3300}

pg_isready -h /tmp -p 5433 >/dev/null 2>&1 || \
  su postgres -s /bin/bash -c "PATH=\$PATH:/usr/lib/postgresql/16/bin pg_ctl -D $D -o '-p 5433 -k /tmp' -l $D/log start" >/dev/null
sleep 1

export DATABASE_URL="postgres://postgres@localhost:5433/postgres"
export NODE_OPTIONS="--require $(pwd)/pruefstand/kickbase-attrappe.cjs"

# Schema anlegen lassen und Daten säen
curl -s --noproxy '*' -o /dev/null "http://localhost:$PORT/" 2>/dev/null || true
echo "Prüfstand: Postgres auf 5433, Server auf $PORT"
