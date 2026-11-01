FROM node:20-slim
WORKDIR /app
COPY server.js requireSecret.js failureReporter.js ./
ENV PORT=3466
EXPOSE 3466
CMD ["node", "server.js"]
