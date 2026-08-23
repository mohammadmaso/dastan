# Development-friendly API image. Runs the Fastify server with hot reload.
FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Copy workspace manifests first for better layer caching
COPY package.json pnpm-workspace.yaml .npmrc pnpm-lock.yaml* ./
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile=false

# Copy source
COPY . .

EXPOSE 3001
CMD ["pnpm", "--filter", "@storywriter/api", "dev"]
