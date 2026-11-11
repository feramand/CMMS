import { salir } from "@/app/login/actions";
import type { UsuarioSesion } from "@/lib/auth-core";
import { nombrePerfil } from "@/lib/perfiles";

export function Encabezado({ usuario }: { usuario: UsuarioSesion }) {
  return (
    <header className="flex items-center justify-between gap-3 bg-marca px-4 py-3 text-white">
      <div className="min-w-0">
        <p className="truncate text-lg font-semibold">{usuario.nombre}</p>
        <p className="text-sm opacity-80">{nombrePerfil(usuario.perfil)}</p>
      </div>
      <form action={salir}>
        <button
          type="submit"
          className="h-11 rounded-lg border border-white/60 px-4 text-base font-medium"
        >
          Salir
        </button>
      </form>
    </header>
  );
}
