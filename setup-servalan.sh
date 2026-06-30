#!/usr/bin/env bash
set -euo pipefail

# PareCare — Servalan quick-start script
# Run once after cloning: bash setup-servalan.sh

COMPOSE="docker compose -f docker-compose.servalan.yml"

echo "── PareCare / Servalan setup ──"

# 1. Env file
if [ ! -f .env ]; then
  cp .env.servalan .env
  echo "  ✓ Created .env from .env.servalan"
  echo "  ⚠  Edit .env and set DB_PASSWORD and JWT_SECRET before continuing."
  echo "     DB_PASSWORD: any strong password"
  echo "     JWT_SECRET:  $(openssl rand -hex 32)"
  exit 0
fi

# 2. Build + start
echo "  Building images..."
$COMPOSE build --quiet

echo "  Starting services..."
$COMPOSE up -d

# 3. Wait for DB
echo "  Waiting for database..."
sleep 5

# 4. Migrate
echo "  Running migrations..."
$COMPOSE exec api npm run migrate

# 5. Seed
echo "  Seeding checklist templates..."
$COMPOSE exec api npm run seed

echo ""
echo "  PareCare is running at http://servalan:${PORT:-3000}"
echo ""
echo "  Useful commands:"
echo "    Logs:     docker compose -f docker-compose.servalan.yml logs -f"
echo "    Stop:     docker compose -f docker-compose.servalan.yml down"
echo "    Restart:  docker compose -f docker-compose.servalan.yml restart"
