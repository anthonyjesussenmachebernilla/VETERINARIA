// Arranque, navegación por hash, marco de la aplicación (barra lateral, encabezado, tema) y acceso.
import { store } from './store.js';
import { auth, ROLES } from './auth.js';
import { esc, toast, $, leerForm, conCarga, campo, icono, programarAjuste, activarTablas, pedirContrasena } from './ui.js';
import { credencialesListas, modoProxy, getPin, definirVerificadorRol, migrarCredencialesPlanas, origenCredenciales } from './api.js';
import { boveda } from './boveda.js';
import { cargarDatosDeLaApi } from './sincronizar.js';
import { vistaInicio } from './views/inicio.js';
import { vistaConfig } from './views/config.js';
import { vistaProductos } from './views/productos.js';
import { vistaClientes } from './views/clientes.js';
import { vistaVender } from './views/vender.js';
import { vistaVentas } from './views/ventas.js';
import { vistaComprobantes } from './views/comprobantes.js';
import { vistaSunat } from './views/sunat.js';
import { vistaReportes } from './views/reportes.js';

// Menú completo, agrupado como en la barra lateral. admin = solo administrador.
const MENU = [
  { ruta: 'inicio', texto: 'Inicio', icono: 'inicio', grupo: 'Operación' },
  { ruta: 'vender', texto: 'Vender', icono: 'vender', grupo: 'Operación' },
  { ruta: 'ventas', texto: 'Ventas', icono: 'ventas', grupo: 'Operación' },
  { ruta: 'comprobantes', texto: 'Comprobantes', icono: 'comprobantes', grupo: 'Facturación' },
  { ruta: 'sunat', texto: 'Operaciones SUNAT', icono: 'sunat', grupo: 'Facturación' },
  { ruta: 'reportes', texto: 'Reportes', icono: 'reportes', grupo: 'Facturación' },
  { ruta: 'clientes', texto: 'Clientes', icono: 'clientes', grupo: 'Catálogo' },
  { ruta: 'productos', texto: 'Productos', icono: 'productos', grupo: 'Catálogo' },
  { ruta: 'config', texto: 'Configuración', icono: 'config', grupo: 'Administración', admin: true }
];
const GRUPOS = ['Operación', 'Facturación', 'Catálogo', 'Administración'];

const CLAVE_TEMA = 'veterinaria.tema';
const CLAVE_RIEL = 'veterinaria.riel';

const VISTAS = {
  inicio: vistaInicio,
  config: vistaConfig,
  productos: vistaProductos,
  clientes: vistaClientes,
  vender: vistaVender,
  ventas: vistaVentas,
  comprobantes: vistaComprobantes,
  sunat: vistaSunat,
  reportes: vistaReportes,
  mas: vistaMas
};

function visibles() {
  const admin = auth.esAdmin();
  return MENU.filter(m => !m.admin || admin);
}

function pintarMenu(ruta) {
  const raiz = ruta.split('/')[0];
  const lista = visibles();
  $('#nav-side').innerHTML = GRUPOS.map(g => {
    const rutas = lista.filter(m => m.grupo === g);
    if (!rutas.length) return '';
    return `
      <div class="riel-grupo">
        <p class="riel-grupo-titulo">${esc(g)}</p>
        <ul class="riel-lista">
          ${rutas.map(m => `
            <li><a href="#/${m.ruta}" class="riel-enlace ${raiz === m.ruta ? 'activo' : ''}" title="${esc(m.texto)}" ${raiz === m.ruta ? 'aria-current="page"' : ''}>
              ${icono(m.icono)}<span class="riel-texto">${esc(m.texto)}</span>
            </a></li>`).join('')}
        </ul>
      </div>`;
  }).join('');

  const u = auth.actual();
  $('#riel-pie').innerHTML = `
    <div class="riel-boton riel-usuario" title="${esc(u.nombre)}">
      <span class="riel-avatar">${esc(u.nombre.charAt(0).toUpperCase())}</span>
      <span class="riel-usuario-texto">
        <span class="riel-usuario-nombre">${esc(u.nombre)}</span>
        <span class="riel-usuario-rol">${esc(ROLES[u.rol] || u.rol)}</span>
      </span>
    </div>
    <button type="button" class="riel-boton" id="btn-logout" title="Cerrar sesión">${icono('salir')}<span>Cerrar sesión</span></button>`;
  $('#btn-logout').addEventListener('click', salir);
}

function vistaMas(cont) {
  cont.innerHTML = `
    <h1 class="page-title">Más opciones</h1>
    <div class="menu-list">
      ${visibles().map(m => `
        <a class="menu-row" href="#/${m.ruta}">${icono(m.icono)}<span>${esc(m.texto)}</span></a>`).join('')}
      <button class="menu-row" type="button" id="mas-salir">${icono('salir')}<span>Cerrar sesión</span></button>
    </div>`;
  $('#mas-salir', cont).addEventListener('click', salir);
}

// ---------- Menú lateral y tema ----------
// Hasta 1023 px la barra es un panel que se abre encima (móvil) o se despliega sobre los iconos (tablet).
const barraComoPanel = () => window.matchMedia('(max-width: 1023px)').matches;

function leerPreferencia(clave) { try { return localStorage.getItem(clave); } catch { return null; } }
function guardarPreferencia(clave, valor) { try { localStorage.setItem(clave, valor); } catch { /* solo esta sesión */ } }

// En móvil y tablet abre el panel; en escritorio pliega la barra a iconos y lo recuerda.
function alternarMenu() {
  if (barraComoPanel()) { document.body.classList.toggle('menu-abierto'); return; }
  const plegado = document.body.classList.toggle('riel-plegado');
  setTimeout(programarAjuste, 220); // las tablas vuelven a medir su espacio tras la animación
  guardarPreferencia(CLAVE_RIEL, plegado ? 'plegado' : 'abierto');
}

function cerrarMenu() { document.body.classList.remove('menu-abierto'); }

const temaOscuro = () => document.documentElement.classList.contains('dark');

// El botón muestra lo contrario de lo que hay puesto: es lo que uno va a pulsar.
function pintarBotonesTema() {
  const texto = temaOscuro() ? 'Usar tema claro' : 'Usar tema oscuro';
  document.querySelectorAll('.boton-tema').forEach(b => {
    b.innerHTML = icono(temaOscuro() ? 'sol' : 'luna');
    b.setAttribute('aria-label', texto);
    b.title = texto;
  });
}

function alternarTema() {
  const oscuro = !temaOscuro();
  document.documentElement.classList.toggle('dark', oscuro);
  guardarPreferencia(CLAVE_TEMA, oscuro ? 'oscuro' : 'claro');
  pintarBotonesTema();
}

// ---------- Navegación ----------
async function enrutar() {
  const usuario = auth.actual();
  if (!usuario) return mostrarAcceso();

  $('#auth').hidden = true;
  $('#app').hidden = false;

  const ruta = (location.hash.replace(/^#\/?/, '') || 'inicio');
  const raiz = ruta.split('/')[0];
  const item = MENU.find(m => m.ruta === raiz);

  if (item?.admin && !auth.esAdmin()) {
    location.hash = '#/inicio';
    toast('Solo el administrador puede entrar a Configuración.', 'warn');
    return;
  }

  cerrarMenu();
  pintarMenu(ruta);
  const titulo = item?.texto || (raiz === 'mas' ? 'Más' : 'Inicio');
  $('#topbar-title').textContent = titulo;
  document.title = `${titulo} · Veterinaria`;

  const cont = $('#view');
  cont.innerHTML = '';
  try {
    await (VISTAS[raiz] || vistaInicio)(cont, ruta.split('/').slice(1));
  } catch (e) {
    cont.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
  }
  cont.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function pintarMarca() {
  const c = store.config();
  const nombre = c.nombre_comercial || c.razon_social || 'Veterinaria';
  $('#brand-name').textContent = nombre;
  $('#riel-marca').title = nombre;
  $('#barra-negocio').textContent = `${nombre} · `;
  const prod = (c.entorno || 'beta') === 'production';
  const b = $('#env-badge');
  b.textContent = prod ? 'Producción' : 'Beta';
  b.className = `pill ${prod ? 'pill-ok' : 'pill-warn'}`;
  b.title = prod ? 'Entorno SUNAT: producción' : 'Entorno SUNAT: beta (pruebas)';
}

// ---------- Acceso ----------
function mostrarAcceso() {
  $('#app').hidden = true;
  const caja = $('#auth');
  caja.hidden = false;
  const primero = !auth.hayUsuarios();
  const c = store.config();
  const fechaLarga = new Date().toLocaleDateString('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  caja.innerHTML = `
    <div class="ingreso-caja">
      <header>
        <div class="ingreso-marca-fila">
          <span class="riel-logo">${icono('huella')}</span>
          <p class="ingreso-marca">${esc(c.nombre_comercial || c.razon_social || 'Veterinaria')}</p>
        </div>
        <p class="ingreso-fecha">${esc(fechaLarga)}</p>
      </header>
      <form class="ingreso-panel auth-card" id="form-auth" novalidate>
        <h2>${primero ? 'Crea el administrador' : 'Ingresar'}</h2>
        <p class="ingreso-ayuda">${primero ? 'Es el primer uso en este navegador. Este usuario podrá configurar todo el sistema.' : 'Ingresa tu usuario y contraseña.'}</p>
        ${motivoSalida ? `<p class="notice notice-info small">${esc(motivoSalida)}</p>` : ''}
        ${primero ? campo({ nombre: 'nombre', etiqueta: 'Nombre', req: true, attrs: 'autocomplete="name"' }) : ''}
        ${campo({ nombre: 'usuario', etiqueta: 'Usuario', req: true, attrs: 'autocomplete="username" autocapitalize="none"' })}
        ${campo({ nombre: 'clave', etiqueta: 'Contraseña', tipo: 'password', req: true, attrs: `autocomplete="${primero ? 'new-password' : 'current-password'}"`, ayuda: primero ? 'Mínimo 8 caracteres, con letras y números. Protege también las credenciales de la API.' : '' })}
        ${primero ? campo({ nombre: 'clave2', etiqueta: 'Repite la contraseña', tipo: 'password', req: true, attrs: 'autocomplete="new-password"' }) : ''}
        <p class="form-error" id="auth-error" role="alert"></p>
        <button class="btn btn-primary btn-block" type="submit">${primero ? 'Crear y entrar' : 'Entrar'}</button>
        ${primero ? '<label class="link-btn file-link">¿Ya tienes un data.json? Impórtalo<input type="file" accept=".json,application/json" id="auth-import" hidden></label>' : ''}
      </form>
      <button class="btn btn-plano boton-tema ingreso-tema" type="button"></button>
    </div>`;
  pintarBotonesTema();
  $('.ingreso-tema', caja).addEventListener('click', alternarTema);

  const form = $('#form-auth');
  const error = $('#auth-error');
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    error.textContent = '';
    const d = leerForm(form);
    await conCarga(form.querySelector('[type=submit]'), async () => {
      try {
        if (primero) {
          if (!d.nombre) throw new Error('Escribe tu nombre.');
          if (d.clave !== d.clave2) throw new Error('Las contraseñas no coinciden.');
          await auth.crearUsuario({ nombre: d.nombre, usuario: d.usuario, clave: d.clave, rol: 'admin' });
        }
        await auth.ingresar(d.usuario, d.clave);
        motivoSalida = '';
        if (!location.hash || location.hash === '#/') location.hash = '#/inicio';
        await enrutar();
        await alIngresar();
      } catch (e) {
        error.textContent = e.message;
      }
    });
  });

  $('#auth-import')?.addEventListener('change', async ev => {
    const archivo = ev.target.files[0];
    if (!archivo) return;
    try {
      await store.importar(archivo, () => pedirContrasena({ titulo: 'Respaldo cifrado', texto: 'Escribe la contraseña con la que se exportó este respaldo.', textoOk: 'Descifrar e importar' }));
      toast('data.json importado. Ingresa con tu usuario.', 'ok');
      pintarMarca();
      mostrarAcceso();
    } catch (e) {
      error.textContent = e.message;
    }
  });

  form.querySelector('input')?.focus();
}

// Después de ingresar: mueve credenciales en texto plano a la bóveda y avisa lo que falta.
async function alIngresar() {
  try {
    if (await migrarCredencialesPlanas()) toast('Las credenciales de la API se cifraron en la bóveda.', 'ok', 6000);
  } catch { /* se intenta en el próximo ingreso */ }
  const u = auth.actual();
  if (!modoProxy() && boveda.tieneCredenciales() && !boveda.credenciales()) {
    toast('Tu usuario no tiene acceso a las credenciales de la API. Pide al administrador que cambie tu contraseña desde Usuarios.', 'warn', 9000);
  } else if (!modoProxy() && origenCredenciales() === 'config' && u?.rol === 'admin') {
    toast('Las credenciales de la API están en texto plano en config.js. Muévelas a la bóveda en Configuración → Credenciales API.', 'warn', 9000);
  } else if (modoProxy() ? window.APP_CONFIG.API_CONFIGURADA === false : !credencialesListas()) {
    toast('Faltan las credenciales de la API: el administrador las pone en Configuración → Credenciales API.', 'warn', 8000);
  } else if (modoProxy() && window.APP_CONFIG.PIN && !getPin()) {
    toast('Este equipo aún no tiene el PIN del servidor: ingrésalo en Configuración → Credenciales API.', 'warn', 8000);
  }
  cargaInicial();
}

// Cierre por inactividad: cualquier clic o tecla mantiene la sesión; sin actividad, se cierra sola.
let motivoSalida = '';
function vigilarSesion() {
  const tocar = () => auth.tocar();
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(ev, tocar, { passive: true, capture: true });
  const revisar = () => {
    if (!$('#app').hidden && !auth.actual()) {
      motivoSalida = 'Tu sesión se cerró por inactividad. Ingresa de nuevo.';
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      mostrarAcceso();
    }
  };
  setInterval(revisar, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revisar(); });
}

// Primera vez con credenciales: trae empresa, sucursal y series sin que nadie tenga que pedirlo.
function cargaInicial() {
  const sinCredenciales = modoProxy() ? window.APP_CONFIG.API_CONFIGURADA === false : !credencialesListas();
  if (sinCredenciales || store.config().sincronizado_en) return;
  if (modoProxy() && window.APP_CONFIG.PIN && !getPin()) return;
  cargarDatosDeLaApi()
    .then(pasos => toast(pasos.every(p => p.ok) ? 'Datos de la empresa cargados desde la API.' : 'Datos cargados desde la API. Revisa lo pendiente en Configuración.', pasos.every(p => p.ok) ? 'ok' : 'warn', 6000))
    .catch(() => { /* sin conexión: se reintenta en la próxima apertura */ });
}

function salir() {
  auth.salir();
  location.hash = '#/inicio';
  mostrarAcceso();
}

async function iniciar() {
  if (!window.APP_CONFIG) {
    window.APP_CONFIG = { API_URL: '', API_KEY: '', API_SECRET: '', DATA_URL: 'data.json' };
  }
  const r = await store.init();
  if (r.aviso) toast(`Base nueva vacía: ${r.aviso}`, 'warn', 7000);
  if (location.protocol === 'file:' && modoProxy()) toast('Abriste el archivo directamente: el modo servidor necesita abrir la dirección del servidor (http://...).', 'error', 9000);
  // Toda llamada a la API pasa por este control: sesión abierta y rol de administrador cuando corresponde.
  definirVerificadorRol(rol => (rol === 'admin' ? auth.esAdmin() : Boolean(auth.actual())));
  // Sesión abierta y página recargada: vuelve a descifrar las credenciales de la bóveda.
  if (auth.actual()) await boveda.cargar();
  else boveda.cerrar();
  vigilarSesion();

  store.alCambiar(pintarMarca);
  pintarMarca();
  document.body.classList.toggle('riel-plegado', leerPreferencia(CLAVE_RIEL) === 'plegado');
  $('#riel-logo').innerHTML = icono('huella');
  $('#btn-menu').innerHTML = icono('menu');
  $('#btn-menu').addEventListener('click', alternarMenu);
  $('#velo').addEventListener('click', cerrarMenu);
  $('#btn-tema').addEventListener('click', alternarTema);
  pintarBotonesTema();
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && document.body.classList.contains('menu-abierto')) cerrarMenu();
  });
  // Sin tema elegido, el sistema sigue al del equipo.
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', ev => {
    if (leerPreferencia(CLAVE_TEMA)) return;
    document.documentElement.classList.toggle('dark', ev.matches);
    pintarBotonesTema();
  });
  // Toda tabla de datos de cualquier pantalla: fila "+", filas clicables y reajuste al cambiar el contenido.
  activarTablas($('#view'));
  new MutationObserver(programarAjuste).observe($('#view'), { childList: true, subtree: true });
  window.addEventListener('hashchange', enrutar);
  await enrutar();
  if (auth.actual()) cargaInicial();
}

iniciar();
