FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages/core ./packages/core
RUN npm install
WORKDIR /app/packages/core && npm run build
WORKDIR /app
COPY . ./mcp/
WORKDIR /app/mcp && npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/mcp/dist ./mcp/dist
COPY --from=build /app/mcp/package.json ./mcp/package.json
COPY --from=build /app/mcp/src/policies.json ./mcp/dist/policies.json

WORKDIR /app/mcp
EXPOSE 3001
CMD ["node", "dist/http.js"]
