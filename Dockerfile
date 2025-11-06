# ---- Stage 1: Build ----
FROM node:23-alpine AS build
WORKDIR /app

# Deterministic, cacheable install
COPY package.json package-lock.json ./
RUN npm ci

# Copy sources and build
COPY . .
RUN npm run build

# Archive the build output to avoid hashing quirks when copying many files
RUN tar -C /app -czf /tmp/build.tgz build

# ---- Stage 2: Runtime ----
FROM node:23-alpine AS runtime
WORKDIR /app

# Install only production dependencies against the runtime image ABI
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy server code, static assets, and keys
COPY --from=build /app/backend ./backend
COPY --from=build /app/public ./public
COPY --from=build /app/private-key.pem ./private-key.pem
COPY --from=build /app/public-key.pem ./public-key.pem
COPY --from=build /app/src/isomorphic ./src/isomorphic

# Expand the pre-packed build directory
COPY --from=build /tmp/build.tgz /tmp/build.tgz
RUN mkdir -p /app/build && tar -C /app -xzf /tmp/build.tgz

ENV NODE_ENV=production
ENV PORT=80
EXPOSE 80

# The launcher still runs directly from TypeScript entrypoints. If the build
# process emits compiled JS, switch this to `node build/server/index.js`.
CMD ["/app/node_modules/.bin/ts-node", "--skipProject", "--transpile-only", "./backend/index.ts"]
