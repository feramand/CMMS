# CMMS

Sistema de gestión de activos y mantenimiento industrial para la imprenta.
Aplicación web adaptable (computador y celular) que se instala en un servidor de la empresa.

## Estado

**Etapa 0 (base) terminada.** Incluye:

- Ingreso: operadores con usuario de Metrics + PIN; técnicos y bodegueros con RUT + PIN;
  perfiles administrativos con RUT o correo + contraseña.
- Bloqueo tras 5 intentos fallidos. Lo restablece el administrador; a técnicos y operadores,
  también el jefe o el planificador.
- Seis perfiles con sus permisos, validados en el servidor.
- Gestión de usuarios y ficha de técnico (especialidad, modalidad, control "Estoy de turno").
- Datos base: 2 plantas, especialidades, 3 turnos, parámetros y bitácora de cambios.
- Instalable en la pantalla de inicio de Android.

Próxima etapa: activos, solicitudes de atención técnica (SAT) y órdenes de trabajo.

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
