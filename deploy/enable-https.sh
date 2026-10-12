#!/usr/bin/env bash
# HTTPS через Let's Encrypt. Запускать ТОЛЬКО после того, как DNS обоих
# доменов указывает на этот сервер (иначе certbot не пройдёт проверку).
#   WAITER_DOMAIN=... EMAIL=you@mail.ru bash /opt/restai/RestAI/deploy/enable-https.sh
set -euo pipefail
GUEST_DOMAIN="${GUEST_DOMAIN:-guest.restai.pro}"
WAITER_DOMAIN="${WAITER_DOMAIN:?Укажите WAITER_DOMAIN}"
EMAIL="${EMAIL:?Укажите EMAIL для уведомлений о сертификате}"

if ! command -v certbot >/dev/null; then
  sudo snap install core >/dev/null 2>&1 || true
  sudo snap install --classic certbot
  sudo ln -sf /snap/bin/certbot /usr/bin/certbot
fi
sudo certbot --nginx --non-interactive --agree-tos -m "$EMAIL" --redirect \
  -d "$GUEST_DOMAIN" -d "$WAITER_DOMAIN"
# Продление сертификатов certbot ставит сам (systemd-таймер snap.certbot.renew).
sudo certbot renew --dry-run
