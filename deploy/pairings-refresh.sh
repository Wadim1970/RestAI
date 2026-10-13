#!/usr/bin/env bash
# Пересчёт пар блюд («к пицце отлично подходит салат…») по всем ресторанам.
# Сервер официанта сам пропускает рестораны, у которых меню не менялось,
# так что запускать можно хоть каждый час — нейросеть зовётся только по делу.
#
#   bash /opt/restai/RestAI/deploy/pairings-refresh.sh            # все рестораны
#   bash /opt/restai/RestAI/deploy/pairings-refresh.sh <id> force # один ресторан, заново
#
# Ставится в cron (deploy/README.md, «Пары блюд»). Токен — PAIRINGS_ADMIN_TOKEN
# из /opt/restai/Waiter-app/.env.production.
set -euo pipefail
ENV_FILE="${ENV_FILE:-/opt/restai/Waiter-app/.env.production}"
TOKEN="$(grep -E '^PAIRINGS_ADMIN_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
[ -n "$TOKEN" ] || { echo "Нет PAIRINGS_ADMIN_TOKEN в $ENV_FILE"; exit 1; }

RID="${1:-}"
FORCE=false; [ "${2:-}" = force ] && FORCE=true
if [ -n "$RID" ]; then BODY="{\"restaurantId\":\"$RID\",\"force\":$FORCE}"; else BODY="{\"force\":$FORCE}"; fi

echo "$(date '+%F %T') старт пересчёта: ${RID:-все рестораны}"
curl -fsS -X POST http://127.0.0.1:3002/api/pairings/generate \
  -H 'Content-Type: application/json' -H "X-Admin-Token: $TOKEN" -d "$BODY"
echo
echo "Расчёт идёт в фоне 1–3 минуты. Итог: pm2 logs restai-waiter-api --lines 20 --nostream | grep pairings"
