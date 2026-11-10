import { redirect } from "next/navigation";
import { exigirSesion } from "@/lib/dal";
import { rutaInicio } from "@/lib/perfiles";

export default async function Raiz() {
  const usuario = await exigirSesion();
  redirect(rutaInicio(usuario.perfil));
}
