// Operaciones tributarias posteriores a la venta: notas, bajas, resumen diario, guías y pagos.
import { store } from './store.js';
import { api, comoLista } from './api.js';
import { r2, errorDocumento } from './validar.js';
import { hoyLima, leerCpe, normalizarEstado, comprobanteLocal, TIPOS_CPE } from './comprobantes.js';

export const PLAZO_DIAS = 7;

// Catálogo 09 (motivos de nota de crédito, sin los de exportación e IVAP).
export const MOTIVOS_NC = [
  ['01', 'Anulación de la operación'],
  ['02', 'Anulación por error en el RUC'],
  ['03', 'Corrección por error en la descripción'],
  ['04', 'Descuento global'],
  ['05', 'Descuento por ítem'],
  ['06', 'Devolución total'],
  ['07', 'Devolución por ítem'],
  ['08', 'Bonificación'],
  ['09', 'Disminución en el valor'],
  ['10', 'Otros conceptos']
];
// Motivos que devuelven todo el comprobante.
export const MOTIVOS_NC_TOTAL = ['01', '02', '06'];

// Catálogo 10 (motivos de nota de débito).
export const MOTIVOS_ND = [
  ['01', 'Intereses por mora'],
  ['02', 'Aumento en el valor'],
  ['03', 'Penalidades / otros conceptos']
];

// Catálogo 20 (motivos de traslado más usados por un comercio).
export const MOTIVOS_TRASLADO = [
  ['01', 'Venta'],
  ['04', 'Traslado entre establecimientos de la misma empresa'],
  ['13', 'Otros']
];

export function diasDesde(fecha, hoy = hoyLima()) {
  if (!fecha) return Infinity;
  return Math.round((Date.parse(hoy) - Date.parse(String(fecha).slice(0, 10))) / 864e5);
}

export const dentroDePlazo = fecha => diasDesde(fecha) <= PLAZO_DIAS;

export function diasRestantes(fecha) {
  return PLAZO_DIAS - diasDesde(fecha);
}

// ---------- Notas de crédito y débito ----------
export const totalItems = items => r2(items.reduce((s, it) => s + Number(it.cantidad) * Number(it.precio_unitario), 0));

// Suma de NC ya emitidas sobre un comprobante (según la copia local).
export function totalNcPrevias(origenTipo, origenApiId) {
  return r2(store.todos('comprobantes')
    .filter(c => c.tipo === '07' && c.origen_tipo === origenTipo && String(c.origen_api_id) === String(origenApiId))
    .filter(c => !['rechazado', 'anulado'].includes(c.sunat_status) && !c.reemplazado)
    .reduce((s, c) => s + Number(c.total_oficial ?? c.total_local ?? 0), 0));
}

export function serieNota(tipoNota, origenSerie) {
  const cfg = store.config();
  const deFactura = String(origenSerie || '').startsWith('F');
  if (tipoNota === '07') return deFactura ? cfg.serie_nc_factura : cfg.serie_nc_boleta;
  return deFactura ? cfg.serie_nd_factura : cfg.serie_nd_boleta;
}

export function validarNota({ tipoNota, origen, motivo, descripcion, items, serie }) {
  if (!['aceptado', 'observado'].includes(origen.sunat_status)) return 'Solo se emiten notas sobre comprobantes aceptados por SUNAT.';
  if (!serie) return 'Falta la serie de la nota en Configuración → Series.';
  const esperado = String(origen.serie).startsWith('F') ? 'F' : 'B';
  if (!String(serie).startsWith(esperado)) return `La serie de la nota debe empezar con ${esperado}, igual que el comprobante.`;
  const motivos = tipoNota === '07' ? MOTIVOS_NC : MOTIVOS_ND;
  if (!motivos.some(m => m[0] === motivo)) return 'Elige el motivo.';
  if (!descripcion || descripcion.trim().length < 4) return 'Describe el motivo (mínimo 4 caracteres).';
  if (!items.length) return 'La nota debe tener al menos un ítem.';
  for (const it of items) {
    if (!it.descripcion?.trim()) return 'Cada ítem necesita descripción.';
    if (!(Number(it.cantidad) > 0)) return `Cantidad inválida en "${it.descripcion}".`;
    if (!(Number(it.precio_unitario) > 0)) return `Precio inválido en "${it.descripcion}".`;
  }
  if (tipoNota === '07' && origen.total_oficial != null) {
    const saldo = r2(Number(origen.total_oficial) - totalNcPrevias(origen.tipo, origen.api_id));
    const total = totalItems(items);
    if (total - saldo > 0.01) return `La nota (S/ ${total.toFixed(2)}) supera el saldo del comprobante (S/ ${saldo.toFixed(2)}).`;
  }
  return null;
}

export function armarNota({ tipoNota, origen, motivo, descripcion, items, serie }) {
  return {
    serie,
    fecha_emision: hoyLima(),
    tipo_moneda: 'PEN',
    doc_afectado_tipo: origen.tipo,
    doc_afectado_serie: origen.serie,
    doc_afectado_correlativo: String(origen.correlativo),
    cod_motivo: motivo,
    des_motivo: descripcion.trim(),
    cliente: Object.fromEntries(Object.entries({
      tipo_doc: origen.cliente.tipo_doc, num_doc: origen.cliente.num_doc,
      razon_social: origen.cliente.razon_social, direccion: origen.cliente.direccion
    }).filter(([, v]) => v)),
    items: items.map(it => {
      const i = {
        descripcion: it.descripcion.trim(), unidad: it.unidad || 'NIU',
        cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), tip_afe_igv: it.tip_afe_igv || '10'
      };
      if (it.codigo) i.codigo = it.codigo;
      return i;
    })
  };
}

// Emite la nota y la registra localmente enlazada a su comprobante de origen.
export async function emitirNota(datos, { devolverStock = false } = {}) {
  const error = validarNota(datos);
  if (error) throw new Error(error);
  const body = armarNota(datos);
  const ruta = TIPOS_CPE[datos.tipoNota].ruta;
  const r = await api.emitirNota(ruta, body);
  const cpe = leerCpe(r.datos);
  const origenLocal = comprobanteLocal(datos.origen.tipo, datos.origen.api_id);
  const nota = store.insertar('comprobantes', {
    venta_id: null,
    tipo: datos.tipoNota,
    serie: cpe.serie || body.serie,
    correlativo: cpe.correlativo,
    api_id: cpe.api_id,
    sunat_status: cpe.sunat_status === 'desconocido' ? 'enviado' : cpe.sunat_status,
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
  if (devolverStock && datos.tipoNota === '07') devolverAlStock(datos.items, origenLocal);
  return nota;
}

// Devuelve al stock los productos de la nota (busca por código en el catálogo local).
export function devolverAlStock(items, origenLocal) {
  for (const it of items) {
    const p = store.todos('productos').find(x => x.codigo === it.codigo);
    if (p?.controla_stock) store.actualizar('productos', p.id, { stock: r2(Number(p.stock || 0) + Number(it.cantidad)) });
  }
  if (origenLocal?.venta_id) store.actualizar('ventas', origenLocal.venta_id, { devolucion_registrada: true });
}

// ---------- Comunicación de baja (facturas, NC, ND) ----------
export function puedeBaja(c) {
  if (!['01', '07', '08'].includes(c.tipo)) return 'Las boletas se anulan con resumen diario, no con baja.';
  if (!['aceptado', 'observado'].includes(c.sunat_status)) return 'Solo se dan de baja comprobantes aceptados.';
  if (!dentroDePlazo(c.fecha_emision)) return `Pasaron más de ${PLAZO_DIAS} días: usa una nota de crédito.`;
  return null;
}

export async function comunicarBaja(c, motivo) {
  const error = puedeBaja(c);
  if (error) throw new Error(error);
  if (!motivo || motivo.trim().length < 4) throw new Error('Describe el motivo de la baja.');
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

// ---------- Resumen diario (boletas) ----------
export async function boletasPendientes() {
  const r = await api.listarComprobantes('boletas', { sunat_status: 'pendiente', por_pagina: 200 });
  return comoLista(r.datos).map(x => ({ ...leerCpe(x), fecha_emision: (x.fecha_emision ?? '').slice(0, 10), cliente: x.client_razon_social ?? x.cliente?.razon_social ?? '' }));
}

export function agruparPorFecha(boletas) {
  const grupos = new Map();
  for (const b of boletas) {
    const f = b.fecha_emision || 'sin fecha';
    if (!grupos.has(f)) grupos.set(f, []);
    grupos.get(f).push(b);
  }
  return [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([fecha, lista]) => ({ fecha, lista, total: r2(lista.reduce((s, b) => s + Number(b.total_oficial || 0), 0)), restantes: diasRestantes(fecha) }));
}

export async function enviarResumen(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha de resumen inválida.');
  if (fecha > hoyLima()) throw new Error('No se envía un resumen de una fecha futura.');
  return api.crearResumen({ fecha_resumen: fecha });
}

export function puedeAnularBoleta(c) {
  if (c.tipo !== '03') return 'Solo boletas.';
  if (!['aceptado', 'observado'].includes(c.sunat_status)) return 'Solo se anulan por resumen las boletas aceptadas. Si no fue aceptada, elimínala.';
  if (!dentroDePlazo(c.fecha_emision)) return `Pasaron más de ${PLAZO_DIAS} días: usa una nota de crédito.`;
  return null;
}

export async function anularBoletaPorResumen(c, motivo) {
  const error = puedeAnularBoleta(c);
  if (error) throw new Error(error);
  if (!motivo || motivo.trim().length < 4) throw new Error('Describe el motivo de la anulación.');
  const r = await api.crearResumen({ fecha_resumen: c.fecha_emision, anular: [{ id: c.api_id, motivo: motivo.trim() }] });
  marcarLocal('03', c.api_id, { baja_api_id: r.datos?.id ?? null, baja_tipo: 'resumen', baja_estado: 'enviado' });
  return r;
}

// Aplica el resultado de una baja o anulación por resumen al comprobante local.
export function aplicarResultadoBaja(tipo, apiId, estado) {
  const cambios = { baja_estado: estado };
  if (estado === 'aceptado') cambios.sunat_status = 'anulado';
  marcarLocal(tipo, apiId, cambios);
}

function marcarLocal(tipo, apiId, cambios) {
  const local = comprobanteLocal(tipo, apiId);
  if (local) store.actualizar('comprobantes', local.id, cambios);
}

// Estado de una baja o resumen leyendo la respuesta (formato no documentado).
export function leerEstadoProceso(datos) {
  const d = datos?.anulacion || datos?.resumen || datos || {};
  const s = d.sunat && typeof d.sunat === 'object' ? d.sunat : {};
  return {
    estado: normalizarEstado(d.sunat_status ?? s.estado ?? d.estado_sunat ?? d.estado ?? d.status),
    mensaje: s.descripcion ?? d.descripcion_sunat ?? d.sunat_description ?? d.mensaje_sunat ?? d.mensaje ?? null,
    ticket: d.ticket ?? s.ticket ?? d.sunat_ticket ?? null,
    detalles: d.detalles ?? d.boletas ?? d.documentos ?? []
  };
}

// ---------- Pagos (crédito) ----------
export const sumaPagos = pagos => r2(pagos.reduce((s, p) => s + Number(p.monto || 0), 0));

export function validarPago(p, saldo) {
  if (!(Number(p.monto) > 0)) return 'El monto debe ser mayor a 0.';
  if (saldo != null && Number(p.monto) - saldo > 0.009) return `El pago supera el saldo (S/ ${saldo.toFixed(2)}).`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha || '')) return 'Fecha inválida.';
  if (p.fecha > hoyLima()) return 'La fecha del pago no puede ser futura.';
  return null;
}

// ---------- Guía de remisión remitente ----------
export function validarGuia(g) {
  if (!g.serie || !/^T[A-Z0-9]{3}$/.test(g.serie)) return 'Serie de guía inválida (debe empezar con T).';
  const errDest = errorDocumento(g.destinatario.tipo_doc, g.destinatario.num_doc);
  if (errDest) return `Destinatario: ${errDest}`;
  if (!g.destinatario.razon_social) return 'Escribe el nombre del destinatario.';
  if (!MOTIVOS_TRASLADO.some(m => m[0] === g.cod_traslado)) return 'Elige el motivo de traslado.';
  if (!g.fecha_traslado || g.fecha_traslado < g.fecha_emision) return 'La fecha de traslado no puede ser anterior a la emisión.';
  if (!(Number(g.peso_total) > 0)) return 'El peso total debe ser mayor a 0.';
  for (const [k, n] of [['partida', 'partida'], ['llegada', 'llegada']]) {
    if (!/^\d{6}$/.test(g[`${k}_ubigeo`] || '')) return `Ubigeo de ${n} inválido (6 dígitos).`;
    if (!(g[`${k}_direccion`] || '').trim()) return `Escribe la dirección de ${n}.`;
  }
  if (g.cod_traslado === '04' && (g.partida_cod_local === g.llegada_cod_local)) return 'En traslado entre establecimientos, partida y llegada deben ser locales distintos.';
  if (g.mod_traslado === '01') {
    const t = g.transportista || {};
    if (t.tipo_doc !== '6' || errorDocumento('6', t.num_doc)) return 'Transporte público: el transportista debe tener RUC válido.';
    if (!t.razon_social) return 'Escribe la razón social del transportista.';
  } else if (!g.m1l) {
    if (!/^[A-Z0-9]{5,8}$/.test(g.vehiculo?.placa || '')) return 'Placa del vehículo inválida (sin guiones).';
    const c = g.conductor || {};
    if (errorDocumento(c.tipo_doc, c.num_doc)) return 'Documento del conductor inválido.';
    if (!c.nombres || !c.apellidos || !c.licencia) return 'Completa nombres, apellidos y licencia del conductor.';
  }
  if (!g.items.length) return 'Agrega al menos un bien a trasladar.';
  for (const it of g.items) {
    if (!it.descripcion?.trim() || !(Number(it.cantidad) > 0)) return 'Cada bien necesita descripción y cantidad.';
  }
  return null;
}

export function armarGuia(g) {
  const body = {
    serie: g.serie,
    fecha_emision: g.fecha_emision,
    destinatario: { tipo_doc: g.destinatario.tipo_doc, num_doc: g.destinatario.num_doc, razon_social: g.destinatario.razon_social },
    cod_traslado: g.cod_traslado,
    mod_traslado: g.mod_traslado,
    fecha_traslado: g.fecha_traslado,
    peso_total: Number(g.peso_total),
    und_peso_total: 'KGM',
    partida_ubigeo: g.partida_ubigeo,
    partida_direccion: g.partida_direccion.trim(),
    llegada_ubigeo: g.llegada_ubigeo,
    llegada_direccion: g.llegada_direccion.trim(),
    items: g.items.map(it => ({ codigo: it.codigo || 'ITEM', descripcion: it.descripcion.trim(), cantidad: Number(it.cantidad), unidad: it.unidad || 'NIU' }))
  };
  if (Number(g.num_bultos) > 0) body.num_bultos = Number(g.num_bultos);
  if (g.cod_traslado === '04') {
    const ruc = store.config().ruc;
    Object.assign(body, { partida_ruc: ruc, partida_cod_local: g.partida_cod_local, llegada_ruc: ruc, llegada_cod_local: g.llegada_cod_local });
  }
  if (g.mod_traslado === '01') {
    body.fecha_de_entrega_al_transportista = g.fecha_traslado;
    body.transportista = { tipo_doc: '6', num_doc: g.transportista.num_doc, razon_social: g.transportista.razon_social };
    if (g.transportista.nro_mtc) body.transportista.nro_mtc = g.transportista.nro_mtc;
  } else if (g.m1l) {
    body.indicadores = ['SUNAT_Envio_IndicadorTrasladoVehiculoM1L'];
  } else {
    body.vehiculo = { placa: g.vehiculo.placa };
    body.conductor = {
      tipo: 'Principal', tipo_doc: g.conductor.tipo_doc, num_doc: g.conductor.num_doc,
      nombres: g.conductor.nombres.trim().toUpperCase(), apellidos: g.conductor.apellidos.trim().toUpperCase(), licencia: g.conductor.licencia.trim().toUpperCase()
    };
  }
  return body;
}

// Guarda la guía localmente (con su payload, porque el PUT exige el payload completo).
export function guardarGuiaLocal(datosApi, body, existente = null) {
  const cpe = leerCpe(datosApi);
  const campos = {
    tipo: '09', venta_id: null, serie: cpe.serie || body.serie, correlativo: cpe.correlativo ?? existente?.correlativo ?? null,
    api_id: cpe.api_id ?? existente?.api_id, sunat_status: cpe.sunat_status === 'desconocido' ? 'enviado' : cpe.sunat_status,
    mensaje_sunat: cpe.mensaje_sunat, cliente_num_doc: body.destinatario.num_doc, fecha_emision: body.fecha_emision, payload: body
  };
  return existente ? store.actualizar('comprobantes', existente.id, campos) : store.insertar('comprobantes', campos);
}
