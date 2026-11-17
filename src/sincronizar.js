// Trae de la API lo que el sistema necesita para vender: datos de la empresa, la sucursal
// por defecto y las series por defecto. Se usa al guardar credenciales nuevas y al abrir el
// sistema por primera vez. Solo completa lo que falta o ya no es válido: no pisa lo elegido a mano.
import { store } from './store.js';
import { api, comoLista } from './api.js';

// Serie por defecto → código SUNAT del documento y letra con la que debe empezar.
const DEFECTOS = [
  ['serie_factura', '01', 'F', 'Factura'],
  ['serie_boleta', '03', 'B', 'Boleta'],
  ['serie_nc_factura', '07', 'F', 'Nota de crédito (facturas)'],
  ['serie_nc_boleta', '07', 'B', 'Nota de crédito (boletas)'],
  ['serie_nd_factura', '08', 'F', 'Nota de débito (facturas)'],
  ['serie_nd_boleta', '08', 'B', 'Nota de débito (boletas)'],
  ['serie_guia', '09', 'T', 'Guía de remisión']
];
const CODIGO_POR_TIPO = { factura: '01', boleta: '03', nota_credito: '07', nota_debito: '08', guia_remision: '09' };

// Copia a la configuración local solo los datos que el POS necesita a mano.
export function sincronizarEmpresa(e) {
  if (!e || typeof e !== 'object') return;
  const campos = ['ruc', 'razon_social', 'nombre_comercial', 'direccion', 'ubigeo', 'entorno', 'tax_regime', 'plan', 'igv_rate_override', 'tasa_igv_vigente', 'nrus_categoria'];
  const copia = {};
  for (const k of campos) if (e[k] !== undefined) copia[k] = e[k];
  if (Object.keys(copia).length) store.setConfig(copia);
}

const activa = s => { const v = s.activo ?? s.is_active; return v !== false && v !== 0; };
const codigoDe = s => String(s.tipo_documento ?? CODIGO_POR_TIPO[s.tipo] ?? '');
const sucursalDe = s => s.sucursal?.id ?? s.sucursal_id ?? null;

// Devuelve un resumen: [{ texto, ok }] para mostrar al usuario.
export async function cargarDatosDeLaApi() {
  const pasos = [];

  const r = await api.empresa();
  const e = r.datos?.empresa || r.datos || {};
  sincronizarEmpresa(e);
  pasos.push({ ok: true, texto: `Empresa: ${e.razon_social || 'sin nombre'}${e.ruc ? ` · RUC ${e.ruc}` : ''}` });
  pasos.push({ ok: true, texto: `Entorno SUNAT: ${e.entorno === 'production' ? 'producción' : 'beta (pruebas)'}` });

  let sucursalId = store.config().sucursal_id;
  try {
    const sucs = comoLista((await api.sucursales()).datos);
    let elegida = sucs.find(s => String(s.id) === String(sucursalId));
    if (!elegida) {
      elegida = sucs.find(s => s.es_principal) || sucs.find(s => ['0000', '0001'].includes(String(s.cod_local))) || sucs[0];
      if (elegida) store.setConfig({ sucursal_id: elegida.id });
    }
    sucursalId = elegida?.id ?? null;
    pasos.push(elegida
      ? { ok: true, texto: `Sucursal del punto de venta: ${elegida.nombre || 'sin nombre'} (${elegida.cod_local || '—'})` }
      : { ok: false, texto: 'La API no tiene sucursales: crea la principal en Configuración → Sucursales.' });
  } catch (err) {
    pasos.push({ ok: false, texto: `No se pudieron leer las sucursales: ${err.message}` });
  }

  try {
    const todas = comoLista((await api.series()).datos).filter(activa);
    // Primero las series de la sucursal elegida; si no hay, cualquiera activa.
    const deSucursal = todas.filter(s => sucursalDe(s) == null || String(sucursalDe(s)) === String(sucursalId));
    const cfg = store.config();
    const cambios = {};
    const faltan = [];
    const elegidas = [];
    for (const [clave, codigo, letra, nombre] of DEFECTOS) {
      const candidatas = (deSucursal.length ? deSucursal : todas)
        .filter(s => codigoDe(s) === codigo && String(s.serie || '').toUpperCase().startsWith(letra))
        .sort((a, b) => String(a.serie).localeCompare(String(b.serie)));
      if (candidatas.some(s => s.serie === cfg[clave])) { elegidas.push(`${nombre} ${cfg[clave]}`); continue; }
      if (candidatas[0]) { cambios[clave] = candidatas[0].serie; elegidas.push(`${nombre} ${candidatas[0].serie}`); }
      else faltan.push(nombre);
    }
    if (Object.keys(cambios).length) store.setConfig(cambios);
    if (elegidas.length) pasos.push({ ok: true, texto: `Series por defecto: ${elegidas.join(', ')}` });
    if (faltan.length) pasos.push({ ok: false, texto: `Sin serie activa para: ${faltan.join(', ')}. Créalas en Configuración → Series.` });
  } catch (err) {
    pasos.push({ ok: false, texto: `No se pudieron leer las series: ${err.message}` });
  }

  store.setConfig({ sincronizado_en: new Date().toISOString() });
  return pasos;
}
