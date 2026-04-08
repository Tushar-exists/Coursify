FROM node:20-slim

WORKDIR /app

COPY package.json ./

COPY server.mjs ./
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.mjs"]

