#!/bin/sh

docker compose logs -f | pnpm exec log-highlight
