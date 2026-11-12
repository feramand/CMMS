"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activos, repuestos, type Moneda } from "@/db/schema";
import { ejecutar, entero, texto } from "@/lib/accion";
import { numero } from "@/lib/bodega-core";
import {
  anularOc,
  autorizarOc,
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
    const id = await crearSc(db, actor, { lineas, centroCostoId: entero(f.get("centroCostoId")) || null, nota: texto(f.get("nota")) });
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
    const id = await emitirOc(db, actor, {
      scId,
      proveedorId: entero(f.get("proveedorId")),
      moneda: texto(f.get("moneda")) as Moneda,
      fechaEntrega: texto(f.get("fechaEntrega")),
      condicionPago: texto(f.get("condicionPago")),
      nota: texto(f.get("nota")),
      precios,
    });
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
  await ejecutar("/compras/contabilidad", () => fijarAutorizador(db, actor, entero(f.get("usuarioId")), f.get("puede") === "si"));
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
