import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

// Verificación rápida antes de renderizar: sin sesión válida, todo lleva al ingreso.
// Los permisos por perfil se validan además en cada página y en cada acción del servidor.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const esLogin = pathname === "/login";
  const token = request.cookies.get("cmms_sesion")?.value;
  let valida = false;
  if (token && process.env.SESSION_SECRET) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET), {
        algorithms: ["HS256"],
      });
      valida = true;
    } catch {
      valida = false;
    }
  }
  if (!valida && !esLogin) {
    const ingreso = new URL("/login", request.url);
    // Quien escanea el QR de una máquina sin sesión vuelve a esa ficha después de ingresar.
    if (/^\/activo\/\d+$/.test(pathname)) ingreso.searchParams.set("volver", pathname);
    return NextResponse.redirect(ingreso);
  }
  return NextResponse.next();
}

// Las direcciones de /api/metrics no usan sesión: las protege la clave del conector.
export const config = {
  matcher: ["/((?!api/metrics|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|logo-print-garage.png|icon.png|iconos/).*)"],
};
