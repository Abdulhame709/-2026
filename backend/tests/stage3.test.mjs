import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MatchingService } from '../dist/application/matching.service.js';
import { SessionService, computeProgress } from '../dist/application/sessions.service.js';
import { DiscrepancyService } from '../dist/application/discrepancy.service.js';
import { validateOcrImage } from '../dist/application/ocr.service.js';
import { parseStatementFile } from '../dist/infrastructure/parsing/statementParser.js';

const template = {
  headerRows: 1,
  columnsMapping: { date: 'A', ref: 'B', description: 'C', debit: 'D', credit: 'E' },
  dateFormats: ['YYYY-MM-DD'],
  decimalSep: '.',
  thousandSep: ',',
};

function matchingFixture(theirAmount, options = {}) {
  const our = options.our ?? [{ id: 1, signed: -100.0001, ourRef: 'INV-42', theirRef: null, extractedRefs: [], entryDate: '2026-01-01' }];
  const their = options.their ?? [{ id: 2, signed: theirAmount, ourRef: null, theirRef: 'INV-42', extractedRefs: [], entryDate: '2026-01-01' }];
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
    { getById: async () => ({ currencyCode: 'USD', ruleOrder: options.ruleOrder ?? [] }) },
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

test('the same line cannot be allocated twice beyond its amount', async () => {
  const { service } = matchingFixture(100);
  // كل عنصر على حدة (60) لا يتجاوز البند (100)، لكن مجموعهما 120 — يجب الرفض.
  await assert.rejects(
    service.manualGroup(1, 1, [
      { lineId: 1, allocated: -60 },
      { lineId: 1, allocated: -60 },
      { lineId: 2, allocated: 60 },
      { lineId: 2, allocated: 60 },
    ], null, null),
    { code: 'VALIDATION_FAILED' },
  );
});

test('greedy payment split runs only when amount_date is enabled', async () => {
  const our = [{ id: 1, signed: -50, ourRef: null, theirRef: null, extractedRefs: [], entryDate: '2026-01-01' }];
  const their = [
    { id: 2, signed: 30, ourRef: null, theirRef: null, extractedRefs: [], entryDate: '2026-01-02' },
    { id: 3, signed: 20, ourRef: null, theirRef: null, extractedRefs: [], entryDate: '2026-01-03' },
  ];
  const disabled = matchingFixture(0, { our, their, ruleOrder: ['exact_ref'] });
  assert.deepEqual(await disabled.service.suggest(1, 1, null, 'review'), { suggested: 0, autoConfirmed: 0 });

  const enabled = matchingFixture(0, { our, their, ruleOrder: ['amount_date'] });
  assert.deepEqual(await enabled.service.suggest(1, 1, null, 'review'), { suggested: 1, autoConfirmed: 0 });
  assert.equal(enabled.saved[0].items.length, 3);
});

function sessionFixture(options = {}) {
  const savedOpenings = [];
  const closed = [];
  const regenerated = [];
  const src = {
    id: 7, accountId: 1, status: 'closed', periodLabel: '2026-05',
  };
  const session = {
    id: 8, accountId: 1, status: 'open', periodLabel: '2026-06',
    openingOurs: null, openingTheirs: null, carriedFromSessionId: null,
  };
  const sessions = {
    findOpenByAccountPeriod: async () => null,
    getById: async (id) => (id === 7 ? src : options.session ?? session),
    closingsOfSession: async () => ({ hasLines: true, closingOurs: 1234.5678, closingTheirs: -987.6543 }),
    create: async (input) => { savedOpenings.push(input); return { ...session, ...input }; },
    close: async (id, summary) => { closed.push({ id, summary }); },
    periodLabelOf: async () => '2026-05',
  };
  const matches = {
    sessionLines: async () => options.lines ?? { our: [], their: [] },
    consumedMap: async () => new Map(options.consumed ?? []),
    groups: async () => [],
  };
  const service = new SessionService(
    { query: async () => ({ rows: [] }) },
    sessions,
    { getById: async () => ({ id: 1, isActive: true, currencyCode: 'YER' }) },
    matches,
    { write: async () => {} },
    { regenerateForClose: async (id, rows) => { regenerated.push({ id, rows }); } },
  );
  return { service, savedOpenings, closed, regenerated };
}

test('carry-over fills openings from the closed session instead of storing null', async () => {
  const { service, savedOpenings } = sessionFixture();
  await service.create(1, { accountId: 1, periodLabel: '2026-06', carriedFromSessionId: 7 }, null);
  assert.equal(savedOpenings[0].openingOurs, 1234.5678);
  assert.equal(savedOpenings[0].openingTheirs, -987.6543);
  assert.equal(savedOpenings[0].openingAdjustReason, null);
  assert.equal(savedOpenings[0].carriedFromSessionId, 7);
});

test('manual change to a carried opening still requires a written reason', async () => {
  const { service, savedOpenings } = sessionFixture();
  await assert.rejects(
    service.create(1, { accountId: 1, periodLabel: '2026-06', carriedFromSessionId: 7, openingBalance: 1300 }, null),
    { code: 'VALIDATION_FAILED' },
  );
  assert.equal(savedOpenings.length, 0);

  await service.create(1, {
    accountId: 1, periodLabel: '2026-06', carriedFromSessionId: 7, openingBalance: 1300, openingAdjustReason: 'تصحيح رصيد المورد',
  }, null);
  assert.equal(savedOpenings[0].openingOurs, 1300);
  assert.equal(savedOpenings[0].openingTheirs, -987.6543);
  assert.equal(savedOpenings[0].openingAdjustReason, 'تصحيح رصيد المورد');
});

test('a sub-cent residual is reported at close instead of being hidden', async () => {
  const our = [{ id: 1, signed: -100, ourRef: null, theirRef: null, extractedRefs: [], entryDate: '2026-01-01' }];
  const their = [{ id: 2, signed: 100, ourRef: null, theirRef: null, extractedRefs: [], entryDate: '2026-01-02' }];
  const { service, regenerated } = sessionFixture({
    lines: { our, their },
    // بقي 0.001 من بندنا غير مطابق (أقل من نصف سنت) — يجب أن يظهر في فروق الإغلاق
    consumed: [[1, 99.999], [2, 100]],
  });
  const summary = await service.close(1, 8, null);
  assert.equal(summary.discrepancies.length, 1);
  assert.ok(Math.abs(summary.discrepancies[0].amount - 0.001) < 1e-9);
  assert.equal(regenerated[0].rows.length, 1);
});

function discrepancyFixture(row = {}) {
  const base = {
    id: 5, sessionId: 3, accountId: 1, status: 'new', resolutionNote: null, carriedToSessionId: null,
    ...row,
  };
  const saved = [];
  let current = { ...base };
  const discrepancies = {
    getFull: async (id) => (id === base.id ? { ...current } : null),
    update: async (id, patch) => { saved.push(patch); current = { ...current, ...patch }; return true; },
    setCarried: async () => true,
  };
  const service = new DiscrepancyService(
    discrepancies,
    { getById: async () => ({ id: 4, accountId: 1, status: 'open' }) },
    { write: async () => {} },
    { listReasonCodes: async () => [] },
  );
  return { service, saved };
}

test('closing a discrepancy needs a written resolution note, server-side', async () => {
  const { service, saved } = discrepancyFixture();
  await assert.rejects(service.update(1, 5, { status: 'resolved' }, null), { code: 'VALIDATION_FAILED' });
  await assert.rejects(service.update(1, 5, { status: 'resolved', resolutionNote: 'تم ' }, null), { code: 'VALIDATION_FAILED' });
  assert.equal(saved.length, 0);

  const row = await service.update(1, 5, { status: 'resolved', resolutionNote: 'سُدد الفرق نقداً' }, null);
  assert.equal(row.status, 'resolved');
  assert.equal(saved.length, 1);
});

test('a discrepancy cannot be carried to its own or the same target session twice', async () => {
  const { service } = discrepancyFixture();
  await assert.rejects(service.carry(1, 5, 3, null), { code: 'VALIDATION_FAILED' });

  const already = discrepancyFixture({ carriedToSessionId: 4 });
  await assert.rejects(already.service.carry(1, 5, 4, null), { code: 'VALIDATION_FAILED' });
  assert.deepEqual(await service.carry(1, 5, 4, null), { id: 5, carriedToSessionId: 4 });
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
