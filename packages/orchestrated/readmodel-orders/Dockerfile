FROM node:lts
WORKDIR /app/readmodel-orders
COPY readmodel-orders/package.json ./
RUN npm install
COPY readmodel-orders/ ./
COPY common/ ../common/
RUN ln -s /app/readmodel-orders/node_modules /app/node_modules
EXPOSE 80
CMD ["node", "--import", "@lazyapps/observability/register.js", "--watch", "index.js"]
