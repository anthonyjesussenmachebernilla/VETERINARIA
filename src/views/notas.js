// Emisión de notas de crédito (07) y débito (08) sobre un comprobante aceptado.
import { store } from '../store.js';
import { auth } from '../auth.js';
import { soles, r2, AFECTACIONES, UNIDADES } from '../validar.js';
import { esc, $, $$, toast, toastError, confirmar, conCarga, selector, campo } from '../ui.js';
import { TIPOS_CPE, TIPO_POR_RUTA, detalleDesdeApi, verComprobante } from '../comprobantes.js';
import {
  MOTIVOS_NC, MOTIVOS_ND, MOTIVOS_NC_TOTAL, serieNota, totalNcPrevias, totalItems, validarNota, emitirNota
} from '../tributario.js';

export async function vistaNota(cont, ruta, apiId, clase) {
  const tipoNota = clase === 'nota-credito' ? '07' : '08';
  const nombre = TIPOS_CPE[tipoNota].nombre;
  cont.innerHTML = `<a class="back-link" href="#/comprobantes/${ruta}/${esc(apiId)}">← Volver al comprobante</a><div id="nota"><p class="loading">Consultando el comprobante…</p></div>`;
  const caja = $('#nota', cont);

  if (!auth.esAdmin()) { caja.innerHTML = '<div class="notice notice-error">Solo el administrador emite notas.</div>'; return; }
  if (store.config().tax_regime === 'rus') { caja.innerHTML = '<div class="notice notice-error">En Nuevo RUS no se emiten notas de crédito ni de débito.</div>'; return; }

  let info;
  try { info = await detalleDesdeApi(ruta, apiId); } catch (e) {
    caja.innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
    return;
  }
  const f = info.fila;
  const origen = { tipo: TIPO_POR_RUTA[ruta], serie: f.serie, correlativo: f.correlativo, api_id: f.api_id ?? apiId, sunat_status: f.sunat_status, total_oficial: f.total_oficial, cliente: f.cliente, fecha_emision: f.fecha_emision };
  if (!['aceptado', 'observado'].includes(origen.sunat_status)) {
    caja.innerHTML = '<div class="notice notice-error">Solo se emiten notas sobre comprobantes aceptados por SUNAT.</div>';
    return;
  }
  const previas = tipoNota === '07' ? totalNcPrevias(origen.tipo, origen.api_id) : 0;
  const saldo = origen.total_oficial != null ? r2(origen.total_oficial - previas) : null;
  const motivos = tipoNota === '07' ? MOTIVOS_NC : MOTIVOS_ND;

  // Estado del formulario.
  const estado = {
    motivo: motivos[0][0],
    descripcion: motivos[0][1],
    serie: serieNota(tipoNota, origen.serie) || '',
    devolver: true,
    items: tipoNota === '07'
      ? info.items.map(it => ({ ...it, incluir: true, max: it.cantidad }))
      : [{ codigo: '', descripcion: '', unidad: 'ZZ', cantidad: 1, precio_unitario: '', tip_afe_igv: info.items[0]?.tip_afe_igv || '10', incluir: true }]
  };

  const pintar = () => {
    const total = estado.motivo && MOTIVOS_NC_TOTAL.includes(estado.motivo) && tipoNota === '07';
    if (total) estado.items.forEach(it => { it.incluir = true; it.cantidad = it.max; });
    const elegidos = estado.items.filter(it => it.incluir);
    const monto = totalItems(elegidos.map(it => ({ ...it, precio_unitario: Number(it.precio_unitario) || 0, cantidad: Number(it.cantidad) || 0 })));

    caja.innerHTML = `
      <h1 class="page-title">${esc(nombre)}</h1>
      <section class="panel">
        <dl class="kv">
          <div><dt>Comprobante afectado</dt><dd>${esc(TIPOS_CPE[origen.tipo].nombre)} ${esc(origen.serie)}-${esc(origen.correlativo)}</dd></div>
          <div><dt>Cliente</dt><dd>${esc(origen.cliente.razon_social)}</dd></div>
          <div><dt>Total del comprobante</dt><dd>${origen.total_oficial != null ? soles(origen.total_oficial) : '—'}</dd></div>
          ${tipoNota === '07' ? `<div><dt>Saldo disponible</dt><dd>${saldo != null ? soles(saldo) : '—'}${previas ? ` <span class="muted small">(NC previas ${soles(previas)})</span>` : ''}</dd></div>` : ''}
        </dl>
      </section>

      <section class="panel">
        <div class="form-grid">
          ${selector({ nombre: 'motivo', etiqueta: 'Motivo', opciones: motivos, valor: estado.motivo, req: true })}
          ${campo({ nombre: 'serie', etiqueta: 'Serie de la nota', valor: estado.serie, req: true, attrs: 'maxlength="4"', ayuda: `Debe empezar con ${String(origen.serie).startsWith('F') ? 'F' : 'B'}.` })}
          ${campo({ nombre: 'descripcion', etiqueta: 'Descripción del motivo', valor: estado.descripcion, req: true, attrs: 'maxlength="250"' })}
        </div>
      </section>

      <section class="panel">
        <h2>${tipoNota === '07' ? 'Ítems a devolver o rebajar' : 'Conceptos a cobrar'}</h2>
        ${total ? '<p class="muted small">Este motivo afecta el comprobante completo: van todos los ítems.</p>' : ''}
        ${tipoNota === '07' && !estado.items.length ? '<p class="notice">La API no devolvió los ítems del comprobante. Agrégalos manualmente.</p>' : ''}
        <div id="nota-items">
          ${estado.items.map((it, i) => tipoNota === '07' && it.max != null ? `
            <div class="nota-item ${it.incluir ? '' : 'is-off'}">
              <label class="check"><input type="checkbox" data-incluir="${i}" ${it.incluir ? 'checked' : ''} ${total ? 'disabled' : ''}> <strong>${esc(it.descripcion)}</strong></label>
              <div class="corr-row">
                <label class="field"><span class="field-label">Cant. (máx. ${esc(it.max)})</span><input type="number" data-cant="${i}" value="${esc(it.cantidad)}" min="0" max="${esc(it.max)}" step="any" ${total || !it.incluir ? 'disabled' : ''}></label>
                <label class="field"><span class="field-label">Precio c/IGV</span><input type="number" data-precio="${i}" value="${esc(it.precio_unitario)}" min="0" step="0.0001" ${total || !it.incluir ? 'disabled' : ''}></label>
              </div>
            </div>` : `
            <div class="nota-item">
              <div class="corr-row corr-row-nd">
                <label class="field span-2"><span class="field-label">Concepto</span><input data-desc="${i}" value="${esc(it.descripcion)}" maxlength="250" placeholder="${tipoNota === '08' ? 'Ej.: Intereses por pago fuera de plazo' : 'Descripción'}"></label>
                <label class="field"><span class="field-label">Cant.</span><input type="number" data-cant="${i}" value="${esc(it.cantidad)}" min="0" step="any"></label>
                <label class="field"><span class="field-label">Precio c/IGV</span><input type="number" data-precio="${i}" value="${esc(it.precio_unitario)}" min="0" step="0.01"></label>
                ${selector({ nombre: `afe-${i}`, etiqueta: 'IGV', opciones: AFECTACIONES, valor: it.tip_afe_igv })}
                ${selector({ nombre: `uni-${i}`, etiqueta: 'Unidad', opciones: UNIDADES, valor: it.unidad })}
              </div>
              ${estado.items.length > 1 ? `<button class="link-btn text-danger" type="button" data-quitar="${i}">Quitar</button>` : ''}
            </div>`).join('')}
        </div>
        ${tipoNota === '08' || !info.items.length ? '<button class="link-btn" type="button" id="nota-add">+ Agregar concepto</button>' : ''}
        ${tipoNota === '07' && ['01', '06', '07'].includes(estado.motivo) ? `
          <label class="check nota-stock"><input type="checkbox" id="nota-devolver" ${estado.devolver ? 'checked' : ''}> Devolver los productos al stock</label>` : ''}
        <dl class="totals"><div class="total-row"><dt>Total de la nota</dt><dd>${soles(monto)}</dd></div></dl>
        <p class="form-error" id="nota-error" role="alert"></p>
        <button class="btn btn-primary btn-block btn-lg" type="button" id="btn-nota">Emitir ${esc(nombre.toLowerCase())}</button>
      </section>`;
    conectar();
  };

  const conectar = () => {
    const sel = $('[name=motivo]', caja);
    sel.addEventListener('change', () => {
      estado.motivo = sel.value;
      estado.descripcion = motivos.find(m => m[0] === sel.value)[1];
      pintar();
    });
    $('[name=serie]', caja).addEventListener('input', ev => { estado.serie = ev.target.value.trim().toUpperCase(); });
    $('[name=descripcion]', caja).addEventListener('input', ev => { estado.descripcion = ev.target.value; });
    $$('[data-quitar]', caja).forEach(b => b.addEventListener('click', () => { estado.items.splice(Number(b.dataset.quitar), 1); pintar(); }));
    $('#nota-add', caja)?.addEventListener('click', () => {
      estado.items.push({ codigo: '', descripcion: '', unidad: 'ZZ', cantidad: 1, precio_unitario: '', tip_afe_igv: '10', incluir: true });
      pintar();
    });

    $('#btn-nota', caja).addEventListener('click', async ev => {
      const err = $('#nota-error', caja);
      err.textContent = '';
      const items = estado.items.filter(it => it.incluir).map(it => ({
        codigo: it.codigo, descripcion: it.descripcion, unidad: it.unidad, tip_afe_igv: it.tip_afe_igv,
        cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario)
      }));
      for (const it of estado.items.filter(x => x.incluir && x.max != null)) {
        if (Number(it.cantidad) > it.max) { err.textContent = `La cantidad de "${it.descripcion}" supera la vendida (${it.max}).`; return; }
      }
      const datos = { tipoNota, origen, motivo: estado.motivo, descripcion: estado.descripcion, items, serie: estado.serie };
      const msg = validarNota(datos);
      if (msg) { err.textContent = msg; return; }
      const ok = await confirmar(`Emitir ${nombre.toLowerCase()}`,
        `${nombre} por ${soles(totalItems(items))} sobre ${origen.serie}-${origen.correlativo}. Es un documento tributario y no se puede editar una vez aceptado.`, 'Emitir');
      if (!ok) return;
      await conCarga(ev.currentTarget, async () => {
        try {
          const nota = await emitirNota(datos, { devolverStock: tipoNota === '07' && estado.devolver && ['01', '06', '07'].includes(estado.motivo) });
          location.hash = nota.api_id ? `#/comprobantes/${TIPOS_CPE[tipoNota].ruta}/${nota.api_id}` : `#/comprobantes/${ruta}/${apiId}`;
          // Emitida: el PDF se abre de inmediato, listo para imprimir.
          if (!verComprobante(nota)) toast(`${nombre} registrada en la API. Esperando respuesta de SUNAT.`, 'ok');
        } catch (e) {
          err.textContent = [e.message, ...(e.detalle?.() || [])].join('\n');
          toastError(e);
        }
      });
    });
  };

  caja.addEventListener('change', ev => {
    const t = ev.target;
    if (t.dataset.incluir !== undefined) { estado.items[Number(t.dataset.incluir)].incluir = t.checked; pintar(); }
    if (t.id === 'nota-devolver') estado.devolver = t.checked;
    const m = /^(afe|uni)-(\d+)$/.exec(t.name || '');
    if (m) estado.items[Number(m[2])][m[1] === 'afe' ? 'tip_afe_igv' : 'unidad'] = t.value;
  });
  caja.addEventListener('input', ev => {
    const t = ev.target;
    if (t.dataset.cant !== undefined) estado.items[Number(t.dataset.cant)].cantidad = t.value;
    else if (t.dataset.precio !== undefined) estado.items[Number(t.dataset.precio)].precio_unitario = t.value;
    else if (t.dataset.desc !== undefined) estado.items[Number(t.dataset.desc)].descripcion = t.value;
    else return;
    const elegidos = estado.items.filter(it => it.incluir);
    $('.total-row dd', caja).textContent = soles(totalItems(elegidos.map(it => ({ cantidad: Number(it.cantidad) || 0, precio_unitario: Number(it.precio_unitario) || 0 }))));
  });

  pintar();
}
