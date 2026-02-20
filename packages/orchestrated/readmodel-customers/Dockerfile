FROM node:lts
WORKDIR /app/readmodel-customers
COPY readmodel-customers/package.json ./
RUN npm install
COPY readmodel-customers/ ./
COPY common/ ../common/
EXPOSE 80
CMD ["node", "--import", "@lazyapps/observability/register.js", "--watch", "index.js"]
