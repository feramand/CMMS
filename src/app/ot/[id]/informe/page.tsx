import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BotonImprimir } from "@/componentes/boton-imprimir";
import { db } from "@/db";
import { adjuntos, apoyos, ordenesTrabajo, sectores, solicitudes, usuarios } from "@/db/schema";
import { nombreCategoria } from "@/lib/categorias";
import { listarOts } from "@/lib/consultas";
import { consumoDeOt } from "@/lib/consultas-bodega";
import { exigirSesion } from "@/lib/dal";
import { EMPRESA } from "@/lib/empresa";
import { cant, pesos } from "@/lib/formato";
import { nombreEstadoOt } from "@/lib/ot-core";
import { rutaInicio } from "@/lib/perfiles";
import { duracion, fechaHora, minutosEntre } from "@/lib/tiempo";

const TIPO = { CORRECTIVA: "Correctiva", PROGRAMADA: "Programada", PREVENTIVA: "Preventiva", MEJORA: "Mejora" };
const PRIORIDAD = { ALTA: "Alta", MEDIA: "Media", BAJA: "Baja" };

function Par({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-700">{nombre}:</dt>
      <dd className="font-semibold">{children || "—"}</dd>
    </>
  );
}

function Bloque({ titulo, texto }: { titulo: string; texto: string | null }) {
  return (
    <div className="break-inside-avoid border border-slate-800 p-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">{titulo}</h3>
      <p className="min-h-10 whitespace-pre-wrap">{texto || "—"}</p>
    </div>
  );
}

// Informe de una orden de trabajo, listo para imprimir o guardar como PDF desde el navegador.
export default async function InformeOt({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await exigirSesion();
  if (usuario.perfil === "OPERADOR" || usuario.perfil === "BODEGUERO" || usuario.perfil === "ABASTECIMIENTO") {
    redirect(rutaInicio(usuario.perfil));
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [ot] = await listarOts(eq(ordenesTrabajo.id, id), 1);
  if (!ot) notFound();
  const verCostos = usuario.perfil !== "TECNICO";
  const [listaApoyos, [origen], consumo] = await Promise.all([
    db.select({ nombre: usuarios.nombre }).from(apoyos).innerJoin(usuarios, eq(usuarios.id, apoyos.usuarioId)).where(eq(apoyos.otId, id)),
    db
      .select({
        id: solicitudes.id,
        categoria: solicitudes.categoria,
        origenReal: solicitudes.origenReal,
        comentario: solicitudes.comentario,
        solucion: solicitudes.solucion,
        creadaEn: solicitudes.creadaEn,
        detenidaEn: solicitudes.detenidaEn,
        maquinaDetenida: solicitudes.maquinaDetenida,
        sistema: sectores.nombre,
      })
      .from(solicitudes)
      .leftJoin(sectores, eq(sectores.id, solicitudes.sectorId))
      .where(eq(solicitudes.otId, id))
      .limit(1),
    consumoDeOt(id),
  ]);
  const fotos = origen
    ? await db.select({ id: adjuntos.id }).from(adjuntos).where(eq(adjuntos.solicitudId, origen.id)).orderBy(asc(adjuntos.id))
    : [];
  const celda = "border border-slate-800 px-2 py-1";
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 bg-white p-8 text-sm text-slate-900 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/ot/${ot.id}`} className="text-base text-marca underline">
          Volver a la orden
        </Link>
        <BotonImprimir texto="Imprimir o guardar como PDF" className="h-12 rounded-lg bg-marca px-4 text-base font-semibold text-white" />
      </div>
      <header className="flex items-end justify-between gap-4 border-b-2 border-slate-800 pb-2">
        <div>
          <p className="font-semibold">{EMPRESA.nombre}</p>
          <h1 className="text-xl font-bold">Informe de orden de trabajo N.º {ot.folio}</h1>
        </div>
        <p className="text-right">
          Estado: <b>{nombreEstadoOt(ot.estado)}</b>
          <br />
          Emitido: {fechaHora(new Date())}
        </p>
      </header>

      <dl className="grid grid-cols-[9rem_1fr_9rem_1fr] gap-x-2 gap-y-1 border border-slate-800 p-2">
        <Par nombre="Máquina">
          {ot.activo} · {ot.planta}
        </Par>
        <Par nombre="Tipo">{TIPO[ot.tipo]}</Par>
        <Par nombre="Especialidad">{ot.especialidad}</Par>
        <Par nombre="Prioridad">{PRIORIDAD[ot.prioridad]}</Par>
        <Par nombre="Responsable">{ot.responsable ?? ot.proveedorExterno ?? "Sin asignar"}</Par>
        <Par nombre="Con apoyo de">{listaApoyos.map((a) => a.nombre).join(", ")}</Par>
        <Par nombre="Creada">{fechaHora(ot.creadaEn)}</Par>
        <Par nombre="Fecha programada">{ot.fechaProgramada ? ot.fechaProgramada.split("-").reverse().join("-") : ""}</Par>
        <Par nombre="Inicio">{fechaHora(ot.inicioEn)}</Par>
        <Par nombre="Término">{fechaHora(ot.terminoEn)}</Par>
        <Par nombre="Tiempo de trabajo">{duracion(minutosEntre(ot.inicioEn, ot.terminoEn))}</Par>
        {ot.responsable && ot.proveedorExterno ? <Par nombre="Proveedor externo">{ot.proveedorExterno}</Par> : <Par nombre="Origen">{origen ? "Solicitud de atención" : "Creación manual"}</Par>}
      </dl>

      <Bloque titulo="Descripción del problema" texto={ot.descripcion} />
      {ot.observaciones && <Bloque titulo="Observaciones del trabajo" texto={ot.observaciones} />}

      {origen && (
        <section className="flex flex-col gap-2">
          <h2 className="font-bold">Falla que originó la orden</h2>
          <dl className="grid grid-cols-[9rem_1fr_9rem_1fr] gap-x-2 gap-y-1 border border-slate-800 p-2">
            <Par nombre="Tipo de falla">{nombreCategoria(origen.origenReal ?? origen.categoria)}</Par>
            <Par nombre="Máquina detenida">{origen.maquinaDetenida ? "Sí" : "No"}</Par>
            <Par nombre="Detención">{fechaHora(origen.detenidaEn)}</Par>
            <Par nombre="Aviso">{fechaHora(origen.creadaEn)}</Par>
            <Par nombre="Sistema">{origen.sistema}</Par>
            <Par nombre="Comentario">{origen.comentario}</Par>
          </dl>
          {origen.solucion && <Bloque titulo="Solución registrada en la solicitud" texto={origen.solucion} />}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-bold">Análisis de causa raíz</h2>
        <div className="grid grid-cols-2 gap-2">
          <Bloque titulo="Causa identificada" texto={ot.rcaCausa} />
          <Bloque titulo="Solución aplicada" texto={ot.rcaSolucion} />
          <Bloque titulo="Acciones para evitar que se repita" texto={ot.rcaAcciones} />
          <Bloque titulo="Observaciones técnicas" texto={ot.rcaObservaciones} />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-bold">Repuestos utilizados</h2>
        {consumo.length === 0 ? (
          <p>Sin repuestos entregados por bodega.</p>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th className={celda}>Código</th>
                <th className={celda}>Descripción</th>
                <th className={`${celda} text-right`}>Cantidad</th>
                {verCostos && <th className={`${celda} text-right`}>Costo</th>}
              </tr>
            </thead>
            <tbody>
              {consumo.map((c) => (
                <tr key={c.repuestoId}>
                  <td className={celda}>{c.codigo}</td>
                  <td className={celda}>{c.descripcion}</td>
                  <td className={`${celda} text-right tabular-nums whitespace-nowrap`}>
                    {cant(c.cantidad)} {c.unidad}
                  </td>
                  {verCostos && <td className={`${celda} text-right tabular-nums`}>{pesos(c.costo)}</td>}
                </tr>
              ))}
              {verCostos && (
                <tr className="font-bold">
                  <td className={celda} colSpan={3}>
                    Costo total de repuestos
                  </td>
                  <td className={`${celda} text-right tabular-nums`}>{pesos(consumo.reduce((s, c) => s + c.costo, 0))}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {fotos.length > 0 && (
        <section className="flex break-inside-avoid flex-col gap-2">
          <h2 className="font-bold">Fotos de la falla</h2>
          <div className="grid grid-cols-3 gap-2">
            {fotos.map((f, i) => (
              // Imagen servida con control de acceso: no pasa por el optimizador de Next.
              // eslint-disable-next-line @next/next/no-img-element
              <img key={f.id} src={`/adjuntos/${f.id}`} alt={`Foto ${i + 1}`} className="aspect-4/3 w-full border border-slate-400 object-cover" />
            ))}
          </div>
        </section>
      )}

      <footer className="mt-8 grid break-inside-avoid grid-cols-2 gap-12 text-center">
        <p className="border-t border-slate-800 pt-1">
          {ot.responsable ?? "Técnico responsable"}
          <br />
          Técnico responsable
        </p>
        <p className="border-t border-slate-800 pt-1">
          <br />
          Jefe de mantenimiento
        </p>
      </footer>
    </main>
  );
}
