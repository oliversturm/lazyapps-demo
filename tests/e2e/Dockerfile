FROM mcr.microsoft.com/playwright:v1.58.2-noble
# Install Docker CLI for container control in failure-recovery E2E tests
RUN apt-get update && apt-get install -y --no-install-recommends docker.io \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /tests
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
CMD ["npx", "playwright", "test"]
