# Print Garage

CMMS: sistema de gestión de activos y mantenimiento industrial para la imprenta.
Aplicación web adaptable (computador y celular) que se instala en un servidor de la empresa.

## Estado

**Etapa 0 (base): terminada.** Ingreso con PIN o contraseña, seis perfiles con permisos,
gestión de usuarios, turnos y datos base.

**Etapa 1 (activos, solicitudes y órdenes de trabajo): terminada.**

- Activos con ficha técnica editable, sectores, historial y aviso de fallas recurrentes.
- Solicitudes de atención (SAT): reporte manual sin duplicados, toma por un solo técnico,
  asignación por jefatura, cierre simple (sector + solución) y escalamiento a orden de trabajo.
- Órdenes de trabajo con folio AANNNN, estados, asignación, repuestos y causa raíz opcional.
- Trabajo con apoyo, solicitud de repuesto con máquina heredada y entrega por bodega.
- Fotos adjuntas al reportar, al cerrar y al pedir repuestos.
- Tablero Kanban de solicitudes y órdenes de trabajo.
- Avisos dentro de la aplicación y notificaciones push al celular.
- Carga inicial de activos y usuarios desde Excel, con plantillas descargables.
- Horario semanal de técnicos de horario fijo, feriados y apagado automático del turno.

Próxima etapa: mantenimiento preventivo (pautas por tiempo y por giros) e integración con Metrics.

## Tecnología

Next.js (TypeScript), PostgreSQL 16, Drizzle ORM, Tailwind CSS, Vitest.

## Desarrollo local

Requiere Node.js 22 y PostgreSQL 16.

```bash
npm ci
cp .env.example .env        # completar DATABASE_URL y SESSION_SECRET
npm run db:migrate
ADMIN_RUT=11.111.111-1 ADMIN_NOMBRE="Admin" ADMIN_CLAVE="una-clave-larga" npm run db:seed
npm run dev
```

## Pruebas

```bash
npm run typecheck
npm run lint
DATABASE_URL_TEST=postgres://cmms:cmms@localhost:5432/cmms_test npm test
```

Las pruebas de integración usan una base de datos aparte y **borran sus tablas de usuarios**:
`DATABASE_URL_TEST` nunca debe apuntar a la base real. Sin esa variable se omiten.

## Instalación en el servidor (Docker)

```bash
cp .env.example .env        # completar POSTGRES_PASSWORD, SESSION_SECRET y los datos del primer administrador
docker compose up -d --build
```

La aplicación queda en el puerto 3000 del servidor, solo accesible localmente.
TI debe poner delante un proxy inverso con **HTTPS y certificado válido**: sin HTTPS no funciona
el ingreso ni la instalación en Android.

Notificaciones push (opcional): generar un par de claves y copiarlas en `.env`.

```bash
npx web-push generate-vapid-keys
```

Las fotos adjuntas se guardan en el volumen `cmms_adjuntos`. **Hay que respaldarlo junto con la base de datos.**

Respaldo de la base de datos:

```bash
docker compose exec db pg_dump -U cmms cmms > respaldo-$(date +%F).sql
```

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `src/db` | Esquema de la base de datos, migraciones y datos iniciales |
| `src/lib` | Reglas de negocio (ingreso, usuarios, permisos, RUT) y sus pruebas |
| `src/app` | Pantallas: ingreso, inicio operativo y portal administrativo |
| `drizzle` | Migraciones SQL generadas |
