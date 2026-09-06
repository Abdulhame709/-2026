/**
 * طبقة API لنطاق الشركاء (Module 2) — تحويل أشكال الخادم لأنواع الواجهة ومخالعساها.
 * الخادم يخدم خريطة المراجع والتسويات والقوالب **بحساب العملة** وليس بالمورد —
 * لذلك التبويبات تختار العملة أولاً ثم تجلب بياناتها.
 */
import { api } from '@/shared/api/client';
import type {
  CurrencyCode,
  ImportTemplateRef,
  NotifiedAdjustment,
  Partner,
  PartnerAccount,
  RefMapEntry,
} from '@/shared/types';

interface ApiAccount {
  id: number;
  partnerId: number;
  currencyCode: string;
  ourLedgerCode: string | null;
  dateWindowDays: number;
  ruleOrder: string[];
  isActive: boolean;
}

interface ApiPartner {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  accounts: ApiAccount[];
}

function mapAccount(a: ApiAccount): PartnerAccount {
  return {
    currency: a.currencyCode as CurrencyCode,
    accountId: a.id,
    ledgerCode: a.ourLedgerCode ?? '—',
    dateWindowDays: a.dateWindowDays,
    ruleOrder: a.ruleOrder,
    lastSession: null, // تأتي من وحدة الجلسات والمطابقة (Module 4)
  };
}

function mapPartner(p: ApiPartner): Partner {
  return {
    id: p.id,
    code: p.code,
    nameAr: p.nameAr,
    nameEn: p.nameEn ?? undefined,
    phone: p.phone ?? undefined,
    email: p.email ?? undefined,
    notes: p.notes ?? undefined,
    isActive: p.isActive,
    accounts: p.accounts.map(mapAccount),
    refMap: [],
    adjustments: [],
    templates: [], // تُجلب لكل حساب من تبويباتها
  };
}

export interface NewPartnerInput {
  code?: string;
  nameAr: string;
  nameEn?: string;
  notes?: string;
}

export async function listPartners(): Promise<Partner[]> {
  const { partners } = await api.get<{ partners: ApiPartner[] }>('/api/v1/partners');
  return partners.map(mapPartner);
}

export async function createPartner(input: NewPartnerInput): Promise<Partner> {
  const { partner } = await api.post<{ partner: ApiPartner }>('/api/v1/partners', input);
  return mapPartner(partner);
}

export async function updatePartner(
  id: number,
  patch: Partial<{ nameAr: string; nameEn: string | null; phone: string | null; email: string | null; notes: string | null; isActive: boolean }>,
): Promise<Partner> {
  const { partner } = await api.put<{ partner: ApiPartner }>(`/api/v1/partners/${id}`, patch);
  return mapPartner(partner);
}

export async function createAccount(
  partnerId: number,
  input: { currencyCode: string; ourLedgerCode?: string; dateWindowDays?: number },
): Promise<PartnerAccount> {
  const { account } = await api.post<{ account: ApiAccount }>(`/api/v1/partners/${partnerId}/accounts`, input);
  return mapAccount(account);
}

export async function updateMatchingSettings(
  accountId: number,
  input: { dateWindowDays?: number; ruleOrder?: string[] },
): Promise<PartnerAccount> {
  const { account } = await api.put<{ account: ApiAccount }>(`/api/v1/accounts/${accountId}/matching-settings`, input);
  return mapAccount(account);
}

// ===== خريطة المراجع (بالحساب) =====

interface ApiRefEntry {
  id: number;
  ourRef: string;
  theirRef: string;
  source: RefMapEntry['source'];
  createdAt: string;
}

export async function listRefMap(accountId: number): Promise<RefMapEntry[]> {
  const { entries } = await api.get<{ entries: ApiRefEntry[] }>(`/api/v1/accounts/${accountId}/ref-map`);
  return entries.map((e) => ({
    id: e.id,
    ourRef: e.ourRef,
    theirRef: e.theirRef,
    source: e.source,
    addedLabel: new Intl.DateTimeFormat('ar', { dateStyle: 'short' }).format(new Date(e.createdAt)),
  }));
}

export async function addRefMap(accountId: number, input: { ourRef: string; theirRef: string }): Promise<void> {
  await api.post(`/api/v1/accounts/${accountId}/ref-map`, input);
}

export async function deleteRefMap(accountId: number, entryId: number): Promise<void> {
  await api.delete(`/api/v1/accounts/${accountId}/ref-map/${entryId}`);
}

// ===== التسويات المبلَّغة (بالحساب) =====

interface ApiAdjustment {
  id: number;
  adjustmentDate: string;
  adjustmentType: NotifiedAdjustment['type'];
  amount: number;
  currencyCode: string;
  note: string | null;
}

export async function listAdjustments(accountId: number): Promise<NotifiedAdjustment[]> {
  const { adjustments } = await api.get<{ adjustments: ApiAdjustment[] }>(
    `/api/v1/accounts/${accountId}/notified-adjustments`,
  );
  return adjustments.map((a) => ({
    id: a.id,
    dateLabel: a.adjustmentDate,
    type: a.adjustmentType,
    amount: a.amount,
    currency: a.currencyCode as CurrencyCode,
    note: a.note ?? '',
  }));
}

export async function addAdjustment(
  accountId: number,
  input: { adjustmentDate: string; adjustmentType: NotifiedAdjustment['type']; amount: number; currencyCode: string; note?: string },
): Promise<void> {
  await api.post(`/api/v1/accounts/${accountId}/notified-adjustments`, input);
}

// ===== قوالب الاستيراد (بالحساب + قالب كشوفنا المشترك) =====

interface ApiTemplate {
  id: number;
  templateKind: 'ours' | 'theirs';
  name: string;
  isDefault: boolean;
}

export async function listTemplates(accountId: number): Promise<ImportTemplateRef[]> {
  const { templates } = await api.get<{ templates: ApiTemplate[] }>(`/api/v1/accounts/${accountId}/import-templates`);
  return templates.map((t) => ({ id: String(t.id), name: t.name, kind: t.templateKind, isDefault: t.isDefault }));
}

export async function addTemplate(
  accountId: number,
  input: { name: string; headerRows?: number; columnsMapping: Record<string, string>; isDefault?: boolean },
): Promise<void> {
  await api.post(`/api/v1/accounts/${accountId}/import-templates`, {
    templateKind: 'theirs',
    dateFormats: ['YYYY-MM-DD', 'DD/MM/YYYY'],
    ...input,
  });
}
