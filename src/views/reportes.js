// Reportes: los tributarios vienen de /reportes de la API; el de caja, de las ventas del sistema.
import { store } from '../store.js';
import { request, comoLista, hayMasPaginas, metaDe } from '../api.js';
import { soles, r2, errorDocumento } from '../validar.js';
import { esc, $, toast, conCarga, campo, crudo, vacioMsg, tablaDatos, pieTabla, activarTablas } from '../ui.js';
import { hoyLima, METODOS_PAGO, ESTADOS, normalizarEstado } from '../comprobantes.js';

const REPORTES = [
  ['registro-ventas', 'Registro de ventas', 'Reporte de ventas del periodo para la declaración.', 'api'],
  ['ventas-consolidado', 'Ventas consolidado', 'Facturas, boletas y notas con totales por moneda.', 'api'],
  ['notas', 'Notas de crédito y débito', 'Notas emitidas en el periodo.', 'api'],
  ['por-cliente', 'Por cliente', 'Comprobantes de un cliente (DNI o RUC).', 'api'],
  ['por-sucursal', 'Por sucursal', 'Ventas agrupadas por local.', 'api'],
  ['caja', 'Caja por método de pago', 'Cobrado por método y día, desde las ventas del sistema.', 'local']
];

const estado = { reporte: 'registro-ventas', desde: '', hasta: '', doc: '', pagina: 1, filas: [], columnas: [] };

export function vistaReportes(cont) {
  if (!estado.desde) {
    const hoy = hoyLima();
    estado.desde = `${hoy.slice(0, 7)}-01`;
    estado.hasta = hoy;
  }
  const actual = REPORTES.find(r => r[0] === estado.reporte);
  cont.innerHTML = `
    <h1 class="page-title">Reportes</h1>
    <div class="chips chips-wrap" role="tablist" aria-label="Reporte">
      ${REPORTES.map(([id, t]) => `<button type="button" class="chip ${id === estado.reporte ? 'is-active' : ''}" data-rep="${id}" aria-selected="${id === estado.reporte}">${esc(t)}</button>`).join('')}
    </div>
    <form class="filtros" id="f-rep" novalidate>
      <p class="muted small span-all">${esc(actual[2])}</p>
      <label class="field"><span class="field-label">Desde</span><input type="date" name="desde" value="${esc(estado.desde)}" required></label>
      <label class="field"><span class="field-label">Hasta</span><input type="date" name="hasta" value="${esc(estado.hasta)}" required></label>
      ${estado.reporte === 'por-cliente' ? campo({ nombre: 'doc', etiqueta: 'DNI o RUC del cliente', valor: estado.doc, req: true, attrs: 'inputmode="numeric" list="rep-clientes"' }) : ''}
      <div class="filtros-acciones">
        <button class="btn btn-primary" type="submit">Generar</button>
        <button class="btn" type="button" id="btn-csv" disabled>Descargar CSV</button>
        <button class="btn" type="button" id="btn-mes-ant">Mes anterior</button>
      </div>
    </form>
    <datalist id="rep-clientes">${store.todos('clientes').map(c => `<option value="${esc(c.num_doc)}">${esc(c.razon_social)}</option>`).join('')}</datalist>
    <section class="panel panel-flush" id="rep-res"><p class="empty">Elige el periodo y pulsa Generar.</p></section>`;

  cont.querySelector('.chips').addEventListener('click', ev => {
    const b = ev.target.closest('[data-rep]');
    if (!b) return;
    estado.reporte = b.dataset.rep;
    estado.filas = [];
    vistaReportes(cont);
  });
  const f = $('#f-rep', cont);
  $('#btn-mes-ant', cont).addEventListener('click', () => {
    const [y, m] = hoyLima().split('-').map(Number);
    const ini = new Date(Date.UTC(y, m - 2, 1)), fin = new Date(Date.UTC(y, m - 1, 0));
    $('[name=desde]', f).value = ini.toISOString().slice(0, 10);
    $('[name=hasta]', f).value = fin.toISOString().slice(0, 10);
  });
  f.addEventListener('submit', ev => {
    ev.preventDefault();
    estado.desde = $('[name=desde]', f).value;
    estado.hasta = $('[name=hasta]', f).value;
    estado.doc = $('[name=doc]', f)?.value.trim() || '';
    if (!estado.desde || !estado.hasta || estado.desde > estado.hasta) return toast('Rango de fechas inválido.', 'warn');
    if (estado.reporte === 'por-cliente' && errorDocumento('1', estado.doc) && errorDocumento('6', estado.doc)) return toast('Escribe un DNI (8) o RUC (11) válido.', 'warn');
    estado.pagina = 1;
    conCarga(f.querySelector('[type=submit]'), () => generar(cont));
  });
  $('#btn-csv', cont).addEventListener('click', () => descargarCsv());
}

async function generar(cont) {
  const caja = $('#rep-res', cont);
  const csv = $('#btn-csv', cont);
  csv.disabled = true;
  if (estado.reporte === 'caja') return reporteCaja(caja, csv);

  caja.innerHTML = '<p class="loading">Consultando la API…</p>';
  const query = { fecha_desde: estado.desde, fecha_hasta: estado.hasta, por_pagina: 100, page: estado.pagina };
  if (estado.reporte === 'por-cliente') query.client_num_doc = estado.doc;
  try {
    const r = await request('GET', `/reportes/${estado.reporte}`, { query });
    const { filas, resumen } = extraerTabla(r.datos);
    estado.filas = filas;
    estado.columnas = columnasDe(filas);
    caja.innerHTML = `
      ${resumen.length ? `<dl class="kv rep-resumen">${resumen.map(([k, v]) => `<div><dt>${esc(etiqueta(k))}</dt><dd>${esc(formatear(k, v))}</dd></div>`).join('')}</dl>` : ''}
      ${tabla(filas, estado.columnas, pieTabla({
        pagina: estado.pagina, ultima: metaDe(r)?.last_page ?? metaDe(r)?.ultima_pagina ?? null,
        total: metaDe(r)?.total ?? null, hayMas: hayMasPaginas(metaDe(r), estado.pagina), cantidad: filas.length
      }))}
      ${crudo(r.crudo)}`;
    csv.disabled = !filas.length;
    activarTablas(caja, { alPaginar: paso => { estado.pagina = Math.max(1, estado.pagina + paso); generar(cont); } });
  } catch (e) {
    caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
  }
}

// La API no documenta la forma: busca el primer arreglo de objetos y los totales sueltos.
export function extraerTabla(datos) {
  if (Array.isArray(datos)) return { filas: datos.filter(x => x && typeof x === 'object'), resumen: [] };
  if (!datos || typeof datos !== 'object') return { filas: [], resumen: [] };
  let filas = [];
  for (const k of ['registros', 'filas', 'items', 'data', 'documentos', 'comprobantes', 'detalle', 'clientes', 'sucursales']) {
    if (Array.isArray(datos[k])) { filas = datos[k]; break; }
  }
  if (!filas.length) {
    const arr = Object.values(datos).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object');
    if (arr) filas = arr;
  }
  const fuenteResumen = datos.totales && typeof datos.totales === 'object' ? datos.totales : datos;
  const resumen = Object.entries(fuenteResumen).filter(([, v]) => v === null || ['string', 'number'].includes(typeof v));
  return { filas, resumen };
}

// Ids internos que no aportan al lector.
const OCULTAS = /^(id|tenant_id|empresa_id|sucursal_id|.*_uuid|hash.*)$/i;
// Orden preferido: primero lo que identifica el documento, al final los montos de detalle.
const PRIORIDAD = ['numero_completo', 'serie', 'correlativo', 'client_razon_social', 'mto_imp_venta', 'total', 'fecha_emision', 'estado_sunat', 'tipo_doc_nombre', 'client_num_doc'];

function columnasDe(filas) {
  const cols = [];
  for (const f of filas.slice(0, 50)) {
    for (const [k, v] of Object.entries(f)) {
      if (!cols.includes(k) && !OCULTAS.test(k) && (v === null || ['string', 'number', 'boolean'].includes(typeof v))) cols.push(k);
    }
  }
  // Con número completo, serie y correlativo sueltos sobran.
  const sinRepetir = (cols.includes('numero_completo') ? cols.filter(c => !['serie', 'correlativo'].includes(c)) : cols)
    // Columnas vacías o en cero en todas las filas (ISC, ICBPER, gratuitas…) solo hacen ruido.
    .filter(c => PRIORIDAD.includes(c) || filas.some(f => f[c] !== null && f[c] !== '' && f[c] !== 0 && f[c] !== '0' && f[c] !== '0.00'));
  const peso = c => { const i = PRIORIDAD.indexOf(c); return i < 0 ? PRIORIDAD.length : i; };
  return sinRepetir.sort((a, b) => peso(a) - peso(b)).slice(0, 16);
}

const NOMBRES = {
  numero_completo: 'Comprobante', fecha_emision: 'Emisión', fecha_vencimiento: 'Vencimiento', tipo_doc: 'Tipo (código)',
  tipo_doc_nombre: 'Tipo', client_tipo_doc: 'Tipo doc.', client_num_doc: 'Documento', client_razon_social: 'Cliente',
  mto_oper_gravadas: 'Gravadas', mto_oper_exoneradas: 'Exoneradas', mto_oper_inafectas: 'Inafectas', mto_oper_gratuitas: 'Gratuitas',
  mto_igv: 'IGV', mto_isc: 'ISC', mto_icbper: 'ICBPER', otros_tributos: 'Otros tributos', mto_imp_venta: 'Total',
  tipo_moneda: 'Moneda', estado_sunat: 'Estado SUNAT', venta_neta: 'Venta neta', total_documentos: 'Documentos', titulo: 'Reporte'
};
const etiqueta = k => NOMBRES[k] || (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '));
const esMonto = k => !/(documentos|cantidad|tipo_|_doc$)/i.test(k) && /(total|monto|igv|importe|valor|base|gravad|exonerad|inafect|gratuit|mto_|saldo|subtotal|neta|tributo|isc|icbper)/i.test(k);
const formatear = (k, v) => (esMonto(k) && v !== null && v !== '' && !isNaN(Number(v))) ? soles(Number(v)) : String(v ?? '—');

function tabla(filas, cols, pie = '') {
  const sumables = cols.filter(c => esMonto(c) && filas.some(f => !isNaN(Number(f[c])) && f[c] !== null && f[c] !== ''));
  const sumas = Object.fromEntries(sumables.map(c => [c, r2(filas.reduce((s, f) => s + (Number(f[c]) || 0), 0))]));
  // Visibles siempre: identificación, cliente, estado y total. El resto va a la fila "+".
  const total = cols.find(c => /^(mto_imp_venta|total|importe_total|monto_total)$/i.test(c)) || sumables.at(-1);
  const principal = new Set([cols[0], cols.includes('client_razon_social') ? 'client_razon_social' : cols[1], total]);
  return tablaDatos({
    filas,
    vacio: 'El reporte no tiene filas en este periodo.',
    pie,
    columnas: cols.map(c => ({
      titulo: etiqueta(c), clave: c, clase: sumables.includes(c) ? 'num' : /fecha|numero_completo/.test(c) ? 'nw' : '', sec: !principal.has(c),
      celda: f => {
        if (c === 'estado_sunat') { const e = ESTADOS[normalizarEstado(f[c])] || ESTADOS.desconocido; return `<span class="pill ${e.clase}">${esc(e.texto)}</span>`; }
        if (/numero_completo|num_doc/.test(c)) return `<span class="font-id">${esc(formatear(c, f[c]))}</span>`;
        return esc(formatear(c, f[c]));
      }
    })),
    totales: sumables.length ? col => (sumables.includes(col.clave) ? esc(soles(sumas[col.clave])) : col.clave === cols[0] ? 'Total página' : '') : null
  });
}

// ---------- Caja (sistema) ----------
function reporteCaja(caja, csv) {
  const ventas = store.todos('ventas').filter(v => v.estado !== 'anulada' && v.fecha_emision >= estado.desde && v.fecha_emision <= estado.hasta);
  const metodos = [...METODOS_PAGO, ['credito', 'Crédito']];
  const dias = [...new Set(ventas.map(v => v.fecha_emision))].sort();
  const clave = v => v.forma_pago === 'Credito' ? 'credito' : v.metodo_pago;
  const filas = dias.map(d => {
    const delDia = ventas.filter(v => v.fecha_emision === d);
    const fila = { fecha: d, ventas: delDia.length };
    for (const [k] of metodos) fila[k] = r2(delDia.filter(v => clave(v) === k).reduce((s, v) => s + v.total, 0));
    fila.total = r2(delDia.reduce((s, v) => s + v.total, 0));
    return fila;
  });
  const usados = metodos.filter(([k]) => filas.some(f => f[k]));
  estado.filas = filas;
  estado.columnas = ['fecha', 'ventas', ...usados.map(m => m[0]), 'total'];
  const sinCpe = ventas.filter(v => !v.comprobante_id).length;

  const tot = k => r2(filas.reduce((s, f) => s + f[k], 0));
  caja.innerHTML = tablaDatos({
    filas,
    vacio: 'No hay ventas en este periodo.',
    columnas: [
      { titulo: 'Fecha', clave: 'fecha', clase: 'nw', celda: f => esc(f.fecha) },
      { titulo: 'Ventas', clave: 'ventas', clase: 'num', celda: f => esc(f.ventas) },
      ...usados.map(([k, t]) => ({ titulo: t, clave: k, clase: 'num', sec: true, celda: f => (f[k] ? esc(soles(f[k])) : '—') })),
      { titulo: 'Total', clave: 'total', clase: 'num', celda: f => `<strong>${esc(soles(f.total))}</strong>` }
    ],
    totales: c => (c.clave === 'fecha' ? 'Total' : c.clave === 'ventas' ? esc(ventas.length) : esc(soles(tot(c.clave))))
  }) + (filas.length ? `<p class="muted small">Montos de las ventas del sistema (comerciales). ${sinCpe ? `${sinCpe} venta(s) aún sin comprobante.` : 'Todas tienen comprobante.'} Para la declaración usa el Registro de ventas de la API.</p>` : '');
  csv.disabled = false;
}

// ---------- CSV ----------
function descargarCsv() {
  if (!estado.filas.length) return;
  const cel = v => {
    const s = String(v ?? '');
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [estado.columnas.map(c => cel(etiqueta(c))).join(','), ...estado.filas.map(f => estado.columnas.map(c => cel(f[c])).join(','))];
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${estado.reporte}_${estado.desde}_${estado.hasta}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

