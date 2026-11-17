// Clientes: copia local para el POS, sincronizada con /clientes de la API.
// La copia local manda en el punto de venta; la API recibe cada alta o cambio.
import { store } from '../store.js';
import { auth } from '../auth.js';
import { api, comoLista, hayMasPaginas, metaDe } from '../api.js';
import { TIPOS_DOC, nombreTipoDoc, errorDocumento, esEmail, norm } from '../validar.js';
import {
  esc, $, $$, toast, toastError, modal, cerrarModal, confirmar,
  campo, selector, vacioMsg, conCarga, tablaLocal
} from '../ui.js';

const filtros = { q: '', tipo: 'todos' };

// ---------- Mapeo con la API ----------
export function aApi(c) {
  const d = {
    tipo_documento: c.tipo_doc,
    numero_documento: c.num_doc,
    razon_social: c.razon_social
  };
  for (const k of ['nombre_comercial', 'direccion', 'email', 'telefono']) if (c[k]) d[k] = c[k];
  return d;
}

export function deApi(x) {
  return {
    tipo_doc: String(x.tipo_documento ?? x.tipo_doc ?? ''),
    num_doc: String(x.numero_documento ?? x.num_doc ?? ''),
    razon_social: x.razon_social ?? x.nombre ?? '',
    nombre_comercial: x.nombre_comercial || '',
    direccion: x.direccion || '',
    email: x.email || '',
    telefono: x.telefono || '',
    api_id: x.id ?? null
  };
}

const clave = c => `${c.tipo_doc}|${String(c.num_doc).toUpperCase()}`;

export function buscarClientes(q, lista = store.todos('clientes')) {
  const t = norm(q).trim();
  if (!t) return lista;
  const partes = t.split(/\s+/);
  return lista.filter(c => {
    const texto = norm(`${c.num_doc} ${c.razon_social} ${c.nombre_comercial} ${c.mascota} ${c.telefono}`);
    return partes.every(x => texto.includes(x));
  });
}

export function clientePorDocumento(tipo, num) {
  return store.todos('clientes').find(c => clave(c) === `${tipo}|${String(num).trim().toUpperCase()}`) || null;
}

// Valida y normaliza. Devuelve { error } o { datos }.
export function validarCliente(entrada, actual = null) {
  const d = {
    tipo_doc: String(entrada.tipo_doc || ''),
    num_doc: String(entrada.num_doc || '').trim().toUpperCase(),
    razon_social: String(entrada.razon_social || '').trim().replace(/\s+/g, ' ').toUpperCase(),
    nombre_comercial: String(entrada.nombre_comercial || '').trim(),
    direccion: String(entrada.direccion || '').trim(),
    email: String(entrada.email || '').trim().toLowerCase(),
    telefono: String(entrada.telefono || '').trim(),
    mascota: String(entrada.mascota || '').trim()
  };
  const errDoc = errorDocumento(d.tipo_doc, d.num_doc);
  if (errDoc) return { error: errDoc };
  if (d.razon_social.length < 2) return { error: d.tipo_doc === '6' ? 'Escribe la razón social.' : 'Escribe el nombre completo.' };
  if (d.razon_social.length > 200) return { error: 'El nombre no puede pasar de 200 caracteres.' };
  if (d.email && !esEmail(d.email)) return { error: 'El correo no es válido.' };
  if (d.telefono && !/^[+\d\s()-]{6,20}$/.test(d.telefono)) return { error: 'El teléfono no es válido.' };
  const otro = clientePorDocumento(d.tipo_doc, d.num_doc);
  if (otro && otro.id !== actual?.id) return { error: `Ya existe un cliente con ${nombreTipoDoc(d.tipo_doc)} ${d.num_doc}: ${otro.razon_social}.` };
  if (d.tipo_doc !== '6') d.nombre_comercial = '';
  return { datos: d };
}

// Envía el cliente a la API. Nunca lanza: deja la marca pendiente_sync si falla.
export async function sincronizarCliente(c) {
  try {
    let apiId = c.api_id;
    if (apiId) {
      await api.actualizarCliente(apiId, aApi(c));
    } else {
      try {
        const r = await api.crearCliente(aApi(c));
        apiId = r.datos?.id ?? r.datos?.cliente?.id ?? null;
      } catch (e) {
        // Si ya existía en la API, se enlaza en vez de duplicar.
        if (e.status !== 422 && e.status !== 409) throw e;
        const encontrado = await buscarEnApi(c);
        if (!encontrado) throw e;
        apiId = encontrado.id;
        await api.actualizarCliente(apiId, aApi(c));
      }
    }
    return store.actualizar('clientes', c.id, { api_id: apiId, pendiente_sync: false, error_sync: null });
  } catch (e) {
    store.actualizar('clientes', c.id, { pendiente_sync: true, error_sync: e.message });
    return null;
  }
}

async function buscarEnApi(c) {
  const r = await api.clientes({ buscar: c.num_doc });
  return comoLista(r.datos).map(x => ({ ...deApi(x), id: x.id }))
    .find(x => clave(x) === clave(c)) || null;
}

// Guarda local + API. Devuelve el cliente local.
export async function guardarCliente(entrada, actual = null) {
  const { error, datos } = validarCliente(entrada, actual);
  if (error) throw new Error(error);
  const local = actual
    ? store.actualizar('clientes', actual.id, { ...datos, pendiente_sync: true })
    : store.insertar('clientes', { ...datos, api_id: null, pendiente_sync: true });
  const sync = await sincronizarCliente(local);
  return { cliente: store.buscar('clientes', local.id), sincronizado: Boolean(sync) };
}

// ---------- Formulario (reutilizable desde el punto de venta) ----------
export function formCliente({ cliente = null, inicial = {}, alGuardar = () => {} } = {}) {
  const c = cliente || inicial;
  const tipo = String(c.tipo_doc || '1');
  const usado = cliente && store.donde('ventas', v => v.cliente_id === cliente.id).length > 0;

  const d = modal({
    titulo: cliente ? 'Editar cliente' : 'Nuevo cliente',
    contenido: `
      <div class="form-grid" id="f-cli">
        ${selector({ nombre: 'tipo_doc', etiqueta: 'Tipo de documento', opciones: TIPOS_DOC, valor: tipo, req: true })}
        ${campo({ nombre: 'num_doc', etiqueta: 'Número', valor: c.num_doc, req: true, attrs: 'autocomplete="off" maxlength="15"' })}
        ${campo({ nombre: 'razon_social', etiqueta: 'Nombre completo', valor: c.razon_social, req: true, attrs: 'maxlength="200"' })}
        <div id="nc-box">${campo({ nombre: 'nombre_comercial', etiqueta: 'Nombre comercial', valor: c.nombre_comercial })}</div>
        ${campo({ nombre: 'direccion', etiqueta: 'Dirección', valor: c.direccion, ayuda: 'Recomendada para facturas.' })}
        ${campo({ nombre: 'telefono', etiqueta: 'Teléfono / WhatsApp', valor: c.telefono, tipo: 'tel', attrs: 'inputmode="tel"' })}
        ${campo({ nombre: 'email', etiqueta: 'Correo', valor: c.email, tipo: 'email', attrs: 'inputmode="email" autocapitalize="none"' })}
        ${campo({ nombre: 'mascota', etiqueta: 'Mascota (opcional)', valor: c.mascota, ayuda: 'Solo referencia interna, no va al comprobante.' })}
        <p class="form-error span-all" id="cli-error" role="alert"></p>
      </div>
      <p class="muted small">No hay consulta automática RENIEC/SUNAT: escribe el nombre como figura en el documento.</p>`,
    acciones: `
      ${cliente && auth.esAdmin() ? `<button class="btn btn-ghost-danger" type="button" id="btn-cli-borrar" ${usado ? 'disabled title="Tiene ventas registradas"' : ''}>Eliminar</button>` : ''}
      <span class="spacer"></span>
      <button class="btn" value="cancelar">Cancelar</button>
      <button class="btn btn-primary" value="ok" id="btn-cli-ok">Guardar</button>`
  });

  const f = $('#f-cli', d);
  const v = n => $(`[name=${n}]`, f);
  const error = $('#cli-error', d);

  const ajustarTipo = () => {
    const t = v('tipo_doc').value;
    $('#nc-box', f).hidden = t !== '6';
    v('razon_social').closest('.field').querySelector('.field-label').firstChild.textContent = t === '6' ? 'Razón social' : 'Nombre completo';
    const num = v('num_doc');
    num.inputMode = ['1', '6'].includes(t) ? 'numeric' : 'text';
    num.maxLength = t === '1' ? 8 : t === '6' ? 11 : 15;
    num.placeholder = t === '1' ? '8 dígitos' : t === '6' ? '11 dígitos' : '';
  };
  v('tipo_doc').addEventListener('change', () => { ajustarTipo(); error.textContent = ''; });
  v('num_doc').addEventListener('blur', () => {
    const msg = errorDocumento(v('tipo_doc').value, v('num_doc').value);
    error.textContent = v('num_doc').value && msg ? msg : '';
  });
  ajustarTipo();

  $('#btn-cli-ok', d).addEventListener('click', ev => {
    ev.preventDefault();
    const entrada = {};
    $$('input, select', f).forEach(i => { entrada[i.name] = i.value; });
    const { error: msg } = validarCliente(entrada, cliente);
    if (msg) { error.textContent = msg; return; }
    conCarga(ev.currentTarget, async () => {
      try {
        const r = await guardarCliente(entrada, cliente);
        cerrarModal();
        toast(r.sincronizado
          ? (cliente ? 'Cliente actualizado.' : 'Cliente registrado.')
          : 'Cliente guardado en el sistema. No se pudo enviar a la API; se reintentará con "Sincronizar".', r.sincronizado ? 'ok' : 'warn', 6000);
        alGuardar(r.cliente);
      } catch (e) { error.textContent = e.message; }
    });
  });

  $('#btn-cli-borrar', d)?.addEventListener('click', async () => {
    cerrarModal();
    if (!await confirmar('Eliminar cliente', `¿Eliminar a ${cliente.razon_social}? También se eliminará en la API.`, 'Eliminar', true)) return;
    try {
      if (cliente.api_id) await api.eliminarCliente(cliente.api_id).catch(e => { if (e.status !== 404) throw e; });
      store.eliminar('clientes', cliente.id);
      toast('Cliente eliminado.', 'ok');
      alGuardar(null);
    } catch (e) { toastError(e); }
  });

  (cliente ? v('razon_social') : v('num_doc')).focus();
  return d;
}

// ---------- Vista ----------
export async function vistaClientes(cont) {
  const admin = auth.esAdmin();
  cont.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Clientes</h1>
      <div class="row-actions">
        ${admin ? '<button class="btn" id="btn-cli-importar" type="button">Traer de la API</button>' : ''}
        <button class="btn btn-primary" id="btn-cli-nuevo" type="button">Nuevo cliente</button>
      </div>
    </div>
    <div class="toolbar">
      <input type="search" id="cli-q" placeholder="Buscar por nombre, documento, teléfono o mascota" value="${esc(filtros.q)}" aria-label="Buscar clientes">
      <select id="cli-tipo" aria-label="Tipo de documento">
        ${[['todos', 'Todos'], ['1', 'DNI'], ['6', 'RUC'], ['otros', 'Otros']].map(([v, t]) =>
          `<option value="${v}" ${filtros.tipo === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>
    <div id="cli-sync"></div>
    <div id="cli-lista"></div>`;

  const pintar = () => pintarClientes(cont);
  $('#cli-q', cont).addEventListener('input', ev => { filtros.q = ev.target.value; pintar(); });
  $('#cli-tipo', cont).addEventListener('change', ev => { filtros.tipo = ev.target.value; pintar(); });
  $('#btn-cli-nuevo', cont).addEventListener('click', () => formCliente({ alGuardar: pintar }));
  $('#btn-cli-importar', cont)?.addEventListener('click', ev => importarDesdeApi(ev.currentTarget, pintar));
  pintar();
}

function pintarClientes(cont) {
  const todos = store.todos('clientes');
  const pendientes = todos.filter(c => c.pendiente_sync || !c.api_id);

  $('#cli-sync', cont).innerHTML = pendientes.length ? `
    <div class="notice notice-row">
      <span>${pendientes.length} cliente(s) sin enviar a la API.</span>
      <button class="btn btn-sm" type="button" id="btn-cli-sync">Sincronizar</button>
    </div>` : '';
  $('#btn-cli-sync', cont)?.addEventListener('click', ev => conCarga(ev.currentTarget, async () => {
    let ok = 0;
    for (const c of pendientes) if (await sincronizarCliente(store.buscar('clientes', c.id))) ok++;
    toast(`${ok} de ${pendientes.length} sincronizados.`, ok === pendientes.length ? 'ok' : 'warn');
    pintarClientes(cont);
  }));

  let lista = todos;
  if (filtros.tipo === '1' || filtros.tipo === '6') lista = lista.filter(c => c.tipo_doc === filtros.tipo);
  if (filtros.tipo === 'otros') lista = lista.filter(c => !['1', '6'].includes(c.tipo_doc));
  lista = buscarClientes(filtros.q, lista).sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es'));

  const caja = $('#cli-lista', cont);
  if (!todos.length) {
    caja.innerHTML = `<div class="vacio">
      <p><strong>Aún no hay clientes.</strong></p>
      <p class="muted">Regístralos aquí o al momento de vender. Para boletas menores a S/ 700 no hace falta registrar al cliente.</p>
    </div>`;
    return;
  }
  const editar = c => formCliente({ cliente: store.buscar('clientes', c.id), alGuardar: () => pintarClientes(cont) });
  tablaLocal(caja, {
    filas: lista,
    clave: `${filtros.tipo}|${filtros.q}`,
    vacio: 'Ningún cliente coincide con la búsqueda.',
    alElegir: editar,
    columnas: [
      { titulo: 'Cliente', celda: c => `<strong>${esc(c.razon_social)}</strong>${c.nombre_comercial ? `<span class="sub">${esc(c.nombre_comercial)}</span>` : ''}` },
      { titulo: 'Documento', clase: 'nw', celda: c => `${esc(nombreTipoDoc(c.tipo_doc))}<span class="sub font-id">${esc(c.num_doc)}</span>` },
      { titulo: 'Mascota', sec: true, celda: c => esc(c.mascota || '') },
      { titulo: 'Teléfono', sec: true, clase: 'nw', celda: c => (c.telefono ? `<span class="font-id">${esc(c.telefono)}</span>` : '') },
      { titulo: 'Correo', sec: true, celda: c => esc(c.email || '') },
      { titulo: 'API', sec: true, celda: c => (c.pendiente_sync || !c.api_id
        ? `<span class="pill pill-warn" title="${esc(c.error_sync || '')}">Sin sincronizar</span>`
        : '<span class="pill pill-ok">Sincronizado</span>') },
      { titulo: '', clase: 'col-acciones', celda: c => `<button class="btn btn-sm" type="button" data-cli="${c.id}">Editar</button>` }
    ],
    alPintar: caja => $$('[data-cli]', caja).forEach(b => b.addEventListener('click', () => editar({ id: Number(b.dataset.cli) })))
  });
}

// Trae los clientes de la API y los fusiona por tipo + número de documento.
async function importarDesdeApi(boton, alTerminar) {
  await conCarga(boton, async () => {
    let pagina = 1, nuevos = 0, enlazados = 0, leidos = 0;
    try {
      for (; pagina <= 50; pagina++) {
        const r = await api.clientes({ por_pagina: 100, page: pagina });
        const items = comoLista(r.datos);
        leidos += items.length;
        for (const x of items) {
          const c = deApi(x);
          if (!c.tipo_doc || !c.num_doc) continue;
          const local = clientePorDocumento(c.tipo_doc, c.num_doc);
          if (local) {
            const cambios = { api_id: c.api_id, pendiente_sync: false };
            for (const k of ['razon_social', 'nombre_comercial', 'direccion', 'email', 'telefono']) if (!local[k] && c[k]) cambios[k] = c[k];
            store.actualizar('clientes', local.id, cambios);
            enlazados++;
          } else {
            store.insertar('clientes', { ...c, mascota: '', pendiente_sync: false });
            nuevos++;
          }
        }
        if (!items.length || !hayMasPaginas(metaDe(r), pagina)) break;
      }
      toast(`Leídos ${leidos}: ${nuevos} nuevos, ${enlazados} enlazados con clientes existentes.`, 'ok', 6000);
      alTerminar();
    } catch (e) { toastError(e); }
  });
}
