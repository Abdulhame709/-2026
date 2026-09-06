import { Fragment } from 'react';
import { CurrencyBadge } from '@/shared/components/CurrencyBadge';
import type { SessionReport } from './reportsClient';

/**
 * ورقة التقرير الرسمية A4 — وثيقة التصميم §9 (FR-6.1/6.6).
 * تُعرض على الشاشة كما ستُطبع تماماً، وزر الطباعة يطبع هذه الورقة فقط (print CSS).
 * علامة مائية "مسودة" تظهر للجلسات غير المغلقة (UC-04 هـ1).
 */

interface ReportPaperProps {
  report: SessionReport;
  mode: 'report' | 'letter';
  sections: {
    summary: boolean;
    discrepancies: boolean;
    signatures: boolean;
  };
}

const money = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ReportPaper({ report, mode, sections }: ReportPaperProps) {
  if (mode === 'letter') {
    return (
      <article className="report-paper" aria-label="خطاب اعتماد الرصيد">
        <header className="rp-letterhead">
          <div className="rp-company">
            {report.logoUrl && <img className="rp-logo" src={report.logoUrl} alt="شعار الشركة" />}
            <div>
              <strong>{report.companyName}</strong>
              <span>{report.companyContact}</span>
            </div>
          </div>
          <div className="rp-doc-no financial-numbers">
            <span>التاريخ: {report.issuedLabel}</span>
            <span>الرقم: {report.reportNo}-L</span>
          </div>
        </header>

        <h2 className="rp-letter-title">خطاب تأكيد رصيد حساب</h2>

        <p className="rp-letter-to">
          إلى/<strong>{report.partnerName}</strong>
          {report.partnerNameEn && <span className="rp-en"> — {report.partnerNameEn}</span>} المحترمين
        </p>

        <p>
          <strong>الموضوع: تأكيد رصيد الحساب عن الفترة حتى {report.periodTo}</strong>
        </p>

        <p>تحية طيبة وبعد،</p>
        <p>
          نفيدكم بأنه بناءً على مطابقة سجلاتنا، فإن رصيد حسابكم لدىنا وفق دفاترنا المحاسبية بتاريخ{' '}
          <strong className="financial-numbers">{report.periodTo}</strong> هو:
        </p>

        <div className="rp-balance-callout">
          <span className="financial-numbers rp-balance-amount">
            {money(report.closingBalanceTheirs)} <CurrencyBadge currency={report.currency} />
          </span>
          {report.closingBalanceWords && (
            <span className="rp-balance-words">({report.closingBalanceWords})</span>
          )}
        </div>

        <p>
          نرجو التكرم بمراجعة الرصيد أعلاه وتوقيع هذا الخطاب وإعادته إلينا إقراراً بالموافقة خلال
          <strong> خمسة عشر (15) يوماً</strong> من تاريخه، وإلا عُد الرصيد صحيحاً ومتفقاً عليه.
          وفي حال وجود أي خلاف، نرجو إفادنا بكشف حساب تفصيلي يوضح بنود الاختلاف خلال المدة نفسها.
        </p>

        <p className="rp-thanks">وتفضلوا بقبول فائق الاحترام والتقدير،</p>

        {sections.signatures && (
          <footer className="rp-signatures rp-signatures--letter">
            <div>
              <span>المحاسب</span>
              <i />
              <small>الاسم والتوقيع</small>
            </div>
            <div>
              <span>المدير المالي</span>
              <i />
              <small>الاسم والتوقيع والختم</small>
            </div>
          </footer>
        )}
      </article>
    );
  }

  return (
    <article className="report-paper" aria-label={`تقرير مطابقة جلسة ${report.sessionId}`}>
      {report.isDraft && <div className="rp-watermark" aria-hidden="true">مسودة</div>}

      <header className="rp-letterhead">
        <div className="rp-company">
          {report.logoUrl && <img className="rp-logo" src={report.logoUrl} alt="شعار الشركة" />}
          <div>
            <strong>{report.companyName}</strong>
            <span>{report.companyContact}</span>
          </div>
        </div>
        <div className="rp-doc-no financial-numbers">
          <span>تقرير مطابقة حسابات</span>
          <span>رقم التقرير: {report.reportNo}</span>
          <span>تاريخ الإصدار: {report.issuedLabel}</span>
        </div>
      </header>

      <table className="rp-meta">
        <tbody>
          <tr>
            <th>الطرف</th>
            <td>
              <strong>{report.partnerName}</strong>
              {report.partnerNameEn && <span className="rp-en"> — {report.partnerNameEn}</span>}
            </td>
            <th>حسابنا</th>
            <td className="financial-numbers">{report.ledgerCode}</td>
          </tr>
          <tr>
            <th>العملة</th>
            <td>
              {report.currencyNameAr} <CurrencyBadge currency={report.currency} />
            </td>
            <th>الفترة</th>
            <td className="financial-numbers">
              من {report.periodFrom} إلى {report.periodTo}
            </td>
          </tr>
        </tbody>
      </table>

      {sections.summary && (
        <>
          <h3 className="rp-section-title">أولاً: ملخص الأرصدة والمطابقة</h3>
          <table className="rp-table">
            <thead>
              <tr>
                <th>البيان</th>
                <th>كشفنا (نظامنا المحاسبي)</th>
                <th>كشف الطرف</th>
                <th>الفرق</th>
              </tr>
            </thead>
            <tbody>
              {report.balances.map((row) => (
                <tr key={row.label} className={row.label === 'الرصيد الختامي' ? 'rp-row-total' : undefined}>
                  <td>{row.label}</td>
                  <td className="financial-numbers">{money(row.ours)}</td>
                  <td className="financial-numbers">{money(row.theirs)}</td>
                  <td className={`financial-numbers ${row.diff !== 0 ? 'rp-diff' : ''}`}>
                    {money(row.diff)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rp-matchline financial-numbers">
            نتيجة المطابقة: تطابق تام في <strong>{report.matchSummary.matchedCount}</strong> بنداً من{' '}
            <strong>{report.matchSummary.totalLines}</strong> بقيمة{' '}
            <strong>{report.matchSummary.matchedValueLabel}</strong> — نسبة المطابقة{' '}
            <strong>{report.matchSummary.matchRatePct}%</strong>.
          </p>
        </>
      )}

      {sections.discrepancies && (
        <>
          <h3 className="rp-section-title">ثانياً: الفروق وأسبابها</h3>
          <table className="rp-table">
            <thead>
              <tr>
                <th>#</th>
                <th>النوع</th>
                <th>الوصف</th>
                <th>لدينا</th>
                <th>لديهم</th>
                <th>الفرق</th>
                <th>السبب / الحالة</th>
              </tr>
            </thead>
            <tbody>
              {report.discrepancies.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center' }}>
                    لا توجد فروق — تطابق كامل ✓
                  </td>
                </tr>
              )}
              {report.discrepancies.map((d) => (
                <Fragment key={d.id}>
                  <tr>
                    <td className="financial-numbers">{d.id}</td>
                    <td>{d.typeLabel}</td>
                    <td>{d.summary}</td>
                    <td className="financial-numbers">{d.ourValue}</td>
                    <td className="financial-numbers">{d.theirValue}</td>
                    <td className="financial-numbers">{d.diff}</td>
                    <td>
                      {d.reasonLabel}
                      <br />
                      <small>{d.statusLabel}</small>
                    </td>
                  </tr>
                  {d.comments.length > 0 && (
                    <tr className="rp-comments-row">
                      <td colSpan={7}>
                        {d.comments.map((c, i) => (
                          <div key={i} className="rp-comment">
                            <strong>{c.author}</strong>
                            <span className="financial-numbers"> ({c.time})</span>: {c.body}
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </>
      )}

      {report.carryNote && <p className="rp-carry-note">{report.carryNote}</p>}

      <p className="rp-declare">
        نصدر هذا التقرير كدليل على مطابقة كشف الحساب أعلاه بين السجلين، وكل بند غير مذكور في
        قائمة الفروق يُعد متفقاً عليه بين الطرفين.
      </p>

      {sections.signatures && (
        <footer className="rp-signatures">
          <div>
            <span>المحاسب</span>
            <i />
            <small>الاسم والتوقيع</small>
          </div>
          <div>
            <span>المراجع</span>
            <i />
            <small>الاسم والتوقيع</small>
          </div>
          <div>
            <span>المدير المالي</span>
            <i />
            <small>الاسم والتوقيع والختم</small>
          </div>
        </footer>
      )}
    </article>
  );
}
