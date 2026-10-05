import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { importCard, listCards, readCard, assetPath, IMPORT_LIMITS } from '../src/importer.mjs';
import { v1, v2, v3, png, zip, charx } from '../fixtures/import-fixtures.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) { const dir = await mkdtemp(join(tmpdir(), 'world-import-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
const cardEntry = { name: 'card.json', bytes: JSON.stringify(v3) };
async function rejectAtomic(t, bytes, code, filename = 'bad.charx') { const dataDir = await fixture(t); await assert.rejects(importCard({ filename, bytes, dataDir }), { code }); assert.deepEqual(await listCards(dataDir), []); assert.deepEqual((await readdir(join(dataDir, 'cards')).catch(() => [])).filter(n => !n.startsWith('.')), []); }

test('ST v1/v2/v3 map narrative fields and preserve unknown values exactly', async t => {
  const dataDir = await fixture(t);
  for (const source of [v1, v2, v3]) {
    const bytes = Buffer.from(JSON.stringify(source)), { card, report } = await importCard({ filename: '角色.json', bytes, dataDir });
    assert.equal(card.id, hash(bytes)); assert.equal(card.name, '渡口向导'); assert.equal(card.firstMessage, '请选择一条路。'); assert.equal(card.exampleDialogue, '仅为例句');
    assert.deepEqual(await readFile(join(dataDir, card.original.path)), bytes); assert.equal(card.original.sha256, hash(bytes));
    assert.deepEqual((await readCard(dataDir, card.id)).card, card); assert.deepEqual((await readCard(dataDir, card.id)).report, report);
    assert.deepEqual(card.extensions._import.unknownData.mysterious, v1.mysterious);
    if (source !== v1) { assert.deepEqual(card.alternateGreetings, ['晚间渡口', '', '晚间渡口']); assert.equal(card.worldbook[0].unknown_flag, 99); assert.equal(card.extensions.future_extension.a[1], true); assert.equal(card.extensions.story_runtime.actions[0].id, 'wave'); assert.equal(card.extensions._import.unknownRoot.wrapper_unknown, 17); assert.ok(report.some(r => r.field.includes('regex_scripts') && r.status === 'unsupported')); }
  }
  assert.equal((await listCards(dataDir)).length, 3);
});
test('duplicate content has one stable registration even concurrently; changed content is separate', async t => {
  const dataDir = await fixture(t), bytes = Buffer.from(JSON.stringify(v2));
  const results = await Promise.all(Array.from({ length: 5 }, () => importCard({ filename: 'same.json', bytes, dataDir })));
  assert.equal(new Set(results.map(x => x.card.id)).size, 1); assert.equal((await listCards(dataDir)).length, 1);
  await importCard({ filename: 'same.json', bytes: Buffer.from(JSON.stringify({ ...v1, name: '另一张' })), dataDir }); assert.equal((await listCards(dataDir)).length, 2);
});
test('PNG metadata tEXt/zTXt/iTXt valid; chara plus compatible ccv3 prefers v3; preview contains no metadata', async t => {
  const dataDir = await fixture(t);
  for (const kind of ['tEXt', 'zTXt', 'iTXt']) {
    const { card } = await importCard({ filename: 'character.png', bytes: png([['chara', v2, kind], ['ccv3', v3, kind]]), dataDir });
    assert.equal(card.name, v2.data.name); assert.ok(card.assets.some(x => x.mime === 'image/png'));
    const asset = await assetPath(dataDir, card.assets[0].id), preview = await readFile(asset.path); assert.equal(asset.mime, 'image/png'); assert.equal(preview.includes(Buffer.from('chara')), false); assert.equal(preview.includes(Buffer.from('ccv3')), false);
  }
});
test('PNG rejects conflicting metadata, duplicate conflicting keys, corrupted CRC, broken JSON, missing metadata', async t => {
  await rejectAtomic(t, png([['chara', v2], ['ccv3', { ...v3, data: { ...v3.data, name: 'Conflict' } }]]), 'METADATA_CONFLICT', 'bad.png');
  await rejectAtomic(t, png([['chara', v1], ['chara', { ...v1, name: 'Conflict' }]]), 'METADATA_CONFLICT', 'bad.png');
  await rejectAtomic(t, png([['chara', v2]], { badCrc: true }), 'INVALID_PNG', 'bad.png');
  await rejectAtomic(t, png([['chara', '{bad json']]), 'INVALID_JSON', 'bad.png');
  await rejectAtomic(t, png(), 'MISSING_METADATA', 'bad.png');
});
test('CharX preserves exact module/resources, deduplicates safe media, blocks active MIME and marks missing/remote assets', async t => {
  const dataDir = await fixture(t), bytes = charx(), { card, report } = await importCard({ filename: 'fixture.charx', bytes, dataDir });
  assert.equal(card.assets.length, 2); assert.equal(card.assets[0].id, card.assets[1].id);
  assert.deepEqual(await readFile(join(dataDir, card.original.path)), bytes);
  const resources = card.extensions._import.resources;
  assert.ok(resources.find(r => r.name === 'module.risum')); assert.equal((await readFile(join(dataDir, resources.find(r => r.name === 'module.risum').path))).length, 10);
  assert.equal((await readFile(join(dataDir, resources.find(r => r.name === 'future-extension.txt').path), 'utf8')), 'exact unknown bytes\n');
  assert.ok(report.some(r => r.field === 'module.risum' && r.status === 'unsupported')); assert.ok(report.some(r => r.status === 'missing' && r.field.includes('missing.png'))); assert.ok(report.some(r => r.status === 'blocked' && r.field.includes('https://')));
  assert.ok(report.some(r => r.status === 'blocked' && r.field.endsWith('.html'))); assert.ok(report.some(r => r.status === 'blocked' && r.field.endsWith('.svg')));
  const stored = await readdir(join(dataDir, 'assets')); assert.equal(stored.filter(n => /^[a-f0-9]{64}$/.test(n)).length, 1);
  await assert.rejects(assetPath(dataDir, resources.find(r => r.name === 'module.risum').sha256), { code: 'ASSET_NOT_FOUND' });
});
test('CharX accepts deflate and directory entries', async t => { const dataDir = await fixture(t); const { card } = await importCard({ filename: 'a.charx', dataDir, bytes: zip([{ ...cardEntry, method: 8 }, { name: 'assets/', mode: 0o040755 }, { name: 'assets/a.png', bytes: png(), method: 8 }]) }); assert.equal(card.assets.length, 1); });
test('unsafe archive paths, symlinks, encryption, duplicate entry names, missing card reject whole import', async t => {
  for (const name of ['../outside', '/absolute', 'C:/absolute', 'assets/../../escape', 'assets\\escape.png', 'assets//bad.png', 'assets/./bad.png', 'assets/%2e%2e/escape', 'assets/a\0.png']) await rejectAtomic(t, zip([cardEntry, { name, bytes: 'x' }]), 'UNSAFE_ARCHIVE');
  await rejectAtomic(t, zip([cardEntry, { name: 'assets/link', bytes: 'target', mode: 0o120777 }]), 'UNSAFE_ARCHIVE');
  await rejectAtomic(t, zip([cardEntry, { name: 'assets/a.png', bytes: png(), flags: 0x801 }]), 'UNSAFE_ARCHIVE');
  await rejectAtomic(t, zip([cardEntry, cardEntry]), 'UNSAFE_ARCHIVE');
  await rejectAtomic(t, zip([{ name: 'readme.txt', bytes: 'empty card' }]), 'INVALID_CHARX');
});
test('raw, expanded, entry-count, depth, ratio and PNG pixel limits are enforced before registration', async t => {
  await rejectAtomic(t, Buffer.alloc(IMPORT_LIMITS.rawBytes + 1), 'IMPORT_LIMIT', 'too-large.json');
  await rejectAtomic(t, zip([cardEntry, { name: 'assets/a', bytes: 'tiny', size: IMPORT_LIMITS.entryBytes + 1 }]), 'IMPORT_LIMIT');
  await rejectAtomic(t, zip([cardEntry, ...Array.from({ length: IMPORT_LIMITS.entries }, (_, i) => ({ name: 'assets/' + i, bytes: 'a' }))]), 'IMPORT_LIMIT');
  await rejectAtomic(t, zip([cardEntry, { name: 'assets/' + 'x/'.repeat(IMPORT_LIMITS.pathDepth) + 'a', bytes: 'a' }]), 'IMPORT_LIMIT');
  await rejectAtomic(t, zip([cardEntry, { name: 'assets/a', bytes: Buffer.alloc(50000), method: 8 }]), 'IMPORT_LIMIT');
  await rejectAtomic(t, png([['chara', v1]], { width: 20000 }), 'IMPORT_LIMIT', 'big.png');
});
test('malformed JSON, invalid critical data, dangerous keys and unrecognized formats reject atomically', async t => {
  await rejectAtomic(t, Buffer.from('{'), 'INVALID_JSON', 'bad.json'); await rejectAtomic(t, Buffer.from('[]'), 'INVALID_CARD', 'bad.json');
  await rejectAtomic(t, Buffer.from('{"name":{"bad":true}}'), 'INVALID_CARD', 'bad.json'); await rejectAtomic(t, Buffer.from('{"spec":"chara_card_v3","data":null}'), 'INVALID_CARD', 'bad.json');
  await rejectAtomic(t, Buffer.from('{"name":"x","extensions":{"__proto__":{"polluted":true}}}'), 'UNSAFE_JSON', 'bad.json');
  await rejectAtomic(t, Buffer.from('unsupported'), 'UNSUPPORTED_FORMAT', 'card.exe');
});
test('card/asset IDs never become trusted filesystem paths; symlinked stores fail closed', async t => {
  const dataDir = await fixture(t); await assert.rejects(readCard(dataDir, '../outside'), { code: 'INVALID_ID' }); await assert.rejects(assetPath(dataDir, '../outside'), { code: 'INVALID_ID' });
  const elsewhere = await fixture(t); await mkdir(join(dataDir, 'cards')); await symlink(elsewhere, join(dataDir, 'assets'));
  await assert.rejects(importCard({ dataDir, filename: 'a.png', bytes: png([['chara', v1]]) }), { code: 'UNSAFE_STORAGE' }); assert.equal((await readdir(elsewhere)).length, 0);
});

test('fixed Risu legacy module decodes metadata, worldbook override and media; scripts remain disabled', async t => {
  const { mappedCharx } = await import('../fixtures/import-fixtures.mjs'); const dataDir = await fixture(t), bytes = mappedCharx();
  const { card, report } = await importCard({ filename: 'mapped.charx', bytes, dataDir });
  assert.equal(card.worldbook.length, 1); assert.deepEqual(card.worldbook[0].keys, ['渡口', '向导']); assert.deepEqual(card.worldbook[0].secondaryKeys, ['夜间']); assert.equal(card.worldbook[0].constant, true); assert.equal(card.worldbook[0].order, 8); assert.ok(card.worldbook[0].content.startsWith('模块版本'));
  assert.equal(card.extensions._import.cardWorldbook[0].content, v2.data.character_book.entries[0].content);
  assert.equal(card.extensions._import.risuModule.unknownModuleValue.keep, 42); assert.equal(card.extensions._import.behaviorPolicy, 'preserved-disabled');
  assert.equal(card.assets.length, 2); assert.equal(card.assets[0].id, card.assets[1].id);
  assert.ok(report.some(r => r.field === 'module.risum' && r.status === 'mapped')); assert.ok(report.some(r => r.field === 'module.risum.trigger' && r.status === 'unsupported')); assert.ok(report.some(r => r.field === 'module.risum.cjs' && r.status === 'unsupported'));
  for (const resource of card.extensions._import.resources) assert.equal(hash(await readFile(join(dataDir, resource.path))), resource.sha256);
});
test('module future versions and truncated resources are preserved with explicit unsupported report', async t => {
  const { risum } = await import('../fixtures/import-fixtures.mjs');
  for (const bytes of [Buffer.from([111, 9, 0, 0, 0, 0]), risum({ name: 'x', assets: [['a', '', 'png']] }, [png()]).subarray(0, -3)]) {
    const dataDir = await fixture(t), { card, report } = await importCard({ filename: 'module.charx', dataDir, bytes: zip([cardEntry, { name: 'module.risum', bytes }]) });
    assert.ok(report.some(r => r.field === 'module.risum' && r.status === 'unsupported')); assert.equal(card.extensions._import.risuModule, undefined);
    assert.deepEqual(await readFile(join(dataDir, card.extensions._import.resources.find(r => r.name === 'module.risum').path)), bytes);
  }
});
test('ZIP corruption, central/local mismatch, unsupported compression, and appended garbage fail closed', async t => {
  const valid = zip([cardEntry]);
  const broken = Buffer.from(valid); broken[40] ^= 1; await rejectAtomic(t, broken, 'INVALID_ARCHIVE');
  const differentSize = Buffer.from(valid); differentSize.writeUInt32LE(1, 22); await rejectAtomic(t, differentSize, 'INVALID_ARCHIVE');
  await rejectAtomic(t, zip([{ ...cardEntry, method: 99 }]), 'UNSUPPORTED_FORMAT');
  await rejectAtomic(t, Buffer.concat([valid, Buffer.from('trailing')]), 'INVALID_ARCHIVE');
});
test('deep JSON, noncanonical base64 and malformed media cannot become registered usable resources', async t => {
  const nested = { name: 'deep' }; let tail = nested; for (let i = 0; i < IMPORT_LIMITS.jsonDepth + 1; i++) tail = tail.child = {};
  await rejectAtomic(t, Buffer.from(JSON.stringify(nested)), 'IMPORT_LIMIT', 'deep.json');
  const dataDir = await fixture(t), { card, report } = await importCard({ filename: 'spoof.charx', dataDir, bytes: zip([cardEntry, { name: 'assets/image.png', bytes: '<html>not an image</html>' }]) });
  assert.equal(card.assets.length, 0); assert.ok(report.some(r => r.field === 'assets/image.png' && r.status === 'blocked'));
});
test('safe audio is byte-sniffed and immutable; asset file mutation and symlinks are rejected', async t => {
  const wav = Buffer.alloc(46); wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40);
  const dataDir = await fixture(t), { card } = await importCard({ filename: 'audio.charx', dataDir, bytes: zip([cardEntry, { name: 'assets/audio.wav', bytes: wav }]) });
  assert.equal(card.assets[0].mime, 'audio/wav'); const asset = await assetPath(dataDir, card.assets[0].id); assert.equal(asset.mime, 'audio/wav');
  await writeFile(asset.path, 'changed'); await assert.rejects(assetPath(dataDir, card.assets[0].id), { code: 'CORRUPT_STORAGE' });
  await rm(asset.path); const elsewhere = join(await fixture(t), 'external'); await writeFile(elsewhere, wav); await symlink(elsewhere, asset.path); await assert.rejects(assetPath(dataDir, card.assets[0].id), { code: 'UNSAFE_STORAGE' });
});

test('module resource names never overwrite same-named archive resources; every preserved hash remains readable', async t => {
  const { risum } = await import('../fixtures/import-fixtures.mjs'); const module = risum({ name: 'x', assets: [['lamp', '', 'png']] }, [png()]);
  const dataDir = await fixture(t), { card } = await importCard({ filename: 'collision.charx', dataDir, bytes: zip([cardEntry, { name: 'module.risum', bytes: module }, { name: 'module-assets/0/lamp.png', bytes: 'different unknown bytes' }]) });
  assert.equal(card.extensions._import.resources.filter(r => r.name === 'module-assets/0/lamp.png').length, 2);
  for (const resource of card.extensions._import.resources) assert.equal(hash(await readFile(join(dataDir, resource.path))), resource.sha256);
});
test('advanced lorebook activation and old variable templates are preserved but explicitly disabled', async t => {
  const source = structuredClone(v2); source.data.character_book.entries[0].use_regex = true; source.data.extensions.risuai = { defaultVariables: 'trust=7' };
  const dataDir = await fixture(t), { card, report } = await importCard({ filename: 'old.json', dataDir, bytes: Buffer.from(JSON.stringify(source)) });
  assert.equal(card.worldbook[0].enabled, false); assert.equal(card.worldbook[0].raw.use_regex, true); assert.ok(report.some(r => r.field === 'extensions.risuai.defaultVariables' && r.status === 'unsupported'));
});

test('storage publication failure removes staging without registering a partial card or harming prior imports', async t => {
  const dataDir = await fixture(t); const first = await importCard({ dataDir, filename: 'first.json', bytes: Buffer.from(JSON.stringify(v1)) });
  const preview = png(), id = hash(preview); await writeFile(join(dataDir, 'assets', id), 'preexisting corruption');
  await assert.rejects(importCard({ dataDir, filename: 'second.png', bytes: png([['chara', v2]]) }), { code: 'CORRUPT_STORAGE' });
  assert.deepEqual((await listCards(dataDir)).map(c => c.id), [first.card.id]); assert.ok((await readdir(join(dataDir, 'cards'))).every(name => !name.startsWith('.staging-')));
  assert.deepEqual(await readFile(join(dataDir, first.card.original.path)), Buffer.from(JSON.stringify(v1)));
});
test('noncanonical base64 and PNG declared pixel rows with inconsistent data reject', async t => {
  const { chunk } = await import('../fixtures/import-fixtures.mjs'); const image = png();
  const invalidMetadata = Buffer.concat([image.subarray(0, 33), chunk('tEXt', Buffer.from('chara\0@@@')), image.subarray(33)]);
  await rejectAtomic(t, invalidMetadata, 'INVALID_PNG', 'bad.png');
  await rejectAtomic(t, png([['chara', v1]], { width: 2 }), 'INVALID_PNG', 'bad.png');
});
