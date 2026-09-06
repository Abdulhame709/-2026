/**
 * عميل API الموحد — نفس الأصل عبر بروكسي vite (/api → الخادم:3000).
 * الكوكي httpOnly يُرسل تلقائياً (نفس الأصل) — لا تخزين للهوية في JS إطلاقاً.
 */

export interface ApiErrorShape {
  code: string;
  messageAr: string;
  traceId?: string;
  details?: unknown;
}

/**
 * رسالة الخطأ للمستخدم = العام + أسباب الحقول (422) — كي لا تصل الشاشات
 * عبارة «المدخلات غير صالحة» عامة بلا سبب يفهمه المالك.
 */
function userMessage(err?: ApiErrorShape): string {
  const base = err?.messageAr ?? 'حدث خطأ غير متوقع';
  const details = Array.isArray(err?.details)
    ? (err.details as Array<{ messageAr?: string }>).map((d) => d?.messageAr).filter(Boolean)
    : [];
  return details.length ? `${base}: ${details.join(' — ')}` : base;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    messageAr: string,
    public readonly traceId?: string,
    public readonly details?: unknown,
  ) {
    super(messageAr);
    this.name = 'ApiError';
  }
}

/**
 * رمز الجلسة البديل (سياق الإطارات المقيّدة فقط): إن رفض المتصفح كوكي الجلسة
 * داخل iframe يعمل النظام عبر ترويسة Bearer. التخزين بحراسة (storage قد يُمنع).
 */
const TOKEN_KEY = 'recon.sessionToken';
// ثلاث طبقات للاحتفاظ برمز الجلسة — الإطارات المقيّدة قد تمنع التخزين،
// وإعادة تحميل الوحدات (HMR) تجدد ذاكرة الوحدة، لذلك النافذة العامة أولاً:
let memoryToken: string | null = null;

function winToken(): string | null | undefined {
  return (window as unknown as { __reconSessionToken?: string | null }).__reconSessionToken;
}

export function storeSessionToken(token: string | null): void {
  memoryToken = token;
  (window as unknown as { __reconSessionToken?: string | null }).__reconSessionToken = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* التخزين ممنوع — النافذة والذاكرة تعملان */
  }
}

function readSessionToken(): string | null {
  return winToken() ?? memoryToken ?? (() => {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  })();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = readSessionToken();
  // القنوات الثلاث معاً: الكوكي (تلقائي) + ترويسة Bearer + ?sid= في الرابط.
  // سبب sid: بوابة معاينة المنصة تَنزِع ترويسة Authorization أثناء العبور
  // (مُثبت بسجل الخادم: الطلب يصل bearer=لا رغم إرفاق المتصفح له) —
  // معامل الاستعلام الوحيد الذي لا تلمسه أي بوابة. الرابط يظهر بسجلات
  // الوسطاء: مقبول في المعاينة، والإنتاج الداخلي يعتمد الكوكي وحده.
  const url =
    token
      ? `${path}${path.includes('?') ? '&' : '?'}sid=${encodeURIComponent(token)}`
      : path;
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
      ...init,
    });
  } catch {
    // الشبكة/الخادم متوقف
    throw new ApiError(0, 'NETWORK', 'تعذر الاتصال بالخادم — تأكد من تشغيله');
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const err = (body as { error?: ApiErrorShape } | null)?.error;
    // 401 = الجلسة انتهت/غير صالحة: تنظيف مركزي + بث حدث يسمعه مزوّد المصادقة
    // فيصفّر الحالة ويحوّل المستخدم لشاشة الدخول تلقائياً (شفاء ذاتي من الحالة الشبحية).
    if (res.status === 401) {
      storeSessionToken(null);
      window.dispatchEvent(new CustomEvent('recon:unauthorized', { detail: { reason: 'expired' } }));
    }
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      userMessage(err),
      err?.traceId,
      err?.details,
    );
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * رفع ملف (multipart/form-data) بنفس قنوات الجلسة الثلاث — Content-Type يتركه
 * المتصفح يضبطه تلقائياً مع boundary الـ form (لا تُحدده يدوياً وإلا انكسر الطلب).
 */
/** رابط تنزيل مباشر (window.open) بنفس قناة sid — للملفات كنسخ الاحتياطي */
export function fileUrl(path: string): string {
  const token = readSessionToken();
  return token ? `${path}${path.includes('?') ? '&' : '?'}sid=${encodeURIComponent(token)}` : path;
}

export async function uploadFile<T>(path: string, file: File, fields: Record<string, string>): Promise<T> {
  const token = readSessionToken();
  const url =
    token
      ? `${path}${path.includes('?') ? '&' : '?'}sid=${encodeURIComponent(token)}`
      : path;
  const form = new FormData();
  form.append('file', file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'تعذر الاتصال بالخادم — تأكد من تشغيله');
  }
  const body = (await res.json().catch(() => null)) as { error?: ApiErrorShape } | null;
  if (!res.ok) {
    const err = body?.error;
    if (res.status === 401) {
      storeSessionToken(null);
      window.dispatchEvent(new CustomEvent('recon:unauthorized', { detail: { reason: 'expired' } }));
    }
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      userMessage(err),
      err?.traceId,
      err?.details,
    );
  }
  return body as T;
}
