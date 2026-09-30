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

# ---------- test ----------
# ⚠️ 必须**先于**任何 prune 派生：
#   旧顺序是 builder 先 `npm prune --omit=dev`，再 `FROM builder AS test`，
#   于是 test 阶段继承的是**已裁剪**的 node_modules —— 注释写「含 devDependencies」
#   与实际相反，vitest/nock/@vitest/coverage-v8 全在 devDependencies 里。
#   后果：容器内跑集成测试时 npx 会联网现拉不受 package-lock 约束的版本
#   （断网即失败），测试依赖与 CI 也不一致。
FROM builder AS test

ENV NODE_ENV=test

COPY vitest.config.ts vitest.integration.config.ts vitest.contract.config.ts ./
COPY tests ./tests

CMD ["npx", "vitest", "run", "--config", "vitest.integration.config.ts"]

# ---------- prod-deps ----------
# 裁剪 devDependencies 后补回 seed 运行所需的最小工具：
#   - prisma CLI（migrate deploy）
#   - tsx（seed.ts 直接跑 TypeScript）
FROM builder AS prod-deps

RUN npm prune --omit=dev && npm install --no-save --no-audit --no-fund prisma@6 tsx@4

# ---------- runtime ----------
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl curl

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# seed.ts 从 src/ 直接导入核心层纯函数（crypto/pricing-math），故运行镜像保留 src/
COPY --from=builder /app/src ./src

# 默认入口 = API；worker 用 command 覆盖为 node dist/worker.js
CMD ["node", "dist/main.js"]
