FROM node:lts
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . ./
EXPOSE 80
CMD ["node", "--import", "./observability-init.js", "--watch", "index.js"]
