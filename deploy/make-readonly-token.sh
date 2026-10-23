#!/usr/bin/env bash
# Ключ «только чтение» к базе для разработчика (Claude). Запускать на
# СЕРВЕРЕ БАЗЫ, после миграции 20261024010000_claude_readonly.sql:
#
#   bash make-readonly-token.sh                      # ключ на 180 дней
#   DAYS=30 bash make-readonly-token.sh              # другой срок
#
# Ключ — JWT с ролью claude_reader, подписанный JWT_SECRET самой базы
# (берётся из .env Supabase, наружу не выводится). Печатает ключ на экран:
# его вставляют в настройки окружения Claude, НЕ в чат. Закрыть доступ
# досрочно — откатить миграцию (роль исчезнет, ключ перестанет работать).
set -euo pipefail

ENV_FILE="${SUPABASE_ENV:-$HOME/supabase/docker/.env}"
DAYS="${DAYS:-180}"
URL="${SUPABASE_PUBLIC:-https://supabase.restai.pro}"

[ -f "$ENV_FILE" ] || { echo "Нет $ENV_FILE — укажите путь: SUPABASE_ENV=/путь/.env bash $0"; exit 1; }
val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r'; }
SECRET="$(val JWT_SECRET)"
ANON="$(val ANON_KEY)"
[ -n "$SECRET" ] || { echo "В $ENV_FILE нет JWT_SECRET"; exit 1; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
now=$(date +%s)
exp=$((now + DAYS * 86400))
header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
payload=$(printf '{"role":"claude_reader","iss":"supabase","iat":%s,"exp":%s}' "$now" "$exp" | b64url)
sig=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$SECRET" -binary | b64url)
TOKEN="$header.$payload.$sig"

echo "Проверка ключа…"
code=$(curl -s -o /tmp/claude_schema_check.json -w '%{http_code}' -X POST "$URL/rest/v1/rpc/claude_schema" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' || true)
if [ "$code" != 200 ]; then
  echo "Не работает (HTTP $code): $(head -c 300 /tmp/claude_schema_check.json 2>/dev/null)"
  echo "Применена ли миграция 20261024010000_claude_readonly.sql? Если да — перезапустите PostgREST:"
  echo "  sudo docker restart supabase-rest"
  rm -f /tmp/claude_schema_check.json
  exit 1
fi
tables=$(grep -o '"table"' /tmp/claude_schema_check.json | wc -l)
rm -f /tmp/claude_schema_check.json
write=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/rest/v1/restaurants" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' || true)
echo "  чтение устройства базы: работает (объектов с таблицами: $tables)"
echo "  попытка записи: HTTP $write (ожидается 401/403 — записи нет)"
echo
echo "Ключ (действует $DAYS дней, до $(date -d "@$exp" '+%d.%m.%Y')):"
echo
echo "$TOKEN"
echo
echo "Вставьте его в настройки окружения Claude как переменную RESTAI_DB_READONLY_TOKEN."
echo "В чат ключ не присылайте."
