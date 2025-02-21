FROM node:21.6.2-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

FROM node:21.6.2-alpine
WORKDIR /app
COPY --from=builder /app /app
CMD ["node", "src/index.js"]