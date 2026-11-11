import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { Encabezado } from "@/componentes/encabezado";
import { db } from "@/db";
import { especialidades, fichasTecnico, usuarios } from "@/db/schema";
import { exigirPerfil } from "@/lib/dal";
import {
  nombrePerfil,
  puedeGestionarUsuarios,
  puedeRestablecerClave,
  usaPin,
} from "@/lib/perfiles";
import { accionCambiarActivo } from "./actions";
import { FormularioNuevoUsuario, FormularioRestablecer } from "./formularios";

export default async function PaginaUsuarios() {
  const actor = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const esAdmin = puedeGestionarUsuarios(actor.perfil);
  const [lista, listaEspecialidades] = await Promise.all([
    db
      .select({
        id: usuarios.id,
        nombre: usuarios.nombre,
        perfil: usuarios.perfil,
        identificador: usuarios.identificador,
        activo: usuarios.activo,
        bloqueado: usuarios.bloqueado,
        especialidad: especialidades.nombre,
        enTurno: fichasTecnico.enTurno,
        modalidad: fichasTecnico.modalidad,
      })
      .from(usuarios)
      .leftJoin(fichasTecnico, eq(fichasTecnico.usuarioId, usuarios.id))
      .leftJoin(especialidades, eq(especialidades.id, fichasTecnico.especialidadId))
      .orderBy(asc(usuarios.nombre)),
    db
      .select({ id: especialidades.id, nombre: especialidades.nombre })
      .from(especialidades)
      .where(eq(especialidades.activa, true))
      .orderBy(asc(especialidades.nombre)),
  ]);

  return (
    <>
      <Encabezado usuario={actor} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Usuarios</h1>
          <Link href="/admin" className="text-marca underline">
            Volver al panel
          </Link>
        </div>
        {esAdmin && <FormularioNuevoUsuario especialidades={listaEspecialidades} />}
        <ul className="flex flex-col gap-3">
          {lista.map((u) => (
            <li key={u.id} className="flex flex-col gap-2 rounded-xl bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-lg font-semibold">{u.nombre}</p>
                <p className="text-slate-600">
                  {nombrePerfil(u.perfil)} · {u.identificador}
                </p>
              </div>
              <p className="text-sm text-slate-600">
                {u.especialidad &&
                  `${u.especialidad} · ${
                    u.modalidad === "TURNOS"
                      ? u.enTurno
                        ? "de turno"
                        : "fuera de turno"
                      : "horario fijo"
                  } · `}
                {u.bloqueado ? "Bloqueado" : u.activo ? "Activo" : "Desactivado"}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {puedeRestablecerClave(actor.perfil, u.perfil) && (
                  <FormularioRestablecer usuarioId={u.id} pin={usaPin(u.perfil)} />
                )}
                {esAdmin && u.id !== actor.id && (
                  <form action={accionCambiarActivo}>
                    <input type="hidden" name="usuarioId" value={u.id} />
                    <input type="hidden" name="activo" value={u.activo ? "0" : "1"} />
                    <button type="submit" className="h-10 rounded-lg border border-slate-400 px-3">
                      {u.activo ? "Desactivar" : "Activar"}
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
