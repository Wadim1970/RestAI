#!/usr/bin/env bash
# TURN-сервер (coturn) для голоса по WebRTC — на том же сервере, что voice-relay.
#
# Зачем: часть мобильных сетей режет UDP к зарубежным адресам, и прямое
# WebRTC-соединение телефона с relay не поднимается. Тогда телефон идёт через
# TURN по TCP/TLS (порты 3478 и 5349), а не падает на запасной WebSocket.
#
# Что делает (повторный запуск безопасен):
#   1. ставит coturn;
#   2. генерирует общий секрет и дописывает TURN_SECRET / TURN_URLS в .env
#      relay (если их там ещё нет) — секрет в консоль не печатается;
#   3. пишет /etc/turnserver.conf (TLS — сертификатом voice.restai.space из
#      Let's Encrypt, если он есть) и хук certbot для обновления сертификата;
#   4. запускает coturn и перезапускает voice-relay в pm2.
#
# Запуск: bash /root/restai-voice-relay/voice-relay/deploy/setup-turn.sh
set -euo pipefail

DOMAIN="${TURN_DOMAIN:-voice.restai.space}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HERE/../.env"
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
COTURN_CERTS="/etc/coturn/certs"

[ -f "$ENV_FILE" ] || { echo "Нет $ENV_FILE — сначала настройте voice-relay"; exit 1; }

echo "==> coturn"
if ! command -v turnserver >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq coturn
fi

echo "==> секрет TURN в .env"
if ! grep -q '^TURN_SECRET=.\+' "$ENV_FILE"; then
  sed -i '/^TURN_SECRET=/d' "$ENV_FILE"
  echo "TURN_SECRET=$(openssl rand -hex 32)" >> "$ENV_FILE"
fi
SECRET="$(grep '^TURN_SECRET=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"

TLS_LINES=""
URLS="turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp"
if [ -f "$CERT_DIR/fullchain.pem" ]; then
  # coturn работает не от root и не читает ключи Let's Encrypt напрямую —
  # держим копию, которую хук certbot обновляет при продлении.
  mkdir -p "$COTURN_CERTS" /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/coturn.sh <<HOOK
#!/bin/sh
install -m 644 "$CERT_DIR/fullchain.pem" "$COTURN_CERTS/fullchain.pem"
install -m 640 -g turnserver "$CERT_DIR/privkey.pem" "$COTURN_CERTS/privkey.pem"
systemctl restart coturn 2>/dev/null || true
HOOK
  chmod +x /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
  install -m 644 "$CERT_DIR/fullchain.pem" "$COTURN_CERTS/fullchain.pem"
  install -m 640 -g turnserver "$CERT_DIR/privkey.pem" "$COTURN_CERTS/privkey.pem"
  TLS_LINES="tls-listening-port=5349
cert=$COTURN_CERTS/fullchain.pem
pkey=$COTURN_CERTS/privkey.pem
no-tlsv1
no-tlsv1_1"
  URLS="$URLS,turns:$DOMAIN:5349?transport=tcp"
else
  echo "   (сертификата $CERT_DIR нет — TURN без TLS, только порт 3478)"
  TLS_LINES="no-tls
no-dtls"
fi

if grep -q '^TURN_URLS=' "$ENV_FILE"; then
  sed -i "s#^TURN_URLS=.*#TURN_URLS=$URLS#" "$ENV_FILE"
else
  echo "TURN_URLS=$URLS" >> "$ENV_FILE"
fi

echo "==> /etc/turnserver.conf"
cat > /etc/turnserver.conf <<CONF
# RestAI: TURN для голоса (voice-relay). Сгенерировано deploy/setup-turn.sh.
listening-port=3478
$TLS_LINES
realm=$DOMAIN
server-name=$DOMAIN
fingerprint
use-auth-secret
static-auth-secret=$SECRET
# Порты, через которые TURN пересылает звук (откройте UDP в файрволе).
min-port=49160
max-port=49260
total-quota=100
stale-nonce=600
no-cli
no-multicast-peers
no-software-attribute
# Ходить через TURN можно только к публичным адресам (не во внутреннюю сеть).
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
CONF
chmod 640 /etc/turnserver.conf
chgrp turnserver /etc/turnserver.conf 2>/dev/null || true

[ -f /etc/default/coturn ] && sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn
sleep 1
systemctl is-active --quiet coturn && echo "   coturn работает" || { echo "   coturn не запустился: journalctl -u coturn -n 30"; exit 1; }

echo "==> перезапуск voice-relay"
pm2 restart voice-relay --update-env >/dev/null && echo "   готово"

echo
echo "Откройте входящие порты в файрволе хостинга (если он есть):"
echo "  UDP 40000-40199   — звук гостей (WebRTC relay)"
echo "  UDP+TCP 3478      — TURN"
[ -n "${TLS_LINES##no-tls*}" ] && echo "  TCP 5349          — TURN через TLS"
echo "  UDP 49160-49260   — TURN, пересылка звука"
