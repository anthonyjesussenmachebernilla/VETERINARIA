// Cliente de la API de facturación. Único lugar que conoce URL y credenciales.
// Dos modos (config.js):
//   directo: el navegador llama a la API con API_KEY y API_SECRET (solo para pruebas en beta).
//   proxy:   el navegador llama a /api del servidor del sistema, que agrega las credenciales.

import { boveda } from './boveda.js';

// Modo directo: las credenciales que pone el cliente (Configuración → Credenciales API) viven cifradas
// en la bóveda y solo se leen con la sesión abierta. Tienen prioridad sobre config.js.
// Versiones anteriores las guardaban en texto plano en este navegador: se mueven a la bóveda al ingresar.
const CLAVE_CRED_PLANAS = 'veterinaria.credenciales';
function credencialesPlanas() {
  try { return JSON.parse(localStorage.getItem(CLAVE_CRED_PLANAS) || 'null'); } catch { return null; }
}
function borrarCredencialesPlanas() {
  try { localStorage.removeItem(CLAVE_CRED_PLANAS); } catch { /* sin almacenamiento */ }
}

// Origen de las credenciales en uso: 'boveda' | 'config' | '' (faltan).
export function origenCredenciales() {
  if (modoProxy()) return 'servidor';
  if (boveda.credenciales()?.API_KEY) return 'boveda';
  const base = window.APP_CONFIG || {};
  return base.API_KEY && base.API_SECRET ? 'config' : '';
}

const cfg = () => {
  const base = window.APP_CONFIG || {};
  if (base.MODO === 'proxy') return base;
  const c = boveda.credenciales();
  return c?.API_KEY ? { ...base, API_URL: c.API_URL || base.API_URL, API_KEY: c.API_KEY, API_SECRET: c.API_SECRET } : base;
};
export const configApi = () => cfg();

// Tras ingresar: mueve a la bóveda las credenciales que quedaron en texto plano.
export async function migrarCredencialesPlanas() {
  const p = credencialesPlanas();
  if (!p?.API_KEY) return false;
  if (!boveda.abierta()) return false;
  if (!boveda.credenciales()?.API_KEY) await boveda.guardarCredenciales(p);
  borrarCredencialesPlanas();
  return true;
}

// ---------- Permisos ----------
// Operaciones que solo hace el administrador. Se verifican aquí, en el único punto por donde pasa
// toda llamada a la API, y no solo ocultando botones.
const SOLO_ADMIN = [
  [/^DELETE$/, /./],
  [/^(POST|PUT|PATCH)$/, /^\/(empresa|sucursales|series)(\/|$)/],
  [/^GET$/, /^\/empresa\/credenciales$/],
  [/^PUT$/, /^\/(facturas|boletas|notas-credito|notas-debito|guias-remision)\/[^/]+$/],
  [/^POST$/, /^\/(notas-credito|notas-debito|anulaciones|guias-remision|registro)$/]
];
let verificarRol = () => true;
export function definirVerificadorRol(fn) { verificarRol = fn; }

function exigirPermiso(metodo, ruta, body) {
  const anulaBoletas = metodo === 'POST' && ruta === '/resumenes' && Array.isArray(body?.anular) && body.anular.length;
  const soloAdmin = anulaBoletas || SOLO_ADMIN.some(([m, r]) => m.test(metodo) && r.test(ruta));
  if (soloAdmin && !verificarRol('admin')) throw new ApiError('Esta operación solo la puede hacer el administrador.', { status: 403 });
  if (!verificarRol('sesion')) throw new ApiError('La sesión se cerró. Vuelve a ingresar.', { status: 401 });
}
export const modoProxy = () => (window.APP_CONFIG || {}).MODO === 'proxy';

const CLAVE_PIN = 'veterinaria.acceso';
export function getPin() {
  try { return localStorage.getItem(CLAVE_PIN) || ''; } catch { return ''; }
}
export function setPin(pin) {
  try { pin ? localStorage.setItem(CLAVE_PIN, pin) : localStorage.removeItem(CLAVE_PIN); } catch { /* sin almacenamiento */ }
}

export class ApiError extends Error {
  constructor(mensaje, { status = 0, errores = null, datos = null, red = false, pin = false } = {}) {
    super(mensaje);
    this.status = status;
    this.errores = errores;
    this.datos = datos;
    this.red = red;
    this.pin = pin;
  }

  // Lista legible de errores de validación por campo.
  detalle() {
    if (!this.errores) return [];
    if (Array.isArray(this.errores)) return this.errores.map(String);
    return Object.entries(this.errores).map(([campo, msgs]) =>
      `${campo}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`);
  }
}

export function credencialesListas() {
  const c = cfg();
  if (modoProxy()) return Boolean(c.API_URL);
  return Boolean(c.API_URL && c.API_KEY && c.API_SECRET);
}

function url(ruta, query, base = cfg().API_URL) {
  const raiz = String(base || '').replace(/\/+$/, '');
  const u = new URL(raiz + ruta, globalThis.location?.origin && /^https?:/.test(globalThis.location.origin) ? globalThis.location.origin : 'http://localhost');
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
    }
  }
  return u.toString();
}

function headers({ publico = false, json = false } = {}) {
  const h = { Accept: 'application/json' };
  if (json) h['Content-Type'] = 'application/json';
  if (modoProxy()) {
    const pin = getPin();
    if (pin) h['X-Acceso'] = pin;
  } else if (!publico) {
    h['X-Api-Key'] = cfg().API_KEY;
    h['X-Api-Secret'] = cfg().API_SECRET;
  }
  return h;
}

function errorDeRespuesta(res, json) {
  const mensaje = json?.mensaje || json?.message || `Error ${res.status}`;
  if (res.status === 401 && json?.codigo === 'pin') {
    return new ApiError('Este equipo no tiene el PIN de acceso al servidor. Ingrésalo en Configuración → Credenciales API.', { status: 401, pin: true });
  }
  return new ApiError(mensaje, { status: res.status, errores: json?.errores || json?.errors, datos: json?.datos });
}

async function leer(res) {
  const tipo = res.headers.get('content-type') || '';
  if (tipo.includes('application/json')) {
    try { return await res.json(); } catch { return null; }
  }
  const txt = await res.text();
  return txt ? { mensaje: txt.slice(0, 300) } : null;
}

// Llamada base. Devuelve { datos, meta, mensaje, crudo }.
export async function request(metodo, ruta, { body, form, query, publico = false } = {}) {
  exigirPermiso(metodo, ruta.split('?')[0], body);
  if (!cfg().API_URL) throw new ApiError('Falta la URL de la API: ponla en Configuración → Credenciales API.');
  if (!publico && !credencialesListas()) {
    throw new ApiError('Faltan las credenciales de la API: el administrador las pone en Configuración → Credenciales API.');
  }

  const opciones = { method: metodo, headers: headers({ publico, json: body !== undefined }) };
  if (body !== undefined) opciones.body = JSON.stringify(body);
  if (form) opciones.body = form; // FormData: el navegador pone el boundary

  let res;
  try {
    res = await fetch(url(ruta, query), opciones);
  } catch {
    throw new ApiError(
      modoProxy()
        ? 'No se pudo conectar con el servidor del sistema. Revisa que esté encendido y la red.'
        : 'No se pudo conectar con la API. Revisa tu internet o si la API permite llamadas desde este dominio (CORS).',
      { red: true }
    );
  }

  const json = await leer(res);
  const fallo = !res.ok || json?.estado === 'error';
  if (fallo) throw errorDeRespuesta(res, json);
  return { datos: json?.datos ?? json, meta: json?.meta, mensaje: json?.mensaje, crudo: json };
}

// Credenciales actuales del servidor (key enmascarada; el secret nunca sale del servidor).
export async function credencialesServidor() {
  const res = await fetch(cfg().CREDENCIALES_URL || '/credenciales', { headers: headers() });
  const json = await leer(res);
  if (!res.ok || json?.estado === 'error') throw errorDeRespuesta(res, json);
  return json?.datos || {};
}

// Respaldos de data.json en el servidor (solo modo proxy).
export async function respaldoServidor(metodo, ruta = '', body) {
  const opciones = { method: metodo, headers: headers({ json: body !== undefined }) };
  if (body !== undefined) opciones.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(url(ruta, undefined, cfg().RESPALDO_URL || '/respaldo'), opciones);
  } catch {
    throw new ApiError('No se pudo conectar con el servidor del sistema.', { red: true });
  }
  if (ruta && metodo === 'GET' && res.ok) return res.blob();
  const json = await leer(res);
  if (!res.ok || json?.estado === 'error') throw errorDeRespuesta(res, json);
  return json?.datos;
}

// ---------- Credenciales propias del cliente ----------
// Prueba un par sin guardarlo. Devuelve { empresa }. En modo servidor la prueba la hace el servidor
// (el navegador nunca recibe el secret); en modo directo se llama a la API desde aquí.
export async function probarCredenciales({ url, key, secret }) {
  return enviarCredenciales({ url, key, secret }, true);
}

// Prueba y guarda: en el servidor (servidor/.env) o en este navegador.
export async function guardarCredenciales({ url, key, secret }) {
  const r = await enviarCredenciales({ url, key, secret }, false);
  if (!modoProxy()) {
    await boveda.guardarCredenciales({ API_URL: String(url).trim().replace(/\/+$/, ''), API_KEY: key, API_SECRET: secret || cfg().API_SECRET });
    borrarCredencialesPlanas();
  } else if (window.APP_CONFIG) window.APP_CONFIG.API_CONFIGURADA = true;
  return r;
}

// Quita las credenciales de la bóveda: el sistema vuelve a usar las de config.js (si tiene).
export async function borrarCredencialesBoveda() {
  await boveda.borrarCredenciales();
  borrarCredencialesPlanas();
}

async function enviarCredenciales({ url, key, secret }, soloProbar) {
  if (!verificarRol('admin')) throw new ApiError('Solo el administrador cambia las credenciales.', { status: 403 });
  if (!soloProbar && !modoProxy() && !boveda.abierta()) throw new ApiError('La bóveda está cerrada: cierra sesión e ingresa de nuevo como administrador.');
  const apiUrl = String(url || '').trim().replace(/\/+$/, '');
  // En modo servidor una URL vacía conserva la que ya tiene el servidor.
  if ((apiUrl || !modoProxy()) && !/^https?:\/\//i.test(apiUrl)) throw new ApiError('La URL de la API debe empezar con https://');
  if (!key) throw new ApiError('Escribe la API key.');

  if (modoProxy()) {
    let res;
    try {
      res = await fetch(cfg().CREDENCIALES_URL || '/credenciales', {
        method: 'POST', headers: headers({ json: true }),
        body: JSON.stringify({ api_url: apiUrl || undefined, api_key: key, api_secret: secret || '', solo_probar: soloProbar })
      });
    } catch {
      throw new ApiError('No se pudo conectar con el servidor del sistema.', { red: true });
    }
    const json = await leer(res);
    if (!res.ok || json?.estado === 'error') throw errorDeRespuesta(res, json);
    return json?.datos || {};
  }

  const secreto = secret || (key === cfg().API_KEY ? cfg().API_SECRET : '');
  if (!secreto) throw new ApiError('Escribe el API secret.');
  let res;
  try {
    res = await fetch(`${apiUrl}/empresa`, { headers: { Accept: 'application/json', 'X-Api-Key': key, 'X-Api-Secret': secreto } });
  } catch {
    throw new ApiError('No se pudo conectar con la API. Revisa la URL, tu internet o si la API permite llamadas desde este navegador (CORS).', { red: true });
  }
  const json = await leer(res);
  if (res.status === 401 || res.status === 403) throw new ApiError('La API rechazó las credenciales: revisa la API key y el API secret.', { status: res.status });
  if (!res.ok || json?.estado === 'error') throw errorDeRespuesta(res, json);
  return { empresa: json?.datos?.empresa || json?.datos || null };
}

// Descarga binaria (PDF, XML, CDR, ZIP). Devuelve un Blob.
// Si la API responde JSON con el archivo en base64, lo convierte; si no, entrega el JSON como archivo.
export async function descargar(ruta, query, { metodo = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(url(ruta, query), {
      method: metodo,
      headers: headers({ json: body !== undefined }),
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError('No se pudo conectar con la API.', { red: true });
  }
  const tipo = res.headers.get('content-type') || '';
  if (!res.ok || tipo.includes('application/json')) {
    const json = await leer(res);
    if (!res.ok || json?.estado === 'error') throw errorDeRespuesta(res, json);
    const d = json?.datos ?? json;
    const b64 = typeof d === 'string' ? d : (d?.base64 ?? d?.contenido ?? d?.archivo ?? d?.cdr ?? d?.zip ?? d?.xml ?? d?.pdf ?? null);
    if (typeof b64 === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(b64) && b64.length > 40) {
      const bin = atob(b64.replace(/\s/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: d?.mime || 'application/octet-stream' });
    }
    return new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  }
  return res.blob();
}

// La colección usa ?formato= en un caso y ?format= en el resto: se envían ambos.
export function queryPdf(formato = 'a4') {
  return { format: formato, formato };
}

// Endpoints usados en la etapa 1 (todos tomados de la colección).
export const api = {
  registro: form => request('POST', '/registro', { form, publico: true }),
  planes: () => request('GET', '/planes'),

  empresa: () => request('GET', '/empresa'),
  actualizarEmpresa: datos => request('PUT', '/empresa', { body: datos }),
  subirLogo: form => request('POST', '/empresa/logo', { form }),
  subirCertificado: form => request('POST', '/empresa/certificado', { form }),
  credenciales: () => request('GET', '/empresa/credenciales'),
  regenerarCredenciales: () => request('POST', '/empresa/credenciales/regenerar'),

  sucursales: () => request('GET', '/sucursales'),
  crearSucursal: datos => request('POST', '/sucursales', { body: datos }),
  actualizarSucursal: (id, datos) => request('PUT', `/sucursales/${id}`, { body: datos }),
  eliminarSucursal: id => request('DELETE', `/sucursales/${id}`),

  series: () => request('GET', '/series'),
  crearSeries: series => request('POST', '/series', { body: { series } }),
  actualizarSerie: (id, datos) => request('PUT', `/series/${id}`, { body: datos }),

  suscripcion: () => request('GET', '/suscripcion'),
  uso: () => request('GET', '/suscripcion/uso'),

  // Clientes (carpeta "Clientes (CRUD)")
  clientes: query => request('GET', '/clientes', { query }),
  cliente: id => request('GET', `/clientes/${id}`),
  crearCliente: datos => request('POST', '/clientes', { body: datos }),
  actualizarCliente: (id, datos) => request('PUT', `/clientes/${id}`, { body: datos }),
  eliminarCliente: id => request('DELETE', `/clientes/${id}`),

  // Comprobantes (carpetas 04 a 07). ruta = facturas | boletas | notas-credito | notas-debito
  emitir: (ruta, body) => request('POST', `/${ruta}`, { body }),
  comprobante: (ruta, id) => request('GET', `/${ruta}/${id}`),
  listarComprobantes: (ruta, query) => request('GET', `/${ruta}`, { query }),
  enviarComprobante: (ruta, id) => request('POST', `/${ruta}/${id}/enviar`),
  actualizarComprobante: (ruta, id, body) => request('PUT', `/${ruta}/${id}`, { body }),
  eliminarBoleta: id => request('DELETE', `/boletas/${id}`),
  archivo: (ruta, id, tipo, query) => descargar(`/${ruta}/${id}/${tipo}`, query),

  // Notas (carpetas 06 y 07)
  emitirNota: (ruta, body) => request('POST', `/${ruta}`, { body }),

  // Pagos de facturas/boletas al crédito
  pagos: (ruta, id) => request('GET', `/${ruta}/${id}/pagos`),
  registrarPago: (ruta, id, body) => request('POST', `/${ruta}/${id}/pagos`, { body }),
  eliminarPago: (ruta, id, pagoId) => request('DELETE', `/${ruta}/${id}/pagos/${pagoId}`),

  // Resumen diario (carpeta 08)
  resumenes: query => request('GET', '/resumenes', { query }),
  crearResumen: body => request('POST', '/resumenes', { body }),
  estadoResumen: id => request('GET', `/resumenes/${id}/estado`),
  enviarResumen: id => request('POST', `/resumenes/${id}/enviar`),

  // Comunicación de baja (carpeta 09)
  anulaciones: query => request('GET', '/anulaciones', { query }),
  crearAnulacion: body => request('POST', '/anulaciones', { body }),
  anulacion: id => request('GET', `/anulaciones/${id}`),
  estadoAnulacion: id => request('GET', `/anulaciones/${id}/estado`),
  enviarAnulacion: id => request('POST', `/anulaciones/${id}/enviar`),

  // Guía de remisión remitente (carpeta 10)
  guias: query => request('GET', '/guias-remision', { query }),
  guia: id => request('GET', `/guias-remision/${id}`),
  crearGuia: body => request('POST', '/guias-remision', { body }),
  actualizarGuia: (id, body) => request('PUT', `/guias-remision/${id}`, { body }),
  enviarGuia: id => request('POST', `/guias-remision/${id}/enviar`),
  estadoGuia: id => request('GET', `/guias-remision/${id}/estado`),

  // Consultas (carpeta 14) y panel de cobranzas
  consultarCpe: query => request('GET', '/consultar-cpe', { query }),
  consultarCdr: body => descargar('/consultar-cdr', undefined, { metodo: 'POST', body }),
  exportarZip: query => descargar('/comprobantes/exportar-zip', query),
  panelCobranzas: () => request('GET', '/panel/cobranzas'),

  // Catálogo de productos SUNAT (carpeta 23)
  productoSunat: q => request('GET', '/catalogos/producto-sunat', { query: { q } }),
  productoSunatDetalle: codigo => request('GET', `/catalogos/producto-sunat/${encodeURIComponent(codigo)}`)
};

// Paginación: lee meta (estilo Laravel) para saber si hay más páginas.
export function hayMasPaginas(meta, pagina) {
  if (!meta) return false;
  const ultima = meta.last_page ?? meta.ultima_pagina ?? meta.total_paginas;
  if (ultima != null) return pagina < Number(ultima);
  return Boolean(meta.next_page_url || meta.siguiente);
}

// Convierte datos de lista en arreglo, venga como [] o como { data: [] }.
// Encuentra la lista dentro de la respuesta, venga como [], {data: []}, {facturas: []},
// un paginador anidado ({datos: {data: [...]}}) u otra clave con un arreglo de objetos.
const CLAVES_LISTA = ['data', 'items', 'registros', 'comprobantes', 'facturas', 'boletas', 'notas', 'notas_credito', 'notas_debito',
  'resultados', 'results', 'lista', 'rows', 'documentos', 'clientes', 'series', 'sucursales', 'guias', 'resumenes', 'anulaciones', 'pagos', 'datos'];
export function comoLista(datos, nivel = 0) {
  if (Array.isArray(datos)) return datos;
  if (!datos || typeof datos !== 'object' || nivel > 3) return [];
  for (const k of CLAVES_LISTA) {
    if (Array.isArray(datos[k])) return datos[k];
    if (datos[k] && typeof datos[k] === 'object') {
      const dentro = comoLista(datos[k], nivel + 1);
      if (dentro.length) return dentro;
    }
  }
  const arreglo = Object.values(datos).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object');
  return arreglo || [];
}

// Metadatos de paginación: en "meta" o dentro de un paginador estilo Laravel en "datos".
export function metaDe(r) {
  if (r?.meta) return r.meta;
  const d = r?.datos;
  if (d?.paginacion) return d.paginacion;
  if (r?.crudo?.paginacion) return r.crudo.paginacion;
  if (d && !Array.isArray(d) && (d.last_page != null || d.current_page != null || d.next_page_url !== undefined)) return d;
  if (d?.meta) return d.meta;
  return null;
}
