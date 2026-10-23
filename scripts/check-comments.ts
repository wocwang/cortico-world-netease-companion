import { NeteaseComments } from '../src/comments.ts';
import type { Track } from '../src/state.ts';
const title = process.argv[2] || '当你 - 王心凌';
const track: Track = { title, artist: '', album: '', app: 'cloudmusic', status: 'unknown', method: 'window-title' };
const result = await new NeteaseComments().get(track);
// Diagnostics intentionally print only counts and provenance, not listeners' texts.
console.log(JSON.stringify({ status: result.status, reason: result.reason, song: result.song,
  match: result.match, url: result.url, excerpts: result.excerpts?.length }, null, 2));
if (result.status !== 'ok') process.exitCode = 1;
