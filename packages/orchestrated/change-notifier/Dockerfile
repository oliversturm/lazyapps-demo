FROM node:lts
WORKDIR /app
COPY package.json package-lock.json ./
ARG NPM_CONFIG_REGISTRY
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --prefer-offline
COPY . ./
EXPOSE 80
CMD ["node", "--import", "@lazyapps/observability/register.js", "--watch", "index.js"]
