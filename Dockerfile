FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
ENV PORT=3000 DB_PATH=/data/agendamento.db NODE_NO_WARNINGS=1
VOLUME /data
EXPOSE 3000
CMD ["node", "src/server.js"]
