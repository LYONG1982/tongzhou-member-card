FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
COPY --from=build /app/pg-migrations ./pg-migrations
USER node
EXPOSE 8080
CMD ["node","build/runtime.js"]
