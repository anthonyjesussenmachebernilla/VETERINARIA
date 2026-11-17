// Historial de ventas y detalle de una venta con su comprobante.
import { store } from '../store.js';
import { auth } from '../auth.js';
import { soles, nombreTipoDoc, r2 } from '../validar.js';
import { esc, $, $$, toast, toastError, confirmar, conCarga, vacioMsg, fecha, icono, tablaLocal, tablaDatos } from '../ui.js';
import { tasaIgvLocal } from './productos.js';
import {
  TIPOS_CPE, ESTADOS, METODOS_PAGO, esFinal, numeroCpe, itemsDeVenta, calcularTotales,
  calcularLinea, emitirVenta, actualizarEstado, esperarEstado, buscarEmitido, descartarIncierta,
  anularVenta, abrirArchivo, hoyLima, verComprobante
} from '../comprobantes.js';

const filtros = { periodo: 'hoy', estado: 'todos' };
const nombreMetodo = m => (METODOS_PAGO.find(x => x[0] === m) || [m, m || '—'])[1];

export function vistaVentas(cont, partes) {
  if (partes[0]) return detalleVenta(cont, Number(partes[0]));
  return listaVentas(cont);
}

// Estado resumido de una venta para listas y filtros.
export function estadoVenta(v) {
  if (v.estado === 'anulada') return { clave: 'anulada', texto: 'Venta anulada', clase: '' };
  const c = v.comprobante_id ? store.buscar('comprobantes', v.comprobante_id) : null;
  if (c) return { clave: c.sunat_status, texto: ESTADOS[c.sunat_status]?.texto || c.sunat_status, clase: ESTADOS[c.sunat_status]?.clase || '', comp: c };
  if (v.emision?.estado === 'incierta') return { clave: 'incierta', texto: 'Emisión por confirmar', clase: 'pill-warn' };
  if (v.emision?.estado === 'error') return { clave: 'error', texto: 'No emitido', clase: 'pill-danger' };
  return { clave: 'sin', texto: 'Sin comprobante', clase: 'pill-warn' };
}

// ---------- Lista ----------
function listaVentas(cont) {
  cont.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Ventas</h1>
      <div class="row-actions"><a class="btn btn-primary" href="#/vender">Nueva venta</a></div>
    </div>
    <div class="toolbar">
      <select id="v-periodo" aria-label="Periodo">
        ${[['hoy', 'Hoy'], ['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['todas', 'Todas']].map(([v, t]) =>
          `<option value="${v}" ${filtros.periodo === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <select id="v-estado" aria-label="Estado">
        ${[['todos', 'Todos los estados'], ['pendientes', 'Por emitir o con error'], ['proceso', 'En proceso'], ['rechazado', 'Rechazados'], ['aceptado', 'Aceptados'], ['anulada', 'Anuladas']].map(([v, t]) =>
          `<option value="${v}" ${filtros.estado === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>
    <div id="v-resumen"></div>
    <div id="v-lista"></div>`;

  const pintar = () => pintarLista(cont);
  $('#v-periodo', cont).addEventListener('change', ev => { filtros.periodo = ev.target.value; pintar(); });
  $('#v-estado', cont).addEventListener('change', ev => { filtros.estado = ev.target.value; pintar(); });
  pintar();
}

function pintarLista(cont) {
  const hoy = hoyLima();
  const desde = filtros.periodo === 'hoy' ? hoy
    : filtros.periodo === 'todas' ? '0000'
      : hoyLima(new Date(Date.now() - (Number(filtros.periodo) - 1) * 864e5));

  let lista = store.todos('ventas').filter(v => (v.fecha_emision || hoy) >= desde);
  const conEstado = lista.map(v => ({ v, e: estadoVenta(v) }));
  const pasa = ({ e }) => {
    switch (filtros.estado) {
      case 'pendientes': return ['sin', 'error', 'incierta'].includes(e.clave);
      case 'proceso': return ['enviado', 'pendiente', 'desconocido'].includes(e.clave);
      case 'rechazado': return e.clave === 'rechazado';
      case 'aceptado': return ['aceptado', 'observado'].includes(e.clave);
      case 'anulada': return e.clave === 'anulada';
      default: return true;
    }
  };
  const filtradas = conEstado.filter(pasa).sort((a, b) => b.v.id - a.v.id);
  const validas = conEstado.filter(x => x.e.clave !== 'anulada');
  const totalPeriodo = r2(validas.reduce((s, x) => s + x.v.total, 0));
  const porEmitir = conEstado.filter(x => ['sin', 'error', 'incierta'].includes(x.e.clave)).length;

  $('#v-resumen', cont).innerHTML = `
    <dl class="stats stats-inline">
      <div><dt>Ventas</dt><dd>${validas.length}</dd></div>
      <div><dt>Total</dt><dd>${esc(soles(totalPeriodo))}</dd></div>
      <div><dt>Por emitir</dt><dd class="${porEmitir ? 'text-danger' : ''}">${porEmitir}</dd></div>
    </dl>`;

  tablaLocal($('#v-lista', cont), {
    filas: filtradas,
    clave: `${filtros.periodo}|${filtros.estado}`,
    vacio: 'No hay ventas con estos filtros.',
    enlace: ({ v }) => `#/ventas/${v.id}`,
    claseFila: ({ v }) => (v.estado === 'anulada' ? 'fila-anulada' : ''),
    columnas: [
      { titulo: 'Venta', celda: ({ v }) => `<strong>#${esc(v.id)}</strong><span class="sub">${esc(fecha(v.fecha))}</span>` },
      { titulo: 'Cliente', sec: true, celda: ({ v }) => `${esc(v.cliente?.razon_social || 'Clientes varios')}${v.cliente?.num_doc ? `<span class="sub font-id">${esc(v.cliente.num_doc)}</span>` : ''}` },
      { titulo: 'Comprobante', sec: true, celda: ({ e }) => (e.comp ? `${esc(TIPOS_CPE[e.comp.tipo].nombre)}<span class="sub font-id">${esc(numeroCpe(e.comp))}</span>` : '<span class="muted">—</span>') },
      { titulo: 'Pago', sec: true, celda: ({ v }) => esc(v.forma_pago === 'Credito' ? 'Crédito' : nombreMetodo(v.metodo_pago)) },
      { titulo: 'Estado', celda: ({ e }) => `<span class="pill ${e.clase}">${esc(e.texto)}</span>` },
      { titulo: 'Total', clase: 'num', celda: ({ v }) => esc(soles(v.total)) },
      { titulo: '', clase: 'col-acciones', celda: ({ v, e }) => `<span class="acciones-fila">
          ${e.comp?.api_id ? `<button class="btn btn-sm" type="button" data-pdf="${v.id}">${icono('imprimir')}<span>PDF</span></button>` : ''}
          <a class="btn btn-sm" href="#/ventas/${v.id}">Ver</a>
        </span>` }
    ],
    alPintar: caja => $$('[data-pdf]', caja).forEach(b => b.addEventListener('click', () => {
      verComprobante(estadoVenta(store.buscar('ventas', Number(b.dataset.pdf))).comp);
    }))
  });
}

// ---------- Detalle ----------
function detalleVenta(cont, id) {
  const venta = store.buscar('ventas', id);
  if (!venta) {
    cont.innerHTML = `<div class="notice notice-error">La venta #${esc(id)} no existe en este navegador.</div><a class="btn" href="#/ventas">Volver a ventas</a>`;
    return;
  }
  const ruta = location.hash;
  const sigueAqui = () => location.hash === ruta;

  const pintar = () => {
    const v = store.buscar('ventas', id);
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
            { titulo: 'Descripción', celda: it => `${esc(it.descripcion)}${it.codigo ? `<span class="sub font-id">${esc(it.codigo)}</span>` : ''}` },
            { titulo: 'Cant.', clase: 'num', celda: it => esc(it.cantidad) },
            { titulo: 'Precio', clase: 'num', sec: true, celda: it => esc(soles(it.precio)) },
            { titulo: 'Desc.', clase: 'num', sec: true, celda: it => (it.descuento ? esc(soles(it.descuento)) : '—') },
            { titulo: 'Importe', clase: 'num', celda: it => esc(soles(calcularLinea(it, tasa).importe)) }
          ]
        })}
        <dl class="totals">
          ${t.gravado ? `<div><dt>Op. gravadas</dt><dd>${soles(t.gravado)}</dd></div>` : ''}
          ${t.exonerado ? `<div><dt>Op. exoneradas</dt><dd>${soles(t.exonerado)}</dd></div>` : ''}
          ${t.inafecto ? `<div><dt>Op. inafectas</dt><dd>${soles(t.inafecto)}</dd></div>` : ''}
          ${t.igv ? `<div><dt>IGV</dt><dd>${soles(t.igv)}</dd></div>` : ''}
          <div class="total-row"><dt>Total</dt><dd>${soles(v.total)}</dd></div>
        </dl>
      </section>

      <section class="panel">
        <h2>Cliente y pago</h2>
        <dl class="kv">
          <div><dt>Cliente</dt><dd>${esc(v.cliente?.razon_social || 'Clientes varios')}</dd></div>
          ${v.cliente ? `<div><dt>Documento</dt><dd>${esc(nombreTipoDoc(v.cliente.tipo_doc))} ${esc(v.cliente.num_doc)}</dd></div>` : ''}
          <div><dt>Forma de pago</dt><dd>${v.forma_pago === 'Credito' ? 'Crédito' : 'Contado'}</dd></div>
          ${v.forma_pago !== 'Credito' ? `<div><dt>Método</dt><dd>${esc(nombreMetodo(v.metodo_pago))}</dd></div>` : ''}
          ${v.recibido != null ? `<div><dt>Recibido / vuelto</dt><dd>${soles(v.recibido)} / ${soles(Math.max(vuelto, 0))}</dd></div>` : ''}
          <div><dt>Vendedor</dt><dd>${esc(store.buscar('usuarios', v.usuario_id)?.nombre || '—')}</dd></div>
        </dl>
        ${v.cuotas?.length ? `
          <h3 class="sub">Cuotas</h3>
          ${tablaDatos({
            filas: v.cuotas,
            columnas: [
              { titulo: 'Vence', clase: 'nw', celda: q => esc(q.fecha_pago) },
              { titulo: 'Monto', clase: 'num', celda: q => esc(soles(q.monto)) }
            ]
          })}` : ''}
        ${v.estado !== 'anulada' && !v.comprobante_id && auth.esAdmin() ? `
          <div class="row-actions"><button class="btn btn-ghost-danger" type="button" id="btn-anular">Anular venta</button></div>` : ''}
      </section>`;

    conectar(v, e);
  };

  const conectar = (v, e) => {
    const card = $('#cpe-card', cont);
    $$('[data-archivo]', card).forEach(b => b.addEventListener('click', () => conCarga(b, async () => {
      try {
        await abrirArchivo(e.comp, b.dataset.archivo, b.dataset.formato);
      } catch (err) { toastError(err); }
    })));

    $('#btn-estado', card)?.addEventListener('click', ev => conCarga(ev.currentTarget, async () => {
      try {
        await actualizarEstado(e.comp.id);
        pintar();
      } catch (err) { toastError(err); }
    }));

    $$('[data-emitir]', card).forEach(b => b.addEventListener('click', () => conCarga(b, async () => {
      if (b.dataset.emitir !== 'reintentar') store.actualizar('ventas', v.id, { tipo_comprobante: b.dataset.emitir });
      try {
        const comp = await emitirVenta(v.id);
        verComprobante(comp);
      } catch (err) { toastError(err); }
      pintar();
      vigilar();
    })));

    $('#btn-buscar-emitido', card)?.addEventListener('click', ev => conCarga(ev.currentTarget, async () => {
      try {
        const r = await buscarEmitido(v.id);
        if (r?.id) toast('Se encontró el comprobante en la API y se enlazó a esta venta.', 'ok');
        else if (r.encontrados > 1) toast('Hay varios comprobantes posibles. Revísalos en la API antes de reintentar.', 'warn', 7000);
        else toast('No se encontró ningún comprobante para esta venta. Puedes reintentar.', 'ok');
        if (!r?.id && r.encontrados === 0) descartarIncierta(v.id);
        pintar();
        vigilar();
      } catch (err) { toastError(err); }
    }));

    $('#btn-whatsapp', card)?.addEventListener('click', () => {
      const tel = String(v.cliente.telefono).replace(/\D/g, '');
      const num = tel.length === 9 ? `51${tel}` : tel;
      const nombre = store.config().nombre_comercial || store.config().razon_social || 'la veterinaria';
      const texto = `Hola, gracias por tu compra en ${nombre}. ${TIPOS_CPE[e.comp.tipo].nombre} ${numeroCpe(e.comp)} por ${soles(e.comp.total_oficial ?? v.total)}.`;
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    });

    $('#btn-anular', cont)?.addEventListener('click', async () => {
      if (!await confirmar('Anular venta', 'La venta no tiene comprobante. Se marcará como anulada y se devolverá el stock.', 'Anular venta', true)) return;
      try {
        anularVenta(store.buscar('ventas', v.id));
        toast('Venta anulada.', 'ok');
        pintar();
      } catch (err) { toast(err.message, 'warn'); }
    });
  };

  // Consulta el estado en segundo plano mientras el usuario siga en esta pantalla.
  const vigilar = async () => {
    const v = store.buscar('ventas', id);
    const comp = v.comprobante_id && store.buscar('comprobantes', v.comprobante_id);
    if (!comp || esFinal(comp.sunat_status) || comp.sunat_status === 'pendiente') return;
    await esperarEstado(comp.id, { alCambiar: () => { if (sigueAqui()) pintar(); }, cancelado: () => !sigueAqui() });
    if (sigueAqui()) pintar();
  };

  pintar();
  vigilar();
}

function tarjetaComprobante(v, e) {
  if (v.estado === 'anulada') {
    return `<h2>Venta anulada</h2><p class="muted">No se emitió comprobante para esta venta.</p>`;
  }

  if (e.comp) {
    const c = e.comp;
    const aceptado = ['aceptado', 'observado'].includes(c.sunat_status);
    const enProceso = !esFinal(c.sunat_status) && c.sunat_status !== 'pendiente';
    const diferencia = c.total_oficial != null && Math.abs(c.total_oficial - v.total) > 0.01;
    return `
      <div class="cpe-head">
        <div>
          <span class="muted small">${esc(TIPOS_CPE[c.tipo].nombre)} electrónica</span>
          <div class="cpe-num">${esc(numeroCpe(c))}</div>
        </div>
        <span class="pill pill-lg ${ESTADOS[c.sunat_status]?.clase || ''}">${esc(ESTADOS[c.sunat_status]?.texto || c.sunat_status)}</span>
      </div>
      ${enProceso ? '<p class="muted">SUNAT aún no responde. Esta pantalla se actualiza sola; también puedes consultar.</p>' : ''}
      ${c.sunat_status === 'pendiente' ? '<p class="muted">Registrado en la API, todavía no enviado a SUNAT. Las boletas por resumen diario se envían desde Operaciones SUNAT (etapa 5).</p>' : ''}
      ${c.sunat_status === 'rechazado' ? `<p class="notice notice-error">SUNAT rechazó el comprobante. <a href="#/comprobantes/${TIPOS_CPE[c.tipo].ruta}/${esc(c.api_id)}">Corrígelo o reenvíalo desde su ficha</a>.</p>` : ''}
      ${c.mensaje_sunat ? `<p class="small"><strong>SUNAT:</strong> ${esc(c.mensaje_sunat)}${c.codigo_sunat ? ` (código ${esc(c.codigo_sunat)})` : ''}</p>` : ''}
      ${diferencia ? `<p class="notice small">El total oficial de la API es ${soles(c.total_oficial)} y el del sistema ${soles(v.total)}. Vale el de la API.</p>` : ''}
      <div class="row-actions">
        <button class="btn btn-primary" type="button" data-archivo="pdf" data-formato="ticket-80">Ticket 80 mm</button>
        <button class="btn" type="button" data-archivo="pdf" data-formato="a4">PDF A4</button>
        <button class="btn" type="button" data-archivo="xml">XML</button>
        ${aceptado ? '<button class="btn" type="button" data-archivo="cdr">CDR</button>' : ''}
        ${!aceptado ? '<button class="btn" type="button" id="btn-estado">Consultar estado</button>' : ''}
        ${v.cliente?.telefono ? '<button class="btn" type="button" id="btn-whatsapp">WhatsApp</button>' : ''}
        ${c.api_id ? `<a class="btn" href="#/comprobantes/${TIPOS_CPE[c.tipo].ruta}/${esc(c.api_id)}">Ver ficha</a>` : ''}
      </div>
      ${c.consultado_en ? `<p class="muted small">Última consulta: ${esc(fecha(c.consultado_en))}</p>` : ''}`;
  }

  const em = v.emision;
  if (em?.estado === 'incierta') {
    return `
      <h2>Emisión por confirmar</h2>
      <p class="notice">Se perdió la conexión mientras se enviaba el comprobante. Puede que la API sí lo haya creado: búscalo antes de reintentar para no duplicarlo.</p>
      <p class="small muted">${esc(em.mensaje)}</p>
      <div class="row-actions"><button class="btn btn-primary" type="button" id="btn-buscar-emitido">Buscar en la API</button></div>`;
  }

  const tipo = v.tipo_comprobante;
  const puedeFactura = v.cliente?.tipo_doc === '6' && store.config().tax_regime !== 'rus';
  return `
    <h2>${em?.estado === 'error' ? 'No se pudo emitir' : 'Sin comprobante'}</h2>
    ${em?.estado === 'error' ? `
      <div class="notice notice-error">
        <p><strong>${esc(em.mensaje)}</strong></p>
        ${(em.detalle || []).map(l => `<p class="small">${esc(l)}</p>`).join('')}
      </div>` : '<p class="muted">La venta está guardada. Emite el comprobante cuando corresponda.</p>'}
    <div class="row-actions">
      ${em?.estado === 'error' && TIPOS_CPE[tipo] ? `<button class="btn btn-primary" type="button" data-emitir="reintentar">Reintentar ${esc(TIPOS_CPE[tipo].nombre.toLowerCase())}</button>` : ''}
      ${tipo !== '03' || !em ? '<button class="btn" type="button" data-emitir="03">Emitir boleta</button>' : ''}
      ${puedeFactura && (tipo !== '01' || !em) ? '<button class="btn" type="button" data-emitir="01">Emitir factura</button>' : ''}
    </div>
    ${!puedeFactura ? '<p class="muted small">Para factura, la venta debe tener un cliente con RUC.</p>' : ''}`;
}
