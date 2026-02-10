FROM node:lts
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . ./
EXPOSE 5173
CMD ["npx", "vite", "dev", "--host"]
