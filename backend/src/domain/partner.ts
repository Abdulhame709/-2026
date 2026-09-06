/** أنواع نطاق الشركاء والحسابات (Module 2) — مطابقة لمخطط 001 الحرفي */

export const MATCH_RULES = ['exact_ref', 'ref_map', 'description_ref', 'amount_date'] as const;
export type MatchRuleName = (typeof MATCH_RULES)[number];

export const DEFAULT_RULE_ORDER: MatchRuleName[] = [
  'exact_ref',
  'ref_map',
  'description_ref',
  'amount_date',
];

export interface Partner {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string | null;
  partnerType: 'supplier';
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
}

/** الشريك كما يخرج للواجهة — الحسابات تُضم عند القائمة والتفصيل */
export interface PublicPartner {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  accounts: Account[];
}

export interface Account {
  id: number;
  partnerId: number;
  currencyCode: string;
  ourLedgerCode: string | null;
  dateWindowDays: number;
  ruleOrder: MatchRuleName[];
  isActive: boolean;
}

export interface RefMapEntry {
  id: number;
  accountId: number;
  ourRef: string;
  theirRef: string;
  source: 'manual' | 'auto_confirmed' | 'auto_suggested';
  createdAt: Date;
}

export interface NotifiedAdjustment {
  id: number;
  accountId: number;
  adjustmentDate: string; // YYYY-MM-DD
  adjustmentType: 'discount' | 'return' | 'other';
  amount: number;
  currencyCode: string;
  note: string | null;
  createdAt: Date;
}

export interface ImportTemplate {
  id: number;
  accountId: number | null; // NULL = قالب كشوفنا (ONYX PRO)
  templateKind: 'ours' | 'theirs';
  name: string;
  headerRows: number;
  columnsMapping: Record<string, string>;
  dateFormats: string[];
  decimalSep: string;
  thousandSep: string;
  isDefault: boolean;
}
