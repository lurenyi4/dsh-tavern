// RPack interoperability table from RisuAI commit 9f3b589b6e74230401a431a00fd977986d212870.
// Source src/ts/rpack/rpack_map.bin, Git blob 18e10e23907af0b8b15f26aae1cffc4cc4d269f5.
// Upstream Rpack distribution requires AGPL-3.0 when used outside RisuAI.
// This module is distributed with the host's AGPL-3.0 LICENSE; no upstream runtime is executed.
// Decoder is a bounded independent implementation of the observed legacy .risum wire format.
import { IMPORT_LIMITS, fail, parseJson, object } from './import-formats.mjs';
const decodeMap = Buffer.from('2cf7848bc965fbb69faeb3032d0169741fe4a3ecee5c3421934a0f6ae262029e229cfd3cfc71c7c6ad596705706d8a4412fa24865fafd17a47cefe5063dd51066f18e052a8099d56734cb8536cc3a00e19cf3e0d7e07326846ea48f9992eaba449205e5535380cbcd3b1581679280a1ae1f2cdc439dba2ba6072767d95ef7fc8c0de3794bfb51481922545ace7f566a72b365ac113e34b3ae88d831b7c27b09a42eb87aadc548e7826d25729d4b7f82f8f8975f04177c21effd81511e5049717f331d09b00d7cab44f2a3bd9b26bda5da13f3061bd913d4ee6dfbe4d828c1d23109864f485337b9043bba988f1d6a51cf6cc6eb95b0b96edd5e9c5cb08a68040', 'hex');
function decode(bytes) { const result = Buffer.allocUnsafe(bytes.length); for (let i = 0; i < bytes.length; i++) result[i] = decodeMap[bytes[i]]; return result; }
export function decodeRisuModule(bytes) {
  let offset = 0, expanded = 0;
  function take(length) { if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) fail('INVALID_MODULE', 'Risu 模块被截断'); const part = bytes.subarray(offset, offset + length); offset += length; return part; }
  const header = take(6);
  if (header[0] !== 111 || header[1] !== 0) fail('UNSUPPORTED_MODULE', '未知 Risu 模块版本');
  const length = header.readUInt32LE(2); if (length > IMPORT_LIMITS.jsonBytes) fail('IMPORT_LIMIT', 'Risu 模块 JSON 超限');
  const raw = parseJson(decode(take(length)), 'module.risum');
  if (!object(raw) || raw.type !== 'risuModule' || !object(raw.module)) fail('INVALID_MODULE', 'Risu 模块结构无效');
  const module = raw.module, assets = [];
  if (module.assets !== undefined && !Array.isArray(module.assets)) fail('INVALID_MODULE', 'Risu 资源声明必须为数组');
  while (true) {
    const marker = take(1)[0]; if (marker === 0) break;
    if (marker !== 1) fail('INVALID_MODULE', 'Risu 资源标记无效');
    const size = take(4).readUInt32LE(0);
    if (size > IMPORT_LIMITS.entryBytes || (expanded += size) > IMPORT_LIMITS.expandedBytes || assets.length >= IMPORT_LIMITS.entries) fail('IMPORT_LIMIT', 'Risu 模块资源超限');
    const metadata = module.assets?.[assets.length];
    if (!Array.isArray(metadata) || metadata.length < 3 || typeof metadata[0] !== 'string' || typeof metadata[2] !== 'string') fail('INVALID_MODULE', 'Risu 资源声明缺失或无效');
    assets.push({ name: metadata[0], ext: metadata[2], bytes: decode(take(size)), index: assets.length });
  }
  if (offset !== bytes.length || assets.length !== (module.assets?.length ?? 0)) fail('INVALID_MODULE', 'Risu 模块尾部或资源数量不一致');
  return { module, assets };
}
