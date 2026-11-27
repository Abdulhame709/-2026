/**
 * عميل API الموحد — نفس الأصل عبر بروكسي vite (/api → الخادم:3000).
 * الكوكي httpOnly يُرسل تلقائياً (نفس الأصل)؛ Bearer اختياري ويُحفظ بذاكرة الوحدة فقط.
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

let memoryToken: string | null = null;

export function storeSessionToken(token: string | null): void {
  memoryToken = token;
}

function readSessionToken(): string | null {
  return memoryToken;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = readSessionToken();
  let res: Response;
  try {
    res = await fetch(path, {
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

/** رابط تنزيل مباشر يعتمد على كوكي الجلسة؛ لا تُوضع رموز الجلسة في URL. */
export function fileUrl(path: string): string {
  return path;
}

export async function openFile(path: string, filename?: string): Promise<void> {
  const token = readSessionToken();
  if (!token) {
    window.open(path, '_blank', 'noopener');
    return;
  }
  const tab = filename ? null : window.open('about:blank', '_blank');
  if (tab) tab.opener = null;
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'تعذر تنزيل الملف');
    const objectUrl = URL.createObjectURL(await response.blob());
    if (filename || !tab) {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename ?? 'report.pdf';
      link.click();
    } else {
      tab.location.href = objectUrl;
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 300_000);
  } catch (error) {
    tab?.close();
    throw error;
  }
}

/** رفع multipart؛ يضبط المتصفح Content-Type مع boundary تلقائياً. */
export async function uploadFile<T>(path: string, file: File, fields: Record<string, string>): Promise<T> {
  const token = readSessionToken();
  const form = new FormData();
  form.append('file', file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  let res: Response;
  try {
    res = await fetch(path, {
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
