"use client";

import { useActionState } from "react";
import { ingresar } from "./actions";

export function FormularioIngreso({ volver }: { volver?: string }) {
  const [estado, accion, enviando] = useActionState(ingresar, undefined);
  return (
    <form action={accion} className="flex flex-col gap-4">
      {volver && <input type="hidden" name="volver" value={volver} />}
      <label className="flex flex-col gap-1 text-base font-medium">
        RUT, usuario de Metrics o correo
        <input
          name="identificador"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          required
          className="h-14 rounded-lg border border-slate-300 bg-white px-4 text-xl"
        />
      </label>
      <label className="flex flex-col gap-1 text-base font-medium">
        PIN o contraseña
        <input
          name="clave"
          type="password"
          autoComplete="current-password"
          required
          className="h-14 rounded-lg border border-slate-300 bg-white px-4 text-xl"
        />
      </label>
      {estado?.error && (
        <p role="alert" className="rounded-lg bg-red-100 px-4 py-3 text-base text-red-800">
          {estado.error}
        </p>
      )}
      <button
        type="submit"
        disabled={enviando}
        className="h-14 rounded-lg bg-marca text-xl font-semibold text-white active:bg-marca-oscura disabled:opacity-60"
      >
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
