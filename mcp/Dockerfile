FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN rm -rf dist && rm -rf packages/core/node_modules && cd packages/core && npm install && npm run build
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/dist ./dist
RUN mkdir -p node_modules/@comply && cp -r packages/core/dist node_modules/@comply/core && cp packages/core/package.json node_modules/@comply/core/package.json
EXPOSE 3000
CMD ["node", "dist/src/http.js"]
