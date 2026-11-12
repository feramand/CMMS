// Service worker de Print Garage: muestra las notificaciones push y abre la pantalla correspondiente.
self.addEventListener("push", (event) => {
  let datos = { titulo: "Print Garage", cuerpo: "Tienes un aviso nuevo.", url: "/" };
  try {
    if (event.data) datos = { ...datos, ...event.data.json() };
  } catch {
    // Mensaje sin formato: se muestra el aviso genérico.
  }
  event.waitUntil(
    self.registration.showNotification(datos.titulo, {
      body: datos.cuerpo,
      icon: "/iconos/icono-192.png",
      badge: "/iconos/icono-192.png",
      data: { url: datos.url },
      vibrate: [200, 100, 200],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if ("focus" in v) {
          v.navigate(destino);
          return v.focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});
