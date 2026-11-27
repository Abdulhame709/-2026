import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import { createCanvas } from '@napi-rs/canvas';
import * as XLSX from 'xlsx';
import { OcrService, normalizeConfidence, parseOcrLines } from '../dist/application/ocr.service.js';
import { StatementService } from '../dist/application/statement.service.js';
import { parseAmount, parseDate, parseStatementFile } from '../dist/infrastructure/parsing/statementParser.js';
import { detectColumnMapping } from '../dist/infrastructure/parsing/columnMapping.js';

test('Excel and CSV accept Arabic numerals but reject impossible calendar dates', () => {
  assert.equal(parseAmount('١٬٢٣٤٫٥٠', '.', ','), 1234.5);
  assert.equal(parseAmount('۱٬۲۳۴٫۵۰', '.', ','), 1234.5);
  assert.equal(parseDate('٢٩/٠٢/٢٠٢٤', ['DD/MM/YYYY']), '2024-02-29');
  assert.equal(parseDate('٣١/٠٢/٢٠٢٦', ['DD/MM/YYYY']), null);
  assert.equal(parseDate('29/02/2025', ['DD/MM/YYYY']), null);
  const template = {
    headerRows: 1,
    columnsMapping: { date: 'A', ref: 'B', description: 'C', debit: 'D', credit: 'E' },
    dateFormats: ['DD/MM/YYYY'], decimalSep: '.', thousandSep: ',',
  };
  const csv = Buffer.from('date,ref,description,debit,credit\n٢٩/٠٢/٢٠٢٤,INV-4,Office,١٬٢٣٤٫٥٠,\n');
  assert.equal(parseStatementFile(csv, 'statement.csv', template).lines[0].debitRaw, '١٬٢٣٤٫٥٠');
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv.toString('utf8'), 'utf16le')]);
  assert.equal(parseStatementFile(utf16, 'statement.csv', template).lines[0].debitRaw, '١٬٢٣٤٫٥٠');
  assert.throws(() => parseStatementFile(Buffer.from([0xff, 0x80, 0x81]), 'statement.csv', template), { code: 'VALIDATION_FAILED' });
});

test('OCR reads Arabic-Indic amounts and records normalized confidence', () => {
  const confidence = normalizeConfidence(83);
  assert.equal(confidence, 0.83);
  const parsed = parseOcrLines(['٢٠٢٦-٠٢-٠١ | فاتورة مستلزمات المكتب | ١٬٢٣٤٫٥٠ | ٠'], confidence);
  assert.equal(parsed.lines.length, 1);
  assert.equal(parsed.lines[0].dateRaw, '2026-02-01');
  assert.equal(parsed.lines[0].debitRaw, '1234.5');
  assert.equal(parsed.lines[0].ocrConfidence, 0.83);
  assert.equal(parseOcrLines(['2026-02-01 Invoice balance رصيد مستحق 100.00 0.00'], null).lines.length, 1);
});

test('Excel selects the only transaction sheet and rejects ambiguous multi-sheet workbooks', () => {
  const template = {
    headerRows: 1,
    columnsMapping: { date: 'A', description: 'B', debit: 'C', credit: 'D' },
    dateFormats: ['YYYY-MM-DD'], decimalSep: '.', thousandSep: ',',
  };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Cover'], ['Report title']]), 'Cover');
  const transactions = [['Date', 'Description', 'Debit', 'Credit'], ['2026-01-01', 'Invoice', '100.00', '']];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(transactions), 'Ledger');
  const read = () => parseStatementFile(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }), 'report.xlsx', template);
  assert.equal(read().sheetName, 'Ledger');
  assert.equal(read().lines.length, 1);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(transactions), 'SecondLedger');
  assert.throws(read, { code: 'VALIDATION_FAILED' });
});

test('manual import keeps amounts and reconciliation session without OCR provenance', async () => {
  let saved;
  const service = new StatementService(
    { getById: async () => ({ currencyCode: 'USD' }) },
    {},
    { createWithLines: async (input) => { saved = input; return 42; } },
    { write: async () => {} },
    { getById: async () => ({ ourStatementId: 42, theirStatementId: 40 }) },
  );
  const result = await service.manual(1, {
    accountId: 4, side: 'ours', sessionId: 7,
    lines: [
      { entryDate: '2026-02-01', description: 'Invoice', debit: 1234.5 },
      { entryDate: '2026-02-02', description: 'Payment', credit: 100.0001 },
    ],
  }, null);
  assert.equal(saved.sessionId, 7);
  assert.equal(saved.ocrApplied, undefined);
  assert.equal(saved.lines[0].ocrConfidence, undefined);
  assert.deepEqual([result.totalDebit, result.totalCredit, result.bothAttached], [1234.5, 100.0001, true]);
});

test('OCR preview archives its source and validates owner, count and four-decimal balance', async () => {
  const uploadDir = await mkdtemp(join(tmpdir(), 'reconciliation-ocr-preview-'));
  let saved;
  const service = new StatementService(
    { getById: async () => ({ currencyCode: 'USD', isActive: true }) },
    { getById: async () => null },
    { createWithLines: async (input) => { saved = input; return 42; } },
    { write: async () => {} },
    { getById: async () => ({ accountId: 4, status: 'in_progress', ourStatementId: saved ? 42 : null, theirStatementId: 40 }) },
    uploadDir,
  );
  try {
    const buffer = Buffer.from('%PDF-1.7 synthetic source');
    const token = await service.uploadOcr(1,
      { buffer, originalname: 'statement.pdf', mimetype: 'application/pdf', size: buffer.length },
      { accountId: 4, side: 'ours' },
      { pages: 1, mode: 'ocr', opening: 10, lines: [{ lineNo: 1, dateRaw: '2026-02-01', description: 'Invoice', ref: 'INV-42', debitRaw: '100', creditRaw: '', ocrConfidence: 0.83 }] },
    );
    assert.throws(() => service.updateLine(2, token, 1, { debitRaw: '1' }), { code: 'FORBIDDEN' });
    await assert.rejects(service.commit(2, token, {}, null), { code: 'FORBIDDEN' });
    service.updateLine(1, token, 1, { debitRaw: '100.0001' });
    await assert.rejects(service.commit(1, token, { sessionId: 7, openingBalance: 20, announcedClosing: -80, announcedCount: 1 }, null), { code: 'VALIDATION_FAILED' });
    await assert.rejects(service.commit(1, token, { sessionId: 7, openingBalance: 20, announcedClosing: -80.0001, announcedCount: 2 }, null), { code: 'VALIDATION_FAILED' });
    const result = await service.commit(1, token, { sessionId: 7, openingBalance: 20, announcedClosing: -80.0001, announcedCount: 1 }, null);
    assert.equal(result.bothAttached, true);
    assert.equal(result.totalDebit, 100.0001);
    assert.equal(saved.sourceFile.originalName, 'statement.pdf');
    assert.ok((await readFile(saved.sourceFile.storedPath)).equals(buffer));
    assert.equal(saved.openingBalance, 20);
    assert.equal(saved.closingBalance, -80.0001);
    assert.equal(saved.ocrApplied, true);
    assert.equal(saved.lines[0].ocrConfidence, 0.83);
    assert.equal(saved.lines[0].needsReview, true);
    assert.throws(() => service.updateLine(1, token, 1, { debitRaw: '1' }), { code: 'PREVIEW_EXPIRED' });
  } finally {
    if (dirname(resolve(uploadDir)) !== resolve(tmpdir())) throw new Error('Unsafe test cleanup path');
    await rm(uploadDir, { recursive: true, force: true });
  }
});

async function makePdf(pages) {
  const document = new PDFDocument({ compress: false });
  const chunks = [];
  const ready = new Promise((resolve, reject) => {
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', resolve);
    document.on('error', reject);
  });
  pages.forEach((text, index) => {
    if (index) document.addPage();
    document.text(text);
  });
  document.end();
  await ready;
  return Buffer.concat(chunks);
}

test('text PDFs keep unique row numbers across pages', { timeout: 60000 }, async () => {
  const data = await makePdf([
    '2026-02-01 Invoice for wholesale office supplies 100.00 0.00',
    '2026-02-02 Payment for wholesale office supplies 0.00 100.00',
  ]);
  const draft = await new OcrService().extractPdf(data);
  assert.equal(draft.mode, 'text');
  assert.deepEqual(draft.lines.map((line) => line.lineNo), [1, 2]);
});

test('PDF refuses a page with no readable transactions rather than returning a partial draft', { timeout: 60000 }, async () => {
  const data = await makePdf([
    '2026-02-01 Invoice for wholesale office supplies 100.00 0.00',
    'Statement summary and explanatory cover notes without any transaction rows',
  ]);
  const service = new OcrService();
  try {
    await assert.rejects(service.extractPdf(data), (error) =>
      error.code === 'VALIDATION_FAILED' && error.details.some((detail) => detail.messageAr.includes('2')));
  } finally {
    await service.close();
  }
});

test('a real image OCR run reads dates, amounts and confidence locally', { timeout: 60000 }, async () => {
  const canvas = createCanvas(1800, 280);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'black';
  context.font = '48px Arial';
  context.fillText('2026-02-01 Invoice for office supplies 100.00 0.00', 30, 150);
  const service = new OcrService();
  try {
    const draft = await service.extractImage(canvas.toBuffer('image/png'), 'png');
    assert.equal(draft.mode, 'ocr');
    assert.equal(draft.lines[0].dateRaw, '2026-02-01');
    assert.equal(draft.lines[0].debitRaw, '100');
    assert.ok(draft.lines[0].ocrConfidence > 0 && draft.lines[0].ocrConfidence <= 1);
  } finally {
    await service.close();
  }
});

test('inspection detects a seven-column Arabic header instead of assuming columns A–E', async () => {
  const service = new StatementService({ getById: async () => ({ currencyCode: 'YER', isActive: true }) }, {}, {}, {}, {});
  const csv = Buffer.from(
    'التاريخ,نوع المستند,رقم المستند,البيان,المرجع,مدين,دائن,العملة\n'
    + '2026-03-06,فاتورة,INV-1,فاتورة مشتريات,INV-1,1465,,YER\n'
    + '2026-03-07,سداد,PAY-1,سداد جزء,PAY-1,,465,YER\n',
  );
  const inspection = await service.inspect({ buffer: csv, originalname: 'statement.csv' });
  assert.equal(inspection.headerRows, 1);
  assert.deepEqual(inspection.mapping, {
    date: 'A', docType: 'B', docNo: 'C', description: 'D', ref: 'E', debit: 'F', credit: 'G', currency: 'H',
  });
  assert.ok(inspection.warnings.some((warning) => warning.includes('العملة')));

  const parsed = parseStatementFile(csv, 'statement.csv', {
    headerRows: inspection.headerRows,
    columnsMapping: inspection.mapping,
    dateFormats: ['YYYY-MM-DD'],
    decimalSep: inspection.decimalSep,
    thousandSep: inspection.thousandSep,
  }, 'theirs');
  assert.equal(parsed.lines.length, 2);
  assert.deepEqual([parsed.lines[0].debitRaw, parsed.lines[0].creditRaw], ['1465', '']);
  assert.deepEqual([parsed.lines[1].debitRaw, parsed.lines[1].creditRaw], ['', '465']);
});

test('a single signed amount column infers debit and credit from the statement side', () => {
  const rows = [
    ['التاريخ', 'البيان', 'المبلغ'],
    ['2026-03-01', 'فاتورة', '1500'],
    ['2026-03-02', 'سداد', '-500'],
  ];
  const detection = detectColumnMapping(rows);
  assert.deepEqual(detection.mapping, { date: 'A', description: 'B', amount: 'C' });
  assert.equal(detection.headerRows, 1);
  const csv = Buffer.from(rows.map((row) => row.join(',')).join('\n'));
  const template = {
    headerRows: detection.headerRows,
    columnsMapping: detection.mapping,
    dateFormats: ['YYYY-MM-DD'],
    decimalSep: '.',
    thousandSep: ',',
  };
  const ours = parseStatementFile(csv, 'ours.csv', template, 'ours');
  assert.deepEqual(ours.lines.map((line) => [line.debitRaw, line.creditRaw]), [['', '1500'], ['500', '']]);
  const theirs = parseStatementFile(csv, 'theirs.csv', template, 'theirs');
  assert.deepEqual(theirs.lines.map((line) => [line.debitRaw, line.creditRaw]), [['1500', ''], ['', '500']]);
});

test('commit reads the analysis separators stored with the preview, not template defaults', async () => {
  const uploadDir = await mkdtemp(join(tmpdir(), 'reconciliation-mapping-preview-'));
  let saved;
  const service = new StatementService(
    { getById: async () => ({ currencyCode: 'YER', isActive: true }) },
    { getById: async () => null },
    { createWithLines: async (input) => { saved = input; return 51; } },
    { write: async () => {} },
    {},
    uploadDir,
  );
  try {
    const csv = Buffer.from(
      'التاريخ,البيان,مدين,دائن\n'
      + '2026-03-01,فاتورة,"1.234,50",\n',
    );
    const upload = await service.upload(1, {
      buffer: csv, originalname: 'statement.csv', mimetype: 'text/csv', size: csv.length,
    }, {
      accountId: 4,
      side: 'theirs',
      templateId: null,
      mapping: { date: 'A', description: 'B', debit: 'C', credit: 'D' },
      headerRows: 1,
      decimalSep: ',',
      thousandSep: '.',
    });
    assert.equal(upload.lineCount, 1);
    const result = await service.commit(1, upload.token, { openingBalance: 0, announcedClosing: 1234.5 }, null);
    assert.equal(result.totalDebit, 1234.5);
    assert.equal(result.totalCredit, 0);
    assert.equal(saved.lines[0].debit, 1234.5);
  } finally {
    if (dirname(resolve(uploadDir)) !== resolve(tmpdir())) throw new Error('Unsafe test cleanup path');
    await rm(uploadDir, { recursive: true, force: true });
  }
});
