// Servidor del sistema de la veterinaria. Un solo archivo, sin dependencias (Node 18+).
//  - Sirve el sistema (HTML, CSS, JS).
//  - /api/*      reenvía a la API de facturación agregando X-Api-Key y X-Api-Secret del .env.
//                El navegador nunca ve el secret.
//  - /respaldo   guarda copias de data.json de cada equipo (una por hora, 30 días).
//  - /credenciales  el administrador pone o cambia el par de la API (se prueba y se guarda en .env).
// Uso: node servidor/servidor.js   (configuración en servidor/.env)
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------- Configuración ----------
function leerEnv(archivo) {
  const env = {};
  if (!fs.existsSync(archivo)) return env;
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea);
    if (!m || linea.trim().startsWith('#')) continue;
    env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const DIR_SERVIDOR = __dirname;
const ENV = { ...leerEnv(path.join(DIR_SERVIDOR, '.env')), ...process.env };
const CFG = {
  puerto: Number(ENV.PUERTO || 8080),
  host: ENV.HOST || '0.0.0.0',
  apiUrl: String(ENV.API_URL || 'https://sunat.kodevo.es/api/v1').replace(/\/+$/, ''),
  apiKey: ENV.API_KEY || '',
  apiSecret: ENV.API_SECRET || '',
  pin: ENV.PIN_ACCESO || '',
  raiz: path.resolve(DIR_SERVIDOR, ENV.CARPETA_APP || '..'),
  respaldos: path.resolve(DIR_SERVIDOR, ENV.CARPETA_RESPALDOS || 'respaldos'),
  diasRespaldo: Number(ENV.DIAS_RESPALDO || 30),
  limiteMin: Number(ENV.LIMITE_POR_MINUTO || 600),
  maxCuerpo: 20 * 1024 * 1024
};

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

// Nunca se sirven: el servidor, sus secretos, respaldos ni archivos ocultos.
function bloqueado(rel) {
  const partes = rel.split('/').filter(Boolean);
  if (partes.some(p => p.startsWith('.'))) return true;
  if (partes[0] === 'servidor') return true;
  if (partes[0] === 'node_modules') return true;
  return /\.(env|md|zip|log|bak|tmp)$/i.test(rel);
}

// ---------- Utilidades ----------
function responder(res, status, cuerpo, headers = {}) {
  const esTexto = typeof cuerpo === 'string' || Buffer.isBuffer(cuerpo);
  const data = esTexto ? cuerpo : JSON.stringify(cuerpo);
  res.writeHead(status, {
    'Content-Type': esTexto ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers
  });
  res.end(data);
}

const error = (res, status, mensaje, extra = {}) => responder(res, status, { estado: 'error', mensaje, ...extra });

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > CFG.maxCuerpo) { reject(Object.assign(new Error('Solicitud demasiado grande'), { status: 413 })); req.destroy(); return; }
      trozos.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });
}

function igualSeguro(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Límite simple por IP (ventana de un minuto).
const contadores = new Map();
function excedeLimite(ip) {
  const ahora = Date.now();
  const c = contadores.get(ip) || { inicio: ahora, n: 0 };
  if (ahora - c.inicio > 60000) { c.inicio = ahora; c.n = 0; }
  c.n++;
  contadores.set(ip, c);
  return c.n > CFG.limiteMin;
}
setInterval(() => { const t = Date.now(); for (const [ip, c] of contadores) if (t - c.inicio > 120000) contadores.delete(ip); }, 60000).unref();

// Rechaza llamadas desde otros sitios web (el sistema se sirve desde este mismo servidor).
function origenValido(req) {
  const origen = req.headers.origin;
  if (!origen) return true;
  try { return new URL(origen).host === req.headers.host; } catch { return false; }
}

function pinValido(req) {
  return !CFG.pin || igualSeguro(req.headers['x-acceso'] || '', CFG.pin);
}

// ---------- /api: reenvío a la API de facturación ----------
async function proxyApi(req, res, url) {
  if (!CFG.apiKey || !CFG.apiSecret) {
    // /registro es público: se permite aunque aún no haya credenciales.
    if (url.pathname !== '/api/registro') return error(res, 503, 'El servidor no tiene API_KEY y API_SECRET en servidor/.env.');
  }
  const destino = CFG.apiUrl + url.pathname.slice(4) + url.search;
  const headers = { Accept: req.headers.accept || 'application/json' };
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if (url.pathname !== '/api/registro') {
    headers['X-Api-Key'] = CFG.apiKey;
    headers['X-Api-Secret'] = CFG.apiSecret;
  }
  const conCuerpo = !['GET', 'HEAD'].includes(req.method);
  const cuerpo = conCuerpo ? await leerCuerpo(req) : undefined;

  let r;
  try {
    r = await fetch(destino, { method: req.method, headers, body: conCuerpo && cuerpo.length ? cuerpo : undefined, redirect: 'manual', signal: AbortSignal.timeout(60000) });
  } catch (e) {
    return error(res, 502, `No se pudo conectar con la API de facturación (${e.name === 'TimeoutError' ? 'tiempo agotado' : e.message}).`);
  }
  const salida = {
    'Content-Type': r.headers.get('content-type') || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  const disp = r.headers.get('content-disposition');
  if (disp) salida['Content-Disposition'] = disp;
  const buf = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, salida);
  res.end(buf);
}

// ---------- /credenciales: el cliente pone su propio par de la API ----------
const enmascarar = k => (k ? `${k.slice(0, 6)}…${k.slice(-4)}` : '');

// Solo HTTPS (o localhost para desarrollo): el servidor no reenvía el secret a cualquier dirección.
function urlApiValida(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname));
  } catch { return false; }
}

// Prueba un par contra GET /empresa. Devuelve { ok, status, mensaje, empresa }.
async function probarApi(apiUrl, key, secret) {
  try {
    const r = await fetch(`${apiUrl}/empresa`, {
      headers: { Accept: 'application/json', 'X-Api-Key': key, 'X-Api-Secret': secret },
      redirect: 'manual', signal: AbortSignal.timeout(20000)
    });
    let json = null;
    try { json = await r.json(); } catch { /* respuesta no JSON */ }
    if (r.ok && json?.estado !== 'error') return { ok: true, status: r.status, empresa: json?.datos?.empresa || json?.datos || null };
    const mensaje = r.status === 401 || r.status === 403
      ? 'La API rechazó las credenciales: revisa la API key y el API secret.'
      : (json?.mensaje || json?.message || `La API respondió ${r.status}.`);
    return { ok: false, status: r.status, mensaje };
  } catch (e) {
    return { ok: false, status: 0, mensaje: `No se pudo conectar con la API (${e.name === 'TimeoutError' ? 'tiempo agotado' : e.message}).` };
  }
}

// Escribe claves en servidor/.env conservando el resto del archivo y sus comentarios.
function guardarEnv(cambios) {
  const archivo = path.join(DIR_SERVIDOR, '.env');
  const lineas = fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8').split(/\r?\n/) : [];
  const pendientes = { ...cambios };
  const nuevas = lineas.map(l => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(l);
    if (m && !l.trim().startsWith('#') && m[1] in pendientes) {
      const v = pendientes[m[1]];
      delete pendientes[m[1]];
      return `${m[1]}=${v}`;
    }
    return l;
  });
  for (const [k, v] of Object.entries(pendientes)) nuevas.push(`${k}=${v}`);
  const tmp = `${archivo}.tmp`;
  fs.writeFileSync(tmp, nuevas.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
  fs.renameSync(tmp, archivo);
}

async function credenciales(req, res) {
  if (req.method === 'GET') {
    return responder(res, 200, { estado: 'exito', datos: { api_url: CFG.apiUrl, api_key: enmascarar(CFG.apiKey), configurado: Boolean(CFG.apiKey && CFG.apiSecret) } });
  }
  if (req.method !== 'POST') return error(res, 405, 'Operación no permitida.');
  let b;
  try { b = JSON.parse((await leerCuerpo(req)).toString('utf8') || '{}'); } catch (e) { return error(res, e.status || 400, e.status ? e.message : 'JSON inválido.'); }
  const apiUrl = String(b.api_url || CFG.apiUrl).trim().replace(/\/+$/, '');
  const key = String(b.api_key || '').trim();
  // Secret vacío = conservar el actual (para cambiar solo la URL o volver a probar).
  const secret = String(b.api_secret || '').trim() || (key === CFG.apiKey ? CFG.apiSecret : '');
  if (!urlApiValida(apiUrl)) return error(res, 422, 'La URL de la API debe empezar con https://');
  if (!key || !secret) return error(res, 422, 'Escribe la API key y el API secret.');
  if (key.length > 200 || secret.length > 200 || /[\r\n=\s]/.test(key + secret)) return error(res, 422, 'La API key o el secret tienen caracteres no válidos.');

  const prueba = await probarApi(apiUrl, key, secret);
  if (!prueba.ok) return error(res, prueba.status === 401 || prueba.status === 403 ? 422 : 502, prueba.mensaje);
  if (b.solo_probar) return responder(res, 200, { estado: 'exito', mensaje: 'Conexión correcta.', datos: { empresa: prueba.empresa } });

  guardarEnv({ API_URL: apiUrl, API_KEY: key, API_SECRET: secret });
  Object.assign(CFG, { apiUrl, apiKey: key, apiSecret: secret });
  console.log(new Date().toISOString(), `Credenciales de la API actualizadas (${enmascarar(key)}).`);
  return responder(res, 200, { estado: 'exito', mensaje: 'Credenciales guardadas en el servidor.', datos: { empresa: prueba.empresa, api_url: apiUrl, api_key: enmascarar(key) } });
}

// ---------- /respaldo: copias de data.json ----------
const nombreSeguro = s => String(s || 'equipo').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'equipo';

function horaLima(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}_${p.hour}`;
}

function podarRespaldos() {
  const limite = Date.now() - CFG.diasRespaldo * 864e5;
  for (const f of fs.readdirSync(CFG.respaldos)) {
    const ruta = path.join(CFG.respaldos, f);
    if (f.endsWith('.json') && fs.statSync(ruta).mtimeMs < limite) fs.unlinkSync(ruta);
  }
}

async function respaldo(req, res, url) {
  fs.mkdirSync(CFG.respaldos, { recursive: true });
  const nombre = decodeURIComponent(url.pathname.slice('/respaldo'.length).replace(/^\//, ''));

  if (req.method === 'POST' && !nombre) {
    let cuerpo;
    try { cuerpo = JSON.parse((await leerCuerpo(req)).toString('utf8')); } catch (e) { return error(res, e.status || 400, e.status ? e.message : 'JSON inválido.'); }
    const datos = cuerpo?.datos;
    if (!datos || typeof datos !== 'object' || !Array.isArray(datos.ventas) || !Array.isArray(datos.usuarios)) return error(res, 400, 'El respaldo no tiene el formato de data.json.');
    const archivo = `${horaLima()}_${nombreSeguro(cuerpo.dispositivo)}.json`;
    const tmp = path.join(CFG.respaldos, `.${archivo}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(datos));
    fs.renameSync(tmp, path.join(CFG.respaldos, archivo));
    podarRespaldos();
    return responder(res, 200, { estado: 'exito', datos: { archivo, guardado_en: new Date().toISOString() } });
  }

  if (req.method === 'GET' && !nombre) {
    const lista = fs.readdirSync(CFG.respaldos).filter(f => f.endsWith('.json') && !f.startsWith('.'))
      .map(f => { const st = fs.statSync(path.join(CFG.respaldos, f)); return { archivo: f, bytes: st.size, modificado: st.mtime.toISOString() }; })
      .sort((a, b) => b.modificado.localeCompare(a.modificado));
    return responder(res, 200, { estado: 'exito', datos: lista });
  }

  if (req.method === 'GET' && /^[A-Za-z0-9_.-]+\.json$/.test(nombre)) {
    const ruta = path.join(CFG.respaldos, nombre);
    if (path.dirname(ruta) !== CFG.respaldos || !fs.existsSync(ruta)) return error(res, 404, 'Respaldo no encontrado.');
    return responder(res, 200, fs.readFileSync(ruta), { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="data-${nombre}"` });
  }
  return error(res, 405, 'Operación no permitida.');
}

// ---------- Archivos del sistema ----------
function estatico(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) return error(res, 405, 'Método no permitido.');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return error(res, 400, 'Ruta inválida.'); }
  if (rel.includes('\0')) return error(res, 400, 'Ruta inválida.');
  if (rel === '/' || rel === '') rel = '/index.html';
  const ruta = path.resolve(CFG.raiz, '.' + rel);
  const relativa = path.relative(CFG.raiz, ruta).split(path.sep).join('/');
  if (relativa.startsWith('..') || path.isAbsolute(relativa) || bloqueado(relativa)) return error(res, 404, 'No encontrado.');
  // En modo servidor, config.js lo genera el servidor: así nunca se envía un secret guardado en el archivo.
  if (relativa === 'config.js') {
    const js = `window.APP_CONFIG = ${JSON.stringify({ MODO: 'proxy', API_URL: '/api', RESPALDO_URL: '/respaldo', CREDENCIALES_URL: '/credenciales', DATA_URL: 'data.json', PIN: Boolean(CFG.pin), API_CONFIGURADA: Boolean(CFG.apiKey && CFG.apiSecret) })};\n`;
    return responder(res, 200, js, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
  }
  fs.stat(ruta, (e, st) => {
    if (e || !st.isFile()) return error(res, 404, 'No encontrado.');
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(ruta).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': relativa === 'index.html' || relativa === 'data.json' ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(ruta).pipe(res);
  });
}

// ---------- Servidor ----------
const servidor = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || '';
  try {
    const url = new URL(req.url, 'http://local');
    const esApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
    const esRespaldo = url.pathname === '/respaldo' || url.pathname.startsWith('/respaldo/');
    const esCredenciales = url.pathname === '/credenciales';

    if (esApi || esRespaldo || esCredenciales) {
      if (excedeLimite(ip)) return error(res, 429, 'Demasiadas solicitudes. Espera un minuto.');
      if (!origenValido(req)) return error(res, 403, 'Origen no permitido.');
      if (!pinValido(req)) return error(res, 401, 'PIN de acceso incorrecto o faltante.', { codigo: 'pin' });
      if (esCredenciales) return await credenciales(req, res);
      return esApi ? await proxyApi(req, res, url) : await respaldo(req, res, url);
    }
    if (url.pathname === '/salud') return responder(res, 200, { estado: 'exito', datos: { api: Boolean(CFG.apiKey && CFG.apiSecret), pin: Boolean(CFG.pin) } });
    return estatico(req, res, url);
  } catch (e) {
    if (!res.headersSent) error(res, e.status || 500, e.status ? e.message : 'Error interno del servidor.');
    if (!e.status) console.error(new Date().toISOString(), e);
  }
});

if (require.main === module) {
  servidor.listen(CFG.puerto, CFG.host, () => {
    console.log(`Veterinaria lista en http://localhost:${CFG.puerto}`);
    console.log(`API: ${CFG.apiUrl} · credenciales ${CFG.apiKey && CFG.apiSecret ? 'cargadas' : 'FALTAN (servidor/.env)'} · PIN ${CFG.pin ? 'activo' : 'desactivado'}`);
    if (!CFG.pin && CFG.host !== '127.0.0.1') console.log('Aviso: sin PIN_ACCESO cualquiera en tu red puede usar el servidor para emitir comprobantes.');
  });
}

module.exports = { servidor, CFG, bloqueado };
