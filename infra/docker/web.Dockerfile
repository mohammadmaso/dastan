# Development-friendly web image. Runs Next.js dev server.
FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml .npmrc pnpm-lock.yaml* ./
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile=false

COPY . .

EXPOSE 3000
CMD ["pnpm", "--filter", "@storywriter/web", "dev"]
