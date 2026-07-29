FROM node:20-alpine AS base
RUN apk add --no-cache postgresql16-client tar
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM base AS development
RUN npm install
COPY . .
CMD ["npm", "run", "dev"]

FROM base AS builder
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS production
# Backups shell out to pg_dump, pg_restore and psql. Version 16 to match the
# postgres service in docker-compose: a dump taken by a newer client cannot be
# read back by an older server.
RUN apk add --no-cache postgresql16-client tar
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY package*.json ./
COPY scripts ./scripts
EXPOSE 3001
CMD ["node", "dist/index.js"]
