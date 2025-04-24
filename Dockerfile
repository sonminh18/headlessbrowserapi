FROM node:23-bookworm-slim

RUN apt-get update && apt-get install -y \
    bzip2
# Create app directory
WORKDIR /app

# Copy package files
COPY package.json ./



# Install production dependencies only
RUN npm install -g puppeteer@24.7.1
RUN npx @puppeteer/browsers install chrome-headless-shell@stable --verbose

# Set Chrome as default browser and configure optimization flags
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/app/chrome-headless-shell/linux-135.0.7049.114/chrome-headless-shell-linux64/chrome-headless-shell \
    PORT=3000 \
    HOST=0.0.0.0 \
    BROWSER_ARGS="--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu"

    # Copy application code
COPY lib ./lib
COPY app.js ./
RUN npm i --omit=dev
RUN npm cache clean --force

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "app.js"]
