FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js failureReporter.js ./
COPY lib ./lib
COPY locales ./locales
EXPOSE 8080
CMD ["node", "server.js"]
