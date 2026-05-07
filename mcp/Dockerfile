FROM node:20-alpine AS build
WORKDIR /app
COPY . .
COPY packages/core ./packages/core
RUN npm install
WORKDIR /app/packages/core && npm run build
WORKDIR /app
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
EXPOSE 3001
CMD ["node", "dist/http.js"]
