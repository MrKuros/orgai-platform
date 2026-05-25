FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages/core /tmp/core
RUN cd /tmp/core && npm install && npm run build
RUN npm install
COPY . .
RUN mkdir -p node_modules/@comply && cp -r /tmp/core/dist node_modules/@comply/core && cp /tmp/core/package.json node_modules/@comply/core/
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src/setup.sh ./dist/setup.sh
COPY --from=build /app/src/mcp/policies.json ./dist/mcp/policies.json
EXPOSE 8080
CMD ["node", "dist/index.js"]
