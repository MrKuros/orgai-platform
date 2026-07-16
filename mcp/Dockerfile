# Build from the REPO ROOT so the image uses the one true policy engine:
#   docker build -f mcp/Dockerfile -t orgai-comply .
# (A previous version built a stale in-tree fork of packages/core that was
# fail-open on unknown roles — never reintroduce a second copy of the engine.)
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages/core/package.json packages/core/
COPY mcp/package.json mcp/
RUN npm install --workspaces --include-workspace-root
COPY packages/core packages/core
COPY mcp mcp
RUN cd packages/core && npm run build
RUN cd mcp && npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/dist ./node_modules/@comply/core/dist
COPY --from=build /app/packages/core/package.json ./node_modules/@comply/core/package.json
COPY --from=build /app/mcp/dist ./dist
EXPOSE 3000
CMD ["node", "dist/src/http.js"]
