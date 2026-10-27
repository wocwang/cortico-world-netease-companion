import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { actionVocabText, readActionVocab } from '../src/action-vocab.ts';

const PET_WEB = join('resources', 'app', 'node_modules', 'cortico-world-desktop-pet', 'web');

test('读取当前形象词表，过滤睡觉/打盹并输出中文名', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'action-vocab-'));
  try {
    await mkdir(join(dir, 'data', 'home', 'companion'), { recursive: true });
    await writeFile(join(dir, 'data', 'home', 'companion', 'config.json'), JSON.stringify({
      worlds: { 'desktop-pet': { skin: { figure: 'whale' } } },
    }));
    await mkdir(join(dir, PET_WEB, 'whale'), { recursive: true });
    await writeFile(join(dir, PET_WEB, 'whale', 'figure.json'), JSON.stringify({
      vocab: [
        { id: 'neutral', kind: 'expression', names: { zh: ['平静'] } },
        { id: 'sleepy', kind: 'expression', names: { zh: ['犯困'] } },
        { id: 'nod', kind: 'motion', names: { zh: ['点头'] } },
        { id: 'sleep', kind: 'motion', names: { zh: ['睡觉'] } },
      ],
    }));
    const vocab = readActionVocab(dir);
    assert.deepEqual(vocab, { figure: 'whale', expressions: ['平静'], motions: ['点头'] });
    assert.match(actionVocabText(vocab), /表情：平静/);
    assert.match(actionVocabText(vocab), /动作：点头/);
    assert.match(actionVocabText(null), /只发言/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('词表缺失时返回 null，不猜测动作', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'action-vocab-empty-'));
  try {
    assert.equal(readActionVocab(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
