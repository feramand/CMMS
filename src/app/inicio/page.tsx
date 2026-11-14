import { and, desc, eq, inArray, or } from "drizzle-orm";
import Link from "next/link";
import { accionTomar } from "@/app/trabajos/actions";
import { ActivarAvisos } from "@/componentes/activar-avisos";
import { Encabezado } from "@/componentes/encabezado";
import { Fotos } from "@/componentes/fotos";
import { AvisoError, Chip, ChipOt, ChipSat, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import {
  activos,
  adjuntos,
  apoyos,
  especialidades,
  fichasTecnico,
  ordenesTrabajo,
  solicitudes,
  solicitudesRepuesto,
  usuarios,
} from "@/db/schema";
import type { UsuarioSesion } from "@/lib/auth-core";
import { categoriasDe, nombreCategoria } from "@/lib/categorias";
import { listarOts, listarSolicitudes } from "@/lib/consultas";
import { pautasLiberadas } from "@/lib/consultas-pautas";
import { exigirPerfil } from "@/lib/dal";
import { clavePublicaPush } from "@/lib/push";
import { fechaHora, minutosEntre } from "@/lib/tiempo";
import { cambiarTurno } from "./actions";

type Props = { searchParams: Promise<{ error?: string }> };

function hace(fecha: Date): string {
  const min = minutosEntre(fecha, new Date()) ?? 0;
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.floor(min / 60)} h ${min % 60} min`;
}

const titulo = "text-base font-semibold text-slate-700";

async function InicioTecnico({ usuario }: { usuario: UsuarioSesion }) {
  const [ficha] = await db
    .select({
      modalidad: fichasTecnico.modalidad,
      enTurno: fichasTecnico.enTurno,
      especialidad: especialidades.nombre,
      especialidadId: especialidades.id,
      codigo: especialidades.codigo,
    })
    .from(fichasTecnico)
    .innerJoin(especialidades, eq(especialidades.id, fichasTecnico.especialidadId))
    .where(eq(fichasTecnico.usuarioId, usuario.id));
  const categorias = ficha ? categoriasDe(ficha.codigo) : [];
  const [misPautas, pendientes, misSat, misOt, apoyosSat, apoyosOt] = await Promise.all([
    ficha ? pautasLiberadas({ operador: false, especialidadId: ficha.especialidadId }) : [],
    categorias.length
      ? listarSolicitudes(and(eq(solicitudes.estado, "PENDIENTE"), inArray(solicitudes.categoria, categorias)))
      : [],
    listarSolicitudes(and(eq(solicitudes.estado, "EN_ATENCION"), eq(solicitudes.responsableId, usuario.id))),
    listarOts(
      and(
        eq(ordenesTrabajo.responsableId, usuario.id),
        inArray(ordenesTrabajo.estado, ["ASIGNADA", "EN_CURSO", "ESPERA_REPUESTOS"]),
      ),
    ),
    db
      .select({ id: solicitudes.id, activo: activos.nombre })
      .from(apoyos)
      .innerJoin(solicitudes, eq(solicitudes.id, apoyos.solicitudId))
      .innerJoin(activos, eq(activos.id, solicitudes.activoId))
      .where(eq(apoyos.usuarioId, usuario.id))
      .orderBy(desc(apoyos.fecha))
      .limit(5),
    db
      .select({ id: ordenesTrabajo.id, folio: ordenesTrabajo.folio, activo: activos.nombre })
      .from(apoyos)
      .innerJoin(ordenesTrabajo, eq(ordenesTrabajo.id, apoyos.otId))
      .innerJoin(activos, eq(activos.id, ordenesTrabajo.activoId))
      .where(eq(apoyos.usuarioId, usuario.id))
      .orderBy(desc(apoyos.fecha))
      .limit(5),
  ]);

  return (
    <>
      {ficha?.modalidad === "TURNOS" && (
        <form action={cambiarTurno}>
          <input type="hidden" name="enTurno" value={ficha.enTurno ? "0" : "1"} />
          <button
            type="submit"
            className={`h-16 w-full rounded-xl text-xl font-semibold text-white ${
              ficha.enTurno ? "bg-green-700" : "bg-slate-600"
            }`}
          >
            {ficha.enTurno ? "Estoy de turno · tocar para salir" : "Fuera de turno · tocar para entrar"}
          </button>
        </form>
      )}

      <section className="flex flex-col gap-2">
        <h2 className={titulo}>
          Solicitudes de {ficha?.especialidad ?? "mi especialidad"} · {pendientes.length}
        </h2>
        {pendientes.length === 0 && <p className="text-slate-600">No hay solicitudes pendientes.</p>}
        {pendientes.map((s) => (
          <div key={s.id} className={`${tarjeta} flex flex-col gap-2`}>
            <Link href={`/sat/${s.id}`} className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-lg font-semibold">{s.activo}</span>
                <span className="text-sm font-semibold text-amber-800">{hace(s.creadaEn)}</span>
              </span>
              <span className="text-slate-600">
                {s.planta} · {nombreCategoria(s.categoria)}
              </span>
            </Link>
            <form action={accionTomar}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="origen" value="/inicio" />
              <button type="submit" className="h-14 w-full rounded-lg bg-marca text-lg font-semibold text-white">
                Tomar atención
              </button>
            </form>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={titulo}>Mis trabajos · {misSat.length + misOt.length}</h2>
        {misSat.length + misOt.length === 0 && <p className="text-slate-600">No tienes trabajos abiertos.</p>}
        {misSat.map((s) => (
          <Link key={`s${s.id}`} href={`/sat/${s.id}`} className={`${tarjeta} flex items-center justify-between gap-2`}>
            <span className="flex flex-col">
              <span className="text-lg font-semibold">{s.activo}</span>
              <span className="text-sm text-slate-600">Solicitud · {nombreCategoria(s.categoria)}</span>
            </span>
            <ChipSat estado={s.estado} />
          </Link>
        ))}
        {misOt.map((o) => (
          <Link key={`o${o.id}`} href={`/ot/${o.id}`} className={`${tarjeta} flex items-center justify-between gap-2`}>
            <span className="flex flex-col">
              <span className="text-lg font-semibold">
                OT {o.folio} · {o.activo}
              </span>
              <span className="text-sm text-slate-600">{o.descripcion}</span>
            </span>
            <ChipOt estado={o.estado} />
          </Link>
        ))}
      </section>

      {apoyosSat.length + apoyosOt.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className={titulo}>Trabajos donde fui apoyo</h2>
          {apoyosSat.map((a) => (
            <Link key={`as${a.id}`} href={`/sat/${a.id}`} className={`${tarjeta} flex items-center justify-between gap-2`}>
              <span className="text-lg font-semibold">{a.activo}</span>
              <Chip tono="gris">Apoyo</Chip>
            </Link>
          ))}
          {apoyosOt.map((a) => (
            <Link key={`ao${a.id}`} href={`/ot/${a.id}`} className={`${tarjeta} flex items-center justify-between gap-2`}>
              <span className="text-lg font-semibold">
                OT {a.folio} · {a.activo}
              </span>
              <Chip tono="gris">Apoyo</Chip>
            </Link>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className={titulo}>Pautas preventivas pendientes · {misPautas.length}</h2>
        {misPautas.length === 0 && <p className="text-slate-600">No hay pautas liberadas.</p>}
        {misPautas.map((p) => (
          <Link key={p.id} href={`/pauta/${p.ciclo!.id}`} className={`${tarjeta} flex items-center justify-between gap-2`}>
            <span className="flex flex-col">
              <span className="text-lg font-semibold">{p.activo}</span>
              <span className="text-slate-600">
                {p.nombre} · {p.resumen!.avance} % del intervalo
              </span>
              <span className="text-sm text-slate-600">
                {p.miParte.total > 0 ? `Tu parte: ${p.miParte.hechas} de ${p.miParte.total} · ` : ""}
                límite {p.resumen!.limite}
              </span>
            </span>
            {p.miParte.total > 0 && p.miParte.hechas === p.miParte.total ? (
              <Chip tono="verde">Tu parte lista</Chip>
            ) : p.resumen!.pasoObjetivo ? (
              <Chip tono="rojo">Próxima a vencer</Chip>
            ) : (
              <Chip tono="ambar">Liberada</Chip>
            )}
          </Link>
        ))}
      </section>
    </>
  );
}

async function InicioOperador({ usuario }: { usuario: UsuarioSesion }) {
  const mias = await listarSolicitudes(eq(solicitudes.creadaPor, usuario.id), 30);
  const misPautas = await pautasLiberadas({ operador: true });
  return (
    <>
      {misPautas.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className={titulo}>Cartillas con actividades de operador · {misPautas.length}</h2>
        {misPautas.map((p) => (
          <Link key={p.id} href={`/pauta/${p.ciclo!.id}`} className={`${tarjeta} flex items-center justify-between gap-2`}>
            <span className="flex flex-col">
              <span className="text-lg font-semibold">{p.activo}</span>
              <span className="text-slate-600">
                {p.nombre} · {p.resumen!.avance} % del intervalo
              </span>
              <span className="text-sm text-slate-600">
                {p.miParte.total > 0 ? `Tu parte: ${p.miParte.hechas} de ${p.miParte.total} · ` : ""}
                límite {p.resumen!.limite}
              </span>
            </span>
            {p.miParte.total > 0 && p.miParte.hechas === p.miParte.total ? (
              <Chip tono="verde">Tu parte lista</Chip>
            ) : p.resumen!.pasoObjetivo ? (
              <Chip tono="rojo">Próxima a vencer</Chip>
            ) : (
              <Chip tono="ambar">Liberada</Chip>
            )}
          </Link>
        ))}
        </section>
      )}
    <section className="flex flex-col gap-2">
      <h2 className={titulo}>Mis solicitudes</h2>
      {mias.length === 0 && <p className="text-slate-600">Todavía no has reportado fallas.</p>}
      {mias.map((s) => (
        <Link key={s.id} href={`/sat/${s.id}`} className={`${tarjeta} flex flex-col gap-1`}>
          <span className="flex items-center justify-between gap-2">
            <span className="text-lg font-semibold">{s.activo}</span>
            <ChipSat estado={s.estado} />
          </span>
          <span className="text-slate-600">
            {nombreCategoria(s.categoria)} · {fechaHora(s.creadaEn)}
          </span>
          {s.estado === "PENDIENTE" && <span className="text-slate-600">Mantenimiento ya fue avisado.</span>}
          {(s.estado === "EN_ATENCION" || s.estado === "ESCALADA") && s.responsable && (
            <span className="font-semibold">La atiende {s.responsable}</span>
          )}
          {s.solucion && (
            <span className="text-slate-600">
              {s.sector}: {s.solucion}
            </span>
          )}
        </Link>
      ))}
    </section>
    </>
  );
}

async function InicioBodeguero() {
  const pendientes = await db
    .select({
      id: solicitudesRepuesto.id,
      cantidad: solicitudesRepuesto.cantidad,
      codigo: solicitudesRepuesto.codigoFabricante,
      descripcion: solicitudesRepuesto.descripcion,
      creadaEn: solicitudesRepuesto.creadaEn,
      activo: activos.nombre,
      solicitante: usuarios.nombre,
      folio: ordenesTrabajo.folio,
    })
    .from(solicitudesRepuesto)
    .innerJoin(activos, eq(activos.id, solicitudesRepuesto.activoId))
    .innerJoin(usuarios, eq(usuarios.id, solicitudesRepuesto.solicitanteId))
    .leftJoin(ordenesTrabajo, eq(ordenesTrabajo.id, solicitudesRepuesto.otId))
    .where(or(eq(solicitudesRepuesto.estado, "PENDIENTE"), eq(solicitudesRepuesto.estado, "APROBADA")))
    .orderBy(solicitudesRepuesto.creadaEn);
  const fotos = pendientes.length
    ? await db
        .select({ id: adjuntos.id, repuestoId: adjuntos.repuestoId })
        .from(adjuntos)
        .where(inArray(adjuntos.repuestoId, pendientes.map((r) => r.id)))
    : [];
  return (
    <section className="flex flex-col gap-2">
      <Link href="/bodega" className="flex h-16 items-center justify-center rounded-xl bg-marca text-xl font-bold text-white">
        Bodega: existencias y movimientos
      </Link>
      <h2 className={titulo}>Solicitudes de repuesto · {pendientes.length}</h2>
      {pendientes.length === 0 && <p className="text-slate-600">No hay solicitudes pendientes.</p>}
      {pendientes.map((r) => (
        <div key={r.id} className={`${tarjeta} flex flex-col gap-2`}>
          <span className="text-lg font-semibold">
            {r.cantidad} × {r.descripcion}
          </span>
          <span className="text-slate-600">
            {r.codigo ? `Código de fabricante: ${r.codigo} · ` : ""}
            {r.activo}
            {r.folio ? ` · OT ${r.folio}` : ""}
          </span>
          <span className="text-sm text-slate-600">
            Pidió {r.solicitante} · {fechaHora(r.creadaEn)}
          </span>
          <Fotos ids={fotos.filter((f) => f.repuestoId === r.id).map((f) => f.id)} titulo="Fotos de referencia" />
          <Link href={`/bodega/solicitud/${r.id}`} className="flex h-14 items-center justify-center rounded-lg bg-marca text-lg font-semibold text-white">
            Atender
          </Link>
        </div>
      ))}
    </section>
  );
}

export default async function InicioOperativo({ searchParams }: Props) {
  const usuario = await exigirPerfil("TECNICO", "OPERADOR", "BODEGUERO");
  const { error } = await searchParams;
  const reporta = usuario.perfil !== "BODEGUERO";
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
        <AvisoError mensaje={error} />
        <ActivarAvisos clavePublica={clavePublicaPush()} />
        {usuario.perfil === "OPERADOR" && (
          <Link href="/reportar" className="flex h-20 items-center justify-center rounded-xl bg-amber-700 text-2xl font-bold text-white">
            Reportar falla
          </Link>
        )}
        {usuario.perfil === "TECNICO" && <InicioTecnico usuario={usuario} />}
        {usuario.perfil === "TECNICO" && (
          <Link href="/soluciones" className="flex h-12 items-center justify-center rounded-lg border-2 border-marca bg-white text-base font-semibold text-marca">
            Base de soluciones
          </Link>
        )}
        {usuario.perfil === "OPERADOR" && <InicioOperador usuario={usuario} />}
        {usuario.perfil === "BODEGUERO" && <InicioBodeguero />}
      </main>
      {reporta && usuario.perfil === "TECNICO" && (
        <nav className="sticky bottom-0 border-t border-slate-200 bg-white p-3">
          <Link href="/reportar" className="mx-auto flex h-14 max-w-xl items-center justify-center rounded-lg bg-amber-700 text-lg font-semibold text-white">
            Reportar falla
          </Link>
        </nav>
      )}
    </>
  );
}
