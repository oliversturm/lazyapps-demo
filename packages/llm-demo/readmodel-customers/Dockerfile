FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack use pnpm@10.30.0 && pnpm install
COPY . ./
EXPOSE 80
CMD ["node", "--import", "@lazyapps/observability/register.js", "--watch", "index.js"]
