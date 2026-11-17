FROM node:22-alpine

WORKDIR /app

# Archivos de la aplicación y el servidor (sin dependencias externas)
COPY index.html data.json ./
COPY css ./css
COPY img ./img
COPY js ./js
COPY servidor/servidor.js ./servidor/servidor.js

RUN mkdir -p /app/servidor/respaldos

ENV HOST=0.0.0.0
ENV PUERTO=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PUERTO || 8080) + '/salud').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "servidor/servidor.js"]
