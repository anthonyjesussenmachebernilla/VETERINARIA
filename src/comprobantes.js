// Lógica de venta y emisión. Separa tres hechos:
//   venta (comercial, local) → comprobante registrado en la API → respuesta de SUNAT.
// Un comprobante solo se muestra como aceptado cuando la API devuelve ese estado.
import { store } from './store.js';
import { api, comoLista, queryPdf } from './api.js';
import { r2 } from './validar.js';
import { visorPdf } from './ui.js';

export const TIPOS_CPE = {
  '01': { ruta: 'facturas', nombre: 'Factura' },
  '03': { ruta: 'boletas', nombre: 'Boleta' },
  '07': { ruta: 'notas-credito', nombre: 'Nota de crédito' },
  '08': { ruta: 'notas-debito', nombre: 'Nota de débito' }
};

export const METODOS_PAGO = [
  ['efectivo', 'Efectivo'],
  ['yape', 'Yape'],
  ['plin', 'Plin'],
  ['tarjeta', 'Tarjeta'],
  ['transferencia', 'Transferencia']
];

export const CONSUMIDOR_FINAL = { tipo_doc: '0', num_doc: '99999999', razon_social: 'CLIENTES VARIOS' };
export const LIMITE_BOLETA_SIN_DNI = 700;

// Fecha de hoy en Lima (YYYY-MM-DD), sin depender de la zona del equipo.
export function hoyLima(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

// ---------- Estados ----------
export const ESTADOS = {
  pendiente: { texto: 'Pendiente de envío', clase: 'pill-warn' },
  enviado: { texto: 'En proceso', clase: 'pill-info' },
  aceptado: { texto: 'Aceptado por SUNAT', clase: 'pill-ok' },
  observado: { texto: 'Aceptado con observaciones', clase: 'pill-ok' },
  rechazado: { texto: 'Rechazado', clase: 'pill-danger' },
  anulado: { texto: 'Anulado', clase: '' },
  error: { texto: 'No emitido', clase: 'pill-danger' },
  desconocido: { texto: 'Estado por confirmar', clase: 'pill-warn' }
};

// Traduce el estado que devuelva la API a uno de ESTADOS. Lo desconocido nunca es aceptado.
export function normalizarEstado(valor) {
  const v = String(valor ?? '').toLowerCase().trim();
  if (!v) return 'desconocido';
  if (/(observ)/.test(v)) return 'observado';
  if (/^(aceptad|accepted|acept)/.test(v)) return 'aceptado';
  if (/(rechaz|reject)/.test(v)) return 'rechazado';
  if (/(anulad|baja|voided)/.test(v)) return 'anulado';
  if (/(enviad|proces|sent|queued|encolad)/.test(v)) return 'enviado';
  if (/(pendient|pending|registrad)/.test(v)) return 'pendiente';
  return 'desconocido';
}

export const esFinal = e => ['aceptado', 'observado', 'rechazado', 'anulado'].includes(e);

// Extrae los campos útiles del comprobante devuelto por la API (formato no documentado).
// La API actual lo entrega anidado: { sunat: { estado, codigo, descripcion, notas }, totales: { total } }.
export function leerCpe(datos) {
  const d = datos?.comprobante || datos?.factura || datos?.boleta || datos || {};
  const s = d.sunat && typeof d.sunat === 'object' ? d.sunat : {};
  const estadoCrudo = d.sunat_status ?? s.estado ?? d.estado_sunat ?? d.status ?? (typeof d.estado === 'string' ? d.estado : undefined);
  const mensaje = s.descripcion ?? d.descripcion_sunat ?? d.sunat_description ?? d.sunat_message ?? d.mensaje_sunat ?? d.cdr_description ?? d.sunat_response?.description ?? null;
  const total = d.totales?.total ?? d.mto_imp_venta ?? d.total ?? d.importe_total ?? d.monto_total ?? null;
  let estado = normalizarEstado(estadoCrudo);
  // Aceptado con notas del CDR = aceptado con observaciones.
  if (estado === 'aceptado' && Array.isArray(s.notas) && s.notas.length) estado = 'observado';
  return {
    api_id: d.id ?? null,
    serie: d.serie ?? null,
    correlativo: d.correlativo ?? d.numero ?? null,
    sunat_status: estado,
    estado_api: estadoCrudo ?? null,
    mensaje_sunat: mensaje,
    codigo_sunat: s.codigo ?? d.sunat_code ?? d.codigo_sunat ?? d.cdr_code ?? null,
    total_oficial: total != null ? Number(total) : null
  };
}

// ---------- Totales (previsualización) ----------
// precio = precio final con IGV. descuento = monto con IGV que se resta de la línea.
export function calcularLinea(it, tasa) {
  const bruto = r2(it.precio * it.cantidad);
  const descuento = r2(Math.min(Math.max(Number(it.descuento) || 0, 0), bruto));
  const importe = r2(bruto - descuento);
  const gravado = it.tip_afe_igv === '10' && tasa > 0;
  const base = gravado ? importe / (1 + tasa / 100) : importe;
  return { bruto, descuento, importe, base, igv: gravado ? importe - base : 0 };
}

export function calcularTotales(items, tasa) {
  const t = { gravado: 0, exonerado: 0, inafecto: 0, igv: 0, descuentos: 0, total: 0 };
  for (const it of items) {
    const l = calcularLinea(it, tasa);
    if (it.tip_afe_igv === '10' && tasa > 0) t.gravado += l.base;
    else if (it.tip_afe_igv === '30') t.inafecto += l.base;
    else t.exonerado += l.base;
    t.igv += l.igv;
    t.descuentos += l.descuento;
    t.total += l.importe;
  }
  for (const k of Object.keys(t)) t[k] = r2(t[k]);
  return t;
}

// ---------- Validación de la venta ----------
export function validarVenta(v, { regimen } = {}) {
  if (!v.items.length) return 'Agrega al menos un producto o servicio.';
  for (const it of v.items) {
    if (!(it.cantidad > 0)) return `Cantidad inválida en "${it.descripcion}".`;
    if (!(it.precio > 0)) return `Precio inválido en "${it.descripcion}".`;
    if (calcularLinea(it, 0).importe <= 0) return `El descuento deja en cero "${it.descripcion}".`;
  }
  const total = calcularTotales(v.items, 0).total;
  const cliente = v.cliente;
  if (v.tipo === '01') {
    if (regimen === 'rus') return 'En Nuevo RUS solo se emiten boletas.';
    if (!cliente || cliente.tipo_doc !== '6') return 'La factura requiere un cliente con RUC.';
  }
  if (v.tipo === '03') {
    const anonimo = !cliente || cliente.tipo_doc === '0';
    if (anonimo && total >= LIMITE_BOLETA_SIN_DNI) {
      return `Boletas de S/ ${LIMITE_BOLETA_SIN_DNI} o más requieren identificar al cliente (DNI, CE o RUC).`;
    }
  }
  if (v.forma_pago === 'Credito') {
    if (v.tipo !== '01') return 'La venta al crédito solo se emite con factura.';
    if (!v.cuotas?.length) return 'Agrega al menos una cuota.';
    const suma = r2(v.cuotas.reduce((s, c) => s + Number(c.monto || 0), 0));
    if (Math.abs(suma - total) > 0.009) return `Las cuotas suman S/ ${suma.toFixed(2)} y el total es S/ ${total.toFixed(2)}.`;
    const hoy = hoyLima();
    let anterior = hoy;
    for (const c of v.cuotas) {
      if (!(Number(c.monto) > 0)) return 'Cada cuota debe ser mayor a 0.';
      if (!c.fecha_pago || c.fecha_pago <= anterior) return 'Las fechas de cuota deben ser posteriores a hoy y en orden.';
      anterior = c.fecha_pago;
    }
  }
  return null;
}

// Cuotas iguales mensuales; la última absorbe el redondeo.
export function generarCuotas(total, n, desde = hoyLima()) {
  const cuotas = [];
  const base = Math.floor((total / n) * 100) / 100;
  const [y, m, d] = desde.split('-').map(Number);
  for (let i = 1; i <= n; i++) {
    const fecha = new Date(Date.UTC(y, m - 1 + i, Math.min(d, 28)));
    cuotas.push({ monto: i === n ? r2(total - base * (n - 1)) : base, fecha_pago: fecha.toISOString().slice(0, 10) });
  }
  return cuotas;
}

// ---------- Payload para la API ----------
// El descuento se aplica al precio unitario: el comprobante muestra el precio final.
export function armarPayload(venta, { serie, soloRegistro = false } = {}) {
  const c = venta.cliente && venta.cliente.tipo_doc !== '0' ? venta.cliente : (venta.cliente || CONSUMIDOR_FINAL);
  const cliente = { tipo_doc: c.tipo_doc, num_doc: c.num_doc, razon_social: c.razon_social };
  if (c.direccion) cliente.direccion = c.direccion;

  const items = venta.items.map(it => {
    const l = calcularLinea(it, 0);
    const unit = Math.round((l.importe / it.cantidad) * 10000) / 10000;
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
    tipo_operacion: '0101',
    tipo_moneda: 'PEN',
    forma_pago: venta.forma_pago === 'Credito' ? 'Credito' : 'Contado',
    cliente,
    items
  };
  if (body.forma_pago === 'Credito') {
    body.cuotas = venta.cuotas.map(q => ({ monto: r2(q.monto), fecha_pago: q.fecha_pago }));
    body.fecha_vencimiento = body.cuotas.at(-1).fecha_pago;
  }
  if (venta.tipo === '03' && soloRegistro) body.solo_registro = true;
  return body;
}

// ---------- Ventas locales ----------
export function registrarVenta(datos, usuario) {
  const t = calcularTotales(datos.items, datos.tasa);
  const venta = store.insertar('ventas', {
    fecha: new Date().toISOString(),
    fecha_emision: hoyLima(),
    usuario_id: usuario.id,
    cliente_id: datos.cliente?.id ?? null,
    cliente: datos.cliente ? { ...datos.cliente } : null,
    tipo_comprobante: datos.tipo, // '01' | '03' | 'ninguno'
    forma_pago: datos.forma_pago,
    metodo_pago: datos.metodo_pago,
    recibido: datos.recibido ?? null,
    cuotas: datos.forma_pago === 'Credito' ? datos.cuotas : [],
    subtotal: r2(t.gravado + t.exonerado + t.inafecto),
    igv: t.igv,
    total: t.total,
    estado: 'registrada',
    comprobante_id: null,
    emision: null // { estado: 'en_curso'|'error'|'incierta', mensaje, intento_en }
  });
  for (const it of datos.items) {
    store.insertar('venta_items', {
      venta_id: venta.id, producto_id: it.producto_id ?? null, codigo: it.codigo, descripcion: it.descripcion,
      unidad: it.unidad, cantidad: it.cantidad, precio: it.precio, descuento: Number(it.descuento) || 0,
      tip_afe_igv: it.tip_afe_igv, cod_producto_sunat: it.cod_producto_sunat || ''
    });
    moverStock(it.producto_id, -it.cantidad);
  }
  return venta;
}

function moverStock(productoId, delta) {
  const p = productoId ? store.buscar('productos', productoId) : null;
  if (p?.controla_stock) store.actualizar('productos', p.id, { stock: r2(Number(p.stock || 0) + delta) });
}

export function itemsDeVenta(ventaId) {
  return store.donde('venta_items', i => i.venta_id === ventaId);
}

// Anula una venta sin comprobante (operación comercial, no tributaria).
export function anularVenta(venta) {
  if (venta.comprobante_id) throw new Error('La venta ya tiene comprobante: se anula con nota de crédito o baja.');
  if (venta.emision?.estado === 'incierta') throw new Error('Primero confirma si el comprobante llegó a emitirse.');
  for (const it of itemsDeVenta(venta.id)) moverStock(it.producto_id, it.cantidad);
  return store.actualizar('ventas', venta.id, { estado: 'anulada' });
}

// ---------- Emisión ----------
const enCurso = new Set();

export async function emitirVenta(ventaId) {
  if (enCurso.has(ventaId)) throw new Error('Esta venta ya se está emitiendo.');
  const venta = store.buscar('ventas', ventaId);
  if (!venta) throw new Error('Venta no encontrada.');
  if (venta.estado === 'anulada') throw new Error('La venta está anulada.');
  if (venta.comprobante_id) throw new Error('La venta ya tiene comprobante.');
  if (!TIPOS_CPE[venta.tipo_comprobante]) throw new Error('Elige boleta o factura para emitir.');

  const cfg = store.config();
  const tipo = venta.tipo_comprobante;
  const serie = tipo === '01' ? cfg.serie_factura : cfg.serie_boleta;
  if (!serie) throw new Error('Falta la serie por defecto en Configuración → Series.');

  const items = itemsDeVenta(venta.id);
  const error = validarVenta({ ...venta, tipo, items, cliente: venta.cliente }, { regimen: cfg.tax_regime });
  if (error) throw new Error(error);

  const body = armarPayload({ ...venta, tipo, items }, { serie, soloRegistro: Boolean(cfg.boletas_por_resumen) });
  enCurso.add(ventaId);
  store.actualizar('ventas', venta.id, { emision: { estado: 'en_curso', intento_en: new Date().toISOString() } });
  try {
    const r = await api.emitir(TIPOS_CPE[tipo].ruta, body);
    return guardarComprobante(venta, tipo, serie, r.datos, r.mensaje);
  } catch (e) {
    // Sin respuesta: el comprobante pudo crearse en la API. No se reintenta a ciegas.
    const estado = e.red ? 'incierta' : 'error';
    store.actualizar('ventas', venta.id, {
      emision: { estado, mensaje: e.message, detalle: e.detalle?.() || [], intento_en: new Date().toISOString() }
    });
    throw e;
  } finally {
    enCurso.delete(ventaId);
  }
}

function guardarComprobante(venta, tipo, serie, datos, mensajeApi) {
  const cpe = leerCpe(datos);
  const comp = store.insertar('comprobantes', {
    venta_id: venta.id,
    tipo,
    serie: cpe.serie || serie,
    correlativo: cpe.correlativo,
    api_id: cpe.api_id,
    sunat_status: cpe.sunat_status === 'desconocido' ? 'enviado' : cpe.sunat_status,
    estado_api: cpe.estado_api,
    mensaje_sunat: cpe.mensaje_sunat || null,
    codigo_sunat: cpe.codigo_sunat,
    mensaje_api: mensajeApi || null,
    total_oficial: cpe.total_oficial,
    cliente_num_doc: venta.cliente?.num_doc || CONSUMIDOR_FINAL.num_doc,
    comprobante_origen_id: null,
    fecha_emision: venta.fecha_emision
  });
  store.actualizar('ventas', venta.id, { comprobante_id: comp.id, emision: null });
  return comp;
}

// Consulta el estado actual en la API y actualiza la copia local.
export async function actualizarEstado(compId) {
  const c = store.buscar('comprobantes', compId);
  if (!c?.api_id) throw new Error('Este comprobante no tiene id de la API.');
  const r = await api.comprobante(TIPOS_CPE[c.tipo].ruta, c.api_id);
  const cpe = leerCpe(r.datos);
  const cambios = {
    sunat_status: cpe.sunat_status === 'desconocido' ? c.sunat_status : cpe.sunat_status,
    estado_api: cpe.estado_api ?? c.estado_api,
    mensaje_sunat: cpe.mensaje_sunat ?? c.mensaje_sunat,
    codigo_sunat: cpe.codigo_sunat ?? c.codigo_sunat,
    consultado_en: new Date().toISOString()
  };
  if (cpe.correlativo != null) cambios.correlativo = cpe.correlativo;
  if (cpe.total_oficial != null) cambios.total_oficial = cpe.total_oficial;
  return { comprobante: store.actualizar('comprobantes', c.id, cambios), crudo: r.crudo };
}

// Consulta varias veces hasta tener estado final o agotar intentos.
export async function esperarEstado(compId, { intentos = 8, cadaMs = 2500, alCambiar = () => {}, cancelado = () => false } = {}) {
  let c = store.buscar('comprobantes', compId);
  for (let i = 0; i < intentos && !esFinal(c.sunat_status) && c.sunat_status !== 'pendiente'; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 1200 : cadaMs));
    if (cancelado()) return c;
    try {
      c = (await actualizarEstado(compId)).comprobante;
      alCambiar(c);
    } catch {
      // Error transitorio: se reintenta en la siguiente vuelta.
    }
  }
  return c;
}

// Tras un corte de red, busca si el comprobante sí se creó (mismo cliente, fecha y total).
export async function buscarEmitido(ventaId) {
  const venta = store.buscar('ventas', ventaId);
  const tipo = venta.tipo_comprobante;
  const cfg = store.config();
  const serie = tipo === '01' ? cfg.serie_factura : cfg.serie_boleta;
  const r = await api.listarComprobantes(TIPOS_CPE[tipo].ruta, {
    fecha_desde: venta.fecha_emision, fecha_hasta: venta.fecha_emision,
    client_num_doc: venta.cliente?.num_doc || CONSUMIDOR_FINAL.num_doc, serie, por_pagina: 50
  });
  const usados = new Set(store.todos('comprobantes').map(c => String(c.api_id)));
  const candidatos = comoLista(r.datos)
    .filter(x => !usados.has(String(x.id)))
    .filter(x => {
      const t = leerCpe(x).total_oficial;
      return t == null || Math.abs(t - venta.total) < 0.011;
    });
  if (candidatos.length === 1) {
    return guardarComprobante(venta, tipo, serie, candidatos[0], 'Recuperado tras corte de conexión');
  }
  return { encontrados: candidatos.length };
}

// Marca la emisión incierta como revisada para permitir reintentar.
export function descartarIncierta(ventaId) {
  store.actualizar('ventas', ventaId, { emision: { estado: 'error', mensaje: 'Revisado: no se encontró el comprobante en la API.' } });
}

// ---------- Archivos ----------
export const numeroCpe = c => c?.correlativo != null ? `${c.serie}-${c.correlativo}` : (c?.serie ? `${c.serie}-…` : '—');

// Descarga y abre un archivo. Abre la pestaña antes de esperar para evitar el bloqueo de ventanas.
export async function abrirArchivo(comp, tipo, formato = 'ticket-80') {
  const ruta = TIPOS_CPE[comp.tipo].ruta;
  const extension = tipo === 'pdf' ? 'pdf' : tipo === 'xml' ? 'xml' : 'zip';
  const nombre = `${comp.serie}-${comp.correlativo ?? comp.api_id}${tipo === 'cdr' ? '-CDR' : ''}.${extension}`;
  const ventana = tipo === 'pdf' ? window.open('', '_blank') : null;
  try {
    const blob = await api.archivo(ruta, comp.api_id, tipo, tipo === 'pdf' ? queryPdf(formato) : undefined);
    const url = URL.createObjectURL(blob);
    if (ventana && !ventana.closed) {
      ventana.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    if (ventana && !ventana.closed) ventana.close();
    throw e;
  }
}

// Tamaños de impresión que entrega la API.
export const FORMATOS_PDF = [['ticket-80', 'Ticket 80 mm'], ['ticket-58', '58 mm'], ['a4', 'A4'], ['a5', 'A5']];

// Muestra el PDF del comprobante en el visor, listo para imprimir.
export function verComprobante(comp) {
  if (!comp?.api_id) return null;
  const ruta = TIPOS_CPE[comp.tipo]?.ruta;
  if (!ruta) return null;
  return visorPdf({
    titulo: `${TIPOS_CPE[comp.tipo].nombre} ${numeroCpe(comp)}`,
    subtitulo: ESTADOS[comp.sunat_status]?.texto || '',
    formatos: FORMATOS_PDF,
    cargar: formato => api.archivo(ruta, comp.api_id, 'pdf', queryPdf(formato)),
    nombre: formato => `${comp.serie}-${comp.correlativo ?? comp.api_id}-${formato}.pdf`
  });
}

// ---------- Bandeja (etapa 4) ----------
export const TIPO_POR_RUTA = Object.fromEntries(Object.entries(TIPOS_CPE).map(([t, v]) => [v.ruta, t]));

// Cliente del comprobante, venga anidado o en columnas planas.
export function leerClienteCpe(d) {
  const c = d?.cliente || d?.client || {};
  return {
    tipo_doc: String(c.tipo_doc ?? c.tipo_documento ?? d?.client_tipo_doc ?? d?.cliente_tipo_doc ?? ''),
    num_doc: String(c.num_doc ?? c.numero_documento ?? d?.client_num_doc ?? d?.cliente_num_doc ?? ''),
    razon_social: c.razon_social ?? c.rzn_social ?? d?.client_razon_social ?? d?.client_rzn_social ?? d?.cliente_razon_social ?? '',
    direccion: c.direccion ?? d?.client_direccion ?? ''
  };
}

export function leerItemsCpe(d) {
  const lista = d?.items ?? d?.detalles ?? d?.details ?? [];
  if (!Array.isArray(lista)) return [];
  return lista.map(x => ({
    codigo: x.codigo ?? x.cod_producto ?? '',
    descripcion: x.descripcion ?? x.des_item ?? x.description ?? '',
    unidad: x.unidad ?? x.unidad_medida ?? 'NIU',
    cantidad: Number(x.cantidad ?? 0),
    precio_unitario: Number(x.precio_unitario ?? x.mto_precio_unitario ?? x.precio ?? 0),
    tip_afe_igv: String(x.tip_afe_igv ?? x.tipo_afectacion ?? '10'),
    cod_producto_sunat: x.cod_producto_sunat ?? ''
  }));
}

// Fila de la bandeja a partir de lo que devuelva la API.
export function leerFila(x, ruta) {
  const cpe = leerCpe(x);
  return {
    ...cpe,
    ruta,
    tipo: TIPO_POR_RUTA[ruta],
    fecha_emision: x.fecha_emision ?? x.fecha ?? x.created_at?.slice(0, 10) ?? '',
    cliente: leerClienteCpe(x),
    afectado: x.doc_afectado_serie ? `${x.doc_afectado_serie}-${x.doc_afectado_correlativo}` : null
  };
}

// Copia a los comprobantes locales el estado que trae la API.
export function sincronizarDesdeApi(fila) {
  const local = store.todos('comprobantes').find(c => String(c.api_id) === String(fila.api_id) && c.tipo === fila.tipo);
  if (!local || fila.sunat_status === 'desconocido') return local || null;
  const cambios = {};
  if (local.sunat_status !== fila.sunat_status) cambios.sunat_status = fila.sunat_status;
  if (fila.correlativo != null && local.correlativo == null) cambios.correlativo = fila.correlativo;
  if (fila.mensaje_sunat && fila.mensaje_sunat !== local.mensaje_sunat) cambios.mensaje_sunat = fila.mensaje_sunat;
  if (fila.total_oficial != null && fila.total_oficial !== local.total_oficial) cambios.total_oficial = fila.total_oficial;
  return Object.keys(cambios).length ? store.actualizar('comprobantes', local.id, cambios) : local;
}

export const comprobanteLocal = (tipo, apiId) =>
  store.todos('comprobantes').find(c => c.tipo === tipo && String(c.api_id) === String(apiId)) || null;

// Envía (o reenvía) a SUNAT un comprobante pendiente o rechazado.
export async function enviarASunat(ruta, apiId) {
  const r = await api.enviarComprobante(ruta, apiId);
  const local = comprobanteLocal(TIPO_POR_RUTA[ruta], apiId);
  if (local) store.actualizar('comprobantes', local.id, { sunat_status: 'enviado', mensaje_sunat: null });
  return r;
}

// Valida y aplica la corrección (PUT). La API vuelve a enviarlo a SUNAT.
export function validarCorreccion(tipo, cliente, items) {
  if (tipo === '01' && cliente.tipo_doc !== '6') return 'La factura requiere un cliente con RUC.';
  if (!cliente.num_doc || !cliente.razon_social) return 'Completa el documento y el nombre del cliente.';
  if (!items.length) return 'El comprobante debe tener al menos un ítem.';
  for (const it of items) {
    if (!it.descripcion?.trim()) return 'Cada ítem necesita descripción.';
    if (!(it.cantidad > 0)) return `Cantidad inválida en "${it.descripcion}".`;
    if (!(it.precio_unitario > 0)) return `Precio inválido en "${it.descripcion}".`;
  }
  return null;
}

export async function corregirComprobante(ruta, apiId, { cliente, items }) {
  const tipo = TIPO_POR_RUTA[ruta];
  const error = validarCorreccion(tipo, cliente, items);
  if (error) throw new Error(error);
  const body = {
    cliente: Object.fromEntries(Object.entries(cliente).filter(([, v]) => v !== '' && v != null)),
    items: items.map(it => {
      const i = {
        codigo: it.codigo || 'ITEM', descripcion: it.descripcion.trim(), unidad: it.unidad || 'NIU',
        cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), tip_afe_igv: it.tip_afe_igv
      };
      if (it.cod_producto_sunat) i.cod_producto_sunat = it.cod_producto_sunat;
      return i;
    })
  };
  const r = await api.actualizarComprobante(ruta, apiId, body);
  const local = comprobanteLocal(tipo, apiId);
  if (local) {
    const cpe = leerCpe(r.datos);
    store.actualizar('comprobantes', local.id, {
      sunat_status: cpe.sunat_status === 'desconocido' ? 'enviado' : cpe.sunat_status,
      mensaje_sunat: cpe.mensaje_sunat ?? null,
      total_oficial: cpe.total_oficial ?? local.total_oficial,
      corregido_en: new Date().toISOString()
    });
  }
  return r;
}

// Elimina una boleta no aceptada y deja la venta lista para emitir otra vez.
export async function eliminarBoleta(apiId) {
  await api.eliminarBoleta(apiId);
  const local = comprobanteLocal('03', apiId);
  if (local) liberarVenta(local, 'eliminado');
}

// El comprobante rechazado queda en el historial; la venta vuelve a "sin comprobante".
export function liberarVenta(comp, motivo = 'reemplazado') {
  store.actualizar('comprobantes', comp.id, { reemplazado: motivo, liberado_en: new Date().toISOString() });
  const venta = comp.venta_id ? store.buscar('ventas', comp.venta_id) : null;
  if (venta && venta.comprobante_id === comp.id) {
    store.actualizar('ventas', venta.id, { comprobante_id: null, emision: null });
  }
  return venta;
}

// Consulta un comprobante de la API y actualiza la copia local si existe.
export async function detalleDesdeApi(ruta, apiId) {
  const r = await api.comprobante(ruta, apiId);
  const d = r.datos?.comprobante || r.datos?.factura || r.datos?.boleta || r.datos || {};
  const fila = leerFila(d, ruta);
  if (fila.api_id == null) fila.api_id = apiId;
  const local = sincronizarDesdeApi(fila);
  if (local) store.actualizar('comprobantes', local.id, { consultado_en: new Date().toISOString() });
  return { fila, items: leerItemsCpe(d), crudo: r.crudo, local: local ? store.buscar('comprobantes', local.id) : null };
}
