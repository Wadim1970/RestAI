// Нагрузочный замер (вручную): N мостов в этом процессе, гости — в другом.
import http from 'node:http';
process.env.OPENAI_LIVE_SESSIONS_URL = 'http://127.0.0.1:8099/v1/live/sessions';
process.env.OPENAI_API_KEY = 'test';
const { openGptLiveWebrtcSession } = await import('../src/gptLiveWebrtc.js');
const bridges = [];
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const b = openGptLiveWebrtcSession({ instructions: 'x', tools: [], onEvent: () => {} });
  bridges.push(b);
  const sdp = await b.answerGuest(body);
  res.end(sdp);
}).listen(8098, '127.0.0.1');
let last = process.cpuUsage(); let lastT = Date.now();
setInterval(() => {
  const u = process.cpuUsage(last); const dt = (Date.now() - lastT) * 1000;
  last = process.cpuUsage(); lastT = Date.now();
  console.log(JSON.stringify({ bridges: bridges.length, cpuPct: Math.round((100 * (u.user + u.system)) / dt), rssMB: Math.round(process.memoryUsage().rss / 1e6) }));
}, 5000);
