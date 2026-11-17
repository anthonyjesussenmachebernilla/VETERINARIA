// Inicio: indicadores del día, alertas, ventas por mes y actividad reciente.
// Lo comercial (ventas, métodos de pago, stock) sale del sistema; lo tributario, de /panel.
import { store } from '../store.js';
import { auth } from '../auth.js';
import { api, credencialesListas, comoLista, request, modoProxy, getPin } from '../api.js';
import { esc, $, $$, conCarga, toastError, toast, fecha, tablaDatos, icono } from '../ui.js';
import { soles, r2 } from '../validar.js';
import { hoyLima, METODOS_PAGO, TIPOS_CPE, numeroCpe, ESTADOS, leerCpe } from '../comprobantes.js';
import { estadoVenta } from './ventas.js';
import { diasRestantes } from '../tributario.js';
import { cargarDatosDeLaApi } from '../sincronizar.js';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];

export async function vistaInicio(cont) {
  const u = auth.actual();
  const hoy = hoyLima();
  const ventasHoy = store.todos('ventas').filter(v => v.fecha_emision === hoy && v.estado !== 'anulada');
  const totalHoy = r2(ventasHoy.reduce((s, v) => s + v.total, 0));
  const estados = store.todos('ventas').filter(v => v.estado !== 'anulada').map(v => estadoVenta(v));
  const porEmitir = estados.filter(e => ['sin', 'error', 'incierta'].includes(e.clave)).length;
  const rechazados = store.todos('comprobantes').filter(c => c.sunat_status === 'rechazado' && !c.reemplazado).length;
  const fechaLarga = new Date().toLocaleDateString('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long' });

  cont.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Hola, ${esc(u.nombre.split(' ')[0])}</h1>
        <p class="muted subtitle">${esc(fechaLarga)}</p>
      </div>
      <div class="row-actions"><a class="btn btn-primary" href="#/vender">Nueva venta</a></div>
    </div>

    <dl class="kpis">
      <div class="kpi"><dt>Ventas de hoy</dt><dd>${ventasHoy.length}</dd></div>
      <div class="kpi"><dt>Total de hoy</dt><dd>${esc(soles(totalHoy))}</dd></div>
      <a class="kpi ${porEmitir ? 'is-alert' : ''}" href="#/ventas"><dt>Por emitir</dt><dd>${porEmitir}</dd></a>
      <a class="kpi ${rechazados ? 'is-alert' : ''}" href="#/comprobantes"><dt>Rechazados</dt><dd>${rechazados}</dd></a>
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
    $('#chart', cont).innerHTML = graficoMensual(ventasLocalesPorMes());
    $('#chart-fuente', cont).textContent = 'Datos del sistema';
    conectarGrafico(cont);
    $('#recientes', cont).innerHTML = recientesLocales();
    return;
  }

  // Lo de la API se carga en paralelo; si falla, se usa lo local.
  const [mensual, recientes, alertas] = await Promise.allSettled([
    request('GET', '/panel/ventas-mensuales'), request('GET', '/panel/documentos-recientes'), request('GET', '/panel/alertas')
  ]);
  if (!document.body.contains(cont) || !$('#chart', cont)) return;

  const serieApi = mensual.status === 'fulfilled' ? leerSerieMensual(mensual.value.datos) : null;
  $('#chart', cont).innerHTML = graficoMensual(serieApi || ventasLocalesPorMes());
  $('#chart-fuente', cont).textContent = serieApi ? 'Según la API (comprobantes)' : 'Datos del sistema';
  conectarGrafico(cont);

  $('#recientes', cont).innerHTML = recientes.status === 'fulfilled' ? recientesApi(recientes.value.datos) : recientesLocales();
  pintarAlertas(cont, alertas.status === 'fulfilled' ? leerAlertasApi(alertas.value.datos) : []);
}

// ---------- Alertas ----------
function alertasLocales() {
  const hoy = hoyLima();
  const lista = [];
  const comps = store.todos('comprobantes').filter(c => !c.reemplazado);

  const rech = comps.filter(c => c.sunat_status === 'rechazado' && TIPOS_CPE[c.tipo]);
  if (rech.length) lista.push({ nivel: 'critico', texto: `${rech.length} comprobante(s) rechazado(s) por SUNAT`, enlace: `#/comprobantes/${TIPOS_CPE[rech[0].tipo].ruta}/${rech[0].api_id}`, accion: 'Revisar' });

  const inciertas = store.todos('ventas').filter(v => v.emision?.estado === 'incierta' && !v.comprobante_id);
  if (inciertas.length) lista.push({ nivel: 'critico', texto: `${inciertas.length} venta(s) con emisión por confirmar (se cortó la conexión)`, enlace: `#/ventas/${inciertas[0].id}`, accion: 'Confirmar' });

  const sinCpe = store.todos('ventas').filter(v => v.estado !== 'anulada' && !v.comprobante_id && v.emision?.estado !== 'incierta');
  if (sinCpe.length) lista.push({ nivel: 'aviso', texto: `${sinCpe.length} venta(s) sin comprobante emitido`, enlace: `#/ventas/${sinCpe[0].id}`, accion: 'Emitir' });

  const boletasPend = comps.filter(c => c.tipo === '03' && c.sunat_status === 'pendiente');
  if (boletasPend.length) {
    const minimo = Math.min(...boletasPend.map(b => diasRestantes(b.fecha_emision)));
    lista.push({ nivel: minimo <= 2 ? 'critico' : 'aviso', texto: `${boletasPend.length} boleta(s) esperando resumen diario${minimo <= 2 ? ` · ${minimo < 0 ? 'fuera de plazo' : `quedan ${minimo} día(s)`}` : ''}`, enlace: '#/sunat/resumen', accion: 'Enviar' });
  }

  const enProceso = comps.filter(c => ['enviado', 'desconocido'].includes(c.sunat_status) && TIPOS_CPE[c.tipo]);
  if (enProceso.length) lista.push({ nivel: 'info', texto: `${enProceso.length} comprobante(s) esperando respuesta de SUNAT`, enlace: '#/comprobantes', accion: 'Ver' });

  const vencidas = store.todos('ventas').filter(v => v.forma_pago === 'Credito' && v.estado !== 'anulada' && (v.cuotas || []).some(q => q.fecha_pago < hoy));
  if (vencidas.length) lista.push({ nivel: 'aviso', texto: `${vencidas.length} factura(s) al crédito con cuotas vencidas`, enlace: '#/sunat/cobranzas', accion: 'Cobrar' });

  const productos = store.todos('productos').filter(p => p.activo !== false && p.controla_stock);
  const agotados = productos.filter(p => Number(p.stock) <= 0);
  const bajos = productos.filter(p => Number(p.stock) > 0 && Number(p.stock) <= 3);
  if (agotados.length) lista.push({ nivel: 'aviso', texto: `Agotados: ${agotados.slice(0, 3).map(p => p.descripcion).join(', ')}${agotados.length > 3 ? ` y ${agotados.length - 3} más` : ''}`, enlace: '#/productos', accion: 'Ver' });
  if (bajos.length) lista.push({ nivel: 'info', texto: `Stock bajo (3 o menos): ${bajos.slice(0, 3).map(p => `${p.descripcion} (${p.stock})`).join(', ')}${bajos.length > 3 ? '…' : ''}`, enlace: '#/productos', accion: 'Ver' });

  const fechas = [store.config().ultimo_respaldo, store.ultimoRespaldoServidor()].filter(Boolean).sort();
  const ult = fechas.at(-1);
  const horas = ult ? (Date.now() - Date.parse(ult)) / 36e5 : Infinity;
  if (store.todos('ventas').length && horas > 24 && auth.esAdmin()) {
    lista.push({ nivel: 'aviso', texto: ult ? `Último respaldo de data.json: ${fecha(ult)}` : 'Aún no hay respaldo de data.json', enlace: '#/config/respaldo', accion: 'Respaldar' });
  }
  if (store.config().entorno !== 'production' && store.config().ruc) {
    lista.push({ nivel: 'info', texto: 'Entorno beta: los comprobantes son de prueba', enlace: auth.esAdmin() ? '#/config/empresa' : null, accion: 'Configurar' });
  }
  return lista;
}

function leerAlertasApi(datos) {
  const lista = Array.isArray(datos) ? datos : (datos?.alertas ?? datos?.items ?? []);
  if (!Array.isArray(lista)) return [];
  return lista.map(a => typeof a === 'string'
    ? { nivel: 'info', texto: a, origen: 'API' }
    : { nivel: /crit|error|rech/i.test(a.tipo ?? a.nivel ?? '') ? 'critico' : /warn|aviso|venc/i.test(a.tipo ?? a.nivel ?? '') ? 'aviso' : 'info', texto: a.mensaje ?? a.message ?? a.descripcion ?? a.titulo ?? JSON.stringify(a), origen: 'API' })
    .filter(a => a.texto);
}

function pintarAlertas(cont, deApi) {
  const caja = $('#alertas-body', cont);
  if (!caja) return;
  const orden = { critico: 0, aviso: 1, info: 2 };
  const todas = [...alertasLocales(), ...deApi].sort((a, b) => orden[a.nivel] - orden[b.nivel]);
  const ICONO = { critico: 'error', aviso: 'alerta', info: 'info' };
  const NOMBRE = { critico: 'Urgente', aviso: 'Atención', info: 'Información' };
  caja.innerHTML = todas.length ? `<ul class="alertas">${todas.map(a => `
    <li class="alerta alerta-${a.nivel}">
      <span class="alerta-icono" aria-hidden="true">${icono(ICONO[a.nivel])}</span>
      <span class="alerta-texto"><span class="sr-only">${NOMBRE[a.nivel]}: </span>${esc(a.texto)}${a.origen ? ' <span class="muted small">(API)</span>' : ''}</span>
      ${a.enlace ? `<a class="btn btn-sm" href="${esc(a.enlace)}">${esc(a.accion)}</a>` : ''}
    </li>`).join('')}</ul>` : '<p class="muted">Todo al día. No hay pendientes.</p>';
}

// ---------- Ventas por mes ----------
function ventasLocalesPorMes(n = 6) {
  const hoy = hoyLima();
  const [y, m] = hoy.split('-').map(Number);
  const meses = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    meses.push({ clave: d.toISOString().slice(0, 7), etiqueta: MESES[d.getUTCMonth()], total: 0 });
  }
  for (const v of store.todos('ventas')) {
    if (v.estado === 'anulada') continue;
    const mes = meses.find(x => x.clave === String(v.fecha_emision).slice(0, 7));
    if (mes) mes.total += v.total;
  }
  meses.forEach(x => { x.total = r2(x.total); });
  return meses;
}

// Acepta [{mes, total}] o {meses|series|data: [...]}, con nombres de campo alternativos.
export function leerSerieMensual(datos) {
  const lista = Array.isArray(datos) ? datos : (datos?.meses ?? datos?.series ?? datos?.data ?? datos?.ventas ?? datos?.actual ?? null);
  if (!Array.isArray(lista) || !lista.length) return null;
  const serie = lista.map(x => {
    const clave = String(x.mes ?? x.periodo ?? x.month ?? x.fecha ?? '');
    const total = Number(x.total ?? x.monto ?? x.ventas ?? x.importe ?? x.valor);
    const m = /(\d{4})-(\d{2})/.exec(clave);
    return { clave, etiqueta: m ? MESES[Number(m[2]) - 1] : clave.slice(0, 3), total: r2(total) };
  }).filter(x => x.clave && !isNaN(x.total));
  return serie.length ? serie.slice(-12) : null;
}

function graficoMensual(serie) {
  if (!serie?.length || serie.every(x => !x.total)) {
    return '<p class="muted">Aún no hay ventas para graficar.</p>';
  }
  const W = 560, H = 220, izq = 52, der = 8, arriba = 16, abajo = 28;
  const max = Math.max(...serie.map(x => x.total));
  const paso = escalaLimpia(max);
  const tope = Math.ceil(max / paso) * paso;
  const ancho = (W - izq - der) / serie.length;
  const barra = Math.min(24, ancho * 0.6);
  const y = v => arriba + (H - arriba - abajo) * (1 - v / tope);
  const ticks = [];
  for (let t = 0; t <= tope + 0.001; t += paso) ticks.push(t);
  const mayor = serie.reduce((a, b) => (b.total > a.total ? b : a));
  const compacto = n => n >= 1000 ? `${r2(n / 1000)}K` : String(Math.round(n));

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Ventas por mes en soles. Mes más alto: ${esc(mayor.etiqueta)}, ${esc(soles(mayor.total))}.">
        ${ticks.map(t => `<line x1="${izq}" x2="${W - der}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${izq - 8}" y="${y(t) + 4}" class="tick" text-anchor="end">${compacto(t)}</text>`).join('')}
        ${serie.map((x, i) => {
          const cx = izq + ancho * i + ancho / 2;
          const alto = Math.max(0, y(0) - y(x.total));
          const r = Math.min(4, alto / 2, barra / 2);
          const x0 = cx - barra / 2, y0 = y(x.total);
          const d = alto > 0 ? `M${x0},${y(0)} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + barra - r} Q${x0 + barra},${y0} ${x0 + barra},${y0 + r} V${y(0)} Z` : '';
          return `<g class="col" tabindex="0" data-i="${i}" aria-label="${esc(x.etiqueta)}: ${esc(soles(x.total))}">
            <rect x="${cx - ancho / 2}" y="${arriba}" width="${ancho}" height="${H - arriba - abajo}" class="hit"/>
            ${d ? `<path d="${d}" class="barra-mes"/>` : ''}
            ${x === mayor ? `<text x="${cx}" y="${y0 - 6}" class="val" text-anchor="middle">${compacto(x.total)}</text>` : ''}
            <text x="${cx}" y="${H - 8}" class="tick" text-anchor="middle">${esc(x.etiqueta)}</text>
          </g>`;
        }).join('')}
        <line x1="${izq}" x2="${W - der}" y1="${y(0)}" y2="${y(0)}" class="axis"/>
      </svg>
      <div class="chart-tip" role="tooltip" hidden></div>
    </div>
    <details class="chart-tabla"><summary>Ver como tabla</summary>
      <table class="table table-compact"><thead><tr><th>Mes</th><th class="num">Total</th></tr></thead>
      <tbody>${serie.map(x => `<tr><td>${esc(x.clave)}</td><td class="num">${esc(soles(x.total))}</td></tr>`).join('')}</tbody></table>
    </details>
    <script type="application/json" class="chart-data">${JSON.stringify(serie).replace(/</g, '\\u003c')}</script>`;
}

function escalaLimpia(max) {
  if (max <= 0) return 1;
  const bruto = max / 4;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / pot;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pot;
}

// Tooltip por columna (hover, foco con teclado y toque).
function conectarGrafico(cont) {
  const wrap = $('.chart-wrap', cont);
  if (!wrap) return;
  const datos = JSON.parse($('.chart-data', cont)?.textContent || '[]');
  const tip = $('.chart-tip', wrap);
  const mostrar = g => {
    const x = datos[Number(g.dataset.i)];
    if (!x) return;
    tip.innerHTML = `<strong>${esc(x.clave)}</strong><span>${esc(soles(x.total))}</span>`;
    tip.hidden = false;
    const caja = wrap.getBoundingClientRect?.();
    const r = g.getBoundingClientRect?.();
    if (caja && r) {
      tip.style.left = `${Math.min(Math.max(r.left - caja.left + r.width / 2, 60), caja.width - 60)}px`;
      tip.style.top = '4px';
    }
    $$('.col', wrap).forEach(c => c.classList.toggle('is-hover', c === g));
  };
  const ocultar = () => { tip.hidden = true; $$('.col', wrap).forEach(c => c.classList.remove('is-hover')); };
  $$('.col', wrap).forEach(g => {
    g.addEventListener('mouseenter', () => mostrar(g));
    g.addEventListener('focus', () => mostrar(g));
    g.addEventListener('click', () => mostrar(g));
  });
  wrap.addEventListener('mouseleave', ocultar);
  wrap.addEventListener('focusout', ocultar);
}

// ---------- Métodos y más vendidos (sistema) ----------
function metodosHoy(ventasHoy) {
  const contado = ventasHoy.filter(v => v.forma_pago !== 'Credito');
  const credito = r2(ventasHoy.filter(v => v.forma_pago === 'Credito').reduce((s, v) => s + v.total, 0));
  const filas = METODOS_PAGO.map(([k, t]) => ({ t, total: r2(contado.filter(v => v.metodo_pago === k).reduce((s, v) => s + v.total, 0)), n: contado.filter(v => v.metodo_pago === k).length }))
    .filter(f => f.n);
  if (credito) filas.push({ t: 'Crédito', total: credito, n: ventasHoy.filter(v => v.forma_pago === 'Credito').length });
  if (!filas.length) return '<p class="muted">Sin ventas hoy.</p>';
  return `<ul class="rows">${filas.map(f => `<li class="row"><span>${esc(f.t)} <span class="muted small">· ${f.n}</span></span><strong class="num">${esc(soles(f.total))}</strong></li>`).join('')}</ul>`;
}

function masVendidos() {
  const desde = hoyLima(new Date(Date.now() - 29 * 864e5));
  const ventas = new Set(store.todos('ventas').filter(v => v.estado !== 'anulada' && v.fecha_emision >= desde).map(v => v.id));
  const acc = new Map();
  for (const it of store.todos('venta_items')) {
    if (!ventas.has(it.venta_id)) continue;
    const k = it.codigo || it.descripcion;
    const a = acc.get(k) || { descripcion: it.descripcion, cantidad: 0, total: 0 };
    a.cantidad += Number(it.cantidad);
    a.total += Number(it.precio) * Number(it.cantidad) - Number(it.descuento || 0);
    acc.set(k, a);
  }
  const top = [...acc.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  if (!top.length) return '<p class="muted">Sin ventas en los últimos 30 días.</p>';
  return `<ol class="rows ranking">${top.map(p => `<li class="row"><span>${esc(p.descripcion)} <span class="muted small">· ${r2(p.cantidad)}</span></span><strong class="num">${esc(soles(p.total))}</strong></li>`).join('')}</ol>`;
}

// ---------- Recientes ----------
// Tabla corta de los últimos comprobantes: de la API si responde, si no los de este equipo.
function tablaRecientes(filas) {
  return tablaDatos({
    filas,
    vacio: 'Aún no hay comprobantes.',
    enlace: c => (c.ruta && c.api_id != null ? `#/comprobantes/${c.ruta}/${c.api_id}` : ''),
    columnas: [
      { titulo: 'Comprobante', celda: c => `<strong class="font-id">${esc(c.numero)}</strong><span class="sub">${esc(c.nombre)}</span>` },
      { titulo: 'Cliente', sec: true, celda: c => esc(c.cliente || '') },
      { titulo: 'Estado', celda: c => { const e = ESTADOS[c.estado] || ESTADOS.desconocido; return `<span class="pill ${e.clase}">${esc(e.texto)}</span>`; } },
      { titulo: 'Total', clase: 'num', sec: true, celda: c => (c.total != null ? esc(soles(c.total)) : '—') }
    ]
  });
}

function recientesApi(datos) {
  const lista = comoLista(datos).slice(0, 8);
  if (!lista.length) return recientesLocales();
  return tablaRecientes(lista.map(x => {
    const cpe = leerCpe(x);
    const tipo = String(x.tipo_documento ?? x.tipo ?? '');
    return {
      ruta: TIPOS_CPE[tipo]?.ruta, api_id: x.id, nombre: TIPOS_CPE[tipo]?.nombre || x.tipo_nombre || '',
      numero: `${x.serie ?? ''}-${x.correlativo ?? ''}`, cliente: x.client_razon_social ?? x.cliente?.razon_social ?? '',
      estado: cpe.sunat_status, total: cpe.total_oficial
    };
  }));
}

function recientesLocales() {
  const lista = store.todos('comprobantes').filter(c => TIPOS_CPE[c.tipo]).sort((a, b) => b.id - a.id).slice(0, 8);
  return tablaRecientes(lista.map(c => ({
    ruta: TIPOS_CPE[c.tipo].ruta, api_id: c.api_id, nombre: TIPOS_CPE[c.tipo].nombre, numero: numeroCpe(c),
    cliente: c.fecha_emision || '', estado: c.sunat_status, total: c.total_oficial
  })));
}

// ---------- Puesta en marcha ----------
function pasosPuesta() {
  const c = store.config();
  return [
    [modoProxy() ? 'Conexión con el servidor del sistema' : 'Credenciales en config.js', credencialesListas() && (!modoProxy() || !window.APP_CONFIG?.PIN || Boolean(getPin()))],
    ['Datos de la empresa leídos de la API', Boolean(c.ruc)],
    ['Sucursal por defecto elegida', Boolean(c.sucursal_id)],
    ['Series de factura y boleta definidas', Boolean(c.serie_factura && c.serie_boleta)],
    ['Al menos un producto o servicio', store.todos('productos').some(p => p.activo !== false)]
  ];
}

function puestaEnMarcha() {
  const pasos = pasosPuesta();
  const listos = pasos.filter(p => p[1]).length;
  const completo = listos === pasos.length;
  return `
    <section class="panel">
      <details ${completo ? '' : 'open'}>
        <summary class="panel-head summary-head"><h2>Puesta en marcha</h2><span class="pill ${completo ? 'pill-ok' : ''}">${listos} de ${pasos.length}</span></summary>
        <ul class="checklist">
          ${pasos.map(([t, ok]) => `<li class="${ok ? 'is-done' : ''}"><span class="dot" aria-hidden="true"></span>${esc(t)}<span class="sr-only">${ok ? ' (listo)' : ' (pendiente)'}</span></li>`).join('')}
        </ul>
        <div class="row-actions">
          <button class="btn" id="btn-probar" type="button">Probar conexión con la API</button>
          ${auth.esAdmin() ? '<a class="btn" href="#/config/empresa">Configuración</a>' : ''}
        </div>
        <p class="muted small" id="probar-res" style="white-space: pre-line"></p>
      </details>
    </section>`;
}

function conectarPuesta(cont) {
  $('#btn-probar', cont)?.addEventListener('click', ev => conCarga(ev.currentTarget, async () => {
    const res = $('#probar-res', cont);
    try {
      const pasos = await cargarDatosDeLaApi();
      res.textContent = pasos.map(p => `${p.ok ? '✓' : '•'} ${p.texto}`).join('\n');
      toast('Conexión correcta. Datos cargados desde la API.', 'ok');
    } catch (e) {
      res.textContent = e.message;
      toastError(e);
    }
  }));
}


