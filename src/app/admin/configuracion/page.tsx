import { asc } from "drizzle-orm";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, campo, Chip, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { feriados, turnos } from "@/db/schema";
import { listarTecnicos } from "@/lib/consultas";
import { folioOc, proximoFolioOc } from "@/lib/compras-core";
import { exigirPerfil } from "@/lib/dal";
import { diasDe } from "@/lib/disponibilidad";
import { accionAgregarFeriado, accionFijarFolioOc, accionGuardarHorario, accionQuitarFeriado } from "./actions";

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}-${m}-${a}`;
}

export default async function Configuracion({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const { error } = await searchParams;
  const proximoOc = await proximoFolioOc(db);
  const [tecnicos, listaFeriados, listaTurnos] = await Promise.all([
    listarTecnicos(),
    db.select().from(feriados).orderBy(asc(feriados.fecha)),
    db.select().from(turnos).orderBy(asc(turnos.id)),
  ]);
  const fijos = tecnicos.filter((t) => t.modalidad === "HORARIO_FIJO");
  const rotativos = tecnicos.filter((t) => t.modalidad === "TURNOS");
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Configuración</h1>
        <AvisoError mensaje={error} />

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Horario de técnicos de horario fijo · {fijos.length}</h2>
          <p className="text-sm text-slate-600">
            Un técnico de horario fijo recibe avisos de nuevas solicitudes solo dentro de su horario y fuera de
            feriados. Sin horario definido, se considera siempre disponible.
          </p>
          {fijos.length === 0 && <p className="text-slate-600">No hay técnicos de horario fijo.</p>}
          {fijos.map((t) => {
            const dias = diasDe(t.diasLaborales);
            return (
              <form key={t.id} action={accionGuardarHorario} className="flex flex-wrap items-end gap-3 border-t border-slate-200 pt-3">
                <input type="hidden" name="usuarioId" value={t.id} />
                <div className="flex min-w-48 flex-col">
                  <span className="font-semibold">{t.nombre}</span>
                  <span className="text-sm text-slate-600">{t.especialidad}</span>
                  <span>
                    <Chip tono={t.disponible ? "verde" : "gris"}>{t.disponible ? "Disponible ahora" : "Fuera de horario"}</Chip>
                  </span>
                </div>
                <fieldset className="flex flex-wrap gap-1">
                  <legend className="mb-1 text-sm font-semibold">Días laborales</legend>
                  {DIAS.map((d, i) => (
                    <label
                      key={d}
                      className="flex h-11 w-12 cursor-pointer items-center justify-center rounded-lg border border-slate-400 text-sm font-semibold has-checked:border-marca has-checked:bg-marca has-checked:text-white"
                    >
                      <input type="checkbox" name="dia" value={i + 1} defaultChecked={dias.length ? dias.includes(i + 1) : i < 5} className="sr-only" />
                      {d}
                    </label>
                  ))}
                </fieldset>
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Entrada
                  <input type="time" name="entrada" required defaultValue={t.horaEntrada?.slice(0, 5) ?? "08:00"} className={`${campo} w-32`} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Salida
                  <input type="time" name="salida" required defaultValue={t.horaSalida?.slice(0, 5) ?? "18:00"} className={`${campo} w-32`} />
                </label>
                <button type="submit" className={botonPrimario}>
                  {t.diasLaborales ? "Guardar" : "Definir horario"}
                </button>
              </form>
            );
          })}
        </section>

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Feriados · {listaFeriados.length}</h2>
          <form action={accionAgregarFeriado} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Fecha
              <input type="date" name="fecha" required className={`${campo} w-44`} />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
              Nombre
              <input name="nombre" required placeholder="Navidad" className={campo} />
            </label>
            <button type="submit" className={botonPrimario}>
              Agregar feriado
            </button>
          </form>
          {listaFeriados.length === 0 && <p className="text-slate-600">No hay feriados cargados.</p>}
          <ul className="flex flex-col">
            {listaFeriados.map((f) => (
              <li key={f.fecha} className="flex items-center justify-between gap-3 border-t border-slate-200 py-2">
                <span>
                  <span className="font-semibold">{fechaCorta(f.fecha)}</span> · {f.nombre}
                </span>
                <form action={accionQuitarFeriado}>
                  <input type="hidden" name="fecha" value={f.fecha} />
                  <button type="submit" className="h-10 rounded-lg border border-slate-400 px-3">
                    Quitar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>

        {usuario.perfil === "ADMINISTRADOR" && (
          <section className={`${tarjeta} flex flex-col gap-3`}>
            <h2 className="text-lg font-bold">Folio de las órdenes de compra</h2>
            <p className="text-slate-700">
              La próxima orden de compra será la <b>{folioOc(proximoOc)}</b>. Para continuar el correlativo que la
              empresa lleva fuera del sistema, escribe el número que debe tener la próxima orden.
            </p>
            <form action={accionFijarFolioOc} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Próximo folio
                <input name="folio" required inputMode="numeric" defaultValue={proximoOc} className={`${campo} max-w-40`} />
              </label>
              <button type="submit" className={botonPrimario}>
                Guardar folio
              </button>
            </form>
            <p className="text-sm text-slate-600">
              Solo se puede avanzar, nunca retroceder, para no repetir folios. Si una orden falla al emitirse, su
              número se salta y no se reutiliza.
            </p>
          </section>
        )}

        <section className={`${tarjeta} flex flex-col gap-2`}>
          <h2 className="text-lg font-bold">Turnos rotativos</h2>
          <p className="text-slate-700">
            {listaTurnos.map((t) => `${t.nombre}: ${t.horaInicio.slice(0, 5)} a ${t.horaFin.slice(0, 5)}`).join(" · ")}
          </p>
          <p className="text-sm text-slate-600">
            Los {rotativos.length} técnicos de turnos rotativos marcan &quot;Estoy de turno&quot; en su celular. Si olvidan
            desactivarlo, se apaga solo a las 12 horas.
          </p>
        </section>
      </main>
    </>
  );
}
