/* Veterinaria · generado desde src/ con node construir.mjs. No editar aquí: los cambios se pierden al reconstruir. */
(() => {
  // src/cripto.js
  var VUELTAS = 6e5;
  var sutil = () => {
    if (!globalThis.crypto?.subtle) throw new Error("Este navegador no permite cifrar. Usa Chrome, Edge o Firefox actualizados.");
    return globalThis.crypto.subtle;
  };
  var aB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  var deB64 = (txt) => Uint8Array.from(atob(txt), (c) => c.charCodeAt(0));
  var aHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
  function aleatorio(n) {
    const a = new Uint8Array(n);
    globalThis.crypto.getRandomValues(a);
    return a;
  }
  function igualSeguro(a, b) {
    a = String(a);
    b = String(b);
    let d = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return d === 0;
  }
  async function derivar(clave2, salB64, vueltas = VUELTAS) {
    const base = await sutil().importKey("raw", new TextEncoder().encode(clave2), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await sutil().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: deB64(salB64), iterations: vueltas }, base, 512));
    const llave = await sutil().importKey("raw", bits.slice(32), "AES-GCM", false, ["encrypt", "decrypt"]);
    return { verificador: aHex(bits.slice(0, 32)), llave };
  }
  var importarLlave = (bytes) => sutil().importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  async function cifrar(llave, bytes) {
    const iv = aleatorio(12);
    const ct = await sutil().encrypt({ name: "AES-GCM", iv }, llave, bytes);
    return { iv: aB64(iv), ct: aB64(ct) };
  }
  async function descifrar(llave, sobre) {
    const pt = await sutil().decrypt({ name: "AES-GCM", iv: deB64(sobre.iv) }, llave, deB64(sobre.ct));
    return new Uint8Array(pt);
  }
  var cifrarJson = (llave, obj) => cifrar(llave, new TextEncoder().encode(JSON.stringify(obj)));
  var descifrarJson = async (llave, sobre) => JSON.parse(new TextDecoder().decode(await descifrar(llave, sobre)));
  var FORMATO_RESPALDO = "veterinaria-respaldo-cifrado";
  async function cifrarConContrasena(obj, clave2) {
    const sal = aB64(aleatorio(16));
    const { llave } = await derivar(clave2, sal);
    return { formato: FORMATO_RESPALDO, version: 1, kdf: { alg: "PBKDF2-SHA256", vueltas: VUELTAS, sal }, cifrado: "AES-256-GCM", ...await cifrarJson(llave, obj) };
  }
  async function descifrarConContrasena(sobre, clave2) {
    const { llave } = await derivar(clave2, sobre.kdf.sal, sobre.kdf.vueltas);
    try {
      return await descifrarJson(llave, sobre);
    } catch {
      throw new Error("Contraseña incorrecta o archivo dañado.");
    }
  }

  // src/boveda.js
  var CLAVE_SESION = "veterinaria.llave";
  var credenciales = null;
  var leerB = () => store.config().boveda || null;
  var escribirB = (b) => store.setConfig({ boveda: b });
  function llaveSesion() {
    try {
      const t = sessionStorage.getItem(CLAVE_SESION);
      return t ? deB64(t) : null;
    } catch {
      return null;
    }
  }
  function guardarLlaveSesion(bytes) {
    try {
      bytes ? sessionStorage.setItem(CLAVE_SESION, aB64(bytes)) : sessionStorage.removeItem(CLAVE_SESION);
    } catch {
    }
  }
  var boveda = {
    existe: () => Boolean(leerB()),
    abierta: () => Boolean(llaveSesion()),
    tieneCredenciales: () => Boolean(leerB()?.datos),
    tieneAcceso: (id) => Boolean(leerB()?.llaves?.[id]),
    // Al ingresar: abre la bóveda con la llave del usuario. Si aún no existe y es admin, la crea.
    async abrir(usuario, llaveUsuario) {
      let b = leerB();
      if (!b) {
        if (usuario.rol !== "admin") return false;
        const maestra = aleatorio(32);
        b = { version: 1, datos: null, llaves: { [usuario.id]: await cifrar(llaveUsuario, maestra) } };
        escribirB(b);
        guardarLlaveSesion(maestra);
        return true;
      }
      const sobre = b.llaves?.[usuario.id];
      if (!sobre) return false;
      try {
        guardarLlaveSesion(await descifrar(llaveUsuario, sobre));
        await this.cargar();
        return true;
      } catch {
        return false;
      }
    },
    // Tras recargar la página con la sesión abierta: vuelve a descifrar las credenciales.
    async cargar() {
      credenciales = null;
      const b = leerB();
      const maestra = llaveSesion();
      if (!b?.datos || !maestra) return;
      try {
        credenciales = await descifrarJson(await importarLlave(maestra), b.datos);
      } catch {
        credenciales = null;
      }
    },
    cerrar() {
      credenciales = null;
      guardarLlaveSesion(null);
    },
    credenciales: () => credenciales,
    async guardarCredenciales(c) {
      const maestra = llaveSesion();
      if (!maestra) throw new Error("La bóveda está cerrada: cierra sesión e ingresa de nuevo con un usuario administrador.");
      const b = leerB();
      escribirB({ ...b, datos: await cifrarJson(await importarLlave(maestra), c) });
      credenciales = { ...c };
    },
    async borrarCredenciales() {
      const b = leerB();
      if (b) escribirB({ ...b, datos: null });
      credenciales = null;
    },
    // Da acceso a otro usuario (al crearlo o al cambiar su contraseña). Requiere la bóveda abierta.
    async darAcceso(usuarioId, llaveUsuario) {
      const maestra = llaveSesion();
      const b = leerB();
      if (!maestra || !b) return false;
      escribirB({ ...b, llaves: { ...b.llaves, [usuarioId]: await cifrar(llaveUsuario, maestra) } });
      return true;
    },
    quitarAcceso(usuarioId) {
      const b = leerB();
      if (!b?.llaves?.[usuarioId]) return;
      const llaves = { ...b.llaves };
      delete llaves[usuarioId];
      escribirB({ ...b, llaves });
    }
  };

  // src/api.js
  var CLAVE_CRED_PLANAS = "veterinaria.credenciales";
  function credencialesPlanas() {
    try {
      return JSON.parse(localStorage.getItem(CLAVE_CRED_PLANAS) || "null");
    } catch {
      return null;
    }
  }
  function borrarCredencialesPlanas() {
    try {
      localStorage.removeItem(CLAVE_CRED_PLANAS);
    } catch {
    }
  }
  function origenCredenciales() {
    if (modoProxy()) return "servidor";
    if (boveda.credenciales()?.API_KEY) return "boveda";
    const base = window.APP_CONFIG || {};
    return base.API_KEY && base.API_SECRET ? "config" : "";
  }
  var cfg = () => {
    const base = window.APP_CONFIG || {};
    if (base.MODO === "proxy") return base;
    const c = boveda.credenciales();
    return c?.API_KEY ? { ...base, API_URL: c.API_URL || base.API_URL, API_KEY: c.API_KEY, API_SECRET: c.API_SECRET } : base;
  };
  var configApi = () => cfg();
  async function migrarCredencialesPlanas() {
    const p = credencialesPlanas();
    if (!p?.API_KEY) return false;
    if (!boveda.abierta()) return false;
    if (!boveda.credenciales()?.API_KEY) await boveda.guardarCredenciales(p);
    borrarCredencialesPlanas();
    return true;
  }
  var SOLO_ADMIN = [
    [/^DELETE$/, /./],
    [/^(POST|PUT|PATCH)$/, /^\/(empresa|sucursales|series)(\/|$)/],
    [/^GET$/, /^\/empresa\/credenciales$/],
    [/^PUT$/, /^\/(facturas|boletas|notas-credito|notas-debito|guias-remision)\/[^/]+$/],
    [/^POST$/, /^\/(notas-credito|notas-debito|anulaciones|guias-remision|registro)$/]
  ];
  var verificarRol = () => true;
  function definirVerificadorRol(fn) {
    verificarRol = fn;
  }
  function exigirPermiso(metodo, ruta, body) {
    const anulaBoletas = metodo === "POST" && ruta === "/resumenes" && Array.isArray(body?.anular) && body.anular.length;
    const soloAdmin = anulaBoletas || SOLO_ADMIN.some(([m, r]) => m.test(metodo) && r.test(ruta));
    if (soloAdmin && !verificarRol("admin")) throw new ApiError("Esta operación solo la puede hacer el administrador.", { status: 403 });
    if (!verificarRol("sesion")) throw new ApiError("La sesión se cerró. Vuelve a ingresar.", { status: 401 });
  }
  var modoProxy = () => (window.APP_CONFIG || {}).MODO === "proxy";
  var CLAVE_PIN = "veterinaria.acceso";
  function getPin() {
    try {
      return localStorage.getItem(CLAVE_PIN) || "";
    } catch {
      return "";
    }
  }
  function setPin(pin) {
    try {
      pin ? localStorage.setItem(CLAVE_PIN, pin) : localStorage.removeItem(CLAVE_PIN);
    } catch {
    }
  }
  var ApiError = class extends Error {
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
      return Object.entries(this.errores).map(([campo2, msgs]) => `${campo2}: ${Array.isArray(msgs) ? msgs.join(", ") : msgs}`);
    }
  };
  function credencialesListas() {
    const c = cfg();
    if (modoProxy()) return Boolean(c.API_URL);
    return Boolean(c.API_URL && c.API_KEY && c.API_SECRET);
  }
  function url(ruta, query, base = cfg().API_URL) {
    const raiz = String(base || "").replace(/\/+$/, "");
    const u = new URL(raiz + ruta, globalThis.location?.origin && /^https?:/.test(globalThis.location.origin) ? globalThis.location.origin : "http://localhost");
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== void 0 && v !== null && v !== "") u.searchParams.set(k, v);
      }
    }
    return u.toString();
  }
  function headers({ publico = false, json = false } = {}) {
    const h = { Accept: "application/json" };
    if (json) h["Content-Type"] = "application/json";
    if (modoProxy()) {
      const pin = getPin();
      if (pin) h["X-Acceso"] = pin;
    } else if (!publico) {
      h["X-Api-Key"] = cfg().API_KEY;
      h["X-Api-Secret"] = cfg().API_SECRET;
    }
    return h;
  }
  function errorDeRespuesta(res, json) {
    const mensaje = json?.mensaje || json?.message || `Error ${res.status}`;
    if (res.status === 401 && json?.codigo === "pin") {
      return new ApiError("Este equipo no tiene el PIN de acceso al servidor. Ingrésalo en Configuración → Credenciales API.", { status: 401, pin: true });
    }
    return new ApiError(mensaje, { status: res.status, errores: json?.errores || json?.errors, datos: json?.datos });
  }
  async function leer(res) {
    const tipo = res.headers.get("content-type") || "";
    if (tipo.includes("application/json")) {
      try {
        return await res.json();
      } catch {
        return null;
      }
    }
    const txt = await res.text();
    return txt ? { mensaje: txt.slice(0, 300) } : null;
  }
  async function request(metodo, ruta, { body, form, query, publico = false } = {}) {
    exigirPermiso(metodo, ruta.split("?")[0], body);
    if (!cfg().API_URL) throw new ApiError("Falta la URL de la API: ponla en Configuración → Credenciales API.");
    if (!publico && !credencialesListas()) {
      throw new ApiError("Faltan las credenciales de la API: el administrador las pone en Configuración → Credenciales API.");
    }
    const opciones = { method: metodo, headers: headers({ publico, json: body !== void 0 }) };
    if (body !== void 0) opciones.body = JSON.stringify(body);
    if (form) opciones.body = form;
    let res;
    try {
      res = await fetch(url(ruta, query), opciones);
    } catch {
      throw new ApiError(
        modoProxy() ? "No se pudo conectar con el servidor del sistema. Revisa que esté encendido y la red." : "No se pudo conectar con la API. Revisa tu internet o si la API permite llamadas desde este dominio (CORS).",
        { red: true }
      );
    }
    const json = await leer(res);
    const fallo = !res.ok || json?.estado === "error";
    if (fallo) throw errorDeRespuesta(res, json);
    return { datos: json?.datos ?? json, meta: json?.meta, mensaje: json?.mensaje, crudo: json };
  }
  async function credencialesServidor() {
    const res = await fetch(cfg().CREDENCIALES_URL || "/credenciales", { headers: headers() });
    const json = await leer(res);
    if (!res.ok || json?.estado === "error") throw errorDeRespuesta(res, json);
    return json?.datos || {};
  }
  async function respaldoServidor(metodo, ruta = "", body) {
    const opciones = { method: metodo, headers: headers({ json: body !== void 0 }) };
    if (body !== void 0) opciones.body = JSON.stringify(body);
    let res;
    try {
      res = await fetch(url(ruta, void 0, cfg().RESPALDO_URL || "/respaldo"), opciones);
    } catch {
      throw new ApiError("No se pudo conectar con el servidor del sistema.", { red: true });
    }
    if (ruta && metodo === "GET" && res.ok) return res.blob();
    const json = await leer(res);
    if (!res.ok || json?.estado === "error") throw errorDeRespuesta(res, json);
    return json?.datos;
  }
  async function probarCredenciales({ url: url2, key, secret }) {
    return enviarCredenciales({ url: url2, key, secret }, true);
  }
  async function guardarCredenciales({ url: url2, key, secret }) {
    const r = await enviarCredenciales({ url: url2, key, secret }, false);
    if (!modoProxy()) {
      await boveda.guardarCredenciales({ API_URL: String(url2).trim().replace(/\/+$/, ""), API_KEY: key, API_SECRET: secret || cfg().API_SECRET });
      borrarCredencialesPlanas();
    } else if (window.APP_CONFIG) window.APP_CONFIG.API_CONFIGURADA = true;
    return r;
  }
  async function borrarCredencialesBoveda() {
    await boveda.borrarCredenciales();
    borrarCredencialesPlanas();
  }
  async function enviarCredenciales({ url: url2, key, secret }, soloProbar) {
    if (!verificarRol("admin")) throw new ApiError("Solo el administrador cambia las credenciales.", { status: 403 });
    if (!soloProbar && !modoProxy() && !boveda.abierta()) throw new ApiError("La bóveda está cerrada: cierra sesión e ingresa de nuevo como administrador.");
    const apiUrl = String(url2 || "").trim().replace(/\/+$/, "");
    if ((apiUrl || !modoProxy()) && !/^https?:\/\//i.test(apiUrl)) throw new ApiError("La URL de la API debe empezar con https://");
    if (!key) throw new ApiError("Escribe la API key.");
    if (modoProxy()) {
      let res2;
      try {
        res2 = await fetch(cfg().CREDENCIALES_URL || "/credenciales", {
          method: "POST",
          headers: headers({ json: true }),
          body: JSON.stringify({ api_url: apiUrl || void 0, api_key: key, api_secret: secret || "", solo_probar: soloProbar })
        });
      } catch {
        throw new ApiError("No se pudo conectar con el servidor del sistema.", { red: true });
      }
      const json2 = await leer(res2);
      if (!res2.ok || json2?.estado === "error") throw errorDeRespuesta(res2, json2);
      return json2?.datos || {};
    }
    const secreto = secret || (key === cfg().API_KEY ? cfg().API_SECRET : "");
    if (!secreto) throw new ApiError("Escribe el API secret.");
    let res;
    try {
      res = await fetch(`${apiUrl}/empresa`, { headers: { Accept: "application/json", "X-Api-Key": key, "X-Api-Secret": secreto } });
    } catch {
      throw new ApiError("No se pudo conectar con la API. Revisa la URL, tu internet o si la API permite llamadas desde este navegador (CORS).", { red: true });
    }
    const json = await leer(res);
    if (res.status === 401 || res.status === 403) throw new ApiError("La API rechazó las credenciales: revisa la API key y el API secret.", { status: res.status });
    if (!res.ok || json?.estado === "error") throw errorDeRespuesta(res, json);
    return { empresa: json?.datos?.empresa || json?.datos || null };
  }
  async function descargar(ruta, query, { metodo = "GET", body } = {}) {
    let res;
    try {
      res = await fetch(url(ruta, query), {
        method: metodo,
        headers: headers({ json: body !== void 0 }),
        body: body !== void 0 ? JSON.stringify(body) : void 0
      });
    } catch {
      throw new ApiError("No se pudo conectar con la API.", { red: true });
    }
    const tipo = res.headers.get("content-type") || "";
    if (!res.ok || tipo.includes("application/json")) {
      const json = await leer(res);
      if (!res.ok || json?.estado === "error") throw errorDeRespuesta(res, json);
      const d = json?.datos ?? json;
      const b64 = typeof d === "string" ? d : d?.base64 ?? d?.contenido ?? d?.archivo ?? d?.cdr ?? d?.zip ?? d?.xml ?? d?.pdf ?? null;
      if (typeof b64 === "string" && /^[A-Za-z0-9+/=\s]+$/.test(b64) && b64.length > 40) {
        const bin = atob(b64.replace(/\s/g, ""));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: d?.mime || "application/octet-stream" });
      }
      return new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    }
    return res.blob();
  }
  function queryPdf(formato = "a4") {
    return { format: formato, formato };
  }
  var api = {
    registro: (form) => request("POST", "/registro", { form, publico: true }),
    planes: () => request("GET", "/planes"),
    empresa: () => request("GET", "/empresa"),
    actualizarEmpresa: (datos) => request("PUT", "/empresa", { body: datos }),
    subirLogo: (form) => request("POST", "/empresa/logo", { form }),
    subirCertificado: (form) => request("POST", "/empresa/certificado", { form }),
    credenciales: () => request("GET", "/empresa/credenciales"),
    regenerarCredenciales: () => request("POST", "/empresa/credenciales/regenerar"),
    sucursales: () => request("GET", "/sucursales"),
    crearSucursal: (datos) => request("POST", "/sucursales", { body: datos }),
    actualizarSucursal: (id, datos) => request("PUT", `/sucursales/${id}`, { body: datos }),
    eliminarSucursal: (id) => request("DELETE", `/sucursales/${id}`),
    series: () => request("GET", "/series"),
    crearSeries: (series2) => request("POST", "/series", { body: { series: series2 } }),
    actualizarSerie: (id, datos) => request("PUT", `/series/${id}`, { body: datos }),
    suscripcion: () => request("GET", "/suscripcion"),
    uso: () => request("GET", "/suscripcion/uso"),
    // Clientes (carpeta "Clientes (CRUD)")
    clientes: (query) => request("GET", "/clientes", { query }),
    cliente: (id) => request("GET", `/clientes/${id}`),
    crearCliente: (datos) => request("POST", "/clientes", { body: datos }),
    actualizarCliente: (id, datos) => request("PUT", `/clientes/${id}`, { body: datos }),
    eliminarCliente: (id) => request("DELETE", `/clientes/${id}`),
    // Comprobantes (carpetas 04 a 07). ruta = facturas | boletas | notas-credito | notas-debito
    emitir: (ruta, body) => request("POST", `/${ruta}`, { body }),
    comprobante: (ruta, id) => request("GET", `/${ruta}/${id}`),
    listarComprobantes: (ruta, query) => request("GET", `/${ruta}`, { query }),
    enviarComprobante: (ruta, id) => request("POST", `/${ruta}/${id}/enviar`),
    actualizarComprobante: (ruta, id, body) => request("PUT", `/${ruta}/${id}`, { body }),
    eliminarBoleta: (id) => request("DELETE", `/boletas/${id}`),
    archivo: (ruta, id, tipo, query) => descargar(`/${ruta}/${id}/${tipo}`, query),
    // Notas (carpetas 06 y 07)
    emitirNota: (ruta, body) => request("POST", `/${ruta}`, { body }),
    // Pagos de facturas/boletas al crédito
    pagos: (ruta, id) => request("GET", `/${ruta}/${id}/pagos`),
    registrarPago: (ruta, id, body) => request("POST", `/${ruta}/${id}/pagos`, { body }),
    eliminarPago: (ruta, id, pagoId) => request("DELETE", `/${ruta}/${id}/pagos/${pagoId}`),
    // Resumen diario (carpeta 08)
    resumenes: (query) => request("GET", "/resumenes", { query }),
    crearResumen: (body) => request("POST", "/resumenes", { body }),
    estadoResumen: (id) => request("GET", `/resumenes/${id}/estado`),
    enviarResumen: (id) => request("POST", `/resumenes/${id}/enviar`),
    // Comunicación de baja (carpeta 09)
    anulaciones: (query) => request("GET", "/anulaciones", { query }),
    crearAnulacion: (body) => request("POST", "/anulaciones", { body }),
    anulacion: (id) => request("GET", `/anulaciones/${id}`),
    estadoAnulacion: (id) => request("GET", `/anulaciones/${id}/estado`),
    enviarAnulacion: (id) => request("POST", `/anulaciones/${id}/enviar`),
    // Guía de remisión remitente (carpeta 10)
    guias: (query) => request("GET", "/guias-remision", { query }),
    guia: (id) => request("GET", `/guias-remision/${id}`),
    crearGuia: (body) => request("POST", "/guias-remision", { body }),
    actualizarGuia: (id, body) => request("PUT", `/guias-remision/${id}`, { body }),
    enviarGuia: (id) => request("POST", `/guias-remision/${id}/enviar`),
    estadoGuia: (id) => request("GET", `/guias-remision/${id}/estado`),
    // Consultas (carpeta 14) y panel de cobranzas
    consultarCpe: (query) => request("GET", "/consultar-cpe", { query }),
    consultarCdr: (body) => descargar("/consultar-cdr", void 0, { metodo: "POST", body }),
    exportarZip: (query) => descargar("/comprobantes/exportar-zip", query),
    panelCobranzas: () => request("GET", "/panel/cobranzas"),
    // Catálogo de productos SUNAT (carpeta 23)
    productoSunat: (q) => request("GET", "/catalogos/producto-sunat", { query: { q } }),
    productoSunatDetalle: (codigo) => request("GET", `/catalogos/producto-sunat/${encodeURIComponent(codigo)}`)
  };
  function hayMasPaginas(meta, pagina) {
    if (!meta) return false;
    const ultima = meta.last_page ?? meta.ultima_pagina ?? meta.total_paginas;
    if (ultima != null) return pagina < Number(ultima);
    return Boolean(meta.next_page_url || meta.siguiente);
  }
  var CLAVES_LISTA = [
    "data",
    "items",
    "registros",
    "comprobantes",
    "facturas",
    "boletas",
    "notas",
    "notas_credito",
    "notas_debito",
    "resultados",
    "results",
    "lista",
    "rows",
    "documentos",
    "clientes",
    "series",
    "sucursales",
    "guias",
    "resumenes",
    "anulaciones",
    "pagos",
    "datos"
  ];
  function comoLista(datos, nivel = 0) {
    if (Array.isArray(datos)) return datos;
    if (!datos || typeof datos !== "object" || nivel > 3) return [];
    for (const k of CLAVES_LISTA) {
      if (Array.isArray(datos[k])) return datos[k];
      if (datos[k] && typeof datos[k] === "object") {
        const dentro = comoLista(datos[k], nivel + 1);
        if (dentro.length) return dentro;
      }
    }
    const arreglo = Object.values(datos).find((v) => Array.isArray(v) && v.length && typeof v[0] === "object");
    return arreglo || [];
  }
  function metaDe(r) {
    if (r?.meta) return r.meta;
    const d = r?.datos;
    if (d?.paginacion) return d.paginacion;
    if (r?.crudo?.paginacion) return r.crudo.paginacion;
    if (d && !Array.isArray(d) && (d.last_page != null || d.current_page != null || d.next_page_url !== void 0)) return d;
    if (d?.meta) return d.meta;
    return null;
  }

  // src/store.js
  var CLAVE = "veterinaria.data.v1";
  var CLAVE_EQUIPO = "veterinaria.dispositivo";
  var CLAVE_RESPALDO = "veterinaria.respaldo_servidor";
  var ESPERA_RESPALDO = 6e4;
  var TABLAS = [
    "usuarios",
    "clientes",
    "categorias",
    "productos",
    "ventas",
    "venta_items",
    "comprobantes",
    "cuotas"
  ];
  var db = null;
  var oyentes = /* @__PURE__ */ new Set();
  var SEMILLA = { "version": 1, "actualizado_en": null, "usuarios": [], "configuracion": { "sucursal_id": null, "serie_factura": "F001", "serie_boleta": "B001", "serie_nc_factura": "FC01", "serie_nc_boleta": "BC01", "serie_nd_factura": "FD01", "serie_nd_boleta": "BD01", "serie_guia": "T001" }, "clientes": [], "categorias": [{ "id": 1, "nombre": "Medicamentos" }, { "id": 2, "nombre": "Alimentos" }, { "id": 3, "nombre": "Accesorios" }, { "id": 4, "nombre": "Consultas" }, { "id": 5, "nombre": "Vacunas" }, { "id": 6, "nombre": "Otros servicios" }], "productos": [], "ventas": [], "venta_items": [], "comprobantes": [], "cuotas": [] };
  var esArchivoLocal = () => globalThis.location?.protocol === "file:";
  function vacio() {
    const base = { version: 1, actualizado_en: null, configuracion: {} };
    for (const t of TABLAS) base[t] = [];
    return base;
  }
  function normalizar(datos) {
    const base = vacio();
    if (!datos || typeof datos !== "object") return base;
    base.version = datos.version ?? 1;
    base.actualizado_en = datos.actualizado_en ?? null;
    base.configuracion = { ...datos.configuracion || {} };
    for (const t of TABLAS) base[t] = Array.isArray(datos[t]) ? datos[t] : [];
    return base;
  }
  function leerLocal() {
    try {
      const txt = localStorage.getItem(CLAVE);
      return txt ? JSON.parse(txt) : null;
    } catch {
      return null;
    }
  }
  async function cargarRemoto() {
    const url2 = window.APP_CONFIG?.DATA_URL || "data.json";
    const res = await fetch(url2, { cache: "no-store" });
    if (!res.ok) throw new Error(`No se pudo leer ${url2} (${res.status})`);
    return res.json();
  }
  function persistir() {
    db.actualizado_en = (/* @__PURE__ */ new Date()).toISOString();
    try {
      localStorage.setItem(CLAVE, JSON.stringify(db));
      return true;
    } catch {
      return false;
    }
  }
  var temporizador = null;
  var pendiente = false;
  function leerLS(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  }
  function escribirLS(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
    }
  }
  function programarRespaldo() {
    if (!modoProxy()) return;
    pendiente = true;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => store.respaldarServidor().catch(() => {
    }), ESPERA_RESPALDO);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && pendiente) store.respaldarServidor().catch(() => {
      });
    });
  }
  var store = {
    // Carga la copia local; si no existe, toma data.json como semilla.
    async init() {
      const local = leerLocal();
      if (local) {
        db = normalizar(local);
        return { origen: "local" };
      }
      if (esArchivoLocal()) {
        db = normalizar(structuredClone(SEMILLA));
        persistir();
        return { origen: "semilla" };
      }
      try {
        db = normalizar(await cargarRemoto());
        persistir();
        return { origen: "data.json" };
      } catch {
        db = normalizar(structuredClone(SEMILLA));
        persistir();
        return { origen: "semilla" };
      }
    },
    todos(tabla2) {
      return [...db[tabla2] || []];
    },
    buscar(tabla2, id) {
      return (db[tabla2] || []).find((r) => r.id === id) || null;
    },
    donde(tabla2, fn) {
      return (db[tabla2] || []).filter(fn);
    },
    insertar(tabla2, datos) {
      const lista2 = db[tabla2];
      const id = lista2.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
      const fila = { id, ...datos, creado_en: (/* @__PURE__ */ new Date()).toISOString() };
      lista2.push(fila);
      this.guardar();
      return fila;
    },
    actualizar(tabla2, id, cambios) {
      const fila = this.buscar(tabla2, id);
      if (!fila) throw new Error(`No existe ${tabla2} #${id}`);
      Object.assign(fila, cambios, { actualizado_en: (/* @__PURE__ */ new Date()).toISOString() });
      this.guardar();
      return fila;
    },
    eliminar(tabla2, id) {
      db[tabla2] = db[tabla2].filter((r) => r.id !== id);
      this.guardar();
    },
    config() {
      return { ...db.configuracion };
    },
    setConfig(cambios) {
      Object.assign(db.configuracion, cambios);
      this.guardar();
    },
    guardar() {
      const ok = persistir();
      if (ok) programarRespaldo();
      oyentes.forEach((fn) => fn(ok));
      if (!ok) throw new Error("El navegador no permitió guardar. Exporta data.json ahora para no perder datos.");
    },
    alCambiar(fn) {
      oyentes.add(fn);
      return () => oyentes.delete(fn);
    },
    // Descarga la base completa como data.json. Con contraseña, el archivo va cifrado (AES-256-GCM):
    // sin ella no se puede leer ni modificar sin que se note.
    async exportar(clave2 = null) {
      db.configuracion.ultimo_respaldo = (/* @__PURE__ */ new Date()).toISOString();
      if (clave2) db.configuracion.ultimo_respaldo_cifrado = db.configuracion.ultimo_respaldo;
      persistir();
      const contenido = clave2 ? await cifrarConContrasena(db, clave2) : db;
      const blob = new Blob([JSON.stringify(contenido, null, clave2 ? 0 : 2)], { type: "application/json" });
      const a = document.createElement("a");
      const fecha2 = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      a.href = URL.createObjectURL(blob);
      a.download = clave2 ? `data-${fecha2}.cifrado.json` : `data-${fecha2}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
    },
    // Reemplaza la base con un data.json elegido por el usuario. Si viene cifrado, pedirClave() da la contraseña.
    async importar(archivo, pedirClave = null) {
      const txt = await archivo.text();
      let datos;
      try {
        datos = JSON.parse(txt);
      } catch {
        throw new Error("El archivo no es un JSON válido.");
      }
      if (datos?.formato === FORMATO_RESPALDO) {
        const clave2 = pedirClave ? await pedirClave() : null;
        if (!clave2) throw new Error("Importación cancelada: el respaldo está cifrado y necesita su contraseña.");
        datos = await descifrarConContrasena(datos, clave2);
      }
      const faltan = TABLAS.filter((t) => datos[t] !== void 0 && !Array.isArray(datos[t]));
      if (faltan.length) throw new Error(`Formato inválido en: ${faltan.join(", ")}`);
      if (!Array.isArray(datos.usuarios) || !datos.usuarios.length) {
        throw new Error("El archivo no tiene usuarios; no se importó para no dejarte sin acceso.");
      }
      db = normalizar(datos);
      this.guardar();
    },
    dispositivo() {
      let d = leerLS(CLAVE_EQUIPO);
      if (!d) {
        d = `equipo-${Math.random().toString(36).slice(2, 6)}`;
        escribirLS(CLAVE_EQUIPO, d);
      }
      return d;
    },
    setDispositivo(nombre) {
      const limpio = String(nombre || "").trim().slice(0, 30);
      if (limpio) escribirLS(CLAVE_EQUIPO, limpio);
    },
    ultimoRespaldoServidor() {
      return leerLS(CLAVE_RESPALDO);
    },
    // Envía la copia completa al servidor (una copia por equipo y hora; el servidor guarda 30 días).
    async respaldarServidor() {
      if (!modoProxy()) throw new Error("El respaldo en servidor solo funciona con el servidor del sistema.");
      clearTimeout(temporizador);
      const r = await respaldoServidor("POST", "", { dispositivo: this.dispositivo(), datos: db });
      pendiente = false;
      escribirLS(CLAVE_RESPALDO, (/* @__PURE__ */ new Date()).toISOString());
      return r;
    },
    resumen() {
      const r = { actualizado_en: db.actualizado_en };
      for (const t of TABLAS) r[t] = db[t].length;
      return r;
    }
  };

  // src/auth.js
  var SESION = "veterinaria.sesion";
  var ROLES = { admin: "Administrador", cajero: "Cajero" };
  function sha256Puro(texto) {
    const bytes = new TextEncoder().encode(texto);
    const K = [];
    const H = [];
    const primo = (n) => {
      for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
      return true;
    };
    const frac = (x) => (x - Math.floor(x)) * 2 ** 32 >>> 0;
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
    m[largo] = 128;
    const vista = new DataView(m.buffer);
    vista.setUint32(total - 8, Math.floor(largo * 8 / 2 ** 32));
    vista.setUint32(total - 4, largo * 8 >>> 0);
    const rotr = (x, n) => x >>> n | x << 32 - n;
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = vista.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
        w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = e & f ^ ~e & g;
        const t1 = h + S1 + ch + K[i] + w[i] >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = a & b ^ a & c ^ b & c;
        const t2 = S0 + maj >>> 0;
        h = g;
        g = f;
        f = e;
        e = d + t1 >>> 0;
        d = c;
        c = b;
        b = a;
        a = t1 + t2 >>> 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => {
        H[i] = H[i] + v >>> 0;
      });
    }
    return H.map((x) => x.toString(16).padStart(8, "0")).join("");
  }
  async function sha256(texto) {
    if (window.crypto?.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    return sha256Puro(texto);
  }
  async function verificar(u, clave2) {
    if (u.kdf === "pbkdf2") {
      const d = await derivar(clave2, u.sal, u.vueltas || VUELTAS);
      return { ok: igualSeguro(d.verificador, u.hash), llave: d.llave };
    }
    const h = await sha256(`${u.sal}:${clave2}`);
    return { ok: igualSeguro(h, u.hash), antigua: true };
  }
  async function hashNuevo(clave2) {
    const sal = aB64(aleatorio(16));
    const d = await derivar(clave2, sal);
    return { campos: { sal, hash: d.verificador, kdf: "pbkdf2", vueltas: VUELTAS }, llave: d.llave };
  }
  function errorClave(clave2, login = "") {
    const c = String(clave2 || "");
    if (c.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
    if (!/[a-zA-ZñÑ]/.test(c) || !/\d/.test(c)) return "La contraseña debe tener letras y números.";
    if (login && c.toLowerCase().includes(String(login).toLowerCase())) return "La contraseña no puede contener el nombre de usuario.";
    if (/^(12345678|password|contraseña|qwerty|veterinaria)/i.test(c)) return "Esa contraseña es demasiado común.";
    return null;
  }
  var INTENTOS = "veterinaria.intentos";
  var MAX_INTENTOS = 5;
  var leerIntentos = () => {
    try {
      return JSON.parse(localStorage.getItem(INTENTOS) || "{}");
    } catch {
      return {};
    }
  };
  var escribirIntentos = (v) => {
    try {
      localStorage.setItem(INTENTOS, JSON.stringify(v));
    } catch {
    }
  };
  function esperaRestante(login) {
    const r = leerIntentos()[login];
    return r?.hasta ? Math.max(0, r.hasta - Date.now()) : 0;
  }
  function registrarFallo(login) {
    const todos = leerIntentos();
    const r = todos[login] || { n: 0 };
    r.n++;
    if (r.n >= MAX_INTENTOS) r.hasta = Date.now() + Math.min(6e4 * 2 ** (r.n - MAX_INTENTOS), 15 * 6e4);
    todos[login] = r;
    escribirIntentos(todos);
    return Math.max(0, MAX_INTENTOS - r.n);
  }
  function limpiarFallos(login) {
    const todos = leerIntentos();
    delete todos[login];
    escribirIntentos(todos);
  }
  var SESION_MAXIMA = 12 * 36e5;
  var minutosInactividad = () => {
    const m = Number(store.config().inactividad_min);
    return m >= 5 && m <= 240 ? m : 15;
  };
  var leerSesion = () => {
    try {
      return JSON.parse(sessionStorage.getItem(SESION) || "null");
    } catch {
      return null;
    }
  };
  var escribirSesion = (s) => {
    try {
      s ? sessionStorage.setItem(SESION, JSON.stringify(s)) : sessionStorage.removeItem(SESION);
    } catch {
    }
  };
  var auth = {
    hayUsuarios() {
      return store.todos("usuarios").length > 0;
    },
    actual() {
      const s = leerSesion();
      if (!s) return null;
      const ahora = Date.now();
      if (!s.ultimo || ahora - s.ultimo > minutosInactividad() * 6e4 || ahora - (s.inicio || 0) > SESION_MAXIMA) {
        this.salir();
        return null;
      }
      const u = store.buscar("usuarios", s.id);
      return u && u.activo ? u : null;
    },
    // Marca actividad del usuario (clic, tecla). Se guarda como máximo cada 15 s.
    tocar() {
      const s = leerSesion();
      if (s && Date.now() - (s.ultimo || 0) > 15e3) escribirSesion({ ...s, ultimo: Date.now() });
    },
    esAdmin() {
      return this.actual()?.rol === "admin";
    },
    async ingresar(usuario, clave2) {
      const login = String(usuario || "").trim().toLowerCase();
      const espera2 = esperaRestante(login);
      if (espera2) throw new Error(`Demasiados intentos fallidos. Espera ${Math.ceil(espera2 / 6e4)} minuto(s) y vuelve a intentar.`);
      const u = store.todos("usuarios").find((x) => x.usuario === login);
      const v = u?.activo ? await verificar(u, String(clave2 || "")) : { ok: false };
      if (!v.ok) {
        const quedan = registrarFallo(login);
        throw new Error(quedan ? "Usuario o contraseña incorrectos." : "Usuario o contraseña incorrectos. El usuario quedó bloqueado unos minutos.");
      }
      limpiarFallos(login);
      let llave = v.llave;
      if (v.antigua) {
        const n = await hashNuevo(String(clave2));
        store.actualizar("usuarios", u.id, n.campos);
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
    async crearUsuario({ nombre, usuario, clave: clave2, rol }) {
      const login = String(usuario || "").trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,30}$/.test(login)) throw new Error("El usuario debe tener 3 a 30 caracteres: letras, números, punto o guion.");
      const err = errorClave(clave2, login);
      if (err) throw new Error(err);
      if (!ROLES[rol]) throw new Error("Rol inválido.");
      if (store.todos("usuarios").some((x) => x.usuario === login)) throw new Error("Ese usuario ya existe.");
      const n = await hashNuevo(clave2);
      const nuevo = store.insertar("usuarios", { nombre: String(nombre).trim(), usuario: login, rol, ...n.campos, activo: true });
      await boveda.darAcceso(nuevo.id, n.llave);
      return nuevo;
    },
    async cambiarClave(id, clave2) {
      const u = store.buscar("usuarios", id);
      const err = errorClave(clave2, u?.usuario);
      if (err) throw new Error(err);
      const n = await hashNuevo(clave2);
      store.actualizar("usuarios", id, n.campos);
      if (!await boveda.darAcceso(id, n.llave)) boveda.quitarAcceso(id);
    },
    // Bloqueos activos, para que el administrador los vea y los quite.
    bloqueados() {
      return Object.entries(leerIntentos()).filter(([, r]) => r.hasta && r.hasta > Date.now()).map(([login, r]) => ({ login, hasta: r.hasta }));
    },
    desbloquear(login) {
      limpiarFallos(login);
    },
    // Impide quedarse sin ningún administrador activo.
    quedariaSinAdmin(id, cambios) {
      const admins = store.todos("usuarios").filter((u) => u.rol === "admin" && u.activo);
      const esteEsAdmin = admins.some((u) => u.id === id);
      const dejaDeSerlo = cambios.rol === "cajero" || cambios.activo === false || cambios.eliminar;
      return esteEsAdmin && dejaDeSerlo && admins.length === 1;
    }
  };

  // src/ui.js
  function esc(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  var $ = (sel, raiz = document) => raiz.querySelector(sel);
  var $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
  var TRAZOS = {
    inicio: ["M4 3h5a1 1 0 0 1 1 1v7a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1Z", "M15 3h5a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1Z", "M15 12h5a1 1 0 0 1 1 1v7a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1Z", "M4 16h5a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1Z"],
    vender: ["m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18", "M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25", "M16 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M6 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"],
    ventas: ["M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1Z", "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2", "M12 11h4", "M12 16h4", "M8 11h.01", "M8 16h.01"],
    comprobantes: ["M12 17V7", "M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8", "M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"],
    clientes: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M16 3.128a4 4 0 0 1 0 7.744", "M22 21v-2a4 4 0 0 0-3-3.87", "M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"],
    productos: ["M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z", "M12 22V12", "M3.29 7L12 12L20.71 7", "m7.5 4.27 9 5.15"],
    sunat: ["M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z", "m21.854 2.147-10.94 10.939"],
    reportes: ["M3 3v16a2 2 0 0 0 2 2h16", "M18 17V9", "M13 17V5", "M8 17v-3"],
    config: ["M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915", "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"],
    huella: ["M9 4a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M16 8a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M18 16a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"],
    salir: ["m16 17 5-5-5-5", "M21 12H9", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"],
    menu: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2Z", "M9 3v18"],
    sol: ["M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0", "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41"],
    luna: ["M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"],
    cerrar: ["M18 6 6 18", "m6 6 12 12"],
    imprimir: ["M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2", "M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6", "M7 14h10a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1Z"],
    descargar: ["M12 15V3", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5"],
    ventana: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
    cargando: ["M21 12a9 9 0 1 1-6.219-8.56"],
    atras: ["m15 18-6-6 6-6"],
    adelante: ["m9 18 6-6-6-6"],
    vacio: ["M22 12L16 12L14 15L10 15L8 12L2 12", "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],
    mas: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
    exito: ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "m16 9-5.5 5.5L8 12"],
    info: ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M12 16v-4", "M12 8h.01"],
    alerta: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"],
    error: ["m15 9-6 6", "M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z", "m9 9 6 6"]
  };
  function icono(nombre, clase = "") {
    return `<svg class="icono${clase ? " " + clase : ""}" viewBox="0 0 24 24" aria-hidden="true">${(TRAZOS[nombre] || []).map((d) => `<path d="${d}"/>`).join("")}</svg>`;
  }
  var ICONO_AVISO = { ok: "exito", error: "error", warn: "alerta" };
  function toast(mensaje, tipo = "info", ms = 4e3) {
    const caja = document.getElementById("toasts");
    const t = document.createElement("div");
    t.className = `toast toast-${tipo}`;
    t.setAttribute("role", tipo === "error" ? "alert" : "status");
    t.innerHTML = icono(ICONO_AVISO[tipo] || "info");
    const texto = document.createElement("span");
    texto.textContent = mensaje;
    t.appendChild(texto);
    caja.appendChild(t);
    while (caja.children.length > 3) caja.firstChild.remove();
    setTimeout(() => t.classList.add("saliendo"), Math.max(ms - 400, 0));
    setTimeout(() => t.remove(), ms);
  }
  function toastError(e) {
    const extra = typeof e?.detalle === "function" ? e.detalle() : [];
    toast([e?.message || "Ocurrió un error", ...extra].join("\n"), "error", 7e3);
  }
  function modal({ titulo, contenido, acciones = "" }) {
    const d = document.getElementById("modal");
    if (d.open) d.close();
    d.className = "modal";
    d.innerHTML = `
    <form method="dialog" class="modal-body">
      <header class="modal-head">
        <h2>${esc(titulo)}</h2>
        <button class="icon-btn" value="cancelar" aria-label="Cerrar" title="Cerrar">${icono("cerrar")}</button>
      </header>
      <div class="modal-content">${contenido}</div>
      ${acciones ? `<footer class="modal-foot">${acciones}</footer>` : ""}
    </form>`;
    d.showModal();
    return d;
  }
  var CLAVE_FORMATO = "veterinaria.formato_pdf";
  var ANCHO_FORMATO = { "ticket-80": "26rem", "ticket-58": "21rem", a5: "42rem", a4: "56rem" };
  var espera = (ms) => new Promise((r) => setTimeout(r, ms));
  function formatoPdfPreferido(formatos) {
    let f = null;
    try {
      f = localStorage.getItem(CLAVE_FORMATO);
    } catch {
    }
    return formatos.some((x) => x[0] === f) ? f : formatos[0][0];
  }
  function visorPdf({ titulo, subtitulo = "", formatos = [["a4", "A4"]], formato, cargar: cargar2, nombre = (f) => `comprobante-${f}.pdf` }) {
    const d = document.getElementById("modal");
    if (d.open) d.close();
    let actual = formato || formatoPdfPreferido(formatos);
    let url2 = null;
    let blob = null;
    let turno = 0;
    d.className = "modal modal-visor";
    d.innerHTML = `
    <form method="dialog" class="visor">
      <p class="visor-titulo"><strong>${esc(titulo)}</strong>${subtitulo ? `<span>${esc(subtitulo)}</span>` : ""}</p>
      <div class="visor-papel">
        <div class="visor-estado" data-estado></div>
        <iframe class="visor-marco" title="${esc(titulo)}" hidden></iframe>
      </div>
      <div class="visor-acciones">
        ${formatos.length > 1 ? `
          <div class="visor-formatos" role="radiogroup" aria-label="Tamaño">
            ${formatos.map(([v, t]) => `<button type="button" class="visor-formato" role="radio" data-formato="${esc(v)}">${esc(t)}</button>`).join("")}
          </div>` : ""}
        <button type="button" class="btn btn-primary" data-imprimir disabled>${icono("imprimir")}<span>Imprimir</span></button>
        <button type="button" class="btn" data-descargar disabled aria-label="Descargar">${icono("descargar")}<span>Descargar</span></button>
        <button type="button" class="btn" data-pestana disabled aria-label="Abrir en otra pestaña">${icono("ventana")}<span>Otra pestaña</span></button>
        <button class="btn" value="cerrar" aria-label="Cerrar">${icono("cerrar")}<span>Cerrar</span></button>
      </div>
    </form>`;
    const marco = d.querySelector(".visor-marco");
    const estado2 = d.querySelector("[data-estado]");
    const botones = [...d.querySelectorAll("[data-imprimir], [data-descargar], [data-pestana]")];
    const liberar = () => {
      if (url2) {
        const u = url2;
        setTimeout(() => URL.revokeObjectURL(u), 1e3);
        url2 = null;
      }
    };
    const mostrarEstado = (html) => {
      estado2.innerHTML = html;
      estado2.hidden = false;
      marco.hidden = true;
      botones.forEach((b) => {
        b.disabled = true;
      });
    };
    async function pintar() {
      const mio = ++turno;
      d.style.setProperty("--visor-ancho", ANCHO_FORMATO[actual] || "56rem");
      d.querySelectorAll("[data-formato]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.formato === actual)));
      mostrarEstado(`${icono("cargando", "girando")}<p>Preparando el comprobante…</p>`);
      liberar();
      let ultimoError = null;
      for (let i = 0; i < 4 && mio === turno; i++) {
        try {
          const b = await cargar2(actual);
          if (/json/.test(b.type)) throw new Error("La API todavía no tiene el PDF de este comprobante.");
          blob = b.type === "application/pdf" ? b : new Blob([b], { type: "application/pdf" });
          ultimoError = null;
          break;
        } catch (e) {
          ultimoError = e;
          if (e?.red) break;
          await espera(1500);
        }
      }
      if (mio !== turno || !d.open) return;
      if (ultimoError) {
        mostrarEstado(`${icono("error")}<p>${esc(ultimoError.message || "No se pudo obtener el PDF.")}</p>
        <button type="button" class="btn" data-reintentar>Reintentar</button>`);
        estado2.querySelector("[data-reintentar]").addEventListener("click", pintar);
        return;
      }
      url2 = URL.createObjectURL(blob);
      marco.src = `${url2}#toolbar=0&navpanes=0&view=FitH`;
      marco.hidden = false;
      estado2.hidden = true;
      botones.forEach((b) => {
        b.disabled = false;
      });
      d.querySelector("[data-imprimir]").focus();
    }
    d.querySelectorAll("[data-formato]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.formato === actual) return;
      actual = b.dataset.formato;
      try {
        localStorage.setItem(CLAVE_FORMATO, actual);
      } catch {
      }
      pintar();
    }));
    d.querySelector("[data-imprimir]").addEventListener("click", () => {
      try {
        marco.contentWindow.focus();
        marco.contentWindow.print();
      } catch {
        window.open(url2, "_blank");
        toast("Imprime desde la pestaña que se abrió.", "info");
      }
    });
    d.querySelector("[data-descargar]").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = url2;
      a.download = nombre(actual);
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    d.querySelector("[data-pestana]").addEventListener("click", () => window.open(url2, "_blank"));
    const fuera = (ev) => {
      if (ev.target === d || ev.target.classList?.contains("visor") || ev.target.classList?.contains("visor-papel")) d.close();
    };
    d.addEventListener("click", fuera);
    d.addEventListener("close", () => {
      turno++;
      liberar();
      d.removeEventListener("click", fuera);
      d.className = "modal";
      d.style.removeProperty("--visor-ancho");
    }, { once: true });
    d.showModal();
    pintar();
    return d;
  }
  function tablaDatos({ filas, columnas, numero = (f, i) => i + 1, enlace = null, elegible = false, claseFila = null, totales = null, vacio: vacio2 = "Todavía no hay registros.", pie = "" }) {
    if (!filas.length) return `<div class="vacio">${icono("vacio")}<p>${esc(vacio2)}</p></div>`;
    const esSec = (c) => c.sec || c.clase === "col-acciones";
    const haySec = columnas.some(esSec);
    const clase = (c) => `${c.clase || ""}${esSec(c) ? " sec" : ""}`.trim();
    const filasHtml = filas.map((f, i) => {
      const href = enlace ? enlace(f) : "";
      const celdas = columnas.map((c) => ({ c, html: c.celda(f, i) ?? "" }));
      const detalle2 = haySec ? `<tr class="fila-detalle" hidden><td colspan="${columnas.length + 2}"><dl>
          ${celdas.filter((x) => esSec(x.c) && String(x.html).trim() !== "").map((x) => `<div><dt>${esc(x.c.titulo || "Acciones")}</dt><dd>${x.html}</dd></div>`).join("")}
        </dl></td></tr>` : "";
      return `
      <tr class="${claseFila ? claseFila(f) : ""}${href || elegible ? " elegible" : ""}" ${href ? `data-href="${esc(href)}"` : ""} ${elegible ? `data-fila="${i}"` : ""}>
        <td class="col-n">${esc(numero(f, i))}</td>
        ${celdas.map((x) => `<td class="${clase(x.c)}">${x.html}</td>`).join("")}
        ${haySec ? '<td class="col-mas"><button type="button" class="btn-mas" aria-expanded="false" aria-label="Ver más datos">+</button></td>' : ""}
      </tr>${detalle2}`;
    }).join("");
    return `
    <div class="tabla-caja">
      <table class="tabla">
        <thead><tr>
          <th class="col-n" scope="col">N°</th>
          ${columnas.map((c) => `<th class="${clase(c)}" scope="col">${esc(c.titulo)}</th>`).join("")}
          ${haySec ? '<th class="col-mas" scope="col"><span class="sr-only">Más datos</span></th>' : ""}
        </tr></thead>
        <tbody>${filasHtml}</tbody>
        ${totales ? `<tfoot><tr>
          <td class="col-n"></td>
          ${columnas.map((c) => `<td class="${clase(c)}">${totales(c) ?? ""}</td>`).join("")}
          ${haySec ? '<td class="col-mas"></td>' : ""}
        </tr></tfoot>` : ""}
      </table>
      ${pie}
    </div>`;
  }
  function pieTabla({ pagina, ultima = null, total = null, hayMas, cantidad }) {
    const contador = total != null ? `${total} ${total === 1 ? "registro" : "registros"}` : `${cantidad} ${cantidad === 1 ? "registro" : "registros"}`;
    const paginas = ultima != null ? `Página ${pagina} de ${ultima}` : `Página ${pagina}`;
    const mostrarPaginas = pagina > 1 || hayMas;
    return `
    <div class="tabla-pie">
      <p class="tabla-contador" aria-live="polite">${esc(contador)}</p>
      ${mostrarPaginas ? `<div class="tabla-paginas">
        <span>${esc(paginas)}</span>
        <button class="btn" type="button" data-pagina="-1" aria-label="Página anterior" title="Página anterior" ${pagina > 1 ? "" : "disabled"}>${icono("atras")}</button>
        <button class="btn" type="button" data-pagina="1" aria-label="Página siguiente" title="Página siguiente" ${hayMas ? "" : "disabled"}>${icono("adelante")}</button>
      </div>` : ""}
    </div>`;
  }
  function tablaLocal(caja, { filas, porPagina = 25, clave: clave2 = "", alPintar = null, alElegir = null, ...opciones }) {
    const paginas = Math.max(1, Math.ceil(filas.length / porPagina));
    if (caja._clave !== clave2) {
      caja._clave = clave2;
      caja._pagina = 1;
    }
    let pagina = Math.min(caja._pagina || 1, paginas);
    const pintar = () => {
      caja._pagina = pagina;
      const desde = (pagina - 1) * porPagina;
      const visibles2 = filas.slice(desde, desde + porPagina);
      caja.innerHTML = tablaDatos({
        ...opciones,
        elegible: Boolean(alElegir),
        filas: visibles2,
        numero: (f, i) => desde + i + 1,
        pie: pieTabla({ pagina, ultima: paginas, total: filas.length, hayMas: pagina < paginas, cantidad: filas.length })
      });
      activarTablas(caja, { alPaginar: (paso) => {
        pagina = Math.max(1, Math.min(paginas, pagina + paso));
        pintar();
      } });
      if (alElegir) caja.querySelectorAll("tr[data-fila]").forEach((tr) => {
        tr.tabIndex = 0;
        const elegir = (ev) => {
          if (!ev.target.closest("button, a, input, select, label")) alElegir(visibles2[Number(tr.dataset.fila)]);
        };
        tr.addEventListener("click", elegir);
        tr.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" && ev.target === tr) elegir(ev);
        });
      });
      alPintar?.(caja);
    };
    pintar();
  }
  function activarTablas(raiz, { alPaginar } = {}) {
    if (alPaginar) {
      raiz._alPaginar = alPaginar;
      raiz.dataset.tablas = "";
    }
    if (!raiz._tablas) {
      raiz._tablas = true;
      raiz.addEventListener("click", (ev) => {
        if (ev._tabla) return;
        ev._tabla = true;
        const mas = ev.target.closest(".btn-mas");
        if (mas) {
          const detalle2 = mas.closest("tr").nextElementSibling;
          const abrir2 = detalle2.hidden;
          detalle2.hidden = !abrir2;
          mas.textContent = abrir2 ? "−" : "+";
          mas.setAttribute("aria-expanded", String(abrir2));
          return;
        }
        const pag = ev.target.closest("[data-pagina]");
        if (pag) {
          pag.closest("[data-tablas]")?._alPaginar?.(Number(pag.dataset.pagina));
          return;
        }
        const fila = ev.target.closest("tr.elegible");
        if (fila?.dataset.href && !ev.target.closest("button, a, input, select, label")) location.hash = fila.dataset.href;
      });
    }
    programarAjuste();
  }
  function ajustarTablas() {
    document.querySelectorAll("table.tabla").forEach((t) => {
      const caja = t.parentElement;
      if (!caja?.clientWidth || !t.querySelector(".sec")) return;
      t.classList.remove("compacta");
      const noCabe = t.offsetWidth > caja.clientWidth + 1;
      t.classList.toggle("compacta", noCabe);
      const ocultas = noCabe || getComputedStyle(t.querySelector(".sec")).display === "none";
      if (!ocultas) {
        t.querySelectorAll(".fila-detalle:not([hidden])").forEach((d) => {
          d.hidden = true;
          const b = d.previousElementSibling?.querySelector(".btn-mas");
          if (b) {
            b.textContent = "+";
            b.setAttribute("aria-expanded", "false");
          }
        });
      }
    });
  }
  var ajustePendiente = false;
  function programarAjuste() {
    if (ajustePendiente) return;
    ajustePendiente = true;
    requestAnimationFrame(() => {
      ajustePendiente = false;
      ajustarTablas();
    });
  }
  if (typeof window !== "undefined") window.addEventListener("resize", programarAjuste);
  function pedirContrasena({ titulo, texto = "", confirmar: confirmar2 = false, validar = null, textoOk = "Continuar" }) {
    return new Promise((resolve) => {
      const d = modal({
        titulo,
        contenido: `
        ${texto ? `<p class="muted">${esc(texto)}</p>` : ""}
        <div class="form-grid">
          ${campo({ nombre: "clave", etiqueta: "Contraseña", tipo: "password", req: true, attrs: `autocomplete="${confirmar2 ? "new-password" : "off"}"` })}
          ${confirmar2 ? campo({ nombre: "clave2", etiqueta: "Repite la contraseña", tipo: "password", req: true, attrs: 'autocomplete="new-password"' }) : ""}
          <p class="form-error span-all" id="pc-error"></p>
        </div>`,
        acciones: `<button class="btn" value="cancelar">Cancelar</button><button class="btn btn-primary" value="ok" id="pc-ok">${esc(textoOk)}</button>`
      });
      let valor = null;
      const ok = $("#pc-ok", d);
      ok.addEventListener("click", (ev) => {
        const clave2 = $("[name=clave]", d).value;
        const err = !clave2 ? "Escribe la contraseña." : confirmar2 && clave2 !== $("[name=clave2]", d).value ? "Las contraseñas no coinciden." : validar ? validar(clave2) : null;
        if (err) {
          ev.preventDefault();
          $("#pc-error", d).textContent = err;
          return;
        }
        valor = clave2;
      });
      d.addEventListener("close", () => resolve(d.returnValue === "ok" ? valor : null), { once: true });
      $("[name=clave]", d).focus();
    });
  }
  function cerrarModal() {
    const d = document.getElementById("modal");
    if (d.open) d.close();
  }
  function confirmar(titulo, mensaje, textoOk = "Confirmar", peligro = false) {
    return new Promise((resolve) => {
      const d = modal({
        titulo,
        contenido: `<p>${esc(mensaje)}</p>`,
        acciones: `
        <button class="btn" value="no">Cancelar</button>
        <button class="btn ${peligro ? "btn-danger" : "btn-primary"}" value="si">${esc(textoOk)}</button>`
      });
      d.addEventListener("close", () => resolve(d.returnValue === "si"), { once: true });
    });
  }
  function leerForm(form, { omitirVacios = false } = {}) {
    const datos = {};
    for (const [k, v] of new FormData(form).entries()) {
      if (v instanceof File) continue;
      const valor = typeof v === "string" ? v.trim() : v;
      if (omitirVacios && valor === "") continue;
      datos[k] = valor;
    }
    return datos;
  }
  async function conCarga(boton, fn) {
    if (!boton || boton.disabled) return;
    const texto = boton.textContent;
    boton.disabled = true;
    boton.dataset.cargando = "1";
    boton.textContent = "Procesando…";
    try {
      return await fn();
    } finally {
      boton.disabled = false;
      delete boton.dataset.cargando;
      boton.textContent = texto;
    }
  }
  function campo({ nombre, etiqueta: etiqueta2, valor = "", tipo = "text", req = false, ayuda = "", attrs = "" }) {
    return `
    <label class="field">
      <span class="field-label">${esc(etiqueta2)}${req ? ' <b aria-hidden="true">*</b>' : ""}</span>
      <input name="${esc(nombre)}" type="${esc(tipo)}" value="${esc(valor)}" ${req ? "required" : ""} ${attrs}>
      ${ayuda ? `<small class="field-help">${esc(ayuda)}</small>` : ""}
    </label>`;
  }
  function selector({ nombre, etiqueta: etiqueta2, opciones, valor = "", req = false, ayuda = "" }) {
    const ops = opciones.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(valor) ? "selected" : ""}>${esc(t)}</option>`).join("");
    return `
    <label class="field">
      <span class="field-label">${esc(etiqueta2)}${req ? ' <b aria-hidden="true">*</b>' : ""}</span>
      <select name="${esc(nombre)}" ${req ? "required" : ""}>${ops}</select>
      ${ayuda ? `<small class="field-help">${esc(ayuda)}</small>` : ""}
    </label>`;
  }
  function crudo(obj, abierto = false) {
    if (obj === void 0) return "";
    return `
    <details class="raw" ${abierto ? "open" : ""}>
      <summary>Respuesta de la API</summary>
      <pre>${esc(JSON.stringify(obj, null, 2))}</pre>
    </details>`;
  }
  function vacioMsg(texto) {
    return `<p class="empty">${esc(texto)}</p>`;
  }
  function fecha(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
  }

  // src/sincronizar.js
  var DEFECTOS = [
    ["serie_factura", "01", "F", "Factura"],
    ["serie_boleta", "03", "B", "Boleta"],
    ["serie_nc_factura", "07", "F", "Nota de crédito (facturas)"],
    ["serie_nc_boleta", "07", "B", "Nota de crédito (boletas)"],
    ["serie_nd_factura", "08", "F", "Nota de débito (facturas)"],
    ["serie_nd_boleta", "08", "B", "Nota de débito (boletas)"],
    ["serie_guia", "09", "T", "Guía de remisión"]
  ];
  var CODIGO_POR_TIPO = { factura: "01", boleta: "03", nota_credito: "07", nota_debito: "08", guia_remision: "09" };
  function sincronizarEmpresa(e) {
    if (!e || typeof e !== "object") return;
    const campos = ["ruc", "razon_social", "nombre_comercial", "direccion", "ubigeo", "entorno", "tax_regime", "plan", "igv_rate_override", "tasa_igv_vigente", "nrus_categoria"];
    const copia = {};
    for (const k of campos) if (e[k] !== void 0) copia[k] = e[k];
    if (Object.keys(copia).length) store.setConfig(copia);
  }
  var activa = (s) => {
    const v = s.activo ?? s.is_active;
    return v !== false && v !== 0;
  };
  var codigoDe = (s) => String(s.tipo_documento ?? CODIGO_POR_TIPO[s.tipo] ?? "");
  var sucursalDe = (s) => s.sucursal?.id ?? s.sucursal_id ?? null;
  async function cargarDatosDeLaApi() {
    const pasos = [];
    const r = await api.empresa();
    const e = r.datos?.empresa || r.datos || {};
    sincronizarEmpresa(e);
    pasos.push({ ok: true, texto: `Empresa: ${e.razon_social || "sin nombre"}${e.ruc ? ` · RUC ${e.ruc}` : ""}` });
    pasos.push({ ok: true, texto: `Entorno SUNAT: ${e.entorno === "production" ? "producción" : "beta (pruebas)"}` });
    let sucursalId = store.config().sucursal_id;
    try {
      const sucs = comoLista((await api.sucursales()).datos);
      let elegida = sucs.find((s) => String(s.id) === String(sucursalId));
      if (!elegida) {
        elegida = sucs.find((s) => s.es_principal) || sucs.find((s) => ["0000", "0001"].includes(String(s.cod_local))) || sucs[0];
        if (elegida) store.setConfig({ sucursal_id: elegida.id });
      }
      sucursalId = elegida?.id ?? null;
      pasos.push(elegida ? { ok: true, texto: `Sucursal del punto de venta: ${elegida.nombre || "sin nombre"} (${elegida.cod_local || "—"})` } : { ok: false, texto: "La API no tiene sucursales: crea la principal en Configuración → Sucursales." });
    } catch (err) {
      pasos.push({ ok: false, texto: `No se pudieron leer las sucursales: ${err.message}` });
    }
    try {
      const todas = comoLista((await api.series()).datos).filter(activa);
      const deSucursal = todas.filter((s) => sucursalDe(s) == null || String(sucursalDe(s)) === String(sucursalId));
      const cfg2 = store.config();
      const cambios = {};
      const faltan = [];
      const elegidas = [];
      for (const [clave2, codigo, letra, nombre] of DEFECTOS) {
        const candidatas = (deSucursal.length ? deSucursal : todas).filter((s) => codigoDe(s) === codigo && String(s.serie || "").toUpperCase().startsWith(letra)).sort((a, b) => String(a.serie).localeCompare(String(b.serie)));
        if (candidatas.some((s) => s.serie === cfg2[clave2])) {
          elegidas.push(`${nombre} ${cfg2[clave2]}`);
          continue;
        }
        if (candidatas[0]) {
          cambios[clave2] = candidatas[0].serie;
          elegidas.push(`${nombre} ${candidatas[0].serie}`);
        } else faltan.push(nombre);
      }
      if (Object.keys(cambios).length) store.setConfig(cambios);
      if (elegidas.length) pasos.push({ ok: true, texto: `Series por defecto: ${elegidas.join(", ")}` });
      if (faltan.length) pasos.push({ ok: false, texto: `Sin serie activa para: ${faltan.join(", ")}. Créalas en Configuración → Series.` });
    } catch (err) {
      pasos.push({ ok: false, texto: `No se pudieron leer las series: ${err.message}` });
    }
    store.setConfig({ sincronizado_en: (/* @__PURE__ */ new Date()).toISOString() });
    return pasos;
  }

  // src/validar.js
  var TIPOS_DOC = [
    ["1", "DNI"],
    ["6", "RUC"],
    ["4", "Carnet de extranjería"],
    ["7", "Pasaporte"],
    ["A", "Cédula diplomática"],
    ["0", "Otros / sin documento"]
  ];
  var nombreTipoDoc = (t) => (TIPOS_DOC.find((x) => x[0] === String(t)) || [t, t])[1];
  var AFECTACIONES = [
    ["10", "Gravado (IGV)"],
    ["20", "Exonerado"],
    ["30", "Inafecto"]
  ];
  var UNIDADES = [
    ["NIU", "Unidad (bienes)"],
    ["ZZ", "Servicio"],
    ["KGM", "Kilogramo"],
    ["GRM", "Gramo"],
    ["LTR", "Litro"],
    ["MLT", "Mililitro"],
    ["BX", "Caja"],
    ["BG", "Bolsa"],
    ["PK", "Paquete"],
    ["BO", "Botella"],
    ["DZN", "Docena"]
  ];
  function validarRuc(ruc) {
    ruc = String(ruc || "");
    if (!/^(10|15|17|20)\d{9}$/.test(ruc)) return false;
    const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const suma = pesos.reduce((s, p, i) => s + p * Number(ruc[i]), 0);
    const dv = (11 - suma % 11) % 10;
    return dv === Number(ruc[10]);
  }
  function errorDocumento(tipo, numero) {
    const n = String(numero || "").trim();
    switch (String(tipo)) {
      case "1":
        return /^\d{8}$/.test(n) ? null : "El DNI debe tener 8 dígitos.";
      case "6":
        return validarRuc(n) ? null : "RUC inválido: 11 dígitos, empieza con 10, 15, 17 o 20 y dígito verificador correcto.";
      case "4":
        return /^[A-Za-z0-9]{8,12}$/.test(n) ? null : "El carnet de extranjería tiene de 8 a 12 caracteres.";
      case "7":
        return /^[A-Za-z0-9]{5,12}$/.test(n) ? null : "El pasaporte tiene de 5 a 12 caracteres.";
      case "A":
        return /^[A-Za-z0-9]{3,15}$/.test(n) ? null : "Cédula diplomática inválida.";
      case "0":
        return n ? null : "Escribe un número o identificador.";
      default:
        return "Tipo de documento inválido.";
    }
  }
  var esEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || ""));
  var r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  var soles = (n) => `S/ ${r2(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  var norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // src/comprobantes.js
  var TIPOS_CPE = {
    "01": { ruta: "facturas", nombre: "Factura" },
    "03": { ruta: "boletas", nombre: "Boleta" },
    "07": { ruta: "notas-credito", nombre: "Nota de crédito" },
    "08": { ruta: "notas-debito", nombre: "Nota de débito" }
  };
  var METODOS_PAGO = [
    ["efectivo", "Efectivo"],
    ["yape", "Yape"],
    ["plin", "Plin"],
    ["tarjeta", "Tarjeta"],
    ["transferencia", "Transferencia"]
  ];
  var CONSUMIDOR_FINAL = { tipo_doc: "0", num_doc: "99999999", razon_social: "CLIENTES VARIOS" };
  var LIMITE_BOLETA_SIN_DNI = 700;
  function hoyLima(d = /* @__PURE__ */ new Date()) {
    return d.toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  }
  var ESTADOS = {
    pendiente: { texto: "Pendiente de envío", clase: "pill-warn" },
    enviado: { texto: "En proceso", clase: "pill-info" },
    aceptado: { texto: "Aceptado por SUNAT", clase: "pill-ok" },
    observado: { texto: "Aceptado con observaciones", clase: "pill-ok" },
    rechazado: { texto: "Rechazado", clase: "pill-danger" },
    anulado: { texto: "Anulado", clase: "" },
    error: { texto: "No emitido", clase: "pill-danger" },
    desconocido: { texto: "Estado por confirmar", clase: "pill-warn" }
  };
  function normalizarEstado(valor) {
    const v = String(valor ?? "").toLowerCase().trim();
    if (!v) return "desconocido";
    if (/(observ)/.test(v)) return "observado";
    if (/^(aceptad|accepted|acept)/.test(v)) return "aceptado";
    if (/(rechaz|reject)/.test(v)) return "rechazado";
    if (/(anulad|baja|voided)/.test(v)) return "anulado";
    if (/(enviad|proces|sent|queued|encolad)/.test(v)) return "enviado";
    if (/(pendient|pending|registrad)/.test(v)) return "pendiente";
    return "desconocido";
  }
  var esFinal = (e) => ["aceptado", "observado", "rechazado", "anulado"].includes(e);
  function leerCpe(datos) {
    const d = datos?.comprobante || datos?.factura || datos?.boleta || datos || {};
    const s = d.sunat && typeof d.sunat === "object" ? d.sunat : {};
    const estadoCrudo = d.sunat_status ?? s.estado ?? d.estado_sunat ?? d.status ?? (typeof d.estado === "string" ? d.estado : void 0);
    const mensaje = s.descripcion ?? d.descripcion_sunat ?? d.sunat_description ?? d.sunat_message ?? d.mensaje_sunat ?? d.cdr_description ?? d.sunat_response?.description ?? null;
    const total = d.totales?.total ?? d.mto_imp_venta ?? d.total ?? d.importe_total ?? d.monto_total ?? null;
    let estado2 = normalizarEstado(estadoCrudo);
    if (estado2 === "aceptado" && Array.isArray(s.notas) && s.notas.length) estado2 = "observado";
    return {
      api_id: d.id ?? null,
      serie: d.serie ?? null,
      correlativo: d.correlativo ?? d.numero ?? null,
      sunat_status: estado2,
      estado_api: estadoCrudo ?? null,
      mensaje_sunat: mensaje,
      codigo_sunat: s.codigo ?? d.sunat_code ?? d.codigo_sunat ?? d.cdr_code ?? null,
      total_oficial: total != null ? Number(total) : null
    };
  }
  function calcularLinea(it, tasa) {
    const bruto = r2(it.precio * it.cantidad);
    const descuento = r2(Math.min(Math.max(Number(it.descuento) || 0, 0), bruto));
    const importe = r2(bruto - descuento);
    const gravado = it.tip_afe_igv === "10" && tasa > 0;
    const base = gravado ? importe / (1 + tasa / 100) : importe;
    return { bruto, descuento, importe, base, igv: gravado ? importe - base : 0 };
  }
  function calcularTotales(items, tasa) {
    const t = { gravado: 0, exonerado: 0, inafecto: 0, igv: 0, descuentos: 0, total: 0 };
    for (const it of items) {
      const l = calcularLinea(it, tasa);
      if (it.tip_afe_igv === "10" && tasa > 0) t.gravado += l.base;
      else if (it.tip_afe_igv === "30") t.inafecto += l.base;
      else t.exonerado += l.base;
      t.igv += l.igv;
      t.descuentos += l.descuento;
      t.total += l.importe;
    }
    for (const k of Object.keys(t)) t[k] = r2(t[k]);
    return t;
  }
  function validarVenta(v, { regimen: regimen2 } = {}) {
    if (!v.items.length) return "Agrega al menos un producto o servicio.";
    for (const it of v.items) {
      if (!(it.cantidad > 0)) return `Cantidad inválida en "${it.descripcion}".`;
      if (!(it.precio > 0)) return `Precio inválido en "${it.descripcion}".`;
      if (calcularLinea(it, 0).importe <= 0) return `El descuento deja en cero "${it.descripcion}".`;
    }
    const total = calcularTotales(v.items, 0).total;
    const cliente = v.cliente;
    if (v.tipo === "01") {
      if (regimen2 === "rus") return "En Nuevo RUS solo se emiten boletas.";
      if (!cliente || cliente.tipo_doc !== "6") return "La factura requiere un cliente con RUC.";
    }
    if (v.tipo === "03") {
      const anonimo = !cliente || cliente.tipo_doc === "0";
      if (anonimo && total >= LIMITE_BOLETA_SIN_DNI) {
        return `Boletas de S/ ${LIMITE_BOLETA_SIN_DNI} o más requieren identificar al cliente (DNI, CE o RUC).`;
      }
    }
    if (v.forma_pago === "Credito") {
      if (v.tipo !== "01") return "La venta al crédito solo se emite con factura.";
      if (!v.cuotas?.length) return "Agrega al menos una cuota.";
      const suma = r2(v.cuotas.reduce((s, c) => s + Number(c.monto || 0), 0));
      if (Math.abs(suma - total) > 9e-3) return `Las cuotas suman S/ ${suma.toFixed(2)} y el total es S/ ${total.toFixed(2)}.`;
      const hoy = hoyLima();
      let anterior = hoy;
      for (const c of v.cuotas) {
        if (!(Number(c.monto) > 0)) return "Cada cuota debe ser mayor a 0.";
        if (!c.fecha_pago || c.fecha_pago <= anterior) return "Las fechas de cuota deben ser posteriores a hoy y en orden.";
        anterior = c.fecha_pago;
      }
    }
    return null;
  }
  function generarCuotas(total, n, desde = hoyLima()) {
    const cuotas = [];
    const base = Math.floor(total / n * 100) / 100;
    const [y, m, d] = desde.split("-").map(Number);
    for (let i = 1; i <= n; i++) {
      const fecha2 = new Date(Date.UTC(y, m - 1 + i, Math.min(d, 28)));
      cuotas.push({ monto: i === n ? r2(total - base * (n - 1)) : base, fecha_pago: fecha2.toISOString().slice(0, 10) });
    }
    return cuotas;
  }
  function armarPayload(venta, { serie, soloRegistro = false } = {}) {
    const c = venta.cliente && venta.cliente.tipo_doc !== "0" ? venta.cliente : venta.cliente || CONSUMIDOR_FINAL;
    const cliente = { tipo_doc: c.tipo_doc, num_doc: c.num_doc, razon_social: c.razon_social };
    if (c.direccion) cliente.direccion = c.direccion;
    const items = venta.items.map((it) => {
      const l = calcularLinea(it, 0);
      const unit = Math.round(l.importe / it.cantidad * 1e4) / 1e4;
      const item = {
        codigo: it.codigo,
        descripcion: it.descripcion,
        unidad: it.unidad,
        cantidad: it.cantidad,
        precio_unitario: unit,
        tip_afe_igv: it.tip_afe_igv
      };
      if (it.cod_producto_sunat) item.cod_producto_sunat = it.cod_producto_sunat;
      return item;
    });
    const body = {
      serie,
      fecha_emision: venta.fecha_emision || hoyLima(),
      tipo_operacion: "0101",
      tipo_moneda: "PEN",
      forma_pago: venta.forma_pago === "Credito" ? "Credito" : "Contado",
      cliente,
      items
    };
    if (body.forma_pago === "Credito") {
      body.cuotas = venta.cuotas.map((q) => ({ monto: r2(q.monto), fecha_pago: q.fecha_pago }));
      body.fecha_vencimiento = body.cuotas.at(-1).fecha_pago;
    }
    if (venta.tipo === "03" && soloRegistro) body.solo_registro = true;
    return body;
  }
  function registrarVenta(datos, usuario) {
    const t = calcularTotales(datos.items, datos.tasa);
    const venta = store.insertar("ventas", {
      fecha: (/* @__PURE__ */ new Date()).toISOString(),
      fecha_emision: hoyLima(),
      usuario_id: usuario.id,
      cliente_id: datos.cliente?.id ?? null,
      cliente: datos.cliente ? { ...datos.cliente } : null,
      tipo_comprobante: datos.tipo,
      // '01' | '03' | 'ninguno'
      forma_pago: datos.forma_pago,
      metodo_pago: datos.metodo_pago,
      recibido: datos.recibido ?? null,
      cuotas: datos.forma_pago === "Credito" ? datos.cuotas : [],
      subtotal: r2(t.gravado + t.exonerado + t.inafecto),
      igv: t.igv,
      total: t.total,
      estado: "registrada",
      comprobante_id: null,
      emision: null
      // { estado: 'en_curso'|'error'|'incierta', mensaje, intento_en }
    });
    for (const it of datos.items) {
      store.insertar("venta_items", {
        venta_id: venta.id,
        producto_id: it.producto_id ?? null,
        codigo: it.codigo,
        descripcion: it.descripcion,
        unidad: it.unidad,
        cantidad: it.cantidad,
        precio: it.precio,
        descuento: Number(it.descuento) || 0,
        tip_afe_igv: it.tip_afe_igv,
        cod_producto_sunat: it.cod_producto_sunat || ""
      });
      moverStock(it.producto_id, -it.cantidad);
    }
    return venta;
  }
  function moverStock(productoId, delta) {
    const p = productoId ? store.buscar("productos", productoId) : null;
    if (p?.controla_stock) store.actualizar("productos", p.id, { stock: r2(Number(p.stock || 0) + delta) });
  }
  function itemsDeVenta(ventaId) {
    return store.donde("venta_items", (i) => i.venta_id === ventaId);
  }
  function anularVenta(venta) {
    if (venta.comprobante_id) throw new Error("La venta ya tiene comprobante: se anula con nota de crédito o baja.");
    if (venta.emision?.estado === "incierta") throw new Error("Primero confirma si el comprobante llegó a emitirse.");
    for (const it of itemsDeVenta(venta.id)) moverStock(it.producto_id, it.cantidad);
    return store.actualizar("ventas", venta.id, { estado: "anulada" });
  }
  var enCurso = /* @__PURE__ */ new Set();
  async function emitirVenta(ventaId) {
    if (enCurso.has(ventaId)) throw new Error("Esta venta ya se está emitiendo.");
    const venta = store.buscar("ventas", ventaId);
    if (!venta) throw new Error("Venta no encontrada.");
    if (venta.estado === "anulada") throw new Error("La venta está anulada.");
    if (venta.comprobante_id) throw new Error("La venta ya tiene comprobante.");
    if (!TIPOS_CPE[venta.tipo_comprobante]) throw new Error("Elige boleta o factura para emitir.");
    const cfg2 = store.config();
    const tipo = venta.tipo_comprobante;
    const serie = tipo === "01" ? cfg2.serie_factura : cfg2.serie_boleta;
    if (!serie) throw new Error("Falta la serie por defecto en Configuración → Series.");
    const items = itemsDeVenta(venta.id);
    const error = validarVenta({ ...venta, tipo, items, cliente: venta.cliente }, { regimen: cfg2.tax_regime });
    if (error) throw new Error(error);
    const body = armarPayload({ ...venta, tipo, items }, { serie, soloRegistro: Boolean(cfg2.boletas_por_resumen) });
    enCurso.add(ventaId);
    store.actualizar("ventas", venta.id, { emision: { estado: "en_curso", intento_en: (/* @__PURE__ */ new Date()).toISOString() } });
    try {
      const r = await api.emitir(TIPOS_CPE[tipo].ruta, body);
      return guardarComprobante(venta, tipo, serie, r.datos, r.mensaje);
    } catch (e) {
      const estado2 = e.red ? "incierta" : "error";
      store.actualizar("ventas", venta.id, {
        emision: { estado: estado2, mensaje: e.message, detalle: e.detalle?.() || [], intento_en: (/* @__PURE__ */ new Date()).toISOString() }
      });
      throw e;
    } finally {
      enCurso.delete(ventaId);
    }
  }
  function guardarComprobante(venta, tipo, serie, datos, mensajeApi) {
    const cpe = leerCpe(datos);
    const comp = store.insertar("comprobantes", {
      venta_id: venta.id,
      tipo,
      serie: cpe.serie || serie,
      correlativo: cpe.correlativo,
      api_id: cpe.api_id,
      sunat_status: cpe.sunat_status === "desconocido" ? "enviado" : cpe.sunat_status,
      estado_api: cpe.estado_api,
      mensaje_sunat: cpe.mensaje_sunat || null,
      codigo_sunat: cpe.codigo_sunat,
      mensaje_api: mensajeApi || null,
      total_oficial: cpe.total_oficial,
      cliente_num_doc: venta.cliente?.num_doc || CONSUMIDOR_FINAL.num_doc,
      comprobante_origen_id: null,
      fecha_emision: venta.fecha_emision
    });
    store.actualizar("ventas", venta.id, { comprobante_id: comp.id, emision: null });
    return comp;
  }
  async function actualizarEstado(compId) {
    const c = store.buscar("comprobantes", compId);
    if (!c?.api_id) throw new Error("Este comprobante no tiene id de la API.");
    const r = await api.comprobante(TIPOS_CPE[c.tipo].ruta, c.api_id);
    const cpe = leerCpe(r.datos);
    const cambios = {
      sunat_status: cpe.sunat_status === "desconocido" ? c.sunat_status : cpe.sunat_status,
      estado_api: cpe.estado_api ?? c.estado_api,
      mensaje_sunat: cpe.mensaje_sunat ?? c.mensaje_sunat,
      codigo_sunat: cpe.codigo_sunat ?? c.codigo_sunat,
      consultado_en: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (cpe.correlativo != null) cambios.correlativo = cpe.correlativo;
    if (cpe.total_oficial != null) cambios.total_oficial = cpe.total_oficial;
    return { comprobante: store.actualizar("comprobantes", c.id, cambios), crudo: r.crudo };
  }
  async function esperarEstado(compId, { intentos = 8, cadaMs = 2500, alCambiar = () => {
  }, cancelado = () => false } = {}) {
    let c = store.buscar("comprobantes", compId);
    for (let i = 0; i < intentos && !esFinal(c.sunat_status) && c.sunat_status !== "pendiente"; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? 1200 : cadaMs));
      if (cancelado()) return c;
      try {
        c = (await actualizarEstado(compId)).comprobante;
        alCambiar(c);
      } catch {
      }
    }
    return c;
  }
  async function buscarEmitido(ventaId) {
    const venta = store.buscar("ventas", ventaId);
    const tipo = venta.tipo_comprobante;
    const cfg2 = store.config();
    const serie = tipo === "01" ? cfg2.serie_factura : cfg2.serie_boleta;
    const r = await api.listarComprobantes(TIPOS_CPE[tipo].ruta, {
      fecha_desde: venta.fecha_emision,
      fecha_hasta: venta.fecha_emision,
      client_num_doc: venta.cliente?.num_doc || CONSUMIDOR_FINAL.num_doc,
      serie,
      por_pagina: 50
    });
    const usados = new Set(store.todos("comprobantes").map((c) => String(c.api_id)));
    const candidatos = comoLista(r.datos).filter((x) => !usados.has(String(x.id))).filter((x) => {
      const t = leerCpe(x).total_oficial;
      return t == null || Math.abs(t - venta.total) < 0.011;
    });
    if (candidatos.length === 1) {
      return guardarComprobante(venta, tipo, serie, candidatos[0], "Recuperado tras corte de conexión");
    }
    return { encontrados: candidatos.length };
  }
  function descartarIncierta(ventaId) {
    store.actualizar("ventas", ventaId, { emision: { estado: "error", mensaje: "Revisado: no se encontró el comprobante en la API." } });
  }
  var numeroCpe = (c) => c?.correlativo != null ? `${c.serie}-${c.correlativo}` : c?.serie ? `${c.serie}-…` : "—";
  async function abrirArchivo(comp, tipo, formato = "ticket-80") {
    const ruta = TIPOS_CPE[comp.tipo].ruta;
    const extension = tipo === "pdf" ? "pdf" : tipo === "xml" ? "xml" : "zip";
    const nombre = `${comp.serie}-${comp.correlativo ?? comp.api_id}${tipo === "cdr" ? "-CDR" : ""}.${extension}`;
    const ventana = tipo === "pdf" ? window.open("", "_blank") : null;
    try {
      const blob = await api.archivo(ruta, comp.api_id, tipo, tipo === "pdf" ? queryPdf(formato) : void 0);
      const url2 = URL.createObjectURL(blob);
      if (ventana && !ventana.closed) {
        ventana.location.href = url2;
      } else {
        const a = document.createElement("a");
        a.href = url2;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url2), 6e4);
    } catch (e) {
      if (ventana && !ventana.closed) ventana.close();
      throw e;
    }
  }
  var FORMATOS_PDF = [["ticket-80", "Ticket 80 mm"], ["ticket-58", "58 mm"], ["a4", "A4"], ["a5", "A5"]];
  function verComprobante(comp) {
    if (!comp?.api_id) return null;
    const ruta = TIPOS_CPE[comp.tipo]?.ruta;
    if (!ruta) return null;
    return visorPdf({
      titulo: `${TIPOS_CPE[comp.tipo].nombre} ${numeroCpe(comp)}`,
      subtitulo: ESTADOS[comp.sunat_status]?.texto || "",
      formatos: FORMATOS_PDF,
      cargar: (formato) => api.archivo(ruta, comp.api_id, "pdf", queryPdf(formato)),
      nombre: (formato) => `${comp.serie}-${comp.correlativo ?? comp.api_id}-${formato}.pdf`
    });
  }
  var TIPO_POR_RUTA = Object.fromEntries(Object.entries(TIPOS_CPE).map(([t, v]) => [v.ruta, t]));
  function leerClienteCpe(d) {
    const c = d?.cliente || d?.client || {};
    return {
      tipo_doc: String(c.tipo_doc ?? c.tipo_documento ?? d?.client_tipo_doc ?? d?.cliente_tipo_doc ?? ""),
      num_doc: String(c.num_doc ?? c.numero_documento ?? d?.client_num_doc ?? d?.cliente_num_doc ?? ""),
      razon_social: c.razon_social ?? c.rzn_social ?? d?.client_razon_social ?? d?.client_rzn_social ?? d?.cliente_razon_social ?? "",
      direccion: c.direccion ?? d?.client_direccion ?? ""
    };
  }
  function leerItemsCpe(d) {
    const lista2 = d?.items ?? d?.detalles ?? d?.details ?? [];
    if (!Array.isArray(lista2)) return [];
    return lista2.map((x) => ({
      codigo: x.codigo ?? x.cod_producto ?? "",
      descripcion: x.descripcion ?? x.des_item ?? x.description ?? "",
      unidad: x.unidad ?? x.unidad_medida ?? "NIU",
      cantidad: Number(x.cantidad ?? 0),
      precio_unitario: Number(x.precio_unitario ?? x.mto_precio_unitario ?? x.precio ?? 0),
      tip_afe_igv: String(x.tip_afe_igv ?? x.tipo_afectacion ?? "10"),
      cod_producto_sunat: x.cod_producto_sunat ?? ""
    }));
  }
  function leerFila(x, ruta) {
    const cpe = leerCpe(x);
    return {
      ...cpe,
      ruta,
      tipo: TIPO_POR_RUTA[ruta],
      fecha_emision: x.fecha_emision ?? x.fecha ?? x.created_at?.slice(0, 10) ?? "",
      cliente: leerClienteCpe(x),
      afectado: x.doc_afectado_serie ? `${x.doc_afectado_serie}-${x.doc_afectado_correlativo}` : null
    };
  }
  function sincronizarDesdeApi(fila) {
    const local = store.todos("comprobantes").find((c) => String(c.api_id) === String(fila.api_id) && c.tipo === fila.tipo);
    if (!local || fila.sunat_status === "desconocido") return local || null;
    const cambios = {};
    if (local.sunat_status !== fila.sunat_status) cambios.sunat_status = fila.sunat_status;
    if (fila.correlativo != null && local.correlativo == null) cambios.correlativo = fila.correlativo;
    if (fila.mensaje_sunat && fila.mensaje_sunat !== local.mensaje_sunat) cambios.mensaje_sunat = fila.mensaje_sunat;
    if (fila.total_oficial != null && fila.total_oficial !== local.total_oficial) cambios.total_oficial = fila.total_oficial;
    return Object.keys(cambios).length ? store.actualizar("comprobantes", local.id, cambios) : local;
  }
  var comprobanteLocal = (tipo, apiId) => store.todos("comprobantes").find((c) => c.tipo === tipo && String(c.api_id) === String(apiId)) || null;
  async function enviarASunat(ruta, apiId) {
    const r = await api.enviarComprobante(ruta, apiId);
    const local = comprobanteLocal(TIPO_POR_RUTA[ruta], apiId);
    if (local) store.actualizar("comprobantes", local.id, { sunat_status: "enviado", mensaje_sunat: null });
    return r;
  }
  function validarCorreccion(tipo, cliente, items) {
    if (tipo === "01" && cliente.tipo_doc !== "6") return "La factura requiere un cliente con RUC.";
    if (!cliente.num_doc || !cliente.razon_social) return "Completa el documento y el nombre del cliente.";
    if (!items.length) return "El comprobante debe tener al menos un ítem.";
    for (const it of items) {
      if (!it.descripcion?.trim()) return "Cada ítem necesita descripción.";
      if (!(it.cantidad > 0)) return `Cantidad inválida en "${it.descripcion}".`;
      if (!(it.precio_unitario > 0)) return `Precio inválido en "${it.descripcion}".`;
    }
    return null;
  }
  async function corregirComprobante(ruta, apiId, { cliente, items }) {
    const tipo = TIPO_POR_RUTA[ruta];
    const error = validarCorreccion(tipo, cliente, items);
    if (error) throw new Error(error);
    const body = {
      cliente: Object.fromEntries(Object.entries(cliente).filter(([, v]) => v !== "" && v != null)),
      items: items.map((it) => {
        const i = {
          codigo: it.codigo || "ITEM",
          descripcion: it.descripcion.trim(),
          unidad: it.unidad || "NIU",
          cantidad: Number(it.cantidad),
          precio_unitario: Number(it.precio_unitario),
          tip_afe_igv: it.tip_afe_igv
        };
        if (it.cod_producto_sunat) i.cod_producto_sunat = it.cod_producto_sunat;
        return i;
      })
    };
    const r = await api.actualizarComprobante(ruta, apiId, body);
    const local = comprobanteLocal(tipo, apiId);
    if (local) {
      const cpe = leerCpe(r.datos);
      store.actualizar("comprobantes", local.id, {
        sunat_status: cpe.sunat_status === "desconocido" ? "enviado" : cpe.sunat_status,
        mensaje_sunat: cpe.mensaje_sunat ?? null,
        total_oficial: cpe.total_oficial ?? local.total_oficial,
        corregido_en: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    return r;
  }
  async function eliminarBoleta(apiId) {
    await api.eliminarBoleta(apiId);
    const local = comprobanteLocal("03", apiId);
    if (local) liberarVenta(local, "eliminado");
  }
  function liberarVenta(comp, motivo = "reemplazado") {
    store.actualizar("comprobantes", comp.id, { reemplazado: motivo, liberado_en: (/* @__PURE__ */ new Date()).toISOString() });
    const venta = comp.venta_id ? store.buscar("ventas", comp.venta_id) : null;
    if (venta && venta.comprobante_id === comp.id) {
      store.actualizar("ventas", venta.id, { comprobante_id: null, emision: null });
    }
    return venta;
  }
  async function detalleDesdeApi(ruta, apiId) {
    const r = await api.comprobante(ruta, apiId);
    const d = r.datos?.comprobante || r.datos?.factura || r.datos?.boleta || r.datos || {};
    const fila = leerFila(d, ruta);
    if (fila.api_id == null) fila.api_id = apiId;
    const local = sincronizarDesdeApi(fila);
    if (local) store.actualizar("comprobantes", local.id, { consultado_en: (/* @__PURE__ */ new Date()).toISOString() });
    return { fila, items: leerItemsCpe(d), crudo: r.crudo, local: local ? store.buscar("comprobantes", local.id) : null };
  }

  // src/views/productos.js
  var filtros = { q: "", categoria: "todas", estado: "activos" };
  var nombreAfect = (c) => (AFECTACIONES.find((a) => a[0] === c) || [c, c])[1];
  var nombreUnidad = (c) => (UNIDADES.find((u) => u[0] === c) || [c, c])[1];
  function tasaIgvLocal() {
    const c = store.config();
    if (c.tax_regime === "rus") return 0;
    if (c.igv_rate_override != null && c.igv_rate_override !== "") return Number(c.igv_rate_override);
    if (c.tasa_igv_vigente != null && !isNaN(Number(c.tasa_igv_vigente))) return Number(c.tasa_igv_vigente);
    return 18;
  }
  function productosActivos() {
    return store.todos("productos").filter((p) => p.activo !== false);
  }
  function buscarProductos(q, lista2 = productosActivos()) {
    const t = norm(q).trim();
    if (!t) return lista2;
    const partes = t.split(/\s+/);
    return lista2.filter((p) => {
      const texto = norm(`${p.codigo} ${p.descripcion}`);
      return partes.every((x) => texto.includes(x));
    });
  }
  async function vistaProductos(cont) {
    const admin = auth.esAdmin();
    cont.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Productos y servicios</h1>
      ${admin ? `
        <div class="row-actions">
          <button class="btn" id="btn-cat" type="button">Categorías</button>
          <button class="btn btn-primary" id="btn-prod-nuevo" type="button">Nuevo</button>
        </div>` : ""}
    </div>
    <div class="toolbar">
      <input type="search" id="prod-q" placeholder="Buscar por nombre o código" value="${esc(filtros.q)}" aria-label="Buscar productos">
      <select id="prod-estado" aria-label="Estado">
        ${[["activos", "Activos"], ["inactivos", "Inactivos"], ["todos", "Todos"]].map(([v, t]) => `<option value="${v}" ${filtros.estado === v ? "selected" : ""}>${t}</option>`).join("")}
      </select>
    </div>
    <div class="chips" id="prod-cats" role="tablist" aria-label="Categorías"></div>
    <div id="prod-lista"></div>`;
    const pintar = () => pintarLista(cont, admin);
    $("#prod-q", cont).addEventListener("input", (ev) => {
      filtros.q = ev.target.value;
      pintar();
    });
    $("#prod-estado", cont).addEventListener("change", (ev) => {
      filtros.estado = ev.target.value;
      pintar();
    });
    $("#prod-cats", cont).addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-cat]");
      if (!b) return;
      filtros.categoria = b.dataset.cat;
      pintar();
    });
    if (admin) {
      $("#btn-prod-nuevo", cont).addEventListener("click", () => formProducto(null, pintar));
      $("#btn-cat", cont).addEventListener("click", () => gestionarCategorias(pintar));
    }
    pintar();
  }
  function pintarLista(cont, admin) {
    const cats = store.todos("categorias");
    const todos = store.todos("productos");
    if (filtros.categoria !== "todas" && !cats.some((c) => String(c.id) === filtros.categoria)) filtros.categoria = "todas";
    $("#prod-cats", cont).innerHTML = [["todas", "Todas"], ...cats.map((c) => [String(c.id), c.nombre])].map(([id, n]) => {
      const cuantos = id === "todas" ? todos.length : todos.filter((p) => String(p.categoria_id) === id).length;
      return `<button type="button" role="tab" class="chip ${filtros.categoria === id ? "is-active" : ""}" data-cat="${esc(id)}" aria-selected="${filtros.categoria === id}">${esc(n)} <span>${cuantos}</span></button>`;
    }).join("");
    let lista2 = todos;
    if (filtros.estado === "activos") lista2 = lista2.filter((p) => p.activo !== false);
    if (filtros.estado === "inactivos") lista2 = lista2.filter((p) => p.activo === false);
    if (filtros.categoria !== "todas") lista2 = lista2.filter((p) => String(p.categoria_id) === filtros.categoria);
    lista2 = buscarProductos(filtros.q, lista2).sort((a, b) => a.descripcion.localeCompare(b.descripcion, "es"));
    const caja = $("#prod-lista", cont);
    if (!todos.length) {
      caja.innerHTML = `<div class="vacio">
      <p><strong>Aún no hay productos ni servicios.</strong></p>
      <p class="muted">Registra consultas, vacunas, medicamentos, alimentos y accesorios con su precio final (con IGV).</p>
      ${admin ? '<button class="btn btn-primary" type="button" id="btn-prod-primero">Crear el primero</button>' : ""}
    </div>`;
      $("#btn-prod-primero", caja)?.addEventListener("click", () => formProducto(null, () => pintarLista(cont, admin)));
      return;
    }
    const catNombre = (id) => cats.find((c) => c.id === id)?.nombre || "Sin categoría";
    const editar = (p) => formProducto(store.buscar("productos", p.id), () => pintarLista(cont, admin));
    tablaLocal(caja, {
      filas: lista2,
      clave: `${filtros.estado}|${filtros.categoria}|${filtros.q}`,
      vacio: "Ningún producto coincide con la búsqueda.",
      alElegir: admin ? editar : null,
      claseFila: (p) => p.activo === false ? "fila-anulada" : "",
      columnas: [
        { titulo: "Producto o servicio", celda: (p) => `<strong>${esc(p.descripcion)}</strong><span class="sub font-id">${esc(p.codigo)}</span>` },
        { titulo: "Categoría", sec: true, celda: (p) => esc(catNombre(p.categoria_id)) },
        { titulo: "Tipo", sec: true, celda: (p) => `${p.tipo === "servicio" ? "Servicio" : "Producto"}<span class="sub">${esc(nombreUnidad(p.unidad))}</span>` },
        { titulo: "IGV", sec: true, celda: (p) => `<span class="pill ${p.tip_afe_igv === "10" ? "" : "pill-info"}">${esc(nombreAfect(p.tip_afe_igv))}</span>` },
        { titulo: "Stock", clase: "num", celda: (p) => p.controla_stock ? `<span class="pill ${Number(p.stock) <= 0 ? "pill-danger" : Number(p.stock) <= 3 ? "pill-warn" : "pill-ok"}">${esc(p.stock)}</span>` : '<span class="muted">—</span>' },
        { titulo: "Precio", clase: "num", celda: (p) => `${esc(soles(p.precio))}${p.activo === false ? '<span class="sub">Inactivo</span>' : ""}` },
        ...admin ? [{ titulo: "", clase: "col-acciones", celda: (p) => `<button class="btn btn-sm" type="button" data-prod="${p.id}">Editar</button>` }] : []
      ],
      alPintar: (caja2) => $$("[data-prod]", caja2).forEach((b) => b.addEventListener("click", () => editar({ id: Number(b.dataset.prod) })))
    });
  }
  function sugerirCodigo(tipo) {
    const pref = tipo === "servicio" ? "S" : "P";
    const usados = store.todos("productos").map((p) => p.codigo).filter((c) => new RegExp(`^${pref}\\d+$`).test(c)).map((c) => Number(c.slice(1)));
    const sig = (usados.length ? Math.max(...usados) : 0) + 1;
    return `${pref}${String(sig).padStart(4, "0")}`;
  }
  function formProducto(p, alGuardar) {
    const cats = store.todos("categorias");
    const tipo = p?.tipo || "bien";
    const nuevo = !p;
    const usado = p && store.donde("venta_items", (i) => i.producto_id === p.id).length > 0;
    const d = modal({
      titulo: nuevo ? "Nuevo producto o servicio" : "Editar producto",
      contenido: `
      <div class="form-grid" id="f-prod">
        <div class="segmented span-all" role="radiogroup" aria-label="Tipo">
          <label><input type="radio" name="tipo" value="bien" ${tipo === "bien" ? "checked" : ""}><span>Producto</span></label>
          <label><input type="radio" name="tipo" value="servicio" ${tipo === "servicio" ? "checked" : ""}><span>Servicio</span></label>
        </div>
        ${campo({ nombre: "descripcion", etiqueta: "Descripción", valor: p?.descripcion, req: true, attrs: 'maxlength="250"', ayuda: "Tal como saldrá en el comprobante. Ej.: Vacuna antirrábica, Consulta general." })}
        ${campo({ nombre: "codigo", etiqueta: "Código interno", valor: p?.codigo || sugerirCodigo(tipo), req: true, attrs: 'maxlength="30" autocapitalize="characters"' })}
        <label class="field">
          <span class="field-label">Categoría <b aria-hidden="true">*</b></span>
          <select name="categoria_id">
            ${cats.map((c) => `<option value="${c.id}" ${c.id === p?.categoria_id ? "selected" : ""}>${esc(c.nombre)}</option>`).join("")}
            <option value="nueva">+ Nueva categoría…</option>
          </select>
          <input name="categoria_nueva" placeholder="Nombre de la nueva categoría" hidden>
        </label>
        ${selector({ nombre: "unidad", etiqueta: "Unidad", opciones: UNIDADES, valor: p?.unidad || (tipo === "servicio" ? "ZZ" : "NIU"), req: true })}
        ${campo({ nombre: "precio", etiqueta: "Precio de venta (S/)", valor: p?.precio ?? "", tipo: "number", req: true, attrs: 'min="0" step="0.01" inputmode="decimal"', ayuda: "Precio final que paga el cliente, con IGV incluido." })}
        ${selector({ nombre: "tip_afe_igv", etiqueta: "Afectación IGV", opciones: AFECTACIONES, valor: p?.tip_afe_igv || "10", req: true, ayuda: "Confírmala con el contador del negocio." })}
        <p class="calc span-all" id="prod-calc" aria-live="polite"></p>
        <div class="field span-all">
          <span class="field-label">Código de producto SUNAT (opcional)</span>
          <div class="input-group">
            <input name="cod_producto_sunat" value="${esc(p?.cod_producto_sunat || "")}" inputmode="numeric" maxlength="8" placeholder="8 dígitos">
            <button class="btn" type="button" id="btn-sunat-buscar">Buscar</button>
          </div>
          <div class="inline-search" id="sunat-box" hidden>
            <input type="search" id="sunat-q" placeholder="Ej.: veterinario, vacuna, alimento para perros">
            <div id="sunat-res" class="search-results"></div>
          </div>
        </div>
        <div class="span-all stock-box" id="stock-box">
          <label class="check"><input type="checkbox" name="controla_stock" ${p?.controla_stock ? "checked" : ""}> Controlar stock</label>
          ${campo({ nombre: "stock", etiqueta: "Stock actual", valor: p?.stock ?? 0, tipo: "number", attrs: 'min="0" step="any" inputmode="decimal"' })}
        </div>
        ${nuevo ? "" : `<label class="check span-all"><input type="checkbox" name="activo" ${p.activo !== false ? "checked" : ""}> Activo (aparece en el punto de venta)</label>`}
      </div>`,
      acciones: `
      ${!nuevo ? `<button class="btn btn-ghost-danger" type="button" id="btn-prod-borrar">${usado ? "Desactivar" : "Eliminar"}</button>` : ""}
      <span class="spacer"></span>
      <button class="btn" value="cancelar">Cancelar</button>
      <button class="btn btn-primary" value="ok" id="btn-prod-ok">Guardar</button>`
    });
    const f = $("#f-prod", d);
    const v = (n) => $(`[name=${n}]`, f);
    const tipoActual = () => $("[name=tipo]:checked", f).value;
    const actualizarTipo = () => {
      const servicio = tipoActual() === "servicio";
      $("#stock-box", f).hidden = servicio;
      if (nuevo) {
        v("codigo").value = sugerirCodigo(tipoActual());
        v("unidad").value = servicio ? "ZZ" : "NIU";
      }
    };
    const actualizarStock = () => {
      v("stock").closest(".field").hidden = !v("controla_stock").checked;
    };
    const actualizarCalc = () => {
      const precio = Number(v("precio").value);
      const out = $("#prod-calc", f);
      if (!(precio > 0)) {
        out.textContent = "";
        return;
      }
      const tasa = tasaIgvLocal();
      if (v("tip_afe_igv").value === "10" && tasa > 0) {
        const base = r2(precio / (1 + tasa / 100));
        out.textContent = `Valor sin IGV ${soles(base)} + IGV ${tasa}% ${soles(precio - base)} = ${soles(precio)} (referencial; la API calcula el oficial)`;
      } else {
        out.textContent = `Sin IGV: el cliente paga ${soles(precio)}.`;
      }
    };
    $$("[name=tipo]", f).forEach((r) => r.addEventListener("change", actualizarTipo));
    v("controla_stock").addEventListener("change", actualizarStock);
    v("precio").addEventListener("input", actualizarCalc);
    v("tip_afe_igv").addEventListener("change", actualizarCalc);
    v("categoria_id").addEventListener("change", () => {
      const nueva = v("categoria_id").value === "nueva";
      v("categoria_nueva").hidden = !nueva;
      if (nueva) v("categoria_nueva").focus();
    });
    $("#stock-box", f).hidden = tipo === "servicio";
    actualizarStock();
    actualizarCalc();
    conectarBuscadorSunat(f);
    $("#btn-prod-ok", d).addEventListener("click", (ev) => {
      ev.preventDefault();
      const datos = {
        tipo: tipoActual(),
        descripcion: v("descripcion").value.trim().replace(/\s+/g, " "),
        codigo: v("codigo").value.trim().toUpperCase(),
        unidad: v("unidad").value,
        precio: Number(v("precio").value),
        tip_afe_igv: v("tip_afe_igv").value,
        cod_producto_sunat: v("cod_producto_sunat").value.trim(),
        controla_stock: tipoActual() === "bien" && v("controla_stock").checked,
        stock: Number(v("stock").value || 0)
      };
      if (!nuevo) datos.activo = v("activo").checked;
      const error = validarProducto(datos, p);
      if (error) return toast(error, "warn");
      let categoria_id = v("categoria_id").value;
      if (categoria_id === "nueva") {
        const nombre = v("categoria_nueva").value.trim();
        if (!nombre) return toast("Escribe el nombre de la nueva categoría.", "warn");
        const existe = cats.find((c) => norm(c.nombre) === norm(nombre));
        categoria_id = existe ? existe.id : store.insertar("categorias", { nombre }).id;
      }
      datos.categoria_id = Number(categoria_id);
      if (!datos.controla_stock) datos.stock = p?.stock ?? 0;
      try {
        if (nuevo) store.insertar("productos", { ...datos, activo: true });
        else store.actualizar("productos", p.id, datos);
        cerrarModal();
        toast(nuevo ? "Producto creado." : "Producto actualizado.", "ok");
        alGuardar();
      } catch (e) {
        toast(e.message, "error");
      }
    });
    $("#btn-prod-borrar", d)?.addEventListener("click", async () => {
      if (usado) {
        store.actualizar("productos", p.id, { activo: false });
        cerrarModal();
        toast("Producto desactivado: tiene ventas, por eso no se elimina.", "ok");
        return alGuardar();
      }
      cerrarModal();
      if (!await confirmar("Eliminar producto", `¿Eliminar "${p.descripcion}"? Esta acción no se puede deshacer.`, "Eliminar", true)) return;
      store.eliminar("productos", p.id);
      toast("Producto eliminado.", "ok");
      alGuardar();
    });
    v("descripcion").focus();
  }
  function validarProducto(d, actual = null) {
    if (d.descripcion.length < 3) return "La descripción debe tener al menos 3 caracteres.";
    if (d.descripcion.length > 250) return "La descripción no puede pasar de 250 caracteres.";
    if (!/^[A-Z0-9._-]{1,30}$/.test(d.codigo)) return "El código solo admite letras, números, punto y guion (máx. 30).";
    const repetido = store.todos("productos").some((x) => x.codigo === d.codigo && x.id !== actual?.id);
    if (repetido) return `El código ${d.codigo} ya está en uso.`;
    if (!UNIDADES.some((u) => u[0] === d.unidad)) return "Unidad inválida.";
    if (!(d.precio > 0)) return "El precio debe ser mayor a 0.";
    if (d.precio > 999999) return "El precio es demasiado alto.";
    if (!/^\d+(\.\d{1,4})?$/.test(String(d.precio))) return "El precio admite hasta 4 decimales.";
    if (!AFECTACIONES.some((a) => a[0] === d.tip_afe_igv)) return "Afectación IGV inválida.";
    if (d.cod_producto_sunat && !/^\d{8}$/.test(d.cod_producto_sunat)) return "El código SUNAT debe tener 8 dígitos.";
    if (d.controla_stock && (!(d.stock >= 0) || isNaN(d.stock))) return "El stock no puede ser negativo.";
    return null;
  }
  function conectarBuscadorSunat(f) {
    const caja = $("#sunat-box", f);
    const q = $("#sunat-q", f);
    const res = $("#sunat-res", f);
    const destino = $("[name=cod_producto_sunat]", f);
    let temporizador2 = null;
    let turno = 0;
    $("#btn-sunat-buscar", f).addEventListener("click", () => {
      caja.hidden = !caja.hidden;
      if (!caja.hidden) {
        q.value = q.value || $("[name=descripcion]", f).value.split(" ")[0] || "";
        q.focus();
        if (q.value.length >= 3) buscar();
      }
    });
    const buscar = async () => {
      const texto = q.value.trim();
      if (texto.length < 3) {
        res.innerHTML = '<p class="muted small">Escribe al menos 3 letras o números.</p>';
        return;
      }
      const mio = ++turno;
      res.innerHTML = '<p class="muted small">Buscando…</p>';
      try {
        const r = await api.productoSunat(texto);
        if (mio !== turno) return;
        const items = comoLista(r.datos).slice(0, 30);
        if (!items.length) {
          res.innerHTML = '<p class="muted small">Sin resultados.</p>';
          return;
        }
        res.innerHTML = items.map((it) => {
          const codigo = it.codigo ?? it.code ?? it.id ?? "";
          const desc = it.descripcion ?? it.description ?? it.nombre ?? "";
          return `<button type="button" class="result" data-codigo="${esc(codigo)}"><code>${esc(codigo)}</code><span>${esc(desc)}</span></button>`;
        }).join("");
      } catch (e) {
        if (mio !== turno) return;
        res.innerHTML = `<p class="text-danger small">${esc(e.message)}</p>`;
      }
    };
    q.addEventListener("input", () => {
      clearTimeout(temporizador2);
      temporizador2 = setTimeout(buscar, 350);
    });
    q.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        clearTimeout(temporizador2);
        buscar();
      }
    });
    res.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-codigo]");
      if (!b) return;
      destino.value = b.dataset.codigo;
      caja.hidden = true;
      toast(`Código SUNAT ${b.dataset.codigo} asignado.`, "ok", 2500);
    });
  }
  function gestionarCategorias(alCambiar) {
    const pintar = () => {
      const cats = store.todos("categorias");
      const uso = (id) => store.donde("productos", (p) => p.categoria_id === id).length;
      $("#cat-lista", d).innerHTML = cats.map((c) => `
      <li class="cat-row">
        <input value="${esc(c.nombre)}" data-cat-nombre="${c.id}" aria-label="Nombre de categoría" maxlength="40">
        <span class="muted small">${uso(c.id)}</span>
        <button class="icon-btn" type="button" data-cat-borrar="${c.id}" aria-label="Eliminar ${esc(c.nombre)}" ${uso(c.id) ? 'disabled title="Tiene productos"' : ""}>×</button>
      </li>`).join("");
    };
    const d = modal({
      titulo: "Categorías",
      contenido: `
      <p class="muted small">El número es la cantidad de productos. Solo se eliminan categorías vacías.</p>
      <ul class="cat-list" id="cat-lista"></ul>
      <div class="input-group">
        <input id="cat-nueva" placeholder="Nueva categoría" maxlength="40">
        <button class="btn" type="button" id="btn-cat-add">Agregar</button>
      </div>`,
      acciones: '<button class="btn btn-primary" value="ok">Listo</button>'
    });
    pintar();
    const agregar2 = () => {
      const nombre = $("#cat-nueva", d).value.trim();
      if (!nombre) return;
      if (store.todos("categorias").some((c) => norm(c.nombre) === norm(nombre))) return toast("Esa categoría ya existe.", "warn");
      store.insertar("categorias", { nombre });
      $("#cat-nueva", d).value = "";
      pintar();
    };
    $("#btn-cat-add", d).addEventListener("click", agregar2);
    $("#cat-nueva", d).addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        agregar2();
      }
    });
    $("#cat-lista", d).addEventListener("change", (ev) => {
      const i = ev.target.closest("[data-cat-nombre]");
      if (!i) return;
      const nombre = i.value.trim();
      const id = Number(i.dataset.catNombre);
      if (!nombre || store.todos("categorias").some((c) => c.id !== id && norm(c.nombre) === norm(nombre))) {
        toast("Nombre vacío o repetido.", "warn");
        return pintar();
      }
      store.actualizar("categorias", id, { nombre });
    });
    $("#cat-lista", d).addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-cat-borrar]");
      if (!b || b.disabled) return;
      store.eliminar("categorias", Number(b.dataset.catBorrar));
      pintar();
    });
    d.addEventListener("close", alCambiar, { once: true });
  }

  // src/views/ventas.js
  var filtros2 = { periodo: "hoy", estado: "todos" };
  var nombreMetodo = (m) => (METODOS_PAGO.find((x) => x[0] === m) || [m, m || "—"])[1];
  function vistaVentas(cont, partes) {
    if (partes[0]) return detalleVenta(cont, Number(partes[0]));
    return listaVentas(cont);
  }
  function estadoVenta(v) {
    if (v.estado === "anulada") return { clave: "anulada", texto: "Venta anulada", clase: "" };
    const c = v.comprobante_id ? store.buscar("comprobantes", v.comprobante_id) : null;
    if (c) return { clave: c.sunat_status, texto: ESTADOS[c.sunat_status]?.texto || c.sunat_status, clase: ESTADOS[c.sunat_status]?.clase || "", comp: c };
    if (v.emision?.estado === "incierta") return { clave: "incierta", texto: "Emisión por confirmar", clase: "pill-warn" };
    if (v.emision?.estado === "error") return { clave: "error", texto: "No emitido", clase: "pill-danger" };
    return { clave: "sin", texto: "Sin comprobante", clase: "pill-warn" };
  }
  function listaVentas(cont) {
    cont.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Ventas</h1>
      <div class="row-actions"><a class="btn btn-primary" href="#/vender">Nueva venta</a></div>
    </div>
    <div class="toolbar">
      <select id="v-periodo" aria-label="Periodo">
        ${[["hoy", "Hoy"], ["7", "Últimos 7 días"], ["30", "Últimos 30 días"], ["todas", "Todas"]].map(([v, t]) => `<option value="${v}" ${filtros2.periodo === v ? "selected" : ""}>${t}</option>`).join("")}
      </select>
      <select id="v-estado" aria-label="Estado">
        ${[["todos", "Todos los estados"], ["pendientes", "Por emitir o con error"], ["proceso", "En proceso"], ["rechazado", "Rechazados"], ["aceptado", "Aceptados"], ["anulada", "Anuladas"]].map(([v, t]) => `<option value="${v}" ${filtros2.estado === v ? "selected" : ""}>${t}</option>`).join("")}
      </select>
    </div>
    <div id="v-resumen"></div>
    <div id="v-lista"></div>`;
    const pintar = () => pintarLista2(cont);
    $("#v-periodo", cont).addEventListener("change", (ev) => {
      filtros2.periodo = ev.target.value;
      pintar();
    });
    $("#v-estado", cont).addEventListener("change", (ev) => {
      filtros2.estado = ev.target.value;
      pintar();
    });
    pintar();
  }
  function pintarLista2(cont) {
    const hoy = hoyLima();
    const desde = filtros2.periodo === "hoy" ? hoy : filtros2.periodo === "todas" ? "0000" : hoyLima(new Date(Date.now() - (Number(filtros2.periodo) - 1) * 864e5));
    let lista2 = store.todos("ventas").filter((v) => (v.fecha_emision || hoy) >= desde);
    const conEstado = lista2.map((v) => ({ v, e: estadoVenta(v) }));
    const pasa = ({ e }) => {
      switch (filtros2.estado) {
        case "pendientes":
          return ["sin", "error", "incierta"].includes(e.clave);
        case "proceso":
          return ["enviado", "pendiente", "desconocido"].includes(e.clave);
        case "rechazado":
          return e.clave === "rechazado";
        case "aceptado":
          return ["aceptado", "observado"].includes(e.clave);
        case "anulada":
          return e.clave === "anulada";
        default:
          return true;
      }
    };
    const filtradas = conEstado.filter(pasa).sort((a, b) => b.v.id - a.v.id);
    const validas = conEstado.filter((x) => x.e.clave !== "anulada");
    const totalPeriodo = r2(validas.reduce((s, x) => s + x.v.total, 0));
    const porEmitir = conEstado.filter((x) => ["sin", "error", "incierta"].includes(x.e.clave)).length;
    $("#v-resumen", cont).innerHTML = `
    <dl class="stats stats-inline">
      <div><dt>Ventas</dt><dd>${validas.length}</dd></div>
      <div><dt>Total</dt><dd>${esc(soles(totalPeriodo))}</dd></div>
      <div><dt>Por emitir</dt><dd class="${porEmitir ? "text-danger" : ""}">${porEmitir}</dd></div>
    </dl>`;
    tablaLocal($("#v-lista", cont), {
      filas: filtradas,
      clave: `${filtros2.periodo}|${filtros2.estado}`,
      vacio: "No hay ventas con estos filtros.",
      enlace: ({ v }) => `#/ventas/${v.id}`,
      claseFila: ({ v }) => v.estado === "anulada" ? "fila-anulada" : "",
      columnas: [
        { titulo: "Venta", celda: ({ v }) => `<strong>#${esc(v.id)}</strong><span class="sub">${esc(fecha(v.fecha))}</span>` },
        { titulo: "Cliente", sec: true, celda: ({ v }) => `${esc(v.cliente?.razon_social || "Clientes varios")}${v.cliente?.num_doc ? `<span class="sub font-id">${esc(v.cliente.num_doc)}</span>` : ""}` },
        { titulo: "Comprobante", sec: true, celda: ({ e }) => e.comp ? `${esc(TIPOS_CPE[e.comp.tipo].nombre)}<span class="sub font-id">${esc(numeroCpe(e.comp))}</span>` : '<span class="muted">—</span>' },
        { titulo: "Pago", sec: true, celda: ({ v }) => esc(v.forma_pago === "Credito" ? "Crédito" : nombreMetodo(v.metodo_pago)) },
        { titulo: "Estado", celda: ({ e }) => `<span class="pill ${e.clase}">${esc(e.texto)}</span>` },
        { titulo: "Total", clase: "num", celda: ({ v }) => esc(soles(v.total)) },
        { titulo: "", clase: "col-acciones", celda: ({ v, e }) => `<span class="acciones-fila">
          ${e.comp?.api_id ? `<button class="btn btn-sm" type="button" data-pdf="${v.id}">${icono("imprimir")}<span>PDF</span></button>` : ""}
          <a class="btn btn-sm" href="#/ventas/${v.id}">Ver</a>
        </span>` }
      ],
      alPintar: (caja) => $$("[data-pdf]", caja).forEach((b) => b.addEventListener("click", () => {
        verComprobante(estadoVenta(store.buscar("ventas", Number(b.dataset.pdf))).comp);
      }))
    });
  }
  function detalleVenta(cont, id) {
    const venta = store.buscar("ventas", id);
    if (!venta) {
      cont.innerHTML = `<div class="notice notice-error">La venta #${esc(id)} no existe en este navegador.</div><a class="btn" href="#/ventas">Volver a ventas</a>`;
      return;
    }
    const ruta = location.hash;
    const sigueAqui = () => location.hash === ruta;
    const pintar = () => {
      const v = store.buscar("ventas", id);
      const e = estadoVenta(v);
      const items = itemsDeVenta(v.id);
      const tasa = tasaIgvLocal();
      const t = calcularTotales(items, tasa);
      const vuelto = v.recibido != null ? r2(v.recibido - v.total) : null;
      cont.innerHTML = `
      <a class="back-link" href="#/ventas">← Ventas</a>
      <div class="page-head">
        <h1 class="page-title">Venta #${v.id}</h1>
        <div class="row-actions"><a class="btn btn-primary" href="#/vender">Nueva venta</a></div>
      </div>

      <section class="panel cpe-card" id="cpe-card">${tarjetaComprobante(v, e)}</section>

      <section class="panel">
        <div class="panel-head"><h2>Detalle</h2><span class="muted small">${esc(fecha(v.fecha))}</span></div>
        ${tablaDatos({
        filas: items,
        columnas: [
          { titulo: "Descripción", celda: (it) => `${esc(it.descripcion)}${it.codigo ? `<span class="sub font-id">${esc(it.codigo)}</span>` : ""}` },
          { titulo: "Cant.", clase: "num", celda: (it) => esc(it.cantidad) },
          { titulo: "Precio", clase: "num", sec: true, celda: (it) => esc(soles(it.precio)) },
          { titulo: "Desc.", clase: "num", sec: true, celda: (it) => it.descuento ? esc(soles(it.descuento)) : "—" },
          { titulo: "Importe", clase: "num", celda: (it) => esc(soles(calcularLinea(it, tasa).importe)) }
        ]
      })}
        <dl class="totals">
          ${t.gravado ? `<div><dt>Op. gravadas</dt><dd>${soles(t.gravado)}</dd></div>` : ""}
          ${t.exonerado ? `<div><dt>Op. exoneradas</dt><dd>${soles(t.exonerado)}</dd></div>` : ""}
          ${t.inafecto ? `<div><dt>Op. inafectas</dt><dd>${soles(t.inafecto)}</dd></div>` : ""}
          ${t.igv ? `<div><dt>IGV</dt><dd>${soles(t.igv)}</dd></div>` : ""}
          <div class="total-row"><dt>Total</dt><dd>${soles(v.total)}</dd></div>
        </dl>
      </section>

      <section class="panel">
        <h2>Cliente y pago</h2>
        <dl class="kv">
          <div><dt>Cliente</dt><dd>${esc(v.cliente?.razon_social || "Clientes varios")}</dd></div>
          ${v.cliente ? `<div><dt>Documento</dt><dd>${esc(nombreTipoDoc(v.cliente.tipo_doc))} ${esc(v.cliente.num_doc)}</dd></div>` : ""}
          <div><dt>Forma de pago</dt><dd>${v.forma_pago === "Credito" ? "Crédito" : "Contado"}</dd></div>
          ${v.forma_pago !== "Credito" ? `<div><dt>Método</dt><dd>${esc(nombreMetodo(v.metodo_pago))}</dd></div>` : ""}
          ${v.recibido != null ? `<div><dt>Recibido / vuelto</dt><dd>${soles(v.recibido)} / ${soles(Math.max(vuelto, 0))}</dd></div>` : ""}
          <div><dt>Vendedor</dt><dd>${esc(store.buscar("usuarios", v.usuario_id)?.nombre || "—")}</dd></div>
        </dl>
        ${v.cuotas?.length ? `
          <h3 class="sub">Cuotas</h3>
          ${tablaDatos({
        filas: v.cuotas,
        columnas: [
          { titulo: "Vence", clase: "nw", celda: (q) => esc(q.fecha_pago) },
          { titulo: "Monto", clase: "num", celda: (q) => esc(soles(q.monto)) }
        ]
      })}` : ""}
        ${v.estado !== "anulada" && !v.comprobante_id && auth.esAdmin() ? `
          <div class="row-actions"><button class="btn btn-ghost-danger" type="button" id="btn-anular">Anular venta</button></div>` : ""}
      </section>`;
      conectar(v, e);
    };
    const conectar = (v, e) => {
      const card = $("#cpe-card", cont);
      $$("[data-archivo]", card).forEach((b) => b.addEventListener("click", () => conCarga(b, async () => {
        try {
          await abrirArchivo(e.comp, b.dataset.archivo, b.dataset.formato);
        } catch (err) {
          toastError(err);
        }
      })));
      $("#btn-estado", card)?.addEventListener("click", (ev) => conCarga(ev.currentTarget, async () => {
        try {
          await actualizarEstado(e.comp.id);
          pintar();
        } catch (err) {
          toastError(err);
        }
      }));
      $$("[data-emitir]", card).forEach((b) => b.addEventListener("click", () => conCarga(b, async () => {
        if (b.dataset.emitir !== "reintentar") store.actualizar("ventas", v.id, { tipo_comprobante: b.dataset.emitir });
        try {
          const comp = await emitirVenta(v.id);
          verComprobante(comp);
        } catch (err) {
          toastError(err);
        }
        pintar();
        vigilar();
      })));
      $("#btn-buscar-emitido", card)?.addEventListener("click", (ev) => conCarga(ev.currentTarget, async () => {
        try {
          const r = await buscarEmitido(v.id);
          if (r?.id) toast("Se encontró el comprobante en la API y se enlazó a esta venta.", "ok");
          else if (r.encontrados > 1) toast("Hay varios comprobantes posibles. Revísalos en la API antes de reintentar.", "warn", 7e3);
          else toast("No se encontró ningún comprobante para esta venta. Puedes reintentar.", "ok");
          if (!r?.id && r.encontrados === 0) descartarIncierta(v.id);
          pintar();
          vigilar();
        } catch (err) {
          toastError(err);
        }
      }));
      $("#btn-whatsapp", card)?.addEventListener("click", () => {
        const tel = String(v.cliente.telefono).replace(/\D/g, "");
        const num = tel.length === 9 ? `51${tel}` : tel;
        const nombre = store.config().nombre_comercial || store.config().razon_social || "la veterinaria";
        const texto = `Hola, gracias por tu compra en ${nombre}. ${TIPOS_CPE[e.comp.tipo].nombre} ${numeroCpe(e.comp)} por ${soles(e.comp.total_oficial ?? v.total)}.`;
        window.open(`https://wa.me/${num}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
      });
      $("#btn-anular", cont)?.addEventListener("click", async () => {
        if (!await confirmar("Anular venta", "La venta no tiene comprobante. Se marcará como anulada y se devolverá el stock.", "Anular venta", true)) return;
        try {
          anularVenta(store.buscar("ventas", v.id));
          toast("Venta anulada.", "ok");
          pintar();
        } catch (err) {
          toast(err.message, "warn");
        }
      });
    };
    const vigilar = async () => {
      const v = store.buscar("ventas", id);
      const comp = v.comprobante_id && store.buscar("comprobantes", v.comprobante_id);
      if (!comp || esFinal(comp.sunat_status) || comp.sunat_status === "pendiente") return;
      await esperarEstado(comp.id, { alCambiar: () => {
        if (sigueAqui()) pintar();
      }, cancelado: () => !sigueAqui() });
      if (sigueAqui()) pintar();
    };
    pintar();
    vigilar();
  }
  function tarjetaComprobante(v, e) {
    if (v.estado === "anulada") {
      return `<h2>Venta anulada</h2><p class="muted">No se emitió comprobante para esta venta.</p>`;
    }
    if (e.comp) {
      const c = e.comp;
      const aceptado = ["aceptado", "observado"].includes(c.sunat_status);
      const enProceso = !esFinal(c.sunat_status) && c.sunat_status !== "pendiente";
      const diferencia = c.total_oficial != null && Math.abs(c.total_oficial - v.total) > 0.01;
      return `
      <div class="cpe-head">
        <div>
          <span class="muted small">${esc(TIPOS_CPE[c.tipo].nombre)} electrónica</span>
          <div class="cpe-num">${esc(numeroCpe(c))}</div>
        </div>
        <span class="pill pill-lg ${ESTADOS[c.sunat_status]?.clase || ""}">${esc(ESTADOS[c.sunat_status]?.texto || c.sunat_status)}</span>
      </div>
      ${enProceso ? '<p class="muted">SUNAT aún no responde. Esta pantalla se actualiza sola; también puedes consultar.</p>' : ""}
      ${c.sunat_status === "pendiente" ? '<p class="muted">Registrado en la API, todavía no enviado a SUNAT. Las boletas por resumen diario se envían desde Operaciones SUNAT (etapa 5).</p>' : ""}
      ${c.sunat_status === "rechazado" ? `<p class="notice notice-error">SUNAT rechazó el comprobante. <a href="#/comprobantes/${TIPOS_CPE[c.tipo].ruta}/${esc(c.api_id)}">Corrígelo o reenvíalo desde su ficha</a>.</p>` : ""}
      ${c.mensaje_sunat ? `<p class="small"><strong>SUNAT:</strong> ${esc(c.mensaje_sunat)}${c.codigo_sunat ? ` (código ${esc(c.codigo_sunat)})` : ""}</p>` : ""}
      ${diferencia ? `<p class="notice small">El total oficial de la API es ${soles(c.total_oficial)} y el del sistema ${soles(v.total)}. Vale el de la API.</p>` : ""}
      <div class="row-actions">
        <button class="btn btn-primary" type="button" data-archivo="pdf" data-formato="ticket-80">Ticket 80 mm</button>
        <button class="btn" type="button" data-archivo="pdf" data-formato="a4">PDF A4</button>
        <button class="btn" type="button" data-archivo="xml">XML</button>
        ${aceptado ? '<button class="btn" type="button" data-archivo="cdr">CDR</button>' : ""}
        ${!aceptado ? '<button class="btn" type="button" id="btn-estado">Consultar estado</button>' : ""}
        ${v.cliente?.telefono ? '<button class="btn" type="button" id="btn-whatsapp">WhatsApp</button>' : ""}
        ${c.api_id ? `<a class="btn" href="#/comprobantes/${TIPOS_CPE[c.tipo].ruta}/${esc(c.api_id)}">Ver ficha</a>` : ""}
      </div>
      ${c.consultado_en ? `<p class="muted small">Última consulta: ${esc(fecha(c.consultado_en))}</p>` : ""}`;
    }
    const em = v.emision;
    if (em?.estado === "incierta") {
      return `
      <h2>Emisión por confirmar</h2>
      <p class="notice">Se perdió la conexión mientras se enviaba el comprobante. Puede que la API sí lo haya creado: búscalo antes de reintentar para no duplicarlo.</p>
      <p class="small muted">${esc(em.mensaje)}</p>
      <div class="row-actions"><button class="btn btn-primary" type="button" id="btn-buscar-emitido">Buscar en la API</button></div>`;
    }
    const tipo = v.tipo_comprobante;
    const puedeFactura = v.cliente?.tipo_doc === "6" && store.config().tax_regime !== "rus";
    return `
    <h2>${em?.estado === "error" ? "No se pudo emitir" : "Sin comprobante"}</h2>
    ${em?.estado === "error" ? `
      <div class="notice notice-error">
        <p><strong>${esc(em.mensaje)}</strong></p>
        ${(em.detalle || []).map((l) => `<p class="small">${esc(l)}</p>`).join("")}
      </div>` : '<p class="muted">La venta está guardada. Emite el comprobante cuando corresponda.</p>'}
    <div class="row-actions">
      ${em?.estado === "error" && TIPOS_CPE[tipo] ? `<button class="btn btn-primary" type="button" data-emitir="reintentar">Reintentar ${esc(TIPOS_CPE[tipo].nombre.toLowerCase())}</button>` : ""}
      ${tipo !== "03" || !em ? '<button class="btn" type="button" data-emitir="03">Emitir boleta</button>' : ""}
      ${puedeFactura && (tipo !== "01" || !em) ? '<button class="btn" type="button" data-emitir="01">Emitir factura</button>' : ""}
    </div>
    ${!puedeFactura ? '<p class="muted small">Para factura, la venta debe tener un cliente con RUC.</p>' : ""}`;
  }

  // src/tributario.js
  var PLAZO_DIAS = 7;
  var MOTIVOS_NC = [
    ["01", "Anulación de la operación"],
    ["02", "Anulación por error en el RUC"],
    ["03", "Corrección por error en la descripción"],
    ["04", "Descuento global"],
    ["05", "Descuento por ítem"],
    ["06", "Devolución total"],
    ["07", "Devolución por ítem"],
    ["08", "Bonificación"],
    ["09", "Disminución en el valor"],
    ["10", "Otros conceptos"]
  ];
  var MOTIVOS_NC_TOTAL = ["01", "02", "06"];
  var MOTIVOS_ND = [
    ["01", "Intereses por mora"],
    ["02", "Aumento en el valor"],
    ["03", "Penalidades / otros conceptos"]
  ];
  var MOTIVOS_TRASLADO = [
    ["01", "Venta"],
    ["04", "Traslado entre establecimientos de la misma empresa"],
    ["13", "Otros"]
  ];
  function diasDesde(fecha2, hoy = hoyLima()) {
    if (!fecha2) return Infinity;
    return Math.round((Date.parse(hoy) - Date.parse(String(fecha2).slice(0, 10))) / 864e5);
  }
  var dentroDePlazo = (fecha2) => diasDesde(fecha2) <= PLAZO_DIAS;
  function diasRestantes(fecha2) {
    return PLAZO_DIAS - diasDesde(fecha2);
  }
  var totalItems = (items) => r2(items.reduce((s, it) => s + Number(it.cantidad) * Number(it.precio_unitario), 0));
  function totalNcPrevias(origenTipo, origenApiId) {
    return r2(store.todos("comprobantes").filter((c) => c.tipo === "07" && c.origen_tipo === origenTipo && String(c.origen_api_id) === String(origenApiId)).filter((c) => !["rechazado", "anulado"].includes(c.sunat_status) && !c.reemplazado).reduce((s, c) => s + Number(c.total_oficial ?? c.total_local ?? 0), 0));
  }
  function serieNota(tipoNota, origenSerie) {
    const cfg2 = store.config();
    const deFactura = String(origenSerie || "").startsWith("F");
    if (tipoNota === "07") return deFactura ? cfg2.serie_nc_factura : cfg2.serie_nc_boleta;
    return deFactura ? cfg2.serie_nd_factura : cfg2.serie_nd_boleta;
  }
  function validarNota({ tipoNota, origen, motivo, descripcion, items, serie }) {
    if (!["aceptado", "observado"].includes(origen.sunat_status)) return "Solo se emiten notas sobre comprobantes aceptados por SUNAT.";
    if (!serie) return "Falta la serie de la nota en Configuración → Series.";
    const esperado = String(origen.serie).startsWith("F") ? "F" : "B";
    if (!String(serie).startsWith(esperado)) return `La serie de la nota debe empezar con ${esperado}, igual que el comprobante.`;
    const motivos = tipoNota === "07" ? MOTIVOS_NC : MOTIVOS_ND;
    if (!motivos.some((m) => m[0] === motivo)) return "Elige el motivo.";
    if (!descripcion || descripcion.trim().length < 4) return "Describe el motivo (mínimo 4 caracteres).";
    if (!items.length) return "La nota debe tener al menos un ítem.";
    for (const it of items) {
      if (!it.descripcion?.trim()) return "Cada ítem necesita descripción.";
      if (!(Number(it.cantidad) > 0)) return `Cantidad inválida en "${it.descripcion}".`;
      if (!(Number(it.precio_unitario) > 0)) return `Precio inválido en "${it.descripcion}".`;
    }
    if (tipoNota === "07" && origen.total_oficial != null) {
      const saldo = r2(Number(origen.total_oficial) - totalNcPrevias(origen.tipo, origen.api_id));
      const total = totalItems(items);
      if (total - saldo > 0.01) return `La nota (S/ ${total.toFixed(2)}) supera el saldo del comprobante (S/ ${saldo.toFixed(2)}).`;
    }
    return null;
  }
  function armarNota({ tipoNota, origen, motivo, descripcion, items, serie }) {
    return {
      serie,
      fecha_emision: hoyLima(),
      tipo_moneda: "PEN",
      doc_afectado_tipo: origen.tipo,
      doc_afectado_serie: origen.serie,
      doc_afectado_correlativo: String(origen.correlativo),
      cod_motivo: motivo,
      des_motivo: descripcion.trim(),
      cliente: Object.fromEntries(Object.entries({
        tipo_doc: origen.cliente.tipo_doc,
        num_doc: origen.cliente.num_doc,
        razon_social: origen.cliente.razon_social,
        direccion: origen.cliente.direccion
      }).filter(([, v]) => v)),
      items: items.map((it) => {
        const i = {
          descripcion: it.descripcion.trim(),
          unidad: it.unidad || "NIU",
          cantidad: Number(it.cantidad),
          precio_unitario: Number(it.precio_unitario),
          tip_afe_igv: it.tip_afe_igv || "10"
        };
        if (it.codigo) i.codigo = it.codigo;
        return i;
      })
    };
  }
  async function emitirNota(datos, { devolverStock = false } = {}) {
    const error = validarNota(datos);
    if (error) throw new Error(error);
    const body = armarNota(datos);
    const ruta = TIPOS_CPE[datos.tipoNota].ruta;
    const r = await api.emitirNota(ruta, body);
    const cpe = leerCpe(r.datos);
    const origenLocal = comprobanteLocal(datos.origen.tipo, datos.origen.api_id);
    const nota = store.insertar("comprobantes", {
      venta_id: null,
      tipo: datos.tipoNota,
      serie: cpe.serie || body.serie,
      correlativo: cpe.correlativo,
      api_id: cpe.api_id,
      sunat_status: cpe.sunat_status === "desconocido" ? "enviado" : cpe.sunat_status,
      mensaje_sunat: cpe.mensaje_sunat,
      total_oficial: cpe.total_oficial,
      total_local: totalItems(datos.items),
      cliente_num_doc: datos.origen.cliente.num_doc,
      comprobante_origen_id: origenLocal?.id ?? null,
      origen_tipo: datos.origen.tipo,
      origen_api_id: datos.origen.api_id,
      origen_numero: `${datos.origen.serie}-${datos.origen.correlativo}`,
      motivo: datos.motivo,
      fecha_emision: body.fecha_emision
    });
    if (devolverStock && datos.tipoNota === "07") devolverAlStock(datos.items, origenLocal);
    return nota;
  }
  function devolverAlStock(items, origenLocal) {
    for (const it of items) {
      const p = store.todos("productos").find((x) => x.codigo === it.codigo);
      if (p?.controla_stock) store.actualizar("productos", p.id, { stock: r2(Number(p.stock || 0) + Number(it.cantidad)) });
    }
    if (origenLocal?.venta_id) store.actualizar("ventas", origenLocal.venta_id, { devolucion_registrada: true });
  }
  function puedeBaja(c) {
    if (!["01", "07", "08"].includes(c.tipo)) return "Las boletas se anulan con resumen diario, no con baja.";
    if (!["aceptado", "observado"].includes(c.sunat_status)) return "Solo se dan de baja comprobantes aceptados.";
    if (!dentroDePlazo(c.fecha_emision)) return `Pasaron más de ${PLAZO_DIAS} días: usa una nota de crédito.`;
    return null;
  }
  async function comunicarBaja(c, motivo) {
    const error = puedeBaja(c);
    if (error) throw new Error(error);
    if (!motivo || motivo.trim().length < 4) throw new Error("Describe el motivo de la baja.");
    const hoy = hoyLima();
    const r = await api.crearAnulacion({
      fecha_generacion: hoy,
      fecha_comunicacion: hoy,
      detalles: [{ tipo_documento: c.tipo, serie: c.serie, correlativo: String(c.correlativo), motivo: motivo.trim() }]
    });
    const bajaId = r.datos?.id ?? r.datos?.anulacion?.id ?? null;
    marcarLocal(c.tipo, c.api_id, { baja_api_id: bajaId, baja_estado: normalizarEstado(r.datos?.sunat_status ?? r.datos?.estado) });
    return r;
  }
  async function boletasPendientes() {
    const r = await api.listarComprobantes("boletas", { sunat_status: "pendiente", por_pagina: 200 });
    return comoLista(r.datos).map((x) => ({ ...leerCpe(x), fecha_emision: (x.fecha_emision ?? "").slice(0, 10), cliente: x.client_razon_social ?? x.cliente?.razon_social ?? "" }));
  }
  function agruparPorFecha(boletas) {
    const grupos = /* @__PURE__ */ new Map();
    for (const b of boletas) {
      const f = b.fecha_emision || "sin fecha";
      if (!grupos.has(f)) grupos.set(f, []);
      grupos.get(f).push(b);
    }
    return [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([fecha2, lista2]) => ({ fecha: fecha2, lista: lista2, total: r2(lista2.reduce((s, b) => s + Number(b.total_oficial || 0), 0)), restantes: diasRestantes(fecha2) }));
  }
  async function enviarResumen(fecha2) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha2)) throw new Error("Fecha de resumen inválida.");
    if (fecha2 > hoyLima()) throw new Error("No se envía un resumen de una fecha futura.");
    return api.crearResumen({ fecha_resumen: fecha2 });
  }
  function puedeAnularBoleta(c) {
    if (c.tipo !== "03") return "Solo boletas.";
    if (!["aceptado", "observado"].includes(c.sunat_status)) return "Solo se anulan por resumen las boletas aceptadas. Si no fue aceptada, elimínala.";
    if (!dentroDePlazo(c.fecha_emision)) return `Pasaron más de ${PLAZO_DIAS} días: usa una nota de crédito.`;
    return null;
  }
  async function anularBoletaPorResumen(c, motivo) {
    const error = puedeAnularBoleta(c);
    if (error) throw new Error(error);
    if (!motivo || motivo.trim().length < 4) throw new Error("Describe el motivo de la anulación.");
    const r = await api.crearResumen({ fecha_resumen: c.fecha_emision, anular: [{ id: c.api_id, motivo: motivo.trim() }] });
    marcarLocal("03", c.api_id, { baja_api_id: r.datos?.id ?? null, baja_tipo: "resumen", baja_estado: "enviado" });
    return r;
  }
  function aplicarResultadoBaja(tipo, apiId, estado2) {
    const cambios = { baja_estado: estado2 };
    if (estado2 === "aceptado") cambios.sunat_status = "anulado";
    marcarLocal(tipo, apiId, cambios);
  }
  function marcarLocal(tipo, apiId, cambios) {
    const local = comprobanteLocal(tipo, apiId);
    if (local) store.actualizar("comprobantes", local.id, cambios);
  }
  function leerEstadoProceso(datos) {
    const d = datos?.anulacion || datos?.resumen || datos || {};
    const s = d.sunat && typeof d.sunat === "object" ? d.sunat : {};
    return {
      estado: normalizarEstado(d.sunat_status ?? s.estado ?? d.estado_sunat ?? d.estado ?? d.status),
      mensaje: s.descripcion ?? d.descripcion_sunat ?? d.sunat_description ?? d.mensaje_sunat ?? d.mensaje ?? null,
      ticket: d.ticket ?? s.ticket ?? d.sunat_ticket ?? null,
      detalles: d.detalles ?? d.boletas ?? d.documentos ?? []
    };
  }
  var sumaPagos = (pagos) => r2(pagos.reduce((s, p) => s + Number(p.monto || 0), 0));
  function validarPago(p, saldo) {
    if (!(Number(p.monto) > 0)) return "El monto debe ser mayor a 0.";
    if (saldo != null && Number(p.monto) - saldo > 9e-3) return `El pago supera el saldo (S/ ${saldo.toFixed(2)}).`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha || "")) return "Fecha inválida.";
    if (p.fecha > hoyLima()) return "La fecha del pago no puede ser futura.";
    return null;
  }
  function validarGuia(g) {
    if (!g.serie || !/^T[A-Z0-9]{3}$/.test(g.serie)) return "Serie de guía inválida (debe empezar con T).";
    const errDest = errorDocumento(g.destinatario.tipo_doc, g.destinatario.num_doc);
    if (errDest) return `Destinatario: ${errDest}`;
    if (!g.destinatario.razon_social) return "Escribe el nombre del destinatario.";
    if (!MOTIVOS_TRASLADO.some((m) => m[0] === g.cod_traslado)) return "Elige el motivo de traslado.";
    if (!g.fecha_traslado || g.fecha_traslado < g.fecha_emision) return "La fecha de traslado no puede ser anterior a la emisión.";
    if (!(Number(g.peso_total) > 0)) return "El peso total debe ser mayor a 0.";
    for (const [k, n] of [["partida", "partida"], ["llegada", "llegada"]]) {
      if (!/^\d{6}$/.test(g[`${k}_ubigeo`] || "")) return `Ubigeo de ${n} inválido (6 dígitos).`;
      if (!(g[`${k}_direccion`] || "").trim()) return `Escribe la dirección de ${n}.`;
    }
    if (g.cod_traslado === "04" && g.partida_cod_local === g.llegada_cod_local) return "En traslado entre establecimientos, partida y llegada deben ser locales distintos.";
    if (g.mod_traslado === "01") {
      const t = g.transportista || {};
      if (t.tipo_doc !== "6" || errorDocumento("6", t.num_doc)) return "Transporte público: el transportista debe tener RUC válido.";
      if (!t.razon_social) return "Escribe la razón social del transportista.";
    } else if (!g.m1l) {
      if (!/^[A-Z0-9]{5,8}$/.test(g.vehiculo?.placa || "")) return "Placa del vehículo inválida (sin guiones).";
      const c = g.conductor || {};
      if (errorDocumento(c.tipo_doc, c.num_doc)) return "Documento del conductor inválido.";
      if (!c.nombres || !c.apellidos || !c.licencia) return "Completa nombres, apellidos y licencia del conductor.";
    }
    if (!g.items.length) return "Agrega al menos un bien a trasladar.";
    for (const it of g.items) {
      if (!it.descripcion?.trim() || !(Number(it.cantidad) > 0)) return "Cada bien necesita descripción y cantidad.";
    }
    return null;
  }
  function armarGuia(g) {
    const body = {
      serie: g.serie,
      fecha_emision: g.fecha_emision,
      destinatario: { tipo_doc: g.destinatario.tipo_doc, num_doc: g.destinatario.num_doc, razon_social: g.destinatario.razon_social },
      cod_traslado: g.cod_traslado,
      mod_traslado: g.mod_traslado,
      fecha_traslado: g.fecha_traslado,
      peso_total: Number(g.peso_total),
      und_peso_total: "KGM",
      partida_ubigeo: g.partida_ubigeo,
      partida_direccion: g.partida_direccion.trim(),
      llegada_ubigeo: g.llegada_ubigeo,
      llegada_direccion: g.llegada_direccion.trim(),
      items: g.items.map((it) => ({ codigo: it.codigo || "ITEM", descripcion: it.descripcion.trim(), cantidad: Number(it.cantidad), unidad: it.unidad || "NIU" }))
    };
    if (Number(g.num_bultos) > 0) body.num_bultos = Number(g.num_bultos);
    if (g.cod_traslado === "04") {
      const ruc = store.config().ruc;
      Object.assign(body, { partida_ruc: ruc, partida_cod_local: g.partida_cod_local, llegada_ruc: ruc, llegada_cod_local: g.llegada_cod_local });
    }
    if (g.mod_traslado === "01") {
      body.fecha_de_entrega_al_transportista = g.fecha_traslado;
      body.transportista = { tipo_doc: "6", num_doc: g.transportista.num_doc, razon_social: g.transportista.razon_social };
      if (g.transportista.nro_mtc) body.transportista.nro_mtc = g.transportista.nro_mtc;
    } else if (g.m1l) {
      body.indicadores = ["SUNAT_Envio_IndicadorTrasladoVehiculoM1L"];
    } else {
      body.vehiculo = { placa: g.vehiculo.placa };
      body.conductor = {
        tipo: "Principal",
        tipo_doc: g.conductor.tipo_doc,
        num_doc: g.conductor.num_doc,
        nombres: g.conductor.nombres.trim().toUpperCase(),
        apellidos: g.conductor.apellidos.trim().toUpperCase(),
        licencia: g.conductor.licencia.trim().toUpperCase()
      };
    }
    return body;
  }
  function guardarGuiaLocal(datosApi, body, existente = null) {
    const cpe = leerCpe(datosApi);
    const campos = {
      tipo: "09",
      venta_id: null,
      serie: cpe.serie || body.serie,
      correlativo: cpe.correlativo ?? existente?.correlativo ?? null,
      api_id: cpe.api_id ?? existente?.api_id,
      sunat_status: cpe.sunat_status === "desconocido" ? "enviado" : cpe.sunat_status,
      mensaje_sunat: cpe.mensaje_sunat,
      cliente_num_doc: body.destinatario.num_doc,
      fecha_emision: body.fecha_emision,
      payload: body
    };
    return existente ? store.actualizar("comprobantes", existente.id, campos) : store.insertar("comprobantes", campos);
  }

  // src/views/inicio.js
  var MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
  async function vistaInicio(cont) {
    const u = auth.actual();
    const hoy = hoyLima();
    const ventasHoy = store.todos("ventas").filter((v) => v.fecha_emision === hoy && v.estado !== "anulada");
    const totalHoy = r2(ventasHoy.reduce((s, v) => s + v.total, 0));
    const estados = store.todos("ventas").filter((v) => v.estado !== "anulada").map((v) => estadoVenta(v));
    const porEmitir = estados.filter((e) => ["sin", "error", "incierta"].includes(e.clave)).length;
    const rechazados = store.todos("comprobantes").filter((c) => c.sunat_status === "rechazado" && !c.reemplazado).length;
    const fechaLarga = (/* @__PURE__ */ new Date()).toLocaleDateString("es-PE", { timeZone: "America/Lima", weekday: "long", day: "numeric", month: "long" });
    cont.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Hola, ${esc(u.nombre.split(" ")[0])}</h1>
        <p class="muted subtitle">${esc(fechaLarga)}</p>
      </div>
      <div class="row-actions"><a class="btn btn-primary" href="#/vender">Nueva venta</a></div>
    </div>

    <dl class="kpis">
      <div class="kpi"><dt>Ventas de hoy</dt><dd>${ventasHoy.length}</dd></div>
      <div class="kpi"><dt>Total de hoy</dt><dd>${esc(soles(totalHoy))}</dd></div>
      <a class="kpi ${porEmitir ? "is-alert" : ""}" href="#/ventas"><dt>Por emitir</dt><dd>${porEmitir}</dd></a>
      <a class="kpi ${rechazados ? "is-alert" : ""}" href="#/comprobantes"><dt>Rechazados</dt><dd>${rechazados}</dd></a>
    </dl>

    <section class="panel" id="alertas"><h2>Pendientes</h2><div id="alertas-body"></div></section>

    <div class="dash-grid">
      <section class="panel">
        <div class="panel-head"><h2>Ventas por mes</h2><span class="muted small" id="chart-fuente"></span></div>
        <div id="chart"><p class="loading">Cargando…</p></div>
      </section>
      <section class="panel">
        <h2>Hoy por método de pago</h2>
        ${metodosHoy(ventasHoy)}
      </section>
      <section class="panel">
        <h2>Más vendidos · 30 días</h2>
        ${masVendidos()}
      </section>
      <section class="panel">
        <h2>Últimos comprobantes</h2>
        <div id="recientes"><p class="loading">Cargando…</p></div>
      </section>
    </div>

    ${puestaEnMarcha()}`;
    pintarAlertas(cont, []);
    conectarPuesta(cont);
    if (!credencialesListas()) {
      $("#chart", cont).innerHTML = graficoMensual(ventasLocalesPorMes());
      $("#chart-fuente", cont).textContent = "Datos del sistema";
      conectarGrafico(cont);
      $("#recientes", cont).innerHTML = recientesLocales();
      return;
    }
    const [mensual, recientes, alertas] = await Promise.allSettled([
      request("GET", "/panel/ventas-mensuales"),
      request("GET", "/panel/documentos-recientes"),
      request("GET", "/panel/alertas")
    ]);
    if (!document.body.contains(cont) || !$("#chart", cont)) return;
    const serieApi = mensual.status === "fulfilled" ? leerSerieMensual(mensual.value.datos) : null;
    $("#chart", cont).innerHTML = graficoMensual(serieApi || ventasLocalesPorMes());
    $("#chart-fuente", cont).textContent = serieApi ? "Según la API (comprobantes)" : "Datos del sistema";
    conectarGrafico(cont);
    $("#recientes", cont).innerHTML = recientes.status === "fulfilled" ? recientesApi(recientes.value.datos) : recientesLocales();
    pintarAlertas(cont, alertas.status === "fulfilled" ? leerAlertasApi(alertas.value.datos) : []);
  }
  function alertasLocales() {
    const hoy = hoyLima();
    const lista2 = [];
    const comps = store.todos("comprobantes").filter((c) => !c.reemplazado);
    const rech = comps.filter((c) => c.sunat_status === "rechazado" && TIPOS_CPE[c.tipo]);
    if (rech.length) lista2.push({ nivel: "critico", texto: `${rech.length} comprobante(s) rechazado(s) por SUNAT`, enlace: `#/comprobantes/${TIPOS_CPE[rech[0].tipo].ruta}/${rech[0].api_id}`, accion: "Revisar" });
    const inciertas = store.todos("ventas").filter((v) => v.emision?.estado === "incierta" && !v.comprobante_id);
    if (inciertas.length) lista2.push({ nivel: "critico", texto: `${inciertas.length} venta(s) con emisión por confirmar (se cortó la conexión)`, enlace: `#/ventas/${inciertas[0].id}`, accion: "Confirmar" });
    const sinCpe = store.todos("ventas").filter((v) => v.estado !== "anulada" && !v.comprobante_id && v.emision?.estado !== "incierta");
    if (sinCpe.length) lista2.push({ nivel: "aviso", texto: `${sinCpe.length} venta(s) sin comprobante emitido`, enlace: `#/ventas/${sinCpe[0].id}`, accion: "Emitir" });
    const boletasPend = comps.filter((c) => c.tipo === "03" && c.sunat_status === "pendiente");
    if (boletasPend.length) {
      const minimo = Math.min(...boletasPend.map((b) => diasRestantes(b.fecha_emision)));
      lista2.push({ nivel: minimo <= 2 ? "critico" : "aviso", texto: `${boletasPend.length} boleta(s) esperando resumen diario${minimo <= 2 ? ` · ${minimo < 0 ? "fuera de plazo" : `quedan ${minimo} día(s)`}` : ""}`, enlace: "#/sunat/resumen", accion: "Enviar" });
    }
    const enProceso = comps.filter((c) => ["enviado", "desconocido"].includes(c.sunat_status) && TIPOS_CPE[c.tipo]);
    if (enProceso.length) lista2.push({ nivel: "info", texto: `${enProceso.length} comprobante(s) esperando respuesta de SUNAT`, enlace: "#/comprobantes", accion: "Ver" });
    const vencidas = store.todos("ventas").filter((v) => v.forma_pago === "Credito" && v.estado !== "anulada" && (v.cuotas || []).some((q) => q.fecha_pago < hoy));
    if (vencidas.length) lista2.push({ nivel: "aviso", texto: `${vencidas.length} factura(s) al crédito con cuotas vencidas`, enlace: "#/sunat/cobranzas", accion: "Cobrar" });
    const productos = store.todos("productos").filter((p) => p.activo !== false && p.controla_stock);
    const agotados = productos.filter((p) => Number(p.stock) <= 0);
    const bajos = productos.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= 3);
    if (agotados.length) lista2.push({ nivel: "aviso", texto: `Agotados: ${agotados.slice(0, 3).map((p) => p.descripcion).join(", ")}${agotados.length > 3 ? ` y ${agotados.length - 3} más` : ""}`, enlace: "#/productos", accion: "Ver" });
    if (bajos.length) lista2.push({ nivel: "info", texto: `Stock bajo (3 o menos): ${bajos.slice(0, 3).map((p) => `${p.descripcion} (${p.stock})`).join(", ")}${bajos.length > 3 ? "…" : ""}`, enlace: "#/productos", accion: "Ver" });
    const fechas = [store.config().ultimo_respaldo, store.ultimoRespaldoServidor()].filter(Boolean).sort();
    const ult = fechas.at(-1);
    const horas = ult ? (Date.now() - Date.parse(ult)) / 36e5 : Infinity;
    if (store.todos("ventas").length && horas > 24 && auth.esAdmin()) {
      lista2.push({ nivel: "aviso", texto: ult ? `Último respaldo de data.json: ${fecha(ult)}` : "Aún no hay respaldo de data.json", enlace: "#/config/respaldo", accion: "Respaldar" });
    }
    if (store.config().entorno !== "production" && store.config().ruc) {
      lista2.push({ nivel: "info", texto: "Entorno beta: los comprobantes son de prueba", enlace: auth.esAdmin() ? "#/config/empresa" : null, accion: "Configurar" });
    }
    return lista2;
  }
  function leerAlertasApi(datos) {
    const lista2 = Array.isArray(datos) ? datos : datos?.alertas ?? datos?.items ?? [];
    if (!Array.isArray(lista2)) return [];
    return lista2.map((a) => typeof a === "string" ? { nivel: "info", texto: a, origen: "API" } : { nivel: /crit|error|rech/i.test(a.tipo ?? a.nivel ?? "") ? "critico" : /warn|aviso|venc/i.test(a.tipo ?? a.nivel ?? "") ? "aviso" : "info", texto: a.mensaje ?? a.message ?? a.descripcion ?? a.titulo ?? JSON.stringify(a), origen: "API" }).filter((a) => a.texto);
  }
  function pintarAlertas(cont, deApi2) {
    const caja = $("#alertas-body", cont);
    if (!caja) return;
    const orden = { critico: 0, aviso: 1, info: 2 };
    const todas = [...alertasLocales(), ...deApi2].sort((a, b) => orden[a.nivel] - orden[b.nivel]);
    const ICONO = { critico: "error", aviso: "alerta", info: "info" };
    const NOMBRE = { critico: "Urgente", aviso: "Atención", info: "Información" };
    caja.innerHTML = todas.length ? `<ul class="alertas">${todas.map((a) => `
    <li class="alerta alerta-${a.nivel}">
      <span class="alerta-icono" aria-hidden="true">${icono(ICONO[a.nivel])}</span>
      <span class="alerta-texto"><span class="sr-only">${NOMBRE[a.nivel]}: </span>${esc(a.texto)}${a.origen ? ' <span class="muted small">(API)</span>' : ""}</span>
      ${a.enlace ? `<a class="btn btn-sm" href="${esc(a.enlace)}">${esc(a.accion)}</a>` : ""}
    </li>`).join("")}</ul>` : '<p class="muted">Todo al día. No hay pendientes.</p>';
  }
  function ventasLocalesPorMes(n = 6) {
    const hoy = hoyLima();
    const [y, m] = hoy.split("-").map(Number);
    const meses = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      meses.push({ clave: d.toISOString().slice(0, 7), etiqueta: MESES[d.getUTCMonth()], total: 0 });
    }
    for (const v of store.todos("ventas")) {
      if (v.estado === "anulada") continue;
      const mes = meses.find((x) => x.clave === String(v.fecha_emision).slice(0, 7));
      if (mes) mes.total += v.total;
    }
    meses.forEach((x) => {
      x.total = r2(x.total);
    });
    return meses;
  }
  function leerSerieMensual(datos) {
    const lista2 = Array.isArray(datos) ? datos : datos?.meses ?? datos?.series ?? datos?.data ?? datos?.ventas ?? datos?.actual ?? null;
    if (!Array.isArray(lista2) || !lista2.length) return null;
    const serie = lista2.map((x) => {
      const clave2 = String(x.mes ?? x.periodo ?? x.month ?? x.fecha ?? "");
      const total = Number(x.total ?? x.monto ?? x.ventas ?? x.importe ?? x.valor);
      const m = /(\d{4})-(\d{2})/.exec(clave2);
      return { clave: clave2, etiqueta: m ? MESES[Number(m[2]) - 1] : clave2.slice(0, 3), total: r2(total) };
    }).filter((x) => x.clave && !isNaN(x.total));
    return serie.length ? serie.slice(-12) : null;
  }
  function graficoMensual(serie) {
    if (!serie?.length || serie.every((x) => !x.total)) {
      return '<p class="muted">Aún no hay ventas para graficar.</p>';
    }
    const W = 560, H = 220, izq = 52, der = 8, arriba = 16, abajo = 28;
    const max = Math.max(...serie.map((x) => x.total));
    const paso = escalaLimpia(max);
    const tope = Math.ceil(max / paso) * paso;
    const ancho = (W - izq - der) / serie.length;
    const barra = Math.min(24, ancho * 0.6);
    const y = (v) => arriba + (H - arriba - abajo) * (1 - v / tope);
    const ticks = [];
    for (let t = 0; t <= tope + 1e-3; t += paso) ticks.push(t);
    const mayor = serie.reduce((a, b) => b.total > a.total ? b : a);
    const compacto = (n) => n >= 1e3 ? `${r2(n / 1e3)}K` : String(Math.round(n));
    return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Ventas por mes en soles. Mes más alto: ${esc(mayor.etiqueta)}, ${esc(soles(mayor.total))}.">
        ${ticks.map((t) => `<line x1="${izq}" x2="${W - der}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${izq - 8}" y="${y(t) + 4}" class="tick" text-anchor="end">${compacto(t)}</text>`).join("")}
        ${serie.map((x, i) => {
      const cx = izq + ancho * i + ancho / 2;
      const alto = Math.max(0, y(0) - y(x.total));
      const r = Math.min(4, alto / 2, barra / 2);
      const x0 = cx - barra / 2, y0 = y(x.total);
      const d = alto > 0 ? `M${x0},${y(0)} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + barra - r} Q${x0 + barra},${y0} ${x0 + barra},${y0 + r} V${y(0)} Z` : "";
      return `<g class="col" tabindex="0" data-i="${i}" aria-label="${esc(x.etiqueta)}: ${esc(soles(x.total))}">
            <rect x="${cx - ancho / 2}" y="${arriba}" width="${ancho}" height="${H - arriba - abajo}" class="hit"/>
            ${d ? `<path d="${d}" class="barra-mes"/>` : ""}
            ${x === mayor ? `<text x="${cx}" y="${y0 - 6}" class="val" text-anchor="middle">${compacto(x.total)}</text>` : ""}
            <text x="${cx}" y="${H - 8}" class="tick" text-anchor="middle">${esc(x.etiqueta)}</text>
          </g>`;
    }).join("")}
        <line x1="${izq}" x2="${W - der}" y1="${y(0)}" y2="${y(0)}" class="axis"/>
      </svg>
      <div class="chart-tip" role="tooltip" hidden></div>
    </div>
    <details class="chart-tabla"><summary>Ver como tabla</summary>
      <table class="table table-compact"><thead><tr><th>Mes</th><th class="num">Total</th></tr></thead>
      <tbody>${serie.map((x) => `<tr><td>${esc(x.clave)}</td><td class="num">${esc(soles(x.total))}</td></tr>`).join("")}</tbody></table>
    </details>
    <script type="application/json" class="chart-data">${JSON.stringify(serie).replace(/</g, "\\u003c")}<\/script>`;
  }
  function escalaLimpia(max) {
    if (max <= 0) return 1;
    const bruto = max / 4;
    const pot = 10 ** Math.floor(Math.log10(bruto));
    const n = bruto / pot;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pot;
  }
  function conectarGrafico(cont) {
    const wrap = $(".chart-wrap", cont);
    if (!wrap) return;
    const datos = JSON.parse($(".chart-data", cont)?.textContent || "[]");
    const tip = $(".chart-tip", wrap);
    const mostrar = (g) => {
      const x = datos[Number(g.dataset.i)];
      if (!x) return;
      tip.innerHTML = `<strong>${esc(x.clave)}</strong><span>${esc(soles(x.total))}</span>`;
      tip.hidden = false;
      const caja = wrap.getBoundingClientRect?.();
      const r = g.getBoundingClientRect?.();
      if (caja && r) {
        tip.style.left = `${Math.min(Math.max(r.left - caja.left + r.width / 2, 60), caja.width - 60)}px`;
        tip.style.top = "4px";
      }
      $$(".col", wrap).forEach((c) => c.classList.toggle("is-hover", c === g));
    };
    const ocultar = () => {
      tip.hidden = true;
      $$(".col", wrap).forEach((c) => c.classList.remove("is-hover"));
    };
    $$(".col", wrap).forEach((g) => {
      g.addEventListener("mouseenter", () => mostrar(g));
      g.addEventListener("focus", () => mostrar(g));
      g.addEventListener("click", () => mostrar(g));
    });
    wrap.addEventListener("mouseleave", ocultar);
    wrap.addEventListener("focusout", ocultar);
  }
  function metodosHoy(ventasHoy) {
    const contado = ventasHoy.filter((v) => v.forma_pago !== "Credito");
    const credito = r2(ventasHoy.filter((v) => v.forma_pago === "Credito").reduce((s, v) => s + v.total, 0));
    const filas = METODOS_PAGO.map(([k, t]) => ({ t, total: r2(contado.filter((v) => v.metodo_pago === k).reduce((s, v) => s + v.total, 0)), n: contado.filter((v) => v.metodo_pago === k).length })).filter((f) => f.n);
    if (credito) filas.push({ t: "Crédito", total: credito, n: ventasHoy.filter((v) => v.forma_pago === "Credito").length });
    if (!filas.length) return '<p class="muted">Sin ventas hoy.</p>';
    return `<ul class="rows">${filas.map((f) => `<li class="row"><span>${esc(f.t)} <span class="muted small">· ${f.n}</span></span><strong class="num">${esc(soles(f.total))}</strong></li>`).join("")}</ul>`;
  }
  function masVendidos() {
    const desde = hoyLima(new Date(Date.now() - 29 * 864e5));
    const ventas = new Set(store.todos("ventas").filter((v) => v.estado !== "anulada" && v.fecha_emision >= desde).map((v) => v.id));
    const acc = /* @__PURE__ */ new Map();
    for (const it of store.todos("venta_items")) {
      if (!ventas.has(it.venta_id)) continue;
      const k = it.codigo || it.descripcion;
      const a = acc.get(k) || { descripcion: it.descripcion, cantidad: 0, total: 0 };
      a.cantidad += Number(it.cantidad);
      a.total += Number(it.precio) * Number(it.cantidad) - Number(it.descuento || 0);
      acc.set(k, a);
    }
    const top = [...acc.values()].sort((a, b) => b.total - a.total).slice(0, 5);
    if (!top.length) return '<p class="muted">Sin ventas en los últimos 30 días.</p>';
    return `<ol class="rows ranking">${top.map((p) => `<li class="row"><span>${esc(p.descripcion)} <span class="muted small">· ${r2(p.cantidad)}</span></span><strong class="num">${esc(soles(p.total))}</strong></li>`).join("")}</ol>`;
  }
  function tablaRecientes(filas) {
    return tablaDatos({
      filas,
      vacio: "Aún no hay comprobantes.",
      enlace: (c) => c.ruta && c.api_id != null ? `#/comprobantes/${c.ruta}/${c.api_id}` : "",
      columnas: [
        { titulo: "Comprobante", celda: (c) => `<strong class="font-id">${esc(c.numero)}</strong><span class="sub">${esc(c.nombre)}</span>` },
        { titulo: "Cliente", sec: true, celda: (c) => esc(c.cliente || "") },
        { titulo: "Estado", celda: (c) => {
          const e = ESTADOS[c.estado] || ESTADOS.desconocido;
          return `<span class="pill ${e.clase}">${esc(e.texto)}</span>`;
        } },
        { titulo: "Total", clase: "num", sec: true, celda: (c) => c.total != null ? esc(soles(c.total)) : "—" }
      ]
    });
  }
  function recientesApi(datos) {
    const lista2 = comoLista(datos).slice(0, 8);
    if (!lista2.length) return recientesLocales();
    return tablaRecientes(lista2.map((x) => {
      const cpe = leerCpe(x);
      const tipo = String(x.tipo_documento ?? x.tipo ?? "");
      return {
        ruta: TIPOS_CPE[tipo]?.ruta,
        api_id: x.id,
        nombre: TIPOS_CPE[tipo]?.nombre || x.tipo_nombre || "",
        numero: `${x.serie ?? ""}-${x.correlativo ?? ""}`,
        cliente: x.client_razon_social ?? x.cliente?.razon_social ?? "",
        estado: cpe.sunat_status,
        total: cpe.total_oficial
      };
    }));
  }
  function recientesLocales() {
    const lista2 = store.todos("comprobantes").filter((c) => TIPOS_CPE[c.tipo]).sort((a, b) => b.id - a.id).slice(0, 8);
    return tablaRecientes(lista2.map((c) => ({
      ruta: TIPOS_CPE[c.tipo].ruta,
      api_id: c.api_id,
      nombre: TIPOS_CPE[c.tipo].nombre,
      numero: numeroCpe(c),
      cliente: c.fecha_emision || "",
      estado: c.sunat_status,
      total: c.total_oficial
    })));
  }
  function pasosPuesta() {
    const c = store.config();
    return [
      [modoProxy() ? "Conexión con el servidor del sistema" : "Credenciales en config.js", credencialesListas() && (!modoProxy() || !window.APP_CONFIG?.PIN || Boolean(getPin()))],
      ["Datos de la empresa leídos de la API", Boolean(c.ruc)],
      ["Sucursal por defecto elegida", Boolean(c.sucursal_id)],
      ["Series de factura y boleta definidas", Boolean(c.serie_factura && c.serie_boleta)],
      ["Al menos un producto o servicio", store.todos("productos").some((p) => p.activo !== false)]
    ];
  }
  function puestaEnMarcha() {
    const pasos = pasosPuesta();
    const listos = pasos.filter((p) => p[1]).length;
    const completo = listos === pasos.length;
    return `
    <section class="panel">
      <details ${completo ? "" : "open"}>
        <summary class="panel-head summary-head"><h2>Puesta en marcha</h2><span class="pill ${completo ? "pill-ok" : ""}">${listos} de ${pasos.length}</span></summary>
        <ul class="checklist">
          ${pasos.map(([t, ok]) => `<li class="${ok ? "is-done" : ""}"><span class="dot" aria-hidden="true"></span>${esc(t)}<span class="sr-only">${ok ? " (listo)" : " (pendiente)"}</span></li>`).join("")}
        </ul>
        <div class="row-actions">
          <button class="btn" id="btn-probar" type="button">Probar conexión con la API</button>
          ${auth.esAdmin() ? '<a class="btn" href="#/config/empresa">Configuración</a>' : ""}
        </div>
        <p class="muted small" id="probar-res" style="white-space: pre-line"></p>
      </details>
    </section>`;
  }
  function conectarPuesta(cont) {
    $("#btn-probar", cont)?.addEventListener("click", (ev) => conCarga(ev.currentTarget, async () => {
      const res = $("#probar-res", cont);
      try {
        const pasos = await cargarDatosDeLaApi();
        res.textContent = pasos.map((p) => `${p.ok ? "✓" : "•"} ${p.texto}`).join("\n");
        toast("Conexión correcta. Datos cargados desde la API.", "ok");
      } catch (e) {
        res.textContent = e.message;
        toastError(e);
      }
    }));
  }

  // src/views/config.js
  var SECCIONES = [
    ["empresa", "Empresa"],
    ["documentos", "Logo y certificado"],
    ["regimen", "Régimen"],
    ["sucursales", "Sucursales"],
    ["series", "Series"],
    ["credenciales", "Credenciales API"],
    ["plan", "Plan y uso"],
    ["usuarios", "Usuarios"],
    ["seguridad", "Seguridad"],
    ["respaldo", "Respaldo"]
  ];
  var TIPOS_SERIE = [
    ["factura", "Factura", /^F[A-Z0-9]{3}$/],
    ["boleta", "Boleta", /^B[A-Z0-9]{3}$/],
    ["nota_credito", "Nota de crédito", /^[FB][A-Z0-9]{3}$/],
    ["nota_debito", "Nota de débito", /^[FB][A-Z0-9]{3}$/],
    ["guia_remision", "Guía de remisión", /^T[A-Z0-9]{3}$/]
  ];
  var REGIMENES = [
    ["general", "Régimen General (IGV 18%)"],
    ["mype", "Régimen MYPE Tributario"],
    ["rer", "Régimen Especial (RER)"],
    ["rus", "Nuevo RUS (solo boletas, sin IGV)"]
  ];
  async function vistaConfig(cont, partes) {
    const actual = SECCIONES.some((s) => s[0] === partes[0]) ? partes[0] : "empresa";
    cont.innerHTML = `
    <h1 class="page-title">Configuración</h1>
    <nav class="tabs" aria-label="Secciones de configuración">
      ${SECCIONES.map(([id, t]) => `<a href="#/config/${id}" class="tab ${id === actual ? "is-active" : ""}" ${id === actual ? 'aria-current="page"' : ""}>${esc(t)}</a>`).join("")}
    </nav>
    <div id="cfg-body"></div>`;
    $(".tab.is-active", cont)?.scrollIntoView({ block: "nearest", inline: "center" });
    const cuerpo = $("#cfg-body", cont);
    await RENDER[actual](cuerpo);
  }
  async function cargar(cuerpo, fn) {
    cuerpo.innerHTML = '<p class="loading">Consultando la API…</p>';
    try {
      return await fn();
    } catch (e) {
      cuerpo.innerHTML = `
      <div class="notice notice-error">
        <p><strong>${esc(e.message)}</strong></p>
        ${(e.detalle?.() || []).map((l) => `<p>${esc(l)}</p>`).join("")}
        ${e.red ? '<p class="small">Si la API está en línea, puede ser un bloqueo CORS: en ese caso hace falta el proxy descrito en el plan.</p>' : ""}
      </div>`;
      return null;
    }
  }
  function kv(obj, omitir = []) {
    if (!obj || typeof obj !== "object") return vacioMsg("Sin datos.");
    const filas = Object.entries(obj).filter(([k, v]) => !omitir.includes(k) && (v === null || ["string", "number", "boolean"].includes(typeof v)));
    if (!filas.length) return vacioMsg("Sin datos simples para mostrar.");
    return `<dl class="kv">${filas.map(([k, v]) => `<div><dt>${esc(k.replace(/_/g, " "))}</dt><dd>${esc(v === null ? "—" : String(v))}</dd></div>`).join("")}</dl>`;
  }
  var lista = (v) => Array.isArray(v) ? v.join(", ") : v || "";
  var separar = (txt) => String(txt || "").split(",").map((s) => s.trim()).filter(Boolean);
  async function empresa(cuerpo) {
    const r = await cargar(cuerpo, () => api.empresa());
    if (!r) return;
    const e = r.datos?.empresa || r.datos || {};
    sincronizarEmpresa(e);
    const prod = e.entorno === "production";
    cuerpo.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>${esc(e.razon_social || "Empresa")}</h2>
        <span class="pill ${prod ? "pill-prod" : ""}">${prod ? "Producción" : "Beta"}</span>
      </div>
      <p class="muted">RUC ${esc(e.ruc || "—")} · el RUC no se cambia desde aquí.</p>

      <form id="f-empresa" class="form-grid" novalidate>
        ${campo({ nombre: "razon_social", etiqueta: "Razón social", valor: e.razon_social, req: true })}
        ${campo({ nombre: "nombre_comercial", etiqueta: "Nombre comercial", valor: e.nombre_comercial, ayuda: "Aparece en el menú y en los comprobantes." })}
        ${campo({ nombre: "direccion", etiqueta: "Dirección fiscal", valor: e.direccion, req: true })}
        ${campo({ nombre: "ubigeo", etiqueta: "Ubigeo", valor: e.ubigeo, req: true, attrs: 'inputmode="numeric" maxlength="6" pattern="[0-9]{6}"', ayuda: "6 dígitos, por ejemplo 150101." })}
        ${campo({ nombre: "departamento", etiqueta: "Departamento", valor: e.departamento })}
        ${campo({ nombre: "provincia", etiqueta: "Provincia", valor: e.provincia })}
        ${campo({ nombre: "distrito", etiqueta: "Distrito", valor: e.distrito })}
        ${campo({ nombre: "telefonos", etiqueta: "Teléfonos", valor: lista(e.telefonos), ayuda: "Separados por coma." })}
        ${campo({ nombre: "emails", etiqueta: "Correos", valor: lista(e.emails), ayuda: "Separados por coma." })}
        ${campo({ nombre: "mensaje_agradecimiento", etiqueta: "Mensaje en el comprobante", valor: e.mensaje_agradecimiento })}
        <div class="form-actions span-all">
          <button class="btn btn-primary" type="submit">Guardar cambios</button>
        </div>
      </form>
    </section>

    <section class="panel">
      <h2>Credenciales GRE (guías de remisión)</h2>
      <p class="muted">Solo se necesitan para emitir guías. Déjalos vacíos si no cambian.</p>
      <form id="f-gre" class="form-grid" novalidate>
        ${campo({ nombre: "client_id", etiqueta: "Client ID" })}
        ${campo({ nombre: "client_secret", etiqueta: "Client secret", tipo: "password", attrs: 'autocomplete="off"' })}
        <div class="form-actions span-all"><button class="btn" type="submit">Guardar credenciales GRE</button></div>
      </form>
    </section>

    <section class="panel">
      <h2>Entorno SUNAT</h2>
      <p class="muted">En <strong>beta</strong> los comprobantes son de prueba. En <strong>producción</strong> cada comprobante es real y tiene efectos tributarios.</p>
      <div class="row-actions">
        <button class="btn ${prod ? "" : "btn-danger"}" id="btn-entorno" type="button">
          ${prod ? "Volver a beta" : "Pasar a producción"}
        </button>
      </div>
    </section>
    ${crudo(r.crudo)}`;
    const form = $("#f-empresa", cuerpo);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = leerForm(form);
      if (!d.razon_social || !d.direccion) return toast("Razón social y dirección son obligatorias.", "warn");
      if (!/^\d{6}$/.test(d.ubigeo)) return toast("El ubigeo debe tener 6 dígitos.", "warn");
      const datos = { ...d, telefonos: separar(d.telefonos), emails: separar(d.emails) };
      const malos = datos.emails.filter((m) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m));
      if (malos.length) return toast(`Correo inválido: ${malos.join(", ")}`, "warn");
      if (e.ruc) datos.ruc = e.ruc;
      await conCarga(form.querySelector("[type=submit]"), async () => {
        try {
          const res = await api.actualizarEmpresa(datos);
          sincronizarEmpresa(res.datos?.empresa || res.datos || datos);
          toast(res.mensaje || "Datos de la empresa actualizados.", "ok");
        } catch (err) {
          toastError(err);
        }
      });
    });
    const gre = $("#f-gre", cuerpo);
    gre.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = leerForm(gre, { omitirVacios: true });
      if (!d.client_id || !d.client_secret) return toast("Completa Client ID y Client secret.", "warn");
      await conCarga(gre.querySelector("[type=submit]"), async () => {
        try {
          await api.actualizarEmpresa(d);
          gre.reset();
          toast("Credenciales GRE guardadas.", "ok");
        } catch (err) {
          toastError(err);
        }
      });
    });
    $("#btn-entorno", cuerpo).addEventListener("click", async (ev) => {
      const nuevo = prod ? "beta" : "production";
      const ok = await confirmar(
        nuevo === "production" ? "Pasar a producción" : "Volver a beta",
        nuevo === "production" ? "Desde ahora cada comprobante será real ante SUNAT. Verifica antes que el certificado y la clave SOL sean los reales del cliente." : "Los comprobantes que emitas serán de prueba.",
        nuevo === "production" ? "Sí, pasar a producción" : "Volver a beta",
        nuevo === "production"
      );
      if (!ok) return;
      await conCarga(ev.currentTarget, async () => {
        try {
          await api.actualizarEmpresa({ entorno: nuevo });
          store.setConfig({ entorno: nuevo });
          toast(`Entorno cambiado a ${nuevo === "production" ? "producción" : "beta"}.`, "ok");
          await empresa(cuerpo);
        } catch (err) {
          toastError(err);
        }
      });
    });
  }
  async function documentos(cuerpo) {
    cuerpo.innerHTML = `
    <section class="panel">
      <h2>Logo</h2>
      <p class="muted">PNG o JPG. Aparece en los PDF de los comprobantes.</p>
      <form id="f-logo" class="form-grid" novalidate>
        <label class="field span-all">
          <span class="field-label">Archivo de logo <b>*</b></span>
          <input type="file" name="logo" accept="image/png,image/jpeg" required>
        </label>
        <div class="form-actions span-all"><button class="btn btn-primary" type="submit">Subir logo</button></div>
      </form>
    </section>

    <section class="panel">
      <h2>Certificado digital</h2>
      <p class="muted">Archivo .pfx o .p12. Se renueva cada año; reemplázalo antes de que venza.</p>
      <form id="f-cert" class="form-grid" novalidate>
        <label class="field">
          <span class="field-label">Certificado <b>*</b></span>
          <input type="file" name="certificado" accept=".pfx,.p12,application/x-pkcs12" required>
        </label>
        ${campo({ nombre: "contrasena_certificado", etiqueta: "Contraseña del certificado", tipo: "password", req: true, attrs: 'autocomplete="off"' })}
        <div class="form-actions span-all"><button class="btn btn-primary" type="submit">Subir certificado</button></div>
      </form>
    </section>`;
    const fLogo = $("#f-logo", cuerpo);
    fLogo.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const archivo = $("[name=logo]", fLogo).files[0];
      if (!archivo) return toast("Elige una imagen.", "warn");
      if (!/image\/(png|jpeg)/.test(archivo.type)) return toast("El logo debe ser PNG o JPG.", "warn");
      if (archivo.size > 2 * 1024 * 1024) return toast("El logo pesa más de 2 MB.", "warn");
      const fd = new FormData();
      fd.append("logo", archivo);
      await conCarga(fLogo.querySelector("[type=submit]"), async () => {
        try {
          const r = await api.subirLogo(fd);
          fLogo.reset();
          toast(r.mensaje || "Logo actualizado.", "ok");
        } catch (e) {
          toastError(e);
        }
      });
    });
    const fCert = $("#f-cert", cuerpo);
    fCert.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const archivo = $("[name=certificado]", fCert).files[0];
      const clave2 = $("[name=contrasena_certificado]", fCert).value;
      if (!archivo || !clave2) return toast("Elige el certificado y escribe su contraseña.", "warn");
      if (!/\.(pfx|p12)$/i.test(archivo.name)) return toast("El certificado debe ser .pfx o .p12.", "warn");
      const fd = new FormData();
      fd.append("certificado", archivo);
      fd.append("contrasena_certificado", clave2);
      await conCarga(fCert.querySelector("[type=submit]"), async () => {
        try {
          const r = await api.subirCertificado(fd);
          fCert.reset();
          toast(r.mensaje || "Certificado actualizado.", "ok");
        } catch (e) {
          toastError(e);
        }
      });
    });
  }
  async function regimen(cuerpo) {
    const r = await cargar(cuerpo, () => api.empresa());
    if (!r) return;
    const e = r.datos?.empresa || r.datos || {};
    sincronizarEmpresa(e);
    const actual = e.tax_regime || "general";
    cuerpo.innerHTML = `
    <section class="panel">
      <h2>Régimen tributario</h2>
      <p class="muted">Tasa IGV vigente según la API: <strong>${esc(e.tasa_igv_vigente ?? "—")}${e.tasa_igv_vigente != null ? "%" : ""}</strong>. Confirma el régimen con el contador del negocio.</p>
      <form id="f-reg" class="form-grid" novalidate>
        ${selector({ nombre: "tax_regime", etiqueta: "Régimen", opciones: REGIMENES, valor: actual, req: true })}
        <div id="nrus-box" ${actual === "rus" ? "" : "hidden"}>
          ${selector({ nombre: "nrus_categoria", etiqueta: "Categoría NRUS", opciones: [["1", "Categoría 1"], ["2", "Categoría 2"]], valor: e.nrus_categoria || "1" })}
        </div>
        <div class="form-actions span-all"><button class="btn btn-primary" type="submit">Guardar régimen</button></div>
      </form>
    </section>

    <section class="panel">
      <h2>Tasa IGV manual (avanzado)</h2>
      <p class="muted">Solo para casos especiales: ignora el régimen y fuerza la tasa. Déjalo vacío para usar la tasa del régimen.</p>
      <form id="f-igv" class="form-grid" novalidate>
        ${campo({ nombre: "igv_rate_override", etiqueta: "Tasa IGV (%)", valor: e.igv_rate_override ?? "", tipo: "number", attrs: 'min="0" max="18" step="0.5"' })}
        <div class="form-actions span-all"><button class="btn" type="submit">Guardar tasa</button></div>
      </form>
    </section>
    ${crudo(r.crudo)}`;
    const fReg = $("#f-reg", cuerpo);
    $("[name=tax_regime]", fReg).addEventListener("change", () => {
      $("#nrus-box", cuerpo).hidden = $("[name=tax_regime]", fReg).value !== "rus";
    });
    fReg.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = leerForm(fReg);
      const datos = { tax_regime: d.tax_regime };
      if (d.tax_regime === "rus") datos.nrus_categoria = d.nrus_categoria;
      if (d.tax_regime === "rus" && !await confirmar("Nuevo RUS", "En NRUS solo se emiten boletas, sin IGV. Las facturas y notas quedarán deshabilitadas.", "Cambiar a NRUS")) return;
      await conCarga(fReg.querySelector("[type=submit]"), async () => {
        try {
          await api.actualizarEmpresa(datos);
          store.setConfig({ tax_regime: d.tax_regime });
          toast("Régimen actualizado.", "ok");
          await regimen(cuerpo);
        } catch (err) {
          toastError(err);
        }
      });
    });
    const fIgv = $("#f-igv", cuerpo);
    fIgv.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const v = $("[name=igv_rate_override]", fIgv).value.trim();
      const n = v === "" ? null : Number(v);
      if (n !== null && (isNaN(n) || n < 0 || n > 18)) return toast("La tasa debe estar entre 0 y 18.", "warn");
      await conCarga(fIgv.querySelector("[type=submit]"), async () => {
        try {
          await api.actualizarEmpresa({ igv_rate_override: n });
          toast("Tasa IGV actualizada.", "ok");
          await regimen(cuerpo);
        } catch (err) {
          toastError(err);
        }
      });
    });
  }
  async function sucursales(cuerpo) {
    const r = await cargar(cuerpo, () => api.sucursales());
    if (!r) return;
    const items = comoLista(r.datos);
    const porDefecto = store.config().sucursal_id;
    cuerpo.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>Sucursales</h2>
        <button class="btn btn-primary" id="btn-suc-nueva" type="button">Nueva sucursal</button>
      </div>
      <p class="muted">El establecimiento principal usa el código <code>0000</code>. La sucursal por defecto es la que usará el punto de venta.</p>
      ${tablaDatos({
      filas: items,
      vacio: "Aún no hay sucursales. Crea la principal con código 0000.",
      columnas: [
        { titulo: "Sucursal", celda: (s) => `<strong>${esc(s.nombre || "Sin nombre")}</strong>${s.es_principal ? '<span class="sub">Principal</span>' : ""}` },
        { titulo: "Código", clase: "nw", celda: (s) => `<span class="font-id">${esc(s.cod_local || "—")}</span>` },
        { titulo: "Dirección", sec: true, celda: (s) => esc(s.direccion || "") },
        { titulo: "POS", celda: (s) => String(s.id) === String(porDefecto) ? '<span class="pill pill-ok">Por defecto</span>' : '<span class="muted">—</span>' },
        { titulo: "", clase: "col-acciones", celda: (s) => `<span class="acciones-fila">
              ${String(s.id) === String(porDefecto) ? "" : `<button class="btn btn-sm" data-defecto="${esc(s.id)}" type="button">Usar en POS</button>`}
              <button class="btn btn-sm" data-editar="${esc(s.id)}" type="button">Editar</button>
              <button class="btn btn-sm btn-ghost-danger" data-borrar="${esc(s.id)}" type="button">Eliminar</button>
            </span>` }
      ]
    })}
    </section>
    ${crudo(r.crudo)}`;
    const porId = (id) => items.find((s) => String(s.id) === String(id));
    $("#btn-suc-nueva", cuerpo).addEventListener("click", () => formSucursal(cuerpo, null, items.length === 0));
    $$("[data-editar]", cuerpo).forEach((b) => b.addEventListener("click", () => formSucursal(cuerpo, porId(b.dataset.editar))));
    $$("[data-defecto]", cuerpo).forEach((b) => b.addEventListener("click", () => {
      store.setConfig({ sucursal_id: Number(b.dataset.defecto) || b.dataset.defecto });
      toast("Sucursal por defecto actualizada.", "ok");
      sucursales(cuerpo);
    }));
    $$("[data-borrar]", cuerpo).forEach((b) => b.addEventListener("click", async () => {
      const s = porId(b.dataset.borrar);
      if (!await confirmar("Eliminar sucursal", `¿Eliminar "${s?.nombre || ""}"? Si tiene series o comprobantes, la API puede rechazarlo.`, "Eliminar", true)) return;
      await conCarga(b, async () => {
        try {
          await api.eliminarSucursal(s.id);
          if (String(store.config().sucursal_id) === String(s.id)) store.setConfig({ sucursal_id: null });
          toast("Sucursal eliminada.", "ok");
          await sucursales(cuerpo);
        } catch (e) {
          toastError(e);
        }
      });
    }));
  }
  function formSucursal(cuerpo, s, primera = false) {
    const d = modal({
      titulo: s ? "Editar sucursal" : "Nueva sucursal",
      contenido: `
      <div class="form-grid" id="f-suc">
        ${campo({ nombre: "nombre", etiqueta: "Nombre", valor: s?.nombre || (primera ? "Principal" : ""), req: true })}
        ${campo({ nombre: "cod_local", etiqueta: "Código de establecimiento", valor: s?.cod_local || (primera ? "0000" : ""), req: true, attrs: 'inputmode="numeric" maxlength="4" pattern="[0-9]{4}"', ayuda: "4 dígitos. Principal = 0000." })}
        ${campo({ nombre: "direccion", etiqueta: "Dirección", valor: s?.direccion, req: true })}
        ${campo({ nombre: "ubigeo", etiqueta: "Ubigeo", valor: s?.ubigeo || store.config().ubigeo || "", req: true, attrs: 'inputmode="numeric" maxlength="6"' })}
        ${campo({ nombre: "telefono", etiqueta: "Teléfono", valor: s?.telefono })}
        ${campo({ nombre: "email", etiqueta: "Correo", valor: s?.email, tipo: "email" })}
        <label class="check span-all"><input type="checkbox" name="es_principal" ${s?.es_principal || primera ? "checked" : ""}> Es el establecimiento principal</label>
      </div>`,
      acciones: '<button class="btn" value="cancelar">Cancelar</button><button class="btn btn-primary" value="ok" id="btn-suc-ok">Guardar</button>'
    });
    $("#btn-suc-ok", d).addEventListener("click", async (ev) => {
      ev.preventDefault();
      const caja = $("#f-suc", d);
      const datos = {};
      $$("input", caja).forEach((i) => {
        datos[i.name] = i.type === "checkbox" ? i.checked : i.value.trim();
      });
      if (!datos.nombre || !datos.direccion) return toast("Nombre y dirección son obligatorios.", "warn");
      if (!/^\d{4}$/.test(datos.cod_local)) return toast("El código debe tener 4 dígitos.", "warn");
      if (!/^\d{6}$/.test(datos.ubigeo)) return toast("El ubigeo debe tener 6 dígitos.", "warn");
      if (!datos.telefono) delete datos.telefono;
      if (!datos.email) delete datos.email;
      await conCarga(ev.currentTarget, async () => {
        try {
          const r = s ? await api.actualizarSucursal(s.id, datos) : await api.crearSucursal(datos);
          const nueva = r.datos?.sucursal || r.datos;
          if (!s && !store.config().sucursal_id && nueva?.id) store.setConfig({ sucursal_id: nueva.id });
          cerrarModal();
          toast(s ? "Sucursal actualizada." : "Sucursal creada.", "ok");
          await sucursales(cuerpo);
        } catch (e) {
          toastError(e);
        }
      });
    });
  }
  async function series(cuerpo) {
    const r = await cargar(cuerpo, async () => {
      const [ser, suc] = await Promise.all([api.series(), api.sucursales()]);
      return { ser, suc };
    });
    if (!r) return;
    const items = comoLista(r.ser.datos);
    const sucs = comoLista(r.suc.datos);
    const c = store.config();
    const nombreTipo = (t) => (TIPOS_SERIE.find((x) => x[0] === t) || [t, t])[1];
    const esActiva = (s) => {
      const v = s.activo ?? s.is_active;
      return v !== false && v !== 0;
    };
    const activas = (t) => items.filter((s) => s.tipo === t && esActiva(s));
    const elegir = (clave2, tipo, etiqueta2) => {
      const ops = activas(tipo).map((s) => [s.serie, s.serie]);
      return selector({ nombre: clave2, etiqueta: etiqueta2, opciones: [["", "—"], ...ops], valor: c[clave2] || "" });
    };
    cuerpo.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>Series registradas</h2>
        <button class="btn btn-primary" id="btn-ser-nueva" type="button" ${sucs.length ? "" : "disabled"}>Nueva serie</button>
      </div>
      ${sucs.length ? "" : '<p class="notice">Primero crea una sucursal.</p>'}
      <p class="muted">Las series no se eliminan: se desactivan. Facturas F, boletas B, notas FC/BC (crédito) y FD/BD (débito), guías T.</p>
      ${tablaDatos({
      filas: items,
      vacio: "Aún no hay series.",
      columnas: [
        { titulo: "Serie", celda: (s) => `<strong class="font-id">${esc(s.serie)}</strong>` },
        { titulo: "Tipo", celda: (s) => esc(nombreTipo(s.tipo)) },
        { titulo: "Sucursal", sec: true, celda: (s) => esc(s.sucursal?.nombre || sucs.find((x) => String(x.id) === String(s.sucursal_id ?? s.sucursal?.id))?.nombre || s.sucursal_id || "—") },
        { titulo: "Correlativo", sec: true, clase: "num", celda: (s) => esc(s.correlativo ?? s.correlativo_actual ?? "—") },
        { titulo: "Estado", celda: (s) => {
          const act = esActiva(s);
          return `<span class="pill ${act ? "pill-ok" : ""}">${act ? "Activa" : "Inactiva"}</span>`;
        } },
        { titulo: "", clase: "col-acciones", celda: (s) => {
          const act = esActiva(s);
          return `<button class="btn btn-sm" data-toggle="${esc(s.id)}" data-act="${act ? 1 : 0}" type="button">${act ? "Desactivar" : "Activar"}</button>`;
        } }
      ]
    })}
    </section>

    <section class="panel">
      <h2>Series por defecto en el punto de venta</h2>
      <form id="f-ser-def" class="form-grid" novalidate>
        ${elegir("serie_factura", "factura", "Factura")}
        ${elegir("serie_boleta", "boleta", "Boleta")}
        ${elegir("serie_nc_factura", "nota_credito", "NC de factura")}
        ${elegir("serie_nc_boleta", "nota_credito", "NC de boleta")}
        ${elegir("serie_nd_factura", "nota_debito", "ND de factura")}
        ${elegir("serie_nd_boleta", "nota_debito", "ND de boleta")}
        ${elegir("serie_guia", "guia_remision", "Guía de remisión")}
        <label class="check span-all"><input type="checkbox" name="boletas_por_resumen" ${c.boletas_por_resumen ? "checked" : ""}> Enviar boletas por resumen diario (quedan pendientes hasta enviar el resumen)</label>
        <div class="form-actions span-all"><button class="btn" type="submit">Guardar series por defecto</button></div>
      </form>
    </section>
    ${crudo(r.ser.crudo)}`;
    $("#btn-ser-nueva", cuerpo).addEventListener("click", () => formSeries(cuerpo, sucs, items));
    $$("[data-toggle]", cuerpo).forEach((b) => b.addEventListener("click", async () => {
      const activar = b.dataset.act !== "1";
      await conCarga(b, async () => {
        try {
          await api.actualizarSerie(b.dataset.toggle, { is_active: activar });
          toast(activar ? "Serie activada." : "Serie desactivada.", "ok");
          await series(cuerpo);
        } catch (e) {
          toastError(e);
        }
      });
    }));
    const fDef = $("#f-ser-def", cuerpo);
    fDef.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const d = leerForm(fDef);
      if (d.serie_factura && !/^F/.test(d.serie_factura)) return toast("La serie de factura debe empezar con F.", "warn");
      if (d.serie_boleta && !/^B/.test(d.serie_boleta)) return toast("La serie de boleta debe empezar con B.", "warn");
      if (d.serie_nc_factura && !/^F/.test(d.serie_nc_factura)) return toast("La NC de factura debe empezar con F.", "warn");
      if (d.serie_nc_boleta && !/^B/.test(d.serie_nc_boleta)) return toast("La NC de boleta debe empezar con B.", "warn");
      if (d.serie_nd_factura && !/^F/.test(d.serie_nd_factura)) return toast("La ND de factura debe empezar con F.", "warn");
      if (d.serie_nd_boleta && !/^B/.test(d.serie_nd_boleta)) return toast("La ND de boleta debe empezar con B.", "warn");
      d.boletas_por_resumen = $("[name=boletas_por_resumen]", fDef).checked;
      store.setConfig(d);
      toast("Series por defecto guardadas.", "ok");
    });
  }
  function formSeries(cuerpo, sucs, existentes) {
    const sucDef = store.config().sucursal_id || sucs[0]?.id;
    const sugeridas = [
      ["factura", "F001"],
      ["boleta", "B001"],
      ["nota_credito", "FC01"],
      ["nota_credito", "BC01"],
      ["nota_debito", "FD01"],
      ["nota_debito", "BD01"],
      ["guia_remision", "T001"]
    ].filter(([, s]) => !existentes.some((e) => e.serie === s));
    const fila = (tipo = "factura", serie = "") => `
    <div class="serie-row">
      ${selector({ nombre: "tipo", etiqueta: "Tipo", opciones: TIPOS_SERIE.map(([v, t]) => [v, t]), valor: tipo })}
      ${campo({ nombre: "serie", etiqueta: "Serie", valor: serie, attrs: 'maxlength="4" autocapitalize="characters"' })}
      <button class="icon-btn" type="button" data-quitar aria-label="Quitar fila">×</button>
    </div>`;
    const d = modal({
      titulo: "Nuevas series",
      contenido: `
      <div class="form-grid">
        ${selector({ nombre: "sucursal_id", etiqueta: "Sucursal", opciones: sucs.map((s) => [s.id, `${s.nombre} (${s.cod_local})`]), valor: sucDef, req: true })}
        ${campo({ nombre: "correlativo_inicial", etiqueta: "Correlativo inicial", valor: "0", tipo: "number", attrs: 'min="0" step="1"', ayuda: "0 = la primera será 1. Úsalo si migras desde otro sistema." })}
      </div>
      <div id="series-filas">${(sugeridas.length ? sugeridas : [["factura", ""]]).map(([t, s]) => fila(t, s)).join("")}</div>
      <button class="link-btn" type="button" id="btn-mas-serie">+ Agregar otra</button>`,
      acciones: '<button class="btn" value="cancelar">Cancelar</button><button class="btn btn-primary" value="ok" id="btn-ser-ok">Crear series</button>'
    });
    const filas = $("#series-filas", d);
    filas.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-quitar]")) ev.target.closest(".serie-row").remove();
    });
    $("#btn-mas-serie", d).addEventListener("click", () => filas.insertAdjacentHTML("beforeend", fila()));
    $("#btn-ser-ok", d).addEventListener("click", async (ev) => {
      ev.preventDefault();
      const sucursal_id = Number($("[name=sucursal_id]", d).value);
      const inicial = Number($("[name=correlativo_inicial]", d).value || 0);
      if (!Number.isInteger(inicial) || inicial < 0) return toast("El correlativo inicial debe ser un entero desde 0.", "warn");
      const lista2 = $$(".serie-row", d).map((f) => ({
        tipo: $("[name=tipo]", f).value,
        serie: $("[name=serie]", f).value.trim().toUpperCase(),
        sucursal_id
      })).filter((s) => s.serie);
      if (!lista2.length) return toast("Agrega al menos una serie.", "warn");
      for (const s of lista2) {
        const regla = TIPOS_SERIE.find((t) => t[0] === s.tipo)[2];
        if (!regla.test(s.serie)) return toast(`${s.serie} no es válida para ${s.tipo.replace("_", " ")}.`, "warn");
        if (existentes.some((e) => e.serie === s.serie)) return toast(`La serie ${s.serie} ya existe.`, "warn");
      }
      const repetidas = lista2.map((s) => s.serie).filter((s, i, a) => a.indexOf(s) !== i);
      if (repetidas.length) return toast(`Serie repetida: ${repetidas[0]}`, "warn");
      if (inicial > 0) lista2.forEach((s) => {
        s.correlativo_inicial = inicial;
      });
      await conCarga(ev.currentTarget, async () => {
        try {
          await api.crearSeries(lista2);
          cerrarModal();
          toast(`${lista2.length} serie(s) creada(s).`, "ok");
          await series(cuerpo);
        } catch (e) {
          toastError(e);
        }
      });
    });
  }
  async function credenciales2(cuerpo) {
    const cfg2 = window.APP_CONFIG || {};
    const proxy = modoProxy();
    const mascara = (k) => k ? `${k.slice(0, 6)}…${k.slice(-4)}` : "—";
    let actual = { url: "", key: "", origen: "", lista: false };
    if (proxy) {
      try {
        const s = await credencialesServidor();
        actual = { url: s.api_url || "", key: s.api_key || "", origen: "el servidor del sistema (servidor/.env)", lista: Boolean(s.configurado) };
      } catch (e) {
        actual = { url: "", key: "", origen: "el servidor del sistema", lista: Boolean(cfg2.API_CONFIGURADA), error: e };
      }
    } else {
      const c = configApi();
      const origen = origenCredenciales();
      actual = {
        url: c.API_URL || "",
        key: mascara(c.API_KEY),
        lista: Boolean(c.API_KEY && c.API_SECRET),
        origen: origen === "boveda" ? "la bóveda cifrada de este sistema" : "config.js, en texto plano",
        boveda: origen === "boveda",
        plano: origen === "config"
      };
    }
    const faltaPin = proxy && cfg2.PIN && !getPin();
    cuerpo.innerHTML = `
    ${proxy ? `
    <section class="panel">
      <h2>Este equipo</h2>
      <dl class="kv">
        <div><dt>PIN de este equipo</dt><dd>${cfg2.PIN ? getPin() ? "Guardado" : '<span class="text-danger">Falta</span>' : "No requerido"}</dd></div>
        <div><dt>Nombre del equipo</dt><dd>${esc(store.dispositivo())}</dd></div>
      </dl>
      <form class="form-grid" id="f-equipo" novalidate>
        ${cfg2.PIN ? campo({ nombre: "pin", etiqueta: "PIN de acceso", tipo: "password", attrs: 'autocomplete="off"', ayuda: "El que está en PIN_ACCESO del servidor. Se guarda solo en este equipo." }) : ""}
        ${campo({ nombre: "equipo", etiqueta: "Nombre del equipo", valor: store.dispositivo(), attrs: 'maxlength="30"', ayuda: "Identifica sus respaldos en el servidor. Ej.: caja, tablet, celular-ana." })}
        <div class="form-actions span-all"><button class="btn btn-primary" type="submit">Guardar en este equipo</button></div>
      </form>
    </section>` : ""}

    <section class="panel">
      <div class="panel-head">
        <h2>Credenciales de la API de facturación</h2>
        <span class="pill ${actual.lista ? "pill-ok" : "pill-warn"}">${actual.lista ? "Configuradas" : "Faltan"}</span>
      </div>
      <p class="muted">Escribe la API key y el API secret que te entregó tu proveedor de facturación electrónica. Primero prueba la conexión;
        al guardar, el sistema trae de la API los datos de tu empresa, la sucursal y las series por defecto.</p>
      ${actual.lista ? `
      <dl class="kv">
        <div><dt>URL de la API</dt><dd>${esc(actual.url || "—")}</dd></div>
        <div><dt>API key</dt><dd><code>${esc(actual.key || "—")}</code></dd></div>
        <div><dt>Guardadas en</dt><dd>${esc(actual.origen)}</dd></div>
      </dl>` : ""}
      ${faltaPin ? '<p class="notice">Primero guarda el PIN de este equipo (arriba): el servidor lo pide para cambiar las credenciales.</p>' : ""}
      <form class="form-grid" id="f-cred" novalidate autocomplete="off">
        <div class="span-all">${campo({ nombre: "url", etiqueta: "URL de la API", valor: actual.url || cfg2.API_URL_SUGERIDA || "https://sunat.kodevo.es/api/v1", req: true, attrs: 'inputmode="url" spellcheck="false"' })}</div>
        ${campo({ nombre: "key", etiqueta: "API key", req: true, attrs: 'spellcheck="false" autocomplete="off"' })}
        ${campo({ nombre: "secret", etiqueta: "API secret", tipo: "password", req: !actual.lista, attrs: 'autocomplete="new-password"', ayuda: actual.lista ? "Si solo pruebas o cambias la URL con la misma key, puedes dejarlo vacío." : "" })}
        <p class="form-error span-all" id="cred-error"></p>
        <div class="form-actions span-all">
          <button class="btn" type="button" id="btn-cred-probar">Probar conexión</button>
          <button class="btn btn-primary" type="submit">Guardar y cargar datos</button>
          ${actual.boveda ? '<button class="btn btn-ghost-danger" type="button" id="btn-cred-quitar">Quitar credenciales</button>' : ""}
        </div>
      </form>
      <div id="cred-prueba"></div>
      ${!proxy && actual.plano ? `<div class="notice notice-error"><p><strong>Las credenciales están en texto plano en config.js.</strong> Cualquiera que abra ese archivo puede emitir comprobantes a nombre de la empresa.</p>
        <p>Muévelas a la bóveda cifrada y luego borra API_KEY y API_SECRET de config.js.</p>
        <div class="row-actions"><button class="btn btn-primary btn-sm" type="button" id="btn-cred-mover">Mover a la bóveda cifrada</button></div></div>` : ""}
      ${!proxy && actual.boveda ? '<p class="notice notice-ok small">Cifradas con AES-256. Solo se descifran al ingresar con la contraseña de un usuario del sistema.</p>' : ""}
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>Datos traídos de la API</h2>
        <button class="btn btn-sm" type="button" id="btn-cred-sync" ${actual.lista ? "" : "disabled"}>Volver a cargar</button>
      </div>
      <p class="muted small">Última carga: <span id="cred-ultima">${esc(fecha(store.config().sincronizado_en))}</span>. Trae empresa, entorno, sucursal y series por defecto sin cambiar lo que elegiste a mano.</p>
      <div id="cred-sync"></div>
    </section>

    <section class="panel">
      <h2>Key en la API</h2>
      <div class="row-actions">
        <button class="btn" id="btn-cred-ver" type="button" ${actual.lista ? "" : "disabled"}>Consultar key en la API</button>
        <button class="btn btn-danger" id="btn-cred-regen" type="button" ${actual.lista ? "" : "disabled"}>Regenerar credenciales</button>
      </div>
      <div id="cred-res"></div>
    </section>

    <section class="panel">
      <details>
        <summary><strong>Registrar una empresa nueva en la API</strong></summary>
        <p class="muted">Solo para el alta inicial. Devuelve un par nuevo de key y secret; el sistema puede usarlo de inmediato. El secret no se puede recuperar después.</p>
        <form id="f-registro" class="form-grid" novalidate>
          ${campo({ nombre: "ruc", etiqueta: "RUC", req: true, attrs: 'inputmode="numeric" maxlength="11"' })}
          ${campo({ nombre: "razon_social", etiqueta: "Razón social", req: true })}
          ${campo({ nombre: "direccion", etiqueta: "Dirección fiscal", req: true })}
          ${campo({ nombre: "ubigeo", etiqueta: "Ubigeo", req: true, attrs: 'inputmode="numeric" maxlength="6"' })}
          ${campo({ nombre: "departamento", etiqueta: "Departamento", req: true })}
          ${campo({ nombre: "provincia", etiqueta: "Provincia", req: true })}
          ${campo({ nombre: "distrito", etiqueta: "Distrito", req: true })}
          ${campo({ nombre: "sol_user", etiqueta: "Usuario SOL", req: true, ayuda: "En beta: MODDATOS." })}
          ${campo({ nombre: "sol_pass", etiqueta: "Clave SOL", tipo: "password", req: true, attrs: 'autocomplete="off"' })}
          <label class="field">
            <span class="field-label">Certificado .pfx <b>*</b></span>
            <input type="file" name="certificado" accept=".pfx,.p12" required>
          </label>
          ${campo({ nombre: "contrasena_certificado", etiqueta: "Contraseña del certificado", tipo: "password", req: true, attrs: 'autocomplete="off"' })}
          ${selector({ nombre: "tax_regime", etiqueta: "Régimen", opciones: REGIMENES, valor: "general" })}
          ${selector({ nombre: "entorno", etiqueta: "Entorno", opciones: [["beta", "Beta (pruebas)"], ["production", "Producción"]], valor: "beta" })}
          ${campo({ nombre: "plan", etiqueta: "Plan", valor: "pro", ayuda: "Según tu acuerdo con el proveedor de la API." })}
          ${campo({ nombre: "client_id", etiqueta: "Client ID GRE", ayuda: "Opcional, para guías." })}
          ${campo({ nombre: "client_secret", etiqueta: "Client secret GRE", tipo: "password", attrs: 'autocomplete="off"' })}
          <div class="form-actions span-all"><button class="btn btn-primary" type="submit">Registrar empresa</button></div>
        </form>
      </details>
    </section>`;
    const res = $("#cred-res", cuerpo);
    const fCred = $("#f-cred", cuerpo);
    const errCred = $("#cred-error", fCred);
    const prueba = $("#cred-prueba", cuerpo);
    const datosForm = () => ({ url: $("[name=url]", fCred).value.trim(), key: $("[name=key]", fCred).value.trim(), secret: $("[name=secret]", fCred).value.trim() });
    $("#f-equipo", cuerpo)?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      const pin = $("[name=pin]", f)?.value.trim();
      if (pin !== void 0 && pin) setPin(pin);
      store.setDispositivo($("[name=equipo]", f).value);
      try {
        await api.empresa();
        toast("Guardado. Conexión con el servidor correcta.", "ok");
      } catch (e) {
        toastError(e);
      }
      await credenciales2(cuerpo);
    });
    $("#btn-cred-probar", cuerpo).addEventListener("click", (ev) => conCarga(ev.currentTarget, async () => {
      errCred.textContent = "";
      prueba.innerHTML = "";
      try {
        const r = await probarCredenciales(datosForm());
        const e = r.empresa || {};
        prueba.innerHTML = `<p class="notice notice-ok">Conexión correcta: <strong>${esc(e.razon_social || "empresa sin nombre")}</strong>${e.ruc ? ` · RUC ${esc(e.ruc)}` : ""} · ${e.entorno === "production" ? "producción" : "beta"}. Aún no se guardó: pulsa "Guardar y cargar datos".</p>`;
      } catch (e) {
        errCred.textContent = e.message;
      }
    }));
    fCred.addEventListener("submit", (ev) => {
      ev.preventDefault();
      errCred.textContent = "";
      prueba.innerHTML = "";
      conCarga(fCred.querySelector("[type=submit]"), async () => {
        try {
          await guardarCredenciales(datosForm());
          toast("Credenciales guardadas. Cargando los datos de la API…", "ok");
          await credenciales2(cuerpo);
          await sincronizarAhora($("#cred-sync", cuerpo));
        } catch (e) {
          errCred.textContent = e.message;
        }
      });
    });
    $("#btn-cred-mover", cuerpo)?.addEventListener("click", (ev) => conCarga(ev.currentTarget, async () => {
      const c = window.APP_CONFIG || {};
      try {
        await guardarCredenciales({ url: c.API_URL, key: c.API_KEY, secret: c.API_SECRET });
        toast("Credenciales cifradas en la bóveda. Ahora borra API_KEY y API_SECRET de config.js.", "ok", 9e3);
        await credenciales2(cuerpo);
      } catch (e) {
        toastError(e);
      }
    }));
    $("#btn-cred-quitar", cuerpo)?.addEventListener("click", async () => {
      if (!await confirmar("Quitar credenciales", "Se borran de la bóveda. El sistema no podrá emitir hasta que pongas otras.", "Quitar", true)) return;
      await borrarCredencialesBoveda();
      toast("Credenciales quitadas.", "ok");
      await credenciales2(cuerpo);
    });
    $("#btn-cred-sync", cuerpo).addEventListener("click", (ev) => conCarga(ev.currentTarget, () => sincronizarAhora($("#cred-sync", cuerpo))));
    $("#btn-cred-ver", cuerpo).addEventListener("click", (ev) => conCarga(ev.currentTarget, async () => {
      try {
        const r = await api.credenciales();
        res.innerHTML = kv(r.datos, ["api_secret"]) + crudo(r.crudo);
      } catch (e) {
        toastError(e);
      }
    }));
    $("#btn-cred-regen", cuerpo).addEventListener("click", async (ev) => {
      const ok = await confirmar(
        "Regenerar credenciales",
        "El par actual dejará de funcionar al instante. Podrás usar el nuevo de inmediato desde la ventana que aparece.",
        "Regenerar",
        true
      );
      if (!ok) return;
      await conCarga(ev.currentTarget, async () => {
        try {
          const r = await api.regenerarCredenciales();
          mostrarParNuevo(r.datos, r.crudo, actual.url, () => credenciales2(cuerpo));
        } catch (e) {
          toastError(e);
        }
      });
    });
    const fReg = $("#f-registro", cuerpo);
    fReg.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = leerForm(fReg, { omitirVacios: true });
      const cert = $("[name=certificado]", fReg).files[0];
      const faltan = ["ruc", "razon_social", "direccion", "ubigeo", "departamento", "provincia", "distrito", "sol_user", "sol_pass", "contrasena_certificado"].filter((k) => !d[k]);
      if (faltan.length || !cert) return toast("Completa todos los campos obligatorios y el certificado.", "warn");
      if (!validarRuc(d.ruc)) return toast("RUC inválido (11 dígitos con dígito verificador).", "warn");
      if (!/^\d{6}$/.test(d.ubigeo)) return toast("El ubigeo debe tener 6 dígitos.", "warn");
      const fd = new FormData();
      Object.entries(d).forEach(([k, v]) => fd.append(k, v));
      fd.append("certificado", cert);
      await conCarga(fReg.querySelector("[type=submit]"), async () => {
        try {
          const r = await api.registro(fd);
          fReg.reset();
          mostrarParNuevo(r.datos, r.crudo, actual.url || $("[name=url]", fCred).value.trim(), () => credenciales2(cuerpo));
        } catch (e) {
          toastError(e);
        }
      });
    });
  }
  async function sincronizarAhora(caja) {
    if (!caja) return;
    caja.innerHTML = '<p class="loading">Trayendo datos de la API…</p>';
    try {
      const pasos = await cargarDatosDeLaApi();
      const ultima = document.getElementById("cred-ultima");
      if (ultima) ultima.textContent = fecha(store.config().sincronizado_en);
      caja.innerHTML = `<ul class="checklist">${pasos.map((p) => `
      <li class="${p.ok ? "is-done" : ""}"><span class="dot" aria-hidden="true"></span>${esc(p.texto)}<span class="sr-only">${p.ok ? " (listo)" : " (pendiente)"}</span></li>`).join("")}</ul>`;
      toast(pasos.every((p) => p.ok) ? "Datos cargados desde la API." : "Datos cargados. Revisa lo pendiente.", pasos.every((p) => p.ok) ? "ok" : "warn");
    } catch (e) {
      caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
    }
  }
  function mostrarParNuevo(datos, crudoResp, url2, alUsar) {
    const key = datos?.api_key || datos?.credenciales?.api_key || "";
    const secret = datos?.api_secret || datos?.credenciales?.api_secret || "";
    const bloque = `API_KEY=${key}
API_SECRET=${secret}`;
    const d = modal({
      titulo: "Credenciales nuevas",
      contenido: `
      <p class="notice notice-error">El secret no se vuelve a mostrar. Úsalo ahora en este sistema o cópialo en un lugar seguro.</p>
      ${key ? `<pre class="code" id="par-nuevo">${esc(bloque)}</pre>` : "<p>La API no devolvió api_key/api_secret en el formato esperado. Revisa la respuesta:</p>"}
      ${crudo(crudoResp)}`,
      acciones: `${key ? '<button class="btn" type="button" id="btn-copiar">Copiar</button>' : ""}
      <button class="btn" value="ok">Cerrar</button>
      ${key && secret ? '<button class="btn btn-primary" type="button" id="btn-usar">Usar ahora en este sistema</button>' : ""}`
    });
    $("#btn-copiar", d)?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(bloque);
        toast("Copiado al portapapeles.", "ok");
      } catch {
        toast("No se pudo copiar automáticamente. Selecciona el texto y cópialo.", "warn");
      }
    });
    $("#btn-usar", d)?.addEventListener("click", (ev) => conCarga(ev.currentTarget, async () => {
      try {
        await guardarCredenciales({ url: url2 || configApi().API_URL, key, secret });
        d.close();
        toast("Credenciales nuevas en uso. Cargando datos de la API…", "ok");
        await alUsar?.();
        await sincronizarAhora(document.getElementById("cred-sync"));
      } catch (e) {
        toastError(e);
      }
    }));
  }
  async function plan(cuerpo) {
    const r = await cargar(cuerpo, async () => {
      const [sus, uso] = await Promise.allSettled([api.suscripcion(), api.uso()]);
      return { sus, uso };
    });
    if (!r) return;
    const bloque = (titulo, res) => res.status === "fulfilled" ? `<section class="panel"><h2>${titulo}</h2>${kv(res.value.datos?.suscripcion || res.value.datos)}${crudo(res.value.crudo)}</section>` : `<section class="panel"><h2>${titulo}</h2><div class="notice notice-error">${esc(res.reason?.message)}</div></section>`;
    cuerpo.innerHTML = `
    ${bloque("Suscripción", r.sus)}
    ${bloque("Uso del mes", r.uso)}
    <p class="muted small">El plan se contrata o cambia con el proveedor de la API, no desde este sistema.</p>`;
  }
  function usuarios(cuerpo) {
    const yo = auth.actual();
    const items = store.todos("usuarios");
    cuerpo.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>Usuarios del sistema</h2>
        <button class="btn btn-primary" id="btn-usr-nuevo" type="button">Nuevo usuario</button>
      </div>
      <p class="muted">El cajero vende y consulta comprobantes; no entra a Configuración ni anula comprobantes.</p>
      ${tablaDatos({
      filas: items,
      claseFila: (u) => u.activo ? "" : "fila-anulada",
      columnas: [
        { titulo: "Nombre", celda: (u) => `<strong>${esc(u.nombre)}</strong>${u.id === yo.id ? '<span class="sub">Tú</span>' : ""}` },
        { titulo: "Usuario", sec: true, celda: (u) => `<span class="font-id">@${esc(u.usuario)}</span>` },
        { titulo: "Rol", celda: (u) => esc(ROLES[u.rol] || u.rol) },
        { titulo: "Estado", sec: true, celda: (u) => `<span class="pill ${u.activo ? "pill-ok" : ""}">${u.activo ? "Activo" : "Inactivo"}</span>` },
        { titulo: "Contraseña", sec: true, celda: (u) => u.kdf === "pbkdf2" ? '<span class="pill pill-ok">Cifrado fuerte</span>' : '<span class="pill pill-warn">Antigua: se actualiza al ingresar</span>' },
        { titulo: "Credenciales API", sec: true, celda: (u) => !boveda.existe() ? '<span class="muted">—</span>' : boveda.tieneAcceso(u.id) ? '<span class="pill pill-ok">Con acceso</span>' : '<span class="pill pill-warn" title="Cámbiale la contraseña para darle acceso">Sin acceso</span>' },
        { titulo: "", clase: "col-acciones", celda: (u) => `<button class="btn btn-sm" data-usr="${u.id}" type="button">Editar</button>` }
      ]
    })}
    </section>`;
    $("#btn-usr-nuevo", cuerpo).addEventListener("click", () => formUsuario(cuerpo, null));
    $$("[data-usr]", cuerpo).forEach((b) => b.addEventListener("click", () => formUsuario(cuerpo, store.buscar("usuarios", Number(b.dataset.usr)))));
  }
  function formUsuario(cuerpo, u) {
    const d = modal({
      titulo: u ? `Editar a ${u.nombre}` : "Nuevo usuario",
      contenido: `
      <div class="form-grid" id="f-usr">
        ${campo({ nombre: "nombre", etiqueta: "Nombre", valor: u?.nombre, req: true })}
        ${u ? "" : campo({ nombre: "usuario", etiqueta: "Usuario", req: true, attrs: 'autocapitalize="none"' })}
        ${selector({ nombre: "rol", etiqueta: "Rol", opciones: Object.entries(ROLES), valor: u?.rol || "cajero" })}
        ${campo({ nombre: "clave", etiqueta: u ? "Nueva contraseña" : "Contraseña", tipo: "password", req: !u, attrs: 'autocomplete="new-password"', ayuda: u ? "Déjala vacía para no cambiarla. Mínimo 8 caracteres, con letras y números." : "Mínimo 8 caracteres, con letras y números." })}
        ${u ? `<label class="check span-all"><input type="checkbox" name="activo" ${u.activo ? "checked" : ""}> Usuario activo</label>` : ""}
      </div>`,
      acciones: '<button class="btn" value="cancelar">Cancelar</button><button class="btn btn-primary" value="ok" id="btn-usr-ok">Guardar</button>'
    });
    $("#btn-usr-ok", d).addEventListener("click", async (ev) => {
      ev.preventDefault();
      const caja = $("#f-usr", d);
      const v = (n) => $(`[name=${n}]`, caja);
      const datos = { nombre: v("nombre").value.trim(), rol: v("rol").value, clave: v("clave").value };
      if (!datos.nombre) return toast("Escribe el nombre.", "warn");
      await conCarga(ev.currentTarget, async () => {
        try {
          if (u) {
            const cambios = { nombre: datos.nombre, rol: datos.rol, activo: v("activo").checked };
            if (auth.quedariaSinAdmin(u.id, cambios)) throw new Error("Debe quedar al menos un administrador activo.");
            const errClave = datos.clave ? errorClave(datos.clave, u.usuario) : null;
            if (errClave) throw new Error(errClave);
            store.actualizar("usuarios", u.id, cambios);
            if (datos.clave) await auth.cambiarClave(u.id, datos.clave);
            if (!cambios.activo) boveda.quitarAcceso(u.id);
          } else {
            await auth.crearUsuario({ ...datos, usuario: v("usuario").value });
          }
          cerrarModal();
          toast("Usuario guardado.", "ok");
          if (u && u.id === auth.actual()?.id && datos.rol !== "admin") {
            location.hash = "#/inicio";
            return;
          }
          usuarios(cuerpo);
        } catch (e) {
          toast(e.message, "warn");
        }
      });
    });
  }
  function seguridad(cuerpo) {
    const usuariosT = store.todos("usuarios");
    const activos = usuariosT.filter((u) => u.activo);
    const antiguos = usuariosT.filter((u) => u.kdf !== "pbkdf2");
    const sinAcceso = boveda.tieneCredenciales() ? activos.filter((u) => !boveda.tieneAcceso(u.id)) : [];
    const origen = origenCredenciales();
    const cfg2 = store.config();
    const diasResp = cfg2.ultimo_respaldo_cifrado ? Math.floor((Date.now() - Date.parse(cfg2.ultimo_respaldo_cifrado)) / 864e5) : null;
    const csp = Boolean(document.querySelector('meta[http-equiv="Content-Security-Policy"]'));
    const minutos = minutosInactividad();
    const puntos = [
      origen === "boveda" || origen === "servidor" ? [true, origen === "servidor" ? "Credenciales de la API guardadas en el servidor." : "Credenciales de la API cifradas con AES-256 en la bóveda."] : origen === "config" ? [false, "Las credenciales de la API están en texto plano en config.js. Muévelas a la bóveda (Credenciales API) y bórralas del archivo.", "#/config/credenciales", "Mover"] : [false, "Faltan las credenciales de la API.", "#/config/credenciales", "Configurar"],
      antiguos.length ? [false, `${antiguos.length} usuario(s) con contraseña en el formato antiguo: se actualiza sola cuando ingresan (${antiguos.map((u) => u.usuario).join(", ")}).`] : [true, "Todas las contraseñas usan PBKDF2-SHA256 con 600 000 vueltas."],
      sinAcceso.length ? [false, `${sinAcceso.length} usuario(s) sin acceso a las credenciales: no podrán emitir. Cámbiales la contraseña en Usuarios (${sinAcceso.map((u) => u.usuario).join(", ")}).`, "#/config/usuarios", "Usuarios"] : [true, "Todos los usuarios activos pueden abrir las credenciales con su contraseña."],
      diasResp === null ? [false, "Aún no hay un respaldo cifrado de data.json.", "#/config/respaldo", "Respaldar"] : diasResp > 1 ? [false, `El último respaldo cifrado es de hace ${diasResp} días.`, "#/config/respaldo", "Respaldar"] : [true, `Respaldo cifrado reciente (${fecha(cfg2.ultimo_respaldo_cifrado)}).`],
      [csp, csp ? "Protección contra scripts inyectados (Content Security Policy) activa." : "Falta la Content Security Policy en index.html."],
      [true, "Bloqueo de 1 a 15 minutos tras 5 contraseñas incorrectas seguidas."],
      [true, `La sesión se cierra tras ${minutos} minutos sin actividad y, como máximo, a las 12 horas.`]
    ];
    const bloqueados = auth.bloqueados();
    cuerpo.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>Estado de seguridad</h2>
        <span class="pill ${puntos.every((p) => p[0]) ? "pill-ok" : "pill-warn"}">${puntos.filter((p) => p[0]).length} de ${puntos.length}</span>
      </div>
      <ul class="alertas">
        ${puntos.map(([ok, texto, enlace, accion]) => `
          <li class="alerta ${ok ? "" : "alerta-aviso"}">
            <span class="alerta-icono" aria-hidden="true">${icono(ok ? "exito" : "alerta")}</span>
            <span class="alerta-texto"><span class="sr-only">${ok ? "Correcto" : "Pendiente"}: </span>${esc(texto)}</span>
            ${!ok && enlace ? `<a class="btn btn-sm" href="${enlace}">${esc(accion)}</a>` : ""}
          </li>`).join("")}
      </ul>
    </section>

    <section class="panel">
      <h2>Cierre de sesión por inactividad</h2>
      <p class="muted">Si nadie toca el sistema durante este tiempo, la sesión se cierra y las credenciales vuelven a quedar cifradas.</p>
      <form class="form-grid" id="f-inactividad" novalidate>
        ${selector({ nombre: "minutos", etiqueta: "Cerrar sesión tras", opciones: [[5, "5 minutos"], [10, "10 minutos"], [15, "15 minutos"], [30, "30 minutos"], [60, "1 hora"], [120, "2 horas"]], valor: minutos })}
        <div class="form-actions span-all"><button class="btn btn-primary" type="submit">Guardar</button></div>
      </form>
    </section>

    <section class="panel">
      <h2>Usuarios bloqueados</h2>
      ${tablaDatos({
      filas: bloqueados,
      vacio: "Nadie está bloqueado por intentos fallidos.",
      columnas: [
        { titulo: "Usuario", celda: (b) => `<span class="font-id">${esc(b.login)}</span>` },
        { titulo: "Bloqueado hasta", clase: "nw", celda: (b) => esc(fecha(new Date(b.hasta).toISOString())) },
        { titulo: "", clase: "col-acciones", celda: (b) => `<button class="btn btn-sm" type="button" data-desbloquear="${esc(b.login)}">Desbloquear</button>` }
      ]
    })}
    </section>

    <section class="panel">
      <h2>Qué protege y qué no</h2>
      <p class="notice notice-info small">El sistema funciona sin servidor: todo vive en este navegador. Protege las credenciales y los respaldos con cifrado,
        las contraseñas con PBKDF2 y bloquea scripts inyectados. Pero alguien con acceso al equipo encendido y conocimientos técnicos
        podría saltarse los permisos desde las herramientas del navegador. Cuida el acceso físico: usa una cuenta de Windows con contraseña,
        cierra sesión al dejar la caja y no compartas el usuario administrador.</p>
    </section>`;
    $("#f-inactividad", cuerpo).addEventListener("submit", (ev) => {
      ev.preventDefault();
      store.setConfig({ inactividad_min: Number($("[name=minutos]", ev.currentTarget).value) });
      toast("Tiempo de inactividad guardado.", "ok");
      seguridad(cuerpo);
    });
    $$("[data-desbloquear]", cuerpo).forEach((b) => b.addEventListener("click", () => {
      auth.desbloquear(b.dataset.desbloquear);
      toast(`Usuario ${b.dataset.desbloquear} desbloqueado.`, "ok");
      seguridad(cuerpo);
    }));
  }
  function respaldo(cuerpo) {
    const r = store.resumen();
    cuerpo.innerHTML = `
    <section class="panel">
      <h2>Respaldo de data.json</h2>
      <p class="muted">Los datos de este sistema viven en este navegador. Si se borra el historial o cambias de equipo, se pierden: exporta <code>data.json</code> al final de cada día.</p>
      <dl class="stats">
        <div><dt>Clientes</dt><dd>${r.clientes}</dd></div>
        <div><dt>Productos</dt><dd>${r.productos}</dd></div>
        <div><dt>Ventas</dt><dd>${r.ventas}</dd></div>
        <div><dt>Comprobantes</dt><dd>${r.comprobantes}</dd></div>
      </dl>
      <p class="muted small">Último cambio: ${esc(fecha(r.actualizado_en))}</p>
      <div class="row-actions">
        <button class="btn btn-primary" id="btn-exportar" type="button">Exportar respaldo cifrado</button>
        <button class="btn" id="btn-exportar-plano" type="button">Exportar sin cifrar</button>
        <label class="btn">Importar data.json<input type="file" id="in-importar" accept=".json,application/json" hidden></label>
      </div>
      <p class="muted small">Importar reemplaza todos los datos de este navegador. Los comprobantes ya emitidos siguen guardados en la API.</p>
    </section>
    ${modoProxy() ? `
    <section class="panel">
      <div class="panel-head"><h2>Respaldo automático en el servidor</h2><button class="btn btn-sm" type="button" id="btn-resp-srv">Respaldar ahora</button></div>
      <p class="muted small">Este equipo (<strong>${esc(store.dispositivo())}</strong>) envía su copia al servidor un minuto después de cada cambio. Se guarda una copia por equipo y hora durante 30 días.
        Último envío: ${esc(fecha(store.ultimoRespaldoServidor()))}.</p>
      <div id="resp-srv"><p class="loading">Consultando…</p></div>
    </section>` : ""}`;
    if (modoProxy()) {
      const lista2 = $("#resp-srv", cuerpo);
      const cargarLista2 = async () => {
        try {
          const items = await respaldoServidor("GET");
          lista2.innerHTML = tablaDatos({
            filas: (items || []).slice(0, 40),
            vacio: "El servidor aún no tiene respaldos.",
            columnas: [
              { titulo: "Archivo", celda: (r3) => `<span class="font-id">${esc(r3.archivo)}</span>` },
              { titulo: "Fecha", sec: true, clase: "nw", celda: (r3) => esc(fecha(r3.modificado)) },
              { titulo: "Tamaño", sec: true, clase: "num", celda: (r3) => `${Math.ceil(r3.bytes / 1024)} KB` },
              { titulo: "", clase: "col-acciones", celda: (r3) => `<button class="btn btn-sm" type="button" data-resp="${esc(r3.archivo)}">Descargar</button>` }
            ]
          });
          $$("[data-resp]", lista2).forEach((b) => b.addEventListener("click", () => conCarga(b, async () => {
            try {
              const blob = await respaldoServidor("GET", `/${encodeURIComponent(b.dataset.resp)}`);
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `data-${b.dataset.resp}`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
            } catch (e) {
              toastError(e);
            }
          })));
        } catch (e) {
          lista2.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
        }
      };
      $("#btn-resp-srv", cuerpo).addEventListener("click", (ev) => conCarga(ev.currentTarget, async () => {
        try {
          const r3 = await store.respaldarServidor();
          toast(`Respaldo guardado en el servidor: ${r3?.archivo || ""}`, "ok");
          respaldo(cuerpo);
        } catch (e) {
          toastError(e);
        }
      }));
      cargarLista2();
    }
    $("#btn-exportar", cuerpo).addEventListener("click", async (ev) => {
      const clave2 = await pedirContrasena({
        titulo: "Exportar respaldo cifrado",
        texto: "El archivo solo se podrá abrir con esta contraseña. Guárdala en un lugar seguro: si la olvidas, el respaldo no se puede recuperar.",
        confirmar: true,
        validar: (c) => errorClave(c),
        textoOk: "Cifrar y descargar"
      });
      if (!clave2) return;
      await conCarga(ev.currentTarget, async () => {
        await store.exportar(clave2);
        toast("Respaldo cifrado descargado.", "ok");
      });
    });
    $("#btn-exportar-plano", cuerpo).addEventListener("click", async () => {
      const ok = await confirmar(
        "Exportar sin cifrar",
        "El archivo tendrá clientes, ventas y usuarios legibles por cualquiera que lo abra. Úsalo solo si lo vas a guardar en un lugar protegido.",
        "Exportar sin cifrar",
        true
      );
      if (!ok) return;
      await store.exportar();
      toast("data.json descargado (sin cifrar).", "warn");
    });
    $("#in-importar", cuerpo).addEventListener("change", async (ev) => {
      const archivo = ev.target.files[0];
      ev.target.value = "";
      if (!archivo) return;
      const ok = await confirmar("Importar data.json", `Se reemplazarán todos los datos actuales con "${archivo.name}". Exporta antes una copia si no estás seguro.`, "Importar y reemplazar", true);
      if (!ok) return;
      try {
        await store.importar(archivo, () => pedirContrasena({ titulo: "Respaldo cifrado", texto: `"${archivo.name}" está cifrado. Escribe la contraseña con la que se exportó.`, textoOk: "Descifrar e importar" }));
        toast("Datos importados. Vuelve a ingresar.", "ok");
        auth.salir();
        location.hash = "#/inicio";
        location.reload();
      } catch (e) {
        toast(e.message, "error", 7e3);
      }
    });
  }
  var RENDER = { empresa, documentos, regimen, sucursales, series, credenciales: credenciales2, plan, usuarios, seguridad, respaldo };

  // src/views/clientes.js
  var filtros3 = { q: "", tipo: "todos" };
  function aApi(c) {
    const d = {
      tipo_documento: c.tipo_doc,
      numero_documento: c.num_doc,
      razon_social: c.razon_social
    };
    for (const k of ["nombre_comercial", "direccion", "email", "telefono"]) if (c[k]) d[k] = c[k];
    return d;
  }
  function deApi(x) {
    return {
      tipo_doc: String(x.tipo_documento ?? x.tipo_doc ?? ""),
      num_doc: String(x.numero_documento ?? x.num_doc ?? ""),
      razon_social: x.razon_social ?? x.nombre ?? "",
      nombre_comercial: x.nombre_comercial || "",
      direccion: x.direccion || "",
      email: x.email || "",
      telefono: x.telefono || "",
      api_id: x.id ?? null
    };
  }
  var clave = (c) => `${c.tipo_doc}|${String(c.num_doc).toUpperCase()}`;
  function buscarClientes(q, lista2 = store.todos("clientes")) {
    const t = norm(q).trim();
    if (!t) return lista2;
    const partes = t.split(/\s+/);
    return lista2.filter((c) => {
      const texto = norm(`${c.num_doc} ${c.razon_social} ${c.nombre_comercial} ${c.mascota} ${c.telefono}`);
      return partes.every((x) => texto.includes(x));
    });
  }
  function clientePorDocumento(tipo, num) {
    return store.todos("clientes").find((c) => clave(c) === `${tipo}|${String(num).trim().toUpperCase()}`) || null;
  }
  function validarCliente(entrada, actual = null) {
    const d = {
      tipo_doc: String(entrada.tipo_doc || ""),
      num_doc: String(entrada.num_doc || "").trim().toUpperCase(),
      razon_social: String(entrada.razon_social || "").trim().replace(/\s+/g, " ").toUpperCase(),
      nombre_comercial: String(entrada.nombre_comercial || "").trim(),
      direccion: String(entrada.direccion || "").trim(),
      email: String(entrada.email || "").trim().toLowerCase(),
      telefono: String(entrada.telefono || "").trim(),
      mascota: String(entrada.mascota || "").trim()
    };
    const errDoc = errorDocumento(d.tipo_doc, d.num_doc);
    if (errDoc) return { error: errDoc };
    if (d.razon_social.length < 2) return { error: d.tipo_doc === "6" ? "Escribe la razón social." : "Escribe el nombre completo." };
    if (d.razon_social.length > 200) return { error: "El nombre no puede pasar de 200 caracteres." };
    if (d.email && !esEmail(d.email)) return { error: "El correo no es válido." };
    if (d.telefono && !/^[+\d\s()-]{6,20}$/.test(d.telefono)) return { error: "El teléfono no es válido." };
    const otro = clientePorDocumento(d.tipo_doc, d.num_doc);
    if (otro && otro.id !== actual?.id) return { error: `Ya existe un cliente con ${nombreTipoDoc(d.tipo_doc)} ${d.num_doc}: ${otro.razon_social}.` };
    if (d.tipo_doc !== "6") d.nombre_comercial = "";
    return { datos: d };
  }
  async function sincronizarCliente(c) {
    try {
      let apiId = c.api_id;
      if (apiId) {
        await api.actualizarCliente(apiId, aApi(c));
      } else {
        try {
          const r = await api.crearCliente(aApi(c));
          apiId = r.datos?.id ?? r.datos?.cliente?.id ?? null;
        } catch (e) {
          if (e.status !== 422 && e.status !== 409) throw e;
          const encontrado = await buscarEnApi(c);
          if (!encontrado) throw e;
          apiId = encontrado.id;
          await api.actualizarCliente(apiId, aApi(c));
        }
      }
      return store.actualizar("clientes", c.id, { api_id: apiId, pendiente_sync: false, error_sync: null });
    } catch (e) {
      store.actualizar("clientes", c.id, { pendiente_sync: true, error_sync: e.message });
      return null;
    }
  }
  async function buscarEnApi(c) {
    const r = await api.clientes({ buscar: c.num_doc });
    return comoLista(r.datos).map((x) => ({ ...deApi(x), id: x.id })).find((x) => clave(x) === clave(c)) || null;
  }
  async function guardarCliente(entrada, actual = null) {
    const { error, datos } = validarCliente(entrada, actual);
    if (error) throw new Error(error);
    const local = actual ? store.actualizar("clientes", actual.id, { ...datos, pendiente_sync: true }) : store.insertar("clientes", { ...datos, api_id: null, pendiente_sync: true });
    const sync = await sincronizarCliente(local);
    return { cliente: store.buscar("clientes", local.id), sincronizado: Boolean(sync) };
  }
  function formCliente({ cliente = null, inicial = {}, alGuardar = () => {
  } } = {}) {
    const c = cliente || inicial;
    const tipo = String(c.tipo_doc || "1");
    const usado = cliente && store.donde("ventas", (v2) => v2.cliente_id === cliente.id).length > 0;
    const d = modal({
      titulo: cliente ? "Editar cliente" : "Nuevo cliente",
      contenido: `
      <div class="form-grid" id="f-cli">
        ${selector({ nombre: "tipo_doc", etiqueta: "Tipo de documento", opciones: TIPOS_DOC, valor: tipo, req: true })}
        ${campo({ nombre: "num_doc", etiqueta: "Número", valor: c.num_doc, req: true, attrs: 'autocomplete="off" maxlength="15"' })}
        ${campo({ nombre: "razon_social", etiqueta: "Nombre completo", valor: c.razon_social, req: true, attrs: 'maxlength="200"' })}
        <div id="nc-box">${campo({ nombre: "nombre_comercial", etiqueta: "Nombre comercial", valor: c.nombre_comercial })}</div>
        ${campo({ nombre: "direccion", etiqueta: "Dirección", valor: c.direccion, ayuda: "Recomendada para facturas." })}
        ${campo({ nombre: "telefono", etiqueta: "Teléfono / WhatsApp", valor: c.telefono, tipo: "tel", attrs: 'inputmode="tel"' })}
        ${campo({ nombre: "email", etiqueta: "Correo", valor: c.email, tipo: "email", attrs: 'inputmode="email" autocapitalize="none"' })}
        ${campo({ nombre: "mascota", etiqueta: "Mascota (opcional)", valor: c.mascota, ayuda: "Solo referencia interna, no va al comprobante." })}
        <p class="form-error span-all" id="cli-error" role="alert"></p>
      </div>
      <p class="muted small">No hay consulta automática RENIEC/SUNAT: escribe el nombre como figura en el documento.</p>`,
      acciones: `
      ${cliente && auth.esAdmin() ? `<button class="btn btn-ghost-danger" type="button" id="btn-cli-borrar" ${usado ? 'disabled title="Tiene ventas registradas"' : ""}>Eliminar</button>` : ""}
      <span class="spacer"></span>
      <button class="btn" value="cancelar">Cancelar</button>
      <button class="btn btn-primary" value="ok" id="btn-cli-ok">Guardar</button>`
    });
    const f = $("#f-cli", d);
    const v = (n) => $(`[name=${n}]`, f);
    const error = $("#cli-error", d);
    const ajustarTipo = () => {
      const t = v("tipo_doc").value;
      $("#nc-box", f).hidden = t !== "6";
      v("razon_social").closest(".field").querySelector(".field-label").firstChild.textContent = t === "6" ? "Razón social" : "Nombre completo";
      const num = v("num_doc");
      num.inputMode = ["1", "6"].includes(t) ? "numeric" : "text";
      num.maxLength = t === "1" ? 8 : t === "6" ? 11 : 15;
      num.placeholder = t === "1" ? "8 dígitos" : t === "6" ? "11 dígitos" : "";
    };
    v("tipo_doc").addEventListener("change", () => {
      ajustarTipo();
      error.textContent = "";
    });
    v("num_doc").addEventListener("blur", () => {
      const msg = errorDocumento(v("tipo_doc").value, v("num_doc").value);
      error.textContent = v("num_doc").value && msg ? msg : "";
    });
    ajustarTipo();
    $("#btn-cli-ok", d).addEventListener("click", (ev) => {
      ev.preventDefault();
      const entrada = {};
      $$("input, select", f).forEach((i) => {
        entrada[i.name] = i.value;
      });
      const { error: msg } = validarCliente(entrada, cliente);
      if (msg) {
        error.textContent = msg;
        return;
      }
      conCarga(ev.currentTarget, async () => {
        try {
          const r = await guardarCliente(entrada, cliente);
          cerrarModal();
          toast(r.sincronizado ? cliente ? "Cliente actualizado." : "Cliente registrado." : 'Cliente guardado en el sistema. No se pudo enviar a la API; se reintentará con "Sincronizar".', r.sincronizado ? "ok" : "warn", 6e3);
          alGuardar(r.cliente);
        } catch (e) {
          error.textContent = e.message;
        }
      });
    });
    $("#btn-cli-borrar", d)?.addEventListener("click", async () => {
      cerrarModal();
      if (!await confirmar("Eliminar cliente", `¿Eliminar a ${cliente.razon_social}? También se eliminará en la API.`, "Eliminar", true)) return;
      try {
        if (cliente.api_id) await api.eliminarCliente(cliente.api_id).catch((e) => {
          if (e.status !== 404) throw e;
        });
        store.eliminar("clientes", cliente.id);
        toast("Cliente eliminado.", "ok");
        alGuardar(null);
      } catch (e) {
        toastError(e);
      }
    });
    (cliente ? v("razon_social") : v("num_doc")).focus();
    return d;
  }
  async function vistaClientes(cont) {
    const admin = auth.esAdmin();
    cont.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Clientes</h1>
      <div class="row-actions">
        ${admin ? '<button class="btn" id="btn-cli-importar" type="button">Traer de la API</button>' : ""}
        <button class="btn btn-primary" id="btn-cli-nuevo" type="button">Nuevo cliente</button>
      </div>
    </div>
    <div class="toolbar">
      <input type="search" id="cli-q" placeholder="Buscar por nombre, documento, teléfono o mascota" value="${esc(filtros3.q)}" aria-label="Buscar clientes">
      <select id="cli-tipo" aria-label="Tipo de documento">
        ${[["todos", "Todos"], ["1", "DNI"], ["6", "RUC"], ["otros", "Otros"]].map(([v, t]) => `<option value="${v}" ${filtros3.tipo === v ? "selected" : ""}>${t}</option>`).join("")}
      </select>
    </div>
    <div id="cli-sync"></div>
    <div id="cli-lista"></div>`;
    const pintar = () => pintarClientes(cont);
    $("#cli-q", cont).addEventListener("input", (ev) => {
      filtros3.q = ev.target.value;
      pintar();
    });
    $("#cli-tipo", cont).addEventListener("change", (ev) => {
      filtros3.tipo = ev.target.value;
      pintar();
    });
    $("#btn-cli-nuevo", cont).addEventListener("click", () => formCliente({ alGuardar: pintar }));
    $("#btn-cli-importar", cont)?.addEventListener("click", (ev) => importarDesdeApi(ev.currentTarget, pintar));
    pintar();
  }
  function pintarClientes(cont) {
    const todos = store.todos("clientes");
    const pendientes = todos.filter((c) => c.pendiente_sync || !c.api_id);
    $("#cli-sync", cont).innerHTML = pendientes.length ? `
    <div class="notice notice-row">
      <span>${pendientes.length} cliente(s) sin enviar a la API.</span>
      <button class="btn btn-sm" type="button" id="btn-cli-sync">Sincronizar</button>
    </div>` : "";
    $("#btn-cli-sync", cont)?.addEventListener("click", (ev) => conCarga(ev.currentTarget, async () => {
      let ok = 0;
      for (const c of pendientes) if (await sincronizarCliente(store.buscar("clientes", c.id))) ok++;
      toast(`${ok} de ${pendientes.length} sincronizados.`, ok === pendientes.length ? "ok" : "warn");
      pintarClientes(cont);
    }));
    let lista2 = todos;
    if (filtros3.tipo === "1" || filtros3.tipo === "6") lista2 = lista2.filter((c) => c.tipo_doc === filtros3.tipo);
    if (filtros3.tipo === "otros") lista2 = lista2.filter((c) => !["1", "6"].includes(c.tipo_doc));
    lista2 = buscarClientes(filtros3.q, lista2).sort((a, b) => a.razon_social.localeCompare(b.razon_social, "es"));
    const caja = $("#cli-lista", cont);
    if (!todos.length) {
      caja.innerHTML = `<div class="vacio">
      <p><strong>Aún no hay clientes.</strong></p>
      <p class="muted">Regístralos aquí o al momento de vender. Para boletas menores a S/ 700 no hace falta registrar al cliente.</p>
    </div>`;
      return;
    }
    const editar = (c) => formCliente({ cliente: store.buscar("clientes", c.id), alGuardar: () => pintarClientes(cont) });
    tablaLocal(caja, {
      filas: lista2,
      clave: `${filtros3.tipo}|${filtros3.q}`,
      vacio: "Ningún cliente coincide con la búsqueda.",
      alElegir: editar,
      columnas: [
        { titulo: "Cliente", celda: (c) => `<strong>${esc(c.razon_social)}</strong>${c.nombre_comercial ? `<span class="sub">${esc(c.nombre_comercial)}</span>` : ""}` },
        { titulo: "Documento", clase: "nw", celda: (c) => `${esc(nombreTipoDoc(c.tipo_doc))}<span class="sub font-id">${esc(c.num_doc)}</span>` },
        { titulo: "Mascota", sec: true, celda: (c) => esc(c.mascota || "") },
        { titulo: "Teléfono", sec: true, clase: "nw", celda: (c) => c.telefono ? `<span class="font-id">${esc(c.telefono)}</span>` : "" },
        { titulo: "Correo", sec: true, celda: (c) => esc(c.email || "") },
        { titulo: "API", sec: true, celda: (c) => c.pendiente_sync || !c.api_id ? `<span class="pill pill-warn" title="${esc(c.error_sync || "")}">Sin sincronizar</span>` : '<span class="pill pill-ok">Sincronizado</span>' },
        { titulo: "", clase: "col-acciones", celda: (c) => `<button class="btn btn-sm" type="button" data-cli="${c.id}">Editar</button>` }
      ],
      alPintar: (caja2) => $$("[data-cli]", caja2).forEach((b) => b.addEventListener("click", () => editar({ id: Number(b.dataset.cli) })))
    });
  }
  async function importarDesdeApi(boton, alTerminar) {
    await conCarga(boton, async () => {
      let pagina = 1, nuevos = 0, enlazados = 0, leidos = 0;
      try {
        for (; pagina <= 50; pagina++) {
          const r = await api.clientes({ por_pagina: 100, page: pagina });
          const items = comoLista(r.datos);
          leidos += items.length;
          for (const x of items) {
            const c = deApi(x);
            if (!c.tipo_doc || !c.num_doc) continue;
            const local = clientePorDocumento(c.tipo_doc, c.num_doc);
            if (local) {
              const cambios = { api_id: c.api_id, pendiente_sync: false };
              for (const k of ["razon_social", "nombre_comercial", "direccion", "email", "telefono"]) if (!local[k] && c[k]) cambios[k] = c[k];
              store.actualizar("clientes", local.id, cambios);
              enlazados++;
            } else {
              store.insertar("clientes", { ...c, mascota: "", pendiente_sync: false });
              nuevos++;
            }
          }
          if (!items.length || !hayMasPaginas(metaDe(r), pagina)) break;
        }
        toast(`Leídos ${leidos}: ${nuevos} nuevos, ${enlazados} enlazados con clientes existentes.`, "ok", 6e3);
        alTerminar();
      } catch (e) {
        toastError(e);
      }
    });
  }

  // src/views/vender.js
  var carrito = nuevoCarrito();
  var catalogo = { q: "", categoria: "todas" };
  function nuevoCarrito() {
    return { items: [], cliente: null, tipo: "03", forma_pago: "Contado", metodo_pago: "efectivo", recibido: "", cuotas: [], numCuotas: 2 };
  }
  function vaciar() {
    Object.assign(carrito, nuevoCarrito());
  }
  var esNrus = () => store.config().tax_regime === "rus";
  function vistaVender(cont) {
    if (esNrus() && carrito.tipo === "01") carrito.tipo = "03";
    cont.innerHTML = `
    <div class="pos">
      <section class="pos-catalog" aria-label="Productos">
        <div class="pos-search">
          <input type="search" id="pos-q" placeholder="Buscar producto o servicio" value="${esc(catalogo.q)}" autocomplete="off" aria-label="Buscar producto">
        </div>
        <div class="chips" id="pos-cats"></div>
        <div class="pos-grid" id="pos-grid"></div>
      </section>

      <aside class="pos-cart" id="pos-cart" aria-label="Venta actual"></aside>

      <div class="pos-bar" id="pos-bar">
        <span><strong id="bar-total">S/ 0.00</strong> <span class="muted small" id="bar-items"></span></span>
        <a class="btn btn-primary" href="#pos-cart" id="bar-ir">Cobrar</a>
      </div>
    </div>`;
    $("#pos-q", cont).addEventListener("input", (ev) => {
      catalogo.q = ev.target.value;
      pintarCatalogo(cont);
    });
    $("#pos-q", cont).addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      const primero = $("#pos-grid [data-add]", cont);
      if (primero) {
        primero.click();
        ev.target.select();
      }
    });
    $("#pos-cats", cont).addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-cat]");
      if (!b) return;
      catalogo.categoria = b.dataset.cat;
      pintarCatalogo(cont);
    });
    $("#pos-grid", cont).addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-add]");
      if (b) agregar(cont, Number(b.dataset.add));
    });
    $("#bar-ir", cont).addEventListener("click", (ev) => {
      ev.preventDefault();
      $("#pos-cart", cont).scrollIntoView({ behavior: "smooth", block: "start" });
    });
    pintarCatalogo(cont);
    pintarCarrito(cont);
    if (window.matchMedia?.("(min-width: 821px)").matches) $("#pos-q", cont).focus();
  }
  function pintarCatalogo(cont) {
    const cats = store.todos("categorias");
    const activos = productosActivos();
    $("#pos-cats", cont).innerHTML = [["todas", "Todos"], ...cats.filter((c) => activos.some((p) => p.categoria_id === c.id)).map((c) => [String(c.id), c.nombre])].map(([id, n]) => `<button type="button" class="chip ${catalogo.categoria === id ? "is-active" : ""}" data-cat="${esc(id)}">${esc(n)}</button>`).join("");
    let lista2 = activos;
    if (catalogo.categoria !== "todas") lista2 = lista2.filter((p) => String(p.categoria_id) === catalogo.categoria);
    lista2 = buscarProductos(catalogo.q, lista2).sort((a, b) => a.descripcion.localeCompare(b.descripcion, "es"));
    const grid = $("#pos-grid", cont);
    if (!activos.length) {
      grid.innerHTML = `<div class="empty-state"><p><strong>No hay productos activos.</strong></p>
      ${auth.esAdmin() ? '<a class="btn btn-primary" href="#/productos">Registrar productos</a>' : '<p class="muted">Pide al administrador que los registre.</p>'}</div>`;
      return;
    }
    if (!lista2.length) {
      grid.innerHTML = '<p class="empty">Sin resultados.</p>';
      return;
    }
    grid.innerHTML = lista2.slice(0, 60).map((p) => `
    <button type="button" class="pos-prod" data-add="${p.id}">
      <span class="pos-prod-name">${esc(p.descripcion)}</span>
      <span class="pos-prod-meta">
        <strong>${esc(soles(p.precio))}</strong>
        ${p.controla_stock ? `<span class="${Number(p.stock) <= 0 ? "text-danger" : "muted"}">Stock ${esc(p.stock)}</span>` : ""}
      </span>
    </button>`).join("");
  }
  function agregar(cont, productoId) {
    const p = store.buscar("productos", productoId);
    if (!p) return;
    const existente = carrito.items.find((i) => i.producto_id === p.id);
    if (existente) existente.cantidad = r2(existente.cantidad + 1);
    else {
      carrito.items.push({
        producto_id: p.id,
        codigo: p.codigo,
        descripcion: p.descripcion,
        unidad: p.unidad,
        precio: Number(p.precio),
        cantidad: 1,
        descuento: 0,
        tip_afe_igv: p.tip_afe_igv,
        cod_producto_sunat: p.cod_producto_sunat || ""
      });
    }
    const linea = carrito.items.find((i) => i.producto_id === p.id);
    if (p.controla_stock && linea.cantidad > Number(p.stock)) {
      toast(`Stock insuficiente de ${p.descripcion}: hay ${p.stock}.`, "warn", 3500);
    }
    pintarCarrito(cont);
  }
  function pintarCarrito(cont) {
    const caja = $("#pos-cart", cont);
    const nrus = esNrus();
    const tasa = tasaIgvLocal();
    const c = carrito.cliente;
    const esFactura = carrito.tipo === "01";
    if (!esFactura && carrito.forma_pago === "Credito") carrito.forma_pago = "Contado";
    caja.innerHTML = `
    <div class="cart-head">
      <h2>Venta</h2>
      ${carrito.items.length ? '<button class="link-btn" type="button" id="cart-vaciar">Vaciar</button>' : ""}
    </div>

    <div class="cart-block">
      <span class="block-label">Cliente</span>
      ${c ? `
        <div class="cliente-sel">
          <span><strong>${esc(c.razon_social)}</strong><span class="muted small">${esc(nombreTipoDoc(c.tipo_doc))} ${esc(c.num_doc)}</span></span>
          <button class="icon-btn" type="button" id="cli-quitar" aria-label="Quitar cliente">×</button>
        </div>` : `
        <div class="cliente-buscar">
          <div class="input-group">
            <input type="search" id="cli-q" placeholder="DNI, RUC o nombre" autocomplete="off" aria-label="Buscar cliente">
            <button class="btn" type="button" id="cli-nuevo">Nuevo</button>
          </div>
          <div class="search-results" id="cli-res"></div>
          <p class="muted small">Sin cliente: boleta a "Clientes varios" (solo menos de S/ ${LIMITE_BOLETA_SIN_DNI}).</p>
        </div>`}
    </div>

    <ul class="cart-items" id="cart-items">
      ${carrito.items.length ? carrito.items.map((it, i) => `
        <li class="cart-item" data-i="${i}">
          <div class="cart-item-top">
            <span class="cart-item-name">${esc(it.descripcion)}</span>
            <button class="icon-btn" type="button" data-quitar="${i}" aria-label="Quitar ${esc(it.descripcion)}">×</button>
          </div>
          <div class="cart-item-row">
            <div class="stepper">
              <button type="button" data-menos="${i}" aria-label="Menos">−</button>
              <input type="number" data-cant="${i}" value="${esc(it.cantidad)}" min="0" step="any" inputmode="decimal" aria-label="Cantidad">
              <button type="button" data-mas="${i}" aria-label="Más">+</button>
            </div>
            <span class="muted small">× ${esc(soles(it.precio))}</span>
            <strong class="cart-line" data-linea="${i}">${esc(soles(calcularLinea(it, tasa).importe))}</strong>
          </div>
          <label class="cart-desc">
            <span class="muted small">Descuento S/</span>
            <input type="number" data-desc="${i}" value="${it.descuento || ""}" min="0" step="0.01" inputmode="decimal" placeholder="0.00">
          </label>
        </li>`).join("") : '<li class="empty">Agrega productos o servicios desde la lista.</li>'}
    </ul>

    <div class="cart-block">
      <span class="block-label">Comprobante</span>
      <div class="segmented seg-3" role="radiogroup" aria-label="Comprobante">
        <label><input type="radio" name="tipo" value="03" ${carrito.tipo === "03" ? "checked" : ""}><span>Boleta</span></label>
        <label><input type="radio" name="tipo" value="01" ${esFactura ? "checked" : ""} ${nrus ? "disabled" : ""}><span>Factura</span></label>
        <label><input type="radio" name="tipo" value="ninguno" ${carrito.tipo === "ninguno" ? "checked" : ""}><span>Después</span></label>
      </div>
      ${carrito.tipo === "ninguno" ? '<p class="muted small">Se guarda la venta y el comprobante se emite luego desde Ventas.</p>' : ""}
      ${nrus ? '<p class="muted small">Nuevo RUS: solo boletas.</p>' : ""}
    </div>

    <div class="cart-block">
      <span class="block-label">Pago</span>
      ${esFactura ? `
        <div class="segmented" role="radiogroup" aria-label="Forma de pago">
          <label><input type="radio" name="forma" value="Contado" ${carrito.forma_pago === "Contado" ? "checked" : ""}><span>Contado</span></label>
          <label><input type="radio" name="forma" value="Credito" ${carrito.forma_pago === "Credito" ? "checked" : ""}><span>Crédito</span></label>
        </div>` : ""}
      ${carrito.forma_pago === "Credito" ? pintarCuotas() : `
        <div class="chips chips-wrap" role="radiogroup" aria-label="Método de pago">
          ${METODOS_PAGO.map(([v, t]) => `<button type="button" class="chip ${carrito.metodo_pago === v ? "is-active" : ""}" data-metodo="${v}" aria-pressed="${carrito.metodo_pago === v}">${t}</button>`).join("")}
        </div>
        ${carrito.metodo_pago === "efectivo" ? `
          <div class="vuelto">
            <label class="field"><span class="field-label">Recibido S/</span>
              <input type="number" id="recibido" value="${esc(carrito.recibido)}" min="0" step="0.10" inputmode="decimal" placeholder="Opcional"></label>
            <span class="vuelto-out" id="vuelto"></span>
          </div>` : ""}`}
    </div>

    <dl class="totals" id="totals"></dl>
    <p class="form-error" id="cart-error" role="alert"></p>
    <button class="btn btn-primary btn-block btn-lg" type="button" id="btn-cobrar" ${carrito.items.length ? "" : "disabled"}>
      ${carrito.tipo === "01" ? "Emitir factura" : carrito.tipo === "03" ? "Emitir boleta" : "Guardar venta"}
    </button>`;
    conectarCarrito(cont);
    pintarTotales(cont);
  }
  function pintarCuotas() {
    const total = calcularTotales(carrito.items, 0).total;
    if (!carrito.cuotas.length && total > 0) carrito.cuotas = generarCuotas(total, carrito.numCuotas);
    return `
    <div class="cuotas">
      <div class="input-group">
        <label class="field"><span class="field-label">Cuotas</span>
          <input type="number" id="num-cuotas" value="${carrito.numCuotas}" min="1" max="12" step="1" inputmode="numeric"></label>
        <button class="btn" type="button" id="btn-repartir">Repartir igual</button>
      </div>
      ${carrito.cuotas.map((q, i) => `
        <div class="cuota-row">
          <span class="muted small">${i + 1}</span>
          <input type="date" data-cfecha="${i}" value="${esc(q.fecha_pago)}" aria-label="Fecha cuota ${i + 1}">
          <input type="number" data-cmonto="${i}" value="${esc(q.monto)}" min="0" step="0.01" inputmode="decimal" aria-label="Monto cuota ${i + 1}">
        </div>`).join("")}
    </div>`;
  }
  function conectarCarrito(cont) {
    const caja = $("#pos-cart", cont);
    const repintar = () => pintarCarrito(cont);
    $("#cart-vaciar", caja)?.addEventListener("click", () => {
      vaciar();
      repintar();
    });
    $("#cli-quitar", caja)?.addEventListener("click", () => {
      carrito.cliente = null;
      repintar();
    });
    const q = $("#cli-q", caja);
    if (q) {
      const res = $("#cli-res", caja);
      q.addEventListener("input", () => {
        const t = q.value.trim();
        if (t.length < 2) {
          res.innerHTML = "";
          return;
        }
        const hallados = buscarClientes(t).slice(0, 6);
        res.innerHTML = hallados.length ? hallados.map((c) => `<button type="button" class="result" data-cli="${c.id}"><span><strong>${esc(c.razon_social)}</strong> <span class="muted small">${esc(c.num_doc)}</span></span></button>`).join("") : '<p class="muted small">No está registrado. Usa "Nuevo".</p>';
      });
      q.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          $("[data-cli]", res)?.click();
        }
      });
      res.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-cli]");
        if (!b) return;
        seleccionarCliente(store.buscar("clientes", Number(b.dataset.cli)));
        repintar();
      });
      $("#cli-nuevo", caja).addEventListener("click", () => {
        const t = q.value.trim();
        const inicial = /^\d{8}$/.test(t) ? { tipo_doc: "1", num_doc: t } : /^\d{11}$/.test(t) ? { tipo_doc: "6", num_doc: t } : t ? { tipo_doc: carrito.tipo === "01" ? "6" : "1", razon_social: t } : { tipo_doc: carrito.tipo === "01" ? "6" : "1" };
        formCliente({ inicial, alGuardar: (c) => {
          if (c) {
            seleccionarCliente(c);
            repintar();
          }
        } });
      });
    }
    $$("[name=tipo]", caja).forEach((r) => r.addEventListener("change", () => {
      carrito.tipo = r.value;
      if (carrito.tipo === "01" && carrito.cliente && carrito.cliente.tipo_doc !== "6") {
        toast("La factura requiere un cliente con RUC. Elige o registra uno.", "warn");
      }
      repintar();
    }));
    $$("[name=forma]", caja).forEach((r) => r.addEventListener("change", () => {
      carrito.forma_pago = r.value;
      carrito.cuotas = [];
      repintar();
    }));
    $$("[data-metodo]", caja).forEach((b) => b.addEventListener("click", () => {
      carrito.metodo_pago = b.dataset.metodo;
      repintar();
    }));
    caja.addEventListener("click", (ev) => {
      const menos = ev.target.closest("[data-menos]");
      const mas = ev.target.closest("[data-mas]");
      const quitar = ev.target.closest("[data-quitar]");
      if (menos) {
        const it = carrito.items[Number(menos.dataset.menos)];
        it.cantidad = r2(it.cantidad - 1);
        if (it.cantidad <= 0) carrito.items.splice(Number(menos.dataset.menos), 1);
        carrito.cuotas = [];
        repintar();
      } else if (mas) {
        agregar(cont, carrito.items[Number(mas.dataset.mas)].producto_id);
        carrito.cuotas = [];
      } else if (quitar) {
        carrito.items.splice(Number(quitar.dataset.quitar), 1);
        carrito.cuotas = [];
        repintar();
      }
    });
    caja.addEventListener("input", (ev) => {
      const t = ev.target;
      if (t.dataset.cant !== void 0) carrito.items[Number(t.dataset.cant)].cantidad = Number(t.value);
      else if (t.dataset.desc !== void 0) carrito.items[Number(t.dataset.desc)].descuento = Number(t.value) || 0;
      else if (t.id === "recibido") carrito.recibido = t.value;
      else if (t.dataset.cmonto !== void 0) carrito.cuotas[Number(t.dataset.cmonto)].monto = Number(t.value);
      else if (t.dataset.cfecha !== void 0) carrito.cuotas[Number(t.dataset.cfecha)].fecha_pago = t.value;
      else return;
      pintarTotales(cont);
    });
    caja.addEventListener("change", (ev) => {
      const t = ev.target;
      if (t.dataset.cant !== void 0) {
        const i = Number(t.dataset.cant);
        if (!(carrito.items[i].cantidad > 0)) carrito.items.splice(i, 1);
        carrito.cuotas = [];
        repintar();
      } else if (t.dataset.desc !== void 0) {
        carrito.cuotas = [];
        repintar();
      }
    });
    const num = $("#num-cuotas", caja);
    const repartir = () => {
      carrito.numCuotas = Math.min(12, Math.max(1, Math.round(Number(num.value) || 1)));
      carrito.cuotas = generarCuotas(calcularTotales(carrito.items, 0).total, carrito.numCuotas);
      repintar();
    };
    num?.addEventListener("change", repartir);
    $("#btn-repartir", caja)?.addEventListener("click", repartir);
    $("#btn-cobrar", caja).addEventListener("click", (ev) => cobrar(cont, ev.currentTarget));
  }
  function seleccionarCliente(c) {
    if (!c) return;
    carrito.cliente = {
      id: c.id,
      tipo_doc: c.tipo_doc,
      num_doc: c.num_doc,
      razon_social: c.razon_social,
      direccion: c.direccion || "",
      email: c.email || "",
      telefono: c.telefono || ""
    };
    if (c.tipo_doc === "6" && carrito.tipo === "03" && !esNrus()) carrito.tipo = "01";
  }
  function pintarTotales(cont) {
    const tasa = tasaIgvLocal();
    const t = calcularTotales(carrito.items, tasa);
    const filas = [];
    if (t.gravado) filas.push(["Op. gravadas", t.gravado]);
    if (t.exonerado) filas.push(["Op. exoneradas", t.exonerado]);
    if (t.inafecto) filas.push(["Op. inafectas", t.inafecto]);
    if (t.igv) filas.push([`IGV ${tasa}%`, t.igv]);
    if (t.descuentos) filas.push(["Descuentos incluidos", -t.descuentos]);
    $("#totals", cont).innerHTML = `
    ${filas.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(soles(v))}</dd></div>`).join("")}
    <div class="total-row"><dt>Total</dt><dd>${esc(soles(t.total))}</dd></div>
    <p class="muted small">Importes referenciales; los oficiales los calcula la API al emitir.</p>`;
    carrito.items.forEach((it, i) => {
      const el = $(`[data-linea="${i}"]`, cont);
      if (el) el.textContent = soles(calcularLinea(it, tasa).importe);
    });
    const vuelto = $("#vuelto", cont);
    if (vuelto) {
      const rec = Number(carrito.recibido);
      vuelto.textContent = rec > 0 ? rec >= t.total ? `Vuelto ${soles(rec - t.total)}` : `Faltan ${soles(t.total - rec)}` : "";
      vuelto.classList.toggle("text-danger", rec > 0 && rec < t.total);
    }
    $("#bar-total", cont).textContent = soles(t.total);
    const n = carrito.items.reduce((s, i) => s + (Number(i.cantidad) || 0), 0);
    $("#bar-items", cont).textContent = n ? `${r2(n)} ítem(s)` : "";
    $("#pos-bar", cont).hidden = !carrito.items.length;
  }
  async function cobrar(cont, boton) {
    const error = $("#cart-error", cont);
    error.textContent = "";
    const tasa = tasaIgvLocal();
    const total = calcularTotales(carrito.items, tasa).total;
    const tipoValidar = carrito.tipo === "ninguno" ? null : carrito.tipo;
    const msg = validarVenta({ ...carrito, tipo: tipoValidar }, { regimen: store.config().tax_regime });
    if (msg) {
      error.textContent = msg;
      return;
    }
    if (carrito.forma_pago === "Contado" && carrito.metodo_pago === "efectivo" && carrito.recibido !== "" && Number(carrito.recibido) < total) {
      error.textContent = "El monto recibido es menor que el total.";
      return;
    }
    if (carrito.tipo !== "ninguno") {
      const cfg2 = store.config();
      const serie = carrito.tipo === "01" ? cfg2.serie_factura : cfg2.serie_boleta;
      if (!serie) {
        error.textContent = "Falta la serie por defecto en Configuración → Series.";
        return;
      }
    }
    await conCarga(boton, async () => {
      const venta = registrarVenta({
        items: carrito.items.map((i) => ({ ...i })),
        cliente: carrito.cliente,
        tipo: carrito.tipo,
        forma_pago: carrito.forma_pago,
        metodo_pago: carrito.forma_pago === "Credito" ? null : carrito.metodo_pago,
        recibido: carrito.recibido === "" ? null : Number(carrito.recibido),
        cuotas: carrito.cuotas.map((q) => ({ ...q })),
        tasa
      }, auth.actual());
      vaciar();
      catalogo.q = "";
      let comp = null;
      if (venta.tipo_comprobante !== "ninguno") {
        try {
          comp = await emitirVenta(venta.id);
        } catch {
        }
      }
      location.hash = `#/ventas/${venta.id}`;
      if (comp) verComprobante(comp);
    });
  }

  // src/views/notas.js
  async function vistaNota(cont, ruta, apiId, clase) {
    const tipoNota = clase === "nota-credito" ? "07" : "08";
    const nombre = TIPOS_CPE[tipoNota].nombre;
    cont.innerHTML = `<a class="back-link" href="#/comprobantes/${ruta}/${esc(apiId)}">← Volver al comprobante</a><div id="nota"><p class="loading">Consultando el comprobante…</p></div>`;
    const caja = $("#nota", cont);
    if (!auth.esAdmin()) {
      caja.innerHTML = '<div class="notice notice-error">Solo el administrador emite notas.</div>';
      return;
    }
    if (store.config().tax_regime === "rus") {
      caja.innerHTML = '<div class="notice notice-error">En Nuevo RUS no se emiten notas de crédito ni de débito.</div>';
      return;
    }
    let info;
    try {
      info = await detalleDesdeApi(ruta, apiId);
    } catch (e) {
      caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
      return;
    }
    const f = info.fila;
    const origen = { tipo: TIPO_POR_RUTA[ruta], serie: f.serie, correlativo: f.correlativo, api_id: f.api_id ?? apiId, sunat_status: f.sunat_status, total_oficial: f.total_oficial, cliente: f.cliente, fecha_emision: f.fecha_emision };
    if (!["aceptado", "observado"].includes(origen.sunat_status)) {
      caja.innerHTML = '<div class="notice notice-error">Solo se emiten notas sobre comprobantes aceptados por SUNAT.</div>';
      return;
    }
    const previas = tipoNota === "07" ? totalNcPrevias(origen.tipo, origen.api_id) : 0;
    const saldo = origen.total_oficial != null ? r2(origen.total_oficial - previas) : null;
    const motivos = tipoNota === "07" ? MOTIVOS_NC : MOTIVOS_ND;
    const estado2 = {
      motivo: motivos[0][0],
      descripcion: motivos[0][1],
      serie: serieNota(tipoNota, origen.serie) || "",
      devolver: true,
      items: tipoNota === "07" ? info.items.map((it) => ({ ...it, incluir: true, max: it.cantidad })) : [{ codigo: "", descripcion: "", unidad: "ZZ", cantidad: 1, precio_unitario: "", tip_afe_igv: info.items[0]?.tip_afe_igv || "10", incluir: true }]
    };
    const pintar = () => {
      const total = estado2.motivo && MOTIVOS_NC_TOTAL.includes(estado2.motivo) && tipoNota === "07";
      if (total) estado2.items.forEach((it) => {
        it.incluir = true;
        it.cantidad = it.max;
      });
      const elegidos = estado2.items.filter((it) => it.incluir);
      const monto = totalItems(elegidos.map((it) => ({ ...it, precio_unitario: Number(it.precio_unitario) || 0, cantidad: Number(it.cantidad) || 0 })));
      caja.innerHTML = `
      <h1 class="page-title">${esc(nombre)}</h1>
      <section class="panel">
        <dl class="kv">
          <div><dt>Comprobante afectado</dt><dd>${esc(TIPOS_CPE[origen.tipo].nombre)} ${esc(origen.serie)}-${esc(origen.correlativo)}</dd></div>
          <div><dt>Cliente</dt><dd>${esc(origen.cliente.razon_social)}</dd></div>
          <div><dt>Total del comprobante</dt><dd>${origen.total_oficial != null ? soles(origen.total_oficial) : "—"}</dd></div>
          ${tipoNota === "07" ? `<div><dt>Saldo disponible</dt><dd>${saldo != null ? soles(saldo) : "—"}${previas ? ` <span class="muted small">(NC previas ${soles(previas)})</span>` : ""}</dd></div>` : ""}
        </dl>
      </section>

      <section class="panel">
        <div class="form-grid">
          ${selector({ nombre: "motivo", etiqueta: "Motivo", opciones: motivos, valor: estado2.motivo, req: true })}
          ${campo({ nombre: "serie", etiqueta: "Serie de la nota", valor: estado2.serie, req: true, attrs: 'maxlength="4"', ayuda: `Debe empezar con ${String(origen.serie).startsWith("F") ? "F" : "B"}.` })}
          ${campo({ nombre: "descripcion", etiqueta: "Descripción del motivo", valor: estado2.descripcion, req: true, attrs: 'maxlength="250"' })}
        </div>
      </section>

      <section class="panel">
        <h2>${tipoNota === "07" ? "Ítems a devolver o rebajar" : "Conceptos a cobrar"}</h2>
        ${total ? '<p class="muted small">Este motivo afecta el comprobante completo: van todos los ítems.</p>' : ""}
        ${tipoNota === "07" && !estado2.items.length ? '<p class="notice">La API no devolvió los ítems del comprobante. Agrégalos manualmente.</p>' : ""}
        <div id="nota-items">
          ${estado2.items.map((it, i) => tipoNota === "07" && it.max != null ? `
            <div class="nota-item ${it.incluir ? "" : "is-off"}">
              <label class="check"><input type="checkbox" data-incluir="${i}" ${it.incluir ? "checked" : ""} ${total ? "disabled" : ""}> <strong>${esc(it.descripcion)}</strong></label>
              <div class="corr-row">
                <label class="field"><span class="field-label">Cant. (máx. ${esc(it.max)})</span><input type="number" data-cant="${i}" value="${esc(it.cantidad)}" min="0" max="${esc(it.max)}" step="any" ${total || !it.incluir ? "disabled" : ""}></label>
                <label class="field"><span class="field-label">Precio c/IGV</span><input type="number" data-precio="${i}" value="${esc(it.precio_unitario)}" min="0" step="0.0001" ${total || !it.incluir ? "disabled" : ""}></label>
              </div>
            </div>` : `
            <div class="nota-item">
              <div class="corr-row corr-row-nd">
                <label class="field span-2"><span class="field-label">Concepto</span><input data-desc="${i}" value="${esc(it.descripcion)}" maxlength="250" placeholder="${tipoNota === "08" ? "Ej.: Intereses por pago fuera de plazo" : "Descripción"}"></label>
                <label class="field"><span class="field-label">Cant.</span><input type="number" data-cant="${i}" value="${esc(it.cantidad)}" min="0" step="any"></label>
                <label class="field"><span class="field-label">Precio c/IGV</span><input type="number" data-precio="${i}" value="${esc(it.precio_unitario)}" min="0" step="0.01"></label>
                ${selector({ nombre: `afe-${i}`, etiqueta: "IGV", opciones: AFECTACIONES, valor: it.tip_afe_igv })}
                ${selector({ nombre: `uni-${i}`, etiqueta: "Unidad", opciones: UNIDADES, valor: it.unidad })}
              </div>
              ${estado2.items.length > 1 ? `<button class="link-btn text-danger" type="button" data-quitar="${i}">Quitar</button>` : ""}
            </div>`).join("")}
        </div>
        ${tipoNota === "08" || !info.items.length ? '<button class="link-btn" type="button" id="nota-add">+ Agregar concepto</button>' : ""}
        ${tipoNota === "07" && ["01", "06", "07"].includes(estado2.motivo) ? `
          <label class="check nota-stock"><input type="checkbox" id="nota-devolver" ${estado2.devolver ? "checked" : ""}> Devolver los productos al stock</label>` : ""}
        <dl class="totals"><div class="total-row"><dt>Total de la nota</dt><dd>${soles(monto)}</dd></div></dl>
        <p class="form-error" id="nota-error" role="alert"></p>
        <button class="btn btn-primary btn-block btn-lg" type="button" id="btn-nota">Emitir ${esc(nombre.toLowerCase())}</button>
      </section>`;
      conectar();
    };
    const conectar = () => {
      const sel = $("[name=motivo]", caja);
      sel.addEventListener("change", () => {
        estado2.motivo = sel.value;
        estado2.descripcion = motivos.find((m) => m[0] === sel.value)[1];
        pintar();
      });
      $("[name=serie]", caja).addEventListener("input", (ev) => {
        estado2.serie = ev.target.value.trim().toUpperCase();
      });
      $("[name=descripcion]", caja).addEventListener("input", (ev) => {
        estado2.descripcion = ev.target.value;
      });
      $$("[data-quitar]", caja).forEach((b) => b.addEventListener("click", () => {
        estado2.items.splice(Number(b.dataset.quitar), 1);
        pintar();
      }));
      $("#nota-add", caja)?.addEventListener("click", () => {
        estado2.items.push({ codigo: "", descripcion: "", unidad: "ZZ", cantidad: 1, precio_unitario: "", tip_afe_igv: "10", incluir: true });
        pintar();
      });
      $("#btn-nota", caja).addEventListener("click", async (ev) => {
        const err = $("#nota-error", caja);
        err.textContent = "";
        const items = estado2.items.filter((it) => it.incluir).map((it) => ({
          codigo: it.codigo,
          descripcion: it.descripcion,
          unidad: it.unidad,
          tip_afe_igv: it.tip_afe_igv,
          cantidad: Number(it.cantidad),
          precio_unitario: Number(it.precio_unitario)
        }));
        for (const it of estado2.items.filter((x) => x.incluir && x.max != null)) {
          if (Number(it.cantidad) > it.max) {
            err.textContent = `La cantidad de "${it.descripcion}" supera la vendida (${it.max}).`;
            return;
          }
        }
        const datos = { tipoNota, origen, motivo: estado2.motivo, descripcion: estado2.descripcion, items, serie: estado2.serie };
        const msg = validarNota(datos);
        if (msg) {
          err.textContent = msg;
          return;
        }
        const ok = await confirmar(
          `Emitir ${nombre.toLowerCase()}`,
          `${nombre} por ${soles(totalItems(items))} sobre ${origen.serie}-${origen.correlativo}. Es un documento tributario y no se puede editar una vez aceptado.`,
          "Emitir"
        );
        if (!ok) return;
        await conCarga(ev.currentTarget, async () => {
          try {
            const nota = await emitirNota(datos, { devolverStock: tipoNota === "07" && estado2.devolver && ["01", "06", "07"].includes(estado2.motivo) });
            location.hash = nota.api_id ? `#/comprobantes/${TIPOS_CPE[tipoNota].ruta}/${nota.api_id}` : `#/comprobantes/${ruta}/${apiId}`;
            if (!verComprobante(nota)) toast(`${nombre} registrada en la API. Esperando respuesta de SUNAT.`, "ok");
          } catch (e) {
            err.textContent = [e.message, ...e.detalle?.() || []].join("\n");
            toastError(e);
          }
        });
      });
    };
    caja.addEventListener("change", (ev) => {
      const t = ev.target;
      if (t.dataset.incluir !== void 0) {
        estado2.items[Number(t.dataset.incluir)].incluir = t.checked;
        pintar();
      }
      if (t.id === "nota-devolver") estado2.devolver = t.checked;
      const m = /^(afe|uni)-(\d+)$/.exec(t.name || "");
      if (m) estado2.items[Number(m[2])][m[1] === "afe" ? "tip_afe_igv" : "unidad"] = t.value;
    });
    caja.addEventListener("input", (ev) => {
      const t = ev.target;
      if (t.dataset.cant !== void 0) estado2.items[Number(t.dataset.cant)].cantidad = t.value;
      else if (t.dataset.precio !== void 0) estado2.items[Number(t.dataset.precio)].precio_unitario = t.value;
      else if (t.dataset.desc !== void 0) estado2.items[Number(t.dataset.desc)].descripcion = t.value;
      else return;
      const elegidos = estado2.items.filter((it) => it.incluir);
      $(".total-row dd", caja).textContent = soles(totalItems(elegidos.map((it) => ({ cantidad: Number(it.cantidad) || 0, precio_unitario: Number(it.precio_unitario) || 0 }))));
    });
    pintar();
  }

  // src/views/comprobantes.js
  var PESTANAS = [["facturas", "Facturas"], ["boletas", "Boletas"], ["notas-credito", "Notas de crédito"], ["notas-debito", "Notas de débito"]];
  var filtros4 = { ruta: "boletas", desde: "", hasta: "", estado: "", doc: "", serie: "", correlativo: "", pagina: 1 };
  function vistaComprobantes(cont, partes) {
    if (partes[0] && partes[1] && ["nota-credito", "nota-debito"].includes(partes[2])) return vistaNota(cont, partes[0], partes[1], partes[2]);
    if (partes[0] && partes[1]) return detalle(cont, partes[0], partes[1]);
    if (partes[0] && PESTANAS.some((p) => p[0] === partes[0])) filtros4.ruta = partes[0];
    return bandeja(cont);
  }
  function bandeja(cont) {
    cont.innerHTML = `
    <h1 class="page-title">Comprobantes</h1>
    <nav class="tabs" aria-label="Tipo de comprobante">
      ${PESTANAS.map(([r, t]) => `<a href="#/comprobantes/${r}" class="tab ${r === filtros4.ruta ? "is-active" : ""}">${t}</a>`).join("")}
    </nav>
    <form class="filtros" id="f-filtros" novalidate>
      <label class="field"><span class="field-label">Desde</span><input type="date" name="desde" value="${esc(filtros4.desde)}"></label>
      <label class="field"><span class="field-label">Hasta</span><input type="date" name="hasta" value="${esc(filtros4.hasta)}"></label>
      <label class="field"><span class="field-label">Estado SUNAT</span>
        <select name="estado">
          ${[["", "Todos"], ["aceptado", "Aceptados"], ["rechazado", "Rechazados"], ["pendiente", "Pendientes"], ["enviado", "Enviados"]].map(([v, t]) => `<option value="${v}" ${filtros4.estado === v ? "selected" : ""}>${t}</option>`).join("")}
        </select></label>
      <label class="field"><span class="field-label">Documento del cliente</span><input name="doc" value="${esc(filtros4.doc)}" inputmode="numeric" placeholder="DNI o RUC"></label>
      <label class="field"><span class="field-label">Serie</span><input name="serie" value="${esc(filtros4.serie)}" maxlength="4" placeholder="B001"></label>
      <label class="field"><span class="field-label">Número</span><input name="correlativo" value="${esc(filtros4.correlativo)}" inputmode="numeric"></label>
      <div class="filtros-acciones"><button class="btn btn-primary" type="submit">Buscar</button><button class="btn" type="button" id="btn-limpiar">Limpiar</button></div>
    </form>
    <div id="cpe-lista"></div>`;
    const f = $("#f-filtros", cont);
    f.addEventListener("submit", (ev) => {
      ev.preventDefault();
      for (const k of ["desde", "hasta", "estado", "doc", "serie", "correlativo"]) filtros4[k] = $(`[name=${k}]`, f).value.trim();
      filtros4.serie = filtros4.serie.toUpperCase();
      if (filtros4.desde && filtros4.hasta && filtros4.desde > filtros4.hasta) return toast('La fecha "desde" es posterior a "hasta".', "warn");
      filtros4.pagina = 1;
      cargarLista(cont);
    });
    $("#btn-limpiar", cont).addEventListener("click", () => {
      Object.assign(filtros4, { desde: "", hasta: "", estado: "", doc: "", serie: "", correlativo: "", pagina: 1 });
      bandeja(cont);
    });
    cargarLista(cont);
  }
  async function cargarLista(cont) {
    const caja = $("#cpe-lista", cont);
    caja.innerHTML = '<p class="loading">Consultando la API…</p>';
    const ruta = filtros4.ruta;
    const query = {
      fecha_desde: filtros4.desde,
      fecha_hasta: filtros4.hasta,
      sunat_status: filtros4.estado,
      client_num_doc: filtros4.doc,
      serie: filtros4.serie,
      correlativo: filtros4.correlativo,
      por_pagina: POR_PAGINA,
      page: filtros4.pagina
    };
    try {
      const r = await api.listarComprobantes(ruta, query);
      if (ruta !== filtros4.ruta) return;
      const filas = comoLista(r.datos).map((x) => leerFila(x, ruta));
      filas.forEach(sincronizarDesdeApi);
      pintarFilas(cont, filas, metaDe(r), r.crudo);
    } catch (e) {
      caja.innerHTML = `<div class="notice notice-error"><p><strong>${esc(e.message)}</strong></p>
      ${e.red ? '<p class="small">Sin conexión con la API. Los comprobantes de las ventas siguen visibles en Ventas.</p>' : ""}</div>`;
    }
  }
  var POR_PAGINA = 20;
  function partirFecha(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(v || ""));
    return m ? { dia: `${m[3]}/${m[2]}/${m[1]}`, hora: m[4] || "" } : { dia: String(v || "—"), hora: "" };
  }
  function pintarFilas(cont, filas, meta, crudoResp) {
    const caja = $("#cpe-lista", cont);
    const hayMas = hayMasPaginas(meta, filtros4.pagina);
    if (!filas.length) {
      const conFiltros = filtros4.desde || filtros4.hasta || filtros4.estado || filtros4.doc || filtros4.serie || filtros4.correlativo;
      caja.innerHTML = tablaDatos({
        filas: [],
        columnas: [],
        vacio: conFiltros ? 'No hay comprobantes con estos filtros. Prueba con "Limpiar".' : "La API no devolvió comprobantes de este tipo."
      }) + crudo(crudoResp, !conFiltros);
      return;
    }
    const esNota = ["notas-credito", "notas-debito"].includes(filtros4.ruta);
    const columnas = [
      { titulo: "Comprobante", celda: (f) => {
        const local = comprobanteLocal(f.tipo, f.api_id);
        return `<strong class="font-id">${esc(f.serie || "")}-${esc(f.correlativo ?? "…")}</strong>${local?.venta_id ? `<span class="sub">Venta #${esc(local.venta_id)}</span>` : ""}`;
      } },
      { titulo: "Cliente", sec: true, celda: (f) => `${esc(f.cliente.razon_social || "Sin nombre")}${f.cliente.num_doc && f.cliente.num_doc !== "-" ? `<span class="sub font-id">${esc(f.cliente.num_doc)}</span>` : ""}` },
      { titulo: "Emisión", sec: true, clase: "nw", celda: (f) => {
        const p = partirFecha(f.fecha_emision);
        return `${esc(p.dia)}${p.hora ? `<span class="sub">${esc(p.hora)}</span>` : ""}`;
      } },
      ...esNota ? [{ titulo: "Afecta a", sec: true, celda: (f) => f.afectado ? `<span class="font-id">${esc(f.afectado)}</span>` : "" }] : [],
      { titulo: "Estado", celda: (f) => {
        const e = ESTADOS[f.sunat_status] || ESTADOS.desconocido;
        const local = comprobanteLocal(f.tipo, f.api_id);
        return `<span class="pill ${e.clase}">${esc(e.texto)}</span>${local?.reemplazado ? ' <span class="pill">Reemplazado</span>' : ""}`;
      } },
      { titulo: "Total", clase: "num", celda: (f) => f.total_oficial != null ? esc(soles(f.total_oficial)) : "—" },
      { titulo: "Respuesta SUNAT", sec: true, celda: (f) => esc(f.mensaje_sunat || "") },
      { titulo: "", clase: "col-acciones", celda: (f, i) => `<span class="acciones-fila">
        <button class="btn btn-sm" type="button" data-pdf="${i}">${icono("imprimir")}<span>PDF</span></button>
        <a class="btn btn-sm" href="#/comprobantes/${f.ruta}/${esc(f.api_id)}">Ver</a>
      </span>` }
    ];
    const ultima = meta?.last_page ?? meta?.ultima_pagina ?? null;
    caja.innerHTML = tablaDatos({
      filas,
      columnas,
      numero: (f, i) => (filtros4.pagina - 1) * POR_PAGINA + i + 1,
      enlace: (f) => `#/comprobantes/${f.ruta}/${f.api_id}`,
      claseFila: (f) => f.sunat_status === "anulado" ? "fila-anulada" : "",
      pie: pieTabla({ pagina: filtros4.pagina, ultima, total: meta?.total ?? null, hayMas, cantidad: filas.length })
    }) + crudo(crudoResp);
    caja._filas = filas;
    if (!caja._pdf) {
      caja._pdf = true;
      caja.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-pdf]");
        if (b) verComprobante(caja._filas[Number(b.dataset.pdf)]);
      });
    }
    activarTablas(caja, { alPaginar: (paso) => {
      filtros4.pagina = Math.max(1, filtros4.pagina + paso);
      cargarLista(cont);
    } });
  }
  async function detalle(cont, ruta, apiId) {
    if (!TIPO_POR_RUTA[ruta]) {
      cont.innerHTML = '<div class="notice notice-error">Tipo de comprobante desconocido.</div>';
      return;
    }
    const tipo = TIPO_POR_RUTA[ruta];
    const hash = location.hash;
    const sigueAqui = () => location.hash === hash;
    cont.innerHTML = `<a class="back-link" href="#/comprobantes/${ruta}">← ${esc(TIPOS_CPE[tipo].nombre)}s</a><div id="cpe-det"><p class="loading">Consultando la API…</p></div>`;
    const caja = $("#cpe-det", cont);
    let info;
    const cargar2 = async () => {
      try {
        info = await detalleDesdeApi(ruta, apiId);
        if (sigueAqui()) pintar();
      } catch (e) {
        const local = comprobanteLocal(tipo, apiId);
        caja.innerHTML = `<div class="notice notice-error"><p><strong>${esc(e.message)}</strong></p></div>
        ${local?.venta_id ? `<a class="btn" href="#/ventas/${local.venta_id}">Ver la venta #${local.venta_id}</a>` : ""}`;
      }
    };
    const pintar = () => {
      const { fila: f, items, local } = info;
      const e = ESTADOS[f.sunat_status] || ESTADOS.desconocido;
      const admin = auth.esAdmin();
      const aceptado = ["aceptado", "observado"].includes(f.sunat_status);
      const editable = ["pendiente", "rechazado"].includes(f.sunat_status);
      const enProceso = !esFinal(f.sunat_status) && f.sunat_status !== "pendiente";
      const reemplazado = local?.reemplazado;
      const nrus = store.config().tax_regime === "rus";
      const comoOrigen = { ...f, api_id: f.api_id ?? apiId };
      const errBaja = ["01", "07", "08"].includes(tipo) ? puedeBaja(comoOrigen) : null;
      const errAnular = tipo === "03" ? puedeAnularBoleta(comoOrigen) : null;
      caja.innerHTML = `
      <section class="panel">
        <div class="cpe-head">
          <div>
            <span class="muted small">${esc(TIPOS_CPE[tipo].nombre)} electrónica · ${esc(f.fecha_emision)}</span>
            <div class="cpe-num">${esc(f.serie || "")}-${esc(f.correlativo ?? "…")}</div>
          </div>
          <span class="pill pill-lg ${e.clase}">${esc(e.texto)}</span>
        </div>
        ${f.mensaje_sunat ? `<p class="small"><strong>SUNAT:</strong> ${esc(f.mensaje_sunat)}${f.codigo_sunat ? ` (código ${esc(f.codigo_sunat)})` : ""}</p>` : ""}
        ${enProceso ? '<p class="muted">SUNAT aún no responde. Consulta el estado en unos segundos.</p>' : ""}
        ${f.sunat_status === "pendiente" ? '<p class="muted">Registrado en la API, todavía no enviado a SUNAT.</p>' : ""}
        ${f.sunat_status === "rechazado" && !reemplazado ? '<p class="notice notice-error">Rechazado: corrígelo y se reenvía automáticamente. Si el rechazo no se puede corregir, emite la venta con un nuevo número.</p>' : ""}
        ${reemplazado ? `<p class="notice notice-info">Este comprobante fue ${reemplazado === "eliminado" ? "eliminado" : "reemplazado"}; la venta quedó libre para emitirse de nuevo.</p>` : ""}
        <dl class="kv">
          <div><dt>Cliente</dt><dd>${esc(f.cliente.razon_social || "—")}</dd></div>
          <div><dt>Documento</dt><dd>${esc(nombreTipoDoc(f.cliente.tipo_doc))} ${esc(f.cliente.num_doc)}</dd></div>
          <div><dt>Total</dt><dd>${f.total_oficial != null ? esc(soles(f.total_oficial)) : "—"}</dd></div>
          ${f.afectado ? `<div><dt>Documento afectado</dt><dd>${esc(f.afectado)}</dd></div>` : ""}
          ${local?.venta_id ? `<div><dt>Venta</dt><dd><a href="#/ventas/${local.venta_id}">#${local.venta_id}</a></dd></div>` : ""}
        </dl>
      </section>

      <section class="panel">
        <h2>Archivos</h2>
        <div class="row-actions">
          <button class="btn btn-primary" type="button" data-archivo="pdf" data-formato="ticket-80">Ticket 80 mm</button>
          <button class="btn" type="button" data-archivo="pdf" data-formato="ticket-58">Ticket 58 mm</button>
          <button class="btn" type="button" data-archivo="pdf" data-formato="a4">PDF A4</button>
          <button class="btn" type="button" data-archivo="pdf" data-formato="a5">PDF A5</button>
          <button class="btn" type="button" data-archivo="xml">XML</button>
          ${aceptado ? '<button class="btn" type="button" data-archivo="cdr">CDR</button>' : ""}
        </div>
        ${aceptado ? "" : '<p class="muted small">El CDR existe solo cuando SUNAT acepta el comprobante.</p>'}
      </section>

      <section class="panel">
        <h2>Acciones</h2>
        <div class="row-actions">
          ${!aceptado ? '<button class="btn" type="button" id="btn-consultar">Consultar estado</button>' : ""}
          ${editable && !reemplazado ? '<button class="btn btn-primary" type="button" id="btn-enviar">Enviar a SUNAT</button>' : ""}
          ${editable && !reemplazado && admin ? '<button class="btn" type="button" id="btn-corregir">Corregir</button>' : ""}
          ${editable && !reemplazado && admin && tipo === "03" ? '<button class="btn btn-ghost-danger" type="button" id="btn-eliminar">Eliminar boleta</button>' : ""}
          ${f.sunat_status === "rechazado" && !reemplazado && admin && local?.venta_id ? '<button class="btn btn-ghost-danger" type="button" id="btn-liberar">Emitir con nuevo número</button>' : ""}
        </div>
        ${aceptado && admin ? `
          <div class="row-actions">
            ${["01", "03"].includes(tipo) && !nrus ? `<a class="btn" href="#/comprobantes/${ruta}/${esc(apiId)}/nota-credito">Nota de crédito</a>` : ""}
            ${["01", "03"].includes(tipo) && !nrus ? `<a class="btn" href="#/comprobantes/${ruta}/${esc(apiId)}/nota-debito">Nota de débito</a>` : ""}
            ${["01", "07", "08"].includes(tipo) && !local?.baja_api_id ? `<button class="btn btn-ghost-danger" type="button" id="btn-baja" ${errBaja ? "disabled" : ""}>Comunicar baja</button>` : ""}
            ${tipo === "03" && !local?.baja_api_id ? `<button class="btn btn-ghost-danger" type="button" id="btn-anular-rc" ${errAnular ? "disabled" : ""}>Anular por resumen</button>` : ""}
          </div>
          ${["01", "07", "08"].includes(tipo) && errBaja && !local?.baja_api_id ? `<p class="muted small">${esc(errBaja)}</p>` : ""}
          ${tipo === "03" && errAnular && !local?.baja_api_id ? `<p class="muted small">${esc(errAnular)}</p>` : ""}
          ${!(tipo === "03" ? errAnular : ["01", "07", "08"].includes(tipo) ? errBaja : "n/a") && !local?.baja_api_id ? `<p class="muted small">Plazo para baja o anulación: ${Math.max(diasRestantes(f.fecha_emision), 0)} día(s) más. Después, solo con nota de crédito.</p>` : ""}` : ""}
        ${local?.baja_api_id ? `<p class="notice notice-info small">${local.baja_tipo === "resumen" ? "Anulación por resumen" : "Comunicación de baja"} enviada: ${esc(ESTADOS[local.baja_estado]?.texto || local.baja_estado || "en proceso")}. Consulta su estado en Operaciones SUNAT.</p>` : ""}
      </section>

      ${tipo === "01" && (aceptado || enProceso) ? `
        <section class="panel" id="pagos">
          <div class="panel-head"><h2>Pagos y saldo</h2><button class="btn btn-sm" type="button" id="btn-pagos">Ver pagos</button></div>
          <div id="pagos-body"><p class="muted small">Para facturas al crédito: registra los cobros de cada cuota.</p></div>
        </section>` : ""}

      ${items.length ? `
        <section class="panel">
          <h2>Ítems</h2>
          ${tablaDatos({
        filas: items,
        columnas: [
          { titulo: "Descripción", celda: (it) => `${esc(it.descripcion)}${it.codigo ? `<span class="sub font-id">${esc(it.codigo)}</span>` : ""}` },
          { titulo: "Cant.", clase: "num", celda: (it) => esc(it.cantidad) },
          { titulo: "P. unit.", clase: "num", sec: true, celda: (it) => esc(soles(it.precio_unitario)) },
          { titulo: "IGV", sec: true, celda: (it) => esc((AFECTACIONES.find((a) => a[0] === it.tip_afe_igv) || [0, it.tip_afe_igv])[1]) },
          { titulo: "Importe", clase: "num", celda: (it) => esc(soles(Number(it.cantidad) * Number(it.precio_unitario))) }
        ]
      })}
        </section>` : ""}
      ${crudo(info.crudo)}`;
      conectar();
    };
    const conectar = () => {
      $$("[data-archivo]", caja).forEach((b) => b.addEventListener("click", () => conCarga(b, () => abrir(ruta, apiId, info.fila, b.dataset.archivo, b.dataset.formato))));
      $("#btn-consultar", caja)?.addEventListener("click", (ev) => conCarga(ev.currentTarget, cargar2));
      $("#btn-enviar", caja)?.addEventListener("click", (ev) => conCarga(ev.currentTarget, async () => {
        try {
          const r = await enviarASunat(ruta, apiId);
          toast(r.mensaje || "Enviado a SUNAT. Consultando la respuesta…", "ok");
          await esperarYRecargar();
        } catch (e) {
          toastError(e);
        }
      }));
      $("#btn-corregir", caja)?.addEventListener("click", () => editorCorreccion(ruta, apiId, info, async () => {
        toast("Corrección enviada. La API la reenvía a SUNAT.", "ok");
        await esperarYRecargar();
      }));
      $("#btn-eliminar", caja)?.addEventListener("click", async (ev) => {
        const b = ev.currentTarget;
        if (!await confirmar("Eliminar boleta", "La boleta se elimina de la API (no fue aceptada). La venta queda sin comprobante para emitir otra.", "Eliminar", true)) return;
        await conCarga(b, async () => {
          try {
            await eliminarBoleta(apiId);
            toast("Boleta eliminada.", "ok");
            const local = info.local;
            location.hash = local?.venta_id ? `#/ventas/${local.venta_id}` : `#/comprobantes/${ruta}`;
          } catch (e) {
            toastError(e);
          }
        });
      });
      $("#btn-baja", caja)?.addEventListener("click", () => pedirMotivo(
        "Comunicar baja",
        "Se envía a SUNAT una comunicación de baja. Si SUNAT la acepta, el comprobante queda anulado.",
        "Error en los datos del comprobante",
        async (motivo) => {
          await comunicarBaja({ ...info.fila, api_id: info.fila.api_id ?? apiId }, motivo);
          toast("Comunicación de baja enviada. Revisa su estado en Operaciones SUNAT → Bajas.", "ok", 6e3);
          await cargar2();
        }
      ));
      $("#btn-anular-rc", caja)?.addEventListener("click", () => pedirMotivo(
        "Anular boleta por resumen",
        "Las boletas aceptadas se anulan con un resumen diario de anulación. Si SUNAT lo acepta, la boleta queda anulada.",
        "Anulación solicitada por el cliente",
        async (motivo) => {
          await anularBoletaPorResumen({ ...info.fila, api_id: info.fila.api_id ?? apiId }, motivo);
          toast("Resumen de anulación enviado. Revisa su estado en Operaciones SUNAT → Resumen diario.", "ok", 6e3);
          await cargar2();
        }
      ));
      $("#btn-pagos", caja)?.addEventListener("click", (ev) => conCarga(ev.currentTarget, () => pintarPagos($("#pagos-body", caja), ruta, apiId, info.fila.total_oficial)));
      $("#btn-liberar", caja)?.addEventListener("click", async () => {
        if (!await confirmar(
          "Emitir con nuevo número",
          'El comprobante rechazado queda en el historial y la venta vuelve a "sin comprobante" para emitirla con el siguiente correlativo.',
          "Continuar",
          true
        )) return;
        const venta = liberarVenta(info.local, "reemplazado");
        toast("Venta liberada. Emite el nuevo comprobante.", "ok");
        location.hash = `#/ventas/${venta.id}`;
      });
    };
    const esperarYRecargar = async () => {
      for (let i = 0; i < 6 && sigueAqui(); i++) {
        await new Promise((r) => setTimeout(r, i === 0 ? 1500 : 2500));
        if (!sigueAqui()) return;
        await cargar2();
        if (esFinal(info?.fila.sunat_status)) return;
      }
    };
    await cargar2();
  }
  async function abrir(ruta, apiId, fila, tipoArchivo, formato) {
    const extension = tipoArchivo === "pdf" ? "pdf" : tipoArchivo === "xml" ? "xml" : "zip";
    const nombre = `${fila.serie}-${fila.correlativo ?? apiId}${tipoArchivo === "cdr" ? "-CDR" : ""}.${extension}`;
    const ventana = tipoArchivo === "pdf" ? window.open("", "_blank") : null;
    try {
      const blob = await descargar(`/${ruta}/${apiId}/${tipoArchivo}`, tipoArchivo === "pdf" ? queryPdf(formato) : void 0);
      const url2 = URL.createObjectURL(blob);
      if (ventana && !ventana.closed) ventana.location.href = url2;
      else {
        const a = document.createElement("a");
        a.href = url2;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url2), 6e4);
    } catch (e) {
      if (ventana && !ventana.closed) ventana.close();
      toastError(e);
    }
  }
  function editorCorreccion(ruta, apiId, info, alTerminar) {
    const tipo = TIPO_POR_RUTA[ruta];
    const cli = { ...info.fila.cliente };
    let items = info.items.map((i) => ({ ...i }));
    if (!items.length && info.local?.venta_id) {
      const venta = store.buscar("ventas", info.local.venta_id);
      items = armarPayload({ ...venta, tipo, items: itemsDeVenta(venta.id) }, { serie: info.fila.serie }).items;
    }
    if (!items.length) items = [{ codigo: "", descripcion: "", unidad: "NIU", cantidad: 1, precio_unitario: 0, tip_afe_igv: "10" }];
    const filaItem = (it, i) => `
    <div class="corr-item" data-i="${i}">
      ${campo({ nombre: "descripcion", etiqueta: `Ítem ${i + 1}`, valor: it.descripcion })}
      <div class="corr-row">
        ${campo({ nombre: "cantidad", etiqueta: "Cant.", valor: it.cantidad, tipo: "number", attrs: 'min="0" step="any"' })}
        ${campo({ nombre: "precio_unitario", etiqueta: "Precio c/IGV", valor: it.precio_unitario, tipo: "number", attrs: 'min="0" step="0.0001"' })}
        ${selector({ nombre: "tip_afe_igv", etiqueta: "IGV", opciones: AFECTACIONES, valor: it.tip_afe_igv })}
        ${selector({ nombre: "unidad", etiqueta: "Unidad", opciones: UNIDADES, valor: it.unidad })}
      </div>
      <input type="hidden" name="codigo" value="${esc(it.codigo)}">
      <input type="hidden" name="cod_producto_sunat" value="${esc(it.cod_producto_sunat || "")}">
      <button class="link-btn text-danger" type="button" data-quitar>Quitar ítem</button>
    </div>`;
    const d = modal({
      titulo: `Corregir ${info.fila.serie}-${info.fila.correlativo ?? ""}`,
      contenido: `
      <p class="muted small">Se envía con PUT y la API lo reenvía a SUNAT. Solo se puede si no está aceptado.</p>
      <h3 class="sub">Cliente</h3>
      <div class="form-grid" id="corr-cli">
        ${selector({ nombre: "tipo_doc", etiqueta: "Tipo de documento", opciones: tipo === "01" ? [["6", "RUC"]] : TIPOS_DOC, valor: cli.tipo_doc || (tipo === "01" ? "6" : "1") })}
        ${campo({ nombre: "num_doc", etiqueta: "Número", valor: cli.num_doc })}
        ${campo({ nombre: "razon_social", etiqueta: "Nombre o razón social", valor: cli.razon_social })}
        ${campo({ nombre: "direccion", etiqueta: "Dirección", valor: cli.direccion })}
      </div>
      <h3 class="sub">Ítems</h3>
      <div id="corr-items">${items.map(filaItem).join("")}</div>
      <button class="link-btn" type="button" id="corr-add">+ Agregar ítem</button>
      <p class="form-error" id="corr-error" role="alert"></p>`,
      acciones: '<button class="btn" value="cancelar">Cancelar</button><button class="btn btn-primary" value="ok" id="btn-corr-ok">Guardar y reenviar</button>'
    });
    const lista2 = $("#corr-items", d);
    lista2.addEventListener("click", (ev) => {
      if (!ev.target.closest("[data-quitar]")) return;
      if ($$(".corr-item", lista2).length === 1) return toast("Debe quedar al menos un ítem.", "warn");
      ev.target.closest(".corr-item").remove();
    });
    $("#corr-add", d).addEventListener("click", () => {
      lista2.insertAdjacentHTML("beforeend", filaItem({ codigo: "", descripcion: "", unidad: "NIU", cantidad: 1, precio_unitario: "", tip_afe_igv: "10" }, $$(".corr-item", lista2).length));
    });
    $("#btn-corr-ok", d).addEventListener("click", (ev) => {
      ev.preventDefault();
      const err = $("#corr-error", d);
      const c = $("#corr-cli", d);
      const cliente = {};
      $$("input, select", c).forEach((i) => {
        cliente[i.name] = i.value.trim();
      });
      cliente.razon_social = cliente.razon_social.toUpperCase();
      const errDoc = errorDocumento(cliente.tipo_doc, cliente.num_doc);
      if (errDoc) {
        err.textContent = errDoc;
        return;
      }
      const nuevos = $$(".corr-item", lista2).map((row) => {
        const o = {};
        $$("input, select", row).forEach((i) => {
          o[i.name] = i.value.trim();
        });
        o.cantidad = Number(o.cantidad);
        o.precio_unitario = Number(o.precio_unitario);
        if (!o.codigo) o.codigo = "ITEM";
        return o;
      });
      conCarga(ev.currentTarget, async () => {
        try {
          await corregirComprobante(ruta, apiId, { cliente, items: nuevos });
          cerrarModal();
          await alTerminar();
        } catch (e) {
          err.textContent = [e.message, ...e.detalle?.() || []].join("\n");
        }
      });
    });
  }
  function pedirMotivo(titulo, texto, sugerido, accion) {
    const d = modal({
      titulo,
      contenido: `<p>${esc(texto)}</p>${campo({ nombre: "motivo", etiqueta: "Motivo", valor: sugerido, req: true, attrs: 'maxlength="100"' })}<p class="form-error" id="motivo-error"></p>`,
      acciones: '<button class="btn" value="cancelar">Cancelar</button><button class="btn btn-danger" value="ok" id="btn-motivo-ok">Enviar a SUNAT</button>'
    });
    $("#btn-motivo-ok", d).addEventListener("click", (ev) => {
      ev.preventDefault();
      const motivo = $("[name=motivo]", d).value.trim();
      conCarga(ev.currentTarget, async () => {
        try {
          await accion(motivo);
          cerrarModal();
        } catch (e) {
          $("#motivo-error", d).textContent = [e.message, ...e.detalle?.() || []].join("\n");
        }
      });
    });
  }
  async function pintarPagos(caja, ruta, apiId, total) {
    let pagos = [];
    try {
      pagos = comoLista((await api.pagos(ruta, apiId)).datos);
    } catch (e) {
      caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
      return;
    }
    const pagado = sumaPagos(pagos);
    const saldo = total != null ? Math.max(Math.round((total - pagado) * 100) / 100, 0) : null;
    caja.innerHTML = `
    <dl class="stats stats-3">
      <div><dt>Total</dt><dd>${total != null ? soles(total) : "—"}</dd></div>
      <div><dt>Pagado</dt><dd>${soles(pagado)}</dd></div>
      <div><dt>Saldo</dt><dd class="${saldo > 0 ? "text-danger" : ""}">${saldo != null ? soles(saldo) : "—"}</dd></div>
    </dl>
    ${tablaDatos({
      filas: pagos,
      vacio: "Sin pagos registrados.",
      columnas: [
        { titulo: "Fecha", clase: "nw", celda: (p) => esc(p.fecha || "") },
        { titulo: "Método", celda: (p) => esc((METODOS_PAGO.find((m) => m[0] === p.metodo) || [0, p.metodo || ""])[1]) },
        { titulo: "Referencia", sec: true, celda: (p) => p.referencia ? `<span class="font-id">${esc(p.referencia)}</span>` : "" },
        { titulo: "Monto", clase: "num", celda: (p) => esc(soles(p.monto)) },
        ...auth.esAdmin() ? [{ titulo: "", clase: "col-acciones", celda: (p) => p.id != null ? `<button class="btn btn-sm btn-ghost-danger" type="button" data-pago="${esc(p.id)}">Eliminar</button>` : "" }] : []
      ]
    })}
    ${saldo === 0 && total != null ? '<p class="pill pill-ok">Cancelada</p>' : `
      <form class="form-grid" id="f-pago" novalidate>
        ${campo({ nombre: "monto", etiqueta: "Monto S/", valor: saldo ?? "", tipo: "number", req: true, attrs: 'min="0" step="0.01" inputmode="decimal"' })}
        ${campo({ nombre: "fecha", etiqueta: "Fecha", valor: hoyLima(), tipo: "date", req: true })}
        ${selector({ nombre: "metodo", etiqueta: "Método", opciones: METODOS_PAGO, valor: "transferencia" })}
        ${campo({ nombre: "referencia", etiqueta: "Referencia (n.º de operación)" })}
        <p class="form-error span-all" id="pago-error"></p>
        <div class="form-actions span-all"><button class="btn btn-primary" type="submit">Registrar pago</button></div>
      </form>`}`;
    $("#f-pago", caja)?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const fp = ev.currentTarget;
      const p = {
        monto: Number($("[name=monto]", fp).value),
        fecha: $("[name=fecha]", fp).value,
        metodo: $("[name=metodo]", fp).value,
        referencia: $("[name=referencia]", fp).value.trim()
      };
      const msg = validarPago(p, saldo);
      if (msg) {
        $("#pago-error", fp).textContent = msg;
        return;
      }
      if (!p.referencia) delete p.referencia;
      conCarga(fp.querySelector("[type=submit]"), async () => {
        try {
          await api.registrarPago(ruta, apiId, p);
          toast("Pago registrado.", "ok");
          await pintarPagos(caja, ruta, apiId, total);
        } catch (e) {
          $("#pago-error", fp).textContent = [e.message, ...e.detalle?.() || []].join("\n");
        }
      });
    });
    $$("[data-pago]", caja).forEach((b) => b.addEventListener("click", async () => {
      if (!await confirmar("Eliminar pago", "Se eliminará este pago registrado.", "Eliminar", true)) return;
      try {
        await api.eliminarPago(ruta, apiId, b.dataset.pago);
        toast("Pago eliminado.", "ok");
        await pintarPagos(caja, ruta, apiId, total);
      } catch (e) {
        toastError(e);
      }
    }));
  }

  // src/views/sunat.js
  var SECCIONES2 = [["resumen", "Resumen diario"], ["bajas", "Bajas"], ["guias", "Guías de remisión"], ["cobranzas", "Cobranzas"], ["consultas", "Consultas"]];
  function vistaSunat(cont, partes) {
    const actual = SECCIONES2.some((s) => s[0] === partes[0]) ? partes[0] : "resumen";
    cont.innerHTML = `
    <h1 class="page-title">Operaciones SUNAT</h1>
    <nav class="tabs" aria-label="Operaciones">
      ${SECCIONES2.map(([id, t]) => `<a href="#/sunat/${id}" class="tab ${id === actual ? "is-active" : ""}">${t}</a>`).join("")}
    </nav>
    <div id="sunat-body"></div>`;
    const cuerpo = $("#sunat-body", cont);
    const fn = { resumen, bajas, guias, cobranzas, consultas }[actual];
    return fn(cuerpo, partes.slice(1));
  }
  var pill = (e) => `<span class="pill ${ESTADOS[e]?.clase || ""}">${esc(ESTADOS[e]?.texto || e)}</span>`;
  var mesActual = () => hoyLima().slice(0, 7);
  function guardarBlob(blob, nombre) {
    const url2 = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url2;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url2), 6e4);
  }
  async function bajar(ruta, nombre) {
    try {
      guardarBlob(await descargar(ruta), nombre);
    } catch (e) {
      toastError(e);
    }
  }
  function leerProceso(x) {
    const e = leerEstadoProceso(x);
    return {
      id: x.id,
      identificador: x.identificador ?? x.identifier ?? x.correlativo_resumen ?? x.nombre ?? `#${x.id}`,
      fecha: String(x.fecha_referencia ?? x.fecha_resumen ?? x.fecha_generacion ?? x.fecha ?? x.creado_en ?? x.created_at ?? "").slice(0, 10),
      tipo: x.tipo ?? (Array.isArray(x.anular) && x.anular.length ? "anulacion" : null),
      estado: e.estado,
      mensaje: e.mensaje,
      ticket: e.ticket,
      cantidad: x.total_documentos ?? ((x.detalles ?? x.boletas ?? x.documentos ?? []).length || x.cantidad || null)
    };
  }
  async function resumen(cuerpo) {
    cuerpo.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Boletas pendientes de resumen</h2><button class="btn btn-sm" type="button" id="btn-rc-recargar">Actualizar</button></div>
      <p class="muted small">Las boletas "solo registro" se envían a SUNAT en un resumen por fecha de emisión, hasta ${PLAZO_DIAS} días después.</p>
      <div id="rc-pend"><p class="loading">Consultando…</p></div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>Resúmenes enviados</h2>
        <input type="month" id="rc-mes" value="${mesActual()}" aria-label="Mes" class="input-auto">
      </div>
      <div id="rc-lista"><p class="loading">Consultando…</p></div>
    </section>`;
    const cargarPendientes = async () => {
      const caja = $("#rc-pend", cuerpo);
      try {
        const grupos = agruparPorFecha(await boletasPendientes());
        if (!grupos.length) {
          caja.innerHTML = vacioMsg("No hay boletas pendientes de resumen.");
          return;
        }
        caja.innerHTML = tablaDatos({
          filas: grupos,
          columnas: [
            { titulo: "Fecha de emisión", clase: "nw", celda: (g) => `<strong>${esc(g.fecha)}</strong>` },
            { titulo: "Boletas", clase: "num", celda: (g) => esc(g.lista.length) },
            { titulo: "Números", sec: true, celda: (g) => `<span class="font-id">${g.lista.slice(0, 6).map((b) => esc(numeroCpe(b))).join(", ")}${g.lista.length > 6 ? "…" : ""}</span>` },
            { titulo: "Total", clase: "num", celda: (g) => esc(soles(g.total)) },
            { titulo: "Plazo", celda: (g) => `<span class="pill ${g.restantes < 0 ? "pill-danger" : g.restantes <= 2 ? "pill-warn" : "pill-ok"}">${g.restantes < 0 ? `Vencido hace ${-g.restantes} día(s)` : g.restantes === 0 ? "Último día" : `Quedan ${g.restantes} día(s)`}</span>` },
            { titulo: "", clase: "col-acciones", celda: (g) => `<button class="btn btn-primary btn-sm" type="button" data-rc="${esc(g.fecha)}">Enviar resumen</button>` }
          ]
        });
        $$("[data-rc]", caja).forEach((b) => b.addEventListener("click", async () => {
          if (!await confirmar("Enviar resumen diario", `Se enviarán a SUNAT todas las boletas pendientes del ${b.dataset.rc}.`, "Enviar")) return;
          await conCarga(b, async () => {
            try {
              const r = await enviarResumen(b.dataset.rc);
              toast(r.mensaje || "Resumen enviado. Consulta su estado en la lista.", "ok");
              await cargarPendientes();
              await cargarLista2();
            } catch (e) {
              toastError(e);
            }
          });
        }));
      } catch (e) {
        caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
      }
    };
    const cargarLista2 = async () => {
      const caja = $("#rc-lista", cuerpo);
      caja.innerHTML = '<p class="loading">Consultando…</p>';
      try {
        const r = await api.resumenes({ mes: $("#rc-mes", cuerpo).value, por_pagina: 50 });
        const filas = comoLista(r.datos).map(leerProceso);
        caja.innerHTML = filas.length ? filaProcesos(filas, "resumenes") + crudo(r.crudo) : vacioMsg("No hay resúmenes en este mes.") + crudo(r.crudo);
        conectarProcesos(caja, "resumenes", filas, cargarLista2);
      } catch (e) {
        caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
      }
    };
    $("#btn-rc-recargar", cuerpo).addEventListener("click", (ev) => conCarga(ev.currentTarget, cargarPendientes));
    $("#rc-mes", cuerpo).addEventListener("change", cargarLista2);
    await Promise.all([cargarPendientes(), cargarLista2()]);
  }
  function filaProcesos(filas, ruta) {
    return tablaDatos({
      filas,
      columnas: [
        { titulo: "Identificador", celda: (f) => `<strong class="font-id">${esc(f.identificador)}</strong><span class="sub">${esc(f.fecha)}</span>` },
        { titulo: "Tipo", sec: true, celda: (f) => esc(f.tipo === "anulacion" ? "Anulación" : f.tipo || "") },
        { titulo: "Documentos", sec: true, clase: "num", celda: (f) => esc(f.cantidad ?? "") },
        { titulo: "Ticket", sec: true, celda: (f) => f.ticket ? `<span class="font-id">${esc(f.ticket)}</span>` : "" },
        { titulo: "Estado", celda: (f) => pill(f.estado) },
        { titulo: "Respuesta SUNAT", sec: true, celda: (f) => esc(f.mensaje || "") },
        { titulo: "", clase: "col-acciones", celda: (f) => `<span class="acciones-fila">
          <button class="btn btn-sm" type="button" data-estado="${esc(f.id)}">Consultar</button>
          ${f.estado === "pendiente" ? `<button class="btn btn-sm btn-primary" type="button" data-enviar="${esc(f.id)}">Enviar</button>` : ""}
          <button class="btn btn-sm" type="button" data-xml="${esc(f.id)}">XML</button>
          ${["aceptado", "observado"].includes(f.estado) ? `<button class="btn btn-sm" type="button" data-cdr="${esc(f.id)}">CDR</button>` : ""}
        </span>` }
      ]
    });
  }
  function conectarProcesos(caja, ruta, filas, recargar) {
    const porId = (id) => filas.find((f) => String(f.id) === String(id));
    $$("[data-estado]", caja).forEach((b) => b.addEventListener("click", () => conCarga(b, async () => {
      try {
        const r = ruta === "resumenes" ? await api.estadoResumen(b.dataset.estado) : await api.estadoAnulacion(b.dataset.estado);
        const e = leerEstadoProceso(r.datos);
        const locales = store.todos("comprobantes").filter((c) => String(c.baja_api_id) === String(b.dataset.estado));
        for (const c of locales) aplicarResultadoBaja(c.tipo, c.api_id, e.estado);
        toast(`${porId(b.dataset.estado)?.identificador || ""}: ${ESTADOS[e.estado]?.texto || e.estado}${e.mensaje ? ` · ${e.mensaje}` : ""}`, e.estado === "rechazado" ? "error" : "ok", 6e3);
        await recargar();
      } catch (e) {
        toastError(e);
      }
    })));
    $$("[data-enviar]", caja).forEach((b) => b.addEventListener("click", () => conCarga(b, async () => {
      try {
        ruta === "resumenes" ? await api.enviarResumen(b.dataset.enviar) : await api.enviarAnulacion(b.dataset.enviar);
        toast("Enviado a SUNAT.", "ok");
        await recargar();
      } catch (e) {
        toastError(e);
      }
    })));
    $$("[data-xml]", caja).forEach((b) => b.addEventListener("click", () => conCarga(b, () => bajar(`/${ruta}/${b.dataset.xml}/xml`, `${porId(b.dataset.xml)?.identificador || b.dataset.xml}.xml`))));
    $$("[data-cdr]", caja).forEach((b) => b.addEventListener("click", () => conCarga(b, () => bajar(`/${ruta}/${b.dataset.cdr}/cdr`, `${porId(b.dataset.cdr)?.identificador || b.dataset.cdr}-CDR.zip`))));
  }
  async function bajas(cuerpo) {
    const admin = auth.esAdmin();
    cuerpo.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>Comunicaciones de baja</h2>
        <select id="ra-estado" class="input-auto" aria-label="Estado">
          ${[["", "Todas"], ["pendiente", "Pendientes"], ["aceptado", "Aceptadas"], ["rechazado", "Rechazadas"]].map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}
        </select>
      </div>
      <p class="muted small">Para dar de baja una factura o nota aceptada, ábrela en Comprobantes y usa "Comunicar baja" (plazo ${PLAZO_DIAS} días). Las boletas se anulan por resumen.</p>
      <div id="ra-lista"><p class="loading">Consultando…</p></div>
    </section>
    ${admin ? `
    <section class="panel">
      <details>
        <summary><strong>Baja manual de un documento</strong></summary>
        <p class="muted small">Solo si el documento no aparece en Comprobantes. Verifica antes que esté aceptado y dentro del plazo.</p>
        <form class="form-grid" id="f-ra" novalidate>
          ${selector({ nombre: "tipo_documento", etiqueta: "Tipo", opciones: [["01", "Factura"], ["07", "Nota de crédito"], ["08", "Nota de débito"]], valor: "01" })}
          ${campo({ nombre: "serie", etiqueta: "Serie", req: true, attrs: 'maxlength="4"' })}
          ${campo({ nombre: "correlativo", etiqueta: "Número", req: true, attrs: 'inputmode="numeric"' })}
          ${campo({ nombre: "motivo", etiqueta: "Motivo", req: true, attrs: 'maxlength="100"' })}
          <p class="form-error span-all" id="ra-error"></p>
          <div class="form-actions span-all"><button class="btn btn-danger" type="submit">Comunicar baja</button></div>
        </form>
      </details>
    </section>` : ""}`;
    const cargar2 = async () => {
      const caja = $("#ra-lista", cuerpo);
      caja.innerHTML = '<p class="loading">Consultando…</p>';
      try {
        const r = await api.anulaciones({ estado: $("#ra-estado", cuerpo).value, por_pagina: 50 });
        const filas = comoLista(r.datos).map(leerProceso);
        caja.innerHTML = filas.length ? filaProcesos(filas, "anulaciones") + crudo(r.crudo) : vacioMsg("No hay comunicaciones de baja.") + crudo(r.crudo);
        conectarProcesos(caja, "anulaciones", filas, cargar2);
      } catch (e) {
        caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
      }
    };
    $("#ra-estado", cuerpo).addEventListener("change", cargar2);
    $("#f-ra", cuerpo)?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      const d = Object.fromEntries([...f.querySelectorAll("input, select")].map((i) => [i.name, i.value.trim()]));
      d.serie = d.serie.toUpperCase();
      const err = $("#ra-error", f);
      if (!/^[F][A-Z0-9]{3}$/.test(d.serie)) {
        err.textContent = "La serie debe empezar con F (facturas y sus notas).";
        return;
      }
      if (!/^\d+$/.test(d.correlativo)) {
        err.textContent = "Número inválido.";
        return;
      }
      if (d.motivo.length < 4) {
        err.textContent = "Describe el motivo.";
        return;
      }
      if (!await confirmar("Comunicar baja", `Se pedirá a SUNAT dar de baja ${d.serie}-${d.correlativo}.`, "Enviar", true)) return;
      await conCarga(f.querySelector("[type=submit]"), async () => {
        try {
          const hoy = hoyLima();
          await api.crearAnulacion({ fecha_generacion: hoy, fecha_comunicacion: hoy, detalles: [d] });
          toast("Comunicación de baja enviada.", "ok");
          f.reset();
          await cargar2();
        } catch (e) {
          err.textContent = [e.message, ...e.detalle?.() || []].join("\n");
        }
      });
    });
    await cargar2();
  }
  async function guias(cuerpo, partes) {
    if (partes[0] === "nueva") return formGuia(cuerpo, null);
    if (partes[0] && partes[1] === "editar") return editarGuia(cuerpo, partes[0]);
    if (partes[0]) return detalleGuia(cuerpo, partes[0]);
    cuerpo.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>Guías de remisión remitente</h2>
        ${auth.esAdmin() ? '<a class="btn btn-primary" href="#/sunat/guias/nueva">Nueva guía</a>' : ""}
      </div>
      <p class="muted small">Para trasladar mercadería: entregas a domicilio o entre locales propios.</p>
      <div id="gr-lista"><p class="loading">Consultando…</p></div>
    </section>`;
    const caja = $("#gr-lista", cuerpo);
    try {
      const r = await api.guias({ tipo_documento: "09", por_pagina: 50 });
      const filas = comoLista(r.datos).map((x) => ({ ...leerCpe(x), fecha: (x.fecha_emision ?? "").slice(0, 10), destino: x.destinatario?.razon_social ?? x.destinatario_razon_social ?? "" }));
      caja.innerHTML = tablaDatos({
        filas,
        vacio: "Aún no hay guías.",
        enlace: (g) => `#/sunat/guias/${g.api_id}`,
        columnas: [
          { titulo: "Guía", celda: (g) => `<strong class="font-id">${esc(numeroCpe(g))}</strong>` },
          { titulo: "Destinatario", sec: true, celda: (g) => esc(g.destino) },
          { titulo: "Emisión", sec: true, clase: "nw", celda: (g) => esc(g.fecha) },
          { titulo: "Estado", celda: (g) => pill(g.sunat_status) },
          { titulo: "Respuesta SUNAT", sec: true, celda: (g) => esc(g.mensaje_sunat || "") },
          { titulo: "", clase: "col-acciones", celda: (g, i) => `<span class="acciones-fila">
            <button class="btn btn-sm" type="button" data-gpdf="${i}">PDF</button>
            <a class="btn btn-sm" href="#/sunat/guias/${esc(g.api_id)}">Ver</a>
          </span>` }
        ]
      }) + crudo(r.crudo);
      $$("[data-gpdf]", caja).forEach((b) => b.addEventListener("click", () => verGuia(filas[Number(b.dataset.gpdf)])));
    } catch (e) {
      caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
    }
  }
  async function detalleGuia(cuerpo, apiId) {
    const local = store.todos("comprobantes").find((c) => c.tipo === "09" && String(c.api_id) === String(apiId));
    cuerpo.innerHTML = `<a class="back-link" href="#/sunat/guias">← Guías</a><div id="gr-det"><p class="loading">Consultando…</p></div>`;
    const caja = $("#gr-det", cuerpo);
    const pintar = async () => {
      let g, crudoResp;
      try {
        const r = await api.guia(apiId);
        g = r.datos?.guia || r.datos || {};
        crudoResp = r.crudo;
      } catch (e) {
        caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
        return;
      }
      const c = leerCpe(g);
      if (local && c.sunat_status !== "desconocido") store.actualizar("comprobantes", local.id, { sunat_status: c.sunat_status, correlativo: c.correlativo ?? local.correlativo, mensaje_sunat: c.mensaje_sunat });
      const editable = ["pendiente", "rechazado"].includes(c.sunat_status) && auth.esAdmin();
      caja.innerHTML = `
      <section class="panel">
        <div class="cpe-head">
          <div><span class="muted small">Guía de remisión remitente</span><div class="cpe-num">${esc(numeroCpe(c))}</div></div>
          <span class="pill pill-lg ${ESTADOS[c.sunat_status]?.clase || ""}">${esc(ESTADOS[c.sunat_status]?.texto || c.sunat_status)}</span>
        </div>
        ${c.mensaje_sunat ? `<p class="small"><strong>SUNAT:</strong> ${esc(c.mensaje_sunat)}</p>` : ""}
        <p class="muted small">Las guías usan la API GRE de SUNAT: el resultado llega por ticket. Consulta el estado hasta tener respuesta.</p>
        <div class="row-actions">
          <button class="btn" type="button" id="gr-estado">Consultar estado</button>
          ${c.sunat_status === "pendiente" ? '<button class="btn btn-primary" type="button" id="gr-enviar">Enviar a SUNAT</button>' : ""}
          <button class="btn" type="button" id="gr-pdf">PDF A4</button>
          <button class="btn" type="button" id="gr-xml">XML</button>
          ${editable ? local?.payload ? '<a class="btn" href="#/sunat/guias/' + esc(apiId) + '/editar" id="gr-editar">Corregir</a>' : '<span class="muted small">Corregir solo es posible para guías creadas desde este sistema.</span>' : ""}
        </div>
      </section>
      ${crudo(crudoResp)}`;
      $("#gr-estado", caja).addEventListener("click", (ev) => conCarga(ev.currentTarget, async () => {
        try {
          const r = await api.estadoGuia(apiId);
          const e = leerEstadoProceso(r.datos);
          toast(`${ESTADOS[e.estado]?.texto || e.estado}${e.mensaje ? ` · ${e.mensaje}` : ""}`, e.estado === "rechazado" ? "error" : "ok", 6e3);
          await pintar();
        } catch (e) {
          toastError(e);
        }
      }));
      $("#gr-enviar", caja)?.addEventListener("click", (ev) => conCarga(ev.currentTarget, async () => {
        try {
          await api.enviarGuia(apiId);
          toast("Guía enviada. Consulta el estado en unos segundos.", "ok");
          await pintar();
        } catch (e) {
          toastError(e);
        }
      }));
      $("#gr-pdf", caja).addEventListener("click", (ev) => conCarga(ev.currentTarget, () => bajar(`/guias-remision/${apiId}/pdf?format=a4`, `${numeroCpe(c)}.pdf`)));
      $("#gr-xml", caja).addEventListener("click", (ev) => conCarga(ev.currentTarget, () => bajar(`/guias-remision/${apiId}/xml`, `${numeroCpe(c)}.xml`)));
    };
    await pintar();
  }
  function formGuia(cuerpo, existente) {
    const cfg2 = store.config();
    const base = existente?.payload;
    const hoy = hoyLima();
    const g = {
      serie: base?.serie || cfg2.serie_guia || "T001",
      fecha_emision: hoy,
      destinatario: base?.destinatario || { tipo_doc: "6", num_doc: "", razon_social: "" },
      cod_traslado: base?.cod_traslado || "01",
      mod_traslado: base?.mod_traslado || "02",
      m1l: Boolean(base?.indicadores?.length),
      fecha_traslado: base?.fecha_traslado && base.fecha_traslado >= hoy ? base.fecha_traslado : hoy,
      peso_total: base?.peso_total ?? "",
      num_bultos: base?.num_bultos ?? "",
      partida_ubigeo: base?.partida_ubigeo || cfg2.ubigeo || "",
      partida_direccion: base?.partida_direccion || cfg2.direccion || "",
      llegada_ubigeo: base?.llegada_ubigeo || "",
      llegada_direccion: base?.llegada_direccion || "",
      partida_cod_local: base?.partida_cod_local || "0000",
      llegada_cod_local: base?.llegada_cod_local || "",
      transportista: base?.transportista || { tipo_doc: "6", num_doc: "", razon_social: "", nro_mtc: "" },
      vehiculo: base?.vehiculo || { placa: "" },
      conductor: base?.conductor || { tipo_doc: "1", num_doc: "", nombres: "", apellidos: "", licencia: "" },
      items: base?.items?.map((i) => ({ ...i })) || []
    };
    const ventas = store.todos("ventas").filter((v2) => v2.estado !== "anulada").sort((a, b) => b.id - a.id).slice(0, 25);
    const clientes = store.todos("clientes");
    cuerpo.innerHTML = `
    <a class="back-link" href="#/sunat/guias">← Guías</a>
    <h2 class="sub">${existente ? `Corregir guía ${esc(numeroCpe(existente))}` : "Nueva guía de remisión"}</h2>
    <form id="f-gr" novalidate>
      <section class="panel">
        <h2>Destinatario y motivo</h2>
        <div class="form-grid">
          ${selector({ nombre: "dest_tipo", etiqueta: "Tipo de documento", opciones: TIPOS_DOC.filter((t) => t[0] !== "0"), valor: g.destinatario.tipo_doc })}
          ${campo({ nombre: "dest_num", etiqueta: "Número", valor: g.destinatario.num_doc, req: true, attrs: 'list="gr-clientes"' })}
          ${campo({ nombre: "dest_nombre", etiqueta: "Nombre o razón social", valor: g.destinatario.razon_social, req: true })}
          ${selector({ nombre: "cod_traslado", etiqueta: "Motivo de traslado", opciones: MOTIVOS_TRASLADO, valor: g.cod_traslado })}
          ${campo({ nombre: "fecha_traslado", etiqueta: "Fecha de traslado", valor: g.fecha_traslado, tipo: "date", req: true })}
          ${campo({ nombre: "peso_total", etiqueta: "Peso total (kg)", valor: g.peso_total, tipo: "number", req: true, attrs: 'min="0" step="0.01"' })}
          ${campo({ nombre: "num_bultos", etiqueta: "N.º de bultos", valor: g.num_bultos, tipo: "number", attrs: 'min="0" step="1"' })}
          ${campo({ nombre: "serie", etiqueta: "Serie", valor: g.serie, req: true, attrs: 'maxlength="4"' })}
        </div>
        <datalist id="gr-clientes">${clientes.map((c) => `<option value="${esc(c.num_doc)}">${esc(c.razon_social)}</option>`).join("")}</datalist>
      </section>

      <section class="panel">
        <h2>Partida y llegada</h2>
        <div class="form-grid">
          ${campo({ nombre: "partida_ubigeo", etiqueta: "Ubigeo de partida", valor: g.partida_ubigeo, req: true, attrs: 'maxlength="6" inputmode="numeric"' })}
          ${campo({ nombre: "partida_direccion", etiqueta: "Dirección de partida", valor: g.partida_direccion, req: true })}
          ${campo({ nombre: "llegada_ubigeo", etiqueta: "Ubigeo de llegada", valor: g.llegada_ubigeo, req: true, attrs: 'maxlength="6" inputmode="numeric"' })}
          ${campo({ nombre: "llegada_direccion", etiqueta: "Dirección de llegada", valor: g.llegada_direccion, req: true })}
          <div class="span-all form-grid" id="gr-locales">
            ${campo({ nombre: "partida_cod_local", etiqueta: "Código local de partida", valor: g.partida_cod_local, attrs: 'maxlength="4"' })}
            ${campo({ nombre: "llegada_cod_local", etiqueta: "Código local de llegada", valor: g.llegada_cod_local, attrs: 'maxlength="4"' })}
          </div>
        </div>
      </section>

      <section class="panel">
        <h2>Transporte</h2>
        <div class="segmented" role="radiogroup" aria-label="Modalidad">
          <label><input type="radio" name="mod_traslado" value="02" ${g.mod_traslado === "02" ? "checked" : ""}><span>Privado (propio)</span></label>
          <label><input type="radio" name="mod_traslado" value="01" ${g.mod_traslado === "01" ? "checked" : ""}><span>Público (empresa)</span></label>
        </div>
        <div id="gr-privado" class="form-grid">
          <label class="check span-all"><input type="checkbox" name="m1l" ${g.m1l ? "checked" : ""}> Vehículo menor (moto o auto, categoría M1 o L)</label>
          <div class="span-all form-grid" id="gr-vehiculo">
            ${campo({ nombre: "placa", etiqueta: "Placa (sin guion)", valor: g.vehiculo.placa, attrs: 'maxlength="8" autocapitalize="characters"' })}
            ${selector({ nombre: "cond_tipo", etiqueta: "Doc. del conductor", opciones: [["1", "DNI"], ["4", "Carnet de extranjería"]], valor: g.conductor.tipo_doc })}
            ${campo({ nombre: "cond_num", etiqueta: "Número", valor: g.conductor.num_doc })}
            ${campo({ nombre: "cond_nombres", etiqueta: "Nombres", valor: g.conductor.nombres })}
            ${campo({ nombre: "cond_apellidos", etiqueta: "Apellidos", valor: g.conductor.apellidos })}
            ${campo({ nombre: "cond_licencia", etiqueta: "Licencia", valor: g.conductor.licencia })}
          </div>
        </div>
        <div id="gr-publico" class="form-grid">
          ${campo({ nombre: "tr_ruc", etiqueta: "RUC del transportista", valor: g.transportista.num_doc, attrs: 'maxlength="11" inputmode="numeric"' })}
          ${campo({ nombre: "tr_nombre", etiqueta: "Razón social", valor: g.transportista.razon_social })}
          ${campo({ nombre: "tr_mtc", etiqueta: "Registro MTC", valor: g.transportista.nro_mtc || "" })}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Bienes trasladados</h2>
          ${ventas.length ? `<select id="gr-desde-venta" class="input-auto" aria-label="Copiar de una venta"><option value="">Copiar de una venta…</option>
            ${ventas.map((v2) => `<option value="${v2.id}">#${v2.id} · ${esc(v2.cliente?.razon_social || "Clientes varios")} · ${soles(v2.total)}</option>`).join("")}</select>` : ""}
        </div>
        <div id="gr-items"></div>
        <button class="link-btn" type="button" id="gr-add">+ Agregar bien</button>
      </section>

      <p class="form-error" id="gr-error" role="alert"></p>
      <button class="btn btn-primary btn-block btn-lg" type="submit">${existente ? "Guardar y reenviar" : "Emitir guía"}</button>
    </form>`;
    const f = $("#f-gr", cuerpo);
    const v = (n) => $(`[name=${n}]`, f);
    const pintarItems = () => {
      $("#gr-items", f).innerHTML = g.items.length ? g.items.map((it, i) => `
      <div class="corr-row corr-row-gr">
        <label class="field span-2"><span class="field-label">Descripción</span><input data-gdesc="${i}" value="${esc(it.descripcion)}"></label>
        <label class="field"><span class="field-label">Cant.</span><input type="number" data-gcant="${i}" value="${esc(it.cantidad)}" min="0" step="any"></label>
        <label class="field"><span class="field-label">Unidad</span><select data-guni="${i}">${UNIDADES.filter((u) => u[0] !== "ZZ").map(([c, t]) => `<option value="${c}" ${c === it.unidad ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <button class="icon-btn" type="button" data-gquitar="${i}" aria-label="Quitar">×</button>
      </div>`).join("") : '<p class="muted small">Agrega los bienes o cópialos de una venta (los servicios no se trasladan).</p>';
    };
    const ajustar = () => {
      const publico = $("[name=mod_traslado]:checked", f).value === "01";
      $("#gr-publico", f).hidden = !publico;
      $("#gr-privado", f).hidden = publico;
      $("#gr-vehiculo", f).hidden = publico || v("m1l").checked;
      $("#gr-locales", f).hidden = v("cod_traslado").value !== "04";
    };
    f.addEventListener("change", (ev) => {
      const t = ev.target;
      if (t.name === "mod_traslado" || t.name === "m1l" || t.name === "cod_traslado") ajustar();
      if (t.dataset.guni !== void 0) g.items[Number(t.dataset.guni)].unidad = t.value;
      if (t.id === "gr-desde-venta" && t.value) {
        const venta = store.buscar("ventas", Number(t.value));
        const bienes = itemsDeVenta(venta.id).filter((i) => i.unidad !== "ZZ");
        if (!bienes.length) toast("Esa venta solo tiene servicios.", "warn");
        g.items = bienes.map((i) => ({ codigo: i.codigo, descripcion: i.descripcion, cantidad: i.cantidad, unidad: i.unidad }));
        if (venta.cliente && venta.cliente.tipo_doc !== "0") {
          v("dest_tipo").value = venta.cliente.tipo_doc;
          v("dest_num").value = venta.cliente.num_doc;
          v("dest_nombre").value = venta.cliente.razon_social;
          if (venta.cliente.direccion && !v("llegada_direccion").value) v("llegada_direccion").value = venta.cliente.direccion;
        }
        t.value = "";
        pintarItems();
      }
    });
    f.addEventListener("input", (ev) => {
      const t = ev.target;
      if (t.dataset.gdesc !== void 0) g.items[Number(t.dataset.gdesc)].descripcion = t.value;
      if (t.dataset.gcant !== void 0) g.items[Number(t.dataset.gcant)].cantidad = t.value;
      if (t.name === "dest_num") {
        const c = clientes.find((x) => x.num_doc === t.value.trim());
        if (c) {
          v("dest_tipo").value = c.tipo_doc;
          v("dest_nombre").value = c.razon_social;
          if (c.direccion && !v("llegada_direccion").value) v("llegada_direccion").value = c.direccion;
        }
      }
    });
    f.addEventListener("click", (ev) => {
      const q = ev.target.closest("[data-gquitar]");
      if (q) {
        g.items.splice(Number(q.dataset.gquitar), 1);
        pintarItems();
      }
    });
    $("#gr-add", f).addEventListener("click", () => {
      g.items.push({ codigo: "", descripcion: "", cantidad: 1, unidad: "NIU" });
      pintarItems();
    });
    f.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const err = $("#gr-error", f);
      err.textContent = "";
      const datos = {
        serie: v("serie").value.trim().toUpperCase(),
        fecha_emision: hoy,
        destinatario: { tipo_doc: v("dest_tipo").value, num_doc: v("dest_num").value.trim(), razon_social: v("dest_nombre").value.trim().toUpperCase() },
        cod_traslado: v("cod_traslado").value,
        mod_traslado: $("[name=mod_traslado]:checked", f).value,
        m1l: v("m1l").checked,
        fecha_traslado: v("fecha_traslado").value,
        peso_total: v("peso_total").value,
        num_bultos: v("num_bultos").value,
        partida_ubigeo: v("partida_ubigeo").value.trim(),
        partida_direccion: v("partida_direccion").value,
        llegada_ubigeo: v("llegada_ubigeo").value.trim(),
        llegada_direccion: v("llegada_direccion").value,
        partida_cod_local: v("partida_cod_local").value.trim(),
        llegada_cod_local: v("llegada_cod_local").value.trim(),
        transportista: { tipo_doc: "6", num_doc: v("tr_ruc").value.trim(), razon_social: v("tr_nombre").value.trim().toUpperCase(), nro_mtc: v("tr_mtc").value.trim() },
        vehiculo: { placa: v("placa").value.trim().toUpperCase().replace(/[-\s]/g, "") },
        conductor: { tipo_doc: v("cond_tipo").value, num_doc: v("cond_num").value.trim(), nombres: v("cond_nombres").value, apellidos: v("cond_apellidos").value, licencia: v("cond_licencia").value },
        items: g.items
      };
      const msg = validarGuia(datos);
      if (msg) {
        err.textContent = msg;
        return;
      }
      const body = armarGuia(datos);
      conCarga(f.querySelector("[type=submit]"), async () => {
        try {
          const r = existente ? await api.actualizarGuia(existente.api_id, body) : await api.crearGuia(body);
          const local = guardarGuiaLocal(r.datos, body, existente);
          location.hash = local.api_id ? `#/sunat/guias/${local.api_id}` : "#/sunat/guias";
          if (local.api_id) verGuia(local);
          else toast(existente ? "Guía corregida y reenviada." : "Guía registrada. Consulta su estado.", "ok");
        } catch (e) {
          err.textContent = [e.message, ...e.detalle?.() || []].join("\n");
        }
      });
    });
    pintarItems();
    ajustar();
  }
  function verGuia(c) {
    return visorPdf({
      titulo: `Guía de remisión ${numeroCpe(c)}`,
      subtitulo: ESTADOS[c.sunat_status]?.texto || "",
      formatos: [["a4", "A4"]],
      cargar: (formato) => descargar(`/guias-remision/${c.api_id}/pdf`, { format: formato }),
      nombre: () => `${numeroCpe(c)}.pdf`
    });
  }
  async function cobranzas(cuerpo) {
    const credito = store.todos("ventas").filter((v) => v.forma_pago === "Credito" && v.comprobante_id && v.estado !== "anulada").map((v) => ({ v, c: store.buscar("comprobantes", v.comprobante_id) })).filter((x) => x.c && !x.c.reemplazado).sort((a, b) => b.v.id - a.v.id);
    const hoy = hoyLima();
    cuerpo.innerHTML = `
    <section class="panel">
      <h2>Antigüedad de cuentas por cobrar</h2>
      <div id="cob-panel"><p class="loading">Consultando…</p></div>
    </section>
    <section class="panel">
      <h2>Facturas al crédito</h2>
      <p class="muted small">Registra los cobros desde la ficha de cada factura (sección "Pagos y saldo").</p>
      ${tablaDatos({
      filas: credito,
      vacio: "No hay facturas al crédito registradas en este sistema.",
      enlace: ({ c }) => `#/comprobantes/facturas/${c.api_id}`,
      columnas: [
        { titulo: "Factura", celda: ({ c }) => `<strong class="font-id">${esc(numeroCpe(c))}</strong>` },
        { titulo: "Cliente", sec: true, celda: ({ v }) => `${esc(v.cliente?.razon_social || "")}${v.cliente?.num_doc ? `<span class="sub font-id">${esc(v.cliente.num_doc)}</span>` : ""}` },
        { titulo: "Cuotas", sec: true, clase: "num", celda: ({ v }) => esc((v.cuotas || []).length) },
        { titulo: "Vence", sec: true, clase: "nw", celda: ({ v }) => esc(v.cuotas?.at(-1)?.fecha_pago || "—") },
        { titulo: "Estado", celda: ({ v }) => (v.cuotas || []).some((q) => q.fecha_pago < hoy) ? '<span class="pill pill-warn">Cuotas vencidas</span>' : '<span class="pill pill-ok">Al día</span>' },
        { titulo: "Total", clase: "num", celda: ({ v, c }) => esc(soles(c.total_oficial ?? v.total)) }
      ]
    })}
    </section>`;
    const caja = $("#cob-panel", cuerpo);
    try {
      const r = await api.panelCobranzas();
      const d = r.datos || {};
      caja.innerHTML = panelCobranzas(d) + crudo(r.crudo);
    } catch (e) {
      caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
    }
  }
  function panelCobranzas(d) {
    const TRAMOS = [["por_vencer", "Por vencer"], ["vencido_0_30", "Vencido 0–30 días"], ["vencido_31_60", "31–60 días"], ["vencido_61_90", "61–90 días"], ["vencido_mas_90", "Más de 90 días"]];
    const aging = d.aging ?? d.antiguedad ?? d.tramos ?? null;
    let html = "";
    if (Array.isArray(aging)) {
      html += `<dl class="stats">${aging.map((t) => `<div><dt>${esc(t.rango ?? t.tramo ?? t.label ?? "")}</dt><dd>${soles(t.monto ?? t.total ?? 0)}</dd></div>`).join("")}</dl>`;
    } else if (aging && typeof aging === "object") {
      html += `<dl class="stats">${TRAMOS.filter(([k]) => aging[k] != null).map(([k, t]) => `<div><dt>${esc(t)}</dt><dd class="${k !== "por_vencer" && Number(aging[k]) > 0 ? "text-danger" : ""}">${soles(aging[k])}</dd></div>`).join("")}</dl>`;
      if (aging.documentos_con_saldo != null) html += `<p class="muted small">${esc(aging.documentos_con_saldo)} documento(s) con saldo.</p>`;
    }
    if (d.resumen && typeof d.resumen === "object") {
      const NOMBRE = { pagado: "Pagado", parcial: "Pago parcial", pendiente: "Pendiente" };
      html += '<h3 class="sub">Por estado de pago</h3>' + tablaDatos({
        filas: Object.entries(d.resumen).map(([k, v]) => ({ estado: NOMBRE[k] || k, ...v })),
        columnas: [
          { titulo: "Estado", celda: (x) => `<strong>${esc(x.estado)}</strong>` },
          { titulo: "Documentos", clase: "num", sec: true, celda: (x) => esc(x.documentos ?? 0) },
          { titulo: "Monto", clase: "num", sec: true, celda: (x) => esc(soles(x.monto_total ?? 0)) },
          { titulo: "Pagado", clase: "num", sec: true, celda: (x) => esc(soles(x.monto_pagado ?? 0)) },
          { titulo: "Saldo", clase: "num", celda: (x) => esc(soles(x.saldo ?? 0)) }
        ]
      });
    }
    if (Array.isArray(d.top_deudores) && d.top_deudores.length) {
      html += '<h3 class="sub">Clientes con mayor saldo</h3>' + tablaDatos({
        filas: d.top_deudores,
        columnas: [
          { titulo: "Cliente", celda: (x) => `<strong>${esc(x.cliente || "")}</strong>${x.ruc && x.ruc !== "-" ? `<span class="sub font-id">${esc(x.ruc)}</span>` : ""}` },
          { titulo: "Documentos", clase: "num", sec: true, celda: (x) => esc(x.documentos ?? "") },
          { titulo: "Saldo", clase: "num", celda: (x) => esc(soles(x.saldo ?? 0)) }
        ]
      });
    }
    return html || vacioMsg("La API no devolvió datos de cobranza.");
  }
  function consultas(cuerpo) {
    const ruc = store.config().ruc || "";
    const tipos = [["01", "Factura"], ["03", "Boleta"], ["07", "Nota de crédito"], ["08", "Nota de débito"]];
    cuerpo.innerHTML = `
    <section class="panel">
      <h2>Consultar comprobante en SUNAT</h2>
      <p class="muted small">Verifica el estado de un comprobante propio o de un proveedor antes de pagarle.</p>
      <form class="form-grid" id="f-cpe" novalidate>
        ${campo({ nombre: "ruc_emisor", etiqueta: "RUC del emisor", valor: ruc, req: true, attrs: 'maxlength="11" inputmode="numeric"' })}
        ${selector({ nombre: "tipo_doc", etiqueta: "Tipo", opciones: tipos, valor: "01" })}
        ${campo({ nombre: "serie", etiqueta: "Serie", req: true, attrs: 'maxlength="4"' })}
        ${campo({ nombre: "correlativo", etiqueta: "Número", req: true, attrs: 'inputmode="numeric"' })}
        ${campo({ nombre: "fecha_emision", etiqueta: "Fecha de emisión", tipo: "date", req: true })}
        ${campo({ nombre: "monto_total", etiqueta: "Monto total S/", tipo: "number", req: true, attrs: 'min="0" step="0.01"' })}
        <div class="form-actions span-all"><button class="btn btn-primary" type="submit">Consultar</button></div>
      </form>
      <div id="cpe-res"></div>
    </section>

    <section class="panel">
      <h2>Recuperar CDR</h2>
      <form class="form-grid" id="f-cdr" novalidate>
        ${campo({ nombre: "ruc_emisor", etiqueta: "RUC del emisor", valor: ruc, req: true, attrs: 'maxlength="11" inputmode="numeric"' })}
        ${selector({ nombre: "tipo_doc", etiqueta: "Tipo", opciones: tipos, valor: "01" })}
        ${campo({ nombre: "serie", etiqueta: "Serie", req: true, attrs: 'maxlength="4"' })}
        ${campo({ nombre: "correlativo", etiqueta: "Número", req: true, attrs: 'inputmode="numeric"' })}
        <div class="form-actions span-all"><button class="btn btn-primary" type="submit">Descargar CDR</button></div>
      </form>
    </section>

    <section class="panel">
      <h2>Exportar comprobantes (ZIP)</h2>
      <p class="muted small">XML, CDR y PDF del periodo, por ejemplo para el contador.</p>
      <form class="form-grid" id="f-zip" novalidate>
        ${campo({ nombre: "fecha_desde", etiqueta: "Desde", tipo: "date", valor: `${hoyLima().slice(0, 7)}-01`, req: true })}
        ${campo({ nombre: "fecha_hasta", etiqueta: "Hasta", tipo: "date", valor: hoyLima(), req: true })}
        ${selector({ nombre: "documentos", etiqueta: "Documentos", opciones: [["facturas", "Facturas"], ["boletas", "Boletas"], ["notas-credito", "Notas de crédito"], ["notas-debito", "Notas de débito"]], valor: "facturas", ayuda: 'La colección solo muestra el valor "facturas"; los demás están por confirmar.' })}
        <div class="form-actions span-all"><button class="btn btn-primary" type="submit">Descargar ZIP</button></div>
      </form>
    </section>`;
    const leer2 = (form) => Object.fromEntries([...form.querySelectorAll("input, select")].map((i) => [i.name, i.value.trim()]));
    const validarDoc = (d) => {
      if (errorDocumento("6", d.ruc_emisor)) return "RUC del emisor inválido.";
      if (!/^[A-Z0-9]{4}$/.test(d.serie.toUpperCase())) return "Serie inválida (4 caracteres).";
      if (!/^\d+$/.test(d.correlativo)) return "Número inválido.";
      return null;
    };
    $("#f-cpe", cuerpo).addEventListener("submit", (ev) => {
      ev.preventDefault();
      const d = leer2(ev.currentTarget);
      d.serie = d.serie.toUpperCase();
      const msg = validarDoc(d) || (!d.fecha_emision ? "Indica la fecha." : !(Number(d.monto_total) > 0) ? "Indica el monto." : null);
      if (msg) return toast(msg, "warn");
      d.monto_total = Number(d.monto_total).toFixed(2);
      conCarga(ev.currentTarget.querySelector("[type=submit]"), async () => {
        const res = $("#cpe-res", cuerpo);
        try {
          const r = await api.consultarCpe(d);
          const datos = r.datos || {};
          const simples = Object.entries(datos).filter(([, val]) => val === null || ["string", "number", "boolean"].includes(typeof val));
          res.innerHTML = `<dl class="kv">${simples.map(([k, val]) => `<div><dt>${esc(k.replace(/_/g, " "))}</dt><dd>${esc(val ?? "—")}</dd></div>`).join("")}</dl>${crudo(r.crudo)}`;
        } catch (e) {
          res.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
        }
      });
    });
    $("#f-cdr", cuerpo).addEventListener("submit", (ev) => {
      ev.preventDefault();
      const d = leer2(ev.currentTarget);
      d.serie = d.serie.toUpperCase();
      const msg = validarDoc(d);
      if (msg) return toast(msg, "warn");
      conCarga(ev.currentTarget.querySelector("[type=submit]"), async () => {
        try {
          guardarBlob(await api.consultarCdr(d), `R-${d.ruc_emisor}-${d.tipo_doc}-${d.serie}-${d.correlativo}.zip`);
        } catch (e) {
          toastError(e);
        }
      });
    });
    $("#f-zip", cuerpo).addEventListener("submit", (ev) => {
      ev.preventDefault();
      const d = leer2(ev.currentTarget);
      if (!d.fecha_desde || !d.fecha_hasta || d.fecha_desde > d.fecha_hasta) return toast("Rango de fechas inválido.", "warn");
      conCarga(ev.currentTarget.querySelector("[type=submit]"), async () => {
        try {
          guardarBlob(await api.exportarZip(d), `${d.documentos}-${d.fecha_desde}-${d.fecha_hasta}.zip`);
        } catch (e) {
          toastError(e);
        }
      });
    });
  }
  function editarGuia(cuerpo, apiId) {
    const local = store.todos("comprobantes").find((c) => c.tipo === "09" && String(c.api_id) === String(apiId));
    if (!local?.payload) {
      cuerpo.innerHTML = '<div class="notice notice-error">Esta guía no se creó desde este sistema.</div>';
      return;
    }
    formGuia(cuerpo, local);
  }

  // src/views/reportes.js
  var REPORTES = [
    ["registro-ventas", "Registro de ventas", "Reporte de ventas del periodo para la declaración.", "api"],
    ["ventas-consolidado", "Ventas consolidado", "Facturas, boletas y notas con totales por moneda.", "api"],
    ["notas", "Notas de crédito y débito", "Notas emitidas en el periodo.", "api"],
    ["por-cliente", "Por cliente", "Comprobantes de un cliente (DNI o RUC).", "api"],
    ["por-sucursal", "Por sucursal", "Ventas agrupadas por local.", "api"],
    ["caja", "Caja por método de pago", "Cobrado por método y día, desde las ventas del sistema.", "local"]
  ];
  var estado = { reporte: "registro-ventas", desde: "", hasta: "", doc: "", pagina: 1, filas: [], columnas: [] };
  function vistaReportes(cont) {
    if (!estado.desde) {
      const hoy = hoyLima();
      estado.desde = `${hoy.slice(0, 7)}-01`;
      estado.hasta = hoy;
    }
    const actual = REPORTES.find((r) => r[0] === estado.reporte);
    cont.innerHTML = `
    <h1 class="page-title">Reportes</h1>
    <div class="chips chips-wrap" role="tablist" aria-label="Reporte">
      ${REPORTES.map(([id, t]) => `<button type="button" class="chip ${id === estado.reporte ? "is-active" : ""}" data-rep="${id}" aria-selected="${id === estado.reporte}">${esc(t)}</button>`).join("")}
    </div>
    <form class="filtros" id="f-rep" novalidate>
      <p class="muted small span-all">${esc(actual[2])}</p>
      <label class="field"><span class="field-label">Desde</span><input type="date" name="desde" value="${esc(estado.desde)}" required></label>
      <label class="field"><span class="field-label">Hasta</span><input type="date" name="hasta" value="${esc(estado.hasta)}" required></label>
      ${estado.reporte === "por-cliente" ? campo({ nombre: "doc", etiqueta: "DNI o RUC del cliente", valor: estado.doc, req: true, attrs: 'inputmode="numeric" list="rep-clientes"' }) : ""}
      <div class="filtros-acciones">
        <button class="btn btn-primary" type="submit">Generar</button>
        <button class="btn" type="button" id="btn-csv" disabled>Descargar CSV</button>
        <button class="btn" type="button" id="btn-mes-ant">Mes anterior</button>
      </div>
    </form>
    <datalist id="rep-clientes">${store.todos("clientes").map((c) => `<option value="${esc(c.num_doc)}">${esc(c.razon_social)}</option>`).join("")}</datalist>
    <section class="panel panel-flush" id="rep-res"><p class="empty">Elige el periodo y pulsa Generar.</p></section>`;
    cont.querySelector(".chips").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-rep]");
      if (!b) return;
      estado.reporte = b.dataset.rep;
      estado.filas = [];
      vistaReportes(cont);
    });
    const f = $("#f-rep", cont);
    $("#btn-mes-ant", cont).addEventListener("click", () => {
      const [y, m] = hoyLima().split("-").map(Number);
      const ini = new Date(Date.UTC(y, m - 2, 1)), fin = new Date(Date.UTC(y, m - 1, 0));
      $("[name=desde]", f).value = ini.toISOString().slice(0, 10);
      $("[name=hasta]", f).value = fin.toISOString().slice(0, 10);
    });
    f.addEventListener("submit", (ev) => {
      ev.preventDefault();
      estado.desde = $("[name=desde]", f).value;
      estado.hasta = $("[name=hasta]", f).value;
      estado.doc = $("[name=doc]", f)?.value.trim() || "";
      if (!estado.desde || !estado.hasta || estado.desde > estado.hasta) return toast("Rango de fechas inválido.", "warn");
      if (estado.reporte === "por-cliente" && errorDocumento("1", estado.doc) && errorDocumento("6", estado.doc)) return toast("Escribe un DNI (8) o RUC (11) válido.", "warn");
      estado.pagina = 1;
      conCarga(f.querySelector("[type=submit]"), () => generar(cont));
    });
    $("#btn-csv", cont).addEventListener("click", () => descargarCsv());
  }
  async function generar(cont) {
    const caja = $("#rep-res", cont);
    const csv = $("#btn-csv", cont);
    csv.disabled = true;
    if (estado.reporte === "caja") return reporteCaja(caja, csv);
    caja.innerHTML = '<p class="loading">Consultando la API…</p>';
    const query = { fecha_desde: estado.desde, fecha_hasta: estado.hasta, por_pagina: 100, page: estado.pagina };
    if (estado.reporte === "por-cliente") query.client_num_doc = estado.doc;
    try {
      const r = await request("GET", `/reportes/${estado.reporte}`, { query });
      const { filas, resumen: resumen2 } = extraerTabla(r.datos);
      estado.filas = filas;
      estado.columnas = columnasDe(filas);
      caja.innerHTML = `
      ${resumen2.length ? `<dl class="kv rep-resumen">${resumen2.map(([k, v]) => `<div><dt>${esc(etiqueta(k))}</dt><dd>${esc(formatear(k, v))}</dd></div>`).join("")}</dl>` : ""}
      ${tabla(filas, estado.columnas, pieTabla({
        pagina: estado.pagina,
        ultima: metaDe(r)?.last_page ?? metaDe(r)?.ultima_pagina ?? null,
        total: metaDe(r)?.total ?? null,
        hayMas: hayMasPaginas(metaDe(r), estado.pagina),
        cantidad: filas.length
      }))}
      ${crudo(r.crudo)}`;
      csv.disabled = !filas.length;
      activarTablas(caja, { alPaginar: (paso) => {
        estado.pagina = Math.max(1, estado.pagina + paso);
        generar(cont);
      } });
    } catch (e) {
      caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
    }
  }
  function extraerTabla(datos) {
    if (Array.isArray(datos)) return { filas: datos.filter((x) => x && typeof x === "object"), resumen: [] };
    if (!datos || typeof datos !== "object") return { filas: [], resumen: [] };
    let filas = [];
    for (const k of ["registros", "filas", "items", "data", "documentos", "comprobantes", "detalle", "clientes", "sucursales"]) {
      if (Array.isArray(datos[k])) {
        filas = datos[k];
        break;
      }
    }
    if (!filas.length) {
      const arr = Object.values(datos).find((v) => Array.isArray(v) && v.length && typeof v[0] === "object");
      if (arr) filas = arr;
    }
    const fuenteResumen = datos.totales && typeof datos.totales === "object" ? datos.totales : datos;
    const resumen2 = Object.entries(fuenteResumen).filter(([, v]) => v === null || ["string", "number"].includes(typeof v));
    return { filas, resumen: resumen2 };
  }
  var OCULTAS = /^(id|tenant_id|empresa_id|sucursal_id|.*_uuid|hash.*)$/i;
  var PRIORIDAD = ["numero_completo", "serie", "correlativo", "client_razon_social", "mto_imp_venta", "total", "fecha_emision", "estado_sunat", "tipo_doc_nombre", "client_num_doc"];
  function columnasDe(filas) {
    const cols = [];
    for (const f of filas.slice(0, 50)) {
      for (const [k, v] of Object.entries(f)) {
        if (!cols.includes(k) && !OCULTAS.test(k) && (v === null || ["string", "number", "boolean"].includes(typeof v))) cols.push(k);
      }
    }
    const sinRepetir = (cols.includes("numero_completo") ? cols.filter((c) => !["serie", "correlativo"].includes(c)) : cols).filter((c) => PRIORIDAD.includes(c) || filas.some((f) => f[c] !== null && f[c] !== "" && f[c] !== 0 && f[c] !== "0" && f[c] !== "0.00"));
    const peso = (c) => {
      const i = PRIORIDAD.indexOf(c);
      return i < 0 ? PRIORIDAD.length : i;
    };
    return sinRepetir.sort((a, b) => peso(a) - peso(b)).slice(0, 16);
  }
  var NOMBRES = {
    numero_completo: "Comprobante",
    fecha_emision: "Emisión",
    fecha_vencimiento: "Vencimiento",
    tipo_doc: "Tipo (código)",
    tipo_doc_nombre: "Tipo",
    client_tipo_doc: "Tipo doc.",
    client_num_doc: "Documento",
    client_razon_social: "Cliente",
    mto_oper_gravadas: "Gravadas",
    mto_oper_exoneradas: "Exoneradas",
    mto_oper_inafectas: "Inafectas",
    mto_oper_gratuitas: "Gratuitas",
    mto_igv: "IGV",
    mto_isc: "ISC",
    mto_icbper: "ICBPER",
    otros_tributos: "Otros tributos",
    mto_imp_venta: "Total",
    tipo_moneda: "Moneda",
    estado_sunat: "Estado SUNAT",
    venta_neta: "Venta neta",
    total_documentos: "Documentos",
    titulo: "Reporte"
  };
  var etiqueta = (k) => NOMBRES[k] || k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " ");
  var esMonto = (k) => !/(documentos|cantidad|tipo_|_doc$)/i.test(k) && /(total|monto|igv|importe|valor|base|gravad|exonerad|inafect|gratuit|mto_|saldo|subtotal|neta|tributo|isc|icbper)/i.test(k);
  var formatear = (k, v) => esMonto(k) && v !== null && v !== "" && !isNaN(Number(v)) ? soles(Number(v)) : String(v ?? "—");
  function tabla(filas, cols, pie = "") {
    const sumables = cols.filter((c) => esMonto(c) && filas.some((f) => !isNaN(Number(f[c])) && f[c] !== null && f[c] !== ""));
    const sumas = Object.fromEntries(sumables.map((c) => [c, r2(filas.reduce((s, f) => s + (Number(f[c]) || 0), 0))]));
    const total = cols.find((c) => /^(mto_imp_venta|total|importe_total|monto_total)$/i.test(c)) || sumables.at(-1);
    const principal = /* @__PURE__ */ new Set([cols[0], cols.includes("client_razon_social") ? "client_razon_social" : cols[1], total]);
    return tablaDatos({
      filas,
      vacio: "El reporte no tiene filas en este periodo.",
      pie,
      columnas: cols.map((c) => ({
        titulo: etiqueta(c),
        clave: c,
        clase: sumables.includes(c) ? "num" : /fecha|numero_completo/.test(c) ? "nw" : "",
        sec: !principal.has(c),
        celda: (f) => {
          if (c === "estado_sunat") {
            const e = ESTADOS[normalizarEstado(f[c])] || ESTADOS.desconocido;
            return `<span class="pill ${e.clase}">${esc(e.texto)}</span>`;
          }
          if (/numero_completo|num_doc/.test(c)) return `<span class="font-id">${esc(formatear(c, f[c]))}</span>`;
          return esc(formatear(c, f[c]));
        }
      })),
      totales: sumables.length ? (col) => sumables.includes(col.clave) ? esc(soles(sumas[col.clave])) : col.clave === cols[0] ? "Total página" : "" : null
    });
  }
  function reporteCaja(caja, csv) {
    const ventas = store.todos("ventas").filter((v) => v.estado !== "anulada" && v.fecha_emision >= estado.desde && v.fecha_emision <= estado.hasta);
    const metodos = [...METODOS_PAGO, ["credito", "Crédito"]];
    const dias = [...new Set(ventas.map((v) => v.fecha_emision))].sort();
    const clave2 = (v) => v.forma_pago === "Credito" ? "credito" : v.metodo_pago;
    const filas = dias.map((d) => {
      const delDia = ventas.filter((v) => v.fecha_emision === d);
      const fila = { fecha: d, ventas: delDia.length };
      for (const [k] of metodos) fila[k] = r2(delDia.filter((v) => clave2(v) === k).reduce((s, v) => s + v.total, 0));
      fila.total = r2(delDia.reduce((s, v) => s + v.total, 0));
      return fila;
    });
    const usados = metodos.filter(([k]) => filas.some((f) => f[k]));
    estado.filas = filas;
    estado.columnas = ["fecha", "ventas", ...usados.map((m) => m[0]), "total"];
    const sinCpe = ventas.filter((v) => !v.comprobante_id).length;
    const tot = (k) => r2(filas.reduce((s, f) => s + f[k], 0));
    caja.innerHTML = tablaDatos({
      filas,
      vacio: "No hay ventas en este periodo.",
      columnas: [
        { titulo: "Fecha", clave: "fecha", clase: "nw", celda: (f) => esc(f.fecha) },
        { titulo: "Ventas", clave: "ventas", clase: "num", celda: (f) => esc(f.ventas) },
        ...usados.map(([k, t]) => ({ titulo: t, clave: k, clase: "num", sec: true, celda: (f) => f[k] ? esc(soles(f[k])) : "—" })),
        { titulo: "Total", clave: "total", clase: "num", celda: (f) => `<strong>${esc(soles(f.total))}</strong>` }
      ],
      totales: (c) => c.clave === "fecha" ? "Total" : c.clave === "ventas" ? esc(ventas.length) : esc(soles(tot(c.clave)))
    }) + (filas.length ? `<p class="muted small">Montos de las ventas del sistema (comerciales). ${sinCpe ? `${sinCpe} venta(s) aún sin comprobante.` : "Todas tienen comprobante."} Para la declaración usa el Registro de ventas de la API.</p>` : "");
    csv.disabled = false;
  }
  function descargarCsv() {
    if (!estado.filas.length) return;
    const cel = (v) => {
      const s = String(v ?? "");
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lineas = [estado.columnas.map((c) => cel(etiqueta(c))).join(","), ...estado.filas.map((f) => estado.columnas.map((c) => cel(f[c])).join(","))];
    const blob = new Blob(["\uFEFF" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${estado.reporte}_${estado.desde}_${estado.hasta}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
  }

  // src/app.js
  var MENU = [
    { ruta: "inicio", texto: "Inicio", icono: "inicio", grupo: "Operación" },
    { ruta: "vender", texto: "Vender", icono: "vender", grupo: "Operación" },
    { ruta: "ventas", texto: "Ventas", icono: "ventas", grupo: "Operación" },
    { ruta: "comprobantes", texto: "Comprobantes", icono: "comprobantes", grupo: "Facturación" },
    { ruta: "sunat", texto: "Operaciones SUNAT", icono: "sunat", grupo: "Facturación" },
    { ruta: "reportes", texto: "Reportes", icono: "reportes", grupo: "Facturación" },
    { ruta: "clientes", texto: "Clientes", icono: "clientes", grupo: "Catálogo" },
    { ruta: "productos", texto: "Productos", icono: "productos", grupo: "Catálogo" },
    { ruta: "config", texto: "Configuración", icono: "config", grupo: "Administración", admin: true }
  ];
  var GRUPOS = ["Operación", "Facturación", "Catálogo", "Administración"];
  var CLAVE_TEMA = "veterinaria.tema";
  var CLAVE_RIEL = "veterinaria.riel";
  var VISTAS = {
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
    return MENU.filter((m) => !m.admin || admin);
  }
  function pintarMenu(ruta) {
    const raiz = ruta.split("/")[0];
    const lista2 = visibles();
    $("#nav-side").innerHTML = GRUPOS.map((g) => {
      const rutas = lista2.filter((m) => m.grupo === g);
      if (!rutas.length) return "";
      return `
      <div class="riel-grupo">
        <p class="riel-grupo-titulo">${esc(g)}</p>
        <ul class="riel-lista">
          ${rutas.map((m) => `
            <li><a href="#/${m.ruta}" class="riel-enlace ${raiz === m.ruta ? "activo" : ""}" title="${esc(m.texto)}" ${raiz === m.ruta ? 'aria-current="page"' : ""}>
              ${icono(m.icono)}<span class="riel-texto">${esc(m.texto)}</span>
            </a></li>`).join("")}
        </ul>
      </div>`;
    }).join("");
    const u = auth.actual();
    $("#riel-pie").innerHTML = `
    <div class="riel-boton riel-usuario" title="${esc(u.nombre)}">
      <span class="riel-avatar">${esc(u.nombre.charAt(0).toUpperCase())}</span>
      <span class="riel-usuario-texto">
        <span class="riel-usuario-nombre">${esc(u.nombre)}</span>
        <span class="riel-usuario-rol">${esc(ROLES[u.rol] || u.rol)}</span>
      </span>
    </div>
    <button type="button" class="riel-boton" id="btn-logout" title="Cerrar sesión">${icono("salir")}<span>Cerrar sesión</span></button>`;
    $("#btn-logout").addEventListener("click", salir);
  }
  function vistaMas(cont) {
    cont.innerHTML = `
    <h1 class="page-title">Más opciones</h1>
    <div class="menu-list">
      ${visibles().map((m) => `
        <a class="menu-row" href="#/${m.ruta}">${icono(m.icono)}<span>${esc(m.texto)}</span></a>`).join("")}
      <button class="menu-row" type="button" id="mas-salir">${icono("salir")}<span>Cerrar sesión</span></button>
    </div>`;
    $("#mas-salir", cont).addEventListener("click", salir);
  }
  var barraComoPanel = () => window.matchMedia("(max-width: 1023px)").matches;
  function leerPreferencia(clave2) {
    try {
      return localStorage.getItem(clave2);
    } catch {
      return null;
    }
  }
  function guardarPreferencia(clave2, valor) {
    try {
      localStorage.setItem(clave2, valor);
    } catch {
    }
  }
  function alternarMenu() {
    if (barraComoPanel()) {
      document.body.classList.toggle("menu-abierto");
      return;
    }
    const plegado = document.body.classList.toggle("riel-plegado");
    setTimeout(programarAjuste, 220);
    guardarPreferencia(CLAVE_RIEL, plegado ? "plegado" : "abierto");
  }
  function cerrarMenu() {
    document.body.classList.remove("menu-abierto");
  }
  var temaOscuro = () => document.documentElement.classList.contains("dark");
  function pintarBotonesTema() {
    const texto = temaOscuro() ? "Usar tema claro" : "Usar tema oscuro";
    document.querySelectorAll(".boton-tema").forEach((b) => {
      b.innerHTML = icono(temaOscuro() ? "sol" : "luna");
      b.setAttribute("aria-label", texto);
      b.title = texto;
    });
  }
  function alternarTema() {
    const oscuro = !temaOscuro();
    document.documentElement.classList.toggle("dark", oscuro);
    guardarPreferencia(CLAVE_TEMA, oscuro ? "oscuro" : "claro");
    pintarBotonesTema();
  }
  async function enrutar() {
    const usuario = auth.actual();
    if (!usuario) return mostrarAcceso();
    $("#auth").hidden = true;
    $("#app").hidden = false;
    const ruta = location.hash.replace(/^#\/?/, "") || "inicio";
    const raiz = ruta.split("/")[0];
    const item = MENU.find((m) => m.ruta === raiz);
    if (item?.admin && !auth.esAdmin()) {
      location.hash = "#/inicio";
      toast("Solo el administrador puede entrar a Configuración.", "warn");
      return;
    }
    cerrarMenu();
    pintarMenu(ruta);
    const titulo = item?.texto || (raiz === "mas" ? "Más" : "Inicio");
    $("#topbar-title").textContent = titulo;
    document.title = `${titulo} · Veterinaria`;
    const cont = $("#view");
    cont.innerHTML = "";
    try {
      await (VISTAS[raiz] || vistaInicio)(cont, ruta.split("/").slice(1));
    } catch (e) {
      cont.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
    }
    cont.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  function pintarMarca() {
    const c = store.config();
    const nombre = c.nombre_comercial || c.razon_social || "Veterinaria";
    $("#brand-name").textContent = nombre;
    $("#riel-marca").title = nombre;
    $("#barra-negocio").textContent = `${nombre} · `;
    const prod = (c.entorno || "beta") === "production";
    const b = $("#env-badge");
    b.textContent = prod ? "Producción" : "Beta";
    b.className = `pill ${prod ? "pill-ok" : "pill-warn"}`;
    b.title = prod ? "Entorno SUNAT: producción" : "Entorno SUNAT: beta (pruebas)";
  }
  function mostrarAcceso() {
    $("#app").hidden = true;
    const caja = $("#auth");
    caja.hidden = false;
    const primero = !auth.hayUsuarios();
    const c = store.config();
    const fechaLarga = (/* @__PURE__ */ new Date()).toLocaleDateString("es-PE", { timeZone: "America/Lima", weekday: "long", day: "numeric", month: "long", year: "numeric" });
    caja.innerHTML = `
    <div class="ingreso-caja">
      <header>
        <div class="ingreso-marca-fila">
          <span class="riel-logo">${icono("huella")}</span>
          <p class="ingreso-marca">${esc(c.nombre_comercial || c.razon_social || "Veterinaria")}</p>
        </div>
        <p class="ingreso-fecha">${esc(fechaLarga)}</p>
      </header>
      <form class="ingreso-panel auth-card" id="form-auth" novalidate>
        <h2>${primero ? "Crea el administrador" : "Ingresar"}</h2>
        <p class="ingreso-ayuda">${primero ? "Es el primer uso en este navegador. Este usuario podrá configurar todo el sistema." : "Ingresa tu usuario y contraseña."}</p>
        ${motivoSalida ? `<p class="notice notice-info small">${esc(motivoSalida)}</p>` : ""}
        ${primero ? campo({ nombre: "nombre", etiqueta: "Nombre", req: true, attrs: 'autocomplete="name"' }) : ""}
        ${campo({ nombre: "usuario", etiqueta: "Usuario", req: true, attrs: 'autocomplete="username" autocapitalize="none"' })}
        ${campo({ nombre: "clave", etiqueta: "Contraseña", tipo: "password", req: true, attrs: `autocomplete="${primero ? "new-password" : "current-password"}"`, ayuda: primero ? "Mínimo 8 caracteres, con letras y números. Protege también las credenciales de la API." : "" })}
        ${primero ? campo({ nombre: "clave2", etiqueta: "Repite la contraseña", tipo: "password", req: true, attrs: 'autocomplete="new-password"' }) : ""}
        <p class="form-error" id="auth-error" role="alert"></p>
        <button class="btn btn-primary btn-block" type="submit">${primero ? "Crear y entrar" : "Entrar"}</button>
        ${primero ? '<label class="link-btn file-link">¿Ya tienes un data.json? Impórtalo<input type="file" accept=".json,application/json" id="auth-import" hidden></label>' : ""}
      </form>
      <button class="btn btn-plano boton-tema ingreso-tema" type="button"></button>
    </div>`;
    pintarBotonesTema();
    $(".ingreso-tema", caja).addEventListener("click", alternarTema);
    const form = $("#form-auth");
    const error = $("#auth-error");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      error.textContent = "";
      const d = leerForm(form);
      await conCarga(form.querySelector("[type=submit]"), async () => {
        try {
          if (primero) {
            if (!d.nombre) throw new Error("Escribe tu nombre.");
            if (d.clave !== d.clave2) throw new Error("Las contraseñas no coinciden.");
            await auth.crearUsuario({ nombre: d.nombre, usuario: d.usuario, clave: d.clave, rol: "admin" });
          }
          await auth.ingresar(d.usuario, d.clave);
          motivoSalida = "";
          if (!location.hash || location.hash === "#/") location.hash = "#/inicio";
          await enrutar();
          await alIngresar();
        } catch (e) {
          error.textContent = e.message;
        }
      });
    });
    $("#auth-import")?.addEventListener("change", async (ev) => {
      const archivo = ev.target.files[0];
      if (!archivo) return;
      try {
        await store.importar(archivo, () => pedirContrasena({ titulo: "Respaldo cifrado", texto: "Escribe la contraseña con la que se exportó este respaldo.", textoOk: "Descifrar e importar" }));
        toast("data.json importado. Ingresa con tu usuario.", "ok");
        pintarMarca();
        mostrarAcceso();
      } catch (e) {
        error.textContent = e.message;
      }
    });
    form.querySelector("input")?.focus();
  }
  async function alIngresar() {
    try {
      if (await migrarCredencialesPlanas()) toast("Las credenciales de la API se cifraron en la bóveda.", "ok", 6e3);
    } catch {
    }
    const u = auth.actual();
    if (!modoProxy() && boveda.tieneCredenciales() && !boveda.credenciales()) {
      toast("Tu usuario no tiene acceso a las credenciales de la API. Pide al administrador que cambie tu contraseña desde Usuarios.", "warn", 9e3);
    } else if (!modoProxy() && origenCredenciales() === "config" && u?.rol === "admin") {
      toast("Las credenciales de la API están en texto plano en config.js. Muévelas a la bóveda en Configuración → Credenciales API.", "warn", 9e3);
    } else if (modoProxy() ? window.APP_CONFIG.API_CONFIGURADA === false : !credencialesListas()) {
      toast("Faltan las credenciales de la API: el administrador las pone en Configuración → Credenciales API.", "warn", 8e3);
    } else if (modoProxy() && window.APP_CONFIG.PIN && !getPin()) {
      toast("Este equipo aún no tiene el PIN del servidor: ingrésalo en Configuración → Credenciales API.", "warn", 8e3);
    }
    cargaInicial();
  }
  var motivoSalida = "";
  function vigilarSesion() {
    const tocar = () => auth.tocar();
    for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) document.addEventListener(ev, tocar, { passive: true, capture: true });
    const revisar = () => {
      if (!$("#app").hidden && !auth.actual()) {
        motivoSalida = "Tu sesión se cerró por inactividad. Ingresa de nuevo.";
        document.querySelectorAll("dialog[open]").forEach((d) => d.close());
        mostrarAcceso();
      }
    };
    setInterval(revisar, 2e4);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") revisar();
    });
  }
  function cargaInicial() {
    const sinCredenciales = modoProxy() ? window.APP_CONFIG.API_CONFIGURADA === false : !credencialesListas();
    if (sinCredenciales || store.config().sincronizado_en) return;
    if (modoProxy() && window.APP_CONFIG.PIN && !getPin()) return;
    cargarDatosDeLaApi().then((pasos) => toast(pasos.every((p) => p.ok) ? "Datos de la empresa cargados desde la API." : "Datos cargados desde la API. Revisa lo pendiente en Configuración.", pasos.every((p) => p.ok) ? "ok" : "warn", 6e3)).catch(() => {
    });
  }
  function salir() {
    auth.salir();
    location.hash = "#/inicio";
    mostrarAcceso();
  }
  async function iniciar() {
    if (!window.APP_CONFIG) {
      window.APP_CONFIG = { API_URL: "", API_KEY: "", API_SECRET: "", DATA_URL: "data.json" };
    }
    const r = await store.init();
    if (r.aviso) toast(`Base nueva vacía: ${r.aviso}`, "warn", 7e3);
    if (location.protocol === "file:" && modoProxy()) toast("Abriste el archivo directamente: el modo servidor necesita abrir la dirección del servidor (http://...).", "error", 9e3);
    definirVerificadorRol((rol) => rol === "admin" ? auth.esAdmin() : Boolean(auth.actual()));
    if (auth.actual()) await boveda.cargar();
    else boveda.cerrar();
    vigilarSesion();
    store.alCambiar(pintarMarca);
    pintarMarca();
    document.body.classList.toggle("riel-plegado", leerPreferencia(CLAVE_RIEL) === "plegado");
    $("#riel-logo").innerHTML = icono("huella");
    $("#btn-menu").innerHTML = icono("menu");
    $("#btn-menu").addEventListener("click", alternarMenu);
    $("#velo").addEventListener("click", cerrarMenu);
    $("#btn-tema").addEventListener("click", alternarTema);
    pintarBotonesTema();
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && document.body.classList.contains("menu-abierto")) cerrarMenu();
    });
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", (ev) => {
      if (leerPreferencia(CLAVE_TEMA)) return;
      document.documentElement.classList.toggle("dark", ev.matches);
      pintarBotonesTema();
    });
    activarTablas($("#view"));
    new MutationObserver(programarAjuste).observe($("#view"), { childList: true, subtree: true });
    window.addEventListener("hashchange", enrutar);
    await enrutar();
    if (auth.actual()) cargaInicial();
  }
  iniciar();
})();
