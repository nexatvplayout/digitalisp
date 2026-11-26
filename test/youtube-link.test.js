// O link do YouTube como canal ao vivo (public/shared/youtube.js): os formatos que as pessoas copiam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ehYoutube, youtubeDe, youtubeUrl, youtubeQuery } from '../public/shared/youtube.js';

test('youtube: vídeo, live, canal e @nome', () => {
  assert.deepEqual(youtubeDe('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=3'), { v: 'aqz-KE-bpKQ' });
  assert.deepEqual(youtubeDe('https://youtu.be/aqz-KE-bpKQ?si=x'), { v: 'aqz-KE-bpKQ' });
  assert.deepEqual(youtubeDe('https://youtube.com/live/aqz-KE-bpKQ?feature=share'), { v: 'aqz-KE-bpKQ' });
  assert.deepEqual(youtubeDe('https://m.youtube.com/embed/aqz-KE-bpKQ'), { v: 'aqz-KE-bpKQ' });
  assert.deepEqual(youtubeDe('https://www.youtube.com/channel/UCSMOQeBJ2RAnuFungnQOxLg/live'), { c: 'UCSMOQeBJ2RAnuFungnQOxLg' });
  assert.deepEqual(youtubeDe('https://www.youtube.com/@BlenderOfficial/streams'), { handle: '@BlenderOfficial' });
  assert.deepEqual(youtubeDe('youtu.be/aqz-KE-bpKQ'), { v: 'aqz-KE-bpKQ' }); // colado sem https://
  assert.equal(youtubeDe('https://www.youtube.com/xyz'), null);
  assert.equal(youtubeDe('https://exemplo.com/live.m3u8'), null);
  assert.equal(ehYoutube('https://youtu.be/aqz-KE-bpKQ'), true);
  assert.equal(ehYoutube('https://exemplo.com/a.m3u8'), false);
  assert.equal(youtubeUrl({ v: 'aqz-KE-bpKQ' }), 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  assert.equal(youtubeQuery({ c: 'UCSMOQeBJ2RAnuFungnQOxLg' }), 'c=UCSMOQeBJ2RAnuFungnQOxLg');
});
