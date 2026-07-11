FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
# no per-workspace lockfile in this monorepo, so npm install (not ci)
RUN npm install

FROM base AS build
COPY . .
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# rewrites are baked into the routes manifest at build time, so the self-host
# proxy target must be a build arg (compose service DNS name, host-agnostic)
ARG API_PROXY_URL
ENV API_PROXY_URL=$API_PROXY_URL
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
# next start reads next.config.js at boot (runtime rewrites for self-host proxy)
COPY --from=build /app/next.config.js ./
EXPOSE 3000
CMD ["npm", "start"]
