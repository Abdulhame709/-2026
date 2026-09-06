import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ERR } from '../domain/errors.js';
import type { AccountsRepository } from '../infrastructure/repositories/partners.repository.js';
import type { SessionsRepository } from '../infrastructure/repositories/reconciliation-sessions.repository.js';
import type { TemplatesRepository } from '../infrastructure/repositories/templates.repository.js';
import type { StatementsRepository, StatementLineInput } from '../infrastructure/repositories/statements.repository.js';
import type { AuditRepository } from '../infrastructure/repositories/audit.repository.js';
import { parseAmount, parseDate, parseStatementFile } from '../infrastructure/parsing/statementParser.js';
import type { RawLine } from '../infrastructure/parsing/statementParser.js';
import {
  dropPreview,
  getPreview,
  putPreview,
  updatePreviewLine,
} from '../infrastructure/parsing/previewStore.js';

/**
 * خدمة الاستيراد والكشوفات (Module 3):
 * upload=معاينة بالذاكرة (لا قاعدة) → تصحيح بنود → commit=معاملة كتابة واحدة.
 * محقق القبول عند الاعتماد (Q11 صرامة كاملة): كل بند بتاريخ صالح،
 * لا مدين ودائن معاً، والمبالغ أرقاماً — وإلا 422 بتفاصيل لكل بند.
 */

const UPLOAD_DIR = path.resolve('storage/uploads');

interface ResolvedTemplate {
  id: number | null;
  headerRows: number;
  columnsMapping: Record<string, string>;
  dateFormats: string[];
  decimalSep: string;
  thousandSep: string;
}

const AUTO_TEMPLATE: ResolvedTemplate = {
  id: null,
  headerRows: 1,
  columnsMapping: { date: 'A', ref: 'B', description: 'C', debit: 'D', credit: 'E' },
  dateFormats: ['YYYY-MM-DD', 'DD/MM/YYYY'],
  decimalSep: '.',
  thousandSep: ',',
};

export class StatementService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly templates: TemplatesRepository,
    private readonly statements: StatementsRepository,
    private readonly audit: AuditRepository,
    private readonly sessions: SessionsRepository,
  ) {}

  private async resolveTemplate(
    accountId: number,
    side: 'ours' | 'theirs',
    templateId: number | null,
  ): Promise<ResolvedTemplate> {
    if (templateId) {
      const t = await this.templates.getById(templateId);
      if (!t) throw ERR.VALIDATION([{ field: 'templateId', messageAr: 'القالب غير موجود' }]);
      if (t.accountId !== null && t.accountId !== accountId) {
        throw ERR.VALIDATION([{ field: 'templateId', messageAr: 'القالب لا يخص حساب هذا المورد' }]);
      }
      if (t.templateKind !== side) {
        throw ERR.VALIDATION([{ field: 'templateId', messageAr: `القالب من نوع ${t.templateKind === 'ours' ? 'كشوفنا' : 'كشوفهم'} لا يصلح لهذه الجهة` }]);
      }
      return {
        id: t.id,
        headerRows: t.headerRows,
        columnsMapping: t.columnsMapping,
        dateFormats: t.dateFormats,
        decimalSep: t.decimalSep,
        thousandSep: t.thousandSep,
      };
    }
    // بلا قالب: الافتراضي للحساب/النوع، وإلا القالب التلقائي A–E
    const list = side === 'ours' ? await this.templates.listOurs() : await this.templates.listForAccount(accountId);
    const def = list.find((t) => t.isDefault) ?? list[0];
    if (!def) return AUTO_TEMPLATE;
    return {
      id: def.id,
      headerRows: def.headerRows,
      columnsMapping: def.columnsMapping,
      dateFormats: def.dateFormats,
      decimalSep: def.decimalSep,
      thousandSep: def.thousandSep,
    };
  }

  async upload(
    actorId: number,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    input: { accountId: number; side: 'ours' | 'theirs'; templateId: number | null },
  ): Promise<Record<string, unknown>> {
    const account = await this.accounts.getById(input.accountId);
    if (!account) throw ERR.PARTNER_NOT_FOUND();
    if (!account.isActive) throw ERR.VALIDATION([{ field: 'accountId', messageAr: 'حساب المورد معطل — فعّله أولاً' }]);

    const template = await this.resolveTemplate(input.accountId, input.side, input.templateId);
    const parsed = parseStatementFile(file.buffer, file.originalname, template);

    // حفظ الملف فوراً — الاعتماد يسجل source_file (الإلغاء يترك ملفاً يتيمًا مقبول)
    await mkdir(UPLOAD_DIR, { recursive: true });
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const storedName = `${Date.now()}-${sha256.slice(0, 12)}-${file.originalname.replace(/[^\w.\-]/g, '_')}`;
    const storedPath = path.join(UPLOAD_DIR, storedName);
    await writeFile(storedPath, file.buffer);

    const token = putPreview({
      accountId: input.accountId,
      currencyCode: account.currencyCode,
      side: input.side,
      templateId: template.id,
      fileName: storedName,
      originalName: file.originalname,
      storedPath,
      sha256,
      mimeType: file.mimetype || null,
      sizeBytes: file.size,
      lines: parsed.lines,
      openingHint: parsed.opening,
      createdBy: actorId,
    });

    return {
      token,
      lines: parsed.lines,
      opening: parsed.opening,
      closingHint: parsed.closingHint,
      templateId: template.id,
      lineCount: parsed.lines.length,
    };
  }

  updateLine(token: string, lineNo: number, patch: Record<string, unknown>): RawLine {
    const allowed: Record<string, string> = {
      dateRaw: 'dateRaw',
      description: 'description',
      debitRaw: 'debitRaw',
      creditRaw: 'creditRaw',
      ref: 'ref',
      docType: 'docType',
      docNo: 'docNo',
    };
    const safe: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (allowed[k]) safe[allowed[k]] = String(v ?? '');
    }
    return updatePreviewLine(token, lineNo, safe);
  }

  /** تحويل بنود المعاينة لصفوف نهائية — يجمّع أخطاء كل بند (لا بند ناقص يمر بصمت) */
  private materializeLines(side: 'ours' | 'theirs', rawLines: RawLine[], dateFormats: string[], decimalSep: string, thousandSep: string): { lines: StatementLineInput[]; errors: Array<{ field: string; messageAr: string }> } {
    const lines: StatementLineInput[] = [];
    const errors: Array<{ field: string; messageAr: string }> = [];
    for (const raw of rawLines) {
      const date = parseDate(raw.dateRaw, dateFormats);
      const debit = parseAmount(raw.debitRaw, decimalSep, thousandSep);
      const credit = parseAmount(raw.creditRaw, decimalSep, thousandSep);
      const label = `line:${raw.lineNo}`;

      if (!date) errors.push({ field: label, messageAr: `البند ${raw.lineNo}: تاريخ غير صالح «${raw.dateRaw || 'فارغ'}»` });
      if (!raw.description) errors.push({ field: label, messageAr: `البند ${raw.lineNo}: البيان فارغ` });
      if (debit === null && credit === null) {
        errors.push({ field: label, messageAr: `البند ${raw.lineNo}: لا مدين ولا دائن — أدخل أحدهما` });
      }
      if (debit !== null && credit !== null) {
        errors.push({ field: label, messageAr: `البند ${raw.lineNo}: مدين ودائن معاً ممنوع — البند إما مدين أو دائن` });
      }
      if (debit !== null && debit < 0) errors.push({ field: label, messageAr: `البند ${raw.lineNo}: المدين لا يكون سالباً` });
      if (credit !== null && credit < 0) errors.push({ field: label, messageAr: `البند ${raw.lineNo}: الدائن لا يكون سالباً` });

      lines.push({
        lineNo: raw.lineNo,
        entryDate: date ?? '',
        description: raw.description,
        ourRef: side === 'ours' ? raw.ref || null : null,
        theirRef: side === 'theirs' ? raw.ref || raw.docNo || null : null,
        debit,
        credit,
      });
    }
    return { lines, errors };
  }

  async commit(
    actorId: number,
    token: string,
    body: { openingBalance?: number | null; announcedClosing?: number | null; announcedCount?: number | null; sessionId?: number | null },
    ip: string | null,
  ): Promise<{ statementId: number; lineCount: number; totalDebit: number; totalCredit: number; sessionId?: number; bothAttached?: boolean }> {
    const preview = getPreview(token);

    // ربط الجلسة (Module 4): تحقق مسبق برسائل واضحة — الحسم داخل معاملة الاعتماد
    if (body.sessionId) {
      const session = await this.sessions.getById(body.sessionId);
      if (!session) throw ERR.VALIDATION([{ field: 'sessionId', messageAr: 'الجلسة غير موجودة' }]);
      if (session.status === 'closed') throw ERR.VALIDATION([{ field: 'sessionId', messageAr: 'الجلسة مغلقة — لا تقبل كشوفات' }]);
      if (session.accountId !== preview.accountId) throw ERR.VALIDATION([{ field: 'sessionId', messageAr: 'جلسة الحساب لا تطابق حساب الملف المرفوع' }]);
      const slot = preview.side === 'ours' ? session.ourStatementId : session.theirStatementId;
      if (slot) throw ERR.VALIDATION([{ field: 'sessionId', messageAr: `جلسة #${body.sessionId} لديها ${preview.side === 'ours' ? 'كشفنا' : 'كشف المورد'} مسبقاً` }]);
    }
    const template = preview.templateId
      ? await this.templates.getById(preview.templateId)
      : null;
    const dateFormats = template?.dateFormats ?? AUTO_TEMPLATE.dateFormats;
    const decimalSep = template?.decimalSep ?? '.';
    const thousandSep = template?.thousandSep ?? ',';

    const { lines, errors } = this.materializeLines(preview.side, preview.lines, dateFormats, decimalSep, thousandSep);
    if (errors.length) throw ERR.VALIDATION(errors);

    const totalDebit = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
    const totalCredit = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
    // فحص التوثيق الثلاثي (إن أُعلن الختامي) — صيغة الوثيقة الكنسية حسب الجهة:
    // كشفهم:  افتتاحي + Σمدين − Σدائن (رصيدهم علينا مدين)
    // كشفنا:  افتتاحي + Σدائن − Σمدين (أونكس: رصيد المورد دائن)
    if (body.announcedClosing !== undefined && body.announcedClosing !== null) {
      const computedClosing =
        Number(preview.openingHint ?? body.openingBalance ?? 0) +
        (preview.side === 'ours' ? totalCredit - totalDebit : totalDebit - totalCredit);
      if (Math.abs(computedClosing - body.announcedClosing) > 0.005) {
        throw ERR.VALIDATION([
          {
            field: 'announcedClosing',
            messageAr: `الرصيد الختامي المعلن لا يطابق المحسوب: معلن ${body.announcedClosing.toLocaleString('en-US')} · محسوب ${computedClosing.toLocaleString('en-US')} — راجع البنود أو لا تعتمد`,
          },
        ]);
      }
    }
    if (body.announcedCount != null && body.announcedCount !== preview.lines.length) {
      throw ERR.VALIDATION([
        {
          field: 'announcedCount',
          messageAr: `عدد البنود المعلن (${body.announcedCount}) لا يطابق المستخرج (${preview.lines.length})`,
        },
      ]);
    }

    const statementId = await this.statements.createWithLines({
      accountId: preview.accountId,
      currencyCode: preview.currencyCode,
      side: preview.side,
      sessionId: body.sessionId ?? null,
      openingBalance: body.openingBalance ?? preview.openingHint ?? null,
      closingBalance: body.announcedClosing ?? null,
      sourceFile: {
        originalName: preview.originalName,
        storedPath: preview.storedPath,
        mimeType: preview.mimeType,
        sizeBytes: preview.sizeBytes,
        sha256: preview.sha256,
        uploadedBy: actorId,
      },
      createdBy: actorId,
      lines,
    });

    let bothAttached: boolean | undefined;
    if (body.sessionId) {
      const after = await this.sessions.getById(body.sessionId);
      bothAttached = Boolean(after?.ourStatementId && after?.theirStatementId);
    }

    await this.audit.write({
      actorId,
      action: 'STATEMENT_COMMIT',
      entityType: 'statement',
      entityId: String(statementId),
      after: { accountId: preview.accountId, side: preview.side, lines: lines.length, file: preview.originalName },
      ip,
    });
    dropPreview(token);

    return { statementId, lineCount: lines.length, totalDebit, totalCredit, sessionId: body.sessionId ?? undefined, bothAttached };
  }

  /** إدخال يدوي/OCR بعد التدقيق البشري (بدون ملف) */
  async manual(
    actorId: number,
    input: {
      accountId: number;
      side: 'ours' | 'theirs';
      openingBalance?: number | null;
      lines: Array<{ entryDate: string; description: string; ref?: string; debit?: number | null; credit?: number | null; ocrConfidence?: number | null }>;
    },
    ip: string | null,
  ): Promise<{ statementId: number; lineCount: number }> {
    const account = await this.accounts.getById(input.accountId);
    if (!account) throw ERR.PARTNER_NOT_FOUND();

    const rawLines: RawLine[] = input.lines.map((l, i) => ({
      lineNo: i + 1,
      dateRaw: l.entryDate,
      docType: '',
      docNo: '',
      description: l.description,
      ref: l.ref ?? '',
      debitRaw: l.debit == null ? '' : String(l.debit),
      creditRaw: l.credit == null ? '' : String(l.credit),
    }));
    const { lines, errors } = this.materializeLines(input.side, rawLines, ['YYYY-MM-DD', 'DD/MM/YYYY'], '.', ',');
    if (errors.length) throw ERR.VALIDATION(errors);

    const needsReview = input.lines.some((l) => l.ocrConfidence != null && l.ocrConfidence < 0.9);
    const statementId = await this.statements.createWithLines({
      accountId: input.accountId,
      currencyCode: account.currencyCode,
      side: input.side,
      openingBalance: input.openingBalance ?? null,
      ocrApplied: input.lines.some((l) => l.ocrConfidence != null),
      createdBy: actorId,
      lines: lines.map((l, i) => ({
        ...l,
        ourRef: input.side === 'ours' ? input.lines[i].ref ?? null : null,
        theirRef: input.side === 'theirs' ? input.lines[i].ref ?? null : null,
        ocrConfidence: input.lines[i].ocrConfidence ?? null,
        needsReview,
      })),
    });
    await this.audit.write({
      actorId,
      action: 'STATEMENT_MANUAL',
      entityType: 'statement',
      entityId: String(statementId),
      after: { accountId: input.accountId, side: input.side, lines: lines.length },
      ip,
    });
    return { statementId, lineCount: lines.length };
  }

  async getById(id: number) {
    const result = await this.statements.getByIdWithLines(id);
    if (!result) throw ERR.NOT_FOUND();
    return result;
  }
}
