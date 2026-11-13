# Print Garage

CMMS: sistema de gestión de activos y mantenimiento industrial para la imprenta.
Aplicación web adaptable (computador y celular) que se instala en un servidor de la empresa.

## Estado

Las etapas 0 a 5 están programadas y probadas con 182 pruebas automáticas. Falta probarlas
con datos reales en el servidor de la empresa.

| Etapa | Contenido | Estado |
| --- | --- | --- |
| 0 | Ingreso, perfiles, usuarios, turnos | Programada |
| 1 | Activos, solicitudes de atención, órdenes de trabajo | Programada |
| 2 | Mantenimiento preventivo e integración con Metrics | Programada; falta el conector real |
| 3 | Bodega de repuestos | Programada; falta la carga desde Maintscape |
| 4 | Compras, costos y contabilidad | Programada; falta el formato para Fin700 |
| 5 | Indicadores y reportes | Programada |
| 6 | Matriz de competencias | Programada |
| — | Modo sin conexión | Fuera del alcance de esta versión |

**Base.** Ingreso con PIN o contraseña, seis perfiles con permisos validados en el servidor,
usuarios, turnos, horarios, feriados y bitácora de cambios.

**Activos.** Ficha técnica, tipos de máquina con plantilla de sistemas, árbol de sistemas por
máquina, estado del equipo, etiqueta con código QR e historial de trabajos.

**Solicitudes y órdenes de trabajo.** Reporte de fallas sin duplicados, toma por un solo
técnico, cierre simple, escalamiento a orden de trabajo con folio AANNNN, trabajo con apoyo,
causa raíz opcional, fotos, tablero Kanban, avisos y notificaciones push.

**Preventivo.** Plan de mantenimiento por máquina con cartillas por contador o por tiempo,
actividades por grupo (operador o especialidad), liberación al 80 %, límite al 120 %, carga del
plan desde Excel e indicador de downtime por falla.

**Cartillas que se alternan.** Si la detención no alcanza para toda la cartilla de menor intervalo,
se divide en dos vueltas: una vez se hacen las tareas A y a la siguiente las B; las tareas AB van
siempre. Esa cartilla se mide por tiempo. Una vuelta incumplida se repite.

**Metrics.** Recibe por HTTPS, con clave en `METRICS_API_KEY`, lecturas de contador
(`/api/metrics/giros`), detenciones clasificadas (`/api/metrics/detenciones`) y el fin de cada
detención (`/api/metrics/fin-detencion`), que cierra el tiempo detenido aunque la solicitud siga abierta.

**Bodega.** Catálogo de repuestos (código interno, código de fabricante obligatorio salvo repuesto genérico declarado, marca, ubicación),
tres almacenes, existencias solo por movimientos, costo por precio medio ponderado, inventarios,
carga desde Excel. Los repuestos se piden desde la orden de trabajo; una entrega parcial manda
el resto a solicitud de compra.

**Compras.** Proveedores, solicitudes de compra visadas por el planificador o el jefe, una o
más órdenes de compra por solicitud, cinco monedas, IVA o exenta, cuenta contable y centro de
costo, cotización adjunta, dos autorizaciones obligatorias (jefe de mantenimiento y gerente de
producción) y una opcional (gerente general), impresión con el formato de la empresa, recepción
parcial o total y Excel de movimientos valorizados para contabilidad.

**Detenciones.** Print Garage solo recibe de Metrics los códigos de Breakdown Downtime (BD): BD
Mecánico, BD Eléctrico, BD SAC y BD General (la falla sin clasificar). Los demás Delay (ajustes
operacionales, esperas) se ignoran. El MTTR y el MTBF se calculan solo sobre BD.

**Indicadores y reportes.** Por período: Breakdown Downtime por máquina y por tipo, MTTR, tiempo de respuesta y
de reparación, MTBF por máquina, cumplimiento del preventivo (a tiempo, con atraso, incumplidas),
solicitudes resueltas sin orden de trabajo, fallas recurrentes y trabajo por técnico en orden
alfabético, sin ranking. Todo se descarga en Excel. La base de soluciones reúne lo que se hizo
ante cada falla, con búsqueda por máquina y texto.

**Matriz de competencias.** Nivel de cada técnico en cada máquina (básico, intermedio, avanzado),
visible en la ficha de la máquina.

**Otros.** Folio inicial de las órdenes de compra configurable por el administrador, verificación
del código impreso en una orden de compra y descarga de las existencias de bodega en Excel.

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

Datos de la empresa para la orden de compra impresa (opcional): `EMPRESA_NOMBRE`, `EMPRESA_RUT`,
`EMPRESA_DIRECCION` y `EMPRESA_FONO` en `.env`. Para el logo, copiar la imagen a una carpeta
`empresa/` junto a `docker-compose.yml` y poner `EMPRESA_LOGO=/datos/empresa/logo.png`.
Ni esos datos ni el logo se guardan en el repositorio.

Las fotos y las cotizaciones adjuntas se guardan en el volumen `cmms_adjuntos`.
**Hay que respaldarlo junto con la base de datos.**

Respaldo de la base de datos:

```bash
docker compose exec db pg_dump -U cmms cmms > respaldo-$(date +%F).sql
```

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `src/db` | Esquema de la base de datos, migraciones y datos iniciales |
| `src/lib` | Reglas de negocio (trabajos, preventivo, bodega, compras, permisos) y sus pruebas |
| `src/app` | Pantallas: ingreso, inicio operativo, portal administrativo, bodega y compras |
| `drizzle` | Migraciones SQL generadas |
