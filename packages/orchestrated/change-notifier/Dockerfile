FROM node:lts
WORKDIR /app/change-notifier
COPY change-notifier/package.json ./
RUN npm install
COPY change-notifier/ ./
COPY common/ ../common/
RUN ln -s /app/change-notifier/node_modules /app/node_modules
EXPOSE 80
CMD ["node", "--import", "../common/observability-init.js", "--watch", "index.js"]
