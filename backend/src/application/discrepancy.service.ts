import { ERR } from '../domain/errors.js';
import type { SessionsRepository } from '../infrastructure/repositories/reconciliation-sessions.repository.js';
import type { DiscrepanciesRepository, DiscrepancyFull, DiscrepancyStatus } from '../infrastructure/repositories/discrepancies.repository.js';
import type { SettingsRepository } from '../infrastructure/repositories/settings.repository.js';
import type { AuditRepository } from '../infrastructure/repositories/audit.repository.js';

/**
 * خدمة الفروق (Module 5): تُولَّد آلياً عند إغلاق الجلسة — هنا إدارتها:
 * تعيين مسؤول + سبب جاهز + حالة + ملاحظة حل، وترحيلها لجلسة مفتوحة لنفس الحساب.
 */

export class DiscrepancyService {
  constructor(
    private readonly discrepancies: DiscrepanciesRepository,
    private readonly sessions: SessionsRepository,
    private readonly audit: AuditRepository,
    private readonly settings: SettingsRepository,
  ) {}

  async list(filters: { sessionId?: number; status?: string; accountId?: number }): Promise<DiscrepancyFull[]> {
    return this.discrepancies.list(filters);
  }

  async listReasonCodes() {
    return this.settings.listReasonCodes();
  }

  async update(
    actorId: number,
    id: number,
    patch: { status?: DiscrepancyStatus; assigneeId?: number | null; reasonCodeId?: number | null; resolutionNote?: string | null },
    ip: string | null,
  ): Promise<DiscrepancyFull> {
    const existing = await this.discrepancies.getById(id);
    if (!existing) throw ERR.NOT_FOUND();
    const ok = await this.discrepancies.update(id, patch);
    if (!ok) throw ERR.NOT_FOUND();
    await this.audit.write({
      actorId,
      action: 'DISCREPANCY_UPDATE',
      entityType: 'discrepancy',
      entityId: String(id),
      after: patch,
      ip,
    });
    const [row] = await this.discrepancies.list({ sessionId: existing.sessionId });
    const all = await this.discrepancies.list({});
    return all.find((d) => d.id === id) ?? row;
  }

  /** الترحيل: نفس الحساب فقط + جلسة مفتوحة — يظهر في الجلسة التالية كمتبقٍ معروف */
  async carry(actorId: number, id: number, targetSessionId: number, ip: string | null) {
    const existing = await this.discrepancies.getById(id);
    if (!existing) throw ERR.NOT_FOUND();
    const target = await this.sessions.getById(targetSessionId);
    if (!target) throw ERR.VALIDATION([{ field: 'targetSessionId', messageAr: 'الجلسة الهدف غير موجودة' }]);
    if (target.accountId !== existing.accountId) {
      throw ERR.VALIDATION([{ field: 'targetSessionId', messageAr: 'الترحيل بين جلسات نفس الحساب فقط' }]);
    }
    if (target.status === 'closed') {
      throw ERR.VALIDATION([{ field: 'targetSessionId', messageAr: 'الجلسة الهدف مغلقة — اختر جلسة مفتوحة' }]);
    }
    await this.discrepancies.setCarried(id, targetSessionId);
    await this.audit.write({
      actorId,
      action: 'DISCREPANCY_CARRY',
      entityType: 'discrepancy',
      entityId: String(id),
      after: { from: existing.sessionId, to: targetSessionId },
      ip,
    });
    return { id, carriedToSessionId: targetSessionId };
  }

  // ===== تعليقات الفروق (Module 7): الجميع يعلّق — الحذف لصاحب الملاحظة أو المدير =====

  listComments(discrepancyId: number) {
    return this.discrepancies.listComments(discrepancyId);
  }

  /** لتقرير الجلسة: ملاحظات كل الفروق في نداء واحد */
  listSessionComments(sessionId: number) {
    return this.discrepancies.listSessionComments(sessionId);
  }

  async addComment(actorId: number, discrepancyId: number, body: string, ip: string | null) {
    const existing = await this.discrepancies.getById(discrepancyId);
    if (!existing) throw ERR.NOT_FOUND();
    const comment = await this.discrepancies.addComment(discrepancyId, actorId, body);
    await this.audit.write({
      actorId,
      action: 'DISCREPANCY_COMMENT_ADD',
      entityType: 'discrepancy',
      entityId: String(discrepancyId),
      after: { commentId: comment.id, body },
      ip,
    });
    return comment;
  }

  async deleteComment(actorId: number, isAdmin: boolean, commentId: number, ip: string | null) {
    const existing = await this.discrepancies.getComment(commentId);
    if (!existing) throw ERR.NOT_FOUND();
    if (existing.authorId !== actorId && !isAdmin) throw ERR.FORBIDDEN();
    await this.discrepancies.deleteComment(commentId);
    await this.audit.write({
      actorId,
      action: 'DISCREPANCY_COMMENT_DELETE',
      entityType: 'discrepancy',
      entityId: String(existing.discrepancyId),
      before: { commentId },
      ip,
    });
    return { ok: true };
  }
}
