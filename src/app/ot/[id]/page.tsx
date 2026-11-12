import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { accionAsignarOt, accionCausaRaiz, accionEstadoOt } from "@/app/trabajos/actions";
import { CamposApoyo } from "@/componentes/apoyo";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, botonSecundario, campo, ChipOt, Dato, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { apoyos, ordenesTrabajo, solicitudes, solicitudesRepuesto, usuarios } from "@/db/schema";
import { listarOts, listarTecnicos } from "@/lib/consultas";
import { exigirSesion } from "@/lib/dal";
import { estadosSiguientes, nombreEstadoOt } from "@/lib/ot-core";
import { rutaInicio } from "@/lib/perfiles";
import { duracion, fechaHora, minutosEntre } from "@/lib/tiempo";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; aviso?: string }>;
};

const TIPO = { CORRECTIVA: "Correctiva", PROGRAMADA: "Programada", PREVENTIVA: "Preventiva", MEJORA: "Mejora" };
const PRIORIDAD = { ALTA: "Alta", MEDIA: "Media", BAJA: "Baja" };
const REPUESTO = { PENDIENTE: "Pendiente en bodega", APROBADA: "Aprobada", ENTREGADA: "Entregado", RECHAZADA: "Rechazada" };

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}-${m}-${a}`;
}

export default async function FichaOt({ params, searchParams }: Props) {
  const usuario = await exigirSesion();
  if (usuario.perfil === "OPERADOR" || usuario.perfil === "BODEGUERO" || usuario.perfil === "ABASTECIMIENTO") {
    redirect(rutaInicio(usuario.perfil));
  }
  const id = Number((await params).id);
  const { error, aviso } = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const [ot] = await listarOts(eq(ordenesTrabajo.id, id), 1);
  if (!ot) notFound();
  const admin = usuario.perfil !== "TECNICO";
  const puedeOperar = admin || ot.responsableId === usuario.id;
  const abierta = ot.estado !== "FINALIZADA" && ot.estado !== "CANCELADA";
  const [repuestos, listaApoyos, [origen], tecnicos] = await Promise.all([
    db.select().from(solicitudesRepuesto).where(eq(solicitudesRepuesto.otId, id)),
    db
      .select({ nombre: usuarios.nombre })
      .from(apoyos)
      .innerJoin(usuarios, eq(usuarios.id, apoyos.usuarioId))
      .where(eq(apoyos.otId, id)),
    db.select({ id: solicitudes.id }).from(solicitudes).where(eq(solicitudes.otId, id)).limit(1),
    abierta && puedeOperar ? listarTecnicos() : [],
  ]);
  const siguientes = puedeOperar ? estadosSiguientes(ot.estado, admin) : [];
  const trabajo = minutosEntre(ot.inicioEn, ot.terminoEn);

  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">OT {ot.folio}</h1>
            <ChipOt estado={ot.estado} />
          </div>
          <Link href={admin ? "/admin/ot" : "/inicio"} className="text-marca underline">
            Volver
          </Link>
        </div>
        <AvisoError mensaje={error} />
        {aviso === "repuesto" && (
          <p role="status" className="rounded-lg bg-green-100 px-4 py-3 text-green-900">
            Solicitud de repuesto enviada a bodega.
          </p>
        )}

        <section className={`${tarjeta} flex flex-col gap-4`}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato etiqueta="Máquina">
              {ot.activo} · {ot.planta}
            </Dato>
            <Dato etiqueta="Tipo de intervención">{TIPO[ot.tipo]}</Dato>
            <Dato etiqueta="Especialidad">{ot.especialidad}</Dato>
            <Dato etiqueta="Prioridad">{PRIORIDAD[ot.prioridad]}</Dato>
            <Dato etiqueta="Responsable">{ot.responsable ?? ot.proveedorExterno ?? "Sin asignar"}</Dato>
            <Dato etiqueta="Origen">
              {origen ? (
                <Link href={`/sat/${origen.id}`} className="text-marca underline">
                  Solicitud de atención
                </Link>
              ) : (
                "Creación manual"
              )}
            </Dato>
            <Dato etiqueta="Creada">{fechaHora(ot.creadaEn)}</Dato>
            <Dato etiqueta="Fecha programada">{fechaCorta(ot.fechaProgramada)}</Dato>
            <Dato etiqueta="Inicio">{fechaHora(ot.inicioEn)}</Dato>
            <Dato etiqueta="Término">{fechaHora(ot.terminoEn)}</Dato>
            <Dato etiqueta="Tiempo de trabajo">{duracion(trabajo)}</Dato>
            {ot.responsable && ot.proveedorExterno && <Dato etiqueta="Proveedor externo">{ot.proveedorExterno}</Dato>}
          </div>
          <div>
            <span className="text-sm text-slate-600">Descripción del problema</span>
            <p className="text-base">{ot.descripcion}</p>
          </div>
          {ot.observaciones && (
            <div>
              <span className="text-sm text-slate-600">Observaciones</span>
              <p className="text-base">{ot.observaciones}</p>
            </div>
          )}
          {listaApoyos.length > 0 && (
            <p className="text-slate-600">Con apoyo de {listaApoyos.map((a) => a.nombre).join(", ")}</p>
          )}
        </section>

        {siguientes.length > 0 && (
          <section className={`${tarjeta} flex flex-col gap-3`}>
            <h2 className="text-lg font-bold">Cambiar estado</h2>
            <form action={accionEstadoOt} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={ot.id} />
              {siguientes.includes("FINALIZADA") && (
                <>
                  <label className="flex flex-col gap-1 text-base font-semibold">
                    Observaciones (opcional)
                    <textarea name="observaciones" rows={2} className="rounded-lg border border-slate-400 bg-white p-3" />
                  </label>
                  <CamposApoyo tecnicos={tecnicos} propioId={usuario.id} />
                </>
              )}
              <div className="flex flex-wrap gap-2">
                {siguientes.map((e) => (
                  <button
                    key={e}
                    name="estado"
                    value={e}
                    className={
                      e === "FINALIZADA"
                        ? `${botonPrimario} bg-green-700`
                        : e === "CANCELADA"
                          ? `${botonSecundario} border-slate-500 text-slate-700`
                          : botonPrimario
                    }
                  >
                    {e === "FINALIZADA" ? "Finalizar" : e === "CANCELADA" ? "Cancelar orden" : nombreEstadoOt(e)}
                  </button>
                ))}
              </div>
            </form>
          </section>
        )}

        {admin && abierta && (
          <section className={`${tarjeta} flex flex-col gap-3`}>
            <h2 className="text-lg font-bold">{ot.responsableId ? "Reasignar" : "Asignar"}</h2>
            <form action={accionAsignarOt} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="id" value={ot.id} />
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Técnico
                <select name="responsableId" required defaultValue={ot.responsableId ?? ""} className={campo}>
                  <option value="" disabled>
                    Elegir…
                  </option>
                  {tecnicos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre} · {t.especialidad} · {t.disponible ? "disponible" : "fuera de turno"} · {t.trabajosAbiertos} abiertos
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Fecha programada
                <input type="date" name="fechaProgramada" defaultValue={ot.fechaProgramada ?? ""} className={campo} />
              </label>
              <button type="submit" className={`${botonPrimario} self-end`}>
                Guardar
              </button>
            </form>
          </section>
        )}

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Repuestos</h2>
            {abierta && puedeOperar && (
              <Link href={`/repuesto?ot=${ot.id}`} className={botonPrimario}>
                Agregar repuestos
              </Link>
            )}
          </div>
          {repuestos.length === 0 ? (
            <p className="text-slate-600">Sin repuestos solicitados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-base">
                <thead className="text-sm text-slate-600">
                  <tr>
                    <th className="p-2 font-semibold">Cantidad</th>
                    <th className="p-2 font-semibold">Código de fabricante</th>
                    <th className="p-2 font-semibold">Descripción</th>
                    <th className="p-2 font-semibold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {repuestos.map((r) => (
                    <tr key={r.id} className="border-t border-slate-200">
                      <td className="p-2">{r.cantidad}</td>
                      <td className="p-2">{r.codigoFabricante ?? "—"}</td>
                      <td className="p-2">{r.descripcion}</td>
                      <td className="p-2">{REPUESTO[r.estado]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-lg font-bold">Análisis de causa raíz</h2>
            <span className="text-sm text-slate-600">Opcional. No es necesario para cerrar la orden.</span>
          </div>
          <form action={accionCausaRaiz} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={ot.id} />
            {(
              [
                ["causa", "Causa identificada", ot.rcaCausa],
                ["solucion", "Solución aplicada", ot.rcaSolucion],
                ["acciones", "Acciones para evitar que se repita", ot.rcaAcciones],
                ["observaciones", "Observaciones técnicas", ot.rcaObservaciones],
              ] as const
            ).map(([nombre, etiqueta, valor]) => (
              <label key={nombre} className="flex flex-col gap-1 text-sm font-semibold">
                {etiqueta}
                <textarea
                  name={nombre}
                  rows={2}
                  defaultValue={valor ?? ""}
                  readOnly={!puedeOperar}
                  className="rounded-lg border border-slate-400 bg-white p-2 text-base font-normal"
                />
              </label>
            ))}
            {puedeOperar && (
              <button type="submit" className={`${botonSecundario} sm:col-span-2`}>
                Guardar análisis
              </button>
            )}
          </form>
        </section>
      </main>
    </>
  );
}
