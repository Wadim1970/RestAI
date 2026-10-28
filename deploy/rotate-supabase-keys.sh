#!/usr/bin/env bash
# Заменить секрет и ключи самохостящегося Supabase: JWT_SECRET, ANON_KEY,
# SERVICE_ROLE_KEY. Запускать на СЕРВЕРЕ БАЗЫ.
#
#   bash rotate-supabase-keys.sh            # только показать, что будет сделано
#   bash rotate-supabase-keys.sh --yes      # заменить
#   bash rotate-supabase-keys.sh --check    # после перезапуска: новые ключи работают, старые нет
#
# Зачем всё сразу. Ключи anon и service_role — это подписанные JWT. Подписывает
# их JWT_SECRET, поэтому старый service_role-ключ перестаёт действовать, только
# если сменить сам секрет, а значит, перевыпустить и anon, и service_role.
#
# Что делает --yes:
#   1. копию .env кладёт рядом (.env.bak-<дата>);
#   2. создаёт новый секрет и оба ключа (сроком на 10 лет);
#   3. записывает их в .env Supabase;
#   4. обновляет app.settings.jwt_secret в базе;
#   5. новые значения кладёт в файл $OUT (права 600) — оттуда их берут для
#      приложений и n8n. На экран значения НЕ печатаются.
# Перезапуск Supabase и обновление приложений — вручную, см. вывод в конце.
set -euo pipefail

ENV_FILE="${SUPABASE_ENV:-$HOME/supabase/docker/.env}"
OUT="${OUT:-$HOME/new-supabase-keys.env}"
URL="${SUPABASE_PUBLIC:-https://supabase.restai.pro}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
mode="${1:-}"

[ -f "$ENV_FILE" ] || { echo "Нет $ENV_FILE — укажите путь: SUPABASE_ENV=/путь/.env bash $0"; exit 1; }
val() { grep -E "^$1=" "$2" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r'; }

if [ "$mode" = "--check" ]; then
  NEWANON="$(val ANON_KEY "$OUT")"; NEWSVC="$(val SERVICE_ROLE_KEY "$OUT")"
  BAK="$(ls -1t "$ENV_FILE".bak-* 2>/dev/null | head -1)"
  [ -n "$NEWANON" ] && [ -n "$NEWSVC" ] || { echo "В $OUT нет новых ключей"; exit 1; }
  [ -n "$BAK" ] || { echo "Нет резервной копии $ENV_FILE.bak-*"; exit 1; }
  OLDSVC="$(val SERVICE_ROLE_KEY "$BAK")"; OLDANON="$(val ANON_KEY "$BAK")"
  # Вызов, который гостевое приложение и так делает анонимно: живой ключ даёт 200,
  # ключ со старой подписью — 401.
  code() { curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/rest/v1/rpc/is_table_session_active" \
    -H "apikey: $1" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    -d '{"p_session_id":"00000000-0000-0000-0000-000000000000"}'; }
  n1="$(code "$NEWANON")"; n2="$(code "$NEWSVC")"; o1="$(code "$OLDANON")"; o2="$(code "$OLDSVC")"
  echo "новый anon:          $n1  (ждём 200)"
  echo "новый service_role:  $n2  (ждём 200)"
  echo "СТАРЫЙ anon:         $o1  (ждём 401)"
  echo "СТАРЫЙ service_role: $o2  (ждём 401)"
  if [ "$n1" = 200 ] && [ "$n2" = 200 ] && [ "$o1" = 401 ] && [ "$o2" = 401 ]; then
    echo "ГОТОВО: старые ключи не работают, новые работают."
  else
    echo "ЧТО-ТО НЕ ТАК — пришлите эти четыре строки."; exit 1
  fi
  exit 0
fi

if [ "$mode" != "--yes" ]; then
  cat <<EOF
Будет заменено в $ENV_FILE: JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY.
Копия старого файла:  $ENV_FILE.bak-<дата>
Новые значения:       $OUT (права 600, на экран не печатаются)
Последствия: все старые ключи перестанут работать, все вошедшие в систему
(официанты, администраторы) выйдут и войдут заново, гостевые страницы на
телефонах надо открыть заново, приложения пересобираются с новым anon-ключом.
Выполнить:  bash $0 --yes
EOF
  exit 0
fi

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
SECRET="$(openssl rand -hex 32)"
mk() {  # роль -> JWT, подписанный новым секретом
  local header payload sig now exp
  header="$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)"
  now="$(date +%s)"; exp=$(( now + 315360000 ))
  payload="$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$1" "$now" "$exp" | b64url)"
  sig="$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$SECRET" -binary | b64url)"
  printf '%s.%s.%s' "$header" "$payload" "$sig"
}
ANON="$(mk anon)"; SERVICE="$(mk service_role)"

BAK="$ENV_FILE.bak-$(date +%F-%H%M%S)"
cp -p "$ENV_FILE" "$BAK"
set_kv() {  # заменить значение или добавить строку
  if grep -qE "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi
}
set_kv JWT_SECRET "$SECRET"
set_kv ANON_KEY "$ANON"
set_kv SERVICE_ROLE_KEY "$SERVICE"

umask 077
printf 'JWT_SECRET=%s\nANON_KEY=%s\nSERVICE_ROLE_KEY=%s\n' "$SECRET" "$ANON" "$SERVICE" > "$OUT"
chmod 600 "$OUT"

if [ -z "${SKIP_DB_SETTING:-}" ]; then
  printf "ALTER DATABASE postgres SET \"app.settings.jwt_secret\" TO '%s';\n" "$SECRET" \
    | sudo docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q
fi

cat <<EOF
Готово: ключи записаны в $ENV_FILE (старый файл: $BAK).
Новые значения для приложений: $OUT   (смотреть: cat $OUT — только у себя на экране, не в чат)

Дальше (по порядку, подробности в чате):
  1. cd $(dirname "$ENV_FILE") && sudo docker compose up -d --force-recreate
  2. bash $0 --check
  3. Подставить новые ключи в .env приложений и n8n, пересобрать (update.sh).
EOF
