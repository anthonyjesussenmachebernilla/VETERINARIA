// Punto de venta: catálogo, carrito, cliente, comprobante y cobro.
import { store } from '../store.js';
import { auth } from '../auth.js';
import { r2, soles, nombreTipoDoc } from '../validar.js';
import { esc, $, $$, toast, conCarga } from '../ui.js';
import { tasaIgvLocal, productosActivos, buscarProductos } from './productos.js';
import { buscarClientes, formCliente } from './clientes.js';
import {
  calcularTotales, calcularLinea, validarVenta, generarCuotas, registrarVenta, emitirVenta, verComprobante,
  METODOS_PAGO, LIMITE_BOLETA_SIN_DNI
} from '../comprobantes.js';

// El carrito sobrevive a la navegación dentro de la sesión.
const carrito = nuevoCarrito();
const catalogo = { q: '', categoria: 'todas' };

function nuevoCarrito() {
  return { items: [], cliente: null, tipo: '03', forma_pago: 'Contado', metodo_pago: 'efectivo', recibido: '', cuotas: [], numCuotas: 2 };
}

function vaciar() {
  Object.assign(carrito, nuevoCarrito());
}

const esNrus = () => store.config().tax_regime === 'rus';

export function vistaVender(cont) {
  if (esNrus() && carrito.tipo === '01') carrito.tipo = '03';
  cont.innerHTML = `
    <div class="pos">
      <section class="pos-catalog" aria-label="Productos">
        <div class="pos-search">
          <input type="search" id="pos-q" placeholder="Buscar producto o servicio" value="${esc(catalogo.q)}" autocomplete="off" aria-label="Buscar producto">
        </div>
        <div class="chips" id="pos-cats"></div>
        <div class="pos-grid" id="pos-grid"></div>
      </section>

      <aside class="pos-cart" id="pos-cart" aria-label="Venta actual"></aside>

      <div class="pos-bar" id="pos-bar">
        <span><strong id="bar-total">S/ 0.00</strong> <span class="muted small" id="bar-items"></span></span>
        <a class="btn btn-primary" href="#pos-cart" id="bar-ir">Cobrar</a>
      </div>
    </div>`;

  $('#pos-q', cont).addEventListener('input', ev => { catalogo.q = ev.target.value; pintarCatalogo(cont); });
  $('#pos-q', cont).addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    const primero = $('#pos-grid [data-add]', cont);
    if (primero) { primero.click(); ev.target.select(); }
  });
  $('#pos-cats', cont).addEventListener('click', ev => {
    const b = ev.target.closest('[data-cat]');
    if (!b) return;
    catalogo.categoria = b.dataset.cat;
    pintarCatalogo(cont);
  });
  $('#pos-grid', cont).addEventListener('click', ev => {
    const b = ev.target.closest('[data-add]');
    if (b) agregar(cont, Number(b.dataset.add));
  });
  $('#bar-ir', cont).addEventListener('click', ev => {
    ev.preventDefault();
    $('#pos-cart', cont).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  pintarCatalogo(cont);
  pintarCarrito(cont);
  if (window.matchMedia?.('(min-width: 821px)').matches) $('#pos-q', cont).focus();
}

// ---------- Catálogo ----------
function pintarCatalogo(cont) {
  const cats = store.todos('categorias');
  const activos = productosActivos();
  $('#pos-cats', cont).innerHTML = [['todas', 'Todos'], ...cats.filter(c => activos.some(p => p.categoria_id === c.id)).map(c => [String(c.id), c.nombre])]
    .map(([id, n]) => `<button type="button" class="chip ${catalogo.categoria === id ? 'is-active' : ''}" data-cat="${esc(id)}">${esc(n)}</button>`).join('');

  let lista = activos;
  if (catalogo.categoria !== 'todas') lista = lista.filter(p => String(p.categoria_id) === catalogo.categoria);
  lista = buscarProductos(catalogo.q, lista).sort((a, b) => a.descripcion.localeCompare(b.descripcion, 'es'));

  const grid = $('#pos-grid', cont);
  if (!activos.length) {
    grid.innerHTML = `<div class="empty-state"><p><strong>No hay productos activos.</strong></p>
      ${auth.esAdmin() ? '<a class="btn btn-primary" href="#/productos">Registrar productos</a>' : '<p class="muted">Pide al administrador que los registre.</p>'}</div>`;
    return;
  }
  if (!lista.length) { grid.innerHTML = '<p class="empty">Sin resultados.</p>'; return; }
  grid.innerHTML = lista.slice(0, 60).map(p => `
    <button type="button" class="pos-prod" data-add="${p.id}">
      <span class="pos-prod-name">${esc(p.descripcion)}</span>
      <span class="pos-prod-meta">
        <strong>${esc(soles(p.precio))}</strong>
        ${p.controla_stock ? `<span class="${Number(p.stock) <= 0 ? 'text-danger' : 'muted'}">Stock ${esc(p.stock)}</span>` : ''}
      </span>
    </button>`).join('');
}

function agregar(cont, productoId) {
  const p = store.buscar('productos', productoId);
  if (!p) return;
  const existente = carrito.items.find(i => i.producto_id === p.id);
  if (existente) existente.cantidad = r2(existente.cantidad + 1);
  else {
    carrito.items.push({
      producto_id: p.id, codigo: p.codigo, descripcion: p.descripcion, unidad: p.unidad,
      precio: Number(p.precio), cantidad: 1, descuento: 0, tip_afe_igv: p.tip_afe_igv,
      cod_producto_sunat: p.cod_producto_sunat || ''
    });
  }
  const linea = carrito.items.find(i => i.producto_id === p.id);
  if (p.controla_stock && linea.cantidad > Number(p.stock)) {
    toast(`Stock insuficiente de ${p.descripcion}: hay ${p.stock}.`, 'warn', 3500);
  }
  pintarCarrito(cont);
}

// ---------- Carrito ----------
function pintarCarrito(cont) {
  const caja = $('#pos-cart', cont);
  const nrus = esNrus();
  const tasa = tasaIgvLocal();
  const c = carrito.cliente;
  const esFactura = carrito.tipo === '01';
  if (!esFactura && carrito.forma_pago === 'Credito') carrito.forma_pago = 'Contado';

  caja.innerHTML = `
    <div class="cart-head">
      <h2>Venta</h2>
      ${carrito.items.length ? '<button class="link-btn" type="button" id="cart-vaciar">Vaciar</button>' : ''}
    </div>

    <div class="cart-block">
      <span class="block-label">Cliente</span>
      ${c ? `
        <div class="cliente-sel">
          <span><strong>${esc(c.razon_social)}</strong><span class="muted small">${esc(nombreTipoDoc(c.tipo_doc))} ${esc(c.num_doc)}</span></span>
          <button class="icon-btn" type="button" id="cli-quitar" aria-label="Quitar cliente">×</button>
        </div>` : `
        <div class="cliente-buscar">
          <div class="input-group">
            <input type="search" id="cli-q" placeholder="DNI, RUC o nombre" autocomplete="off" aria-label="Buscar cliente">
            <button class="btn" type="button" id="cli-nuevo">Nuevo</button>
          </div>
          <div class="search-results" id="cli-res"></div>
          <p class="muted small">Sin cliente: boleta a "Clientes varios" (solo menos de S/ ${LIMITE_BOLETA_SIN_DNI}).</p>
        </div>`}
    </div>

    <ul class="cart-items" id="cart-items">
      ${carrito.items.length ? carrito.items.map((it, i) => `
        <li class="cart-item" data-i="${i}">
          <div class="cart-item-top">
            <span class="cart-item-name">${esc(it.descripcion)}</span>
            <button class="icon-btn" type="button" data-quitar="${i}" aria-label="Quitar ${esc(it.descripcion)}">×</button>
          </div>
          <div class="cart-item-row">
            <div class="stepper">
              <button type="button" data-menos="${i}" aria-label="Menos">−</button>
              <input type="number" data-cant="${i}" value="${esc(it.cantidad)}" min="0" step="any" inputmode="decimal" aria-label="Cantidad">
              <button type="button" data-mas="${i}" aria-label="Más">+</button>
            </div>
            <span class="muted small">× ${esc(soles(it.precio))}</span>
            <strong class="cart-line" data-linea="${i}">${esc(soles(calcularLinea(it, tasa).importe))}</strong>
          </div>
          <label class="cart-desc">
            <span class="muted small">Descuento S/</span>
            <input type="number" data-desc="${i}" value="${it.descuento || ''}" min="0" step="0.01" inputmode="decimal" placeholder="0.00">
          </label>
        </li>`).join('') : '<li class="empty">Agrega productos o servicios desde la lista.</li>'}
    </ul>

    <div class="cart-block">
      <span class="block-label">Comprobante</span>
      <div class="segmented seg-3" role="radiogroup" aria-label="Comprobante">
        <label><input type="radio" name="tipo" value="03" ${carrito.tipo === '03' ? 'checked' : ''}><span>Boleta</span></label>
        <label><input type="radio" name="tipo" value="01" ${esFactura ? 'checked' : ''} ${nrus ? 'disabled' : ''}><span>Factura</span></label>
        <label><input type="radio" name="tipo" value="ninguno" ${carrito.tipo === 'ninguno' ? 'checked' : ''}><span>Después</span></label>
      </div>
      ${carrito.tipo === 'ninguno' ? '<p class="muted small">Se guarda la venta y el comprobante se emite luego desde Ventas.</p>' : ''}
      ${nrus ? '<p class="muted small">Nuevo RUS: solo boletas.</p>' : ''}
    </div>

    <div class="cart-block">
      <span class="block-label">Pago</span>
      ${esFactura ? `
        <div class="segmented" role="radiogroup" aria-label="Forma de pago">
          <label><input type="radio" name="forma" value="Contado" ${carrito.forma_pago === 'Contado' ? 'checked' : ''}><span>Contado</span></label>
          <label><input type="radio" name="forma" value="Credito" ${carrito.forma_pago === 'Credito' ? 'checked' : ''}><span>Crédito</span></label>
        </div>` : ''}
      ${carrito.forma_pago === 'Credito' ? pintarCuotas() : `
        <div class="chips chips-wrap" role="radiogroup" aria-label="Método de pago">
          ${METODOS_PAGO.map(([v, t]) => `<button type="button" class="chip ${carrito.metodo_pago === v ? 'is-active' : ''}" data-metodo="${v}" aria-pressed="${carrito.metodo_pago === v}">${t}</button>`).join('')}
        </div>
        ${carrito.metodo_pago === 'efectivo' ? `
          <div class="vuelto">
            <label class="field"><span class="field-label">Recibido S/</span>
              <input type="number" id="recibido" value="${esc(carrito.recibido)}" min="0" step="0.10" inputmode="decimal" placeholder="Opcional"></label>
            <span class="vuelto-out" id="vuelto"></span>
          </div>` : ''}`}
    </div>

    <dl class="totals" id="totals"></dl>
    <p class="form-error" id="cart-error" role="alert"></p>
    <button class="btn btn-primary btn-block btn-lg" type="button" id="btn-cobrar" ${carrito.items.length ? '' : 'disabled'}>
      ${carrito.tipo === '01' ? 'Emitir factura' : carrito.tipo === '03' ? 'Emitir boleta' : 'Guardar venta'}
    </button>`;

  conectarCarrito(cont);
  pintarTotales(cont);
}

function pintarCuotas() {
  const total = calcularTotales(carrito.items, 0).total;
  if (!carrito.cuotas.length && total > 0) carrito.cuotas = generarCuotas(total, carrito.numCuotas);
  return `
    <div class="cuotas">
      <div class="input-group">
        <label class="field"><span class="field-label">Cuotas</span>
          <input type="number" id="num-cuotas" value="${carrito.numCuotas}" min="1" max="12" step="1" inputmode="numeric"></label>
        <button class="btn" type="button" id="btn-repartir">Repartir igual</button>
      </div>
      ${carrito.cuotas.map((q, i) => `
        <div class="cuota-row">
          <span class="muted small">${i + 1}</span>
          <input type="date" data-cfecha="${i}" value="${esc(q.fecha_pago)}" aria-label="Fecha cuota ${i + 1}">
          <input type="number" data-cmonto="${i}" value="${esc(q.monto)}" min="0" step="0.01" inputmode="decimal" aria-label="Monto cuota ${i + 1}">
        </div>`).join('')}
    </div>`;
}

function conectarCarrito(cont) {
  const caja = $('#pos-cart', cont);
  const repintar = () => pintarCarrito(cont);

  $('#cart-vaciar', caja)?.addEventListener('click', () => { vaciar(); repintar(); });
  $('#cli-quitar', caja)?.addEventListener('click', () => { carrito.cliente = null; repintar(); });

  const q = $('#cli-q', caja);
  if (q) {
    const res = $('#cli-res', caja);
    q.addEventListener('input', () => {
      const t = q.value.trim();
      if (t.length < 2) { res.innerHTML = ''; return; }
      const hallados = buscarClientes(t).slice(0, 6);
      res.innerHTML = hallados.length
        ? hallados.map(c => `<button type="button" class="result" data-cli="${c.id}"><span><strong>${esc(c.razon_social)}</strong> <span class="muted small">${esc(c.num_doc)}</span></span></button>`).join('')
        : '<p class="muted small">No está registrado. Usa "Nuevo".</p>';
    });
    q.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); $('[data-cli]', res)?.click(); }
    });
    res.addEventListener('click', ev => {
      const b = ev.target.closest('[data-cli]');
      if (!b) return;
      seleccionarCliente(store.buscar('clientes', Number(b.dataset.cli)));
      repintar();
    });
    $('#cli-nuevo', caja).addEventListener('click', () => {
      const t = q.value.trim();
      const inicial = /^\d{8}$/.test(t) ? { tipo_doc: '1', num_doc: t }
        : /^\d{11}$/.test(t) ? { tipo_doc: '6', num_doc: t }
        : t ? { tipo_doc: carrito.tipo === '01' ? '6' : '1', razon_social: t } : { tipo_doc: carrito.tipo === '01' ? '6' : '1' };
      formCliente({ inicial, alGuardar: c => { if (c) { seleccionarCliente(c); repintar(); } } });
    });
  }

  $$('[name=tipo]', caja).forEach(r => r.addEventListener('change', () => {
    carrito.tipo = r.value;
    if (carrito.tipo === '01' && carrito.cliente && carrito.cliente.tipo_doc !== '6') {
      toast('La factura requiere un cliente con RUC. Elige o registra uno.', 'warn');
    }
    repintar();
  }));
  $$('[name=forma]', caja).forEach(r => r.addEventListener('change', () => {
    carrito.forma_pago = r.value;
    carrito.cuotas = [];
    repintar();
  }));
  $$('[data-metodo]', caja).forEach(b => b.addEventListener('click', () => { carrito.metodo_pago = b.dataset.metodo; repintar(); }));

  // Cantidades y descuentos: se actualiza el total sin repintar para no perder el foco.
  caja.addEventListener('click', ev => {
    const menos = ev.target.closest('[data-menos]');
    const mas = ev.target.closest('[data-mas]');
    const quitar = ev.target.closest('[data-quitar]');
    if (menos) {
      const it = carrito.items[Number(menos.dataset.menos)];
      it.cantidad = r2(it.cantidad - 1);
      if (it.cantidad <= 0) carrito.items.splice(Number(menos.dataset.menos), 1);
      carrito.cuotas = [];
      repintar();
    } else if (mas) {
      agregar(cont, carrito.items[Number(mas.dataset.mas)].producto_id);
      carrito.cuotas = [];
    } else if (quitar) {
      carrito.items.splice(Number(quitar.dataset.quitar), 1);
      carrito.cuotas = [];
      repintar();
    }
  });
  caja.addEventListener('input', ev => {
    const t = ev.target;
    if (t.dataset.cant !== undefined) carrito.items[Number(t.dataset.cant)].cantidad = Number(t.value);
    else if (t.dataset.desc !== undefined) carrito.items[Number(t.dataset.desc)].descuento = Number(t.value) || 0;
    else if (t.id === 'recibido') carrito.recibido = t.value;
    else if (t.dataset.cmonto !== undefined) carrito.cuotas[Number(t.dataset.cmonto)].monto = Number(t.value);
    else if (t.dataset.cfecha !== undefined) carrito.cuotas[Number(t.dataset.cfecha)].fecha_pago = t.value;
    else return;
    pintarTotales(cont);
  });
  caja.addEventListener('change', ev => {
    const t = ev.target;
    if (t.dataset.cant !== undefined) {
      const i = Number(t.dataset.cant);
      if (!(carrito.items[i].cantidad > 0)) carrito.items.splice(i, 1);
      carrito.cuotas = [];
      repintar();
    } else if (t.dataset.desc !== undefined) {
      carrito.cuotas = [];
      repintar();
    }
  });

  const num = $('#num-cuotas', caja);
  const repartir = () => {
    carrito.numCuotas = Math.min(12, Math.max(1, Math.round(Number(num.value) || 1)));
    carrito.cuotas = generarCuotas(calcularTotales(carrito.items, 0).total, carrito.numCuotas);
    repintar();
  };
  num?.addEventListener('change', repartir);
  $('#btn-repartir', caja)?.addEventListener('click', repartir);

  $('#btn-cobrar', caja).addEventListener('click', ev => cobrar(cont, ev.currentTarget));
}

function seleccionarCliente(c) {
  if (!c) return;
  carrito.cliente = {
    id: c.id, tipo_doc: c.tipo_doc, num_doc: c.num_doc, razon_social: c.razon_social,
    direccion: c.direccion || '', email: c.email || '', telefono: c.telefono || ''
  };
  if (c.tipo_doc === '6' && carrito.tipo === '03' && !esNrus()) carrito.tipo = '01';
}

function pintarTotales(cont) {
  const tasa = tasaIgvLocal();
  const t = calcularTotales(carrito.items, tasa);
  const filas = [];
  if (t.gravado) filas.push(['Op. gravadas', t.gravado]);
  if (t.exonerado) filas.push(['Op. exoneradas', t.exonerado]);
  if (t.inafecto) filas.push(['Op. inafectas', t.inafecto]);
  if (t.igv) filas.push([`IGV ${tasa}%`, t.igv]);
  if (t.descuentos) filas.push(['Descuentos incluidos', -t.descuentos]);
  $('#totals', cont).innerHTML = `
    ${filas.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(soles(v))}</dd></div>`).join('')}
    <div class="total-row"><dt>Total</dt><dd>${esc(soles(t.total))}</dd></div>
    <p class="muted small">Importes referenciales; los oficiales los calcula la API al emitir.</p>`;

  carrito.items.forEach((it, i) => {
    const el = $(`[data-linea="${i}"]`, cont);
    if (el) el.textContent = soles(calcularLinea(it, tasa).importe);
  });

  const vuelto = $('#vuelto', cont);
  if (vuelto) {
    const rec = Number(carrito.recibido);
    vuelto.textContent = rec > 0 ? (rec >= t.total ? `Vuelto ${soles(rec - t.total)}` : `Faltan ${soles(t.total - rec)}`) : '';
    vuelto.classList.toggle('text-danger', rec > 0 && rec < t.total);
  }

  $('#bar-total', cont).textContent = soles(t.total);
  const n = carrito.items.reduce((s, i) => s + (Number(i.cantidad) || 0), 0);
  $('#bar-items', cont).textContent = n ? `${r2(n)} ítem(s)` : '';
  $('#pos-bar', cont).hidden = !carrito.items.length;
}

async function cobrar(cont, boton) {
  const error = $('#cart-error', cont);
  error.textContent = '';
  const tasa = tasaIgvLocal();
  const total = calcularTotales(carrito.items, tasa).total;
  const tipoValidar = carrito.tipo === 'ninguno' ? null : carrito.tipo;
  const msg = validarVenta({ ...carrito, tipo: tipoValidar }, { regimen: store.config().tax_regime });
  if (msg) { error.textContent = msg; return; }
  if (carrito.forma_pago === 'Contado' && carrito.metodo_pago === 'efectivo' && carrito.recibido !== '' && Number(carrito.recibido) < total) {
    error.textContent = 'El monto recibido es menor que el total.';
    return;
  }
  if (carrito.tipo !== 'ninguno') {
    const cfg = store.config();
    const serie = carrito.tipo === '01' ? cfg.serie_factura : cfg.serie_boleta;
    if (!serie) { error.textContent = 'Falta la serie por defecto en Configuración → Series.'; return; }
  }

  await conCarga(boton, async () => {
    const venta = registrarVenta({
      items: carrito.items.map(i => ({ ...i })),
      cliente: carrito.cliente,
      tipo: carrito.tipo,
      forma_pago: carrito.forma_pago,
      metodo_pago: carrito.forma_pago === 'Credito' ? null : carrito.metodo_pago,
      recibido: carrito.recibido === '' ? null : Number(carrito.recibido),
      cuotas: carrito.cuotas.map(q => ({ ...q })),
      tasa
    }, auth.actual());
    vaciar();
    catalogo.q = '';

    let comp = null;
    if (venta.tipo_comprobante !== 'ninguno') {
      try {
        comp = await emitirVenta(venta.id);
      } catch {
        // El detalle de la venta muestra el error y permite reintentar.
      }
    }
    location.hash = `#/ventas/${venta.id}`;
    // Emitido: el PDF se abre de inmediato, listo para imprimir.
    if (comp) verComprobante(comp);
  });
}
