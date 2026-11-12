import { Encabezado } from "@/componentes/encabezado";
import { botonSecundario, campo, tarjeta } from "@/componentes/ui";
import { listarActivosVigentes } from "@/lib/consultas";
import { exigirPerfil } from "@/lib/dal";
import { accionCargarActivos, accionCargarCartilla, accionCargarUsuarios } from "./actions";
import { FormularioCarga } from "./formulario";

export default async function CargaInicial() {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const maquinas = await listarActivosVigentes();
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Carga inicial desde Excel</h1>
        <p className="text-slate-700">
          Descarga la plantilla, llénala sin cambiar los encabezados y súbela. Las columnas amarillas son
          obligatorias. Si alguna fila tiene un error, no se carga nada y se indica qué corregir.
        </p>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <section className={`${tarjeta} flex flex-col gap-3`}>
            <h2 className="text-lg font-bold">Activos</h2>
            <p className="text-sm text-slate-600">
              Una fila por máquina. Los sistemas propios van en una sola celda, separados por coma.
            </p>
            <a href="/admin/carga/plantilla/activos" download className={botonSecundario}>
              Descargar plantilla de activos
            </a>
            <FormularioCarga accion={accionCargarActivos} etiqueta="Planilla de activos (.xlsx)" />
          </section>
<section className={`${tarjeta} flex flex-col gap-3`}>
            <h2 className="text-lg font-bold">Cartillas de mantenimiento de una máquina</h2>
            <p className="text-sm text-slate-600">
              Una planilla por máquina, una fila por tarea. La columna PAUTA separa las cartillas (A, B, Mensual,
              Semestral…). Frecuencia y Equivalencia Giros definen cada cuánto se libera cada una y no se muestran a
              quien la ejecuta. Se acepta la planilla con su título arriba y su pie de firma abajo.
            </p>
            <a href="/admin/carga/plantilla/cartilla" download className={botonSecundario}>
              Descargar plantilla de cartilla
            </a>
            <FormularioCarga accion={accionCargarCartilla} etiqueta="Planilla de cartillas (.xlsx)">
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Máquina
                <select name="activoId" required defaultValue="" className={campo}>
                  <option value="" disabled>
                    Elegir…
                  </option>
                  {maquinas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} · {m.codigo}
                    </option>
                  ))}
                </select>
              </label>
            </FormularioCarga>
          </section>
          {usuario.perfil === "ADMINISTRADOR" && (
            <section className={`${tarjeta} flex flex-col gap-3`}>
              <h2 className="text-lg font-bold">Usuarios</h2>
              <p className="text-sm text-slate-600">
                Operadores con su usuario de Metrics; los demás, con RUT. Técnicos, operadores y bodegueros
                usan un PIN de 4 dígitos; el resto, una contraseña de al menos 8 caracteres.
              </p>
              <a href="/admin/carga/plantilla/usuarios" download className={botonSecundario}>
                Descargar plantilla de usuarios
              </a>
              <FormularioCarga accion={accionCargarUsuarios} etiqueta="Planilla de usuarios (.xlsx)" />
            </section>
          )}
        </div>
      </main>
    </>
  );
}
