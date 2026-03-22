FROM node:20-alpine

WORKDIR /app

# Install backend dependencies
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

# Install frontend dependencies and build
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Copy backend source (node_modules excluded via .dockerignore)
COPY backend/ ./backend/

# Create uploads directory
RUN mkdir -p backend/public/uploads && chown -R node:node /app

USER node

ENV NODE_ENV=production
EXPOSE 8888

WORKDIR /app/backend
CMD ["sh", "-c", "node src/setup/setup.js && node src/server.js"]
