# ---------- 构建阶段 ----------
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:24-alpine AS runner
# LibreOffice 用于 Office -> PDF 转换；font-noto-cjk 保证中文正常渲染
RUN apk add --no-cache libreoffice font-noto-cjk ttf-liberation
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs

ENV PORT=3000
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]
