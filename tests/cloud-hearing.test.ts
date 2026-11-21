import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { analyzeClip, buildHearingRequest, parseHearingAnswer } from '../src/cloud-hearing.ts';

test('外部听歌模型请求保持 OpenAI 兼容的音频消息形状', () => {
  const { url, body } = buildHearingRequest({
    base: 'https://example.com/v1/', model: 'qwen-omni-turbo', wavBase64: 'abc', seconds: 8,
  });
  assert.equal(url, 'https://example.com/v1/chat/completions');
  assert.equal(body.model, 'qwen-omni-turbo');
  assert.equal(body.stream, true);
  assert.deepEqual(body.modalities, ['text']);
  const messages = body.messages as any[];
  const content = messages[1].content as any[];
  assert.equal(content[0].type, 'input_audio');
  assert.equal(content[0].input_audio.data, 'data:audio/wav;base64,abc');
  assert.equal(content[0].input_audio.format, 'wav');
  assert.match(content[1].text, /8 秒/);
});

test('外部听歌模型回答支持代码块和多余解释，缺 summary 视为无效', () => {
  const answer = parseHearingAnswer(
    '```json\n{"summary":"钢琴与弦乐为主","instruments":["钢琴","弦乐"],"voices":["钢琴"],"speech":"","tonic":"C 大调","tempo":"慢"}\n```',
    'qwen-omni-turbo',
  );
  assert.deepEqual(answer, {
    summary: '钢琴与弦乐为主', instruments: ['钢琴', '弦乐'], voices: ['钢琴'], speech: '',
    tonic: 'C 大调', tempo: '慢', model: 'qwen-omni-turbo',
  });
  assert.equal(parseHearingAnswer('{"instruments":["钢琴"]}', 'x'), null);
  assert.equal(parseHearingAnswer('不是 JSON', 'x'), null);
});

test('外部听歌模型走通 SSE 增量并在非 2xx 时降级', async () => {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (req.url === '/bad/chat/completions') {
        res.statusCode = 401;
        res.end('bad key');
        return;
      }
      assert.match(body, /"input_audio"/);
      res.setHeader('content-type', 'text/event-stream');
      const parts = ['{"summary":"钢琴与', '弦乐为主","instruments":["钢琴"],"voices":["钢琴"],"speech":"","tonic":"","tempo":"慢"}'];
      for (const part of parts)
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const ok = await analyzeClip(new Uint8Array([1, 2, 3]), 8,
      { base: `http://127.0.0.1:${port}/v1`, model: 'm', key: 'k' });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.answer.summary, '钢琴与弦乐为主');
      assert.deepEqual(ok.answer.instruments, ['钢琴']);
      assert.equal(ok.answer.tempo, '慢');
    }
    const bad = await analyzeClip(new Uint8Array([1]), 8,
      { base: `http://127.0.0.1:${port}/bad`, model: 'm', key: 'k' });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.error, /401/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
