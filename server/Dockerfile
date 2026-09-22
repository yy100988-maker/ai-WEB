# ---------- build ----------
FROM node:22-alpine AS builder

WORKDIR /app

# openssl 供 Prisma 引擎使用
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# 裁剪 devDependencies 后补回 seed 运行所需的最小工具：
#   - prisma CLI（migrate deploy）
#   - tsx（seed.ts 直接跑 TypeScript）
RUN npm prune --omit=dev && npm install --no-save --no-audit --no-fund prisma@6 tsx@4

# ---------- test ----------
# 含 devDependencies + 测试源码，仅用于在服务器/CI 跑集成与 E2E。
# 生产部署**不使用**此 target（体积与攻击面都更大）。
FROM builder AS test

ENV NODE_ENV=test

COPY vitest.config.ts vitest.integration.config.ts vitest.contract.config.ts ./
COPY tests ./tests

CMD ["npx", "vitest", "run", "--config", "vitest.integration.config.ts"]

# ---------- runtime ----------
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl curl

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# seed.ts 从 src/ 直接导入核心层纯函数（crypto/pricing-math），故运行镜像保留 src/
COPY --from=builder /app/src ./src

# 默认入口 = API；worker 用 command 覆盖为 node dist/worker.js
CMD ["node", "dist/main.js"]
