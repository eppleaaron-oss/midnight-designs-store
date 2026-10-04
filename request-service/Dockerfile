FROM node:24-bookworm-slim
WORKDIR /app
COPY . .
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production DATA_PATH=/data/requests.sqlite PORT=3000
EXPOSE 3000
CMD ["node","server.mjs"]
