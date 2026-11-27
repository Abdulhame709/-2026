/**
 * بذور تطوير اختيارية؛ لا تُنشئ حسابات إن كانت بيئة التشغيل إنتاجاً.
 * يجب توفير كلمات مرور فريدة عبر متغيرات البيئة قبل التشغيل.
 */
import { pool } from '../src/infrastructure/db/pool.js';
import { UsersRepository, hashPassword } from '../src/infrastructure/repositories/users.repository.js';
import { securePasswordSchema } from '../src/application/auth.dto.js';
import type { UserRole } from '../src/domain/user.js';

const SEED_USERS: Array<{ username: string; passwordEnv: string; fullName: string; role: UserRole }> = [
  { username: 'admin', passwordEnv: 'SEED_ADMIN_PASSWORD', fullName: 'أحمد المدير', role: 'admin' },
  { username: 'reconciler', passwordEnv: 'SEED_RECONCILER_PASSWORD', fullName: 'سامي المحاسب', role: 'reconciler' },
  { username: 'viewer', passwordEnv: 'SEED_VIEWER_PASSWORD', fullName: 'منى المُطالعة', role: 'viewer' },
];

async function seedUsers() {
  const passwords = SEED_USERS.map((user) => process.env[user.passwordEnv]);
  if (passwords.some((password) => !securePasswordSchema.safeParse(password).success) || new Set(passwords).size !== passwords.length) {
    throw new Error('وفّر كلمات مرور فريدة من 12 حرفاً على الأقل تحتوي حروفاً وأرقاماً: SEED_ADMIN_PASSWORD وSEED_RECONCILER_PASSWORD وSEED_VIEWER_PASSWORD');
  }
  const repo = new UsersRepository(pool);
  for (const u of SEED_USERS) {
    const existing = await repo.findByUsername(u.username);
    if (existing) {
      console.log(`• موجود مسبقاً: ${u.username}`);
      continue;
    }
    await repo.create({
      username: u.username,
      fullName: u.fullName,
      role: u.role,
      passwordHash: await hashPassword(process.env[u.passwordEnv]!),
      createdBy: 0,
      mustChangePassword: true,
    });
    console.log(`✓ أُنشئ: ${u.username} (${u.role})`);
  }
}

// ===== عينات الشركاء (للمعاينة — مضمنة بالرمز) =====
const SEED_PARTNERS = [
  { code: 'SUP-001', nameAr: 'دريم لاند للطباعة والتغليف', phone: '01-234567', currency: 'YER', ledger: '2101' },
  { code: 'SUP-002', nameAr: 'شركة النور للمواد الغذائية', phone: '01-345678', currency: 'YER', ledger: '2102' },
  { code: 'SUP-003', nameAr: 'مؤسسة الأمل التجارية', phone: '01-456789', currency: 'USD', ledger: '2103' },
  { code: 'SUP-004', nameAr: 'مصنع الغربية للبلاستيك', phone: '01-567890', currency: 'SAR', ledger: '2104' },
];

async function seedPartners() {
  for (const p of SEED_PARTNERS) {
    const exists = await pool.query('SELECT id FROM partners WHERE code = $1', [p.code]);
    if (exists.rowCount) {
      console.log(`• مورد موجود مسبقاً: ${p.code}`);
      continue;
    }
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO partners (code, name_ar, phone) VALUES ($1, $2, $3) RETURNING id`,
      [p.code, p.nameAr, p.phone],
    );
    const partnerId = Number(ins.rows[0].id);
    await pool.query(
      `INSERT INTO accounts (partner_id, currency_code, our_ledger_code) VALUES ($1, $2, $3)`,
      [partnerId, p.currency, p.ledger],
    );
    console.log(`✓ مورد: ${p.code} — ${p.nameAr} (${p.currency})`);
  }
  // خريطة مراجع تجريبية لأول مورد (إن لم توجد)
  const first = await pool.query<{ id: string }>(
    `SELECT a.id FROM accounts a JOIN partners p ON p.id = a.partner_id WHERE p.code = 'SUP-001' LIMIT 1`,
  );
  if (first.rowCount) {
    const accId = Number(first.rows[0].id);
    const hasMap = await pool.query('SELECT 1 FROM ref_map_entries WHERE account_id = $1 LIMIT 1', [accId]);
    if (!hasMap.rowCount) {
      await pool.query(
        `INSERT INTO ref_map_entries (account_id, our_ref, their_ref, source) VALUES
           ($1, '7013', '5118', 'manual'), ($1, '7014', '5119', 'manual')`,
        [accId],
      );
      console.log('✓ خريطة مراجع تجريبية لـ SUP-001 (2 ارتباطات)');
    }
  }
}

async function main() {
  if (process.env.NODE_ENV !== 'development') throw new Error('بذور التطوير تتطلب NODE_ENV=development');
  await seedUsers();
  await seedPartners();
}

main()
  .catch((err) => {
    console.error('فشل البذور:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
