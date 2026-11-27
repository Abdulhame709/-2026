import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MatchingService } from '../dist/application/matching.service.js';
import { validateOcrImage } from '../dist/application/ocr.service.js';
import { parseStatementFile } from '../dist/infrastructure/parsing/statementParser.js';

const template = {
  headerRows: 1,
  columnsMapping: { date: 'A', ref: 'B', description: 'C', debit: 'D', credit: 'E' },
  dateFormats: ['YYYY-MM-DD'],
  decimalSep: '.',
  thousandSep: ',',
};

function matchingFixture(theirAmount) {
  const our = [{ id: 1, signed: -100.0001, ourRef: 'INV-42', theirRef: null, extractedRefs: [], entryDate: '2026-01-01' }];
  const their = [{ id: 2, signed: theirAmount, ourRef: null, theirRef: 'INV-42', extractedRefs: [], entryDate: '2026-01-01' }];
  const saved = [];
  const matches = {
    sessionLines: async () => ({ our, their }),
    rejectedPairKeys: async () => new Set(),
    deleteActiveSuggested: async () => {},
    consumedMap: async () => new Map(),
    createGroups: async (_sessionId, _actorId, groups) => { saved.push(...groups); return groups.map((_, index) => index + 1); },
  };
  const service = new MatchingService(
    { getById: async () => ({ accountId: 1, ourStatementId: 1, theirStatementId: 2, status: 'open' }) },
    { getById: async () => ({ currencyCode: 'USD', ruleOrder: [] }) },
    { listByAccount: async () => [] },
    matches,
    { write: async () => {} },
  );
  return { service, saved };
}

test('four-decimal amounts that round to the same cents are not auto-confirmed', async () => {
  const { service, saved } = matchingFixture(100.0002);
  assert.deepEqual(await service.suggest(1, 1, null, 'auto'), { suggested: 0, autoConfirmed: 0 });
  assert.equal(saved.length, 0);
  await assert.rejects(
    service.manualGroup(1, 1, [{ lineId: 1, allocated: null }, { lineId: 2, allocated: null }], null, null),
    { code: 'VALIDATION_FAILED' },
  );
});

test('identical four-decimal amounts may be auto-confirmed', async () => {
  const { service, saved } = matchingFixture(100.0001);
  assert.deepEqual(await service.suggest(1, 1, null, 'auto'), { suggested: 0, autoConfirmed: 1 });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, 'confirmed');
});

test('statement upload rejects mismatched and binary file signatures', () => {
  assert.throws(() => parseStatementFile(Buffer.from('%PDF-1.7'), 'statement.xlsx', template), { code: 'VALIDATION_FAILED' });
  assert.throws(() => parseStatementFile(Buffer.from([0, 1, 2]), 'statement.csv', template), { code: 'VALIDATION_FAILED' });
  assert.equal(
    parseStatementFile(Buffer.from('date,ref,description,debit,credit\n2026-01-01,INV-42,Invoice,100.0001,\n'), 'statement.csv', template).lines.length,
    1,
  );
  const sample = readFileSync(new URL('../../docs/samples/sample-ours-statement.xlsx', import.meta.url));
  assert.ok(parseStatementFile(sample, 'sample-ours-statement.xlsx', template).lines.length > 0);
});

test('OCR rejects image extensions with mismatched signatures and oversized pixel counts', () => {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12);
  png.writeUInt32BE(4000, 16);
  png.writeUInt32BE(4000, 20);
  assert.throws(() => validateOcrImage(png, 'jpeg'), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateOcrImage(png, 'png'), { code: 'VALIDATION_FAILED' });
  png.writeUInt32BE(1000, 16);
  png.writeUInt32BE(1000, 20);
  assert.doesNotThrow(() => validateOcrImage(png, 'png'));
});
