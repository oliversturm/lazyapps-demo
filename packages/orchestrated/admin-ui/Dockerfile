FROM node:lts
WORKDIR /app
COPY package.json ./
RUN npm install
EXPOSE 3000
CMD ["node", "node_modules/@lazyapps/admin-ui/build/index.js"]
