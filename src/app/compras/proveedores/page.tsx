import { MenuCompras } from "@/componentes/compras";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, campo, Chip, tarjeta } from "@/componentes/ui";
import { gestionaCompras } from "@/lib/compras-core";
import { listarProveedores } from "@/lib/consultas-compras";
import { exigirPerfil } from "@/lib/dal";
import { accionGuardarProveedor } from "../actions";

type Proveedor = Awaited<ReturnType<typeof listarProveedores>>[number];

function Formulario({ p }: { p?: Proveedor }) {
  const c = (nombre: keyof Proveedor, etiqueta: string, requerido = false, ancho = "") => (
    <label className={`flex flex-col gap-1 text-sm font-semibold ${ancho}`}>
      {etiqueta}
      <input name={nombre} required={requerido} defaultValue={(p?.[nombre] as string | null) ?? ""} className={campo} />
    </label>
  );
  return (
    <form action={accionGuardarProveedor} className="grid gap-3 sm:grid-cols-2">
      {p && <input type="hidden" name="id" value={p.id} />}
      {c("nombre", "Nombre o razón social", true)}
      {c("rut", "RUT (opcional)")}
      {c("giro", "Giro")}
      {c("contacto", "Persona de contacto")}
      {c("email", "Correo")}
      {c("telefono", "Teléfono")}
      {c("direccion", "Dirección")}
      {c("condicionPago", "Condición de pago (30 días, contado…)")}
      <label className="flex items-center gap-2 text-base">
        <input type="checkbox" name="esTecnico" defaultChecked={p?.esTecnico} className="size-5" />
        Es proveedor técnico externo (presta servicios de mantenimiento)
      </label>
      {p && (
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Estado
          <select name="activo" defaultValue={p.activo ? "si" : "no"} className={campo}>
            <option value="si">Vigente</option>
            <option value="no">Dado de baja</option>
          </select>
        </label>
      )}
      <button type="submit" className={`${botonPrimario} sm:col-span-2`}>
        {p ? "Guardar cambios" : "Crear proveedor"}
      </button>
    </form>
  );
}

export default async function Proveedores({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const usuario = await exigirPerfil("ABASTECIMIENTO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "BODEGUERO");
  const { error } = await searchParams;
  const lista = await listarProveedores();
  const gestiona = gestionaCompras(usuario);
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Proveedores · {lista.length}</h1>
        <MenuCompras actual="/compras/proveedores" />
        <AvisoError mensaje={error} />
        {gestiona && (
          <details className={tarjeta} open={lista.length === 0}>
            <summary className="cursor-pointer text-lg font-bold">Nuevo proveedor</summary>
            <div className="mt-3">
              <Formulario />
            </div>
          </details>
        )}
        {lista.map((p) => (
          <details key={p.id} className={tarjeta}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-3">
              <span className="text-lg font-semibold">{p.nombre}</span>
              <span className="text-slate-700">
                {[p.rut, p.contacto, p.telefono, p.email, p.condicionPago].filter(Boolean).join(" · ")}
              </span>
              {p.esTecnico && <Chip tono="azul">Técnico externo</Chip>}
              {!p.activo && <Chip tono="gris">Dado de baja</Chip>}
            </summary>
            <div className="mt-3">{gestiona ? <Formulario p={p} /> : <p className="text-slate-700">{[p.giro, p.direccion].filter(Boolean).join(" · ") || "Sin más datos."}</p>}</div>
          </details>
        ))}
      </main>
    </>
  );
}
