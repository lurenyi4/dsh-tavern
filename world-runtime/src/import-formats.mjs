import {STORAGE_LIMITS} from './storage-limits.mjs';
import { inflateRawSync, inflateSync } from 'node:zlib';

export const IMPORT_LIMITS = Object.freeze({ rawBytes: STORAGE_LIMITS.originalBytes, expandedBytes: 128 * 1024 * 1024, entryBytes: 32 * 1024 * 1024, jsonBytes: 8 * 1024 * 1024, entries: 512, ratio: 100, pathDepth: 12, pathBytes: 512, jsonDepth: 64, jsonNodes: 100000, pngChunks: 4096, metadataChunks: 16, imageDimension: 16384, imagePixels: 40 * 1024 * 1024 });
export function fail(code, message) { throw Object.assign(new Error(message), { code }); }
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const utf8 = new TextDecoder('utf-8', { fatal: true });
export function decodeUtf8(bytes, code = 'INVALID_JSON') { try { return utf8.decode(bytes); } catch { fail(code, '数据包含无效 UTF-8'); } }
export function parseJson(bytes, label = 'card.json', limits = IMPORT_LIMITS) {
  if (bytes.length > limits.jsonBytes) fail('IMPORT_LIMIT', `${label} 超过 JSON 大小限制`);
  let result; try { result = JSON.parse(decodeUtf8(bytes)); } catch (error) { if (error.code) throw error; fail('INVALID_JSON', `${label} 不是有效 JSON`); }
  let count = 0; const stack = [[result, 0]];
  while (stack.length) {
    const [value, depth] = stack.pop();
    if (typeof value === 'number' && !Number.isFinite(value)) fail('INVALID_JSON', `${label} 包含非有限数值`);
    if (++count > limits.jsonNodes || depth > limits.jsonDepth) fail('IMPORT_LIMIT', `${label} 超过结构复杂度限制`);
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('UNSAFE_JSON', `${label} 包含禁止的属性键`);
      stack.push([child, depth + 1]);
    }
  }
  return result;
}
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let value = n; for (let k = 0; k < 8; k++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)); crcTable[n] = value; }
export function crc32(bytes) { let value = 0xffffffff; for (const b of bytes) value = crcTable[(value ^ b) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
function inflateBounded(bytes, maxBytes, raw = false, code = 'INVALID_ARCHIVE', checkRatio = true) {
  let result;
  try { result = (raw ? inflateRawSync : inflateSync)(bytes, { maxOutputLength: maxBytes, info: true }); }
  catch (error) { if (error.code === 'ERR_BUFFER_TOO_LARGE') fail('IMPORT_LIMIT', '解压后数据超过大小限制'); fail(code, '压缩数据损坏'); }
  if (result.engine.bytesWritten !== bytes.length) fail(code, '压缩数据有未消费的尾部');
  if (checkRatio && result.buffer.length > Math.max(bytes.length, 1) * IMPORT_LIMITS.ratio) fail('IMPORT_LIMIT', '压缩比例超过限制');
  return result.buffer;
}
export function safeArchiveName(name) {
  if (typeof name !== 'string' || !name || Buffer.byteLength(name) > IMPORT_LIMITS.pathBytes) fail('UNSAFE_ARCHIVE', '包内路径为空或过长');
  if (/[\x00-\x1f\x7f\\:]/.test(name) || name.startsWith('/') || /%[0-9a-f]{2}/i.test(name)) fail('UNSAFE_ARCHIVE', '包内路径不安全');
  const parts = (name.endsWith('/') ? name.slice(0, -1) : name).split('/');
  if (parts.length > IMPORT_LIMITS.pathDepth) fail('IMPORT_LIMIT', '包内路径层级超过限制');
  if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) fail('UNSAFE_ARCHIVE', '包内路径不安全');
  return name;
}
function checkExtra(bytes) {
  let pos = 0;
  while (pos < bytes.length) {
    if (pos + 4 > bytes.length) fail('INVALID_ARCHIVE', 'ZIP 扩展字段损坏');
    const id = bytes.readUInt16LE(pos), size = bytes.readUInt16LE(pos + 2); pos += 4;
    if (pos + size > bytes.length) fail('INVALID_ARCHIVE', 'ZIP 扩展字段越界');
    if (id === 1) fail('UNSUPPORTED_FORMAT', '不支持 ZIP64；请导出普通 CharX');
    pos += size;
  }
}
export function parseZip(bytes) {
  // Validate the complete directory before allocating any expanded entry.
  let end = -1;
  for (let p = bytes.length - 22, min = Math.max(0, bytes.length - 65557); p >= min; p--) if (bytes.readUInt32LE(p) === 0x06054b50 && p + 22 + bytes.readUInt16LE(p + 20) === bytes.length) { end = p; break; }
  if (end < 0) fail('INVALID_ARCHIVE', 'ZIP 结束目录缺失或损坏');
  const count = bytes.readUInt16LE(end + 10), directorySize = bytes.readUInt32LE(end + 12), directoryOffset = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count) fail('UNSUPPORTED_FORMAT', '不支持分卷 ZIP');
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) fail('UNSUPPORTED_FORMAT', '不支持 ZIP64');
  if (count > IMPORT_LIMITS.entries) fail('IMPORT_LIMIT', 'ZIP 条目数超过限制');
  if (directoryOffset + directorySize !== end) fail('INVALID_ARCHIVE', 'ZIP 目录范围不一致；不支持 JPEG+ZIP 封装');
  const entries = [], names = new Set(), canonicalNames = new Set(); let pos = directoryOffset, total = 0, compressedTotal = 0;
  for (let index = 0; index < count; index++) {
    if (pos + 46 > end || bytes.readUInt32LE(pos) !== 0x02014b50) fail('INVALID_ARCHIVE', 'ZIP 中央目录损坏');
    const flags = bytes.readUInt16LE(pos + 8), method = bytes.readUInt16LE(pos + 10), checksum = bytes.readUInt32LE(pos + 16), compressed = bytes.readUInt32LE(pos + 20), expanded = bytes.readUInt32LE(pos + 24), nameSize = bytes.readUInt16LE(pos + 28), extraSize = bytes.readUInt16LE(pos + 30), commentSize = bytes.readUInt16LE(pos + 32), disk = bytes.readUInt16LE(pos + 34), attributes = bytes.readUInt32LE(pos + 38), offset = bytes.readUInt32LE(pos + 42);
    const next = pos + 46 + nameSize + extraSize + commentSize;
    if (next > end || disk !== 0) fail('INVALID_ARCHIVE', 'ZIP 条目目录越界');
    if (flags & (1 | 0x40 | 0x2000)) fail('UNSAFE_ARCHIVE', '拒绝加密 ZIP 条目');
    if (flags & ~(0x800 | 8 | 2 | 4)) fail('UNSUPPORTED_FORMAT', '不支持此 ZIP 标志');
    if (![0, 8].includes(method)) fail('UNSUPPORTED_FORMAT', 'ZIP 仅支持 stored/deflate');
    const rawName = bytes.subarray(pos + 46, pos + 46 + nameSize), name = safeArchiveName(decodeUtf8(rawName, 'UNSAFE_ARCHIVE'));
    const canonical = name.normalize('NFC').toLowerCase();
    if (names.has(name) || canonicalNames.has(canonical)) fail('UNSAFE_ARCHIVE', 'ZIP 存在重复或混淆条目名');
    names.add(name); canonicalNames.add(canonical); checkExtra(bytes.subarray(pos + 46 + nameSize, pos + 46 + nameSize + extraSize));
    const unixType = (attributes >>> 16) & 0o170000;
    if (unixType && unixType !== 0o100000 && unixType !== 0o040000) fail('UNSAFE_ARCHIVE', '拒绝符号链接或特殊文件');
    const directory = name.endsWith('/');
    if ((unixType === 0o040000 && !directory) || (directory && expanded !== 0)) fail('UNSAFE_ARCHIVE', 'ZIP 目录类型不一致');
    if (expanded > IMPORT_LIMITS.entryBytes || (total += expanded) > IMPORT_LIMITS.expandedBytes || expanded > Math.max(compressed, 1) * IMPORT_LIMITS.ratio) fail('IMPORT_LIMIT', 'ZIP 解压大小或压缩比例超过限制');
    compressedTotal += compressed;
    if (offset + 30 > directoryOffset || bytes.readUInt32LE(offset) !== 0x04034b50) fail('INVALID_ARCHIVE', 'ZIP 本地文件头无效');
    const localNameSize = bytes.readUInt16LE(offset + 26), localExtraSize = bytes.readUInt16LE(offset + 28), start = offset + 30 + localNameSize + localExtraSize, finish = start + compressed;
    if (finish > directoryOffset || localNameSize !== rawName.length || !bytes.subarray(offset + 30, offset + 30 + localNameSize).equals(rawName) || bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method) fail('INVALID_ARCHIVE', 'ZIP 本地文件头与目录不一致');
    checkExtra(bytes.subarray(offset + 30 + localNameSize, start));
    if (!(flags & 8) && (bytes.readUInt32LE(offset + 14) !== checksum || bytes.readUInt32LE(offset + 18) !== compressed || bytes.readUInt32LE(offset + 22) !== expanded)) fail('INVALID_ARCHIVE', 'ZIP 本地尺寸或校验值不一致');
    let recordEnd = finish;
    if (flags & 8) {
      const signature = finish + 4 <= directoryOffset && bytes.readUInt32LE(finish) === 0x08074b50, descriptor = finish + (signature ? 4 : 0);
      if (descriptor + 12 > directoryOffset || bytes.readUInt32LE(descriptor) !== checksum || bytes.readUInt32LE(descriptor + 4) !== compressed || bytes.readUInt32LE(descriptor + 8) !== expanded) fail('INVALID_ARCHIVE', 'ZIP 数据描述符不一致');
      recordEnd = descriptor + 12;
    }
    entries.push({ name, directory, method, checksum, compressed, expanded, offset, start, finish, recordEnd }); pos = next;
  }
  if (pos !== end || total > Math.max(compressedTotal, 1) * IMPORT_LIMITS.ratio) fail('INVALID_ARCHIVE', 'ZIP 目录内容不一致');
  const ranges = [...entries].sort((a, b) => a.offset - b.offset); let last = 0;
  for (const range of ranges) { if (range.offset !== last) fail('INVALID_ARCHIVE', 'ZIP 条目重叠、前缀或未登记数据'); last = range.recordEnd; }
  if (last !== directoryOffset) fail('INVALID_ARCHIVE', 'ZIP 数据与目录之间有未登记内容');
  const files = new Map();
  for (const entry of entries) {
    const packed = bytes.subarray(entry.start, entry.finish), data = entry.method === 0 ? packed : inflateBounded(packed, Math.max(entry.expanded, 1), true);
    if (data.length !== entry.expanded || crc32(data) !== entry.checksum) fail('INVALID_ARCHIVE', 'ZIP 条目尺寸或 CRC 校验失败');
    if (!entry.directory) files.set(entry.name, data);
  }
  return files;
}
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function isPng(bytes) { return bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE); }
function pixels(width, height) { if (!width || !height) fail('INVALID_MEDIA', '图片尺寸无效'); if (width > IMPORT_LIMITS.imageDimension || height > IMPORT_LIMITS.imageDimension || width * height > IMPORT_LIMITS.imagePixels) fail('IMPORT_LIMIT', '图片像素尺寸超过限制'); }
function base64Json(bytes) {
  const value = decodeUtf8(bytes, 'INVALID_PNG').trim();
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) fail('INVALID_PNG', '角色卡 metadata 不是有效 Base64');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) fail('INVALID_PNG', '角色卡 metadata Base64 不规范');
  return parseJson(decoded, 'PNG metadata');
}
export function parsePng(bytes, requireCard = false) {
  if (!isPng(bytes)) fail('INVALID_PNG', 'PNG 签名无效');
  const metadata = [], safeChunks = [PNG_SIGNATURE], compressedPixels = []; let offset = 8, count = 0, ended = false, idat = false, imageHeader; 
  while (offset < bytes.length) {
    if (++count > IMPORT_LIMITS.pngChunks) fail('IMPORT_LIMIT', 'PNG 块数超过限制');
    if (offset + 12 > bytes.length) fail('INVALID_PNG', 'PNG 块头截断');
    const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8), end = offset + 12 + size;
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) fail('INVALID_PNG', 'PNG 块越界或类型无效');
    const data = bytes.subarray(offset + 8, end - 4);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail('INVALID_PNG', 'PNG CRC 校验失败');
    if (count === 1 && type !== 'IHDR') fail('INVALID_PNG', 'PNG 缺少首个 IHDR');
    if (type === 'IHDR') { if (count !== 1 || size !== 13) fail('INVALID_PNG', 'PNG IHDR 无效'); pixels(data.readUInt32BE(0), data.readUInt32BE(4)); imageHeader = data; }
    if (type === 'IDAT') { idat = true; compressedPixels.push(data); }
    if (['tEXt', 'zTXt', 'iTXt'].includes(type)) {
      const zero = data.indexOf(0);
      if (zero < 1 || zero > 79) fail('INVALID_PNG', 'PNG 文本关键字无效');
      const keyword = data.toString('latin1', 0, zero);
      if (requireCard && ['chara', 'ccv3'].includes(keyword)) {
        if (metadata.length >= IMPORT_LIMITS.metadataChunks) fail('IMPORT_LIMIT', 'PNG metadata 数量超过限制');
        let content = data.subarray(zero + 1);
        if (type === 'zTXt') { if (content[0] !== 0) fail('INVALID_PNG', 'PNG 压缩文本方法无效'); content = inflateBounded(content.subarray(1), IMPORT_LIMITS.jsonBytes * 2, false, 'INVALID_PNG'); }
        if (type === 'iTXt') {
          if (content.length < 4 || ![0, 1].includes(content[0]) || content[1] !== 0) fail('INVALID_PNG', 'PNG 国际文本标志无效');
          const compressed = content[0], languageEnd = content.indexOf(0, 2), translatedEnd = languageEnd < 0 ? -1 : content.indexOf(0, languageEnd + 1);
          if (translatedEnd < 0) fail('INVALID_PNG', 'PNG 国际文本结构无效');
          content = content.subarray(translatedEnd + 1); if (compressed) content = inflateBounded(content, IMPORT_LIMITS.jsonBytes * 2, false, 'INVALID_PNG');
        }
        metadata.push({ keyword, raw: base64Json(content) });
      }
    } else if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type)) safeChunks.push(bytes.subarray(offset, end));
    offset = end;
    if (type === 'IEND') { if (size !== 0 || !idat || offset !== bytes.length) fail('INVALID_PNG', 'PNG IEND 或数据无效'); ended = true; break; }
  }
  if (!ended) fail('INVALID_PNG', 'PNG 缺少 IEND');
  const width = imageHeader.readUInt32BE(0), height = imageHeader.readUInt32BE(4), depth = imageHeader[8], color = imageHeader[9], interlace = imageHeader[12];
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(color);
  const depths = color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16];
  if (!channels || !depths.includes(depth) || imageHeader[10] !== 0 || imageHeader[11] !== 0 || ![0, 1].includes(interlace)) fail('INVALID_PNG', 'PNG 像素编码无效');
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const rows = passes.map(([x, y, dx, dy]) => { const cols = Math.max(0, Math.ceil((width - x) / dx)), rowCount = Math.max(0, Math.ceil((height - y) / dy)); return { stride: Math.ceil(cols * channels * depth / 8) + 1, count: cols ? rowCount : 0 }; });
  const expected = rows.reduce((sum, pass) => sum + pass.stride * pass.count, 0);
  if (expected > IMPORT_LIMITS.expandedBytes) fail('IMPORT_LIMIT', 'PNG 解码像素数据超过限制');
  const unpacked = inflateBounded(Buffer.concat(compressedPixels), expected + 1, false, 'INVALID_PNG', false);
  if (unpacked.length !== expected) fail('INVALID_PNG', 'PNG 像素行尺寸不匹配');
  let rowOffset = 0; for (const pass of rows) for (let row = 0; row < pass.count; row++) { if (unpacked[rowOffset] > 4) fail('INVALID_PNG', 'PNG 行过滤器无效'); rowOffset += pass.stride; }

  if (requireCard && !metadata.length) fail('MISSING_METADATA', 'PNG 未找到 chara/ccv3 角色卡 metadata');
  return { metadata, preview: Buffer.concat(safeChunks) };
}
export function sniffMedia(bytes, name = '') {
  if (bytes.length > IMPORT_LIMITS.entryBytes) fail('IMPORT_LIMIT', '资源超过单文件大小限制');
  // Filename restrictions are additional to byte sniffing. Never expose active formats.
  if (/\.(?:html?|svgz?|js|mjs|cjs|ts|lua|wasm|exe|dll|sh|bat|cmd|ps1|pdf|xml)$/i.test(name)) return null;
  if (isPng(bytes)) return { mime: 'image/png', bytes: parsePng(bytes).preview };
  if (bytes.length >= 14 && (bytes.subarray(0, 6).toString() === 'GIF87a' || bytes.subarray(0, 6).toString() === 'GIF89a')) { pixels(bytes.readUInt16LE(6), bytes.readUInt16LE(8)); if (bytes.at(-1) !== 0x3b) return null; return { mime: 'image/gif', bytes }; }
  if (bytes.length >= 16 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    let pos = 2, found = false;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos++] !== 255) return null; while (bytes[pos] === 255) pos++;
      const tag = bytes[pos++]; if (tag === 0xda || tag === 0xd9) break; if (tag === 1 || (tag >= 0xd0 && tag <= 0xd7)) continue;
      if (pos + 2 > bytes.length) return null; const size = bytes.readUInt16BE(pos); if (size < 2 || pos + size > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(tag)) { if (size < 8) return null; pixels(bytes.readUInt16BE(pos + 5), bytes.readUInt16BE(pos + 3)); found = true; }
      pos += size;
    }
    return found ? { mime: 'image/jpeg', bytes } : null;
  }
  const ascii = bytes.subarray(0, 12).toString('latin1');
  if (bytes.length >= 30 && ascii.startsWith('RIFF') && ascii.endsWith('WEBP') && bytes.readUInt32LE(4) + 8 === bytes.length) {
    const kind = bytes.toString('ascii', 12, 16); let width, height;
    if (kind === 'VP8X') { width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3); }
    else if (kind === 'VP8 ' && bytes.length >= 30 && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 1, 0x2a]))) { width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff; }
    else if (kind === 'VP8L' && bytes[20] === 0x2f) { const bits = bytes.readUInt32LE(21); width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff); }
    else return null;
    pixels(width, height); return { mime: 'image/webp', bytes };
  }
  if (bytes.length >= 44 && ascii.startsWith('RIFF') && ascii.endsWith('WAVE') && bytes.readUInt32LE(4) + 8 === bytes.length) return { mime: 'audio/wav', bytes };
  if (bytes.length >= 28 && bytes.toString('ascii', 0, 4) === 'OggS' && bytes[4] === 0 && (bytes.subarray(0, 256).includes(Buffer.from('OpusHead')) || bytes.subarray(0, 256).includes(Buffer.from('vorbis')))) return { mime: 'audio/ogg', bytes };
  if (bytes.length >= 42 && bytes.toString('ascii', 0, 4) === 'fLaC') return { mime: 'audio/flac', bytes };
  if (bytes.length >= 4 && bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 6) !== 0 && (bytes[2] & 0xf0) !== 0xf0 && (bytes[2] & 0x0c) !== 0x0c) return { mime: 'audio/mpeg', bytes };
  // ID3 tags are not accepted without checking that a real MPEG frame follows them.
  if (bytes.length >= 14 && bytes.toString('ascii', 0, 3) === 'ID3' && bytes.subarray(6, 10).every(x => x < 128)) { const size = ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]) + 10 + ((bytes[5] & 0x10) ? 10 : 0); const frame = bytes.subarray(size); if (frame.length >= 4 && frame[0] === 255 && (frame[1] & 0xe0) === 0xe0 && (frame[1] & 6) !== 0 && (frame[2] & 0xf0) !== 0xf0 && (frame[2] & 0x0c) !== 0x0c) return { mime: 'audio/mpeg', bytes }; }
  return null;
}
