// Productos y servicios: catálogo comercial local (la API no tiene endpoint de productos).
// Solo el administrador crea o edita; el cajero consulta.
import { store } from '../store.js';
import { auth } from '../auth.js';
import { api, comoLista } from '../api.js';
import { AFECTACIONES, UNIDADES, r2, soles, norm } from '../validar.js';
import {
  esc, $, $$, toast, toastError, modal, cerrarModal, confirmar,
  campo, selector, vacioMsg, conCarga, tablaLocal
} from '../ui.js';

const filtros = { q: '', categoria: 'todas', estado: 'activos' };

const nombreAfect = c => (AFECTACIONES.find(a => a[0] === c) || [c, c])[1];
const nombreUnidad = c => (UNIDADES.find(u => u[0] === c) || [c, c])[1];

// Tasa usada solo para previsualizar; la oficial la calcula la API.
export function tasaIgvLocal() {
  const c = store.config();
  if (c.tax_regime === 'rus') return 0;
  if (c.igv_rate_override != null && c.igv_rate_override !== '') return Number(c.igv_rate_override);
  if (c.tasa_igv_vigente != null && !isNaN(Number(c.tasa_igv_vigente))) return Number(c.tasa_igv_vigente);
  return 18;
}

export function productosActivos() {
  return store.todos('productos').filter(p => p.activo !== false);
}

export function buscarProductos(q, lista = productosActivos()) {
  const t = norm(q).trim();
  if (!t) return lista;
  const partes = t.split(/\s+/);
  return lista.filter(p => {
    const texto = norm(`${p.codigo} ${p.descripcion}`);
    return partes.every(x => texto.includes(x));
  });
}

export async function vistaProductos(cont) {
  const admin = auth.esAdmin();
  cont.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Productos y servicios</h1>
      ${admin ? `
        <div class="row-actions">
          <button class="btn" id="btn-cat" type="button">Categorías</button>
          <button class="btn btn-primary" id="btn-prod-nuevo" type="button">Nuevo</button>
        </div>` : ''}
    </div>
    <div class="toolbar">
      <input type="search" id="prod-q" placeholder="Buscar por nombre o código" value="${esc(filtros.q)}" aria-label="Buscar productos">
      <select id="prod-estado" aria-label="Estado">
        ${[['activos', 'Activos'], ['inactivos', 'Inactivos'], ['todos', 'Todos']].map(([v, t]) =>
          `<option value="${v}" ${filtros.estado === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="chips" id="prod-cats" role="tablist" aria-label="Categorías"></div>
    <div id="prod-lista"></div>`;

  const pintar = () => pintarLista(cont, admin);

  $('#prod-q', cont).addEventListener('input', ev => { filtros.q = ev.target.value; pintar(); });
  $('#prod-estado', cont).addEventListener('change', ev => { filtros.estado = ev.target.value; pintar(); });
  $('#prod-cats', cont).addEventListener('click', ev => {
    const b = ev.target.closest('[data-cat]');
    if (!b) return;
    filtros.categoria = b.dataset.cat;
    pintar();
  });
  if (admin) {
    $('#btn-prod-nuevo', cont).addEventListener('click', () => formProducto(null, pintar));
    $('#btn-cat', cont).addEventListener('click', () => gestionarCategorias(pintar));
  }
  pintar();
}

function pintarLista(cont, admin) {
  const cats = store.todos('categorias');
  const todos = store.todos('productos');
  if (filtros.categoria !== 'todas' && !cats.some(c => String(c.id) === filtros.categoria)) filtros.categoria = 'todas';

  $('#prod-cats', cont).innerHTML = [['todas', 'Todas'], ...cats.map(c => [String(c.id), c.nombre])]
    .map(([id, n]) => {
      const cuantos = id === 'todas' ? todos.length : todos.filter(p => String(p.categoria_id) === id).length;
      return `<button type="button" role="tab" class="chip ${filtros.categoria === id ? 'is-active' : ''}" data-cat="${esc(id)}" aria-selected="${filtros.categoria === id}">${esc(n)} <span>${cuantos}</span></button>`;
    }).join('');

  let lista = todos;
  if (filtros.estado === 'activos') lista = lista.filter(p => p.activo !== false);
  if (filtros.estado === 'inactivos') lista = lista.filter(p => p.activo === false);
  if (filtros.categoria !== 'todas') lista = lista.filter(p => String(p.categoria_id) === filtros.categoria);
  lista = buscarProductos(filtros.q, lista).sort((a, b) => a.descripcion.localeCompare(b.descripcion, 'es'));

  const caja = $('#prod-lista', cont);
  if (!todos.length) {
    caja.innerHTML = `<div class="vacio">
      <p><strong>Aún no hay productos ni servicios.</strong></p>
      <p class="muted">Registra consultas, vacunas, medicamentos, alimentos y accesorios con su precio final (con IGV).</p>
      ${admin ? '<button class="btn btn-primary" type="button" id="btn-prod-primero">Crear el primero</button>' : ''}
    </div>`;
    $('#btn-prod-primero', caja)?.addEventListener('click', () => formProducto(null, () => pintarLista(cont, admin)));
    return;
  }
  const catNombre = id => cats.find(c => c.id === id)?.nombre || 'Sin categoría';
  const editar = p => formProducto(store.buscar('productos', p.id), () => pintarLista(cont, admin));
  tablaLocal(caja, {
    filas: lista,
    clave: `${filtros.estado}|${filtros.categoria}|${filtros.q}`,
    vacio: 'Ningún producto coincide con la búsqueda.',
    alElegir: admin ? editar : null,
    claseFila: p => (p.activo === false ? 'fila-anulada' : ''),
    columnas: [
      { titulo: 'Producto o servicio', celda: p => `<strong>${esc(p.descripcion)}</strong><span class="sub font-id">${esc(p.codigo)}</span>` },
      { titulo: 'Categoría', sec: true, celda: p => esc(catNombre(p.categoria_id)) },
      { titulo: 'Tipo', sec: true, celda: p => `${p.tipo === 'servicio' ? 'Servicio' : 'Producto'}<span class="sub">${esc(nombreUnidad(p.unidad))}</span>` },
      { titulo: 'IGV', sec: true, celda: p => `<span class="pill ${p.tip_afe_igv === '10' ? '' : 'pill-info'}">${esc(nombreAfect(p.tip_afe_igv))}</span>` },
      { titulo: 'Stock', clase: 'num', celda: p => (p.controla_stock
        ? `<span class="pill ${Number(p.stock) <= 0 ? 'pill-danger' : Number(p.stock) <= 3 ? 'pill-warn' : 'pill-ok'}">${esc(p.stock)}</span>`
        : '<span class="muted">—</span>') },
      { titulo: 'Precio', clase: 'num', celda: p => `${esc(soles(p.precio))}${p.activo === false ? '<span class="sub">Inactivo</span>' : ''}` },
      ...(admin ? [{ titulo: '', clase: 'col-acciones', celda: p => `<button class="btn btn-sm" type="button" data-prod="${p.id}">Editar</button>` }] : [])
    ],
    alPintar: caja => $$('[data-prod]', caja).forEach(b => b.addEventListener('click', () => editar({ id: Number(b.dataset.prod) })))
  });
}

function sugerirCodigo(tipo) {
  const pref = tipo === 'servicio' ? 'S' : 'P';
  const usados = store.todos('productos')
    .map(p => p.codigo).filter(c => new RegExp(`^${pref}\\d+$`).test(c))
    .map(c => Number(c.slice(1)));
  const sig = (usados.length ? Math.max(...usados) : 0) + 1;
  return `${pref}${String(sig).padStart(4, '0')}`;
}

function formProducto(p, alGuardar) {
  const cats = store.todos('categorias');
  const tipo = p?.tipo || 'bien';
  const nuevo = !p;
  const usado = p && store.donde('venta_items', i => i.producto_id === p.id).length > 0;

  const d = modal({
    titulo: nuevo ? 'Nuevo producto o servicio' : 'Editar producto',
    contenido: `
      <div class="form-grid" id="f-prod">
        <div class="segmented span-all" role="radiogroup" aria-label="Tipo">
          <label><input type="radio" name="tipo" value="bien" ${tipo === 'bien' ? 'checked' : ''}><span>Producto</span></label>
          <label><input type="radio" name="tipo" value="servicio" ${tipo === 'servicio' ? 'checked' : ''}><span>Servicio</span></label>
        </div>
        ${campo({ nombre: 'descripcion', etiqueta: 'Descripción', valor: p?.descripcion, req: true, attrs: 'maxlength="250"', ayuda: 'Tal como saldrá en el comprobante. Ej.: Vacuna antirrábica, Consulta general.' })}
        ${campo({ nombre: 'codigo', etiqueta: 'Código interno', valor: p?.codigo || sugerirCodigo(tipo), req: true, attrs: 'maxlength="30" autocapitalize="characters"' })}
        <label class="field">
          <span class="field-label">Categoría <b aria-hidden="true">*</b></span>
          <select name="categoria_id">
            ${cats.map(c => `<option value="${c.id}" ${c.id === p?.categoria_id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
            <option value="nueva">+ Nueva categoría…</option>
          </select>
          <input name="categoria_nueva" placeholder="Nombre de la nueva categoría" hidden>
        </label>
        ${selector({ nombre: 'unidad', etiqueta: 'Unidad', opciones: UNIDADES, valor: p?.unidad || (tipo === 'servicio' ? 'ZZ' : 'NIU'), req: true })}
        ${campo({ nombre: 'precio', etiqueta: 'Precio de venta (S/)', valor: p?.precio ?? '', tipo: 'number', req: true, attrs: 'min="0" step="0.01" inputmode="decimal"', ayuda: 'Precio final que paga el cliente, con IGV incluido.' })}
        ${selector({ nombre: 'tip_afe_igv', etiqueta: 'Afectación IGV', opciones: AFECTACIONES, valor: p?.tip_afe_igv || '10', req: true, ayuda: 'Confírmala con el contador del negocio.' })}
        <p class="calc span-all" id="prod-calc" aria-live="polite"></p>
        <div class="field span-all">
          <span class="field-label">Código de producto SUNAT (opcional)</span>
          <div class="input-group">
            <input name="cod_producto_sunat" value="${esc(p?.cod_producto_sunat || '')}" inputmode="numeric" maxlength="8" placeholder="8 dígitos">
            <button class="btn" type="button" id="btn-sunat-buscar">Buscar</button>
          </div>
          <div class="inline-search" id="sunat-box" hidden>
            <input type="search" id="sunat-q" placeholder="Ej.: veterinario, vacuna, alimento para perros">
            <div id="sunat-res" class="search-results"></div>
          </div>
        </div>
        <div class="span-all stock-box" id="stock-box">
          <label class="check"><input type="checkbox" name="controla_stock" ${p?.controla_stock ? 'checked' : ''}> Controlar stock</label>
          ${campo({ nombre: 'stock', etiqueta: 'Stock actual', valor: p?.stock ?? 0, tipo: 'number', attrs: 'min="0" step="any" inputmode="decimal"' })}
        </div>
        ${nuevo ? '' : `<label class="check span-all"><input type="checkbox" name="activo" ${p.activo !== false ? 'checked' : ''}> Activo (aparece en el punto de venta)</label>`}
      </div>`,
    acciones: `
      ${!nuevo ? `<button class="btn btn-ghost-danger" type="button" id="btn-prod-borrar">${usado ? 'Desactivar' : 'Eliminar'}</button>` : ''}
      <span class="spacer"></span>
      <button class="btn" value="cancelar">Cancelar</button>
      <button class="btn btn-primary" value="ok" id="btn-prod-ok">Guardar</button>`
  });

  const f = $('#f-prod', d);
  const v = n => $(`[name=${n}]`, f);
  const tipoActual = () => $('[name=tipo]:checked', f).value;

  const actualizarTipo = () => {
    const servicio = tipoActual() === 'servicio';
    $('#stock-box', f).hidden = servicio;
    if (nuevo) {
      v('codigo').value = sugerirCodigo(tipoActual());
      v('unidad').value = servicio ? 'ZZ' : 'NIU';
    }
  };
  const actualizarStock = () => { v('stock').closest('.field').hidden = !v('controla_stock').checked; };
  const actualizarCalc = () => {
    const precio = Number(v('precio').value);
    const out = $('#prod-calc', f);
    if (!(precio > 0)) { out.textContent = ''; return; }
    const tasa = tasaIgvLocal();
    if (v('tip_afe_igv').value === '10' && tasa > 0) {
      const base = r2(precio / (1 + tasa / 100));
      out.textContent = `Valor sin IGV ${soles(base)} + IGV ${tasa}% ${soles(precio - base)} = ${soles(precio)} (referencial; la API calcula el oficial)`;
    } else {
      out.textContent = `Sin IGV: el cliente paga ${soles(precio)}.`;
    }
  };

  $$('[name=tipo]', f).forEach(r => r.addEventListener('change', actualizarTipo));
  v('controla_stock').addEventListener('change', actualizarStock);
  v('precio').addEventListener('input', actualizarCalc);
  v('tip_afe_igv').addEventListener('change', actualizarCalc);
  v('categoria_id').addEventListener('change', () => {
    const nueva = v('categoria_id').value === 'nueva';
    v('categoria_nueva').hidden = !nueva;
    if (nueva) v('categoria_nueva').focus();
  });
  $('#stock-box', f).hidden = tipo === 'servicio';
  actualizarStock();
  actualizarCalc();
  conectarBuscadorSunat(f);

  $('#btn-prod-ok', d).addEventListener('click', ev => {
    ev.preventDefault();
    const datos = {
      tipo: tipoActual(),
      descripcion: v('descripcion').value.trim().replace(/\s+/g, ' '),
      codigo: v('codigo').value.trim().toUpperCase(),
      unidad: v('unidad').value,
      precio: Number(v('precio').value),
      tip_afe_igv: v('tip_afe_igv').value,
      cod_producto_sunat: v('cod_producto_sunat').value.trim(),
      controla_stock: tipoActual() === 'bien' && v('controla_stock').checked,
      stock: Number(v('stock').value || 0)
    };
    if (!nuevo) datos.activo = v('activo').checked;

    const error = validarProducto(datos, p);
    if (error) return toast(error, 'warn');

    let categoria_id = v('categoria_id').value;
    if (categoria_id === 'nueva') {
      const nombre = v('categoria_nueva').value.trim();
      if (!nombre) return toast('Escribe el nombre de la nueva categoría.', 'warn');
      const existe = cats.find(c => norm(c.nombre) === norm(nombre));
      categoria_id = existe ? existe.id : store.insertar('categorias', { nombre }).id;
    }
    datos.categoria_id = Number(categoria_id);
    if (!datos.controla_stock) datos.stock = p?.stock ?? 0;

    try {
      if (nuevo) store.insertar('productos', { ...datos, activo: true });
      else store.actualizar('productos', p.id, datos);
      cerrarModal();
      toast(nuevo ? 'Producto creado.' : 'Producto actualizado.', 'ok');
      alGuardar();
    } catch (e) { toast(e.message, 'error'); }
  });

  $('#btn-prod-borrar', d)?.addEventListener('click', async () => {
    if (usado) {
      store.actualizar('productos', p.id, { activo: false });
      cerrarModal();
      toast('Producto desactivado: tiene ventas, por eso no se elimina.', 'ok');
      return alGuardar();
    }
    cerrarModal();
    if (!await confirmar('Eliminar producto', `¿Eliminar "${p.descripcion}"? Esta acción no se puede deshacer.`, 'Eliminar', true)) return;
    store.eliminar('productos', p.id);
    toast('Producto eliminado.', 'ok');
    alGuardar();
  });

  v('descripcion').focus();
}

export function validarProducto(d, actual = null) {
  if (d.descripcion.length < 3) return 'La descripción debe tener al menos 3 caracteres.';
  if (d.descripcion.length > 250) return 'La descripción no puede pasar de 250 caracteres.';
  if (!/^[A-Z0-9._-]{1,30}$/.test(d.codigo)) return 'El código solo admite letras, números, punto y guion (máx. 30).';
  const repetido = store.todos('productos').some(x => x.codigo === d.codigo && x.id !== actual?.id);
  if (repetido) return `El código ${d.codigo} ya está en uso.`;
  if (!UNIDADES.some(u => u[0] === d.unidad)) return 'Unidad inválida.';
  if (!(d.precio > 0)) return 'El precio debe ser mayor a 0.';
  if (d.precio > 999999) return 'El precio es demasiado alto.';
  if (!/^\d+(\.\d{1,4})?$/.test(String(d.precio))) return 'El precio admite hasta 4 decimales.';
  if (!AFECTACIONES.some(a => a[0] === d.tip_afe_igv)) return 'Afectación IGV inválida.';
  if (d.cod_producto_sunat && !/^\d{8}$/.test(d.cod_producto_sunat)) return 'El código SUNAT debe tener 8 dígitos.';
  if (d.controla_stock && (!(d.stock >= 0) || isNaN(d.stock))) return 'El stock no puede ser negativo.';
  return null;
}

// Búsqueda inline en el catálogo SUNAT (GET /catalogos/producto-sunat?q=).
function conectarBuscadorSunat(f) {
  const caja = $('#sunat-box', f);
  const q = $('#sunat-q', f);
  const res = $('#sunat-res', f);
  const destino = $('[name=cod_producto_sunat]', f);
  let temporizador = null;
  let turno = 0;

  $('#btn-sunat-buscar', f).addEventListener('click', () => {
    caja.hidden = !caja.hidden;
    if (!caja.hidden) {
      q.value = q.value || $('[name=descripcion]', f).value.split(' ')[0] || '';
      q.focus();
      if (q.value.length >= 3) buscar();
    }
  });

  const buscar = async () => {
    const texto = q.value.trim();
    if (texto.length < 3) { res.innerHTML = '<p class="muted small">Escribe al menos 3 letras o números.</p>'; return; }
    const mio = ++turno;
    res.innerHTML = '<p class="muted small">Buscando…</p>';
    try {
      const r = await api.productoSunat(texto);
      if (mio !== turno) return;
      const items = comoLista(r.datos).slice(0, 30);
      if (!items.length) { res.innerHTML = '<p class="muted small">Sin resultados.</p>'; return; }
      res.innerHTML = items.map(it => {
        const codigo = it.codigo ?? it.code ?? it.id ?? '';
        const desc = it.descripcion ?? it.description ?? it.nombre ?? '';
        return `<button type="button" class="result" data-codigo="${esc(codigo)}"><code>${esc(codigo)}</code><span>${esc(desc)}</span></button>`;
      }).join('');
    } catch (e) {
      if (mio !== turno) return;
      res.innerHTML = `<p class="text-danger small">${esc(e.message)}</p>`;
    }
  };

  q.addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(buscar, 350); });
  q.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); clearTimeout(temporizador); buscar(); } });
  res.addEventListener('click', ev => {
    const b = ev.target.closest('[data-codigo]');
    if (!b) return;
    destino.value = b.dataset.codigo;
    caja.hidden = true;
    toast(`Código SUNAT ${b.dataset.codigo} asignado.`, 'ok', 2500);
  });
}

function gestionarCategorias(alCambiar) {
  const pintar = () => {
    const cats = store.todos('categorias');
    const uso = id => store.donde('productos', p => p.categoria_id === id).length;
    $('#cat-lista', d).innerHTML = cats.map(c => `
      <li class="cat-row">
        <input value="${esc(c.nombre)}" data-cat-nombre="${c.id}" aria-label="Nombre de categoría" maxlength="40">
        <span class="muted small">${uso(c.id)}</span>
        <button class="icon-btn" type="button" data-cat-borrar="${c.id}" aria-label="Eliminar ${esc(c.nombre)}" ${uso(c.id) ? 'disabled title="Tiene productos"' : ''}>×</button>
      </li>`).join('');
  };

  const d = modal({
    titulo: 'Categorías',
    contenido: `
      <p class="muted small">El número es la cantidad de productos. Solo se eliminan categorías vacías.</p>
      <ul class="cat-list" id="cat-lista"></ul>
      <div class="input-group">
        <input id="cat-nueva" placeholder="Nueva categoría" maxlength="40">
        <button class="btn" type="button" id="btn-cat-add">Agregar</button>
      </div>`,
    acciones: '<button class="btn btn-primary" value="ok">Listo</button>'
  });
  pintar();

  const agregar = () => {
    const nombre = $('#cat-nueva', d).value.trim();
    if (!nombre) return;
    if (store.todos('categorias').some(c => norm(c.nombre) === norm(nombre))) return toast('Esa categoría ya existe.', 'warn');
    store.insertar('categorias', { nombre });
    $('#cat-nueva', d).value = '';
    pintar();
  };
  $('#btn-cat-add', d).addEventListener('click', agregar);
  $('#cat-nueva', d).addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); agregar(); } });

  $('#cat-lista', d).addEventListener('change', ev => {
    const i = ev.target.closest('[data-cat-nombre]');
    if (!i) return;
    const nombre = i.value.trim();
    const id = Number(i.dataset.catNombre);
    if (!nombre || store.todos('categorias').some(c => c.id !== id && norm(c.nombre) === norm(nombre))) {
      toast('Nombre vacío o repetido.', 'warn');
      return pintar();
    }
    store.actualizar('categorias', id, { nombre });
  });
  $('#cat-lista', d).addEventListener('click', ev => {
    const b = ev.target.closest('[data-cat-borrar]');
    if (!b || b.disabled) return;
    store.eliminar('categorias', Number(b.dataset.catBorrar));
    pintar();
  });
  d.addEventListener('close', alCambiar, { once: true });
}
