# Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install dependencies required for headless browsers
RUN apk add --no-cache \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    libstdc++ \
    libgcc

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm install

# Set environment variables for testing
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    NODE_ENV=test

# Copy source code
COPY . .

# Run tests
RUN npm test

# Production stage
FROM node:20-alpine

# Install dependencies required for headless browsers
RUN apk add --no-cache \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    libstdc++ \
    libgcc

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install && npm cache clean --force

# Set Chrome as default browser and configure optimization flags
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PORT=3000 \
    HOST=0.0.0.0 \
    BROWSER_ARGS="--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu"

# Copy application code
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/app.js ./

# Create non-root user for security
RUN addgroup -S appuser && adduser -S -G appuser appuser && \
    chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "app.js"]
