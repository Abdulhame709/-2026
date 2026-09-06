import { ERR } from '../domain/errors.js';
import type { PublicPartner } from '../domain/partner.js';
import type {
  Account,
  ImportTemplate,
  MatchRuleName,
  NotifiedAdjustment,
  RefMapEntry,
} from '../domain/partner.js';
import {
  AccountsRepository,
  PartnersRepository,
} from '../infrastructure/repositories/partners.repository.js';
import { RefMapRepository } from '../infrastructure/repositories/refmap.repository.js';
import { AdjustmentsRepository } from '../infrastructure/repositories/adjustments.repository.js';
import { TemplatesRepository } from '../infrastructure/repositories/templates.repository.js';
import type { AuditRepository } from '../infrastructure/repositories/audit.repository.js';

/**
 * خدمة الشركاء والحسابات — حالات استخدام Module 2:
 * موردون (رمز هجين) · حسابات بعملات متعددة (D4) · إعدادات مطابقة لكل حساب ·
 * خريطة مراجع · تسويات مبلَّغة · قوالب استيراد (كشوفنا المشترك + كشوفهم).
 * التعطيل يمنع الجديد فقط — التاريخ كامل (قرار المالك).
 */
export class PartnerService {
  constructor(
    private readonly partners: PartnersRepository,
    private readonly accounts: AccountsRepository,
    private readonly refMap: RefMapRepository,
    private readonly adjustments: AdjustmentsRepository,
    private readonly templates: TemplatesRepository,
    private readonly audit: AuditRepository,
  ) {}

  async listPartners(): Promise<Array<PublicPartner>> {
    return this.partners.listAllWithAccounts();
  }

  async getPartner(id: number): Promise<PublicPartner> {
    const p = await this.partners.findByIdWithAccounts(id);
    if (!p) throw ERR.PARTNER_NOT_FOUND();
    return p;
  }

  async createPartner(
    actorId: number,
    input: {
      code?: string;
      nameAr: string;
      nameEn?: string | null;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
    },
    ip: string | null,
  ): Promise<PublicPartner> {
    // الهجين: كود مقترح SUP-nn عند غيابه + فحص تكرار دائماً
    const code = input.code ?? (await this.partners.nextCode());
    const existing = await this.partners.findByCode(code);
    if (existing) throw ERR.PARTNER_CODE_TAKEN();

    const created = await this.partners.create({ ...input, code });
    await this.audit.write({
      actorId,
      action: 'PARTNER_CREATE',
      entityType: 'partner',
      entityId: String(created.id),
      after: { code: created.code, nameAr: created.nameAr },
      ip,
    });
    return { ...created, accounts: [] };
  }

  async updatePartner(
    actorId: number,
    id: number,
    patch: {
      nameAr?: string;
      nameEn?: string | null;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
      isActive?: boolean;
    },
    ip: string | null,
  ): Promise<PublicPartner> {
    const before = await this.partners.findByIdWithAccounts(id);
    if (!before) throw ERR.PARTNER_NOT_FOUND();

    const updated = await this.partners.update(id, patch);
    if (!updated) throw ERR.PARTNER_NOT_FOUND();

    await this.audit.write({
      actorId,
      action: patch.isActive === undefined ? 'PARTNER_UPDATE' : patch.isActive ? 'PARTNER_ACTIVATE' : 'PARTNER_DEACTIVATE',
      entityType: 'partner',
      entityId: String(id),
      before: { nameAr: before.nameAr, isActive: before.isActive },
      after: { nameAr: updated.nameAr, isActive: updated.isActive },
      ip,
    });
    return { ...updated, accounts: before.accounts };
  }

  // ===== الحسابات (حساب لكل عملة — فريد) =====

  async listAccounts(partnerId: number): Promise<Account[]> {
    await this.ensurePartner(partnerId);
    return this.accounts.listByPartner(partnerId);
  }

  async createAccount(
    actorId: number,
    partnerId: number,
    input: { currencyCode: string; ourLedgerCode?: string | null; dateWindowDays?: number },
    ip: string | null,
  ): Promise<Account> {
    await this.ensurePartner(partnerId);
    const account = await this.accounts.create({ ...input, partnerId });
    await this.audit.write({
      actorId,
      action: 'ACCOUNT_CREATE',
      entityType: 'account',
      entityId: String(account.id),
      after: { partnerId, currencyCode: account.currencyCode, ledger: account.ourLedgerCode },
      ip,
    });
    return account;
  }

  async updateMatchingSettings(
    actorId: number,
    accountId: number,
    patch: { dateWindowDays?: number; ruleOrder?: MatchRuleName[] },
    ip: string | null,
  ): Promise<Account> {
    await this.ensureAccount(accountId);
    const updated = await this.accounts.updateMatchingSettings(accountId, patch);
    if (!updated) throw ERR.NOT_FOUND();
    await this.audit.write({
      actorId,
      action: 'MATCHING_SETTINGS_UPDATE',
      entityType: 'account',
      entityId: String(accountId),
      after: { dateWindowDays: updated.dateWindowDays, ruleOrder: updated.ruleOrder },
      ip,
    });
    return updated;
  }

  // ===== خريطة المراجع =====

  listRefMap(accountId: number): Promise<RefMapEntry[]> {
    return this.refMap.listByAccount(accountId);
  }

  async addRefMap(
    actorId: number,
    accountId: number,
    input: { ourRef: string; theirRef: string },
    ip: string | null,
  ): Promise<RefMapEntry> {
    await this.ensureAccount(accountId);
    const entry = await this.refMap.upsert({ accountId, ...input, confirmedBy: actorId });
    await this.audit.write({
      actorId,
      action: 'REFMAP_SAVE',
      entityType: 'ref_map_entry',
      entityId: String(entry.id),
      after: { accountId, ourRef: entry.ourRef, theirRef: entry.theirRef },
      ip,
    });
    return entry;
  }

  async deleteRefMap(actorId: number, accountId: number, entryId: number, ip: string | null): Promise<void> {
    const deleted = await this.refMap.delete(accountId, entryId);
    if (!deleted) throw ERR.NOT_FOUND();
    await this.audit.write({
      actorId,
      action: 'REFMAP_DELETE',
      entityType: 'ref_map_entry',
      entityId: String(entryId),
      ip,
    });
  }

  // ===== التسويات المبلَّغة =====

  listAdjustments(accountId: number): Promise<NotifiedAdjustment[]> {
    return this.adjustments.listByAccount(accountId);
  }

  async createAdjustment(
    actorId: number,
    accountId: number,
    input: {
      adjustmentDate: string;
      adjustmentType: NotifiedAdjustment['adjustmentType'];
      amount: number;
      currencyCode: string;
      note?: string | null;
    },
    ip: string | null,
  ): Promise<NotifiedAdjustment> {
    await this.ensureAccount(accountId);
    const entry = await this.adjustments.create({ accountId, ...input, createdBy: actorId });
    await this.audit.write({
      actorId,
      action: 'ADJUSTMENT_ADD',
      entityType: 'notified_adjustment',
      entityId: String(entry.id),
      after: { accountId, type: entry.adjustmentType, amount: entry.amount, currency: entry.currencyCode },
      ip,
    });
    return entry;
  }

  // ===== قوالب الاستيراد =====

  listTemplates(accountId: number): Promise<ImportTemplate[]> {
    return this.templates.listForAccount(accountId);
  }

  async createTemplate(
    actorId: number,
    accountId: number | null,
    input: {
      templateKind: ImportTemplate['templateKind'];
      name: string;
      headerRows: number;
      columnsMapping: Record<string, string>;
      dateFormats: string[];
      decimalSep: string;
      thousandSep: string;
      isDefault: boolean;
    },
    ip: string | null,
  ): Promise<ImportTemplate> {
    if (accountId !== null) await this.ensureAccount(accountId);
    const template = await this.templates.create({ ...input, accountId, createdBy: actorId });
    await this.audit.write({
      actorId,
      action: 'TEMPLATE_SAVE',
      entityType: 'import_template',
      entityId: String(template.id),
      after: { accountId, kind: template.templateKind, name: template.name, isDefault: template.isDefault },
      ip,
    });
    return template;
  }

  // ===== حواجز الوجود =====

  private async ensurePartner(partnerId: number): Promise<void> {
    const p = await this.partners.findByIdWithAccounts(partnerId);
    if (!p) throw ERR.PARTNER_NOT_FOUND();
  }

  private async ensureAccount(accountId: number): Promise<void> {
    const a = await this.accounts.getById(accountId);
    if (!a) throw ERR.NOT_FOUND();
  }
}
