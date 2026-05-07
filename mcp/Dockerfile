FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY packages/core ./packages/core
WORKDIR /app/packages/core && npm install && npm run build
WORKDIR /app
COPY . .
RUN mkdir -p node_modules/@comply && cp -r /app/packages/core/dist node_modules/@comply/core
RUN mkdir -p node_modules/@comply && cp -r /app/packages/core/package.json node_modules/@comply/core/package.json
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/http.js"]
