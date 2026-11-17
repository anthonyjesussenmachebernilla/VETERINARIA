# Veterinaria · ventas y facturación electrónica

HTML, CSS y JavaScript sin frameworks. Consume la API de facturación SUNAT (`/api/v1`).

## Abrir con doble clic

1. Copia la carpeta `veterinaria` donde quieras (escritorio, USB, otra PC).
2. Doble clic en `index.html`. No necesita Laragon, servidor ni internet para abrir; sí internet para emitir.
3. Crea el administrador y pon las credenciales de la API en Configuración → Credenciales API (quedan cifradas). `config.js` puede quedar con `API_KEY` y `API_SECRET` vacíos.

Los datos quedan en ese navegador de esa PC (Chrome, Edge o Firefox). Para llevarlos a otra PC: Configuración → Respaldo → Exportar `data.json` y luego Importar en la otra.

Si al probar la conexión sale "No se pudo conectar", la API está bloqueando por CORS las llamadas que vienen de un archivo local (origen `null`). En la API (Laravel, `config/cors.php`) permite `allowed_origins` `*` y los headers `X-Api-Key`, `X-Api-Secret`, `Content-Type` y `Accept`.

## Seguridad

Todo funciona con HTML, CSS y JavaScript en el navegador, sin servidor. Lo que el sistema protege:

- **Contraseñas:** PBKDF2-SHA256 con 600 000 vueltas y sal aleatoria. Mínimo 8 caracteres con letras y números, sin contener el usuario. Las contraseñas del formato antiguo (SHA-256) se actualizan solas al ingresar.
- **Intentos fallidos:** tras 5 contraseñas incorrectas seguidas el usuario queda bloqueado 1 minuto; cada fallo extra duplica la espera (máximo 15). El administrador ve y quita bloqueos en Configuración → Seguridad.
- **Sesión:** se cierra tras 15 minutos sin actividad (configurable de 5 minutos a 2 horas) y, como máximo, a las 12 horas. Vive en la pestaña: cerrarla también cierra la sesión.
- **Credenciales de la API cifradas (bóveda):** URL, key y secret se guardan con AES-256-GCM. La llave se envuelve por separado con la contraseña de cada usuario, así que solo se leen con una sesión abierta; un `data.json` copiado no las revela. Un usuario desactivado o al que se le cambia la contraseña sin bóveda abierta pierde el acceso hasta que el administrador le asigne una nueva.
- **Respaldos cifrados:** Configuración → Respaldo → **Exportar respaldo cifrado** (AES-256-GCM con contraseña). Un archivo alterado se detecta al importar. Exportar sin cifrar sigue disponible, con advertencia.
- **Permisos:** las operaciones de administrador (bajas, notas, correcciones, eliminar, series, sucursales, empresa, credenciales, guías) se verifican en la capa de API, no solo ocultando botones. Sin sesión no sale ninguna llamada.
- **Scripts inyectados:** `index.html` tiene una Content Security Policy que solo permite el código del propio sistema; un `<script>` o un `onerror` inyectados no se ejecutan.

Lo que no puede proteger sin servidor: alguien con el equipo encendido, una sesión abierta y conocimientos técnicos podría saltarse los permisos desde las herramientas del navegador. Cuida el acceso físico: cuenta de Windows con contraseña, cerrar sesión al dejar la caja y no compartir el usuario administrador.

Si `config.js` todavía tiene `API_KEY` y `API_SECRET`, el sistema avisa: muévelas a la bóveda (Configuración → Credenciales API → Mover a la bóveda cifrada) y luego déjalas vacías en el archivo.

## Credenciales de la API (las pone el cliente)

El administrador las ingresa en **Configuración → Credenciales API**: URL, API key y API secret.

- **Probar conexión** verifica el par contra la API sin guardarlo.
- **Guardar y cargar datos** lo guarda y trae de la API la empresa (razón social, RUC, entorno, régimen), la sucursal del punto de venta y las series por defecto. Solo completa lo que falta: no cambia lo elegido a mano. Se puede repetir con **Volver a cargar**.
- Modo servidor: el par se prueba y se guarda en `servidor/.env` a través de `/credenciales` (protegido por el PIN y el origen); el navegador nunca recibe el secret. Solo acepta URLs `https://`.
- Modo directo (doble clic): el par queda cifrado en la bóveda y tiene prioridad sobre `config.js`. **Quitar credenciales** lo borra de la bóveda.
- Al regenerar credenciales o registrar una empresa nueva, **Usar ahora en este sistema** aplica el par nuevo sin copiarlo a mano.
- La primera vez que se ingresa con credenciales válidas, los datos se cargan solos.

## Cómo correrlo

Además del doble clic hay dos modos. Para producción usa siempre el **modo servidor**.

### Modo servidor (recomendado y obligatorio en producción)

Un solo archivo, `servidor/servidor.js`, sin dependencias (Node 18 o superior, viene con Laragon):

1. Copia `servidor/.env.example` como `servidor/.env` y completa `API_KEY`, `API_SECRET` y `PIN_ACCESO`.
2. En la carpeta del sistema: `node servidor/servidor.js`
3. Abre `http://localhost:8080` (o `http://IP-de-la-PC:8080` desde la tablet o el celular de la red).
4. En cada equipo: Configuración → Credenciales API → ingresa el PIN y un nombre de equipo (ej.: caja, tablet). Lo hace el administrador una vez por equipo.

Qué hace el servidor:
- Sirve el sistema y reenvía `/api/*` a la API agregando `X-Api-Key` y `X-Api-Secret` desde el `.env`. El navegador nunca ve el secret.
- Exige el PIN en cada llamada, rechaza otros sitios web (origen) y limita a 600 solicitudes por minuto por IP.
- Genera `config.js` al vuelo: aunque el archivo `config.js` tenga credenciales de prueba, no se envía.
- No sirve `servidor/`, `.env`, respaldos ni archivos ocultos.
- Guarda respaldos automáticos de `data.json`: cada equipo envía su copia un minuto después de cada cambio; queda una por equipo y hora durante 30 días (Configuración → Respaldo para verlos y descargarlos).

Para que quede encendido en Windows puedes usar el Programador de tareas o `pm2` (`npm i -g pm2`, `pm2 start servidor/servidor.js`). Si lo publicas en internet, ponlo detrás de HTTPS.

### Modo directo con servidor estático (solo pruebas)

Igual que el doble clic, pero abierto desde Laragon o `npx serve .`. El secret queda visible en el navegador y la API debe permitir CORS.

## Modificar el código

El código está ordenado en módulos dentro de `src/`. El navegador carga `js/sistema.js`, que es la unión de todos ellos en un solo script (así abre con doble clic).

Después de cambiar algo en `src/`, ejecuta en la carpeta del sistema:

```
node construir.mjs
```

Usa esbuild a través de `npx` (la primera vez lo descarga). No edites `js/sistema.js` a mano: se reemplaza al reconstruir.

## Datos (data.json)

- Primer uso: carga `data.json` como semilla (categorías y series por defecto).
- Después cada equipo trabaja con su copia en el navegador (los datos comerciales no se comparten entre equipos; los comprobantes sí, porque viven en la API).
- Configuración → Respaldo: **Exportar data.json** (hazlo cada día) e **Importar data.json**.
- Pasar a guardado en servidor solo cambia `js/store.js`.

## Etapa 6 (esta entrega)

- **Inicio (dashboard):** ventas y total del día, por emitir y rechazados; pendientes ordenados por urgencia (rechazos, emisiones por confirmar, ventas sin comprobante, boletas esperando resumen con días de plazo, cuotas vencidas, stock agotado o bajo, respaldo de data.json, entorno beta) más las alertas de `/panel/alertas`; ventas por mes (`/panel/ventas-mensuales`, o del sistema si la API no responde) con tooltip y vista de tabla; hoy por método de pago; más vendidos de 30 días; últimos comprobantes (`/panel/documentos-recientes`).
- **Reportes:** registro de ventas, consolidado, notas, por cliente y por sucursal desde `/reportes/*` con fechas, totales por página y descarga CSV (abre bien en Excel). Caja por método de pago y día desde las ventas del sistema.

## Salida a producción

1. **Modo servidor.** Usa `servidor/servidor.js` con `PIN_ACCESO` definido; no publiques el modo directo.
2. **Credenciales nuevas.** Las de prueba se compartieron por chat: regenera el par (Configuración → Credenciales API), pon el nuevo en `servidor/.env` y reinicia el servidor.
3. **Datos reales del cliente:** certificado digital vigente (Configuración → Logo y certificado), usuario y clave SOL reales, régimen confirmado con su contador, client_id y client_secret GRE si emitirá guías.
4. **Sucursal y series reales** (principal `0000`), y series por defecto; decide si las boletas van individuales o por resumen diario.
5. **Afectación IGV de cada producto** revisada con el contador.
6. **Respaldo:** exporta `data.json` antes y después del cambio; luego, a diario (el Inicio lo recuerda).
7. **Cambiar a producción** en Configuración → Empresa → Entorno SUNAT.
8. **Primera boleta y primera factura reales:** emítelas con montos pequeños, revisa el PDF con el cliente y verifícalas en Operaciones SUNAT → Consultas (CPE).

## Etapa 5

- **Notas de crédito y débito:** desde la ficha de una factura o boleta aceptada. Motivos de los catálogos 09 y 10, ítems precargados del comprobante, cantidades limitadas a lo vendido, control de saldo (no se acredita más que el total menos las NC previas) y opción de devolver los productos al stock. No disponibles en Nuevo RUS.
- **Comunicación de baja:** facturas, NC y ND aceptadas dentro de 7 días (`POST /anulaciones`). Fuera de plazo el sistema indica usar nota de crédito.
- **Anulación de boletas:** por resumen diario con `anular[]`, dentro de 7 días.
- **Resumen diario:** boletas pendientes agrupadas por fecha con días restantes del plazo, envío del resumen, lista de resúmenes por mes con estado, XML y CDR.
- **Bajas:** lista con estado; al consultar una baja o anulación aceptada, el comprobante local queda "Anulado". Baja manual para documentos que no estén en el sistema.
- **Guías de remisión remitente:** transporte privado (vehículo y conductor), vehículo menor M1/L o transporte público (RUC del transportista); traslado por venta, entre locales propios u otros; copia bienes y destinatario de una venta; estado por ticket, PDF, XML y corrección con `PUT` (payload completo).
- **Cobranzas:** antigüedad desde `/panel/cobranzas`, facturas al crédito con cuotas vencidas, y pagos en la ficha de cada factura (registrar y eliminar, sin superar el saldo).
- **Consultas:** consultar CPE en SUNAT (propio o de proveedor), recuperar CDR y exportar ZIP por rango de fechas.

## Etapa 4

- **Comprobantes:** bandeja leída de la API (fuente oficial) con pestañas facturas, boletas, notas de crédito y notas de débito; filtros por fechas, estado SUNAT, documento del cliente, serie y número; paginación. Cada consulta actualiza el estado de las ventas locales.
- **Ficha del comprobante:** ticket 80 y 58 mm, PDF A4 y A5, XML y CDR (solo aceptados); enlace a la venta.
- **Acciones:** consultar estado; enviar a SUNAT los pendientes y reenviar rechazados (`POST /{tipo}/{id}/enviar`); corregir cliente e ítems de un rechazado o pendiente (`PUT`, la API lo reenvía); eliminar boleta no aceptada (`DELETE /boletas/{id}`); "Emitir con nuevo número" cuando el rechazo no se puede corregir (el rechazado queda en el historial y la venta vuelve a sin comprobante).
- Corregir, eliminar y re-emitir son solo para el administrador. Un aceptado no se edita: se corrige con nota de crédito o baja (etapa 5).

## Etapa 3

- **Vender (POS):** buscador y botones de productos por categoría, carrito con cantidades y descuento por línea, cliente (buscar, registrar al vuelo o "Clientes varios"), boleta, factura o "emitir después", contado (efectivo con vuelto, Yape, Plin, tarjeta, transferencia) o crédito con cuotas (solo factura), totales de referencia.
- **Emisión:** `POST /boletas` o `POST /facturas` con la serie por defecto. El descuento se aplica al precio unitario. Boletas por resumen diario opcionales (`solo_registro`) desde Configuración → Series.
- **Estados:** la venta se guarda primero; el comprobante queda "En proceso" hasta que la API devuelve aceptado o rechazado (consulta automática a `GET /{tipo}/{id}`). Un estado desconocido nunca se muestra como aceptado.
- **Errores:** si la API rechaza la solicitud, la venta queda con el mensaje y botón de reintento. Si se corta la red al emitir, la venta queda "por confirmar" y se busca en la API antes de reintentar, para no duplicar.
- **Ventas:** historial con filtros, detalle con ticket 80 mm, PDF A4, XML, CDR (solo aceptados), WhatsApp al cliente, emitir comprobante pendiente y anular venta sin comprobante (devuelve stock).

## Etapa 2

- **Productos y servicios:** catálogo local con categorías (editables), producto o servicio, código interno sugerido, unidad SUNAT, precio con IGV, afectación IGV (gravado, exonerado, inafecto), vista previa del IGV, código SUNAT con buscador (`/catalogos/producto-sunat`), stock opcional, activar o desactivar. El cajero solo consulta.
- **Clientes:** DNI, RUC (con dígito verificador), CE, pasaporte y otros; mascota como referencia interna. Cada alta o cambio se envía a `/clientes`; si la API falla, el cliente queda guardado y marcado "Sin sincronizar" con botón para reintentar. "Traer de la API" importa y enlaza clientes existentes sin duplicar.
- El formulario de cliente queda listo para reutilizarse en el punto de venta.

## Etapa 1

- Acceso: primer administrador, login, roles admin y cajero.
- Configuración: empresa, credenciales GRE, entorno beta/producción, logo, certificado, régimen e IGV manual, sucursales, series y series por defecto, credenciales API (ver, regenerar, registrar empresa), plan y uso, usuarios, respaldo.
- Inicio: lista de puesta en marcha y prueba de conexión.
- Cada pantalla muestra la respuesta cruda de la API, porque la colección no documenta respuestas.

## Primera prueba sugerida

1. Abrir, crear el administrador.
2. Inicio → Probar conexión con la API.
3. Configuración → Sucursales: crear la principal `0000`.
4. Configuración → Series: crear F001, B001, FC01, BC01, FD01, BD01, T001.
5. Configuración → Series: elegir las series por defecto.

Si la prueba de conexión dice "No se pudo conectar", es probable que la API no permita CORS desde tu dominio local: hay que agregar el origen en la API o usar el proxy.

## Estructura

```
index.html            abre con doble clic
config.js             credenciales (modo directo); no se sube al repositorio
config.example.js
data.json             semilla (también incluida en el sistema)
css/app.css           diseño (mismo sistema que el restaurante, primario verde #0F5C4D)
css/fonts/            IBM Plex Sans y Mono (licencia OFL)
img/icono.svg         ícono de la pestaña
js/tema.js            aplica tema claro u oscuro antes de pintar
js/sistema.js         generado desde src/ (no editar)
construir.mjs         genera js/sistema.js
src/app.js            arranque, menú, login
src/store.js          data.json, copia local, respaldo automático
src/api.js            cliente de la API (único que usa credenciales)
src/auth.js           usuarios, roles, PBKDF2, bloqueo por intentos, sesión con inactividad
src/cripto.js         cifrado (PBKDF2, AES-256-GCM) con la Web Crypto API
src/boveda.js         credenciales de la API cifradas, una llave envuelta por usuario
src/sincronizar.js    trae empresa, sucursal y series de la API
src/ui.js             utilidades de interfaz
src/validar.js        catálogos SUNAT, DNI/RUC, montos
src/comprobantes.js   venta, emisión, estados, archivos
src/tributario.js     notas, bajas, resúmenes, guías, pagos
src/views/            una pantalla por archivo
servidor/servidor.js  proxy de la API, PIN, respaldos
servidor/.env.example
```
