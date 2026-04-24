# Use Node base image
FROM node:22-alpine

# Install nginx for serving the build
RUN apk add --no-cache nginx

WORKDIR /app

# Install dependencies (cached unless package.json changes)
COPY package*.json ./
RUN npm install

# Copy source code (this might contain changes)
COPY . .

# Setup Nginx configuration
RUN mkdir -p /run/nginx
COPY nginx.conf /etc/nginx/http.d/default.conf
RUN mkdir -p /var/lib/nginx/html

EXPOSE 80

# This CMD will run every time the container starts
# It rebuilds the app and then starts Nginx
CMD ["sh", "-c", "npm run build && rm -rf /var/lib/nginx/html/* && cp -r dist/* /var/lib/nginx/html/ && nginx -g 'daemon off;'"]
