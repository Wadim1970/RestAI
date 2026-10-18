// Мост WebRTC без браузера: «гость» на werift шлёт RTP → relay → поддельный
// GPT-Live (эхо) → relay → «гость» получает свои пакеты обратно.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RTCPeerConnection, MediaStreamTrack, useOPUS, RtpPacket, RtpHeader } from 'werift';
import { startFakeLive } from './fakeLive.mjs';

process.env.OPENAI_LIVE_SESSIONS_URL = 'http://127.0.0.1:8099/v1/live/sessions';
process.env.OPENAI_API_KEY = 'test';
const { openGptLiveWebrtcSession } = await import('../src/gptLiveWebrtc.js');

test('звук гостя доходит до GPT-Live и возвращается, события идут', async () => {
  const { sessions, stop } = await startFakeLive(8099);
  const events = [];
  const bridge = openGptLiveWebrtcSession({
    instructions: 'тест', voice: 'marin', tools: [], hasHistory: false, deferGreeting: true,
    onEvent: (e) => events.push(e),
  });

  const guest = new RTCPeerConnection({ codecs: { audio: [useOPUS()], video: [] }, iceServers: [], iceStunGatherTimeout: 0.2, bundlePolicy: 'max-bundle', iceUseIpv6: false });
  const mic = new MediaStreamTrack({ kind: 'audio' });
  guest.addTransceiver(mic, { direction: 'sendrecv' });
  let received = 0;
  guest.onTrack.subscribe((t) => t.onReceiveRtp.subscribe(() => { received += 1; }));
  await guest.setLocalDescription(await guest.createOffer());
  await new Promise((r) => (guest.iceGatheringState === 'complete' ? r() : guest.iceGatheringStateChange.subscribe((s) => s === 'complete' && r())));
  const answer = await bridge.answerGuest(guest.localDescription.sdp);
  await guest.setRemoteDescription({ type: 'answer', sdp: answer });

  await new Promise((r) => guest.connectionStateChange.subscribe((s) => s === 'connected' && r()));
  await new Promise((r) => setTimeout(r, 1500)); // нога к OpenAI поднимается
  // Сессия GPT-Live поднята заранее (под заставкой), но здороваться рано.
  assert.ok(events.some((e) => e.type === 'session.started'), 'session.started (100+ КБ) дошёл');
  assert.ok(!sessions[0].events.some((e) => e.type === 'response.create'), 'до сигнала не здороваемся');
  bridge.startGreeting();
  for (let i = 0; i < 100; i++) {
    const payload = Buffer.alloc(80, i);
    mic.writeRtp(new RtpPacket(new RtpHeader({ payloadType: 111, sequenceNumber: i, timestamp: i * 960, ssrc: 1234, marker: false }), payload));
    await new Promise((r) => setTimeout(r, 20));
  }
  await new Promise((r) => setTimeout(r, 800));

  const flow = bridge.takeFlowStats();
  const guestPackets = flow.guest.packets;
  const aiPackets = flow.ai.packets;
  assert.ok(guestPackets >= 90, `relay получил от гостя ${guestPackets}`);
  assert.ok(sessions[0]?.echoed >= 90, `GPT-Live получил ${sessions[0]?.echoed}`);
  assert.ok(aiPackets >= 90, `relay получил от GPT-Live ${aiPackets}`);
  assert.ok(received >= 90, `гость получил обратно ${received}`);
  assert.ok(events.some((e) => e.type === 'response.transcript'), 'транскрипт ИИ дошёл');
  assert.equal(sessions[0].session.model, 'gpt-live-1');
  assert.equal(sessions[0].session.audio.format, undefined);
  // На session.started — подталкивание приветствия по каналу.
  assert.ok(sessions[0].events.some((e) => e.type === 'response.create'), 'приветствие подтолкнули');

  bridge.close();
  await guest.close();
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(sessions[0].events.some((e) => e.type === 'session.close'), 'сессию закрыли');
  await stop();
});
