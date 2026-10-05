import { mkdir, open, lstat, readdir, rename, rm, link } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createCardPreparation } from '../../tavern-plugin/lib/domain/card-preparation.js';
import { IMPORT_LIMITS, fail, object, parseJson, parsePng, parseZip, sniffMedia, safeArchiveName } from './import-formats.mjs';
import { decodeRisuModule } from './import-risu.mjs';
import {behaviorReport} from './behavior.mjs';
export { IMPORT_LIMITS } from './import-formats.mjs';
const project = createCardPreparation().project;
const HASH = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => structuredClone(value);
const TEXT = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions', 'creator_notes', 'creator'];
const MAPPED = new Set([...TEXT, 'alternate_greetings', 'tags', 'character_book', 'extensions', 'assets']);
const add = (report, field, status, message) => report.push({ field, status, message });
const LOCKS = new Map();
function checkId(id) { if (typeof id !== 'string' || !HASH.test(id)) fail('INVALID_ID', '无效内容标识'); return id; }
function sourceName(filename) { if (typeof filename !== 'string' || !filename || Buffer.byteLength(filename) > 255 || /[\x00-\x1f\x7f/\\]/.test(filename) || filename === '.' || filename === '..') fail('INVALID_FILENAME', '导入文件名无效'); return filename; }
function sourceData(raw) {
  if (!object(raw)) fail('INVALID_CARD', '角色卡必须是 JSON 对象');
  if (raw.spec !== undefined && !['chara_card_v2', 'chara_card_v3'].includes(raw.spec)) fail('UNSUPPORTED_FORMAT', '未知角色卡规范版本');
  if (raw.spec && !object(raw.data)) fail('INVALID_CARD', '角色卡 data 必须是对象');
  const data = raw.spec ? raw.data : raw;
  for (const field of TEXT) if (data[field] !== undefined && typeof data[field] !== 'string') fail('INVALID_CARD', `${field} 必须为文本`);
  if (!data.name?.trim()) fail('INVALID_CARD', '角色卡缺少有效 name');
  for (const field of ['alternate_greetings', 'tags']) if (data[field] !== undefined && (!Array.isArray(data[field]) || data[field].some(x => typeof x !== 'string') || data[field].length > 1000)) fail('INVALID_CARD', `${field} 必须为最多 1000 项的文本数组`);
  if (data.extensions !== undefined && !object(data.extensions)) fail('INVALID_CARD', 'extensions 必须是对象');
  if (data.character_book != null && !object(data.character_book)) fail('INVALID_CARD', 'character_book 必须是对象');
  if (data.assets !== undefined && (!Array.isArray(data.assets) || data.assets.length > IMPORT_LIMITS.entries)) fail('INVALID_CARD', 'assets 必须是有界数组');
  return data;
}
function compatible(left, right) {
  if (object(left) && object(right)) return Object.keys(left).every(k => !Object.hasOwn(right, k) || compatible(left[k], right[k]));
  return isDeepStrictEqual(left, right);
}
function pngSource(parsed, report) {
  const entries = parsed.metadata;
  for (const entry of entries) sourceData(entry.raw);
  for (let a = 0; a < entries.length; a++) for (let b = a + 1; b < entries.length; b++) {
    const sameKey = entries[a].keyword === entries[b].keyword;
    if (sameKey ? !isDeepStrictEqual(entries[a].raw, entries[b].raw) : !compatible(sourceData(entries[a].raw), sourceData(entries[b].raw))) fail('METADATA_CONFLICT', 'PNG 包含互相冲突的角色卡 metadata；请重新导出单一卡片');
  }
  const selected = entries.find(x => x.keyword === 'ccv3') ?? entries[0];
  add(report, 'PNG metadata', 'mapped', `检查 ${entries.length} 个 metadata 块，采用 ${selected.keyword}；兼容重复 metadata 保留于原件`);
  return selected.raw;
}
function worldbookEntries(entries, report, prefix) {
  if (!Array.isArray(entries)) fail('INVALID_CARD', `${prefix} 必须是数组`);
  if (entries.length > 5000) fail('IMPORT_LIMIT', '世界书条目过多');
  return entries.map((entry, index) => {
    if (!object(entry) || typeof entry.content !== 'string') fail('INVALID_CARD', `${prefix}[${index}] 缺少文本 content`);
    const strings = value => Array.isArray(value) ? value.filter(x => typeof x === 'string') : typeof value === 'string' ? value.split(',').map(x => x.trim()).filter(Boolean) : [];
    const result = { ...copy(entry), id: entry.id ?? `${prefix}:${index}`, keys: strings(entry.keys ?? entry.key), secondaryKeys: strings(entry.secondary_keys ?? entry.secondkey), content: entry.content, enabled: entry.enabled !== false && entry.disabled !== true, constant: entry.constant === true || entry.alwaysActive === true, selective: entry.selective === true, order: Number.isFinite(entry.insertion_order) ? entry.insertion_order : Number.isFinite(entry.insertorder) ? entry.insertorder : Number.isFinite(entry.order) ? entry.order : index, position: entry.position ?? 'before_char', comment: typeof entry.comment === 'string' ? entry.comment : '', raw: copy(entry) };
    if (entry.use_regex || entry.extensions?.use_regex || /(?:^|\n)@@/.test(entry.content)) add(report, `${prefix}[${index}]`, 'unsupported', '高级正则/装饰器激活规则保留但禁用；不运行来源平台脚本');
    if (entry.use_regex || entry.extensions?.use_regex || /(?:^|\n)@@/.test(entry.content)) result.enabled = false;
    if (entry.extensions && Object.keys(entry.extensions).length) add(report, `${prefix}[${index}].extensions`, 'preserved', '世界书扩展保留；来源平台的深度/递归等高级语义未迁移');
    add(report, `${prefix}[${index}].position`, 'unsupported', '源插入位置元数据保留；Linux WorldMode统一放入本轮知识区，不宣称原宿主位置语义一致');
    return result;
  });
}
function reportCapabilities(value, report, prefix = 'extensions', depth = 0) {
  if (!value || typeof value !== 'object' || depth > IMPORT_LIMITS.jsonDepth) return;
  for (const [key, child] of Object.entries(value)) {
    const field = `${prefix}.${key}`;
    if (/(?:script|regex|trigger|\blua\b|\bcjs\b|\bcss\b|html|mcp|backgroundEmbedding|lowLevelAccess)/i.test(key)) { add(report, field, 'unsupported', '原始行为或样式保留但禁用；不执行 JS/Lua、正则、HTML、MCP 或外部请求'); continue; }
    if (child && typeof child === 'object') reportCapabilities(child, report, field, depth + 1);
  }
}
function normalize(raw, report, normalizerVersion=2) {
  const data = sourceData(raw), base = project(raw), extensions = copy(data.extensions ?? {}), unknownData = {}, unknownRoot = {};
  for (const field of TEXT) if (typeof data[field] === 'string' && /<%|\{\{(?:setvar|addvar|incvar|eval|run)::/i.test(data[field])) add(report, field, 'unsupported', '含旧脚本/写变量模板语法，按原文保留但不执行；请改为原生声明式卡片动作');
  if (data.extensions?.story_runtime?.actions !== undefined && !Array.isArray(data.extensions.story_runtime.actions)) add(report, 'extensions.story_runtime.actions', 'unsupported', '原生动作必须是数组；该数据保留但按钮禁用');
  for (const [key, value] of Object.entries(data)) if (!MAPPED.has(key)) { unknownData[key] = copy(value); add(report, `data.${key}`, 'preserved', '未映射字段完整保留；不假定来源平台运行语义'); }
  if (raw.spec) for (const [key, value] of Object.entries(raw)) if (!['spec', 'spec_version', 'data'].includes(key)) { unknownRoot[key] = copy(value); add(report, key, 'preserved', '外层未知字段保留'); }
  if (Object.hasOwn(extensions, '_import')) { unknownData.originalImportExtension = extensions._import; delete extensions._import; }
  extensions._import = { format: raw.spec ?? 'chara_card_v1', version: raw.spec_version ?? '1', unknownData, unknownRoot, resources: [], behaviorPolicy: 'preserved-disabled' };
  const card = { id: '', name: base.name, description: base.description, personality: base.personality, scenario: base.scenario, firstMessage: base.first_mes, alternateGreetings: copy(base.alternate_greetings), exampleDialogue: base.mes_example, systemPrompt: base.system_prompt, postHistoryInstructions: base.post_history_instructions, tags: copy(base.tags), creator: data.creator ?? '', worldbook: data.character_book ? worldbookEntries(data.character_book.entries ?? [], report, 'character_book.entries') : [], assets: [], extensions, original: null };
  for (const field of TEXT.filter(x => x !== 'creator_notes')) add(report, field, data[field] === undefined ? 'missing' : 'mapped', data[field] === undefined ? '未提供，可继续使用其他角色资料' : '已映射为卡片资料；不作为已发生事实');
  if (data.creator_notes !== undefined) { extensions._import.creatorNotes = data.creator_notes; add(report, 'creator_notes', 'preserved', '作者备注仅保留，不作为角色事实或已发生事件'); }
  if (data.character_book) { extensions._import.worldbookMetadata = Object.fromEntries(Object.entries(data.character_book).filter(([k]) => k !== 'entries')); add(report, 'character_book', 'mapped', '支持启用状态、常驻和字面关键字；预算/递归/来源平台脚本不等价'); }
  if (data.alternate_greetings) add(report, 'alternate_greetings', 'mapped', '保持开场顺序、空项与重复项，由用户选择');
  reportCapabilities(data.extensions, report); reportCapabilities(unknownData, report, 'data'); reportCapabilities(unknownRoot, report, 'root');
  if(normalizerVersion>=2){extensions._import.normalizerVersion=normalizerVersion;const nativeReport=behaviorReport(card);report.push(...nativeReport);if(Array.isArray(extensions.story_runtime?.textRules))extensions.story_runtime.textRules=extensions.story_runtime.textRules.map((r,i)=>nativeReport[i]?.status==='mapped'?r:{...r,enabled:false});}
  if (extensions.story_runtime) add(report, 'extensions.story_runtime', object(extensions.story_runtime) ? 'mapped' : 'unsupported', '原生声明式配置保留为数据；世界创建与每次动作仍由核心验证');
  if (extensions.risuai?.defaultVariables !== undefined) add(report, 'extensions.risuai.defaultVariables', 'unsupported', '来源变量模板原文保留；未转换为原生变量，不执行赋值宏');
  if (extensions.variables) add(report, 'extensions.variables', 'preserved', '来源变量保留；只接受原生 story_runtime.variables 的受验证初始化');
  if (Object.keys(data.extensions ?? {}).length) add(report, 'extensions', 'preserved', '扩展原值保留，不授予执行权限');
  if ([card.description, card.firstMessage, ...card.alternateGreetings].some(x => /<[^>]+>/.test(x))) add(report, 'card.html', 'blocked', '卡片 HTML 按纯文本呈现，不执行脚本或外部素材');
  return card;
}
export function prepareCard({ filename, bytes, normalizerVersion=2 }) {
  const report = [], rawResources = new Map(), preservedFiles = new Map(), mediaFiles = new Map(); let raw, archive, expandedBytes = 0;
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.json') raw = parseJson(bytes);
  else if (extension === '.png') { const parsed = parsePng(bytes, true); raw = pngSource(parsed, report); rawResources.set('card-preview.png', parsed.preview); }
  else if (extension === '.charx' || extension === '.zip') { archive = parseZip(bytes); if (!archive.has('card.json')) fail('INVALID_CHARX', 'CharX 根目录缺少 card.json'); raw = parseJson(archive.get('card.json')); for (const [name, data] of archive) if (name !== 'card.json') rawResources.set(name, data); }
  else fail('UNSUPPORTED_FORMAT', '只支持 JSON、PNG 和普通 ZIP/CharX 角色卡');
  expandedBytes = archive ? [...archive.values()].reduce((sum, data) => sum + data.length, 0) : bytes.length;
  const card = normalize(raw, report, normalizerVersion), data = sourceData(raw), id = hash(bytes); card.id = id;
  card.original = { name: filename, sha256: id, path: `cards/${id}/original` };
  function resource(name, value, display = true) {
    const sha256 = hash(value), preserved = { name, sha256, size: value.length, path: `cards/${id}/resources/${sha256}` };
    card.extensions._import.resources.push(preserved); preservedFiles.set(sha256, value);
    let media = null;
    if (display) { try { media = sniffMedia(value, name); } catch (error) { if (error.code === 'IMPORT_LIMIT') throw error; add(report, name, 'blocked', '资源图像损坏，原件保留但不展示'); return; } }
    if (media) {
      const assetHash = hash(media.bytes), asset = { id: assetHash, name, mime: media.mime, path: `assets/${assetHash}`, sha256: assetHash, size: media.bytes.length };
      card.assets.push(asset); mediaFiles.set(assetHash, media.bytes); add(report, name, 'mapped', '按内容校验为受支持图片/音频；本地内容哈希资源');
    } else if (display) add(report, name, 'blocked', '此 MIME/资源类型不在图片音频白名单；原始字节保留但不提供可执行展示');
  }
  for (const [name, value] of [...rawResources]) {
    resource(name, value, name !== 'module.risum');
    if (name === 'module.risum') {
      add(report, name, 'preserved', 'module.risum 原始字节与 SHA256 已保存');
      try {
        const decoded = decodeRisuModule(value), moduleReport = [];
        const moduleBook = decoded.module.lorebook === undefined ? null : worldbookEntries(decoded.module.lorebook, moduleReport, 'module.risum.lorebook');
        card.extensions._import.risuModule = copy(decoded.module); report.push(...moduleReport);
        add(report, name, 'mapped', '按固定 RisuAI legacy v0 格式读取模块资料与资源；不执行行为');
        if (moduleBook) { card.extensions._import.cardWorldbook = card.worldbook; card.worldbook = moduleBook; add(report, 'module.risum.lorebook', 'mapped', '遵循固定 Risu 导出语义，使用模块世界书覆盖卡片副本；两份原始资料均保留'); }
        reportCapabilities(decoded.module, report, name);
        for (const asset of decoded.assets) { if ((expandedBytes += asset.bytes.length) > IMPORT_LIMITS.expandedBytes) fail('IMPORT_LIMIT', '全部包资源及模块解码资源超过总大小限制'); const suffix = /^[a-z0-9]{1,12}$/i.test(asset.ext) ? '.' + asset.ext : ''; const resourceName = `module-assets/${asset.index}/${asset.name}${suffix}`; resource(resourceName, asset.bytes, true); }
        const known = new Set(['name', 'description', 'lorebook', 'regex', 'trigger', 'cjs', 'assets', 'id']);
        for (const key of Object.keys(decoded.module)) if (!known.has(key)) add(report, `${name}.${key}`, 'preserved', '模块字段保留；未声明运行兼容');
      } catch (error) { if (error.code === 'IMPORT_LIMIT') throw error; add(report, name, 'unsupported', `模块未转换（${error.code ?? 'INVALID_MODULE'}）；精确原件已保留，行为禁用`); }
    }
  }
  // Resource references are data. Never fetch them, including URLs in descriptions.
  for (const [index, asset] of (data.assets ?? []).entries()) {
    if (!object(asset) || typeof asset.uri !== 'string') { add(report, `assets[${index}]`, 'unsupported', '资源声明无有效 uri，原声明保留'); continue; }
    const uri = asset.uri;
    if (/^(?:https?:|data:|file:|javascript:|ftp:)/i.test(uri)) { add(report, uri, 'blocked', '外部/内联资源不会自动请求、解码或执行'); continue; }
    if (/^ccdefault:/i.test(uri)) { add(report, uri, 'unsupported', '来源平台默认素材不可迁移'); continue; }
    const name = uri.replace(/^embed(?:d)?ed:\/\//i, '');
    try { safeArchiveName(name); } catch { add(report, uri, 'blocked', '资源引用路径不安全，仅保留声明'); continue; }
    if (!archive?.has(name)) add(report, name, 'missing', '包内未找到此资源；不会静默下载');
    else if (!card.assets.some(x => x.name === name)) add(report, name, 'blocked', '已保留此资源，但不在可展示媒体白名单');
  }
  if (data.assets) card.extensions._import.assetDeclarations = copy(data.assets);
  // Both metadata and all resource validation finish before filesystem mutation.
  return { card, report, rawResources: preservedFiles, mediaFiles };
}
async function checkedDirectory(target, create = false) {
  if (create) { try { await mkdir(target, { recursive: true, mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
  const stat = await lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_STORAGE', '资源目录不能是链接或特殊文件');
}
async function safeRead(target, maxBytes = IMPORT_LIMITS.entryBytes) {
  let handle;
  try { handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW); const stat = await handle.stat(); if (!stat.isFile()) fail('UNSAFE_STORAGE', '资源不是普通文件'); if (stat.size > maxBytes) fail('IMPORT_LIMIT', '已保存资源超过读取限制'); return await handle.readFile(); }
  catch (error) { if (['ELOOP'].includes(error.code)) fail('UNSAFE_STORAGE', '拒绝符号链接资源'); throw error; }
  finally { await handle?.close(); }
}
async function writeDurable(target, bytes) {
  const file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
async function syncDirectory(target) { const file = await open(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await file.sync(); } finally { await file.close(); } }
async function rootDirectories(dataDir, create = false) {
  if (typeof dataDir !== 'string' || !dataDir) fail('INVALID_STORAGE', '缺少数据目录');
  const root = path.resolve(dataDir); await checkedDirectory(root, create); await checkedDirectory(path.join(root, 'cards'), create); if (create) await checkedDirectory(path.join(root, 'assets'), true); return root;
}
export async function importCard({ filename, bytes, dataDir, normalizerVersion=2, prepared: supplied, signal, onProgress=()=>{} }) {
  if(![1,2].includes(normalizerVersion))fail('UNSUPPORTED_IMPORT_VERSION','Unsupported card normalization version');
  filename = sourceName(filename);
  if (!(bytes instanceof Uint8Array)) fail('INVALID_INPUT', '导入内容必须为字节数组');
  if (!bytes.length || bytes.length > IMPORT_LIMITS.rawBytes) fail('IMPORT_LIMIT', '导入大小必须为 1 字节至 64 MiB');
  if (typeof dataDir !== 'string' || !dataDir) fail('INVALID_STORAGE', '缺少数据目录');
  const input = Buffer.from(bytes), prepared = supplied ?? prepareCard({ filename, bytes: input, normalizerVersion }), root = path.resolve(dataDir), previous = LOCKS.get(root) ?? Promise.resolve();
  let release; const gate = new Promise(resolve => { release = resolve; }); LOCKS.set(root, gate); await previous.catch(() => {});
  let staging; const createdAssets=[]; let registered=false;
  const checkpoint=stage=>{ signal?.throwIfAborted(); onProgress(stage); signal?.throwIfAborted(); };
  try {
    checkpoint("staging");
    await rootDirectories(dataDir, true);
    const target = path.join(root, 'cards', prepared.card.id);
    try { const result = await readCard(root, prepared.card.id); add(result.report, 'original', 'preserved', '相同 SHA256 已导入，复用已注册卡片'); return result; } catch (error) { if (error.code !== 'CARD_NOT_FOUND') throw error; }
    staging = path.join(root, 'cards', `.staging-${randomUUID()}`); await mkdir(staging, { mode: 0o700 }); await mkdir(path.join(staging, 'resources'), { mode: 0o700 });
    await writeDurable(path.join(staging, 'original'), input);
    const written = new Set();
    for (const value of prepared.rawResources.values()) { checkpoint("resources"); const id = hash(value); if (!written.has(id)) { await writeDurable(path.join(staging, 'resources', id), value); written.add(id); } }
    await writeDurable(path.join(staging, 'card.json'), JSON.stringify(prepared.card)); await writeDurable(path.join(staging, 'report.json'), JSON.stringify(prepared.report)); await syncDirectory(path.join(staging, 'resources')); await syncDirectory(staging);
    for (const [id, value] of prepared.mediaFiles) {
      checkpoint("resources");
      const destination = path.join(root, 'assets', id);
      const pendingMedia = path.join(staging, `media-${id}`); await writeDurable(pendingMedia, value);
      try { await link(pendingMedia, destination); createdAssets.push(destination); } catch (error) { if (error.code !== 'EEXIST') throw error; if (hash(await safeRead(destination)) !== id) fail('CORRUPT_STORAGE', '已存在资源哈希不匹配'); }
      await rm(pendingMedia);
    }
    await syncDirectory(path.join(root, 'assets')); await syncDirectory(staging);
    checkpoint("registering");
    try { await rename(staging, target); staging = null; registered=true; } catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; return await readCard(root, prepared.card.id); }
    await syncDirectory(path.join(root, 'cards')); return { card: prepared.card, report: prepared.report };
  } finally { try { if (staging) await rm(staging, { recursive: true, force: true }); if(!registered) for(const asset of createdAssets) await rm(asset,{force:true}); } finally { release(); if (LOCKS.get(root) === gate) LOCKS.delete(root); } }
}
export async function readCard(dataDir, id) {
  checkId(id);
  try {
    const root = await rootDirectories(dataDir), directory = path.join(root, 'cards', id); await checkedDirectory(directory);
    const cardBytes = await safeRead(path.join(directory, 'card.json')), reportBytes = await safeRead(path.join(directory, 'report.json'));
    let card, report; try { card = JSON.parse(cardBytes.toString('utf8')); report = JSON.parse(reportBytes.toString('utf8')); } catch { fail('CORRUPT_STORAGE', '已保存角色卡元数据损坏'); }
    if (card?.id !== id || card?.original?.sha256 !== id || !Array.isArray(report)) fail('CORRUPT_STORAGE', '角色卡记录身份不一致');
    return { card, report };
  } catch (error) { if (error.code === 'ENOENT') fail('CARD_NOT_FOUND', '角色卡不存在'); throw error; }
}
export async function listCards(dataDir) {
  let root;
  try { root = await rootDirectories(dataDir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const cards = [];
  for (const entry of await readdir(path.join(root, 'cards'), { withFileTypes: true })) { if (!HASH.test(entry.name)) continue; if (!entry.isDirectory() || entry.isSymbolicLink()) fail('UNSAFE_STORAGE', '卡片登记不是普通目录'); cards.push((await readCard(root, entry.name)).card); }
  return cards.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id));
}
export async function assetPath(dataDir, assetId) {
  checkId(assetId);
  try {
    const root = path.resolve(dataDir); await checkedDirectory(root); await checkedDirectory(path.join(root, 'assets'));
    const absolutePath = path.join(root, 'assets', assetId), bytes = await safeRead(absolutePath);
    if (hash(bytes) !== assetId) fail('CORRUPT_STORAGE', '资源内容哈希不一致');
    const media = sniffMedia(bytes); if (!media) fail('UNSAFE_STORAGE', '资源不是允许的图片/音频');
    return { path: absolutePath, mime: media.mime, size: bytes.length, sha256: assetId };
  } catch (error) { if (error.code === 'ENOENT') fail('ASSET_NOT_FOUND', '可展示资源不存在'); throw error; }
}

// Called only during server startup after its exclusive data-directory lock.
export async function recoverImportStorage(dataDir) {
  const root=await rootDirectories(dataDir,true), referenced=new Set();
  for(const card of await listCards(root))for(const asset of card.assets)referenced.add(asset.id);
  let staging=0,orphanAssets=0;
  for(const entry of await readdir(path.join(root,'cards'),{withFileTypes:true})){
    if(!/^\.staging-[a-f0-9-]{36}$/.test(entry.name))continue;
    if(!entry.isDirectory()||entry.isSymbolicLink())fail('UNSAFE_STORAGE','临时导入目录异常');
    await rm(path.join(root,'cards',entry.name),{recursive:true});staging++;
  }
  for(const entry of await readdir(path.join(root,'assets'),{withFileTypes:true})){
    if(!HASH.test(entry.name)||referenced.has(entry.name))continue;
    if(!entry.isFile()||entry.isSymbolicLink())fail('UNSAFE_STORAGE','资源文件异常');
    await rm(path.join(root,'assets',entry.name));orphanAssets++;
  }
  return {staging,orphanAssets};
}
