// Локальный стенд для сквозной проверки голоса в браузере: поддельный GPT-Live
// (эхо по WebRTC) + настоящий voice-relay, у которого контекст ресторана
// (Supabase/меню) подменён заглушками. Запуск:
//   node --experimental-test-module-mocks test/e2eServer.mjs
// Переменные окружения relay (PORT, WEBRTC_*, ...) действуют как обычно.
import { mock } from 'node:test';
import { startFakeLive } from './fakeLive.mjs';

const live = await startFakeLive(8099);
process.env.OPENAI_LIVE_SESSIONS_URL = 'http://127.0.0.1:8099/v1/live/sessions';
process.env.OPENAI_API_KEY ||= 'test';
process.env.VOICE_PROVIDER ||= 'gptlive';

mock.module(new URL('../src/context.js', import.meta.url).href, {
  namedExports: {
    buildSessionContext: async () => ({ instructions: 'Ты Марко, тестовый официант.', voice: 'marin', hasHistory: false }),
    lookupDishDetails: async () => ({}),
    callWaiter: async () => ({ success: true }),
    findDishesForDisplay: async () => [],
    saveConversationTurn: async () => {},
    loadConversationHistory: async () => [],
    getDishModifierGroups: async () => [],
    resolveModifierSelections: async () => ({}),
  },
});

await import('../src/index.js');
setInterval(() => {
  const s = live.sessions.at(-1);
  if (s) console.log(JSON.stringify({ fakeLive: { sessions: live.sessions.length, echoed: s.echoed, events: s.events.map((e) => e.type) } }));
}, 2000).unref();
