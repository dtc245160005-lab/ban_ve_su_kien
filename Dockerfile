FROM node:18-alpine

# Tạo thư mục làm việc trong container
WORKDIR /app

# Cài đặt thư viện trước (giúp tối ưu cache)
COPY package*.json ./
RUN npm install

# Copy toàn bộ mã nguồn vào
COPY . .

# Mở cổng 8090
EXPOSE 8090

# Khởi động ứng dụng
CMD ["node", "index.js"]