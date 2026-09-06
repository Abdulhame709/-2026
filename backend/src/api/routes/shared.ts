import type { Request } from 'express';
import { ERR } from '../../domain/errors.js';

/** أدوات مشتركة للمسارات — معرف رقمي صحيح أو 404، وعنوان العميل الحقيقي */
export function parseId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw ERR.NOT_FOUND();
  return id;
}

export function clientIp(req: Request): string | null {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null;
}
