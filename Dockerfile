# Stage 1: Build React + Vite frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /build/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Production Express backend + built static frontend
FROM node:22-alpine AS runner
WORKDIR /app/backend

ENV NODE_ENV=production

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/src ./src
COPY --from=frontend-builder /build/frontend/dist /app/frontend/dist

RUN chown -R node:node /app
USER node

EXPOSE 3001

CMD ["node", "src/server.js"]
