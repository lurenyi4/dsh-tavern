// Synthetic fixtures, containing no third-party card content or executable code.
import { deflateRawSync, deflateSync } from 'node:zlib';

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export const v1 = { name: '渡口向导', description: '渡口有一位向导。', personality: '谨慎', scenario: '初次到访', first_mes: '请选择一条路。', mes_example: '仅为例句', tags: ['synthetic'], mysterious: { value: '保留未知字段' } };
export const v2 = { spec: 'chara_card_v2', spec_version: '2.0', wrapper_unknown: 17, data: { ...v1, alternate_greetings: ['晚间渡口', '', '晚间渡口'], creator: 'Synthetic fixture', system_prompt: '保持角色', post_history_instructions: '慢慢推进', character_book: { entries: [{ id: 7, keys: ['渡口'], content: '渡口夜间关闭。', enabled: true, constant: false, unknown_flag: 99 }] }, extensions: { future_extension: { a: [1, true, null] }, variables: { courage: 1 }, regex_scripts: [{ name: '保留不执行', findRegex: 'sample', replaceString: 'sample' }], story_runtime: { variables: { trust: 0 }, actions: [{ id: 'wave', label: '打招呼', narrative: '你挥手致意。', operations: [{ op: 'set_variable', key: 'trust', value: 1 }] }] } } } };
export const v3 = { ...v2, spec: 'chara_card_v3', spec_version: '3.0', data: { ...v2.data, assets: [{ type: 'icon', uri: 'embeded://assets/icon/face.png', name: '头像', ext: 'png' }, { type: 'background', uri: 'embeded://assets/background/missing.png', name: '未附带背景', ext: 'png' }, { type: 'other', uri: 'https://example.invalid/resource.png', name: '远端资源', ext: 'png' }] } };
export function chunk(type, bytes) {
  const data = Buffer.from(bytes), tag = Buffer.from(type), head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length); tail.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([head, tag, data, tail]);
}
export function png(metadata = [], { badCrc = false, width = 1, height = 1 } = {}) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const text = metadata.map(([key, value, kind = 'tEXt']) => {
    const b64 = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');
    if (kind === 'zTXt') return chunk(kind, Buffer.concat([Buffer.from(key + '\0\0'), deflateSync(b64)]));
    if (kind === 'iTXt') return chunk(kind, Buffer.from(key + '\0\0\0\0\0' + b64));
    return chunk(kind, Buffer.from(key + '\0' + b64));
  });
  const data = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...text, chunk('IDAT', deflateSync(Buffer.from([0, 80, 120, 180, 255]))), chunk('IEND', Buffer.alloc(0))]);
  if (badCrc) data[data.length - 1] ^= 1;
  return data;
}
// Minimal standard ZIP encoder allows defensive tests to alter format fields.
export function zip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), input = Buffer.from(entry.bytes ?? ''), method = entry.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(input) : input;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(entry.flags ?? 0x800, 6); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc32(input), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(entry.size ?? input.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); local.copy(central, 6, 4, 30); central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed); centrals.push(central, name); offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
export function charx(extra = []) {
  return zip([{ name: 'card.json', bytes: JSON.stringify(v3) }, { name: 'assets/icon/face.png', bytes: png() }, { name: 'assets/other/copy.png', bytes: png() }, { name: 'module.risum', bytes: Buffer.from([111, 0, 3, 0, 0, 0, 0xab, 0xcd, 0xef, 0]) }, { name: 'assets/other/layout.html', bytes: '<p>Static fixture only</p>' }, { name: 'assets/other/icon.svg', bytes: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }, { name: 'future-extension.txt', bytes: 'exact unknown bytes\n' }, ...extra]);
}

// Frozen upstream encode table independently generates synthetic legacy modules.
// RisuAI 9f3b589b6e74230401a431a00fd977986d212870, RPack AGPL-3.0.
const encodeMap = Buffer.from('c40d1e0bbd2b3f55fc456ef566534f1ae0bb309486ba6bbf41506f9befdeb710611720df3289a89d6dabc990000c5dafd2c156e516649182657497ca23d652d1ffb4a0e82f8a58385a60199649dbd7c83b3e434ba56347aa6a2992f415cf623478d31d3ce2058e2a570e1bcd4c2df2402c2579480fb27ab5a76c37e69c7b547efe87dc9a02e433a2ebb12e03dd99a6b0e7d58818837cf6bee15c9fc321461f084ed076125feefd8f44eaa35e8b2809359e69cc0ac78507ad4af377e967d4da848093b64d73fa27267f04c6fbf1723951c236a968acf8edc5b9cbce75a43d81d942701c9511bcd88c98f959a113f7147db3ec71c0e38df001ae5b310624223ab8', 'hex');
export function risum(module, assets = []) {
  const encode = bytes => Buffer.from([...bytes].map(byte => encodeMap[byte]));
  const json = encode(Buffer.from(JSON.stringify({ type: 'risuModule', module })));
  const header = Buffer.alloc(6); header[0] = 111; header[1] = 0; header.writeUInt32LE(json.length, 2);
  const parts = [header, json];
  for (const bytes of assets) { const assetHeader = Buffer.alloc(5); assetHeader[0] = 1; assetHeader.writeUInt32LE(bytes.length, 1); parts.push(assetHeader, encode(bytes)); }
  return Buffer.concat([...parts, Buffer.from([0])]);
}
export function mappedCharx() {
  const module = { name: '测试模块', description: '仅合成数据', id: 'synthetic-module', lorebook: [{ key: '渡口,向导', secondkey: '夜间', content: '模块版本：夜间需要灯笼。', alwaysActive: true, selective: false, insertorder: 8, comment: '夜间通行' }], trigger: [{ type: 'lua', comment: '不执行的合成占位数据' }], regex: [{ type: 'editdisplay', in: 'sample', out: 'sample' }], cjs: '/* synthetic inert text, never evaluated */', assets: [['lamp', '', 'png']], unknownModuleValue: { keep: 42 } };
  return zip([{ name: 'card.json', bytes: JSON.stringify(v3) }, { name: 'module.risum', bytes: risum(module, [png()]) }, { name: 'assets/icon/face.png', bytes: png() }, { name: 'assets/other/unknown.dat', bytes: 'exact synthetic unknown bytes' }]);
}

// Two PCM samples, authored here; no third-party recording or media license.
export function silentWav() { const wav=Buffer.alloc(46);wav.write('RIFF');wav.writeUInt32LE(38,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(2,40);return wav; }
