FROM node:lts

RUN npm install -g pnpm 

WORKDIR /src
# We assume that the context root is the
# project folder.
COPY . ./
RUN pnpm i

WORKDIR /src/packages/orchestrated/readmodel-customers

EXPOSE 80

CMD ["node", "--require", "./tracing.cjs", "--watch", "index.js"]
