FROM node:lts
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack use pnpm@10.30.0 && pnpm install
COPY . ./
EXPOSE 5173
CMD ["npx", "vite", "dev", "--host"]
