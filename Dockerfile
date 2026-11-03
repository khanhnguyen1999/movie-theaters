# Image chạy trên Fly.io: Node 20 + better-sqlite3 (cần build tool nếu không tải được bản dựng sẵn)
FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/cinema.db
COPY --from=build /app/node_modules ./node_modules
COPY package.json server.js db.js ./
COPY public ./public
EXPOSE 3000
# chạy node trực tiếp (không qua npm) để nhận được tín hiệu tắt và lưu dữ liệu trước khi thoát
CMD ["node", "server.js"]
