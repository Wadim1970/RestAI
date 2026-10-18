// Нагрузочный замер (вручную): поддельный GPT-Live + N «гостей» по 50 пакетов/с.
import { RTCPeerConnection, MediaStreamTrack, useOPUS, RtpPacket, RtpHeader } from 'werift';
import { startFakeLive } from './fakeLive.mjs';
await startFakeLive(8099);
const N = Number(process.argv[2] || 10);
for (let n = 0; n < N; n++) {
  const pc = new RTCPeerConnection({ codecs: { audio: [useOPUS()], video: [] }, iceServers: [], iceStunGatherTimeout: 0.1, bundlePolicy: 'max-bundle', iceUseIpv6: false });
  const mic = new MediaStreamTrack({ kind: 'audio' });
  pc.addTransceiver(mic, { direction: 'sendrecv' });
  await pc.setLocalDescription(await pc.createOffer());
  const res = await fetch('http://127.0.0.1:8098/', { method: 'POST', body: pc.localDescription.sdp });
  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
  let seq = 0;
  setInterval(() => mic.writeRtp(new RtpPacket(new RtpHeader({ payloadType: 111, sequenceNumber: seq & 0xffff, timestamp: (seq++ * 960) >>> 0, ssrc: 1000 + n }), Buffer.alloc(90, 7))), 20);
}
console.log('guests', N);
