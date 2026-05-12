FROM node:lts-alpine

# 全域性安裝PM2
RUN npm install -g pm2

WORKDIR /app

# 複製package檔案
COPY package*.json ./

# 安裝依賴
RUN npm install

# 複製應用程式碼
COPY . .

# 構建前端應用
RUN cd public && npm install && npm run build

# 刪除前端不必要檔案
RUN rm -rf public/src public/node_modules public/package*.json

# 設定許可權
RUN chmod 777 /app

# 建立日誌目錄
RUN mkdir -p logs

# 暴露埠（通過環境變數SERVICE_PORT控制）
EXPOSE 3000

# 使用PM2啟動應用，並保持容器執行
CMD ["npm", "start"]