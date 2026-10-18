// Поддельный GPT-Live для локальных проверок WebRTC-моста: принимает
// POST /v1/live/sessions (session + transport.webrtc.sdp), отвечает своим SDP,
// возвращает звук гостя обратно (эхо) и шлёт по "oai-events" session.started
// и пару событий-транскриптов. Запуск: node test/fakeLive.mjs [порт]
import http from 'node:http';
import { RTCPeerConnection, MediaStreamTrack, useOPUS } from 'werift';

export function startFakeLive(port = 8099) {
  const sessions = [];
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(404).end(); return; }
    let body = '';
    for await (const c of req) body += c;
    const { session, transport } = JSON.parse(body);
    const pc = new RTCPeerConnection({ codecs: { audio: [useOPUS()], video: [] }, iceServers: [], iceStunGatherTimeout: 0.2, bundlePolicy: 'max-bundle', iceUseIpv6: false });
    const out = new MediaStreamTrack({ kind: 'audio' });
    const info = { session, events: [], echoed: 0, pc };
    sessions.push(info);
    pc.onTrack.subscribe((track) => track.onReceiveRtp.subscribe((rtp) => { info.echoed += 1; out.writeRtp(rtp); }));
    pc.onDataChannel.subscribe((dc) => {
      dc.onMessage.subscribe((m) => info.events.push(JSON.parse(m.toString())));
      const hello = () => {
        // Как у настоящего GPT-Live: session.started несёт весь конфиг
        // (инструкции с меню) — больше стандартных 64 КБ канала.
        dc.send(JSON.stringify({ type: 'session.started', session: { ...session, pad: 'м'.repeat(50000) } }));
        dc.send(JSON.stringify({ type: 'session.output_transcript.delta', delta: 'Привет! Я Марко.' }));
        dc.send(JSON.stringify({ type: 'session.output_transcript.done' }));
      };
      if (dc.readyState === 'open') hello(); else dc.stateChanged.subscribe((s) => s === 'open' && hello());
    });
    await pc.setRemoteDescription({ type: 'offer', sdp: transport.sdp });
    const tr = pc.getTransceivers().find((t) => t.kind === 'audio');
    await tr.sender.replaceTrack(out);
    tr.setDirection('sendrecv');
    await pc.setLocalDescription(await pc.createAnswer());
    await new Promise((r) => (pc.iceGatheringState === 'complete' ? r() : pc.iceGatheringStateChange.subscribe((s) => s === 'complete' && r())));
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ session: { id: `live_fake_${sessions.length}` }, transport: { type: 'webrtc', sdp: pc.localDescription.sdp } }));
  });
  const stop = async () => {
    await Promise.all(sessions.map((s) => s.pc.close().catch(() => {})));
    server.close();
  };
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, sessions, stop })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 8099);
  await startFakeLive(port);
  console.log(`fake GPT-Live on http://127.0.0.1:${port}/v1/live/sessions`);
}
