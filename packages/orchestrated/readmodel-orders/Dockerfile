FROM node:lts
RUN apt-get update && apt-get install -y wget gnupg && \
    wget -qO- https://www.mongodb.org/static/pgp/server-8.0.asc | tee /etc/apt/trusted.gpg.d/mongodb-server-8.0.asc && \
    echo "deb http://repo.mongodb.org/apt/debian $(. /etc/os-release && echo "$VERSION_CODENAME")/mongodb-org/8.0 main" | tee /etc/apt/sources.list.d/mongodb-org-8.0.list && \
    apt-get update && apt-get install -y mongodb-database-tools && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . ./
EXPOSE 80
CMD ["node", "--import", "@lazyapps/observability/register.js", "--watch", "index.js"]
