FROM node:lts
WORKDIR /app/readmodel-customers
COPY readmodel-customers/package.json ./
RUN npm install
COPY readmodel-customers/ ./
COPY common/ ../common/
RUN ln -s /app/readmodel-customers/node_modules /app/node_modules
EXPOSE 80
CMD ["node", "--import", "../common/observability-init.js", "--watch", "index.js"]
