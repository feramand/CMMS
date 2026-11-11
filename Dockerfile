# Imagen del CMMS para el servidor de la empresa.
FROM node:22-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
# Al iniciar: aplica migraciones, carga datos iniciales (no duplica) y levanta la aplicación.
CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && npm run start"]
