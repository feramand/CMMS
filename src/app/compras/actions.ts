"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activos, repuestos, type Moneda, type RolAutorizacion, type TipoOc, type TipoSc } from "@/db/schema";
import { documentoDeFormulario, guardarCotizacion } from "@/lib/adjuntos-core";
import { ejecutar, entero, texto } from "@/lib/accion";
import { numero } from "@/lib/bodega-core";
import {
  anularOc,
  autorizarOc,
  cambiarImputacionOc,
  cerrarOc,
  cerrarSc,
  conformarServicio,
  marcarEnviadaOc,
  ROLES_AUTORIZACION,
  crearSc,
  emitirOc,
  fijarAutorizador,
  gestionaCompras,
  guardarCentro,
  guardarCuenta,
  guardarProveedor,
  rechazarOc,
  recibirOc,
  resolverSc,
  type LineaPedida,
} from "@/lib/compras-core";
import { exigirSesion } from "@/lib/dal";
import { ErrorDeNegocio } from "@/lib/usuarios-core";

function numOpcional(valor: FormDataEntryValue | null, que: string): number | null {
  const n = numero(texto(valor));
  if (Number.isNaN(n)) throw new ErrorDeNegocio(`${que}: "${texto(valor)}" no es un número.`);
  return n;
}

export async function accionCrearSc(f: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/compras/sc/nueva", async () => {
    const items = f.getAll("item").map(texto);
    const cantidades = f.getAll("cantidad");
    const lineas: LineaPedida[] = [];
    for (const [i, item] of items.entries()) {
      if (!item.trim()) continue;
      const cantidad = numOpcional(cantidades[i], `Línea ${i + 1}`);
      if (cantidad === null) throw new ErrorDeNegocio(`Línea ${i + 1}: falta la cantidad.`);
      // Una sugerencia elegida ("CÓDIGO — descripción") queda ligada al catálogo; el resto es texto libre.
      const [codigo, ...resto] = item.split(" — ");
      const [r] = resto.length ? await db.select({ id: repuestos.id }).from(repuestos).where(eq(repuestos.codigo, codigo.trim().toUpperCase())) : [];
      lineas.push({ repuestoId: r?.id ?? null, descripcion: item, cantidad });
    }
    const id = await crearSc(db, actor, { lineas, tipo: texto(f.get("tipo")) as TipoSc, centroCostoId: entero(f.get("centroCostoId")) || null, cuentaId: entero(f.get("cuentaId")) || null, nota: texto(f.get("nota")) });
    return `/compras/sc/${id}`;
  });
}

export async function accionResolverSc(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id"));
  await ejecutar(`/compras/sc/${id}`, () => resolverSc(db, actor, id, f.get("decision") === "aprobar", texto(f.get("motivo"))));
}

export async function accionEmitirOc(f: FormData) {
  const actor = await exigirSesion();
  const scId = entero(f.get("scId"));
  await ejecutar(`/compras/sc/${scId}`, async () => {
    const precios: Record<number, number | null> = {};
    for (const [clave, valor] of f.entries()) {
      if (clave.startsWith("p_")) precios[Number(clave.slice(2))] = numOpcional(valor, "Precio");
    }
    const cotizacion = await documentoDeFormulario(f, "cotizacion");
    const id = await emitirOc(db, actor, {
      scId,
      cuentaId: entero(f.get("cuentaId")) || null,
      centroCostoId: entero(f.get("centroCostoId")) || null,
      ivaExento: f.get("ivaExento") === "on",
      cotizacionRef: texto(f.get("cotizacionRef")),
      referencia: texto(f.get("referencia")),
      proveedorId: entero(f.get("proveedorId")),
      moneda: texto(f.get("moneda")) as Moneda,
      tipo: (texto(f.get("tipo")) || "NACIONAL") as TipoOc,
      incoterm: texto(f.get("incoterm")),
      viaEmbarque: texto(f.get("viaEmbarque")),
      esCapex: f.get("esCapex") === "on",
      fechaEntrega: texto(f.get("fechaEntrega")),
      condicionPago: texto(f.get("condicionPago")),
      nota: texto(f.get("nota")),
      precios,
    });
    if (cotizacion) await guardarCotizacion(db, actor, id, cotizacion);
    return `/compras/oc/${id}`;
  });
}

export async function accionAutorizarOc(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id"));
  await ejecutar(`/compras/oc/${id}`, async () => {
    if (f.get("decision") === "rechazar") await rechazarOc(db, actor, id, texto(f.get("motivo")));
    else await autorizarOc(db, actor, id);
  });
}

export async function accionAnularOc(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id"));
  await ejecutar(`/compras/oc/${id}`, () => anularOc(db, actor, id, texto(f.get("motivo"))));
}

export async function accionRecibirOc(f: FormData) {
  const actor = await exigirSesion();
  const ocId = entero(f.get("id"));
  await ejecutar(`/compras/oc/${ocId}`, async () => {
    const cantidades: Record<number, number | null> = {};
    for (const [clave, valor] of f.entries()) {
      if (clave.startsWith("r_")) cantidades[Number(clave.slice(2))] = numOpcional(valor, "Cantidad recibida");
    }
    await recibirOc(db, actor, {
      ocId,
      almacenId: entero(f.get("almacenId")),
      tipoCambio: numOpcional(f.get("tipoCambio"), "Tipo de cambio"),
      documento: texto(f.get("documento")),
      cantidades,
    });
    return `/compras/oc/${ocId}?aviso=recibida`;
  });
}

export async function accionGuardarProveedor(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id")) || undefined;
  await ejecutar("/compras/proveedores", async () => {
    await guardarProveedor(
      db,
      actor,
      {
        rut: texto(f.get("rut")),
        nombre: texto(f.get("nombre")),
        giro: texto(f.get("giro")),
        contacto: texto(f.get("contacto")),
        email: texto(f.get("email")),
        telefono: texto(f.get("telefono")),
        direccion: texto(f.get("direccion")),
        condicionPago: texto(f.get("condicionPago")),
        esTecnico: f.get("esTecnico") === "on",
        activo: f.get("activo") !== "no",
      },
      id,
    );
  });
}

export async function accionGuardarCatalogo(f: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/compras/contabilidad", async () => {
    const d = { id: entero(f.get("id")) || undefined, codigo: texto(f.get("codigo")), nombre: texto(f.get("nombre")), activo: f.get("activo") !== "no" };
    if (f.get("tipo") === "cuenta") await guardarCuenta(db, actor, d);
    else await guardarCentro(db, actor, d);
  });
}

export async function accionFijarAutorizador(f: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/compras/contabilidad", () => {
    const cargo = texto(f.get("cargo"));
    return fijarAutorizador(db, actor, entero(f.get("usuarioId")), cargo in ROLES_AUTORIZACION ? (cargo as RolAutorizacion) : null);
  });
}

/** Centro de costo al que se imputa lo que consume una máquina. */
export async function accionCentroDeMaquina(f: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/compras/contabilidad", async () => {
    if (!gestionaCompras(actor)) throw new ErrorDeNegocio("Solo abastecimiento puede hacer esto.");
    await db
      .update(activos)
      .set({ centroCostoId: entero(f.get("centroCostoId")) || null })
      .where(eq(activos.id, entero(f.get("activoId"))));
  });
}

export async function accionCerrarSc(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id"));
  await ejecutar(`/compras/sc/${id}`, () => cerrarSc(db, actor, id));
}

export async function accionImputacionOc(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id"));
  await ejecutar(`/compras/oc/${id}`, () =>
    cambiarImputacionOc(db, actor, id, { cuentaId: entero(f.get("cuentaId")), centroCostoId: entero(f.get("centroCostoId")) }),
  );
}

export async function accionAdjuntarCotizacion(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id"));
  await ejecutar(`/compras/oc/${id}`, async () => {
    const doc = await documentoDeFormulario(f, "cotizacion");
    if (!doc) throw new ErrorDeNegocio("Elige el archivo de la cotización.");
    await guardarCotizacion(db, actor, id, doc);
  });
}

export async function accionEnviadaOc(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id"));
  await ejecutar(`/compras/oc/${id}`, () => marcarEnviadaOc(db, actor, id));
}

export async function accionConformarServicio(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id"));
  await ejecutar(`/compras/oc/${id}`, () => conformarServicio(db, actor, id, texto(f.get("factura"))));
}

export async function accionCerrarOc(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id"));
  await ejecutar(`/compras/oc/${id}`, () => cerrarOc(db, actor, id, texto(f.get("nota"))));
}
