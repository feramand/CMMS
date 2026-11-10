import { eq } from "drizzle-orm";
import { Encabezado } from "@/componentes/encabezado";
import { db } from "@/db";
import { especialidades, fichasTecnico } from "@/db/schema";
import { exigirPerfil } from "@/lib/dal";
import { cambiarTurno } from "./actions";

const PROXIMAMENTE: Record<string, string[]> = {
  TECNICO: [
    "Solicitudes de mi especialidad",
    "Mis trabajos asignados",
    "Pautas preventivas pendientes",
    "Reportar falla",
    "Solicitar repuesto",
  ],
  OPERADOR: ["Reportar falla", "Mis solicitudes"],
  BODEGUERO: ["Solicitudes de repuesto", "Existencias", "Recepciones"],
};

export default async function InicioOperativo() {
  const usuario = await exigirPerfil("TECNICO", "OPERADOR", "BODEGUERO");
  const [ficha] =
    usuario.perfil === "TECNICO"
      ? await db
          .select({
            modalidad: fichasTecnico.modalidad,
            enTurno: fichasTecnico.enTurno,
            especialidad: especialidades.nombre,
          })
          .from(fichasTecnico)
          .innerJoin(especialidades, eq(especialidades.id, fichasTecnico.especialidadId))
          .where(eq(fichasTecnico.usuarioId, usuario.id))
      : [];

  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
        {ficha && (
          <section className="rounded-xl bg-white p-4 shadow-sm">
            <p className="text-base text-slate-600">Especialidad: {ficha.especialidad}</p>
            {ficha.modalidad === "TURNOS" ? (
              <form action={cambiarTurno} className="mt-3">
                <input type="hidden" name="enTurno" value={ficha.enTurno ? "0" : "1"} />
                <button
                  type="submit"
                  className={`h-16 w-full rounded-lg text-xl font-semibold text-white ${
                    ficha.enTurno ? "bg-green-700" : "bg-slate-500"
                  }`}
                >
                  {ficha.enTurno ? "Estoy de turno · tocar para salir" : "Fuera de turno · tocar para entrar"}
                </button>
              </form>
            ) : (
              <p className="mt-1 text-base text-slate-600">Horario fijo</p>
            )}
          </section>
        )}
        <section className="flex flex-col gap-3">
          {(PROXIMAMENTE[usuario.perfil] ?? []).map((titulo) => (
            <div
              key={titulo}
              className="flex h-16 items-center justify-between rounded-xl bg-white px-4 text-lg font-medium text-slate-400 shadow-sm"
            >
              {titulo}
              <span className="text-sm">Próxima etapa</span>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
