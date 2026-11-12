import { and, asc, eq, inArray, ne } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { accionCerrar, accionEscalar, accionTomar } from "@/app/trabajos/actions";
import { CamposApoyo } from "@/componentes/apoyo";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonSecundario, campo, ChipSat, Dato, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { apoyos, sectores, solicitudes, solicitudesRepuesto, usuarios } from "@/db/schema";
import { nombreCategoria, ORIGENES_REALES } from "@/lib/categorias";
import { listarSolicitudes, listarTecnicos } from "@/lib/consultas";
import { exigirSesion } from "@/lib/dal";
import { rutaInicio } from "@/lib/perfiles";
import { duracion, fechaHora, minutosEntre } from "@/lib/tiempo";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; aviso?: string }>;
};

const ORIGEN = { METRICS: "Metrics", OPERADOR: "Operador", TECNICO: "Técnico", JEFE: "Jefatura", PAUTA: "Pauta" };

export default async function DetalleSolicitud({ params, searchParams }: Props) {
  const usuario = await exigirSesion();
  const id = Number((await params).id);
  const { error, aviso } = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const [s] = await listarSolicitudes(eq(solicitudes.id, id), 1);
  if (!s) notFound();
  // El operador solo ve las solicitudes que él levantó; bodega y abastecimiento, ninguna.
  if (usuario.perfil === "BODEGUERO" || usuario.perfil === "ABASTECIMIENTO") redirect(rutaInicio(usuario.perfil));
  if (usuario.perfil === "OPERADOR" && s.creadaPor !== usuario.id) redirect("/inicio");

  const esResponsable = s.estado === "EN_ATENCION" && s.responsableId === usuario.id;
  const [listaSectores, tecnicos, listaApoyos, repuestos, anteriores] = await Promise.all([
    esResponsable
      ? db.select().from(sectores).where(eq(sectores.activoId, s.activoId)).orderBy(asc(sectores.nombre))
      : [],
    esResponsable ? listarTecnicos() : [],
    db
      .select({ nombre: usuarios.nombre })
      .from(apoyos)
      .innerJoin(usuarios, eq(usuarios.id, apoyos.usuarioId))
      .where(eq(apoyos.solicitudId, id)),
    db.select().from(solicitudesRepuesto).where(eq(solicitudesRepuesto.solicitudId, id)),
    usuario.perfil === "OPERADOR"
      ? []
      : listarSolicitudes(
          and(
            eq(solicitudes.activoId, s.activoId),
            ne(solicitudes.id, id),
            inArray(solicitudes.estado, ["SOLUCIONADA", "CERRADA"]),
          ),
          5,
        ),
  ]);
  const respuesta = minutosEntre(s.creadaEn, s.tomadaEn);
  const reparacion = minutosEntre(s.tomadaEn, s.cerradaEn);

  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Solicitud de atención</h1>
          <Link href={rutaInicio(usuario.perfil)} className="text-marca underline">
            Volver
          </Link>
        </div>
        <AvisoError mensaje={error} />
        {aviso === "duplicada" && (
          <p role="status" className="rounded-lg bg-blue-100 px-4 py-3 text-blue-900">
            Ya había una solicitud abierta para esta máquina y tipo de falla. Tu aviso quedó unido a ella.
          </p>
        )}
        {aviso === "repuesto" && (
          <p role="status" className="rounded-lg bg-green-100 px-4 py-3 text-green-900">
            Solicitud de repuesto enviada a bodega.
          </p>
        )}

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xl font-bold">{s.activo}</span>
            <ChipSat estado={s.estado} />
          </div>
          <span className="text-slate-600">
            {s.planta}
            {s.seccion ? ` · ${s.seccion}` : ""}
          </span>
          <div className="grid grid-cols-2 gap-3">
            <Dato etiqueta="Tipo de falla">
              {nombreCategoria(s.categoria)}
              {s.origenReal ? ` → ${nombreCategoria(s.origenReal)}` : ""}
            </Dato>
            <Dato etiqueta="Origen">{ORIGEN[s.origen]}</Dato>
            {s.detenidaEn && <Dato etiqueta="Máquina detenida">{fechaHora(s.detenidaEn)}</Dato>}
            <Dato etiqueta="Solicitud creada">{fechaHora(s.creadaEn)}</Dato>
            <Dato etiqueta="Reportó">{s.creador ?? "—"}</Dato>
            <Dato etiqueta="A cargo">{s.responsable ?? "Sin asignar"}</Dato>
            {respuesta !== null && <Dato etiqueta="Tiempo de respuesta">{duracion(respuesta)}</Dato>}
            {reparacion !== null && <Dato etiqueta="Tiempo de reparación">{duracion(reparacion)}</Dato>}
          </div>
          {s.comentario && <p className="text-base">{s.comentario}</p>}
          {s.solucion && (
            <p className="rounded-lg bg-green-50 p-3 text-base">
              <span className="font-semibold">{s.sector}:</span> {s.solucion}
            </p>
          )}
          {listaApoyos.length > 0 && (
            <p className="text-slate-600">Con apoyo de {listaApoyos.map((a) => a.nombre).join(", ")}</p>
          )}
          {s.otId && (
            <Link href={`/ot/${s.otId}`} className="font-semibold text-marca underline">
              Ver orden de trabajo {s.folioOt}
            </Link>
          )}
        </section>

        {repuestos.length > 0 && (
          <section className={`${tarjeta} flex flex-col gap-1`}>
            <h2 className="font-semibold">Repuestos solicitados</h2>
            {repuestos.map((r) => (
              <span key={r.id} className="text-slate-700">
                {r.cantidad} × {r.descripcion} · {r.estado.toLowerCase()}
              </span>
            ))}
          </section>
        )}

        {anteriores.length > 0 && s.estado !== "SOLUCIONADA" && s.estado !== "CERRADA" && (
          <details className={tarjeta}>
            <summary className="cursor-pointer text-base font-semibold">
              Ver {anteriores.length} soluciones anteriores en esta máquina
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {anteriores.map((a) => (
                <li key={a.id} className="text-slate-700">
                  <span className="font-semibold">{a.sector ?? nombreCategoria(a.categoria)}:</span>{" "}
                  {a.solucion ?? `Orden de trabajo ${a.folioOt}`} · {fechaHora(a.creadaEn)}
                </li>
              ))}
            </ul>
          </details>
        )}

        {s.estado === "PENDIENTE" && usuario.perfil === "TECNICO" && (
          <form action={accionTomar} className="mt-auto flex flex-col gap-2">
            <input type="hidden" name="id" value={s.id} />
            <button type="submit" className="h-16 rounded-xl bg-marca text-xl font-bold text-white">
              Tomar atención
            </button>
            <p className="text-center text-sm text-slate-600">
              Al tomarla queda a tu nombre y nadie más puede tomarla.
            </p>
          </form>
        )}

        {esResponsable && (
          <>
            <form action={accionCerrar} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={s.id} />
              <section className={`${tarjeta} flex flex-col gap-3`}>
                <label className="flex flex-col gap-1 text-base font-semibold">
                  1. Sector de la máquina
                  <select name="sectorId" required defaultValue="" className={`${campo} h-14 text-lg`}>
                    <option value="" disabled>
                      Elegir…
                    </option>
                    {listaSectores.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                {listaSectores.length === 0 && (
                  <p className="text-sm text-amber-800">
                    Esta máquina no tiene sectores cargados. Pide al jefe o al administrador que los agregue en su ficha.
                  </p>
                )}
                <label className="flex flex-col gap-1 text-base font-semibold">
                  2. Solución aplicada
                  <textarea name="solucion" required rows={3} className="rounded-lg border border-slate-400 bg-white p-3 text-lg" />
                </label>
                {s.categoria === "INDETERMINADA" && (
                  <label className="flex flex-col gap-1 text-base font-semibold">
                    Origen real de la falla
                    <select name="origenReal" required defaultValue="" className={`${campo} h-14 text-lg`}>
                      <option value="" disabled>
                        Elegir…
                      </option>
                      {ORIGENES_REALES.map((c) => (
                        <option key={c} value={c}>
                          {nombreCategoria(c)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </section>
              <CamposApoyo tecnicos={tecnicos} propioId={usuario.id} />
              <button type="submit" className="h-16 rounded-xl bg-green-700 text-2xl font-bold text-white">
                3. Solucionado
              </button>
            </form>

            <p className="text-center text-sm text-slate-600">Si la falla es mayor</p>
            <details className={tarjeta}>
              <summary className="cursor-pointer text-lg font-semibold text-marca">Generar orden de trabajo</summary>
              <form action={accionEscalar} className="mt-3 flex flex-col gap-3">
                <input type="hidden" name="id" value={s.id} />
                <label className="flex flex-col gap-1 text-base font-semibold">
                  Descripción del problema
                  <textarea
                    name="descripcion"
                    required
                    rows={3}
                    defaultValue={s.comentario ?? `Falla ${nombreCategoria(s.categoria).toLowerCase()}`}
                    className="rounded-lg border border-slate-400 bg-white p-3 text-lg"
                  />
                </label>
                <label className="flex flex-col gap-1 text-base font-semibold">
                  Prioridad
                  <select name="prioridad" defaultValue="MEDIA" className={campo}>
                    <option value="ALTA">Alta</option>
                    <option value="MEDIA">Media</option>
                    <option value="BAJA">Baja</option>
                  </select>
                </label>
                <button type="submit" className="h-14 rounded-lg bg-marca text-lg font-semibold text-white">
                  Crear orden de trabajo
                </button>
                <p className="text-sm text-slate-600">
                  La orden se crea con los datos de esta solicitud. No hay que volver a escribirlos.
                </p>
              </form>
            </details>
            <Link href={`/repuesto?sat=${s.id}`} className={`${botonSecundario} h-14 text-lg`}>
              Solicitar repuesto
            </Link>
          </>
        )}
      </main>
    </>
  );
}
