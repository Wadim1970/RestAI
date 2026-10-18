# voice-relay

Сервис-ретранслятор для голосового ИИ-помощника гостя (OpenAI GPT-Live по
WebRTC; запасные варианты — OpenAI Realtime API или xAI Grok Voice Agent, см.
«Провайдеры» ниже). Держит настоящие
API-ключи — гость никогда не подключается к провайдеру напрямую.

## Почему отдельный сервис, а не часть waiter-api

`waiter-api` стоит на VPS в Cloud.ru (Россия) — OpenAI блокирует запросы
с российских IP на уровне своей инфраструктуры, и это касается не только
сайта ChatGPT, но и API в целом. `voice-relay` поэтому должен физически
стоять на сервере в Казахстане (там же, где сейчас n8n) — тогда исходящее
соединение к OpenAI идёт с казахстанского IP.

Гость (в России, в ресторане) подключается к этому сервису (WebSocket +
WebRTC) — это обычный трафик к нашему серверу, тут никаких ограничений нет —
и уже этот сервис от своего имени открывает соединение к OpenAI.

## Архитектура

Основной путь (`VOICE_PROVIDER=gptlive`) — WebRTC на обоих участках:

```
Гость (браузер) ⇄ WebRTC ⇄ voice-relay (Казахстан) ⇄ WebRTC ⇄ OpenAI GPT-Live
        └──── WebSocket /voice: сигнализация (SDP), события экрана ────┘
```

- Звук — живой поток Opus. Relay его не декодирует и не копит: RTP-пакеты
  пересылаются между двумя соединениями как есть (`src/gptLiveWebrtc.js`,
  библиотека [werift](https://github.com/shinyoshiaki/werift-webrtc)).
- GPT-Live отдаёт голос в реальном времени и сам замолкает, когда гость его
  перебивает — у гостя голос стихает сразу. Эхо из динамика гасит браузер
  (звонковый режим WebRTC).
- OpenAI видит только казахстанский IP: сессию создаёт relay
  (`POST /v1/live/sessions` с SDP), он же — второй конец WebRTC.
- События сессии (транскрипты, вызовы наших инструментов: показать блюда,
  корзина, официант) идут по data channel `oai-events` и обрабатываются в
  `src/gptLiveEvents.js` — общем коде с WebSocket-вариантом.
- По тому же WebSocket `/voice` гость получает команды экрана (`show_dish`,
  `cart_add`, …) и обменивается SDP с relay (`transport` → `webrtc_offer` →
  `webrtc_answer`).

Запасной путь — WebSocket (как раньше: PCM-куски в JSON). Телефон уходит на
него сам, если WebRTC не поднялся за 6 с (нет поддержки, сеть режет UDP и
нет TURN), а также при `WEBRTC_ENABLED=0` или `VOICE_PROVIDER=openai|grok`.

При открытии соединения сервис:

1. Забирает меню ресторана через публичный `GET /api/menu`.
2. Забирает профиль гостя (`guests.preferences`, `guest_restaurant_stats`)
   анонимным ключом Supabase.
3. Собирает системный промпт и открывает голосовую сессию у провайдера.
4. Дальше пересылает звук и выполняет инструменты ИИ.

### Нагрузка

Замер (`test/loadRelay.mjs` + `test/loadGuests.mjs`, Xeon 2.1 ГГц): 20
одновременных WebRTC-разговоров — ~37% одного ядра и ~5 МБ памяти на
разговор. На сервере с 1 vCPU / 2 ГБ рядом с n8n — ориентир 25–30
разговоров; предохранитель — `MAX_CONCURRENT_SESSIONS`.

### Логи для диагностики

`pm2 logs voice-relay --lines 300 --nostream | grep -E "задержка ответа|поток звука|звук на телефоне|WebRTC|гость сказал|инструмент"`

- `задержка ответа` — от «гость договорил» / последнего громкого звука
  микрофона до первого звука ИИ;
- `звук на телефоне` — по WebRTC: потери (`lossPct`), джиттер, «додуманные»
  браузером куски (`concealedPct`), путь (`path`: `host/udp` — напрямую,
  `relay/…` — через TURN); `webrtcFallback` — телефон ушёл на WebSocket и
  почему;
- `WebRTC с гостем` — состояние соединения с телефоном.

## Провайдеры

`VOICE_PROVIDER` в `.env` (`gptlive` | `openai` | `grok`) выбирает, куда
сервис открывает вторую ногу — переключение общее для всего сервиса
(перезапуск pm2), без деления по сессиям. Grok Voice Agent совместим по
протоколу с OpenAI Realtime API (см. `src/realtimeProvider.js`), ключ и
баланс — в [console.x.ai](https://console.x.ai), голос задаётся строкой
(`eve`/`ara`/`rex`/`sal`/`leo`) в `GROK_VOICE` или в профиле ресторана
(`character_profile.voice.grok_voice`).

## Эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/health` | Проверка живости |
| `WS` | `/voice?guestId=&restaurantId=` | Голосовая сессия гостя |

## Локальный запуск

```bash
cd voice-relay
cp .env.example .env   # заполнить значениями
npm install
npm run dev
```

Без `OPENAI_API_KEY` сервис всё равно поднимется и ответит на `/health` —
соединение с OpenAI открывается лениво, при первом подключении гостя, и
просто упадёт в лог, если ключа нет или он неверный.

## Деплой на сервер (Казахстан)

Код — `/root/restai-voice-relay` (клон репозитория), сервис —
`/root/restai-voice-relay/voice-relay`, процесс pm2 `voice-relay`, наружу —
nginx с TLS на `voice.restai.space`.

Обновление:

```bash
git -C /root/restai-voice-relay pull
cd /root/restai-voice-relay/voice-relay && npm ci --omit=dev
pm2 restart voice-relay --update-env
```

TURN (один раз): `bash /root/restai-voice-relay/voice-relay/deploy/setup-turn.sh`.

Входящие порты (в файрволе хостинга, если он есть; `ufw` на сервере выключен):

| Порт | Протокол | Зачем |
|---|---|---|
| 443 | TCP | WebSocket `/voice` (nginx) |
| 40000–40199 | UDP | звук WebRTC (relay) |
| 3478 | UDP+TCP | TURN |
| 5349 | TCP | TURN через TLS |
| 49160–49260 | UDP | TURN, пересылка звука |

Проверки: `curl -s http://127.0.0.1:8081/status` → `"webrtc":true`;
`npm test` — мост WebRTC с поддельным GPT-Live; для ручной проверки в
браузере — `node --experimental-test-module-mocks test/e2eServer.mjs`
(relay с заглушками контекста + поддельный GPT-Live с эхом).
