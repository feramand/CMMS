"use client";

import { useEffect, useState } from "react";
import { accionGuardarSuscripcion } from "@/app/notificaciones/actions";

type Estado = "revisando" | "no-disponible" | "inactivo" | "activo" | "bloqueado" | "trabajando";

function claveABytes(base64: string): Uint8Array<ArrayBuffer> {
  const relleno = "=".repeat((4 - (base64.length % 4)) % 4);
  const crudo = atob((base64 + relleno).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(crudo.length));
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
  return bytes;
}

function aTexto(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function registrar(sub: PushSubscription) {
  return accionGuardarSuscripcion({
    endpoint: sub.endpoint,
    p256dh: aTexto(sub.getKey("p256dh")),
    auth: aTexto(sub.getKey("auth")),
  });
}

/** Botón para recibir los avisos en este dispositivo aunque la aplicación esté cerrada. */
export function ActivarAvisos({ clavePublica }: { clavePublica: string | null }) {
  const [estado, setEstado] = useState<Estado>("revisando");
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    (async () => {
      if (!clavePublica || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (vigente) setEstado("no-disponible");
        return;
      }
      if (Notification.permission === "denied") {
        if (vigente) setEstado("bloqueado");
        return;
      }
      const registro = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const sub = await registro.pushManager.getSubscription();
      // Si ya estaba suscrito, se vuelve a asociar a quien tiene la sesión abierta ahora.
      if (sub) await registrar(sub);
      if (vigente) setEstado(sub ? "activo" : "inactivo");
    })().catch(() => vigente && setEstado("inactivo"));
    return () => {
      vigente = false;
    };
  }, [clavePublica]);

  async function activar() {
    setEstado("trabajando");
    setError("");
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado(permiso === "denied" ? "bloqueado" : "inactivo");
        return;
      }
      const registro = await navigator.serviceWorker.ready;
      const sub = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: claveABytes(clavePublica!),
      });
      const r = await registrar(sub);
      if (!r.ok) throw new Error(r.error);
      setEstado("activo");
    } catch {
      setError("No se pudieron activar los avisos. Revisa la conexión e inténtalo de nuevo.");
      setEstado("inactivo");
    }
  }

  if (estado === "revisando" || estado === "no-disponible" || estado === "activo") return null;
  if (estado === "bloqueado") {
    return (
      <p className="rounded-lg bg-amber-100 px-4 py-3 text-amber-900">
        Los avisos están bloqueados en este navegador. Actívalos en los ajustes del sitio para recibir alertas.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border-2 border-marca bg-white p-3">
      <p className="text-base">Recibe una alerta en este celular cuando haya una solicitud o un trabajo para ti.</p>
      <button
        type="button"
        onClick={activar}
        disabled={estado === "trabajando"}
        className="h-12 rounded-lg bg-marca text-base font-semibold text-white disabled:opacity-60"
      >
        {estado === "trabajando" ? "Activando…" : "Activar avisos en este dispositivo"}
      </button>
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
