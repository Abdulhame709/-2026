import PDFDocument from 'pdfkit';
import arabicReshaper from 'arabic-reshaper';
import * as XLSX from 'xlsx';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { SessionService } from './sessions.service.js';
import type { DiscrepancyService } from './discrepancy.service.js';
import type { SettingsRepository } from '../infrastructure/repositories/settings.repository.js';
import { tafqitAmount } from './tafqit.js';

/**
 * تصدير تقرير الجلسة محلياً بالكامل (Module 10 — قرار المالك: PDF خلفي):
 * - PDF عبر pdfkit مع تشكيل عربي (arabic-reshaper) وخط IBM Plex Sans Arabic مضمّن
 *   من assets/fonts — لا خطوط نظام ولا خدمات سحابية (Q16).
 * - Excel عبر SheetJS الموجودة أصلاً — ورقتان: التسوية + الفروق بملاحظاتها.
 */

const FONT_DIR = path.resolve('assets/fonts');
const UPLOAD_DIR = path.resolve('storage/uploads');

/** مقاطع اتجاهية: حروف عربية (أساسية + أشكال العرض بعد التشكيل) مقابل غيرها */
const AR_RUN = new RegExp(
  '[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+|[^\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+',
  'g',
);
/** فحص اتجاهي بلا حالة (نسخة غير عاملة) */
const AR_CHAR = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * ترتيب بصري لسطر مختلط (عربي/أرقام/لاتيني): تُقلب مقاطع العربية ذاتياً وترتيب
 * المقاطع ككل — والأرقام واللاتيني تبقى بترتيبها الداخلي. كافٍ لأسطر التقارير.
 */
export function rtlLine(text: string): string {
  const runs = arabicReshaper.convertArabic(String(text ?? '')).match(AR_RUN) ?? [];
  return runs
    .reverse()
    .map((r: string) => (AR_CHAR.test(r[0]) ? [...r].reverse().join('') : r))
    .join('');
}

const money = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const DISC_TYPE: Record<string, string> = {
  amount_diff: 'فرق مبلغ',
  date_diff: 'فرق تاريخ',
  ref_diff: 'فرق مرجع',
  ours_only: 'عندنا فقط',
  theirs_only: 'عندهم فقط',
};
const DISC_STATUS: Record<string, string> = {
  new: 'جديد',
  in_progress: 'قيد المتابعة',
  resolved: 'محلول',
  accepted: 'مقبول/تسوية',
};

export interface ReportExportDeps {
  sessions: SessionService;
  discrepancies: DiscrepancyService;
  settings: SettingsRepository;
}

class PdfTable {
  private y: number;
  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly x: number,
    private readonly width: number,
    private readonly colWidths: number[],
    start: number,
  ) {
    this.y = start;
  }

  private ensure(h: number, header?: () => void) {
    if (this.y + h > 790) {
      this.doc.addPage();
      this.y = 50;
      header?.();
    }
  }

  header(labels: string[], fontSize = 9) {
    const { doc } = this;
    this.ensure(26, () => this.header(labels, fontSize));
    const h = 22;
    doc.rect(this.x, this.y, this.width, h).fill('#0F172A');
    doc.fill('#FFFFFF').font(path.join(FONT_DIR, 'IBMPlexSansArabic-Bold.ttf')).fontSize(fontSize);
    let cx = this.x + this.width;
    this.colWidths.forEach((w, i) => {
      cx -= w;
      doc.text(rtlLine(labels[i]), cx + 4, this.y + 6, { width: w - 8, align: 'center', lineBreak: false });
    });
    this.y += h;
  }

  row(cells: string[], opts: { shade?: boolean; small?: boolean; fontSize?: number } = {}) {
    const { doc } = this;
    const fontSize = opts.fontSize ?? (opts.small ? 8 : 9);
    doc.font(path.join(FONT_DIR, 'IBMPlexSansArabic-Regular.ttf')).fontSize(fontSize);
    // تقدير الارتفاع: أطول خلية ملتفة
    const heights = this.colWidths.map((w, i) => doc.heightOfString(rtlLine(cells[i] ?? ''), { width: w - 8 }));
    const h = Math.max(18, Math.max(...heights) + 6);
    this.ensure(h + 2);
    if (opts.shade) {
      doc.rect(this.x, this.y, this.width, h).fill('#F1F5F9');
    }
    let cx = this.x + this.width;
    this.colWidths.forEach((w, i) => {
      cx -= w;
      doc.fill('#0F172A').text(rtlLine(cells[i] ?? ''), cx + 4, this.y + 3, { width: w - 8, align: 'center' });
    });
    this.y += h;
    doc.moveTo(this.x, this.y).lineTo(this.x + this.width, this.y).lineWidth(0.4).stroke('#CBD5E1');
  }

  get end(): number {
    return this.y;
  }
}

export class ReportExportService {
  constructor(private readonly deps: ReportExportDeps) {}

  /** تجميع بيانات التقرير نفسها للصيغتين */
  private async assemble(sessionId: number) {
    const detail = await this.deps.sessions.detail(sessionId);
    const discrepancies = await this.deps.discrepancies.list({ sessionId });
    const comments = await this.deps.discrepancies.listSessionComments(sessionId);
    const company = await this.deps.settings.getCompany();
    const commentsByDisc = new Map<number, typeof comments>();
    for (const c of comments) {
      const list = commentsByDisc.get(c.discrepancyId) ?? [];
      list.push(c);
      commentsByDisc.set(c.discrepancyId, list);
    }
    return { detail, discrepancies, commentsByDisc, company };
  }

  // ==================== Excel ====================
  async excel(sessionId: number): Promise<{ buffer: Buffer; filename: string }> {
    const { detail, discrepancies, commentsByDisc, company } = await this.assemble(sessionId);
    const { session, partner, progress } = detail;
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };

    // ورقة التسوية
    const sum: unknown[][] = [
      [company.nameAr || 'شركة المؤسسة'],
      ['تقرير مطابقة حسابات — كشف المورد'],
      [],
      ['رقم التقرير', `REC-${session.id}-R1`],
      ['المورد', partner.nameAr],
      ['رقم الحساب في نظامنا', detail.partner.code],
      ['العملة', session.currencyCode],
      ['الفترة', session.periodLabel],
      ['حالة الجلسة', session.status === 'closed' ? 'مغلقة (نهائية)' : 'مفتوحة (مسودة)'],
      [],
      ['ملخص المطابقة'],
      ['نسبة التطابق', `${(Math.round(progress.matchRatePct * 10) / 10).toFixed(1)}%`],
      ['بنودنا', progress.ours.lineCount],
      ['بنودهم', progress.theirs.lineCount],
      ['قيمة المطابقات المؤكدة (عندهم)', progress.theirs.matchedConfirmed],
      ['قيمة غير المطابق (عندهم)', progress.theirs.leftover],
      [],
      ['الأرصدة', 'عندنا', 'عندهم', 'الفرق'],
      ['الافتتاحي (عندهم)', '', session.openingTheirs ?? '', ''],
      ['الختامي المحسوب عندهم', '', '', ''],
    ];
    const wsSum = XLSX.utils.aoa_to_sheet(sum);
    wsSum['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsSum, 'التسوية');

    // ورقة الفروق
    const rows: unknown[][] = [[
      '#', 'النوع', 'الوصف/البند', 'التاريخ', 'عندنا', 'عندهم', 'الفرق', 'السبب', 'الحالة', 'ملاحظة الحل', 'ملاحظات الفريق',
    ]];
    for (const d of discrepancies) {
      const cs = commentsByDisc.get(d.id) ?? [];
      rows.push([
        d.id,
        DISC_TYPE[d.type] ?? d.type,
        d.lineDescription ?? '—',
        d.lineDate ?? '—',
        d.ourAmount ?? '',
        d.theirAmount ?? '',
        d.diffAmount ?? '',
        d.reasonCodeName ?? 'غير محدد',
        DISC_STATUS[d.status] ?? d.status,
        d.resolutionNote ?? '',
        cs.map((c) => `${c.authorName}: ${c.body}`).join(' | '),
      ]);
    }
    if (discrepancies.length === 0) rows.push(['—', 'لا توجد فروق — تطابق كامل']);
    const wsDisc = XLSX.utils.aoa_to_sheet(rows);
    wsDisc['!cols'] = [{ wch: 5 }, { wch: 10 }, { wch: 30 }, { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 30 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsDisc, 'الفروق');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return { buffer, filename: `taswiya-session-${sessionId}-${session.periodLabel}.xlsx` };
  }

  // ==================== PDF ====================
  async pdf(sessionId: number): Promise<{ buffer: Buffer; filename: string }> {
    const { detail, discrepancies, commentsByDisc, company } = await this.assemble(sessionId);
    const { session, partner, progress, ourStatement, theirStatement } = detail;

    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `تقرير مطابقة جلسة ${sessionId}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const reg = path.join(FONT_DIR, 'IBMPlexSansArabic-Regular.ttf');
    const bold = path.join(FONT_DIR, 'IBMPlexSansArabic-Bold.ttf');
    doc.registerFont('ar', reg);
    doc.registerFont('arb', bold);

    const W = 595;
    const MX = 40;
    const isClosed = session.status === 'closed';

    // علامة المسودة
    if (!isClosed) {
      doc.save();
      doc.rotate(-0.5, { origin: [W / 2, 420] });
      doc.font('arb').fontSize(110).fillOpacity(0.06).fill('#DC2626');
      doc.text(rtlLine('مسودة'), 0, 400, { width: W, align: 'center' });
      doc.restore();
      doc.fillOpacity(1);
    }

    // الترويسة
    let logoBuf: Buffer | null = null;
    if (company.logoFileName && /\.(png|jpe?g)$/i.test(company.logoFileName)) {
      logoBuf = await readFile(path.join(UPLOAD_DIR, company.logoFileName)).catch(() => null);
    }
    if (logoBuf) {
      try {
        doc.image(logoBuf, W - MX - 110, 36, { height: 52 });
      } catch {
        /* شعار تالف — نتجاهله */
      }
    }
    doc.font('arb').fontSize(15).fill('#0F172A');
    doc.text(rtlLine(company.nameAr || 'شركة المؤسسة'), MX, 40, { width: W - MX * 2 - (logoBuf ? 120 : 0), align: 'right' });
    doc.font('ar').fontSize(8.5).fill('#475569');
    const contact = [company.address, company.phone, company.email].filter(Boolean).join(' · ') || company.reportHeaderNote;
    if (contact) doc.text(rtlLine(contact), MX, doc.y + 2, { width: W - MX * 2 - (logoBuf ? 120 : 0), align: 'right' });

    doc.font('ar').fontSize(9).fill('#334155');
    doc.text(rtlLine(`رقم التقرير: REC-${session.id}-R1`), MX, 40, { width: 150, align: 'left', lineBreak: false });
    doc.text(rtlLine(`تاريخ الإصدار: ${new Date().toISOString().slice(0, 10)}`), MX, 56, { width: 150, align: 'left', lineBreak: false });
    doc.text(rtlLine(isClosed ? 'نهائي' : 'مسودة'), MX, 72, { width: 150, align: 'left', lineBreak: false });

    // العنوان
    let y = Math.max(doc.y, 108) + 8;
    doc.moveTo(MX, y).lineTo(W - MX, y).lineWidth(1).stroke('#CBD5E1');
    y += 12;
    doc.font('arb').fontSize(13).fill('#0F172A');
    doc.text(rtlLine(`تقرير مطابقة حسابات — ${partner.nameAr} — فترة ${session.periodLabel} (${session.currencyCode})`), MX, y, {
      width: W - MX * 2,
      align: 'center',
    });
    y = doc.y + 10;

    // ملخص المطابقة — سطر واحد مضغوط
    const rate = (Math.round(progress.matchRatePct * 10) / 10).toFixed(1);
    doc.font('ar').fontSize(9.5).fill('#0F172A');
    doc.text(
      rtlLine(`نسبة التطابق المؤكدة: ${rate}% · بنودنا ${progress.ours.lineCount} · بنودهم ${progress.theirs.lineCount} · قيمة المطابقات المؤكدة عندهم ${money(progress.theirs.matchedConfirmed)}`),
      MX, y, { width: W - MX * 2, align: 'center' },
    );
    y = doc.y + 10;

    // جدول الأرصدة
    doc.font('arb').fontSize(10.5).fill('#0F172A');
    doc.text(rtlLine('أولاً: الأرصدة'), MX, y, { align: 'right' });
    y = doc.y + 4;
    const balTable = new PdfTable(doc, MX, W - MX * 2, [190, 106, 106, 113], y);
    balTable.header(['البيان', 'عندنا', 'عندهم', 'الفرق']);
    const ourOpen = session.openingOurs ?? 0;
    const theirOpen = session.openingTheirs ?? 0;
    const flow = (stmt: typeof ourStatement, dirDebitFirst: boolean) => {
      const lines = stmt?.lines ?? [];
      const deb = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
      const cre = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
      return dirDebitFirst ? deb - cre : cre - deb;
    };
    const ourClose = ourOpen + flow(ourStatement, false);
    const theirClose = theirOpen + flow(theirStatement, true);
    balTable.row(['الرصيد الافتتاحي', money(ourOpen), money(theirOpen), money(ourOpen - theirOpen)]);
    balTable.row(['حركة الفترة (بنود الكشوف)', money(ourOpen ? ourClose - ourOpen : ourClose - ourOpen), money(theirClose - theirOpen), '']);
    balTable.row(['الرصيد الختامي', money(ourClose), money(theirClose), money(ourClose - theirClose)], { shade: true, fontSize: 9.5 });
    y = balTable.end + 6;

    // ملاحظة الترحيل (D9)
    if (session.carriedFromSessionId != null) {
      doc.font('ar').fontSize(8.5).fill('#475569');
      doc.text(
        rtlLine(`الرصيد الافتتاحي مرحَّل آلياً من جلسة ${session.carriedFromPeriod ?? '#' + session.carriedFromSessionId} المغلقة${session.openingAdjustReason ? ` — عُدِّل يدوياً والسبب: ${session.openingAdjustReason}` : ' — متصل بآخر إقفال موثق'}.`),
        MX, y, { width: W - MX * 2, align: 'right' },
      );
      y = doc.y + 6;
    }

    // جدول الفروق
    doc.font('arb').fontSize(10.5).fill('#0F172A');
    doc.text(rtlLine('ثانياً: الفروق وأسبابها'), MX, y, { align: 'right' });
    y = doc.y + 4;
    const discTable = new PdfTable(doc, MX, W - MX * 2, [22, 52, 130, 60, 60, 60, 121], y);
    const discHeader = () => discTable.header(['#', 'النوع', 'الوصف', 'لدينا', 'لديهم', 'الفرق', 'السبب/الحالة']);
    discHeader();
    if (discrepancies.length === 0) {
      discTable.row(['', 'لا توجد فروق — تطابق كامل', '', '', '', '', '']);
    } else {
      for (const d of discrepancies) {
        discTable.row([
          String(d.id),
          DISC_TYPE[d.type] ?? d.type,
          d.lineDescription ?? '—',
          money(d.ourAmount),
          money(d.theirAmount),
          money(d.diffAmount),
          `${d.reasonCodeName ?? 'غير محدد'} · ${DISC_STATUS[d.status] ?? d.status}`,
        ]);
        const cs = commentsByDisc.get(d.id) ?? [];
        if (cs.length) {
          discTable.row(
            ['', '', cs.map((c) => `${c.authorName} (${c.createdAt.slice(0, 10)}): ${c.body}`).join('\n'), '', '', '', ''],
            { shade: true, small: true, fontSize: 8 },
          );
        }
      }
    }
    y = discTable.end + 8;

    // الختامي بالتفقيط
    const tafqit = tafqitAmount(theirClose, session.currencyCode as 'YER' | 'USD' | 'SAR');
    doc.font('arb').fontSize(9.5).fill('#0F172A');
    doc.text(rtlLine(`الرصيد الختامي عند المورد: ${money(theirClose)} ${session.currencyCode}${tafqit ? ` — ${tafqit}` : ''}`), MX, y, {
      width: W - MX * 2,
      align: 'right',
    });
    y = doc.y + 8;

    // الإقرار
    doc.font('ar').fontSize(8.5).fill('#334155');
    doc.text(
      rtlLine('نصدر هذا التقرير كدليل على مطابقة كشف الحساب أعلاه بين السجلين، وكل بند غير مذكور في قائمة الفروق يُعد متفقاً عليه بين الطرفين.'),
      MX, y, { width: W - MX * 2, align: 'center' },
    );
    y = doc.y + 16;

    // التواقيع
    const sigW = (W - MX * 2 - 24) / 3;
    doc.font('ar').fontSize(9).fill('#0F172A');
    ['المحاسب', 'مدير الحسابات', 'المورد/الطرف الآخر'].forEach((t, i) => {
      const x = W - MX - sigW - i * (sigW + 12);
      doc.text(rtlLine(t), x, y, { width: sigW, align: 'center' });
      doc.moveTo(x + 10, y + 42).lineTo(x + sigW - 10, y + 42).lineWidth(0.7).stroke('#94A3B8');
    });

    // ترقيم الصفحات
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('ar').fontSize(8).fill('#64748B');
      doc.text(rtlLine(`صفحة ${i + 1} من ${range.count}`), MX, 812, { width: W - MX * 2, align: 'center', lineBreak: false });
    }

    doc.end();
    const buffer = await done;
    return { buffer, filename: `taswiya-report-${sessionId}${isClosed ? '' : '-draft'}.pdf` };
  }
}
