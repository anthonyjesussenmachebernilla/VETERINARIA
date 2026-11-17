// Login local, roles y sesión. Contraseñas con PBKDF2 (600 000 vueltas), bloqueo por intentos
// fallidos, cierre por inactividad y apertura de la bóveda de credenciales al ingresar.
import { store } from './store.js';
import { derivar, aB64, aleatorio, igualSeguro, VUELTAS } from './cripto.js';
import { boveda } from './boveda.js';

const SESION = 'veterinaria.sesion';
export const ROLES = { admin: 'Administrador', cajero: 'Cajero' };

// SHA-256 en JS puro: solo para verificar contraseñas guardadas con el formato antiguo
// en navegadores sin crypto.subtle.
function sha256Puro(texto) {
  const bytes = new TextEncoder().encode(texto);
  const K = [];
  const H = [];
  const primo = n => { for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
  const frac = x => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
  for (let n = 2, c = 0; c < 64; n++) {
    if (!primo(n)) continue;
    if (c < 8) H.push(frac(Math.sqrt(n)));
    K.push(frac(Math.cbrt(n)));
    c++;
  }
  const largo = bytes.length;
  const total = Math.ceil((largo + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[largo] = 0x80;
  const vista = new DataView(m.buffer);
  vista.setUint32(total - 8, Math.floor((largo * 8) / 2 ** 32));
  vista.setUint32(total - 4, (largo * 8) >>> 0);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = vista.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
  }
  return H.map(x => x.toString(16).padStart(8, '0')).join('');
}

async function sha256(texto) {
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Puro(texto);
}

// ---------- Contraseñas ----------
// Nuevas: PBKDF2-SHA256 (600 000 vueltas). Las antiguas (SHA-256 con sal) se verifican una última vez
// y se actualizan solas al ingresar.
async function verificar(u, clave) {
  if (u.kdf === 'pbkdf2') {
    const d = await derivar(clave, u.sal, u.vueltas || VUELTAS);
    return { ok: igualSeguro(d.verificador, u.hash), llave: d.llave };
  }
  const h = await sha256(`${u.sal}:${clave}`);
  return { ok: igualSeguro(h, u.hash), antigua: true };
}

async function hashNuevo(clave) {
  const sal = aB64(aleatorio(16));
  const d = await derivar(clave, sal);
  return { campos: { sal, hash: d.verificador, kdf: 'pbkdf2', vueltas: VUELTAS }, llave: d.llave };
}

// Devuelve el problema de la contraseña o null si cumple.
export function errorClave(clave, login = '') {
  const c = String(clave || '');
  if (c.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[a-zA-ZñÑ]/.test(c) || !/\d/.test(c)) return 'La contraseña debe tener letras y números.';
  if (login && c.toLowerCase().includes(String(login).toLowerCase())) return 'La contraseña no puede contener el nombre de usuario.';
  if (/^(12345678|password|contraseña|qwerty|veterinaria)/i.test(c)) return 'Esa contraseña es demasiado común.';
  return null;
}

// ---------- Intentos fallidos ----------
// Tras 5 fallos seguidos el usuario queda bloqueado 1 minuto; cada fallo extra duplica la espera (máximo 15).
const INTENTOS = 'veterinaria.intentos';
const MAX_INTENTOS = 5;
const leerIntentos = () => { try { return JSON.parse(localStorage.getItem(INTENTOS) || '{}'); } catch { return {}; } };
const escribirIntentos = v => { try { localStorage.setItem(INTENTOS, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

function esperaRestante(login) {
  const r = leerIntentos()[login];
  return r?.hasta ? Math.max(0, r.hasta - Date.now()) : 0;
}

function registrarFallo(login) {
  const todos = leerIntentos();
  const r = todos[login] || { n: 0 };
  r.n++;
  if (r.n >= MAX_INTENTOS) r.hasta = Date.now() + Math.min(60000 * 2 ** (r.n - MAX_INTENTOS), 15 * 60000);
  todos[login] = r;
  escribirIntentos(todos);
  return Math.max(0, MAX_INTENTOS - r.n);
}

function limpiarFallos(login) {
  const todos = leerIntentos();
  delete todos[login];
  escribirIntentos(todos);
}

// ---------- Sesión ----------
// Se cierra sola por inactividad (15 min por defecto, configurable) y, como tope, a las 12 horas.
const SESION_MAXIMA = 12 * 3600000;
export const minutosInactividad = () => {
  const m = Number(store.config().inactividad_min);
  return m >= 5 && m <= 240 ? m : 15;
};
const leerSesion = () => { try { return JSON.parse(sessionStorage.getItem(SESION) || 'null'); } catch { return null; } };
const escribirSesion = s => { try { s ? sessionStorage.setItem(SESION, JSON.stringify(s)) : sessionStorage.removeItem(SESION); } catch { /* solo memoria */ } };

export const auth = {
  hayUsuarios() {
    return store.todos('usuarios').length > 0;
  },

  actual() {
    const s = leerSesion();
    if (!s) return null;
    const ahora = Date.now();
    if (!s.ultimo || ahora - s.ultimo > minutosInactividad() * 60000 || ahora - (s.inicio || 0) > SESION_MAXIMA) {
      this.salir();
      return null;
    }
    const u = store.buscar('usuarios', s.id);
    return u && u.activo ? u : null;
  },

  // Marca actividad del usuario (clic, tecla). Se guarda como máximo cada 15 s.
  tocar() {
    const s = leerSesion();
    if (s && Date.now() - (s.ultimo || 0) > 15000) escribirSesion({ ...s, ultimo: Date.now() });
  },

  esAdmin() {
    return this.actual()?.rol === 'admin';
  },

  async ingresar(usuario, clave) {
    const login = String(usuario || '').trim().toLowerCase();
    const espera = esperaRestante(login);
    if (espera) throw new Error(`Demasiados intentos fallidos. Espera ${Math.ceil(espera / 60000)} minuto(s) y vuelve a intentar.`);
    const u = store.todos('usuarios').find(x => x.usuario === login);
    const v = u?.activo ? await verificar(u, String(clave || '')) : { ok: false };
    if (!v.ok) {
      const quedan = registrarFallo(login);
      throw new Error(quedan ? 'Usuario o contraseña incorrectos.' : 'Usuario o contraseña incorrectos. El usuario quedó bloqueado unos minutos.');
    }
    limpiarFallos(login);
    let llave = v.llave;
    if (v.antigua) {
      const n = await hashNuevo(String(clave));
      store.actualizar('usuarios', u.id, n.campos);
      llave = n.llave;
    }
    escribirSesion({ id: u.id, inicio: Date.now(), ultimo: Date.now() });
    await boveda.abrir(u, llave);
    return u;
  },

  salir() {
    escribirSesion(null);
    boveda.cerrar();
  },

  async crearUsuario({ nombre, usuario, clave, rol }) {
    const login = String(usuario || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(login)) throw new Error('El usuario debe tener 3 a 30 caracteres: letras, números, punto o guion.');
    const err = errorClave(clave, login);
    if (err) throw new Error(err);
    if (!ROLES[rol]) throw new Error('Rol inválido.');
    if (store.todos('usuarios').some(x => x.usuario === login)) throw new Error('Ese usuario ya existe.');
    const n = await hashNuevo(clave);
    const nuevo = store.insertar('usuarios', { nombre: String(nombre).trim(), usuario: login, rol, ...n.campos, activo: true });
    await boveda.darAcceso(nuevo.id, n.llave);
    return nuevo;
  },

  async cambiarClave(id, clave) {
    const u = store.buscar('usuarios', id);
    const err = errorClave(clave, u?.usuario);
    if (err) throw new Error(err);
    const n = await hashNuevo(clave);
    store.actualizar('usuarios', id, n.campos);
    // Su acceso a la bóveda se vuelve a envolver con la contraseña nueva (la antigua deja de servir).
    if (!await boveda.darAcceso(id, n.llave)) boveda.quitarAcceso(id);
  },

  // Bloqueos activos, para que el administrador los vea y los quite.
  bloqueados() {
    return Object.entries(leerIntentos()).filter(([, r]) => r.hasta && r.hasta > Date.now()).map(([login, r]) => ({ login, hasta: r.hasta }));
  },
  desbloquear(login) { limpiarFallos(login); },

  // Impide quedarse sin ningún administrador activo.
  quedariaSinAdmin(id, cambios) {
    const admins = store.todos('usuarios').filter(u => u.rol === 'admin' && u.activo);
    const esteEsAdmin = admins.some(u => u.id === id);
    const dejaDeSerlo = cambios.rol === 'cajero' || cambios.activo === false || cambios.eliminar;
    return esteEsAdmin && dejaDeSerlo && admins.length === 1;
  }
};
