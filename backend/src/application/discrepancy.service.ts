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
    const existing = await this.discrepancies.getFull(id);
    if (!existing) throw ERR.NOT_FOUND();
    // إغلاق الفرق (محلول/مقبول) يحتاج توثيقاً — الواجهة تفرضه، والخادم يضمنه.
    const effectiveStatus = patch.status ?? existing.status;
    if (['resolved', 'accepted'].includes(effectiveStatus)) {
      const note = (patch.resolutionNote ?? existing.resolutionNote ?? '').trim();
      if (note.length < 5) {
        throw ERR.VALIDATION([{
          field: 'resolutionNote',
          messageAr: 'إغلاق الفرق يتطلب ملاحظة حل (5 أحرف على الأقل) — الذاكرة المؤسسية لا تُختصر',
        }]);
      }
    }
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
    const updated = await this.discrepancies.getFull(id);
    if (!updated) throw ERR.NOT_FOUND();
    return updated;
  }

  /** الترحيل: نفس الحساب فقط + جلسة مفتوحة — يظهر في الجلسة التالية كمتبقٍ معروف */
  async carry(actorId: number, id: number, targetSessionId: number, ip: string | null) {
    const existing = await this.discrepancies.getFull(id);
    if (!existing) throw ERR.NOT_FOUND();
    if (targetSessionId === existing.sessionId) {
      throw ERR.VALIDATION([{ field: 'targetSessionId', messageAr: 'لا يُرحَّل الفرق إلى جلسته نفسها — اختر الجلسة التالية' }]);
    }
    if (existing.carriedToSessionId === targetSessionId) {
      throw ERR.VALIDATION([{ field: 'targetSessionId', messageAr: 'الفرق مُرحَّل مسبقاً إلى هذه الجلسة' }]);
    }
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
