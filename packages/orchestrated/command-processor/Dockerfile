FROM node:lts
WORKDIR /app/command-processor
COPY command-processor/package.json ./
RUN npm install
COPY command-processor/ ./
COPY common/ ../common/
EXPOSE 80
CMD ["node", "--import", "@lazyapps/observability/register.js", "--watch", "index.js"]
