// Operaciones SUNAT: resumen diario, bajas, guías de remisión, cobranzas y consultas.
import { store } from '../store.js';
import { auth } from '../auth.js';
import { api, comoLista, descargar } from '../api.js';
import { soles, TIPOS_DOC, UNIDADES, errorDocumento, r2 } from '../validar.js';
import {
  esc, $, $$, toast, toastError, confirmar, conCarga, campo, selector, crudo, vacioMsg, fecha, visorPdf, tablaDatos
} from '../ui.js';
import { ESTADOS, normalizarEstado, leerCpe, hoyLima, itemsDeVenta, numeroCpe, TIPOS_CPE } from '../comprobantes.js';
import {
  boletasPendientes, agruparPorFecha, enviarResumen, leerEstadoProceso, aplicarResultadoBaja, PLAZO_DIAS,
  MOTIVOS_TRASLADO, validarGuia, armarGuia, guardarGuiaLocal
} from '../tributario.js';

const SECCIONES = [['resumen', 'Resumen diario'], ['bajas', 'Bajas'], ['guias', 'Guías de remisión'], ['cobranzas', 'Cobranzas'], ['consultas', 'Consultas']];

export function vistaSunat(cont, partes) {
  const actual = SECCIONES.some(s => s[0] === partes[0]) ? partes[0] : 'resumen';
  cont.innerHTML = `
    <h1 class="page-title">Operaciones SUNAT</h1>
    <nav class="tabs" aria-label="Operaciones">
      ${SECCIONES.map(([id, t]) => `<a href="#/sunat/${id}" class="tab ${id === actual ? 'is-active' : ''}">${t}</a>`).join('')}
    </nav>
    <div id="sunat-body"></div>`;
  const cuerpo = $('#sunat-body', cont);
  const fn = { resumen, bajas, guias, cobranzas, consultas }[actual];
  return fn(cuerpo, partes.slice(1));
}

const pill = e => `<span class="pill ${ESTADOS[e]?.clase || ''}">${esc(ESTADOS[e]?.texto || e)}</span>`;
const mesActual = () => hoyLima().slice(0, 7);

function guardarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function bajar(ruta, nombre) {
  try { guardarBlob(await descargar(ruta), nombre); } catch (e) { toastError(e); }
}

// Fila genérica de resumen o anulación (formato no documentado).
function leerProceso(x) {
  const e = leerEstadoProceso(x);
  return {
    id: x.id,
    identificador: x.identificador ?? x.identifier ?? x.correlativo_resumen ?? x.nombre ?? `#${x.id}`,
    fecha: String(x.fecha_referencia ?? x.fecha_resumen ?? x.fecha_generacion ?? x.fecha ?? x.creado_en ?? x.created_at ?? '').slice(0, 10),
    tipo: x.tipo ?? (Array.isArray(x.anular) && x.anular.length ? 'anulacion' : null),
    estado: e.estado,
    mensaje: e.mensaje,
    ticket: e.ticket,
    cantidad: x.total_documentos ?? ((x.detalles ?? x.boletas ?? x.documentos ?? []).length || x.cantidad || null)
  };
}

// ---------- Resumen diario ----------
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
    const caja = $('#rc-pend', cuerpo);
    try {
      const grupos = agruparPorFecha(await boletasPendientes());
      if (!grupos.length) { caja.innerHTML = vacioMsg('No hay boletas pendientes de resumen.'); return; }
      caja.innerHTML = tablaDatos({
        filas: grupos,
        columnas: [
          { titulo: 'Fecha de emisión', clase: 'nw', celda: g => `<strong>${esc(g.fecha)}</strong>` },
          { titulo: 'Boletas', clase: 'num', celda: g => esc(g.lista.length) },
          { titulo: 'Números', sec: true, celda: g => `<span class="font-id">${g.lista.slice(0, 6).map(b => esc(numeroCpe(b))).join(', ')}${g.lista.length > 6 ? '…' : ''}</span>` },
          { titulo: 'Total', clase: 'num', celda: g => esc(soles(g.total)) },
          { titulo: 'Plazo', celda: g => `<span class="pill ${g.restantes < 0 ? 'pill-danger' : g.restantes <= 2 ? 'pill-warn' : 'pill-ok'}">${g.restantes < 0 ? `Vencido hace ${-g.restantes} día(s)` : g.restantes === 0 ? 'Último día' : `Quedan ${g.restantes} día(s)`}</span>` },
          { titulo: '', clase: 'col-acciones', celda: g => `<button class="btn btn-primary btn-sm" type="button" data-rc="${esc(g.fecha)}">Enviar resumen</button>` }
        ]
      });
      $$('[data-rc]', caja).forEach(b => b.addEventListener('click', async () => {
        if (!await confirmar('Enviar resumen diario', `Se enviarán a SUNAT todas las boletas pendientes del ${b.dataset.rc}.`, 'Enviar')) return;
        await conCarga(b, async () => {
          try {
            const r = await enviarResumen(b.dataset.rc);
            toast(r.mensaje || 'Resumen enviado. Consulta su estado en la lista.', 'ok');
            await cargarPendientes();
            await cargarLista();
          } catch (e) { toastError(e); }
        });
      }));
    } catch (e) { caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`; }
  };

  const cargarLista = async () => {
    const caja = $('#rc-lista', cuerpo);
    caja.innerHTML = '<p class="loading">Consultando…</p>';
    try {
      const r = await api.resumenes({ mes: $('#rc-mes', cuerpo).value, por_pagina: 50 });
      const filas = comoLista(r.datos).map(leerProceso);
      caja.innerHTML = filas.length ? filaProcesos(filas, 'resumenes') + crudo(r.crudo) : vacioMsg('No hay resúmenes en este mes.') + crudo(r.crudo);
      conectarProcesos(caja, 'resumenes', filas, cargarLista);
    } catch (e) { caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`; }
  };

  $('#btn-rc-recargar', cuerpo).addEventListener('click', ev => conCarga(ev.currentTarget, cargarPendientes));
  $('#rc-mes', cuerpo).addEventListener('change', cargarLista);
  await Promise.all([cargarPendientes(), cargarLista()]);
}

function filaProcesos(filas, ruta) {
  return tablaDatos({
    filas,
    columnas: [
      { titulo: 'Identificador', celda: f => `<strong class="font-id">${esc(f.identificador)}</strong><span class="sub">${esc(f.fecha)}</span>` },
      { titulo: 'Tipo', sec: true, celda: f => esc(f.tipo === 'anulacion' ? 'Anulación' : f.tipo || '') },
      { titulo: 'Documentos', sec: true, clase: 'num', celda: f => esc(f.cantidad ?? '') },
      { titulo: 'Ticket', sec: true, celda: f => (f.ticket ? `<span class="font-id">${esc(f.ticket)}</span>` : '') },
      { titulo: 'Estado', celda: f => pill(f.estado) },
      { titulo: 'Respuesta SUNAT', sec: true, celda: f => esc(f.mensaje || '') },
      { titulo: '', clase: 'col-acciones', celda: f => `<span class="acciones-fila">
          <button class="btn btn-sm" type="button" data-estado="${esc(f.id)}">Consultar</button>
          ${f.estado === 'pendiente' ? `<button class="btn btn-sm btn-primary" type="button" data-enviar="${esc(f.id)}">Enviar</button>` : ''}
          <button class="btn btn-sm" type="button" data-xml="${esc(f.id)}">XML</button>
          ${['aceptado', 'observado'].includes(f.estado) ? `<button class="btn btn-sm" type="button" data-cdr="${esc(f.id)}">CDR</button>` : ''}
        </span>` }
    ]
  });
}

// Acciones comunes de resúmenes (RC) y comunicaciones de baja (RA/RR).
function conectarProcesos(caja, ruta, filas, recargar) {
  const porId = id => filas.find(f => String(f.id) === String(id));
  $$('[data-estado]', caja).forEach(b => b.addEventListener('click', () => conCarga(b, async () => {
    try {
      const r = ruta === 'resumenes' ? await api.estadoResumen(b.dataset.estado) : await api.estadoAnulacion(b.dataset.estado);
      const e = leerEstadoProceso(r.datos);
      // Si la anulación fue aceptada, los comprobantes locales quedan anulados.
      const locales = store.todos('comprobantes').filter(c => String(c.baja_api_id) === String(b.dataset.estado));
      for (const c of locales) aplicarResultadoBaja(c.tipo, c.api_id, e.estado);
      toast(`${porId(b.dataset.estado)?.identificador || ''}: ${ESTADOS[e.estado]?.texto || e.estado}${e.mensaje ? ` · ${e.mensaje}` : ''}`, e.estado === 'rechazado' ? 'error' : 'ok', 6000);
      await recargar();
    } catch (e) { toastError(e); }
  })));
  $$('[data-enviar]', caja).forEach(b => b.addEventListener('click', () => conCarga(b, async () => {
    try {
      ruta === 'resumenes' ? await api.enviarResumen(b.dataset.enviar) : await api.enviarAnulacion(b.dataset.enviar);
      toast('Enviado a SUNAT.', 'ok');
      await recargar();
    } catch (e) { toastError(e); }
  })));
  $$('[data-xml]', caja).forEach(b => b.addEventListener('click', () => conCarga(b, () => bajar(`/${ruta}/${b.dataset.xml}/xml`, `${porId(b.dataset.xml)?.identificador || b.dataset.xml}.xml`))));
  $$('[data-cdr]', caja).forEach(b => b.addEventListener('click', () => conCarga(b, () => bajar(`/${ruta}/${b.dataset.cdr}/cdr`, `${porId(b.dataset.cdr)?.identificador || b.dataset.cdr}-CDR.zip`))));
}

// ---------- Bajas ----------
async function bajas(cuerpo) {
  const admin = auth.esAdmin();
  cuerpo.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>Comunicaciones de baja</h2>
        <select id="ra-estado" class="input-auto" aria-label="Estado">
          ${[['', 'Todas'], ['pendiente', 'Pendientes'], ['aceptado', 'Aceptadas'], ['rechazado', 'Rechazadas']].map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}
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
          ${selector({ nombre: 'tipo_documento', etiqueta: 'Tipo', opciones: [['01', 'Factura'], ['07', 'Nota de crédito'], ['08', 'Nota de débito']], valor: '01' })}
          ${campo({ nombre: 'serie', etiqueta: 'Serie', req: true, attrs: 'maxlength="4"' })}
          ${campo({ nombre: 'correlativo', etiqueta: 'Número', req: true, attrs: 'inputmode="numeric"' })}
          ${campo({ nombre: 'motivo', etiqueta: 'Motivo', req: true, attrs: 'maxlength="100"' })}
          <p class="form-error span-all" id="ra-error"></p>
          <div class="form-actions span-all"><button class="btn btn-danger" type="submit">Comunicar baja</button></div>
        </form>
      </details>
    </section>` : ''}`;

  const cargar = async () => {
    const caja = $('#ra-lista', cuerpo);
    caja.innerHTML = '<p class="loading">Consultando…</p>';
    try {
      const r = await api.anulaciones({ estado: $('#ra-estado', cuerpo).value, por_pagina: 50 });
      const filas = comoLista(r.datos).map(leerProceso);
      caja.innerHTML = filas.length ? filaProcesos(filas, 'anulaciones') + crudo(r.crudo) : vacioMsg('No hay comunicaciones de baja.') + crudo(r.crudo);
      conectarProcesos(caja, 'anulaciones', filas, cargar);
    } catch (e) { caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`; }
  };
  $('#ra-estado', cuerpo).addEventListener('change', cargar);

  $('#f-ra', cuerpo)?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const d = Object.fromEntries([...f.querySelectorAll('input, select')].map(i => [i.name, i.value.trim()]));
    d.serie = d.serie.toUpperCase();
    const err = $('#ra-error', f);
    if (!/^[F][A-Z0-9]{3}$/.test(d.serie)) { err.textContent = 'La serie debe empezar con F (facturas y sus notas).'; return; }
    if (!/^\d+$/.test(d.correlativo)) { err.textContent = 'Número inválido.'; return; }
    if (d.motivo.length < 4) { err.textContent = 'Describe el motivo.'; return; }
    if (!await confirmar('Comunicar baja', `Se pedirá a SUNAT dar de baja ${d.serie}-${d.correlativo}.`, 'Enviar', true)) return;
    await conCarga(f.querySelector('[type=submit]'), async () => {
      try {
        const hoy = hoyLima();
        await api.crearAnulacion({ fecha_generacion: hoy, fecha_comunicacion: hoy, detalles: [d] });
        toast('Comunicación de baja enviada.', 'ok');
        f.reset();
        await cargar();
      } catch (e) { err.textContent = [e.message, ...(e.detalle?.() || [])].join('\n'); }
    });
  });
  await cargar();
}

// ---------- Guías de remisión ----------
async function guias(cuerpo, partes) {
  if (partes[0] === 'nueva') return formGuia(cuerpo, null);
  if (partes[0] && partes[1] === 'editar') return editarGuia(cuerpo, partes[0]);
  if (partes[0]) return detalleGuia(cuerpo, partes[0]);

  cuerpo.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>Guías de remisión remitente</h2>
        ${auth.esAdmin() ? '<a class="btn btn-primary" href="#/sunat/guias/nueva">Nueva guía</a>' : ''}
      </div>
      <p class="muted small">Para trasladar mercadería: entregas a domicilio o entre locales propios.</p>
      <div id="gr-lista"><p class="loading">Consultando…</p></div>
    </section>`;
  const caja = $('#gr-lista', cuerpo);
  try {
    const r = await api.guias({ tipo_documento: '09', por_pagina: 50 });
    const filas = comoLista(r.datos).map(x => ({ ...leerCpe(x), fecha: (x.fecha_emision ?? '').slice(0, 10), destino: x.destinatario?.razon_social ?? x.destinatario_razon_social ?? '' }));
    caja.innerHTML = tablaDatos({
      filas,
      vacio: 'Aún no hay guías.',
      enlace: g => `#/sunat/guias/${g.api_id}`,
      columnas: [
        { titulo: 'Guía', celda: g => `<strong class="font-id">${esc(numeroCpe(g))}</strong>` },
        { titulo: 'Destinatario', sec: true, celda: g => esc(g.destino) },
        { titulo: 'Emisión', sec: true, clase: 'nw', celda: g => esc(g.fecha) },
        { titulo: 'Estado', celda: g => pill(g.sunat_status) },
        { titulo: 'Respuesta SUNAT', sec: true, celda: g => esc(g.mensaje_sunat || '') },
        { titulo: '', clase: 'col-acciones', celda: (g, i) => `<span class="acciones-fila">
            <button class="btn btn-sm" type="button" data-gpdf="${i}">PDF</button>
            <a class="btn btn-sm" href="#/sunat/guias/${esc(g.api_id)}">Ver</a>
          </span>` }
      ]
    }) + crudo(r.crudo);
    $$('[data-gpdf]', caja).forEach(b => b.addEventListener('click', () => verGuia(filas[Number(b.dataset.gpdf)])));
  } catch (e) { caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`; }
}

async function detalleGuia(cuerpo, apiId) {
  const local = store.todos('comprobantes').find(c => c.tipo === '09' && String(c.api_id) === String(apiId));
  cuerpo.innerHTML = `<a class="back-link" href="#/sunat/guias">← Guías</a><div id="gr-det"><p class="loading">Consultando…</p></div>`;
  const caja = $('#gr-det', cuerpo);

  const pintar = async () => {
    let g, crudoResp;
    try {
      const r = await api.guia(apiId);
      g = r.datos?.guia || r.datos || {};
      crudoResp = r.crudo;
    } catch (e) { caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`; return; }
    const c = leerCpe(g);
    if (local && c.sunat_status !== 'desconocido') store.actualizar('comprobantes', local.id, { sunat_status: c.sunat_status, correlativo: c.correlativo ?? local.correlativo, mensaje_sunat: c.mensaje_sunat });
    const editable = ['pendiente', 'rechazado'].includes(c.sunat_status) && auth.esAdmin();
    caja.innerHTML = `
      <section class="panel">
        <div class="cpe-head">
          <div><span class="muted small">Guía de remisión remitente</span><div class="cpe-num">${esc(numeroCpe(c))}</div></div>
          <span class="pill pill-lg ${ESTADOS[c.sunat_status]?.clase || ''}">${esc(ESTADOS[c.sunat_status]?.texto || c.sunat_status)}</span>
        </div>
        ${c.mensaje_sunat ? `<p class="small"><strong>SUNAT:</strong> ${esc(c.mensaje_sunat)}</p>` : ''}
        <p class="muted small">Las guías usan la API GRE de SUNAT: el resultado llega por ticket. Consulta el estado hasta tener respuesta.</p>
        <div class="row-actions">
          <button class="btn" type="button" id="gr-estado">Consultar estado</button>
          ${c.sunat_status === 'pendiente' ? '<button class="btn btn-primary" type="button" id="gr-enviar">Enviar a SUNAT</button>' : ''}
          <button class="btn" type="button" id="gr-pdf">PDF A4</button>
          <button class="btn" type="button" id="gr-xml">XML</button>
          ${editable ? (local?.payload ? '<a class="btn" href="#/sunat/guias/' + esc(apiId) + '/editar" id="gr-editar">Corregir</a>' : '<span class="muted small">Corregir solo es posible para guías creadas desde este sistema.</span>') : ''}
        </div>
      </section>
      ${crudo(crudoResp)}`;

    $('#gr-estado', caja).addEventListener('click', ev => conCarga(ev.currentTarget, async () => {
      try {
        const r = await api.estadoGuia(apiId);
        const e = leerEstadoProceso(r.datos);
        toast(`${ESTADOS[e.estado]?.texto || e.estado}${e.mensaje ? ` · ${e.mensaje}` : ''}`, e.estado === 'rechazado' ? 'error' : 'ok', 6000);
        await pintar();
      } catch (e) { toastError(e); }
    }));
    $('#gr-enviar', caja)?.addEventListener('click', ev => conCarga(ev.currentTarget, async () => {
      try { await api.enviarGuia(apiId); toast('Guía enviada. Consulta el estado en unos segundos.', 'ok'); await pintar(); } catch (e) { toastError(e); }
    }));
    $('#gr-pdf', caja).addEventListener('click', ev => conCarga(ev.currentTarget, () => bajar(`/guias-remision/${apiId}/pdf?format=a4`, `${numeroCpe(c)}.pdf`)));
    $('#gr-xml', caja).addEventListener('click', ev => conCarga(ev.currentTarget, () => bajar(`/guias-remision/${apiId}/xml`, `${numeroCpe(c)}.xml`)));
  };
  await pintar();
}

function formGuia(cuerpo, existente) {
  const cfg = store.config();
  const base = existente?.payload;
  const hoy = hoyLima();
  const g = {
    serie: base?.serie || cfg.serie_guia || 'T001',
    fecha_emision: hoy,
    destinatario: base?.destinatario || { tipo_doc: '6', num_doc: '', razon_social: '' },
    cod_traslado: base?.cod_traslado || '01',
    mod_traslado: base?.mod_traslado || '02',
    m1l: Boolean(base?.indicadores?.length),
    fecha_traslado: base?.fecha_traslado && base.fecha_traslado >= hoy ? base.fecha_traslado : hoy,
    peso_total: base?.peso_total ?? '',
    num_bultos: base?.num_bultos ?? '',
    partida_ubigeo: base?.partida_ubigeo || cfg.ubigeo || '',
    partida_direccion: base?.partida_direccion || cfg.direccion || '',
    llegada_ubigeo: base?.llegada_ubigeo || '',
    llegada_direccion: base?.llegada_direccion || '',
    partida_cod_local: base?.partida_cod_local || '0000',
    llegada_cod_local: base?.llegada_cod_local || '',
    transportista: base?.transportista || { tipo_doc: '6', num_doc: '', razon_social: '', nro_mtc: '' },
    vehiculo: base?.vehiculo || { placa: '' },
    conductor: base?.conductor || { tipo_doc: '1', num_doc: '', nombres: '', apellidos: '', licencia: '' },
    items: base?.items?.map(i => ({ ...i })) || []
  };
  const ventas = store.todos('ventas').filter(v => v.estado !== 'anulada').sort((a, b) => b.id - a.id).slice(0, 25);
  const clientes = store.todos('clientes');

  cuerpo.innerHTML = `
    <a class="back-link" href="#/sunat/guias">← Guías</a>
    <h2 class="sub">${existente ? `Corregir guía ${esc(numeroCpe(existente))}` : 'Nueva guía de remisión'}</h2>
    <form id="f-gr" novalidate>
      <section class="panel">
        <h2>Destinatario y motivo</h2>
        <div class="form-grid">
          ${selector({ nombre: 'dest_tipo', etiqueta: 'Tipo de documento', opciones: TIPOS_DOC.filter(t => t[0] !== '0'), valor: g.destinatario.tipo_doc })}
          ${campo({ nombre: 'dest_num', etiqueta: 'Número', valor: g.destinatario.num_doc, req: true, attrs: 'list="gr-clientes"' })}
          ${campo({ nombre: 'dest_nombre', etiqueta: 'Nombre o razón social', valor: g.destinatario.razon_social, req: true })}
          ${selector({ nombre: 'cod_traslado', etiqueta: 'Motivo de traslado', opciones: MOTIVOS_TRASLADO, valor: g.cod_traslado })}
          ${campo({ nombre: 'fecha_traslado', etiqueta: 'Fecha de traslado', valor: g.fecha_traslado, tipo: 'date', req: true })}
          ${campo({ nombre: 'peso_total', etiqueta: 'Peso total (kg)', valor: g.peso_total, tipo: 'number', req: true, attrs: 'min="0" step="0.01"' })}
          ${campo({ nombre: 'num_bultos', etiqueta: 'N.º de bultos', valor: g.num_bultos, tipo: 'number', attrs: 'min="0" step="1"' })}
          ${campo({ nombre: 'serie', etiqueta: 'Serie', valor: g.serie, req: true, attrs: 'maxlength="4"' })}
        </div>
        <datalist id="gr-clientes">${clientes.map(c => `<option value="${esc(c.num_doc)}">${esc(c.razon_social)}</option>`).join('')}</datalist>
      </section>

      <section class="panel">
        <h2>Partida y llegada</h2>
        <div class="form-grid">
          ${campo({ nombre: 'partida_ubigeo', etiqueta: 'Ubigeo de partida', valor: g.partida_ubigeo, req: true, attrs: 'maxlength="6" inputmode="numeric"' })}
          ${campo({ nombre: 'partida_direccion', etiqueta: 'Dirección de partida', valor: g.partida_direccion, req: true })}
          ${campo({ nombre: 'llegada_ubigeo', etiqueta: 'Ubigeo de llegada', valor: g.llegada_ubigeo, req: true, attrs: 'maxlength="6" inputmode="numeric"' })}
          ${campo({ nombre: 'llegada_direccion', etiqueta: 'Dirección de llegada', valor: g.llegada_direccion, req: true })}
          <div class="span-all form-grid" id="gr-locales">
            ${campo({ nombre: 'partida_cod_local', etiqueta: 'Código local de partida', valor: g.partida_cod_local, attrs: 'maxlength="4"' })}
            ${campo({ nombre: 'llegada_cod_local', etiqueta: 'Código local de llegada', valor: g.llegada_cod_local, attrs: 'maxlength="4"' })}
          </div>
        </div>
      </section>

      <section class="panel">
        <h2>Transporte</h2>
        <div class="segmented" role="radiogroup" aria-label="Modalidad">
          <label><input type="radio" name="mod_traslado" value="02" ${g.mod_traslado === '02' ? 'checked' : ''}><span>Privado (propio)</span></label>
          <label><input type="radio" name="mod_traslado" value="01" ${g.mod_traslado === '01' ? 'checked' : ''}><span>Público (empresa)</span></label>
        </div>
        <div id="gr-privado" class="form-grid">
          <label class="check span-all"><input type="checkbox" name="m1l" ${g.m1l ? 'checked' : ''}> Vehículo menor (moto o auto, categoría M1 o L)</label>
          <div class="span-all form-grid" id="gr-vehiculo">
            ${campo({ nombre: 'placa', etiqueta: 'Placa (sin guion)', valor: g.vehiculo.placa, attrs: 'maxlength="8" autocapitalize="characters"' })}
            ${selector({ nombre: 'cond_tipo', etiqueta: 'Doc. del conductor', opciones: [['1', 'DNI'], ['4', 'Carnet de extranjería']], valor: g.conductor.tipo_doc })}
            ${campo({ nombre: 'cond_num', etiqueta: 'Número', valor: g.conductor.num_doc })}
            ${campo({ nombre: 'cond_nombres', etiqueta: 'Nombres', valor: g.conductor.nombres })}
            ${campo({ nombre: 'cond_apellidos', etiqueta: 'Apellidos', valor: g.conductor.apellidos })}
            ${campo({ nombre: 'cond_licencia', etiqueta: 'Licencia', valor: g.conductor.licencia })}
          </div>
        </div>
        <div id="gr-publico" class="form-grid">
          ${campo({ nombre: 'tr_ruc', etiqueta: 'RUC del transportista', valor: g.transportista.num_doc, attrs: 'maxlength="11" inputmode="numeric"' })}
          ${campo({ nombre: 'tr_nombre', etiqueta: 'Razón social', valor: g.transportista.razon_social })}
          ${campo({ nombre: 'tr_mtc', etiqueta: 'Registro MTC', valor: g.transportista.nro_mtc || '' })}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Bienes trasladados</h2>
          ${ventas.length ? `<select id="gr-desde-venta" class="input-auto" aria-label="Copiar de una venta"><option value="">Copiar de una venta…</option>
            ${ventas.map(v => `<option value="${v.id}">#${v.id} · ${esc(v.cliente?.razon_social || 'Clientes varios')} · ${soles(v.total)}</option>`).join('')}</select>` : ''}
        </div>
        <div id="gr-items"></div>
        <button class="link-btn" type="button" id="gr-add">+ Agregar bien</button>
      </section>

      <p class="form-error" id="gr-error" role="alert"></p>
      <button class="btn btn-primary btn-block btn-lg" type="submit">${existente ? 'Guardar y reenviar' : 'Emitir guía'}</button>
    </form>`;

  const f = $('#f-gr', cuerpo);
  const v = n => $(`[name=${n}]`, f);
  const pintarItems = () => {
    $('#gr-items', f).innerHTML = g.items.length ? g.items.map((it, i) => `
      <div class="corr-row corr-row-gr">
        <label class="field span-2"><span class="field-label">Descripción</span><input data-gdesc="${i}" value="${esc(it.descripcion)}"></label>
        <label class="field"><span class="field-label">Cant.</span><input type="number" data-gcant="${i}" value="${esc(it.cantidad)}" min="0" step="any"></label>
        <label class="field"><span class="field-label">Unidad</span><select data-guni="${i}">${UNIDADES.filter(u => u[0] !== 'ZZ').map(([c, t]) => `<option value="${c}" ${c === it.unidad ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <button class="icon-btn" type="button" data-gquitar="${i}" aria-label="Quitar">×</button>
      </div>`).join('') : '<p class="muted small">Agrega los bienes o cópialos de una venta (los servicios no se trasladan).</p>';
  };
  const ajustar = () => {
    const publico = $('[name=mod_traslado]:checked', f).value === '01';
    $('#gr-publico', f).hidden = !publico;
    $('#gr-privado', f).hidden = publico;
    $('#gr-vehiculo', f).hidden = publico || v('m1l').checked;
    $('#gr-locales', f).hidden = v('cod_traslado').value !== '04';
  };

  f.addEventListener('change', ev => {
    const t = ev.target;
    if (t.name === 'mod_traslado' || t.name === 'm1l' || t.name === 'cod_traslado') ajustar();
    if (t.dataset.guni !== undefined) g.items[Number(t.dataset.guni)].unidad = t.value;
    if (t.id === 'gr-desde-venta' && t.value) {
      const venta = store.buscar('ventas', Number(t.value));
      const bienes = itemsDeVenta(venta.id).filter(i => i.unidad !== 'ZZ');
      if (!bienes.length) toast('Esa venta solo tiene servicios.', 'warn');
      g.items = bienes.map(i => ({ codigo: i.codigo, descripcion: i.descripcion, cantidad: i.cantidad, unidad: i.unidad }));
      if (venta.cliente && venta.cliente.tipo_doc !== '0') {
        v('dest_tipo').value = venta.cliente.tipo_doc;
        v('dest_num').value = venta.cliente.num_doc;
        v('dest_nombre').value = venta.cliente.razon_social;
        if (venta.cliente.direccion && !v('llegada_direccion').value) v('llegada_direccion').value = venta.cliente.direccion;
      }
      t.value = '';
      pintarItems();
    }
  });
  f.addEventListener('input', ev => {
    const t = ev.target;
    if (t.dataset.gdesc !== undefined) g.items[Number(t.dataset.gdesc)].descripcion = t.value;
    if (t.dataset.gcant !== undefined) g.items[Number(t.dataset.gcant)].cantidad = t.value;
    if (t.name === 'dest_num') {
      const c = clientes.find(x => x.num_doc === t.value.trim());
      if (c) { v('dest_tipo').value = c.tipo_doc; v('dest_nombre').value = c.razon_social; if (c.direccion && !v('llegada_direccion').value) v('llegada_direccion').value = c.direccion; }
    }
  });
  f.addEventListener('click', ev => {
    const q = ev.target.closest('[data-gquitar]');
    if (q) { g.items.splice(Number(q.dataset.gquitar), 1); pintarItems(); }
  });
  $('#gr-add', f).addEventListener('click', () => { g.items.push({ codigo: '', descripcion: '', cantidad: 1, unidad: 'NIU' }); pintarItems(); });

  f.addEventListener('submit', ev => {
    ev.preventDefault();
    const err = $('#gr-error', f);
    err.textContent = '';
    const datos = {
      serie: v('serie').value.trim().toUpperCase(), fecha_emision: hoy,
      destinatario: { tipo_doc: v('dest_tipo').value, num_doc: v('dest_num').value.trim(), razon_social: v('dest_nombre').value.trim().toUpperCase() },
      cod_traslado: v('cod_traslado').value, mod_traslado: $('[name=mod_traslado]:checked', f).value, m1l: v('m1l').checked,
      fecha_traslado: v('fecha_traslado').value, peso_total: v('peso_total').value, num_bultos: v('num_bultos').value,
      partida_ubigeo: v('partida_ubigeo').value.trim(), partida_direccion: v('partida_direccion').value,
      llegada_ubigeo: v('llegada_ubigeo').value.trim(), llegada_direccion: v('llegada_direccion').value,
      partida_cod_local: v('partida_cod_local').value.trim(), llegada_cod_local: v('llegada_cod_local').value.trim(),
      transportista: { tipo_doc: '6', num_doc: v('tr_ruc').value.trim(), razon_social: v('tr_nombre').value.trim().toUpperCase(), nro_mtc: v('tr_mtc').value.trim() },
      vehiculo: { placa: v('placa').value.trim().toUpperCase().replace(/[-\s]/g, '') },
      conductor: { tipo_doc: v('cond_tipo').value, num_doc: v('cond_num').value.trim(), nombres: v('cond_nombres').value, apellidos: v('cond_apellidos').value, licencia: v('cond_licencia').value },
      items: g.items
    };
    const msg = validarGuia(datos);
    if (msg) { err.textContent = msg; return; }
    const body = armarGuia(datos);
    conCarga(f.querySelector('[type=submit]'), async () => {
      try {
        const r = existente ? await api.actualizarGuia(existente.api_id, body) : await api.crearGuia(body);
        const local = guardarGuiaLocal(r.datos, body, existente);
        location.hash = local.api_id ? `#/sunat/guias/${local.api_id}` : '#/sunat/guias';
        if (local.api_id) verGuia(local);
        else toast(existente ? 'Guía corregida y reenviada.' : 'Guía registrada. Consulta su estado.', 'ok');
      } catch (e) { err.textContent = [e.message, ...(e.detalle?.() || [])].join('\n'); }
    });
  });

  pintarItems();
  ajustar();
}

// PDF de la guía en el visor, listo para imprimir.
function verGuia(c) {
  return visorPdf({
    titulo: `Guía de remisión ${numeroCpe(c)}`,
    subtitulo: ESTADOS[c.sunat_status]?.texto || '',
    formatos: [['a4', 'A4']],
    cargar: formato => descargar(`/guias-remision/${c.api_id}/pdf`, { format: formato }),
    nombre: () => `${numeroCpe(c)}.pdf`
  });
}

// ---------- Cobranzas ----------
async function cobranzas(cuerpo) {
  const credito = store.todos('ventas').filter(v => v.forma_pago === 'Credito' && v.comprobante_id && v.estado !== 'anulada')
    .map(v => ({ v, c: store.buscar('comprobantes', v.comprobante_id) })).filter(x => x.c && !x.c.reemplazado)
    .sort((a, b) => b.v.id - a.v.id);
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
        vacio: 'No hay facturas al crédito registradas en este sistema.',
        enlace: ({ c }) => `#/comprobantes/facturas/${c.api_id}`,
        columnas: [
          { titulo: 'Factura', celda: ({ c }) => `<strong class="font-id">${esc(numeroCpe(c))}</strong>` },
          { titulo: 'Cliente', sec: true, celda: ({ v }) => `${esc(v.cliente?.razon_social || '')}${v.cliente?.num_doc ? `<span class="sub font-id">${esc(v.cliente.num_doc)}</span>` : ''}` },
          { titulo: 'Cuotas', sec: true, clase: 'num', celda: ({ v }) => esc((v.cuotas || []).length) },
          { titulo: 'Vence', sec: true, clase: 'nw', celda: ({ v }) => esc(v.cuotas?.at(-1)?.fecha_pago || '—') },
          { titulo: 'Estado', celda: ({ v }) => ((v.cuotas || []).some(q => q.fecha_pago < hoy) ? '<span class="pill pill-warn">Cuotas vencidas</span>' : '<span class="pill pill-ok">Al día</span>') },
          { titulo: 'Total', clase: 'num', celda: ({ v, c }) => esc(soles(c.total_oficial ?? v.total)) }
        ]
      })}
    </section>`;

  const caja = $('#cob-panel', cuerpo);
  try {
    const r = await api.panelCobranzas();
    const d = r.datos || {};
    caja.innerHTML = panelCobranzas(d) + crudo(r.crudo);
  } catch (e) { caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`; }
}

// Panel de cobranzas de la API: { aging: {por_vencer, vencido_0_30, …}, resumen: {pagado, parcial, pendiente}, top_deudores: [] }.
function panelCobranzas(d) {
  const TRAMOS = [['por_vencer', 'Por vencer'], ['vencido_0_30', 'Vencido 0–30 días'], ['vencido_31_60', '31–60 días'], ['vencido_61_90', '61–90 días'], ['vencido_mas_90', 'Más de 90 días']];
  const aging = d.aging ?? d.antiguedad ?? d.tramos ?? null;
  let html = '';
  if (Array.isArray(aging)) {
    html += `<dl class="stats">${aging.map(t => `<div><dt>${esc(t.rango ?? t.tramo ?? t.label ?? '')}</dt><dd>${soles(t.monto ?? t.total ?? 0)}</dd></div>`).join('')}</dl>`;
  } else if (aging && typeof aging === 'object') {
    html += `<dl class="stats">${TRAMOS.filter(([k]) => aging[k] != null).map(([k, t]) => `<div><dt>${esc(t)}</dt><dd class="${k !== 'por_vencer' && Number(aging[k]) > 0 ? 'text-danger' : ''}">${soles(aging[k])}</dd></div>`).join('')}</dl>`;
    if (aging.documentos_con_saldo != null) html += `<p class="muted small">${esc(aging.documentos_con_saldo)} documento(s) con saldo.</p>`;
  }
  if (d.resumen && typeof d.resumen === 'object') {
    const NOMBRE = { pagado: 'Pagado', parcial: 'Pago parcial', pendiente: 'Pendiente' };
    html += '<h3 class="sub">Por estado de pago</h3>' + tablaDatos({
      filas: Object.entries(d.resumen).map(([k, v]) => ({ estado: NOMBRE[k] || k, ...v })),
      columnas: [
        { titulo: 'Estado', celda: x => `<strong>${esc(x.estado)}</strong>` },
        { titulo: 'Documentos', clase: 'num', sec: true, celda: x => esc(x.documentos ?? 0) },
        { titulo: 'Monto', clase: 'num', sec: true, celda: x => esc(soles(x.monto_total ?? 0)) },
        { titulo: 'Pagado', clase: 'num', sec: true, celda: x => esc(soles(x.monto_pagado ?? 0)) },
        { titulo: 'Saldo', clase: 'num', celda: x => esc(soles(x.saldo ?? 0)) }
      ]
    });
  }
  if (Array.isArray(d.top_deudores) && d.top_deudores.length) {
    html += '<h3 class="sub">Clientes con mayor saldo</h3>' + tablaDatos({
      filas: d.top_deudores,
      columnas: [
        { titulo: 'Cliente', celda: x => `<strong>${esc(x.cliente || '')}</strong>${x.ruc && x.ruc !== '-' ? `<span class="sub font-id">${esc(x.ruc)}</span>` : ''}` },
        { titulo: 'Documentos', clase: 'num', sec: true, celda: x => esc(x.documentos ?? '') },
        { titulo: 'Saldo', clase: 'num', celda: x => esc(soles(x.saldo ?? 0)) }
      ]
    });
  }
  return html || vacioMsg('La API no devolvió datos de cobranza.');
}

// ---------- Consultas ----------
function consultas(cuerpo) {
  const ruc = store.config().ruc || '';
  const tipos = [['01', 'Factura'], ['03', 'Boleta'], ['07', 'Nota de crédito'], ['08', 'Nota de débito']];
  cuerpo.innerHTML = `
    <section class="panel">
      <h2>Consultar comprobante en SUNAT</h2>
      <p class="muted small">Verifica el estado de un comprobante propio o de un proveedor antes de pagarle.</p>
      <form class="form-grid" id="f-cpe" novalidate>
        ${campo({ nombre: 'ruc_emisor', etiqueta: 'RUC del emisor', valor: ruc, req: true, attrs: 'maxlength="11" inputmode="numeric"' })}
        ${selector({ nombre: 'tipo_doc', etiqueta: 'Tipo', opciones: tipos, valor: '01' })}
        ${campo({ nombre: 'serie', etiqueta: 'Serie', req: true, attrs: 'maxlength="4"' })}
        ${campo({ nombre: 'correlativo', etiqueta: 'Número', req: true, attrs: 'inputmode="numeric"' })}
        ${campo({ nombre: 'fecha_emision', etiqueta: 'Fecha de emisión', tipo: 'date', req: true })}
        ${campo({ nombre: 'monto_total', etiqueta: 'Monto total S/', tipo: 'number', req: true, attrs: 'min="0" step="0.01"' })}
        <div class="form-actions span-all"><button class="btn btn-primary" type="submit">Consultar</button></div>
      </form>
      <div id="cpe-res"></div>
    </section>

    <section class="panel">
      <h2>Recuperar CDR</h2>
      <form class="form-grid" id="f-cdr" novalidate>
        ${campo({ nombre: 'ruc_emisor', etiqueta: 'RUC del emisor', valor: ruc, req: true, attrs: 'maxlength="11" inputmode="numeric"' })}
        ${selector({ nombre: 'tipo_doc', etiqueta: 'Tipo', opciones: tipos, valor: '01' })}
        ${campo({ nombre: 'serie', etiqueta: 'Serie', req: true, attrs: 'maxlength="4"' })}
        ${campo({ nombre: 'correlativo', etiqueta: 'Número', req: true, attrs: 'inputmode="numeric"' })}
        <div class="form-actions span-all"><button class="btn btn-primary" type="submit">Descargar CDR</button></div>
      </form>
    </section>

    <section class="panel">
      <h2>Exportar comprobantes (ZIP)</h2>
      <p class="muted small">XML, CDR y PDF del periodo, por ejemplo para el contador.</p>
      <form class="form-grid" id="f-zip" novalidate>
        ${campo({ nombre: 'fecha_desde', etiqueta: 'Desde', tipo: 'date', valor: `${hoyLima().slice(0, 7)}-01`, req: true })}
        ${campo({ nombre: 'fecha_hasta', etiqueta: 'Hasta', tipo: 'date', valor: hoyLima(), req: true })}
        ${selector({ nombre: 'documentos', etiqueta: 'Documentos', opciones: [['facturas', 'Facturas'], ['boletas', 'Boletas'], ['notas-credito', 'Notas de crédito'], ['notas-debito', 'Notas de débito']], valor: 'facturas', ayuda: 'La colección solo muestra el valor "facturas"; los demás están por confirmar.' })}
        <div class="form-actions span-all"><button class="btn btn-primary" type="submit">Descargar ZIP</button></div>
      </form>
    </section>`;

  const leer = form => Object.fromEntries([...form.querySelectorAll('input, select')].map(i => [i.name, i.value.trim()]));
  const validarDoc = d => {
    if (errorDocumento('6', d.ruc_emisor)) return 'RUC del emisor inválido.';
    if (!/^[A-Z0-9]{4}$/.test(d.serie.toUpperCase())) return 'Serie inválida (4 caracteres).';
    if (!/^\d+$/.test(d.correlativo)) return 'Número inválido.';
    return null;
  };

  $('#f-cpe', cuerpo).addEventListener('submit', ev => {
    ev.preventDefault();
    const d = leer(ev.currentTarget);
    d.serie = d.serie.toUpperCase();
    const msg = validarDoc(d) || (!d.fecha_emision ? 'Indica la fecha.' : !(Number(d.monto_total) > 0) ? 'Indica el monto.' : null);
    if (msg) return toast(msg, 'warn');
    d.monto_total = Number(d.monto_total).toFixed(2);
    conCarga(ev.currentTarget.querySelector('[type=submit]'), async () => {
      const res = $('#cpe-res', cuerpo);
      try {
        const r = await api.consultarCpe(d);
        const datos = r.datos || {};
        const simples = Object.entries(datos).filter(([, val]) => val === null || ['string', 'number', 'boolean'].includes(typeof val));
        res.innerHTML = `<dl class="kv">${simples.map(([k, val]) => `<div><dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(val ?? '—')}</dd></div>`).join('')}</dl>${crudo(r.crudo)}`;
      } catch (e) { res.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`; }
    });
  });

  $('#f-cdr', cuerpo).addEventListener('submit', ev => {
    ev.preventDefault();
    const d = leer(ev.currentTarget);
    d.serie = d.serie.toUpperCase();
    const msg = validarDoc(d);
    if (msg) return toast(msg, 'warn');
    conCarga(ev.currentTarget.querySelector('[type=submit]'), async () => {
      try { guardarBlob(await api.consultarCdr(d), `R-${d.ruc_emisor}-${d.tipo_doc}-${d.serie}-${d.correlativo}.zip`); } catch (e) { toastError(e); }
    });
  });

  $('#f-zip', cuerpo).addEventListener('submit', ev => {
    ev.preventDefault();
    const d = leer(ev.currentTarget);
    if (!d.fecha_desde || !d.fecha_hasta || d.fecha_desde > d.fecha_hasta) return toast('Rango de fechas inválido.', 'warn');
    conCarga(ev.currentTarget.querySelector('[type=submit]'), async () => {
      try { guardarBlob(await api.exportarZip(d), `${d.documentos}-${d.fecha_desde}-${d.fecha_hasta}.zip`); } catch (e) { toastError(e); }
    });
  });
}

// Edición de guía (ruta #/sunat/guias/{id}/editar).
export function editarGuia(cuerpo, apiId) {
  const local = store.todos('comprobantes').find(c => c.tipo === '09' && String(c.api_id) === String(apiId));
  if (!local?.payload) { cuerpo.innerHTML = '<div class="notice notice-error">Esta guía no se creó desde este sistema.</div>'; return; }
  formGuia(cuerpo, local);
}
