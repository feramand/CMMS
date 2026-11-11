import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/dal";
import { rutaInicio } from "@/lib/perfiles";
import { FormularioIngreso } from "./formulario";

export default async function PaginaIngreso() {
  const usuario = await usuarioActual();
  if (usuario) redirect(rutaInicio(usuario.perfil));
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-marca">CMMS</h1>
        <p className="text-slate-600">Gestión de activos y mantenimiento</p>
      </div>
      <FormularioIngreso />
    </main>
  );
}
