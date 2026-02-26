FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /tests
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
CMD ["npx", "playwright", "test"]
