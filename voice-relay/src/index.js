import 'dotenv/config'; // загружает voice-relay/.env в process.env (должно быть первым)
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { voiceRoutes } from './voiceSession.js';

const app = Fastify({ logger: true });

if (config.corsOrigin.length > 0) {
  await app.register(cors, { origin: config.corsOrigin });
} else {
  app.log.warn('⚠️  CORS_ORIGIN не задан — разрешены любые источники. Не для прода!');
  await app.register(cors, { origin: true });
}

await app.register(websocket);

app.get('/health', async () => ({ ok: true }));

await app.register(voiceRoutes);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
