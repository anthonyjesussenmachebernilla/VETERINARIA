// Capa de datos: data.json como formato.
// Modo actual (a): copia de trabajo en el navegador + exportar/importar data.json.
// Para pasar al modo (c) (proxy que escribe data.json en el servidor) solo cambia
// cargarRemoto() y persistir() en este archivo.

import { modoProxy, respaldoServidor } from './api.js';
import { cifrarConContrasena, descifrarConContrasena, FORMATO_RESPALDO } from './cripto.js';

const CLAVE = 'veterinaria.data.v1';
const CLAVE_EQUIPO = 'veterinaria.dispositivo';
const CLAVE_RESPALDO = 'veterinaria.respaldo_servidor';
const ESPERA_RESPALDO = 60000; // tras el último cambio

const TABLAS = [
  'usuarios', 'clientes', 'categorias', 'productos',
  'ventas', 'venta_items', 'comprobantes', 'cuotas'
];

let db = null;
const oyentes = new Set();

// Datos iniciales incluidos en el sistema: se usan al abrir con doble clic (file://),
// donde el navegador no permite leer data.json. Deben coincidir con data.json.
const SEMILLA = {"version": 1, "actualizado_en": null, "usuarios": [], "configuracion": {"sucursal_id": null, "serie_factura": "F001", "serie_boleta": "B001", "serie_nc_factura": "FC01", "serie_nc_boleta": "BC01", "serie_nd_factura": "FD01", "serie_nd_boleta": "BD01", "serie_guia": "T001"}, "clientes": [], "categorias": [{"id": 1, "nombre": "Medicamentos"}, {"id": 2, "nombre": "Alimentos"}, {"id": 3, "nombre": "Accesorios"}, {"id": 4, "nombre": "Consultas"}, {"id": 5, "nombre": "Vacunas"}, {"id": 6, "nombre": "Otros servicios"}], "productos": [], "ventas": [], "venta_items": [], "comprobantes": [], "cuotas": []};

const esArchivoLocal = () => globalThis.location?.protocol === 'file:';

function vacio() {
  const base = { version: 1, actualizado_en: null, configuracion: {} };
  for (const t of TABLAS) base[t] = [];
  return base;
}

function normalizar(datos) {
  const base = vacio();
  if (!datos || typeof datos !== 'object') return base;
  base.version = datos.version ?? 1;
  base.actualizado_en = datos.actualizado_en ?? null;
  base.configuracion = { ...(datos.configuracion || {}) };
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
  const url = window.APP_CONFIG?.DATA_URL || 'data.json';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo leer ${url} (${res.status})`);
  return res.json();
}

function persistir() {
  db.actualizado_en = new Date().toISOString();
  try {
    localStorage.setItem(CLAVE, JSON.stringify(db));
    return true;
  } catch {
    return false;
  }
}

// ---------- Respaldo automático en el servidor (modo proxy) ----------
let temporizador = null;
let pendiente = false;

function leerLS(k) { try { return localStorage.getItem(k); } catch { return null; } }
function escribirLS(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }

function programarRespaldo() {
  if (!modoProxy()) return;
  pendiente = true;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => store.respaldarServidor().catch(() => {}), ESPERA_RESPALDO);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pendiente) store.respaldarServidor().catch(() => {});
  });
}

export const store = {
  // Carga la copia local; si no existe, toma data.json como semilla.
  async init() {
    const local = leerLocal();
    if (local) {
      db = normalizar(local);
      return { origen: 'local' };
    }
    if (esArchivoLocal()) {
      db = normalizar(structuredClone(SEMILLA));
      persistir();
      return { origen: 'semilla' };
    }
    try {
      db = normalizar(await cargarRemoto());
      persistir();
      return { origen: 'data.json' };
    } catch {
      db = normalizar(structuredClone(SEMILLA));
      persistir();
      return { origen: 'semilla' };
    }
  },

  todos(tabla) {
    return [...(db[tabla] || [])];
  },

  buscar(tabla, id) {
    return (db[tabla] || []).find(r => r.id === id) || null;
  },

  donde(tabla, fn) {
    return (db[tabla] || []).filter(fn);
  },

  insertar(tabla, datos) {
    const lista = db[tabla];
    const id = lista.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
    const fila = { id, ...datos, creado_en: new Date().toISOString() };
    lista.push(fila);
    this.guardar();
    return fila;
  },

  actualizar(tabla, id, cambios) {
    const fila = this.buscar(tabla, id);
    if (!fila) throw new Error(`No existe ${tabla} #${id}`);
    Object.assign(fila, cambios, { actualizado_en: new Date().toISOString() });
    this.guardar();
    return fila;
  },

  eliminar(tabla, id) {
    db[tabla] = db[tabla].filter(r => r.id !== id);
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
    oyentes.forEach(fn => fn(ok));
    if (!ok) throw new Error('El navegador no permitió guardar. Exporta data.json ahora para no perder datos.');
  },

  alCambiar(fn) {
    oyentes.add(fn);
    return () => oyentes.delete(fn);
  },

  // Descarga la base completa como data.json. Con contraseña, el archivo va cifrado (AES-256-GCM):
  // sin ella no se puede leer ni modificar sin que se note.
  async exportar(clave = null) {
    db.configuracion.ultimo_respaldo = new Date().toISOString();
    if (clave) db.configuracion.ultimo_respaldo_cifrado = db.configuracion.ultimo_respaldo;
    persistir();
    const contenido = clave ? await cifrarConContrasena(db, clave) : db;
    const blob = new Blob([JSON.stringify(contenido, null, clave ? 0 : 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const fecha = new Date().toISOString().slice(0, 10);
    a.href = URL.createObjectURL(blob);
    a.download = clave ? `data-${fecha}.cifrado.json` : `data-${fecha}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  // Reemplaza la base con un data.json elegido por el usuario. Si viene cifrado, pedirClave() da la contraseña.
  async importar(archivo, pedirClave = null) {
    const txt = await archivo.text();
    let datos;
    try {
      datos = JSON.parse(txt);
    } catch {
      throw new Error('El archivo no es un JSON válido.');
    }
    if (datos?.formato === FORMATO_RESPALDO) {
      const clave = pedirClave ? await pedirClave() : null;
      if (!clave) throw new Error('Importación cancelada: el respaldo está cifrado y necesita su contraseña.');
      datos = await descifrarConContrasena(datos, clave);
    }
    const faltan = TABLAS.filter(t => datos[t] !== undefined && !Array.isArray(datos[t]));
    if (faltan.length) throw new Error(`Formato inválido en: ${faltan.join(', ')}`);
    if (!Array.isArray(datos.usuarios) || !datos.usuarios.length) {
      throw new Error('El archivo no tiene usuarios; no se importó para no dejarte sin acceso.');
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
    const limpio = String(nombre || '').trim().slice(0, 30);
    if (limpio) escribirLS(CLAVE_EQUIPO, limpio);
  },

  ultimoRespaldoServidor() {
    return leerLS(CLAVE_RESPALDO);
  },

  // Envía la copia completa al servidor (una copia por equipo y hora; el servidor guarda 30 días).
  async respaldarServidor() {
    if (!modoProxy()) throw new Error('El respaldo en servidor solo funciona con el servidor del sistema.');
    clearTimeout(temporizador);
    const r = await respaldoServidor('POST', '', { dispositivo: this.dispositivo(), datos: db });
    pendiente = false;
    escribirLS(CLAVE_RESPALDO, new Date().toISOString());
    return r;
  },

  resumen() {
    const r = { actualizado_en: db.actualizado_en };
    for (const t of TABLAS) r[t] = db[t].length;
    return r;
  }
};
