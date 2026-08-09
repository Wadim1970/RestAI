# Ops: бэкапы и мониторинг

Страховка на случай сбоя сервера/сети. Два независимых скрипта.

## 1. Бэкап БД — `backup-supabase.sh`

Запускать **на сервере Supabase** (там же, где контейнер `supabase-db`; это
87.242.117.165), из-под **root** (в root-crontab `docker` работает без sudo).

```bash
# один раз — сделать исполняемым и проверить руками:
chmod +x /home/user1/RestAI/ops/backup-supabase.sh
/home/user1/RestAI/ops/backup-supabase.sh          # должно вывести "OK: ...db-....sql.gz"

# поставить в cron (раз в сутки в 04:00):
sudo crontab -e
# добавить строку:
0 4 * * * /home/user1/RestAI/ops/backup-supabase.sh >> /var/log/supabase-backup.log 2>&1
```

Кладёт `db-<дата>.sql.gz` (+ `roles-<дата>.sql.gz`) в `/root/supabase-backups`,
хранит 14 дней. Настройки — через переменные окружения (`BACKUP_DIR`,
`KEEP_DAYS`, …).

**Важно:** бэкап на том же сервере — не бэкап. Настрой копирование
`/root/supabase-backups` наружу (rclone в облако / `scp` на другой хост).

**Восстановление:**
```bash
gunzip -c /root/supabase-backups/db-YYYYMMDD-HHMMSS.sql.gz \
  | docker exec -i supabase-db psql -U supabase_admin -d postgres
```

## 2. Мониторинг — `uptime-check.sh`

Проверяет waiter-api, оба приложения и Supabase REST; шлёт в Telegram **только
при смене состояния** (упал/поднялся). Можно запускать на любом сервере с
интернетом.

```bash
chmod +x /home/user1/RestAI/ops/uptime-check.sh
# проверить (без Telegram просто печатает статусы):
/home/user1/RestAI/ops/uptime-check.sh

# cron каждые 3 минуты (подставь свои токен/чат):
*/3 * * * * TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy /home/user1/RestAI/ops/uptime-check.sh >> /var/log/uptime.log 2>&1
```

Telegram-бот: создать в `@BotFather` → написать боту → взять `chat.id` из
`https://api.telegram.org/bot<TOKEN>/getUpdates`.

### Альтернатива мониторингу — n8n (у тебя уже есть)

На казахстанском сервере крутится n8n — он умеет то же без скриптов:
**Schedule** (каждые N минут) → **HTTP Request** (на `/health` и сайты) → **IF**
(код не 2xx) → **Telegram/Email**. Удобнее поддерживать, если не хочется cron.
