// node --test src/lib/dishImage.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dishThumb, dishPhoto, dishVideo } from './dishImage.js';

const OLD = 'https://utdfzrpkoscyikitceow.supabase.co/storage/v1/object/public/menu-images/thumbnails/r/borsch.webp';
const NEW = 'https://supabase.restai.pro/storage/v1/object/public/menu-images/r/dishes/1_ab_thumb.webp';
const PHOTO = 'https://api.syrovarnya.com/catalog/100011145.jpg';

test('миниатюра со старого Supabase не используется — берём само фото', () => {
  assert.equal(dishThumb({ image_url_thumbnail: OLD, image_url: PHOTO }), PHOTO);
  assert.equal(dishPhoto({ image_url_thumbnail: OLD, image_url: PHOTO }), PHOTO);
});

test('живая миниатюра остаётся миниатюрой', () => {
  assert.equal(dishThumb({ image_url_thumbnail: NEW, image_url: PHOTO }), NEW);
  assert.equal(dishPhoto({ image_url_thumbnail: NEW, image_url: PHOTO }), PHOTO);
});

test('нет ничего живого — null', () => {
  assert.equal(dishThumb({ image_url_thumbnail: OLD }), null);
  assert.equal(dishPhoto({ image_url_thumbnail: OLD }), null);
  assert.equal(dishThumb(null), null);
});

test('видео блюда: ссылка или путь от корня, остальное — null', () => {
  assert.equal(dishVideo({ video_url: '/dish-video/focaccia-burrata.mp4' }), '/dish-video/focaccia-burrata.mp4');
  assert.equal(dishVideo({ video_url: ' https://cdn.example.com/a.mp4 ' }), 'https://cdn.example.com/a.mp4');
  assert.equal(dishVideo({ video_url: '' }), null);
  assert.equal(dishVideo({ video_url: null }), null);
  assert.equal(dishVideo({}), null);
  assert.equal(dishVideo(null), null);
  assert.equal(dishVideo({ video_url: 'javascript:alert(1)' }), null);
  assert.equal(dishVideo({ video_url: '//evil.example/a.mp4' }), null);
});
