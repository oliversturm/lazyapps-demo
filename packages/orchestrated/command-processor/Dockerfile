FROM node:lts
WORKDIR /app/command-processor
COPY command-processor/package.json ./
RUN npm install
COPY command-processor/ ./
COPY common/ ../common/
RUN ln -s /app/command-processor/node_modules /app/node_modules
EXPOSE 80
CMD ["node", "--import", "../common/observability-init.js", "--watch", "index.js"]
