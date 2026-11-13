// Datos de la empresa que emite las órdenes de compra. Se definen en la instalación (archivo .env).
export const EMPRESA = {
  nombre: process.env.EMPRESA_NOMBRE || "A Impresores",
  rut: process.env.EMPRESA_RUT || null,
  giro: process.env.EMPRESA_GIRO || null,
  direccion: process.env.EMPRESA_DIRECCION || null,
};
