"use client";

import { useActionState, useState } from "react";
import type { Perfil } from "@/db/schema";
import { PERFILES, usaPin, usaUsuarioMetrics } from "@/lib/perfiles";
import { accionCrearUsuario, accionRestablecerClave } from "./actions";

const campo = "h-11 rounded-lg border border-slate-300 bg-white px-3 text-base";

function Aviso({ estado }: { estado: { error?: string; ok?: string } | undefined }) {
  if (estado?.error) {
    return <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-red-800">{estado.error}</p>;
  }
  if (estado?.ok) {
    return <p role="status" className="rounded-lg bg-green-100 px-3 py-2 text-green-800">{estado.ok}</p>;
  }
  return null;
}

export function FormularioNuevoUsuario({
  especialidades,
}: {
  especialidades: { id: number; nombre: string }[];
}) {
  const [estado, accion, enviando] = useActionState(accionCrearUsuario, undefined);
  const [perfil, setPerfil] = useState<Perfil>("TECNICO");
  const pin = usaPin(perfil);
  return (
    <form action={accion} className="grid gap-3 rounded-xl bg-white p-4 shadow-sm sm:grid-cols-2">
      <h2 className="text-xl font-semibold sm:col-span-2">Nuevo usuario</h2>
      <label className="flex flex-col gap-1">
        Nombre
        <input name="nombre" required className={campo} />
      </label>
      <label className="flex flex-col gap-1">
        Perfil
        <select
          name="perfil"
          value={perfil}
          onChange={(e) => setPerfil(e.target.value as Perfil)}
          className={campo}
        >
          {PERFILES.map((p) => (
            <option key={p.valor} value={p.valor}>
              {p.nombre}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        {usaUsuarioMetrics(perfil) ? "Usuario de Metrics" : "RUT"}
        <input name="identificador" required autoCapitalize="none" className={campo} />
      </label>
      <label className="flex flex-col gap-1">
        {pin ? "PIN inicial (4 dígitos)" : "Contraseña inicial (mínimo 8 caracteres)"}
        <input
          name="clave"
          type="password"
          required
          inputMode={pin ? "numeric" : undefined}
          maxLength={pin ? 4 : undefined}
          autoComplete="new-password"
          className={campo}
        />
      </label>
      {!pin && (
        <label className="flex flex-col gap-1">
          Correo (opcional)
          <input name="email" type="email" className={campo} />
        </label>
      )}
      {perfil === "TECNICO" && (
        <>
          <label className="flex flex-col gap-1">
            Especialidad
            <select name="especialidadId" required className={campo}>
              {especialidades.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Modalidad
            <select name="modalidad" required className={campo}>
              <option value="TURNOS">Turnos rotativos</option>
              <option value="HORARIO_FIJO">Horario fijo</option>
            </select>
          </label>
        </>
      )}
      {(perfil === "ADMINISTRADOR" || perfil === "JEFE_PLANIFICADOR") && (
        <label className="flex items-center gap-2 sm:col-span-2">
          <input name="puedeAutorizarOc" type="checkbox" className="size-5" />
          Puede autorizar órdenes de compra
        </label>
      )}
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Aviso estado={estado} />
        <button
          type="submit"
          disabled={enviando}
          className="h-12 rounded-lg bg-marca text-lg font-semibold text-white disabled:opacity-60"
        >
          {enviando ? "Guardando…" : "Crear usuario"}
        </button>
      </div>
    </form>
  );
}

export function FormularioRestablecer({ usuarioId, pin }: { usuarioId: number; pin: boolean }) {
  const [estado, accion, enviando] = useActionState(accionRestablecerClave, undefined);
  return (
    <form action={accion} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="usuarioId" value={usuarioId} />
      <input
        name="clave"
        type="password"
        required
        placeholder={pin ? "Nuevo PIN" : "Nueva contraseña"}
        inputMode={pin ? "numeric" : undefined}
        maxLength={pin ? 4 : undefined}
        autoComplete="new-password"
        aria-label={pin ? "Nuevo PIN" : "Nueva contraseña"}
        className="h-10 w-40 rounded-lg border border-slate-300 px-3"
      />
      <button
        type="submit"
        disabled={enviando}
        className="h-10 rounded-lg border border-marca px-3 font-medium text-marca disabled:opacity-60"
      >
        Restablecer
      </button>
      <Aviso estado={estado} />
    </form>
  );
}
