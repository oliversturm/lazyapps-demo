FROM node:lts
WORKDIR /app
COPY package.json server.js ./
RUN npm install
EXPOSE 3000
CMD ["node", "--import", "@lazyapps/observability/register.js", "server.js"]
