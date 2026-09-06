import { ERR } from '../domain/errors.js';
import type { AccountsRepository } from '../infrastructure/repositories/partners.repository.js';
import type { RefMapRepository } from '../infrastructure/repositories/refmap.repository.js';
import type { SessionsRepository } from '../infrastructure/repositories/reconciliation-sessions.repository.js';
import type { MatchesRepository, MatchGroup, MatchGroup as Group, GroupLineItem, StatementLineFull } from '../infrastructure/repositories/matches.repository.js';
import type { AuditRepository } from '../infrastructure/repositories/audit.repository.js';

/**
 * محرّك اقتراحات المطابقة (Module 4) — يجري قواعد الحساب بالترتيب المخزن:
 * exact_ref → ref_map → description_ref → amount_date، ثم التوزيع الجشع
 * (دفعة ↔ عدة فواتير، الأكبر أولاً). Q11: المبلغ يساوي بالضبط (±0.005) دائماً —
 * نافذة الأيام تخص التاريخ وحدها، وما خارجها يُقترح بثقة منخفضة ليحكمه الإنسان.
 * الاقتراحات حالة «suggested» — القبول/الرفض/الربط اليدوي قرار المستخدم.
 */

const EPS = 0.005;

/** ثقة القواعد — تُعرض للمراجع كدليل لا كضمان */
export const RULE_CONFIDENCE: Record<Group['rule'], number> = {
  exact_ref: 1.0,
  ref_map: 0.95,
  description_ref: 0.8,
  amount_date: 0.6,
  manual: 1.0,
};

const normRef = (s: string | null | undefined): string =>
  (s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const amtKey = (n: number): string => Math.abs(n).toFixed(2);

const dateDiffDays = (a: string | null, b: string | null): number => {
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.MAX_SAFE_INTEGER;
  return Math.abs(da - db) / 86_400_000;
};

interface ProposedGroup {
  rule: Group['rule'];
  confidence: number;
  pairKey: string;
  note?: string;
  /** قاعدة قطعية (مرجع + مبلغ متطابقان = نفس المستند) — تؤكد آلياً في وضع auto */
  deterministic: boolean;
  ourItems: Array<{ line: StatementLineFull; portion: number }>;
  theirItems: Array<{ line: StatementLineFull; portion: number }>;
}

export class MatchingService {
  constructor(
    private readonly sessions: SessionsRepository,
    private readonly accounts: AccountsRepository,
    private readonly refMaps: RefMapRepository,
    private readonly matches: MatchesRepository,
    private readonly audit: AuditRepository,
  ) {}

  /** التحقق العام قبل أي عملية: جلسة موجودة + مفتوحة + الكشفان مرتبطان */
  private async requireOpenSession(sessionId: number) {
    const session = await this.sessions.getById(sessionId);
    if (!session) throw ERR.NOT_FOUND();
    if (session.status === 'closed') {
      throw ERR.VALIDATION([{ field: 'status', messageAr: 'الجلسة مغلقة — أعد فتحها أولاً (أدمن)' }]);
    }
    if (!session.ourStatementId || !session.theirStatementId) {
      throw ERR.VALIDATION([{ field: 'statements', messageAr: 'الجلسة تحتاج اعتماد الكشفين (لنا ولهم) قبل المطابقة' }]);
    }
    return session;
  }

  private async requireSessionForGroup(groupId: number) {
    const g = await this.matches.getGroupSession(groupId);
    if (!g) throw ERR.NOT_FOUND();
    return g;
  }

  /**
   * توليد الاقتراحات (المؤكد والمرفوض لا يُمسّان).
   * mode 'auto': القواعد القطعية (مرجع+مبلغ متطابقان) تُؤكد فوراً — النظام يعمل
   * لا ينتظر؛ الملتبس (مبلغ وتاريخ/التوزيع الجشع) يبقى اقتراحاً ليحكمه المراجع.
   * mode 'review': كل شيء اقتراحاً (زر التوليد اليدوي).
   */
  async suggest(actorId: number, sessionId: number, ip: string | null, mode: 'auto' | 'review' = 'review') {
    const session = await this.requireOpenSession(sessionId);
    const account = await this.accounts.getById(session.accountId);
    if (!account) throw ERR.NOT_FOUND();
    const ruleOrder = (account.ruleOrder.length ? account.ruleOrder : ['exact_ref', 'ref_map', 'description_ref', 'amount_date']) as Group['rule'][];

    const { our, their } = await this.matches.sessionLines(sessionId);
    const rejected = await this.matches.rejectedPairKeys(sessionId);

    // إعادة توليد نظيفة: حذف اقتراحات الجولة السابقة أولاً ثم قياس الاستهلاك الحقيقي
    await this.matches.deleteActiveSuggested(sessionId);
    const consumed = await this.matches.consumedMap(sessionId);

    const free = (l: StatementLineFull) => Math.abs(l.signed) - (consumed.get(l.id) ?? 0);
    const isFree = (l: StatementLineFull) => free(l) > EPS;
    const ourFree = our.filter(isFree);
    const theirFree = their.filter(isFree);

    const consume = (l: StatementLineFull) => consumed.set(l.id, Math.abs(l.signed));
    const proposed: ProposedGroup[] = [];

    /** مطابقة 1:1 عامة بأي مفتاح — يبني فهرس بندهم ويجري بنودنا الأحرار */
    const matchOneToOne = (rule: Group['rule'], keyOf: (l: StatementLineFull) => string[]) => {
      const index = new Map<string, StatementLineFull[]>();
      for (const t of theirFree) {
        if (!isFree(t)) continue;
        for (const k of keyOf(t)) {
          const list = index.get(k) ?? [];
          list.push(t);
          index.set(k, list);
        }
      }
      for (const o of ourFree) {
        if (!isFree(o)) continue;
        for (const k of keyOf(o)) {
          const candidates = index.get(k);
          if (!candidates) continue;
          const t = candidates
            .filter((c) => isFree(c))
            .sort((a, b) => dateDiffDays(o.entryDate, a.entryDate) - dateDiffDays(o.entryDate, b.entryDate) || a.id - b.id)[0];
          if (!t) continue;
          const pairKey = `o${o.id}|t${t.id}`;
          if (rejected.has(pairKey)) continue;
          proposed.push({ rule, confidence: RULE_CONFIDENCE[rule], pairKey, deterministic: true, ourItems: [{ line: o, portion: Math.abs(o.signed) }], theirItems: [{ line: t, portion: Math.abs(t.signed) }] });
          consume(o);
          consume(t);
          break;
        }
      }
    };

    const refKeys = (l: StatementLineFull): string[] => {
      const keys: string[] = [];
      const r = normRef(l.ourRef ?? l.theirRef);
      if (r) keys.push(`r:${r}|a:${amtKey(l.signed)}`);
      return keys;
    };

    for (const rule of ruleOrder) {
      if (rule === 'exact_ref') {
        matchOneToOne(rule, refKeys);
      } else if (rule === 'ref_map') {
        const mapEntries = await this.refMaps.listByAccount(session.accountId);
        const theirByNorm = new Map<string, StatementLineFull[]>();
        for (const t of theirFree) {
          const n = normRef(t.theirRef);
          if (!n) continue;
          const list = theirByNorm.get(n) ?? [];
          list.push(t);
          theirByNorm.set(n, list);
        }
        for (const o of ourFree) {
          if (!isFree(o)) continue;
          const n = normRef(o.ourRef);
          if (!n) continue;
          const mapped = mapEntries.filter((m) => normRef(m.ourRef) === n);
          for (const m of mapped) {
            const candidates = (theirByNorm.get(normRef(m.theirRef)) ?? []).filter((c) => isFree(c) && Math.abs(Math.abs(c.signed) - Math.abs(o.signed)) <= EPS);
            const t = candidates.sort((a, b) => dateDiffDays(o.entryDate, a.entryDate) - dateDiffDays(o.entryDate, b.entryDate) || a.id - b.id)[0];
            if (!t) continue;
            const pairKey = `o${o.id}|t${t.id}`;
            if (rejected.has(pairKey)) continue;
            proposed.push({ rule, confidence: RULE_CONFIDENCE[rule], pairKey, deterministic: true, ourItems: [{ line: o, portion: Math.abs(o.signed) }], theirItems: [{ line: t, portion: Math.abs(t.signed) }] });
            consume(o);
            consume(t);
            break;
          }
        }
      } else if (rule === 'description_ref') {
        matchOneToOne(rule, (l) => l.extractedRefs.filter((r) => r.length >= 2).map((r) => `d:${r}|a:${amtKey(l.signed)}`));
      } else if (rule === 'amount_date') {
        // المبلغ يتطابق والتاريخ إرشادي فقط — القيد المتأخر أسبوعين+ شائع وليس شرطاً.
        // تقارب التاريخ يرتّب المرشحين (الأقرب أولاً) ولا يخفض الثقة ولا يمنع الاقتراح؛
        // البقاء اقتراحاً (لا تأكيد آلي) لأن المبلغ وحده قد يجمع مستندين مختلفين.
        const byAmount = new Map<string, StatementLineFull[]>();
        for (const t of theirFree) {
          const k = amtKey(t.signed);
          const list = byAmount.get(k) ?? [];
          list.push(t);
          byAmount.set(k, list);
        }
        for (const o of ourFree) {
          if (!isFree(o)) continue;
          const candidates = (byAmount.get(amtKey(o.signed)) ?? []).filter((c) => isFree(c));
          if (!candidates.length) continue;
          const t = candidates.sort((a, b) => dateDiffDays(o.entryDate, a.entryDate) - dateDiffDays(o.entryDate, b.entryDate) || a.id - b.id)[0];
          const pairKey = `o${o.id}|t${t.id}`;
          if (rejected.has(pairKey)) continue;
          const diff = Math.round(dateDiffDays(o.entryDate, t.entryDate));
          proposed.push({
            rule,
            confidence: RULE_CONFIDENCE[rule],
            pairKey,
            deterministic: false,
            note: diff >= 1 ? `فرق التاريخ ${diff} يوماً — القيد المتأخر شائع، تأكد أنه نفس المستند` : undefined,
            ourItems: [{ line: o, portion: Math.abs(o.signed) }],
            theirItems: [{ line: t, portion: Math.abs(t.signed) }],
          });
          consume(o);
          consume(t);
        }
      }
    }

    // التوزيع الجشع (دفعة ↔ عدة فواتير): الأكبر أولاً حتى يساوي المبلغ بالضبط
    const greedySplit = (
      payments: StatementLineFull[],
      invoices: StatementLineFull[],
      sideOfPayment: 'our' | 'their',
    ) => {
      for (const p of [...payments].sort((a, b) => Math.abs(b.signed) - Math.abs(a.signed))) {
        if (!isFree(p)) continue;
        let remaining = free(p);
        if (remaining <= EPS) continue;
        const picks: StatementLineFull[] = [];
        for (const inv of [...invoices].sort((a, b) => free(b) - free(a))) {
          if (picks.length >= 25) break;
          if (!isFree(inv)) continue;
          const take = free(inv);
          if (take <= remaining + EPS) {
            picks.push(inv);
            remaining -= take;
            if (remaining <= EPS) break;
          }
        }
        if (remaining > EPS || picks.length < 2) continue;
        const pairKey = `${sideOfPayment === 'our' ? 'o' : 't'}${p.id}|${sideOfPayment === 'our' ? 't' : 'o'}${picks.map((x) => x.id).sort((a, b) => a - b).join('+')}`;
        if (rejected.has(pairKey)) continue;
        proposed.push({
          rule: 'amount_date',
          confidence: 0.5,
          pairKey,
          deterministic: false,
          note: 'توزيع دفعة على عدة فواتير (اقتراح آلي قابل للتعديل)',
          ourItems: sideOfPayment === 'our'
            ? [{ line: p, portion: free(p) }]
            : picks.map((inv) => ({ line: inv, portion: free(inv) })),
          theirItems: sideOfPayment === 'our'
            ? picks.map((inv) => ({ line: inv, portion: free(inv) }))
            : [{ line: p, portion: free(p) }],
        });
        consume(p);
        for (const inv of picks) consume(inv);
      }
    };

    greedySplit(our.filter((l) => l.signed < -EPS), their.filter((l) => l.signed > EPS), 'our');
    greedySplit(their.filter((l) => l.signed < -EPS), our.filter((l) => l.signed > EPS), 'their');

    await this.matches.createGroups(
      sessionId,
      actorId,
      proposed.map((p) => ({
        rule: p.rule,
        confidence: p.confidence,
        status: (p.deterministic && mode === 'auto' ? 'confirmed' : 'suggested') as 'suggested' | 'confirmed',
        pairKey: p.pairKey,
        note: p.note,
        // الحصة بإشارة البند نفسه (فاتورتنا دائن موجبة وفاتورتهم مدين موجبة)
        items: [
          ...p.ourItems.map((x): GroupLineItem => ({ lineId: x.line.id, allocated: Math.sign(x.line.signed) * x.portion })),
          ...p.theirItems.map((x): GroupLineItem => ({ lineId: x.line.id, allocated: Math.sign(x.line.signed) * x.portion })),
        ],
      })),
    );

    await this.audit.write({
      actorId,
      action: 'MATCH_SUGGEST',
      entityType: 'session',
      entityId: String(sessionId),
      after: { suggested: proposed.length },
      ip,
    });
    const autoConfirmed = proposed.filter((p) => p.deterministic && mode === 'auto').length;
    return { suggested: proposed.length - autoConfirmed, autoConfirmed };
  }

  /** تحقق مالي موحد لمجموعة: توازن صفر + سعة كل بند + انتماء البنود للجلسة */
  private async validateGroup(sessionId: number, items: GroupLineItem[], excludeGroupId?: number) {
    if (!items.length) throw ERR.VALIDATION([{ field: 'items', messageAr: 'المجموعة بلا بنود' }]);
    const { our, their } = await this.matches.sessionLines(sessionId);
    const all = new Map<number, StatementLineFull>();
    for (const l of [...our, ...their]) all.set(l.id, l);

    const consumed = await this.matches.consumedMap(sessionId);
    let own: Map<number, number> | null = null;
    if (excludeGroupId) {
      const groups = await this.matches.groups(sessionId);
      const g = groups.find((x) => x.id === excludeGroupId);
      if (g) {
        own = new Map();
        for (const it of g.items) {
          const line = all.get(it.lineId);
          if (line) own.set(it.lineId, Math.abs(it.allocated ?? line.signed));
        }
      }
    }

    const ourIds = new Set(our.map((l) => l.id));
    let sumOurs = 0;
    let sumTheirs = 0;
    for (const item of items) {
      const line = all.get(item.lineId);
      if (!line) throw ERR.VALIDATION([{ field: 'items', messageAr: `البند #${item.lineId} لا ينتمي لكشفي هذه الجلسة` }]);
      const portion = item.allocated ?? line.signed;
      // الحصة جزء من البند نفسه → إشارته إشارته دائماً
      if (Math.sign(portion) !== Math.sign(line.signed)) {
        throw ERR.VALIDATION([{ field: 'items', messageAr: `حصة البند #${item.lineId} يجب أن بنفس اتجاه مبلغه` }]);
      }
      const othersUsed = consumed.get(item.lineId) ?? 0;
      const available = Math.abs(line.signed) - (othersUsed - (own?.get(item.lineId) ?? 0));
      if (Math.abs(portion) > available + EPS) {
        throw ERR.VALIDATION([{ field: 'items', messageAr: `حصة البند #${item.lineId} (${Math.abs(portion).toLocaleString('en-US')}) تتجاوز المتاح (${Math.max(0, available).toLocaleString('en-US')})` }]);
      }
      if (ourIds.has(item.lineId)) sumOurs += Math.abs(portion);
      else sumTheirs += Math.abs(portion);
    }
    // التوازن: ما نحصل عليه من جهة يساوي ما يُحاسب من الأخرى (بالمطلق) — Q11
    if (Math.abs(sumOurs - sumTheirs) > EPS) {
      throw ERR.VALIDATION([{ field: 'items', messageAr: `المجموعة غير متوازنة: كشفنا ${sumOurs.toLocaleString('en-US')} ≠ كشفهم ${sumTheirs.toLocaleString('en-US')} — وسّع حصة جهة أو قلّص الأخرى` }]);
    }
  }

  /** ربط يدوي (سحب وإفلات): مؤكد مباشرة — المستخدم هو القاضي */
  async manualGroup(actorId: number, sessionId: number, items: GroupLineItem[], note: string | null, ip: string | null) {
    await this.requireOpenSession(sessionId);
    await this.validateGroup(sessionId, items);
    const [id] = await this.matches.createGroups(sessionId, actorId, [
      { rule: 'manual', confidence: 1, status: 'confirmed', note: note ?? undefined, items },
    ]);
    await this.audit.write({
      actorId,
      action: 'MATCH_MANUAL',
      entityType: 'session',
      entityId: String(sessionId),
      after: { groupId: id, lines: items.length },
      ip,
    });
    return { groupId: id };
  }

  async confirm(actorId: number, groupId: number, ip: string | null) {
    const g = await this.requireSessionForGroup(groupId);
    if (!g.isActive) throw ERR.VALIDATION([{ field: 'group', messageAr: 'المجموعة مرفوضة/مفكوكة' }]);
    if (g.status === 'confirmed') throw ERR.VALIDATION([{ field: 'group', messageAr: 'المجموعة مؤكدة مسبقاً' }]);
    const groups: MatchGroup[] = await this.matches.groups(g.sessionId);
    const group = groups.find((x) => x.id === groupId);
    if (!group) throw ERR.NOT_FOUND();
    await this.validateGroup(g.sessionId, group.items, groupId);
    await this.matches.setStatus(groupId, 'confirmed');
    await this.audit.write({ actorId, action: 'MATCH_CONFIRM', entityType: 'match_group', entityId: String(groupId), after: { rule: g.rule }, ip });
    return { groupId, status: 'confirmed' };
  }

  async reject(actorId: number, groupId: number, ip: string | null) {
    const g = await this.requireSessionForGroup(groupId);
    if (!g.isActive) throw ERR.VALIDATION([{ field: 'group', messageAr: 'المجموعة مرفوضة/مفكوكة مسبقاً' }]);
    if (g.status !== 'suggested') throw ERR.VALIDATION([{ field: 'group', messageAr: 'اقتراح فقط يُرفض — المجموعة المؤكدة تُفكّ' }]);
    await this.matches.deactivate(groupId, actorId);
    await this.audit.write({ actorId, action: 'MATCH_REJECT', entityType: 'match_group', entityId: String(groupId), after: { rule: g.rule }, ip });
    return { groupId, status: 'rejected' };
  }

  async unlink(actorId: number, groupId: number, ip: string | null) {
    const g = await this.requireSessionForGroup(groupId);
    if (!g.isActive) throw ERR.VALIDATION([{ field: 'group', messageAr: 'المجموعة مفكوكة مسبقاً' }]);
    await this.matches.deactivate(groupId, actorId);
    await this.audit.write({ actorId, action: 'MATCH_UNLINK', entityType: 'match_group', entityId: String(groupId), after: { rule: g.rule }, ip });
    return { groupId, status: 'unlinked' };
  }

  /** تعديل حصص التوزيع (قبل التأكيد أو بعده) — التحقق المالي يسبق الحفظ */
  async adjustAllocations(actorId: number, groupId: number, items: GroupLineItem[], ip: string | null) {
    const g = await this.requireSessionForGroup(groupId);
    if (!g.isActive) throw ERR.VALIDATION([{ field: 'group', messageAr: 'لا يُعدَّل رابط مرفوض/مفكوك' }]);
    await this.validateGroup(g.sessionId, items, groupId);
    await this.matches.setAllocations(groupId, items);
    await this.audit.write({ actorId, action: 'MATCH_ADJUST', entityType: 'match_group', entityId: String(groupId), after: { lines: items.length }, ip });
    return { groupId, items: items.length };
  }
}
