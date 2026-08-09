#!/usr/bin/env bash
# Ночной бэкап self-hosted Supabase (Postgres в контейнере supabase-db).
#
# Запускать НА СЕРВЕРЕ Supabase (там, где docker с supabase-db), из-под root
# (в root-crontab docker доступен без sudo). Пример cron — раз в сутки в 04:00:
#   sudo crontab -e
#   0 4 * * * /home/user1/RestAI/ops/backup-supabase.sh >> /var/log/supabase-backup.log 2>&1
#
# ВАЖНО: бэкап на том же сервере, который может умереть, — это ещё не бэкап.
# Настрой копирование $BACKUP_DIR наружу (rclone в облако / scp на другой хост).
set -uo pipefail

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase-db}"
DB_USER="${SUPABASE_DB_USER:-supabase_admin}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-/root/supabase-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
DB_OUT="$BACKUP_DIR/db-$TS.sql.gz"
ROLES_OUT="$BACKUP_DIR/roles-$TS.sql.gz"

# Данные + схема одной БД. --clean --if-exists — чтобы восстановление на
# существующую БД проходило без ручной подготовки.
if docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists | gzip > "$DB_OUT" && [ -s "$DB_OUT" ]; then
  # Роли/пароли — кластерные глобалы, в pg_dump одной БД их нет; нужны для
  # полного восстановления (anon/authenticated/service_role и т.п.).
  docker exec "$CONTAINER" pg_dumpall -U "$DB_USER" --roles-only | gzip > "$ROLES_OUT" || true
  find "$BACKUP_DIR" -name 'db-*.sql.gz'    -mtime +"$KEEP_DAYS" -delete
  find "$BACKUP_DIR" -name 'roles-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
  echo "$(date '+%F %T') OK: $DB_OUT ($(du -h "$DB_OUT" | cut -f1))"
else
  echo "$(date '+%F %T') BACKUP FAILED: $DB_OUT" >&2
  rm -f "$DB_OUT"
  exit 1
fi
