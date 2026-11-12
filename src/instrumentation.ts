// Reloj del servidor: revisa las pautas por tiempo aunque nadie esté usando el sistema.
// Sin él, una pauta mensual solo se liberaría cuando alguien abriera una pantalla.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const global = globalThis as { __relojPautas?: ReturnType<typeof setInterval> };
  if (global.__relojPautas) return;
  const { revisarPautas } = await import("./lib/reloj");
  global.__relojPautas = setInterval(revisarPautas, 15 * 60 * 1000);
  setTimeout(revisarPautas, 20 * 1000);
}
