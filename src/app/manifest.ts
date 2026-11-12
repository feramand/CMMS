import type { MetadataRoute } from "next";

// Permite instalar la aplicación en la pantalla de inicio de Android (y iOS).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Print Garage",
    short_name: "Print Garage",
    description: "Gestión de activos y mantenimiento",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f4c81",
    lang: "es",
    icons: [
      { src: "/iconos/icono-192.png", sizes: "192x192", type: "image/png" },
      { src: "/iconos/icono-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
