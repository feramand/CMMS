import Link from "next/link";
import { salir } from "@/app/login/actions";
import type { UsuarioSesion } from "@/lib/auth-core";
import { notificacionesSinLeer } from "@/lib/consultas";
import { nombrePerfil, puedeEntrarAdmin, rutaInicio } from "@/lib/perfiles";

const MENU_ADMIN = [
  { href: "/admin", nombre: "Panel" },
  { href: "/admin/tablero", nombre: "Tablero" },
  { href: "/admin/solicitudes", nombre: "Solicitudes" },
  { href: "/admin/ot", nombre: "Órdenes de trabajo" },
  { href: "/admin/preventivo", nombre: "Preventivo" },
  { href: "/admin/activos", nombre: "Activos" },
  { href: "/admin/tipos", nombre: "Tipos de máquina" },
  { href: "/admin/usuarios", nombre: "Usuarios" },
  { href: "/admin/carga", nombre: "Carga inicial" },
  { href: "/admin/metrics", nombre: "Metrics" },
  { href: "/admin/configuracion", nombre: "Configuración" },
];

export async function Encabezado({ usuario }: { usuario: UsuarioSesion }) {
  const sinLeer = await notificacionesSinLeer(usuario.id);
  const menu = usuario.perfil === "ADMINISTRADOR" || usuario.perfil === "JEFE_PLANIFICADOR";
  return (
    <header className="bg-marca text-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <Link href={rutaInicio(usuario.perfil)} className="min-w-0">
          <p className="truncate text-lg font-semibold">{usuario.nombre}</p>
          <p className="text-sm text-blue-100">
            {nombrePerfil(usuario.perfil)}
            {puedeEntrarAdmin(usuario.perfil) ? " · Print Garage" : ""}
          </p>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/notificaciones"
            className="flex h-11 items-center rounded-lg border border-blue-200 px-3 text-base font-medium"
          >
            Avisos{sinLeer > 0 ? ` · ${sinLeer}` : ""}
          </Link>
          <form action={salir}>
            <button
              type="submit"
              className="h-11 rounded-lg border border-blue-200 px-4 text-base font-medium"
            >
              Salir
            </button>
          </form>
        </div>
      </div>
      {menu && (
        <nav className="flex flex-wrap gap-1 px-3 pb-2">
          {MENU_ADMIN.map((m) => (
            <Link key={m.href} href={m.href} className="rounded-lg px-3 py-2 text-base text-blue-50 hover:bg-marca-oscura">
              {m.nombre}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
