// Bandeja de comprobantes: lee de la API (fuente oficial) y enlaza con las ventas locales.
import { store } from '../store.js';
import { auth } from '../auth.js';
import { api, comoLista, hayMasPaginas, queryPdf, descargar, metaDe } from '../api.js';
import { soles, nombreTipoDoc, TIPOS_DOC, AFECTACIONES, UNIDADES, errorDocumento } from '../validar.js';
import {
  esc, $, $$, toast, toastError, modal, cerrarModal, confirmar, conCarga, vacioMsg, crudo, campo, selector,
  icono, tablaDatos, pieTabla, activarTablas
} from '../ui.js';
import {
  TIPOS_CPE, TIPO_POR_RUTA, ESTADOS, esFinal, leerFila, sincronizarDesdeApi, comprobanteLocal,
  enviarASunat, corregirComprobante, eliminarBoleta, liberarVenta, detalleDesdeApi, itemsDeVenta,
  armarPayload, hoyLima, verComprobante
} from '../comprobantes.js';
import { vistaNota } from './notas.js';
import {
  puedeBaja, comunicarBaja, puedeAnularBoleta, anularBoletaPorResumen, sumaPagos, validarPago, diasRestantes
} from '../tributario.js';
import { METODOS_PAGO } from '../comprobantes.js';

const PESTANAS = [['facturas', 'Facturas'], ['boletas', 'Boletas'], ['notas-credito', 'Notas de crédito'], ['notas-debito', 'Notas de débito']];
const filtros = { ruta: 'boletas', desde: '', hasta: '', estado: '', doc: '', serie: '', correlativo: '', pagina: 1 };

export function vistaComprobantes(cont, partes) {
  if (partes[0] && partes[1] && ['nota-credito', 'nota-debito'].includes(partes[2])) return vistaNota(cont, partes[0], partes[1], partes[2]);
  if (partes[0] && partes[1]) return detalle(cont, partes[0], partes[1]);
  if (partes[0] && PESTANAS.some(p => p[0] === partes[0])) filtros.ruta = partes[0];
  return bandeja(cont);
}

// ---------- Bandeja ----------
function bandeja(cont) {
  cont.innerHTML = `
    <h1 class="page-title">Comprobantes</h1>
    <nav class="tabs" aria-label="Tipo de comprobante">
      ${PESTANAS.map(([r, t]) => `<a href="#/comprobantes/${r}" class="tab ${r === filtros.ruta ? 'is-active' : ''}">${t}</a>`).join('')}
    </nav>
    <form class="filtros" id="f-filtros" novalidate>
      <label class="field"><span class="field-label">Desde</span><input type="date" name="desde" value="${esc(filtros.desde)}"></label>
      <label class="field"><span class="field-label">Hasta</span><input type="date" name="hasta" value="${esc(filtros.hasta)}"></label>
      <label class="field"><span class="field-label">Estado SUNAT</span>
        <select name="estado">
          ${[['', 'Todos'], ['aceptado', 'Aceptados'], ['rechazado', 'Rechazados'], ['pendiente', 'Pendientes'], ['enviado', 'Enviados']].map(([v, t]) =>
            `<option value="${v}" ${filtros.estado === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></label>
      <label class="field"><span class="field-label">Documento del cliente</span><input name="doc" value="${esc(filtros.doc)}" inputmode="numeric" placeholder="DNI o RUC"></label>
      <label class="field"><span class="field-label">Serie</span><input name="serie" value="${esc(filtros.serie)}" maxlength="4" placeholder="B001"></label>
      <label class="field"><span class="field-label">Número</span><input name="correlativo" value="${esc(filtros.correlativo)}" inputmode="numeric"></label>
      <div class="filtros-acciones"><button class="btn btn-primary" type="submit">Buscar</button><button class="btn" type="button" id="btn-limpiar">Limpiar</button></div>
    </form>
    <div id="cpe-lista"></div>`;

  const f = $('#f-filtros', cont);
  f.addEventListener('submit', ev => {
    ev.preventDefault();
    for (const k of ['desde', 'hasta', 'estado', 'doc', 'serie', 'correlativo']) filtros[k] = $(`[name=${k}]`, f).value.trim();
    filtros.serie = filtros.serie.toUpperCase();
    if (filtros.desde && filtros.hasta && filtros.desde > filtros.hasta) return toast('La fecha "desde" es posterior a "hasta".', 'warn');
    filtros.pagina = 1;
    cargarLista(cont);
  });
  $('#btn-limpiar', cont).addEventListener('click', () => {
    Object.assign(filtros, { desde: '', hasta: '', estado: '', doc: '', serie: '', correlativo: '', pagina: 1 });
    bandeja(cont);
  });
  cargarLista(cont);
}

async function cargarLista(cont) {
  const caja = $('#cpe-lista', cont);
  caja.innerHTML = '<p class="loading">Consultando la API…</p>';
  const ruta = filtros.ruta;
  const query = {
    fecha_desde: filtros.desde, fecha_hasta: filtros.hasta, sunat_status: filtros.estado,
    client_num_doc: filtros.doc, serie: filtros.serie, correlativo: filtros.correlativo,
    por_pagina: POR_PAGINA, page: filtros.pagina
  };
  try {
    const r = await api.listarComprobantes(ruta, query);
    if (ruta !== filtros.ruta) return;
    const filas = comoLista(r.datos).map(x => leerFila(x, ruta));
    filas.forEach(sincronizarDesdeApi);
    pintarFilas(cont, filas, metaDe(r), r.crudo);
  } catch (e) {
    caja.innerHTML = `<div class="notice notice-error"><p><strong>${esc(e.message)}</strong></p>
      ${e.red ? '<p class="small">Sin conexión con la API. Los comprobantes de las ventas siguen visibles en Ventas.</p>' : ''}</div>`;
  }
}

const POR_PAGINA = 20;

// '2026-10-12 13:43:59' → { dia: '12/10/2026', hora: '13:43' }
function partirFecha(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(v || ''));
  return m ? { dia: `${m[3]}/${m[2]}/${m[1]}`, hora: m[4] || '' } : { dia: String(v || '—'), hora: '' };
}

function pintarFilas(cont, filas, meta, crudoResp) {
  const caja = $('#cpe-lista', cont);
  const hayMas = hayMasPaginas(meta, filtros.pagina);
  if (!filas.length) {
    const conFiltros = filtros.desde || filtros.hasta || filtros.estado || filtros.doc || filtros.serie || filtros.correlativo;
    caja.innerHTML = tablaDatos({
      filas: [], columnas: [],
      vacio: conFiltros ? 'No hay comprobantes con estos filtros. Prueba con "Limpiar".' : 'La API no devolvió comprobantes de este tipo.'
    }) + crudo(crudoResp, !conFiltros);
    return;
  }
  const esNota = ['notas-credito', 'notas-debito'].includes(filtros.ruta);
  const columnas = [
    { titulo: 'Comprobante', celda: f => {
      const local = comprobanteLocal(f.tipo, f.api_id);
      return `<strong class="font-id">${esc(f.serie || '')}-${esc(f.correlativo ?? '…')}</strong>${local?.venta_id ? `<span class="sub">Venta #${esc(local.venta_id)}</span>` : ''}`;
    } },
    { titulo: 'Cliente', sec: true, celda: f => `${esc(f.cliente.razon_social || 'Sin nombre')}${f.cliente.num_doc && f.cliente.num_doc !== '-' ? `<span class="sub font-id">${esc(f.cliente.num_doc)}</span>` : ''}` },
    { titulo: 'Emisión', sec: true, clase: 'nw', celda: f => {
      const p = partirFecha(f.fecha_emision);
      return `${esc(p.dia)}${p.hora ? `<span class="sub">${esc(p.hora)}</span>` : ''}`;
    } },
    ...(esNota ? [{ titulo: 'Afecta a', sec: true, celda: f => (f.afectado ? `<span class="font-id">${esc(f.afectado)}</span>` : '') }] : []),
    { titulo: 'Estado', celda: f => {
      const e = ESTADOS[f.sunat_status] || ESTADOS.desconocido;
      const local = comprobanteLocal(f.tipo, f.api_id);
      return `<span class="pill ${e.clase}">${esc(e.texto)}</span>${local?.reemplazado ? ' <span class="pill">Reemplazado</span>' : ''}`;
    } },
    { titulo: 'Total', clase: 'num', celda: f => (f.total_oficial != null ? esc(soles(f.total_oficial)) : '—') },
    { titulo: 'Respuesta SUNAT', sec: true, celda: f => esc(f.mensaje_sunat || '') },
    { titulo: '', clase: 'col-acciones', celda: (f, i) => `<span class="acciones-fila">
        <button class="btn btn-sm" type="button" data-pdf="${i}">${icono('imprimir')}<span>PDF</span></button>
        <a class="btn btn-sm" href="#/comprobantes/${f.ruta}/${esc(f.api_id)}">Ver</a>
      </span>` }
  ];
  const ultima = meta?.last_page ?? meta?.ultima_pagina ?? null;
  caja.innerHTML = tablaDatos({
    filas, columnas,
    numero: (f, i) => (filtros.pagina - 1) * POR_PAGINA + i + 1,
    enlace: f => `#/comprobantes/${f.ruta}/${f.api_id}`,
    claseFila: f => (f.sunat_status === 'anulado' ? 'fila-anulada' : ''),
    pie: pieTabla({ pagina: filtros.pagina, ultima, total: meta?.total ?? null, hayMas, cantidad: filas.length })
  }) + crudo(crudoResp);

  // El PDF se abre en el visor, listo para imprimir.
  caja._filas = filas;
  if (!caja._pdf) {
    caja._pdf = true;
    caja.addEventListener('click', ev => {
      const b = ev.target.closest('[data-pdf]');
      if (b) verComprobante(caja._filas[Number(b.dataset.pdf)]);
    });
  }
  activarTablas(caja, { alPaginar: paso => { filtros.pagina = Math.max(1, filtros.pagina + paso); cargarLista(cont); } });
}

// ---------- Detalle ----------
async function detalle(cont, ruta, apiId) {
  if (!TIPO_POR_RUTA[ruta]) { cont.innerHTML = '<div class="notice notice-error">Tipo de comprobante desconocido.</div>'; return; }
  const tipo = TIPO_POR_RUTA[ruta];
  const hash = location.hash;
  const sigueAqui = () => location.hash === hash;
  cont.innerHTML = `<a class="back-link" href="#/comprobantes/${ruta}">← ${esc(TIPOS_CPE[tipo].nombre)}s</a><div id="cpe-det"><p class="loading">Consultando la API…</p></div>`;
  const caja = $('#cpe-det', cont);

  let info;
  const cargar = async () => {
    try {
      info = await detalleDesdeApi(ruta, apiId);
      if (sigueAqui()) pintar();
    } catch (e) {
      const local = comprobanteLocal(tipo, apiId);
      caja.innerHTML = `<div class="notice notice-error"><p><strong>${esc(e.message)}</strong></p></div>
        ${local?.venta_id ? `<a class="btn" href="#/ventas/${local.venta_id}">Ver la venta #${local.venta_id}</a>` : ''}`;
    }
  };

  const pintar = () => {
    const { fila: f, items, local } = info;
    const e = ESTADOS[f.sunat_status] || ESTADOS.desconocido;
    const admin = auth.esAdmin();
    const aceptado = ['aceptado', 'observado'].includes(f.sunat_status);
    const editable = ['pendiente', 'rechazado'].includes(f.sunat_status);
    const enProceso = !esFinal(f.sunat_status) && f.sunat_status !== 'pendiente';
    const reemplazado = local?.reemplazado;
    const nrus = store.config().tax_regime === 'rus';
    const comoOrigen = { ...f, api_id: f.api_id ?? apiId };
    const errBaja = ['01', '07', '08'].includes(tipo) ? puedeBaja(comoOrigen) : null;
    const errAnular = tipo === '03' ? puedeAnularBoleta(comoOrigen) : null;

    caja.innerHTML = `
      <section class="panel">
        <div class="cpe-head">
          <div>
            <span class="muted small">${esc(TIPOS_CPE[tipo].nombre)} electrónica · ${esc(f.fecha_emision)}</span>
            <div class="cpe-num">${esc(f.serie || '')}-${esc(f.correlativo ?? '…')}</div>
          </div>
          <span class="pill pill-lg ${e.clase}">${esc(e.texto)}</span>
        </div>
        ${f.mensaje_sunat ? `<p class="small"><strong>SUNAT:</strong> ${esc(f.mensaje_sunat)}${f.codigo_sunat ? ` (código ${esc(f.codigo_sunat)})` : ''}</p>` : ''}
        ${enProceso ? '<p class="muted">SUNAT aún no responde. Consulta el estado en unos segundos.</p>' : ''}
        ${f.sunat_status === 'pendiente' ? '<p class="muted">Registrado en la API, todavía no enviado a SUNAT.</p>' : ''}
        ${f.sunat_status === 'rechazado' && !reemplazado ? '<p class="notice notice-error">Rechazado: corrígelo y se reenvía automáticamente. Si el rechazo no se puede corregir, emite la venta con un nuevo número.</p>' : ''}
        ${reemplazado ? `<p class="notice notice-info">Este comprobante fue ${reemplazado === 'eliminado' ? 'eliminado' : 'reemplazado'}; la venta quedó libre para emitirse de nuevo.</p>` : ''}
        <dl class="kv">
          <div><dt>Cliente</dt><dd>${esc(f.cliente.razon_social || '—')}</dd></div>
          <div><dt>Documento</dt><dd>${esc(nombreTipoDoc(f.cliente.tipo_doc))} ${esc(f.cliente.num_doc)}</dd></div>
          <div><dt>Total</dt><dd>${f.total_oficial != null ? esc(soles(f.total_oficial)) : '—'}</dd></div>
          ${f.afectado ? `<div><dt>Documento afectado</dt><dd>${esc(f.afectado)}</dd></div>` : ''}
          ${local?.venta_id ? `<div><dt>Venta</dt><dd><a href="#/ventas/${local.venta_id}">#${local.venta_id}</a></dd></div>` : ''}
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
          ${aceptado ? '<button class="btn" type="button" data-archivo="cdr">CDR</button>' : ''}
        </div>
        ${aceptado ? '' : '<p class="muted small">El CDR existe solo cuando SUNAT acepta el comprobante.</p>'}
      </section>

      <section class="panel">
        <h2>Acciones</h2>
        <div class="row-actions">
          ${!aceptado ? '<button class="btn" type="button" id="btn-consultar">Consultar estado</button>' : ''}
          ${editable && !reemplazado ? '<button class="btn btn-primary" type="button" id="btn-enviar">Enviar a SUNAT</button>' : ''}
          ${editable && !reemplazado && admin ? '<button class="btn" type="button" id="btn-corregir">Corregir</button>' : ''}
          ${editable && !reemplazado && admin && tipo === '03' ? '<button class="btn btn-ghost-danger" type="button" id="btn-eliminar">Eliminar boleta</button>' : ''}
          ${f.sunat_status === 'rechazado' && !reemplazado && admin && local?.venta_id ? '<button class="btn btn-ghost-danger" type="button" id="btn-liberar">Emitir con nuevo número</button>' : ''}
        </div>
        ${aceptado && admin ? `
          <div class="row-actions">
            ${['01', '03'].includes(tipo) && !nrus ? `<a class="btn" href="#/comprobantes/${ruta}/${esc(apiId)}/nota-credito">Nota de crédito</a>` : ''}
            ${['01', '03'].includes(tipo) && !nrus ? `<a class="btn" href="#/comprobantes/${ruta}/${esc(apiId)}/nota-debito">Nota de débito</a>` : ''}
            ${['01', '07', '08'].includes(tipo) && !local?.baja_api_id ? `<button class="btn btn-ghost-danger" type="button" id="btn-baja" ${errBaja ? 'disabled' : ''}>Comunicar baja</button>` : ''}
            ${tipo === '03' && !local?.baja_api_id ? `<button class="btn btn-ghost-danger" type="button" id="btn-anular-rc" ${errAnular ? 'disabled' : ''}>Anular por resumen</button>` : ''}
          </div>
          ${['01', '07', '08'].includes(tipo) && errBaja && !local?.baja_api_id ? `<p class="muted small">${esc(errBaja)}</p>` : ''}
          ${tipo === '03' && errAnular && !local?.baja_api_id ? `<p class="muted small">${esc(errAnular)}</p>` : ''}
          ${!(tipo === '03' ? errAnular : (['01', '07', '08'].includes(tipo) ? errBaja : 'n/a')) && !local?.baja_api_id ? `<p class="muted small">Plazo para baja o anulación: ${Math.max(diasRestantes(f.fecha_emision), 0)} día(s) más. Después, solo con nota de crédito.</p>` : ''}` : ''}
        ${local?.baja_api_id ? `<p class="notice notice-info small">${local.baja_tipo === 'resumen' ? 'Anulación por resumen' : 'Comunicación de baja'} enviada: ${esc(ESTADOS[local.baja_estado]?.texto || local.baja_estado || 'en proceso')}. Consulta su estado en Operaciones SUNAT.</p>` : ''}
      </section>

      ${tipo === '01' && (aceptado || enProceso) ? `
        <section class="panel" id="pagos">
          <div class="panel-head"><h2>Pagos y saldo</h2><button class="btn btn-sm" type="button" id="btn-pagos">Ver pagos</button></div>
          <div id="pagos-body"><p class="muted small">Para facturas al crédito: registra los cobros de cada cuota.</p></div>
        </section>` : ''}

      ${items.length ? `
        <section class="panel">
          <h2>Ítems</h2>
          ${tablaDatos({
            filas: items,
            columnas: [
              { titulo: 'Descripción', celda: it => `${esc(it.descripcion)}${it.codigo ? `<span class="sub font-id">${esc(it.codigo)}</span>` : ''}` },
              { titulo: 'Cant.', clase: 'num', celda: it => esc(it.cantidad) },
              { titulo: 'P. unit.', clase: 'num', sec: true, celda: it => esc(soles(it.precio_unitario)) },
              { titulo: 'IGV', sec: true, celda: it => esc((AFECTACIONES.find(a => a[0] === it.tip_afe_igv) || [0, it.tip_afe_igv])[1]) },
              { titulo: 'Importe', clase: 'num', celda: it => esc(soles(Number(it.cantidad) * Number(it.precio_unitario))) }
            ]
          })}
        </section>` : ''}
      ${crudo(info.crudo)}`;

    conectar();
  };

  const conectar = () => {
    $$('[data-archivo]', caja).forEach(b => b.addEventListener('click', () => conCarga(b, () => abrir(ruta, apiId, info.fila, b.dataset.archivo, b.dataset.formato))));
    $('#btn-consultar', caja)?.addEventListener('click', ev => conCarga(ev.currentTarget, cargar));
    $('#btn-enviar', caja)?.addEventListener('click', ev => conCarga(ev.currentTarget, async () => {
      try {
        const r = await enviarASunat(ruta, apiId);
        toast(r.mensaje || 'Enviado a SUNAT. Consultando la respuesta…', 'ok');
        await esperarYRecargar();
      } catch (e) { toastError(e); }
    }));
    $('#btn-corregir', caja)?.addEventListener('click', () => editorCorreccion(ruta, apiId, info, async () => {
      toast('Corrección enviada. La API la reenvía a SUNAT.', 'ok');
      await esperarYRecargar();
    }));
    $('#btn-eliminar', caja)?.addEventListener('click', async ev => {
      const b = ev.currentTarget;
      if (!await confirmar('Eliminar boleta', 'La boleta se elimina de la API (no fue aceptada). La venta queda sin comprobante para emitir otra.', 'Eliminar', true)) return;
      await conCarga(b, async () => {
        try {
          await eliminarBoleta(apiId);
          toast('Boleta eliminada.', 'ok');
          const local = info.local;
          location.hash = local?.venta_id ? `#/ventas/${local.venta_id}` : `#/comprobantes/${ruta}`;
        } catch (e) { toastError(e); }
      });
    });
    $('#btn-baja', caja)?.addEventListener('click', () => pedirMotivo('Comunicar baja',
      'Se envía a SUNAT una comunicación de baja. Si SUNAT la acepta, el comprobante queda anulado.', 'Error en los datos del comprobante',
      async motivo => {
        await comunicarBaja({ ...info.fila, api_id: info.fila.api_id ?? apiId }, motivo);
        toast('Comunicación de baja enviada. Revisa su estado en Operaciones SUNAT → Bajas.', 'ok', 6000);
        await cargar();
      }));
    $('#btn-anular-rc', caja)?.addEventListener('click', () => pedirMotivo('Anular boleta por resumen',
      'Las boletas aceptadas se anulan con un resumen diario de anulación. Si SUNAT lo acepta, la boleta queda anulada.', 'Anulación solicitada por el cliente',
      async motivo => {
        await anularBoletaPorResumen({ ...info.fila, api_id: info.fila.api_id ?? apiId }, motivo);
        toast('Resumen de anulación enviado. Revisa su estado en Operaciones SUNAT → Resumen diario.', 'ok', 6000);
        await cargar();
      }));
    $('#btn-pagos', caja)?.addEventListener('click', ev => conCarga(ev.currentTarget, () => pintarPagos($('#pagos-body', caja), ruta, apiId, info.fila.total_oficial)));
    $('#btn-liberar', caja)?.addEventListener('click', async () => {
      if (!await confirmar('Emitir con nuevo número',
        'El comprobante rechazado queda en el historial y la venta vuelve a "sin comprobante" para emitirla con el siguiente correlativo.', 'Continuar', true)) return;
      const venta = liberarVenta(info.local, 'reemplazado');
      toast('Venta liberada. Emite el nuevo comprobante.', 'ok');
      location.hash = `#/ventas/${venta.id}`;
    });
  };

  const esperarYRecargar = async () => {
    for (let i = 0; i < 6 && sigueAqui(); i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 1500 : 2500));
      if (!sigueAqui()) return;
      await cargar();
      if (esFinal(info?.fila.sunat_status)) return;
    }
  };

  await cargar();
}

async function abrir(ruta, apiId, fila, tipoArchivo, formato) {
  const extension = tipoArchivo === 'pdf' ? 'pdf' : tipoArchivo === 'xml' ? 'xml' : 'zip';
  const nombre = `${fila.serie}-${fila.correlativo ?? apiId}${tipoArchivo === 'cdr' ? '-CDR' : ''}.${extension}`;
  const ventana = tipoArchivo === 'pdf' ? window.open('', '_blank') : null;
  try {
    const blob = await descargar(`/${ruta}/${apiId}/${tipoArchivo}`, tipoArchivo === 'pdf' ? queryPdf(formato) : undefined);
    const url = URL.createObjectURL(blob);
    if (ventana && !ventana.closed) ventana.location.href = url;
    else {
      const a = document.createElement('a');
      a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    if (ventana && !ventana.closed) ventana.close();
    toastError(e);
  }
}

// ---------- Corrección (PUT) ----------
function editorCorreccion(ruta, apiId, info, alTerminar) {
  const tipo = TIPO_POR_RUTA[ruta];
  const cli = { ...info.fila.cliente };
  // Ítems de la API; si no vienen, se parte de la venta local.
  let items = info.items.map(i => ({ ...i }));
  if (!items.length && info.local?.venta_id) {
    const venta = store.buscar('ventas', info.local.venta_id);
    items = armarPayload({ ...venta, tipo, items: itemsDeVenta(venta.id) }, { serie: info.fila.serie }).items;
  }
  if (!items.length) items = [{ codigo: '', descripcion: '', unidad: 'NIU', cantidad: 1, precio_unitario: 0, tip_afe_igv: '10' }];

  const filaItem = (it, i) => `
    <div class="corr-item" data-i="${i}">
      ${campo({ nombre: 'descripcion', etiqueta: `Ítem ${i + 1}`, valor: it.descripcion })}
      <div class="corr-row">
        ${campo({ nombre: 'cantidad', etiqueta: 'Cant.', valor: it.cantidad, tipo: 'number', attrs: 'min="0" step="any"' })}
        ${campo({ nombre: 'precio_unitario', etiqueta: 'Precio c/IGV', valor: it.precio_unitario, tipo: 'number', attrs: 'min="0" step="0.0001"' })}
        ${selector({ nombre: 'tip_afe_igv', etiqueta: 'IGV', opciones: AFECTACIONES, valor: it.tip_afe_igv })}
        ${selector({ nombre: 'unidad', etiqueta: 'Unidad', opciones: UNIDADES, valor: it.unidad })}
      </div>
      <input type="hidden" name="codigo" value="${esc(it.codigo)}">
      <input type="hidden" name="cod_producto_sunat" value="${esc(it.cod_producto_sunat || '')}">
      <button class="link-btn text-danger" type="button" data-quitar>Quitar ítem</button>
    </div>`;

  const d = modal({
    titulo: `Corregir ${info.fila.serie}-${info.fila.correlativo ?? ''}`,
    contenido: `
      <p class="muted small">Se envía con PUT y la API lo reenvía a SUNAT. Solo se puede si no está aceptado.</p>
      <h3 class="sub">Cliente</h3>
      <div class="form-grid" id="corr-cli">
        ${selector({ nombre: 'tipo_doc', etiqueta: 'Tipo de documento', opciones: tipo === '01' ? [['6', 'RUC']] : TIPOS_DOC, valor: cli.tipo_doc || (tipo === '01' ? '6' : '1') })}
        ${campo({ nombre: 'num_doc', etiqueta: 'Número', valor: cli.num_doc })}
        ${campo({ nombre: 'razon_social', etiqueta: 'Nombre o razón social', valor: cli.razon_social })}
        ${campo({ nombre: 'direccion', etiqueta: 'Dirección', valor: cli.direccion })}
      </div>
      <h3 class="sub">Ítems</h3>
      <div id="corr-items">${items.map(filaItem).join('')}</div>
      <button class="link-btn" type="button" id="corr-add">+ Agregar ítem</button>
      <p class="form-error" id="corr-error" role="alert"></p>`,
    acciones: '<button class="btn" value="cancelar">Cancelar</button><button class="btn btn-primary" value="ok" id="btn-corr-ok">Guardar y reenviar</button>'
  });

  const lista = $('#corr-items', d);
  lista.addEventListener('click', ev => {
    if (!ev.target.closest('[data-quitar]')) return;
    if ($$('.corr-item', lista).length === 1) return toast('Debe quedar al menos un ítem.', 'warn');
    ev.target.closest('.corr-item').remove();
  });
  $('#corr-add', d).addEventListener('click', () => {
    lista.insertAdjacentHTML('beforeend', filaItem({ codigo: '', descripcion: '', unidad: 'NIU', cantidad: 1, precio_unitario: '', tip_afe_igv: '10' }, $$('.corr-item', lista).length));
  });

  $('#btn-corr-ok', d).addEventListener('click', ev => {
    ev.preventDefault();
    const err = $('#corr-error', d);
    const c = $('#corr-cli', d);
    const cliente = {};
    $$('input, select', c).forEach(i => { cliente[i.name] = i.value.trim(); });
    cliente.razon_social = cliente.razon_social.toUpperCase();
    const errDoc = errorDocumento(cliente.tipo_doc, cliente.num_doc);
    if (errDoc) { err.textContent = errDoc; return; }
    const nuevos = $$('.corr-item', lista).map(row => {
      const o = {};
      $$('input, select', row).forEach(i => { o[i.name] = i.value.trim(); });
      o.cantidad = Number(o.cantidad);
      o.precio_unitario = Number(o.precio_unitario);
      if (!o.codigo) o.codigo = 'ITEM';
      return o;
    });
    conCarga(ev.currentTarget, async () => {
      try {
        await corregirComprobante(ruta, apiId, { cliente, items: nuevos });
        cerrarModal();
        await alTerminar();
      } catch (e) {
        err.textContent = [e.message, ...(e.detalle?.() || [])].join('\n');
      }
    });
  });
}

// Modal con motivo obligatorio para bajas y anulaciones.
function pedirMotivo(titulo, texto, sugerido, accion) {
  const d = modal({
    titulo,
    contenido: `<p>${esc(texto)}</p>${campo({ nombre: 'motivo', etiqueta: 'Motivo', valor: sugerido, req: true, attrs: 'maxlength="100"' })}<p class="form-error" id="motivo-error"></p>`,
    acciones: '<button class="btn" value="cancelar">Cancelar</button><button class="btn btn-danger" value="ok" id="btn-motivo-ok">Enviar a SUNAT</button>'
  });
  $('#btn-motivo-ok', d).addEventListener('click', ev => {
    ev.preventDefault();
    const motivo = $('[name=motivo]', d).value.trim();
    conCarga(ev.currentTarget, async () => {
      try {
        await accion(motivo);
        cerrarModal();
      } catch (e) {
        $('#motivo-error', d).textContent = [e.message, ...(e.detalle?.() || [])].join('\n');
      }
    });
  });
}

// Pagos de una factura al crédito (GET/POST/DELETE /facturas/{id}/pagos).
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
      <div><dt>Total</dt><dd>${total != null ? soles(total) : '—'}</dd></div>
      <div><dt>Pagado</dt><dd>${soles(pagado)}</dd></div>
      <div><dt>Saldo</dt><dd class="${saldo > 0 ? 'text-danger' : ''}">${saldo != null ? soles(saldo) : '—'}</dd></div>
    </dl>
    ${tablaDatos({
      filas: pagos,
      vacio: 'Sin pagos registrados.',
      columnas: [
        { titulo: 'Fecha', clase: 'nw', celda: p => esc(p.fecha || '') },
        { titulo: 'Método', celda: p => esc((METODOS_PAGO.find(m => m[0] === p.metodo) || [0, p.metodo || ''])[1]) },
        { titulo: 'Referencia', sec: true, celda: p => (p.referencia ? `<span class="font-id">${esc(p.referencia)}</span>` : '') },
        { titulo: 'Monto', clase: 'num', celda: p => esc(soles(p.monto)) },
        ...(auth.esAdmin() ? [{ titulo: '', clase: 'col-acciones', celda: p => (p.id != null ? `<button class="btn btn-sm btn-ghost-danger" type="button" data-pago="${esc(p.id)}">Eliminar</button>` : '') }] : [])
      ]
    })}
    ${saldo === 0 && total != null ? '<p class="pill pill-ok">Cancelada</p>' : `
      <form class="form-grid" id="f-pago" novalidate>
        ${campo({ nombre: 'monto', etiqueta: 'Monto S/', valor: saldo ?? '', tipo: 'number', req: true, attrs: 'min="0" step="0.01" inputmode="decimal"' })}
        ${campo({ nombre: 'fecha', etiqueta: 'Fecha', valor: hoyLima(), tipo: 'date', req: true })}
        ${selector({ nombre: 'metodo', etiqueta: 'Método', opciones: METODOS_PAGO, valor: 'transferencia' })}
        ${campo({ nombre: 'referencia', etiqueta: 'Referencia (n.º de operación)' })}
        <p class="form-error span-all" id="pago-error"></p>
        <div class="form-actions span-all"><button class="btn btn-primary" type="submit">Registrar pago</button></div>
      </form>`}`;

  $('#f-pago', caja)?.addEventListener('submit', ev => {
    ev.preventDefault();
    const fp = ev.currentTarget;
    const p = {
      monto: Number($('[name=monto]', fp).value), fecha: $('[name=fecha]', fp).value,
      metodo: $('[name=metodo]', fp).value, referencia: $('[name=referencia]', fp).value.trim()
    };
    const msg = validarPago(p, saldo);
    if (msg) { $('#pago-error', fp).textContent = msg; return; }
    if (!p.referencia) delete p.referencia;
    conCarga(fp.querySelector('[type=submit]'), async () => {
      try {
        await api.registrarPago(ruta, apiId, p);
        toast('Pago registrado.', 'ok');
        await pintarPagos(caja, ruta, apiId, total);
      } catch (e) { $('#pago-error', fp).textContent = [e.message, ...(e.detalle?.() || [])].join('\n'); }
    });
  });
  $$('[data-pago]', caja).forEach(b => b.addEventListener('click', async () => {
    if (!await confirmar('Eliminar pago', 'Se eliminará este pago registrado.', 'Eliminar', true)) return;
    try {
      await api.eliminarPago(ruta, apiId, b.dataset.pago);
      toast('Pago eliminado.', 'ok');
      await pintarPagos(caja, ruta, apiId, total);
    } catch (e) { toastError(e); }
  }));
}
