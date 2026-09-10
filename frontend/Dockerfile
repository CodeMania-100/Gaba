# Production image for the Gabay pricing-demo Next.js frontend.
#
# Node build stage -> npm ci -> npm run build (output: "standalone", see
# next.config.ts) -> minimal Node runtime stage running server.js.
#
# NEXT_PUBLIC_* variables are inlined into the client bundle at BUILD time,
# not read at container start -- NEXT_PUBLIC_API_BASE_URL therefore has to be
# a build ARG, not just a runtime ENV. It defaults to "" (same-origin
# production: the browser calls /api/v1/... on whatever host served the
# page, e.g. https://gaba.eventdecor.co.il/api/v1/...). Local development
# is unaffected -- it keeps using NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
# from the dev server, this Dockerfile is an additional path, not a
# replacement for `next dev`.

FROM node:24-alpine AS builder
WORKDIR /app

# Install dependencies from the committed lockfile only -- never relies on a
# local node_modules being present or matching.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_API_BASE_URL=""
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------------------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Next.js's standalone output intentionally omits public/ and .next/static --
# both must be copied in by hand or static assets (including the MapLibre
# worker/shared .mjs files under public/maplibre-gl/, which fix the blank-map
# bug) 404 in production even though the build succeeded. This is the exact
# failure mode task item 6 calls a deployment blocker.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
