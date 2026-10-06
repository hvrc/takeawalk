# Build the app, then serve it (and the small admin API) with Node on Cloud Run.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund
COPY server/*.mjs ./server/
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "server/server.mjs"]
