// Datos de la empresa que emite las órdenes de compra. Se definen en la instalación (archivo .env).
export const EMPRESA = {
  nombre: process.env.EMPRESA_NOMBRE || "A Impresores S.A.",
  rut: process.env.EMPRESA_RUT || null,
  direccion: process.env.EMPRESA_DIRECCION || null,
  fono: process.env.EMPRESA_FONO || null,
  /** Nota fija al pie de cada orden de compra. */
  nota:
    process.env.EMPRESA_NOTA_OC ||
    "Estimado proveedor: toda factura emitida a nuestra empresa debe tener registrado el número de nuestra orden de compra; en caso contrario será rechazada.",
};
