FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY mirror.mjs ./

USER node
CMD ["node", "mirror.mjs"]
