# syntax=docker/dockerfile:1
# صورة واحدة تخدم الواجهة و/API على نفس الأصل (الكوكي SameSite=Strict بلا CORS).
# البناء متعدد المراحل: أدوات التطوير لا تدخل الصورة النهائية.

FROM node:22-bookworm-slim AS build-backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:22-bookworm-slim AS build-frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    SERVE_FRONTEND=1 \
    FRONTEND_DIST=/app/frontend/dist
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build-backend /app/backend/dist ./dist
# الهجرات تُقرأ من src/infrastructure/db/migrations وقت التشغيل (scripts/migrate.mjs)
COPY --from=build-backend /app/backend/src/infrastructure/db/migrations ./src/infrastructure/db/migrations
COPY backend/scripts ./scripts
COPY --from=build-frontend /app/frontend/dist /app/frontend/dist
RUN mkdir -p storage/uploads storage/backups storage/tessdata \
    && chmod +x scripts/docker-entrypoint.sh \
    && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/backend/scripts/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
