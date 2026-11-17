// Utilidades de interfaz: escape, toasts, modal, formularios.

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

// Iconos de trazo (24×24, mismo juego que el sistema del restaurante).
const TRAZOS = {
  inicio: ['M4 3h5a1 1 0 0 1 1 1v7a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1Z', 'M15 3h5a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1Z', 'M15 12h5a1 1 0 0 1 1 1v7a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1Z', 'M4 16h5a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1Z'],
  vender: ['m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18', 'M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25', 'M16 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M6 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0'],
  ventas: ['M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1Z', 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M12 11h4', 'M12 16h4', 'M8 11h.01', 'M8 16h.01'],
  comprobantes: ['M12 17V7', 'M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8', 'M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z'],
  clientes: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M16 3.128a4 4 0 0 1 0 7.744', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0'],
  productos: ['M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z', 'M12 22V12', 'M3.29 7L12 12L20.71 7', 'm7.5 4.27 9 5.15'],
  sunat: ['M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z', 'm21.854 2.147-10.94 10.939'],
  reportes: ['M3 3v16a2 2 0 0 0 2 2h16', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
  config: ['M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915', 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0'],
  huella: ['M9 4a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M16 8a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M18 16a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z'],
  salir: ['m16 17 5-5-5-5', 'M21 12H9', 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'],
  menu: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2Z', 'M9 3v18'],
  sol: ['M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0', 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'],
  luna: ['M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401'],
  cerrar: ['M18 6 6 18', 'm6 6 12 12'],
  imprimir: ['M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6', 'M7 14h10a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1Z'],
  descargar: ['M12 15V3', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5'],
  ventana: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  cargando: ['M21 12a9 9 0 1 1-6.219-8.56'],
  atras: ['m15 18-6-6 6-6'],
  adelante: ['m9 18 6-6-6-6'],
  vacio: ['M22 12L16 12L14 15L10 15L8 12L2 12', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
  mas: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  exito: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0', 'm16 9-5.5 5.5L8 12'],
  info: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0', 'M12 16v-4', 'M12 8h.01'],
  alerta: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  error: ['m15 9-6 6', 'M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z', 'm9 9 6 6']
};

export function icono(nombre, clase = '') {
  return `<svg class="icono${clase ? ' ' + clase : ''}" viewBox="0 0 24 24" aria-hidden="true">${(TRAZOS[nombre] || []).map(d => `<path d="${d}"/>`).join('')}</svg>`;
}

const ICONO_AVISO = { ok: 'exito', error: 'error', warn: 'alerta' };

export function toast(mensaje, tipo = 'info', ms = 4000) {
  const caja = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  t.innerHTML = icono(ICONO_AVISO[tipo] || 'info');
  const texto = document.createElement('span');
  texto.textContent = mensaje;
  t.appendChild(texto);
  caja.appendChild(t);
  while (caja.children.length > 3) caja.firstChild.remove();
  setTimeout(() => t.classList.add('saliendo'), Math.max(ms - 400, 0));
  setTimeout(() => t.remove(), ms);
}

// Muestra un error de la API con su detalle por campo.
export function toastError(e) {
  const extra = typeof e?.detalle === 'function' ? e.detalle() : [];
  toast([e?.message || 'Ocurrió un error', ...extra].join('\n'), 'error', 7000);
}

// Modal simple. contenido = HTML; devuelve el <dialog>.
export function modal({ titulo, contenido, acciones = '' }) {
  const d = document.getElementById('modal');
  if (d.open) d.close();
  d.className = 'modal';
  d.innerHTML = `
    <form method="dialog" class="modal-body">
      <header class="modal-head">
        <h2>${esc(titulo)}</h2>
        <button class="icon-btn" value="cancelar" aria-label="Cerrar" title="Cerrar">${icono('cerrar')}</button>
      </header>
      <div class="modal-content">${contenido}</div>
      ${acciones ? `<footer class="modal-foot">${acciones}</footer>` : ''}
    </form>`;
  d.showModal();
  return d;
}

// ---------- Visor de PDF ----------
// Modal transparente que solo muestra el documento, listo para imprimir; las acciones flotan encima.
// cargar(formato) devuelve el Blob del PDF. formatos = [[valor, texto]] para cambiar de tamaño sin cerrar.
const CLAVE_FORMATO = 'veterinaria.formato_pdf';
const ANCHO_FORMATO = { 'ticket-80': '26rem', 'ticket-58': '21rem', a5: '42rem', a4: '56rem' };
const espera = ms => new Promise(r => setTimeout(r, ms));

export function formatoPdfPreferido(formatos) {
  let f = null;
  try { f = localStorage.getItem(CLAVE_FORMATO); } catch { /* sin almacenamiento */ }
  return formatos.some(x => x[0] === f) ? f : formatos[0][0];
}

export function visorPdf({ titulo, subtitulo = '', formatos = [['a4', 'A4']], formato, cargar, nombre = f => `comprobante-${f}.pdf` }) {
  const d = document.getElementById('modal');
  if (d.open) d.close();
  let actual = formato || formatoPdfPreferido(formatos);
  let url = null;
  let blob = null;
  let turno = 0;

  d.className = 'modal modal-visor';
  d.innerHTML = `
    <form method="dialog" class="visor">
      <p class="visor-titulo"><strong>${esc(titulo)}</strong>${subtitulo ? `<span>${esc(subtitulo)}</span>` : ''}</p>
      <div class="visor-papel">
        <div class="visor-estado" data-estado></div>
        <iframe class="visor-marco" title="${esc(titulo)}" hidden></iframe>
      </div>
      <div class="visor-acciones">
        ${formatos.length > 1 ? `
          <div class="visor-formatos" role="radiogroup" aria-label="Tamaño">
            ${formatos.map(([v, t]) => `<button type="button" class="visor-formato" role="radio" data-formato="${esc(v)}">${esc(t)}</button>`).join('')}
          </div>` : ''}
        <button type="button" class="btn btn-primary" data-imprimir disabled>${icono('imprimir')}<span>Imprimir</span></button>
        <button type="button" class="btn" data-descargar disabled aria-label="Descargar">${icono('descargar')}<span>Descargar</span></button>
        <button type="button" class="btn" data-pestana disabled aria-label="Abrir en otra pestaña">${icono('ventana')}<span>Otra pestaña</span></button>
        <button class="btn" value="cerrar" aria-label="Cerrar">${icono('cerrar')}<span>Cerrar</span></button>
      </div>
    </form>`;

  const marco = d.querySelector('.visor-marco');
  const estado = d.querySelector('[data-estado]');
  const botones = [...d.querySelectorAll('[data-imprimir], [data-descargar], [data-pestana]')];

  const liberar = () => { if (url) { const u = url; setTimeout(() => URL.revokeObjectURL(u), 1000); url = null; } };

  const mostrarEstado = (html) => {
    estado.innerHTML = html;
    estado.hidden = false;
    marco.hidden = true;
    botones.forEach(b => { b.disabled = true; });
  };

  async function pintar() {
    const mio = ++turno;
    d.style.setProperty('--visor-ancho', ANCHO_FORMATO[actual] || '56rem');
    d.querySelectorAll('[data-formato]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.formato === actual)));
    mostrarEstado(`${icono('cargando', 'girando')}<p>Preparando el comprobante…</p>`);
    liberar();
    let ultimoError = null;
    // Recién emitido, la API puede tardar unos segundos en generar el PDF: se reintenta.
    for (let i = 0; i < 4 && mio === turno; i++) {
      try {
        const b = await cargar(actual);
        if (/json/.test(b.type)) throw new Error('La API todavía no tiene el PDF de este comprobante.');
        blob = b.type === 'application/pdf' ? b : new Blob([b], { type: 'application/pdf' });
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
      mostrarEstado(`${icono('error')}<p>${esc(ultimoError.message || 'No se pudo obtener el PDF.')}</p>
        <button type="button" class="btn" data-reintentar>Reintentar</button>`);
      estado.querySelector('[data-reintentar]').addEventListener('click', pintar);
      return;
    }
    url = URL.createObjectURL(blob);
    marco.src = `${url}#toolbar=0&navpanes=0&view=FitH`;
    marco.hidden = false;
    estado.hidden = true;
    botones.forEach(b => { b.disabled = false; });
    d.querySelector('[data-imprimir]').focus();
  }

  d.querySelectorAll('[data-formato]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.formato === actual) return;
    actual = b.dataset.formato;
    try { localStorage.setItem(CLAVE_FORMATO, actual); } catch { /* sin almacenamiento */ }
    pintar();
  }));
  d.querySelector('[data-imprimir]').addEventListener('click', () => {
    try {
      marco.contentWindow.focus();
      marco.contentWindow.print();
    } catch {
      window.open(url, '_blank');
      toast('Imprime desde la pestaña que se abrió.', 'info');
    }
  });
  d.querySelector('[data-descargar]').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre(actual);
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  d.querySelector('[data-pestana]').addEventListener('click', () => window.open(url, '_blank'));

  // Un clic fuera del documento (en el velo) también cierra.
  const fuera = ev => { if (ev.target === d || ev.target.classList?.contains('visor') || ev.target.classList?.contains('visor-papel')) d.close(); };
  d.addEventListener('click', fuera);
  d.addEventListener('close', () => {
    turno++;
    liberar();
    d.removeEventListener('click', fuera);
    d.className = 'modal';
    d.style.removeProperty('--visor-ancho');
  }, { once: true });

  d.showModal();
  pintar();
  return d;
}

// ---------- Tabla de datos ----------
// Tabla con columna "N°", igual que el sistema del restaurante. Las columnas `sec` (y las de acciones)
// pasan a una fila desplegable "+" cuando la tabla no cabe en su contenedor: sin barra horizontal.
// columnas: [{ titulo, clase, sec, celda: (fila, i) => html }]. enlace(fila) hace la fila clicable.
// totales(columna) devuelve el html de la fila de totales para esa columna (o vacío).
export function tablaDatos({ filas, columnas, numero = (f, i) => i + 1, enlace = null, elegible = false, claseFila = null, totales = null, vacio = 'Todavía no hay registros.', pie = '' }) {
  if (!filas.length) return `<div class="vacio">${icono('vacio')}<p>${esc(vacio)}</p></div>`;
  const esSec = c => c.sec || c.clase === 'col-acciones';
  const haySec = columnas.some(esSec);
  const clase = c => `${c.clase || ''}${esSec(c) ? ' sec' : ''}`.trim();

  const filasHtml = filas.map((f, i) => {
    const href = enlace ? enlace(f) : '';
    const celdas = columnas.map(c => ({ c, html: c.celda(f, i) ?? '' }));
    const detalle = haySec
      ? `<tr class="fila-detalle" hidden><td colspan="${columnas.length + 2}"><dl>
          ${celdas.filter(x => esSec(x.c) && String(x.html).trim() !== '').map(x => `<div><dt>${esc(x.c.titulo || 'Acciones')}</dt><dd>${x.html}</dd></div>`).join('')}
        </dl></td></tr>`
      : '';
    return `
      <tr class="${claseFila ? claseFila(f) : ''}${href || elegible ? ' elegible' : ''}" ${href ? `data-href="${esc(href)}"` : ''} ${elegible ? `data-fila="${i}"` : ''}>
        <td class="col-n">${esc(numero(f, i))}</td>
        ${celdas.map(x => `<td class="${clase(x.c)}">${x.html}</td>`).join('')}
        ${haySec ? '<td class="col-mas"><button type="button" class="btn-mas" aria-expanded="false" aria-label="Ver más datos">+</button></td>' : ''}
      </tr>${detalle}`;
  }).join('');

  return `
    <div class="tabla-caja">
      <table class="tabla">
        <thead><tr>
          <th class="col-n" scope="col">N°</th>
          ${columnas.map(c => `<th class="${clase(c)}" scope="col">${esc(c.titulo)}</th>`).join('')}
          ${haySec ? '<th class="col-mas" scope="col"><span class="sr-only">Más datos</span></th>' : ''}
        </tr></thead>
        <tbody>${filasHtml}</tbody>
        ${totales ? `<tfoot><tr>
          <td class="col-n"></td>
          ${columnas.map(c => `<td class="${clase(c)}">${totales(c) ?? ''}</td>`).join('')}
          ${haySec ? '<td class="col-mas"></td>' : ''}
        </tr></tfoot>` : ''}
      </table>
      ${pie}
    </div>`;
}

// Pie con contador y paginación (la página la maneja quien llama: puede ser de la API).
export function pieTabla({ pagina, ultima = null, total = null, hayMas, cantidad }) {
  const contador = total != null ? `${total} ${total === 1 ? 'registro' : 'registros'}` : `${cantidad} ${cantidad === 1 ? 'registro' : 'registros'}`;
  const paginas = ultima != null ? `Página ${pagina} de ${ultima}` : `Página ${pagina}`;
  const mostrarPaginas = pagina > 1 || hayMas;
  return `
    <div class="tabla-pie">
      <p class="tabla-contador" aria-live="polite">${esc(contador)}</p>
      ${mostrarPaginas ? `<div class="tabla-paginas">
        <span>${esc(paginas)}</span>
        <button class="btn" type="button" data-pagina="-1" aria-label="Página anterior" title="Página anterior" ${pagina > 1 ? '' : 'disabled'}>${icono('atras')}</button>
        <button class="btn" type="button" data-pagina="1" aria-label="Página siguiente" title="Página siguiente" ${hayMas ? '' : 'disabled'}>${icono('adelante')}</button>
      </div>` : ''}
    </div>`;
}

// Tabla con datos locales: pagina en el navegador (25 por página) y recuerda la página mientras
// la `clave` no cambie (por ejemplo, los filtros). alPintar(caja) conecta los botones de cada página.
export function tablaLocal(caja, { filas, porPagina = 25, clave = '', alPintar = null, alElegir = null, ...opciones }) {
  const paginas = Math.max(1, Math.ceil(filas.length / porPagina));
  if (caja._clave !== clave) { caja._clave = clave; caja._pagina = 1; }
  let pagina = Math.min(caja._pagina || 1, paginas);
  const pintar = () => {
    caja._pagina = pagina;
    const desde = (pagina - 1) * porPagina;
    const visibles = filas.slice(desde, desde + porPagina);
    caja.innerHTML = tablaDatos({
      ...opciones,
      elegible: Boolean(alElegir),
      filas: visibles,
      numero: (f, i) => desde + i + 1,
      pie: pieTabla({ pagina, ultima: paginas, total: filas.length, hayMas: pagina < paginas, cantidad: filas.length })
    });
    activarTablas(caja, { alPaginar: paso => { pagina = Math.max(1, Math.min(paginas, pagina + paso)); pintar(); } });
    // Fila que abre algo propio (un modal): clic o Enter sobre la fila, salvo en sus botones.
    if (alElegir) caja.querySelectorAll('tr[data-fila]').forEach(tr => {
      tr.tabIndex = 0;
      const elegir = ev => { if (!ev.target.closest('button, a, input, select, label')) alElegir(visibles[Number(tr.dataset.fila)]); };
      tr.addEventListener('click', elegir);
      tr.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target === tr) elegir(ev); });
    });
    alPintar?.(caja);
  };
  pintar();
}

// Activa el "+", las filas clicables y la paginación de las tablas dentro de raiz (una sola vez por raiz).
export function activarTablas(raiz, { alPaginar } = {}) {
  if (alPaginar) { raiz._alPaginar = alPaginar; raiz.dataset.tablas = ''; }
  if (!raiz._tablas) {
    raiz._tablas = true;
    raiz.addEventListener('click', ev => {
      // Las raíces pueden estar anidadas (la vista y una caja dentro): el clic se atiende una sola vez.
      if (ev._tabla) return;
      ev._tabla = true;
      const mas = ev.target.closest('.btn-mas');
      if (mas) {
        const detalle = mas.closest('tr').nextElementSibling;
        const abrir = detalle.hidden;
        detalle.hidden = !abrir;
        mas.textContent = abrir ? '−' : '+';
        mas.setAttribute('aria-expanded', String(abrir));
        return;
      }
      const pag = ev.target.closest('[data-pagina]');
      if (pag) { pag.closest('[data-tablas]')?._alPaginar?.(Number(pag.dataset.pagina)); return; }
      const fila = ev.target.closest('tr.elegible');
      if (fila?.dataset.href && !ev.target.closest('button, a, input, select, label')) location.hash = fila.dataset.href;
    });
  }
  programarAjuste();
}

// Como el data-table de la referencia: decide por el espacio real del contenedor, no por la ventana,
// así funciona igual con la barra lateral abierta, plegada o dentro de un modal.
export function ajustarTablas() {
  document.querySelectorAll('table.tabla').forEach(t => {
    const caja = t.parentElement;
    if (!caja?.clientWidth || !t.querySelector('.sec')) return;
    t.classList.remove('compacta');
    const noCabe = t.offsetWidth > caja.clientWidth + 1;
    t.classList.toggle('compacta', noCabe);
    // En pantallas angostas el CSS ya oculta las secundarias: ahí la fila "+" sigue siendo necesaria.
    const ocultas = noCabe || getComputedStyle(t.querySelector('.sec')).display === 'none';
    if (!ocultas) {
      // Si vuelve a caber, se cierran las filas desplegadas.
      t.querySelectorAll('.fila-detalle:not([hidden])').forEach(d => {
        d.hidden = true;
        const b = d.previousElementSibling?.querySelector('.btn-mas');
        if (b) { b.textContent = '+'; b.setAttribute('aria-expanded', 'false'); }
      });
    }
  });
}

let ajustePendiente = false;
export function programarAjuste() {
  if (ajustePendiente) return;
  ajustePendiente = true;
  requestAnimationFrame(() => { ajustePendiente = false; ajustarTablas(); });
}
if (typeof window !== 'undefined') window.addEventListener('resize', programarAjuste);

// Pide una contraseña en un modal. Con confirmar, la pide dos veces y valida con validar(clave) → error|null.
// Devuelve la contraseña o null si se cancela.
export function pedirContrasena({ titulo, texto = '', confirmar = false, validar = null, textoOk = 'Continuar' }) {
  return new Promise(resolve => {
    const d = modal({
      titulo,
      contenido: `
        ${texto ? `<p class="muted">${esc(texto)}</p>` : ''}
        <div class="form-grid">
          ${campo({ nombre: 'clave', etiqueta: 'Contraseña', tipo: 'password', req: true, attrs: `autocomplete="${confirmar ? 'new-password' : 'off'}"` })}
          ${confirmar ? campo({ nombre: 'clave2', etiqueta: 'Repite la contraseña', tipo: 'password', req: true, attrs: 'autocomplete="new-password"' }) : ''}
          <p class="form-error span-all" id="pc-error"></p>
        </div>`,
      acciones: `<button class="btn" value="cancelar">Cancelar</button><button class="btn btn-primary" value="ok" id="pc-ok">${esc(textoOk)}</button>`
    });
    let valor = null;
    const ok = $('#pc-ok', d);
    ok.addEventListener('click', ev => {
      const clave = $('[name=clave]', d).value;
      const err = !clave ? 'Escribe la contraseña.'
        : confirmar && clave !== $('[name=clave2]', d).value ? 'Las contraseñas no coinciden.'
          : validar ? validar(clave) : null;
      if (err) { ev.preventDefault(); $('#pc-error', d).textContent = err; return; }
      valor = clave;
    });
    d.addEventListener('close', () => resolve(d.returnValue === 'ok' ? valor : null), { once: true });
    $('[name=clave]', d).focus();
  });
}

export function cerrarModal() {
  const d = document.getElementById('modal');
  if (d.open) d.close();
}

export function confirmar(titulo, mensaje, textoOk = 'Confirmar', peligro = false) {
  return new Promise(resolve => {
    const d = modal({
      titulo,
      contenido: `<p>${esc(mensaje)}</p>`,
      acciones: `
        <button class="btn" value="no">Cancelar</button>
        <button class="btn ${peligro ? 'btn-danger' : 'btn-primary'}" value="si">${esc(textoOk)}</button>`
    });
    d.addEventListener('close', () => resolve(d.returnValue === 'si'), { once: true });
  });
}

// Lee un formulario como objeto; omite campos vacíos si omitirVacios.
export function leerForm(form, { omitirVacios = false } = {}) {
  const datos = {};
  for (const [k, v] of new FormData(form).entries()) {
    if (v instanceof File) continue;
    const valor = typeof v === 'string' ? v.trim() : v;
    if (omitirVacios && valor === '') continue;
    datos[k] = valor;
  }
  return datos;
}

// Bloquea un botón mientras corre una promesa (evita doble clic).
export async function conCarga(boton, fn) {
  if (!boton || boton.disabled) return;
  const texto = boton.textContent;
  boton.disabled = true;
  boton.dataset.cargando = '1';
  boton.textContent = 'Procesando…';
  try {
    return await fn();
  } finally {
    boton.disabled = false;
    delete boton.dataset.cargando;
    boton.textContent = texto;
  }
}

export function campo({ nombre, etiqueta, valor = '', tipo = 'text', req = false, ayuda = '', attrs = '' }) {
  return `
    <label class="field">
      <span class="field-label">${esc(etiqueta)}${req ? ' <b aria-hidden="true">*</b>' : ''}</span>
      <input name="${esc(nombre)}" type="${esc(tipo)}" value="${esc(valor)}" ${req ? 'required' : ''} ${attrs}>
      ${ayuda ? `<small class="field-help">${esc(ayuda)}</small>` : ''}
    </label>`;
}

export function selector({ nombre, etiqueta, opciones, valor = '', req = false, ayuda = '' }) {
  const ops = opciones.map(([v, t]) =>
    `<option value="${esc(v)}" ${String(v) === String(valor) ? 'selected' : ''}>${esc(t)}</option>`).join('');
  return `
    <label class="field">
      <span class="field-label">${esc(etiqueta)}${req ? ' <b aria-hidden="true">*</b>' : ''}</span>
      <select name="${esc(nombre)}" ${req ? 'required' : ''}>${ops}</select>
      ${ayuda ? `<small class="field-help">${esc(ayuda)}</small>` : ''}
    </label>`;
}

// Bloque para ver la respuesta cruda de la API (la colección no documenta respuestas).
export function crudo(obj, abierto = false) {
  if (obj === undefined) return '';
  return `
    <details class="raw" ${abierto ? 'open' : ''}>
      <summary>Respuesta de la API</summary>
      <pre>${esc(JSON.stringify(obj, null, 2))}</pre>
    </details>`;
}

export function vacioMsg(texto) {
  return `<p class="empty">${esc(texto)}</p>`;
}

export function fecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
}
