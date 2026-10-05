# vibe-proxy: the slice 1 platform proxy. Build context is the platform/ directory.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY vibe-proxy ./vibe-proxy
COPY proxy-app ./proxy-app
COPY store ./store
COPY auth ./auth
COPY data ./data
COPY storage ./storage
COPY pay ./pay
# tests and fixtures are not needed at run time
RUN rm -rf vibe-proxy/test proxy-app/test store/test auth/test data/test storage/test pay/test
USER node
EXPOSE 8080
CMD ["node", "proxy-app/index.js"]
