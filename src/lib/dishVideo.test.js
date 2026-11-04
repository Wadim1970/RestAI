// node --test src/lib/dishVideo.test.js — когда показывать видео блюда.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoOf, canPlayVideo, canPrefetchVideo, neighborVideoUrls } from './dishVideo.js';

test('ссылка на видео: только http(s), пробелы срезаются', () => {
  assert.equal(videoOf({ video_url: ' https://x.example/a.mp4 ' }), 'https://x.example/a.mp4');
  assert.equal(videoOf({ video_url: 'http://x.example/a.mp4' }), 'http://x.example/a.mp4');
  assert.equal(videoOf({ video_url: 'javascript:alert(1)' }), null);
  assert.equal(videoOf({ video_url: '' }), null);
  assert.equal(videoOf({ video_url: null }), null);
  assert.equal(videoOf(null), null);
});

test('экономия трафика, 2G и отключённые анимации — видео не играем', () => {
  assert.equal(canPlayVideo({ connection: { saveData: true } }), false);
  assert.equal(canPlayVideo({ connection: { effectiveType: '2g' } }), false);
  assert.equal(canPlayVideo({ connection: { effectiveType: 'slow-2g' } }), false);
  assert.equal(canPlayVideo({ reducedMotion: true }), false);
});

test('обычная сеть и браузер без connection — играем', () => {
  assert.equal(canPlayVideo({}), true);
  assert.equal(canPlayVideo(), true);
  assert.equal(canPlayVideo({ connection: { effectiveType: '3g' } }), true);
  assert.equal(canPlayVideo({ connection: { effectiveType: '4g' } }), true);
});

test('предзагрузка соседних видео — только на быстрой сети', () => {
  assert.equal(canPrefetchVideo({ connection: { effectiveType: '4g' } }), true);
  assert.equal(canPrefetchVideo({}), true);
  assert.equal(canPrefetchVideo({ connection: { effectiveType: '3g' } }), false);
  assert.equal(canPrefetchVideo({ connection: { saveData: true, effectiveType: '4g' } }), false);
});

test('соседи открытого блюда с видео: следующее, затем предыдущее', () => {
  const list = [{ id: 'a', video_url: 'https://v/a.mp4' }, { id: 'b' }, { id: 'c', video_url: 'https://v/c.mp4' }, { id: 'd', video_url: 'https://v/d.mp4' }];
  assert.deepEqual(neighborVideoUrls(list, 'c'), ['https://v/d.mp4']);
  assert.deepEqual(neighborVideoUrls(list, 'b'), ['https://v/c.mp4', 'https://v/a.mp4']);
  assert.deepEqual(neighborVideoUrls(list, 'a'), []);
  assert.deepEqual(neighborVideoUrls(list, 'zzz'), []);
  assert.deepEqual(neighborVideoUrls(undefined, 'a'), []);
});
