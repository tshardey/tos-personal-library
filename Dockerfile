FROM node:20-bookworm

# Docker CLI only (the daemon is the host's, via the mounted socket)
RUN apt-get update \
 && apt-get install -y --no-install-recommends docker.io \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
EXPOSE 5173
CMD ["sh", "-c", "npm install && npm run dev"]
