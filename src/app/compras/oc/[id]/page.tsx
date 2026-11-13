import { asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChipOc, MenuCompras } from "@/componentes/compras";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, botonSecundario, campo, Dato, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { adjuntos, almacenes, lineasRecepcion, ordenesCompra, recepciones, usuarios } from "@/db/schema";
import { operaBodega } from "@/lib/bodega-core";
import { folioOc, folioSc, gestionaCompras, rolDe, ROLES_AUTORIZACION, ROLES_OBLIGATORIOS, TIPOS_OC, visaCompras } from "@/lib/compras-core";
import { listarAlmacenes } from "@/lib/consultas-bodega";
import { listarCentros, listarCuentas, listarOc } from "@/lib/consultas-compras";
import { exigirPerfil } from "@/lib/dal";
import { cant, monto, pesos } from "@/lib/formato";
import { fechaHora } from "@/lib/tiempo";
import {
  accionAdjuntarCotizacion,
  accionAnularOc,
  accionAutorizarOc,
  accionCerrarOc,
  accionConformarServicio,
  accionEnviadaOc,
  accionImputacionOc,
  accionRecibirOc,
} from "../../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; aviso?: string }> };

export default async function Oc({ params, searchParams }: Props) {
  const usuario = await exigirPerfil("ABASTECIMIENTO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "BODEGUERO");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { error, aviso } = await searchParams;
  const [[oc], [yo], listaAlmacenes, cuentas, centros, cotizaciones, recs] = await Promise.all([
    listarOc(eq(ordenesCompra.id, id), 1),
    db.select({ perfil: usuarios.perfil, puedeAutorizarOc: usuarios.puedeAutorizarOc, cargoOc: usuarios.cargoOc }).from(usuarios).where(eq(usuarios.id, usuario.id)),
    listarAlmacenes(),
    listarCuentas(),
    listarCentros(),
    db.select({ id: adjuntos.id, nombre: adjuntos.nombreOriginal, tipo: adjuntos.tipo }).from(adjuntos).where(eq(adjuntos.ocId, id)).orderBy(asc(adjuntos.id)),
    db
      .select({ id: recepciones.id, fecha: recepciones.fecha, documento: recepciones.documento, tipoCambio: recepciones.tipoCambio, almacen: almacenes.nombre, quien: usuarios.nombre })
      .from(recepciones)
      .innerJoin(almacenes, eq(almacenes.id, recepciones.almacenId))
      .innerJoin(usuarios, eq(usuarios.id, recepciones.usuarioId))
      .where(eq(recepciones.ocId, id))
      .orderBy(asc(recepciones.id)),
  ]);
  if (!oc) notFound();
  const detalle = recs.length ? await db.select().from(lineasRecepcion).where(inArray(lineasRecepcion.recepcionId, recs.map((r) => r.id))).orderBy(asc(lineasRecepcion.id)) : [];
  const miRol = yo ? rolDe(yo) : null;
  const yaFirme = oc.autorizaciones.some((a) => a.rol === miRol || a.usuarioId === usuario.id);
  const vigente = oc.estado !== "RECHAZADA" && oc.estado !== "ANULADA";
  const obligatorias = oc.autorizaciones.filter((a) => ROLES_OBLIGATORIOS.includes(a.rol)).length;
  // El gerente general puede firmar aunque la orden ya esté autorizada; los otros dos, solo mientras está emitida.
  const firmo = (rol: string) => oc.autorizaciones.some((a) => a.rol === rol);
  // Ruta de aprobación en orden: jefe de mantenimiento → gerente de producción → gerente general (opcional).
  const meToca =
    miRol === "JEFE_MANTENIMIENTO"
      ? oc.estado === "EMITIDA"
      : miRol === "GERENTE_PRODUCCION"
        ? oc.estado === "EMITIDA" && firmo("JEFE_MANTENIMIENTO")
        : miRol === "GERENTE_GENERAL" && vigente && firmo("GERENTE_PRODUCCION");
  const puedeFirmar = Boolean(miRol) && !yaFirme && meToca;
  const servicio = oc.scTipo === "SERVICIO";
  const cerrada = Boolean(oc.cerradaEn);
  const almacenesAptos = listaAlmacenes.filter((a) => a.esCapex === oc.esCapex);
  const gestiona = gestionaCompras(usuario);
  const editable = gestiona && (oc.estado === "EMITIDA" || oc.estado === "AUTORIZADA");
  const recibible = !servicio && !cerrada && (oc.estado === "AUTORIZADA" || oc.estado === "RECIBIDA_PARCIAL");
  const autorizada = oc.estado === "AUTORIZADA" || oc.estado === "RECIBIDA_PARCIAL" || oc.estado === "RECIBIDA_TOTAL";
  const m = (n: number, dec = 2) => monto(n, oc.moneda, dec);
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">Orden de compra {folioOc(oc.id)}</h1>
            <ChipOc estado={oc.estado} cerrada={cerrada} />
          </div>
          <Link href={`/compras/oc/${oc.id}/imprimir`} className={botonSecundario}>
            {oc.codigoVerificacion ? "Imprimir o guardar en PDF" : "Imprimir borrador"}
          </Link>
        </div>
        <MenuCompras actual="" />
        <AvisoError mensaje={error} />
        {aviso === "recibida" && (
          <p role="status" className="rounded-lg bg-green-100 px-4 py-3 text-green-900">
            Recepción registrada. Las existencias y el costo medio ya están actualizados.
          </p>
        )}
        {oc.motivo && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-800">{oc.motivo}</p>}
        <section className={`${tarjeta} flex flex-col gap-4`}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato etiqueta="Proveedor">{oc.proveedor}</Dato>
            <Dato etiqueta="Tipo de orden">
              {TIPOS_OC[oc.tipo]}
              {servicio ? " · Servicio" : ""}
              {oc.esCapex ? " · Capex" : ""}
            </Dato>
            {oc.tipo === "IMPORTACION" && <Dato etiqueta="Incoterm">{oc.incoterm ?? "—"}</Dato>}
            {oc.tipo === "IMPORTACION" && <Dato etiqueta="Vía de embarque">{oc.viaEmbarque ?? "—"}</Dato>}
            <Dato etiqueta="Enviada al proveedor">{oc.enviadaEn ? fechaHora(oc.enviadaEn) : "Todavía no"}</Dato>
            <Dato etiqueta="Emitida">
              {fechaHora(oc.emitidaEn)} · {oc.emisor}
            </Dato>
            <Dato etiqueta="Entrega comprometida">{oc.fechaEntrega ? oc.fechaEntrega.split("-").reverse().join("-") : "—"}</Dato>
            <Dato etiqueta="Condición de pago">{oc.condicionPago ?? "—"}</Dato>
            <Dato etiqueta="Cuenta contable">{oc.cuenta ? `${oc.cuentaCodigo} · ${oc.cuenta}` : "—"}</Dato>
            <Dato etiqueta="Centro de costo">{oc.centro ? `${oc.centroCodigo} · ${oc.centro}` : "—"}</Dato>
            <Dato etiqueta="Solicitud de origen">
              <Link href={`/compras/sc/${oc.scId}`} className="text-marca underline">
                {folioSc(oc.scId)}
              </Link>
            </Dato>
            <div className="col-span-2">
              <Dato etiqueta="Observaciones">{oc.nota ?? "—"}</Dato>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-base">
              <thead className="text-sm text-slate-600">
                <tr>
                  <th className="py-1">Línea</th>
                  <th className="py-1 text-right">Cantidad</th>
                  <th className="py-1 text-right">Recibida</th>
                  <th className="py-1 text-right">Precio neto</th>
                  <th className="py-1 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {oc.lineas.map((l) => (
                  <tr key={l.id} className="border-t border-slate-200">
                    <td className="py-2">{l.descripcion}</td>
                    <td className="py-2 text-right tabular-nums">{cant(l.cantidad)}</td>
                    <td className="py-2 text-right tabular-nums">{cant(l.recibida)}</td>
                    <td className="py-2 text-right tabular-nums">{m(l.precioUnitario, 4)}</td>
                    <td className="py-2 text-right tabular-nums">{m(l.cantidad * l.precioUnitario)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-right font-semibold">
                <tr className="border-t border-slate-300">
                  <td colSpan={4} className="py-1">
                    Neto
                  </td>
                  <td className="py-1 tabular-nums">{m(oc.neto)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="py-1">
                    {oc.ivaExento ? "IVA (exenta)" : "IVA 19 %"}
                  </td>
                  <td className="py-1 tabular-nums">{m(oc.iva)}</td>
                </tr>
                <tr className="text-lg">
                  <td colSpan={4} className="py-1">
                    Total
                  </td>
                  <td className="py-1 tabular-nums">{m(oc.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {editable && (
            <details>
              <summary className="cursor-pointer font-semibold text-marca">Cambiar cuenta contable o centro de costo</summary>
              <form action={accionImputacionOc} className="mt-3 grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <input type="hidden" name="id" value={oc.id} />
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Cuenta contable
                  <select name="cuentaId" required defaultValue={oc.cuentaId ?? ""} className={campo}>
                    <option value="" disabled>
                      Elegir…
                    </option>
                    {cuentas
                      .filter((c) => c.activo || c.id === oc.cuentaId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.codigo} · {c.nombre}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Centro de costo
                  <select name="centroCostoId" required defaultValue={oc.centroCostoId ?? ""} className={campo}>
                    <option value="" disabled>
                      Elegir…
                    </option>
                    {centros
                      .filter((c) => c.activo || c.id === oc.centroCostoId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.codigo} · {c.nombre}
                        </option>
                      ))}
                  </select>
                </label>
                <button className={botonSecundario}>Guardar</button>
              </form>
            </details>
          )}
        </section>

        <section className={`${tarjeta} flex flex-col gap-2`}>
          <h2 className="text-lg font-bold">Cotización del proveedor</h2>
          {cotizaciones.length === 0 && <p className="text-slate-600">Sin cotización adjunta.</p>}
          {cotizaciones.map((c, i) => (
            <a key={c.id} href={`/adjuntos/${c.id}`} target="_blank" rel="noreferrer" className="text-marca underline">
              {c.nombre ?? `Documento ${i + 1}`} ({c.tipo === "application/pdf" ? "PDF" : "imagen"})
            </a>
          ))}
          {gestiona && vigente && (
            <form action={accionAdjuntarCotizacion} className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
              <input type="hidden" name="id" value={oc.id} />
              <input type="file" name="cotizacion" required aria-label="Archivo de la cotización" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-base" />
              <button className={botonSecundario}>Adjuntar</button>
            </form>
          )}
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Ruta de aprobación · {obligatorias} de 2 obligatorias</h2>
          <p className="text-sm text-slate-600">Se firma en este orden: jefe de mantenimiento, gerente de producción y gerente general.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(Object.keys(ROLES_AUTORIZACION) as (keyof typeof ROLES_AUTORIZACION)[]).map((rol) => {
              const a = oc.autorizaciones.find((x) => x.rol === rol);
              return (
                <div key={rol} className={`rounded-lg border p-3 ${a ? "border-green-300 bg-green-50" : "border-slate-300"}`}>
                  <p className="text-sm text-slate-600">
                    {ROLES_AUTORIZACION[rol]}
                    {ROLES_OBLIGATORIOS.includes(rol) ? "" : " (opcional)"}
                  </p>
                  <p className="font-semibold">
                    {a ? `${a.nombre} · ${fechaHora(a.fecha)}` : ROLES_OBLIGATORIOS.includes(rol) ? "Pendiente" : "Sin firma digital"}
                  </p>
                </div>
              );
            })}
          </div>
          {oc.codigoVerificacion && <p className="text-sm text-slate-700">Código de verificación: <b className="tracking-wider">{oc.codigoVerificacion}</b></p>}
          {puedeFirmar && miRol && (
            <form action={accionAutorizarOc} className="flex flex-col gap-3 border-t border-slate-200 pt-3">
              <input type="hidden" name="id" value={oc.id} />
              <p>
                Autorizas como <b>{ROLES_AUTORIZACION[miRol].toLowerCase()}</b>. Queda registrado tu nombre, la fecha y la hora.
              </p>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Motivo (obligatorio para rechazar)
                <input name="motivo" className={campo} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button name="decision" value="autorizar" className="h-12 rounded-lg bg-green-700 font-semibold text-white">
                  Autorizar
                </button>
                {oc.estado === "EMITIDA" && (
                  <button name="decision" value="rechazar" className="h-12 rounded-lg border-2 border-red-700 font-semibold text-red-700">
                    Rechazar
                  </button>
                )}
              </div>
            </form>
          )}
          {oc.estado === "EMITIDA" && yaFirme && <p className="text-slate-700">Ya autorizaste esta orden.</p>}
          {miRol && !yaFirme && !meToca && vigente && (miRol !== "JEFE_MANTENIMIENTO") && (
            <p className="text-slate-700">Todavía no te toca firmar: falta la firma anterior de la ruta de aprobación.</p>
          )}
          {oc.estado === "EMITIDA" && !miRol && <p className="text-slate-700">Sin las dos autorizaciones obligatorias, la orden no admite recepciones y solo se imprime como borrador.</p>}
        </section>

        {gestiona && autorizada && !oc.enviadaEn && !cerrada && (
          <form action={accionEnviadaOc} className={`${tarjeta} flex flex-wrap items-center justify-between gap-3`}>
            <input type="hidden" name="id" value={oc.id} />
            <p>La orden completó su ruta de aprobación. Cuando la envíes al proveedor, déjalo registrado.</p>
            <button className={botonSecundario}>Marcar como enviada al proveedor</button>
          </form>
        )}

        {servicio && vigente && (
          <section className={`${tarjeta} flex flex-col gap-3`}>
            <h2 className="text-lg font-bold">Factura del servicio</h2>
            {oc.conformeEn ? (
              <p>
                Factura <b>{oc.facturaServicio}</b> firmada por {oc.conforme} · {fechaHora(oc.conformeEn)}
              </p>
            ) : oc.estado !== "AUTORIZADA" ? (
              <p className="text-slate-700">Una orden de servicio no se recibe en bodega: una vez autorizada, el jefe de área firma la factura del proveedor.</p>
            ) : visaCompras(usuario) ? (
              <form action={accionConformarServicio} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={oc.id} />
                <p>Al firmar declaras que el servicio se recibió conforme. Queda registrado tu nombre, la fecha y la hora.</p>
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Número de la factura del proveedor
                  <input name="factura" required className={campo} />
                </label>
                <button className={botonPrimario}>Firmar la factura</button>
              </form>
            ) : (
              <p className="rounded-lg bg-amber-50 px-3 py-2">Pendiente: falta que el jefe de área firme la factura del proveedor.</p>
            )}
          </section>
        )}

        {recibible && operaBodega(usuario) && (
          <form action={accionRecibirOc} className={`${tarjeta} flex flex-col gap-3`}>
            <h2 className="text-lg font-bold">Recibir mercadería</h2>
            <input type="hidden" name="id" value={oc.id} />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Almacén que recibe
                <select name="almacenId" required className={campo}>
                  {almacenesAptos.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Guía o factura
                <input name="documento" className={campo} />
              </label>
              {oc.moneda !== "CLP" && (
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Tipo de cambio: pesos por 1 {oc.moneda}
                  <input name="tipoCambio" required inputMode="decimal" className={campo} />
                </label>
              )}
            </div>
            <div className="grid grid-cols-[1fr_6rem_8rem] items-center gap-2 text-sm font-semibold">
              <span>Línea</span>
              <span className="text-right">Por recibir</span>
              <span>Recibido ahora</span>
              {oc.lineas
                .filter((l) => l.recibida < l.cantidad)
                .map((l) => (
                  <div key={l.id} className="contents text-base font-normal">
                    <span>
                      {l.descripcion}
                      {!l.repuestoId && <span className="text-sm text-slate-500"> · no entra a existencias</span>}
                    </span>
                    <span className="text-right tabular-nums">{cant(Math.round((l.cantidad - l.recibida) * 100) / 100)}</span>
                    <input name={`r_${l.id}`} inputMode="decimal" aria-label={`Recibido de ${l.descripcion}`} className={campo} />
                  </div>
                ))}
            </div>
            <p className="text-sm text-slate-600">
              {oc.esCapex
                ? "Deja vacío lo que no llegó. Orden Capex: lo recibido entra a la bodega Capex con su costo, sin cambiar el costo medio ni la valorización del inventario."
                : "Deja vacío lo que no llegó. Lo recibido entra a existencias valorizado en pesos y actualiza el costo medio."}
            </p>
            <button type="submit" className={botonPrimario}>
              Registrar recepción
            </button>
          </form>
        )}

        {recs.length > 0 && (
          <section className={`${tarjeta} flex flex-col gap-2`}>
            <h2 className="text-lg font-bold">Recepciones · {recs.length}</h2>
            {recs.map((r) => (
              <div key={r.id} className="border-t border-slate-200 pt-2">
                <p className="font-semibold">
                  {fechaHora(r.fecha)} · {r.almacen} · {r.quien}
                  {r.documento ? ` · ${r.documento}` : ""}
                  {oc.moneda !== "CLP" ? ` · 1 ${oc.moneda} = ${pesos(r.tipoCambio)}` : ""}
                </p>
                {detalle
                  .filter((d) => d.recepcionId === r.id)
                  .map((d) => (
                    <p key={d.id} className="text-slate-700">
                      {cant(d.cantidad)} × {oc.lineas.find((l) => l.id === d.lineaOcId)?.descripcion}
                    </p>
                  ))}
              </div>
            ))}
          </section>
        )}

        {cerrada && (
          <p className={tarjeta}>
            Orden cerrada por abastecimiento · {fechaHora(oc.cerradaEn!)}
            {oc.notaCierre ? ` · ${oc.notaCierre}` : ""}
          </p>
        )}
        {gestiona && !cerrada && (oc.estado === "RECIBIDA_TOTAL" || oc.estado === "RECIBIDA_PARCIAL") && (
          <form action={accionCerrarOc} className={`${tarjeta} flex flex-col gap-3`}>
            <h2 className="text-lg font-bold">Cerrar la orden</h2>
            <input type="hidden" name="id" value={oc.id} />
            {oc.estado === "RECIBIDA_PARCIAL" ? (
              <label className="flex flex-col gap-1 text-sm font-semibold">
                La orden tiene saldo por recibir. Explica por qué se cierra así (obligatorio)
                <input name="nota" required className={campo} />
              </label>
            ) : (
              <p>{servicio ? "La factura del servicio ya está firmada." : "Todo lo pedido ya ingresó a bodega."} Al cerrarla, la orden queda terminada.</p>
            )}
            <button className={botonPrimario}>Cerrar la orden</button>
          </form>
        )}

        {editable && (
          <details className={tarjeta}>
            <summary className="cursor-pointer font-bold text-red-700">Anular esta orden de compra</summary>
            <form action={accionAnularOc} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="id" value={oc.id} />
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Motivo
                <input name="motivo" required className={campo} />
              </label>
              <button type="submit" className="h-12 rounded-lg border-2 border-red-700 font-semibold text-red-700">
                Anular
              </button>
            </form>
          </details>
        )}
      </main>
    </>
  );
}
