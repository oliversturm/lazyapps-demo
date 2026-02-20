FROM node:lts
WORKDIR /app/readmodel-orders
COPY readmodel-orders/package.json ./
RUN npm install
COPY readmodel-orders/ ./
COPY common/ ../common/
EXPOSE 80
CMD ["node", "--import", "@lazyapps/observability/register.js", "--watch", "index.js"]
