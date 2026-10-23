import { WindowsReader } from '../src/reader.ts';
import { defaults } from '../src/config.ts';
if (process.platform !== 'win32') throw new Error('Windows only');
const reader = new WindowsReader(defaults());
reader.start(snapshot => console.log(JSON.stringify(snapshot)), message => console.error(message));
const finish = async () => { await reader.stop(); };
process.once('SIGINT', () => { void finish(); });
setTimeout(() => { void finish(); }, 10_000);
