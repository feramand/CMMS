import type { MetadataRoute } from "next";

// Permite instalar la aplicación en la pantalla de inicio de Android (y iOS).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CMMS Mantenimiento",
    short_name: "CMMS",
    description: "Gestión de activos y mantenimiento",
    start_url: "/",
    display: "standalone",
    background_color: "#f1f5f9",
    theme_color: "#0f4c81",
    lang: "es",
    icons: [
      { src: "/iconos/icono-192.png", sizes: "192x192", type: "image/png" },
      { src: "/iconos/icono-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
