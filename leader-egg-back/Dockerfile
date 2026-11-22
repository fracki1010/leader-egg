FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Business timezone. The API reasons about whole local days (dashboard "today",
# order date filters, daily closes) and normalizes dates to local noon, so the
# process MUST run in the business timezone instead of UTC. Alpine ships
# without tzdata, hence the explicit install (without it TZ is ignored and
# every local-day boundary silently falls back to UTC).
RUN apk add --no-cache tzdata
ENV TZ=America/Argentina/Buenos_Aires

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
