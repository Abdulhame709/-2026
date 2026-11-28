import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './infrastructure/db/pool.js';
import { UsersRepository } from './infrastructure/repositories/users.repository.js';
import {
  PartnersRepository,
  AccountsRepository,
} from './infrastructure/repositories/partners.repository.js';
import { StatementsRepository } from './infrastructure/repositories/statements.repository.js';
import { AuthSessionsRepository } from './infrastructure/repositories/sessions.repository.js';
import { AuditRepository } from './infrastructure/repositories/audit.repository.js';
import { AuthService } from './application/auth.service.js';
import { sessionMiddleware } from './api/middleware/session.js';
import { errorHandler, notFoundHandler } from './api/middleware/error.js';
import { authRoutes } from './api/routes/auth.routes.js';
import { usersRoutes } from './api/routes/users.routes.js';
import { auditRoutes } from './api/routes/audit.routes.js';
import { partnersRoutes } from './api/routes/partners.routes.js';
import { accountsRoutes, templatesRoutes } from './api/routes/accounts.routes.js';
import { statementsRoutes } from './api/routes/statements.routes.js';
import {
  PartnerService,
} from './application/partner.service.js';
import { StatementService } from './application/statement.service.js';
import { SessionService } from './application/sessions.service.js';
import { MatchingService } from './application/matching.service.js';
import { ReportExportService } from './application/report-export.service.js';
import { OcrService } from './application/ocr.service.js';
import { SessionsRepository } from './infrastructure/repositories/reconciliation-sessions.repository.js';
import { MatchesRepository } from './infrastructure/repositories/matches.repository.js';
import { DiscrepanciesRepository } from './infrastructure/repositories/discrepancies.repository.js';
import { sessionsRoutes } from './api/routes/sessions.routes.js';
import { discrepanciesRoutes, reasonCodesRoutes } from './api/routes/discrepancies.routes.js';
import { settingsRoutes, reasonAdminRoutes, backupsRoutes } from './api/routes/settings.routes.js';
import { BackupService } from './application/backup.service.js';
import { SettingsRepository } from './infrastructure/repositories/settings.repository.js';
import { DiscrepancyService } from './application/discrepancy.service.js';
import { RefMapRepository } from './infrastructure/repositories/refmap.repository.js';
import { AdjustmentsRepository } from './infrastructure/repositories/adjustments.repository.js';
import { TemplatesRepository } from './infrastructure/repositories/templates.repository.js';

/**
 * خادم نظام مطابقة الكشوفات — Express 5 + PostgreSQL (D10).
 * الطبقات: api → application (خدمات) → infrastructure (مستودعات) — اتجاه الاعتماد للداخل دائماً.
 */

const app = express();
// خلف وكيل HTTPS (Render/Caddy/Netlify) نحتاج قراءة X-Forwarded-Proto/IP،
// وإلا صار req.protocol = http ورفض فحص المصدر كل طلب كتابة. القيم:
// false (محلي) | loopback | true | عدد قفزات موثوقة.
const trustProxyEnv = process.env.TRUST_PROXY?.trim().toLowerCase();
const trustProxy: boolean | number | 'loopback' =
  trustProxyEnv === 'true'
    ? true
    : trustProxyEnv === 'loopback'
      ? 'loopback'
      : trustProxyEnv && Number.isInteger(Number(trustProxyEnv))
        ? Number(trustProxyEnv)
        : false;
app.set('trust proxy', trustProxy);
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));

// رؤوس أمان أساسية (تُستكمل مع HTTPS الداخلي)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// الخدمات (تجميع التبعيات يدوياً — بدون أطر DI)
const auditRepo = new AuditRepository(pool);
const accountsRepo = new AccountsRepository(pool);
const sessionsRepo = new SessionsRepository(pool);
const matchesRepo = new MatchesRepository(pool);
const discrepanciesRepo = new DiscrepanciesRepository(pool);
const statementService = new StatementService(
  accountsRepo,
  new TemplatesRepository(pool),
  new StatementsRepository(pool),
  auditRepo,
  sessionsRepo,
);
const sessionService = new SessionService(pool, sessionsRepo, accountsRepo, matchesRepo, auditRepo, discrepanciesRepo);
const settingsRepo = new SettingsRepository(pool);
const backupService = new BackupService(pool, auditRepo);
const discrepancyService = new DiscrepancyService(discrepanciesRepo, sessionsRepo, auditRepo, settingsRepo);
const ocrService = new OcrService();
const reportExportService = new ReportExportService({
  sessions: sessionService,
  discrepancies: discrepancyService,
  settings: settingsRepo,
});
const matchingService = new MatchingService(
  sessionsRepo,
  accountsRepo,
  new RefMapRepository(pool),
  matchesRepo,
  auditRepo,
);
const partnerService = new PartnerService(
  new PartnersRepository(pool),
  new AccountsRepository(pool),
  new RefMapRepository(pool),
  new AdjustmentsRepository(pool),
  new TemplatesRepository(pool),
  auditRepo,
);
const authService = new AuthService(
  new UsersRepository(pool),
  new AuthSessionsRepository(pool),
  auditRepo,
);

app.use(sessionMiddleware(authService));

const api = express.Router();

// أصول إضافية موثوقة (الواجهة على Netlify تُمرّر /api إلى هذا الخادم، فيصل
// Origin باسم نطاق Netlify بينما Host هو نطاق الخادم). تُضبط صراحةً لا تلقائياً.
const extraOrigins = new Set(
  (process.env.PUBLIC_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean),
);

api.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const host = req.get('host');
  const fetchSite = req.get('sec-fetch-site');
  const sameOrigin = origin === `${req.protocol}://${host}`;
  if ((origin && !sameOrigin && !extraOrigins.has(origin.replace(/\/$/, '')))
    || (!origin && (req.headers.cookie || (fetchSite && fetchSite !== 'same-origin')))) {
    res.status(403).json({ error: { code: 'INVALID_ORIGIN', messageAr: 'مصدر الطلب غير مسموح' } });
    return;
  }
  next();
});

api.use((req, res, next) => {
  if (req.user?.mustChangePassword && !['/auth/me', '/auth/logout', '/auth/change-password'].includes(req.path)) {
    res.status(403).json({ error: { code: 'PASSWORD_CHANGE_REQUIRED', messageAr: 'يجب تغيير كلمة المرور قبل متابعة العمل' } });
    return;
  }
  next();
});

api.get('/health', async (_req, res) => {
  const db = await pool.query('SELECT 1');
  res.json({ status: 'ok', db: db.rowCount === 1 ? 'up' : 'down', version: '0.1.0' });
});

api.use('/auth', authRoutes(authService));
api.use('/users', usersRoutes(authService));
api.use('/audit-log', auditRoutes(auditRepo));
api.use('/partners', partnersRoutes(partnerService));
api.use('/accounts', accountsRoutes(partnerService));
api.use('/import-templates', templatesRoutes(partnerService));
api.use('/statements', statementsRoutes(statementService, matchingService, ocrService));
api.use('/sessions', sessionsRoutes(sessionService, matchingService, reportExportService));
api.use('/discrepancies', discrepanciesRoutes(discrepancyService));
api.use('/reason-codes', reasonCodesRoutes(discrepancyService));
api.use('/reason-codes', reasonAdminRoutes(settingsRepo, auditRepo));
api.use('/settings', settingsRoutes(settingsRepo, auditRepo));
api.use('/backups', backupsRoutes(backupService));

app.use('/api/v1', api);

// خدمة الواجهة المبنية من نفس الأصل (نشر بخدمة واحدة: حاوية أو VPS).
// تُفعَّل تلقائياً عند وجود frontend/dist، أو صراحةً بـSERVE_FRONTEND=1،
// حتى لا تغطي مسار 404 في التطوير المحلي حيث الواجهة على Vite.
const frontendDist = process.env.FRONTEND_DIST?.trim()
  || path.resolve(process.cwd(), '..', 'frontend', 'dist');
const serveFrontend = process.env.SERVE_FRONTEND === '1'
  || fs.existsSync(path.join(frontendDist, 'index.html'));
if (serveFrontend) {
  app.use(express.static(frontendDist, {
    index: false,
    setHeaders: (res, filePath) => {
      const name = path.basename(filePath);
      if (name === 'index.html' || name === 'sw.js') res.setHeader('Cache-Control', 'no-cache');
      else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  // أي مسار غير /api يعيد index.html (توجيه React Router) — Express 5 لا يقبل '*'.
  app.get(/^\/(?!api(\/|$)).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = Number(process.env.PORT ?? 3000);
// HOST يبقى loopback افتراضياً (الوضع المحلي الآمن). في السحابة: إما وكيل HTTPS
// على نفس الجهاز (يبقى 127.0.0.1) أو حاوية خلف موازن حمل (HOST=0.0.0.0).
const HOST = process.env.HOST?.trim() || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`✅ الخادم يعمل على http://${HOST}:${PORT} — /api/v1/health`);
});
