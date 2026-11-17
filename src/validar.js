// Validaciones compartidas y catálogos SUNAT usados por el sistema.

// Catálogo 06: tipo de documento de identidad.
export const TIPOS_DOC = [
  ['1', 'DNI'],
  ['6', 'RUC'],
  ['4', 'Carnet de extranjería'],
  ['7', 'Pasaporte'],
  ['A', 'Cédula diplomática'],
  ['0', 'Otros / sin documento']
];

export const nombreTipoDoc = t => (TIPOS_DOC.find(x => x[0] === String(t)) || [t, t])[1];

// Catálogo 07 (subconjunto útil para el rubro): afectación del IGV.
export const AFECTACIONES = [
  ['10', 'Gravado (IGV)'],
  ['20', 'Exonerado'],
  ['30', 'Inafecto']
];

// Catálogo 03 (subconjunto): unidades de medida.
export const UNIDADES = [
  ['NIU', 'Unidad (bienes)'],
  ['ZZ', 'Servicio'],
  ['KGM', 'Kilogramo'],
  ['GRM', 'Gramo'],
  ['LTR', 'Litro'],
  ['MLT', 'Mililitro'],
  ['BX', 'Caja'],
  ['BG', 'Bolsa'],
  ['PK', 'Paquete'],
  ['BO', 'Botella'],
  ['DZN', 'Docena']
];

export function validarRuc(ruc) {
  ruc = String(ruc || '');
  if (!/^(10|15|17|20)\d{9}$/.test(ruc)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(ruc[i]), 0);
  const dv = (11 - (suma % 11)) % 10;
  return dv === Number(ruc[10]);
}

// Devuelve un mensaje de error o null si el documento es válido.
export function errorDocumento(tipo, numero) {
  const n = String(numero || '').trim();
  switch (String(tipo)) {
    case '1': return /^\d{8}$/.test(n) ? null : 'El DNI debe tener 8 dígitos.';
    case '6': return validarRuc(n) ? null : 'RUC inválido: 11 dígitos, empieza con 10, 15, 17 o 20 y dígito verificador correcto.';
    case '4': return /^[A-Za-z0-9]{8,12}$/.test(n) ? null : 'El carnet de extranjería tiene de 8 a 12 caracteres.';
    case '7': return /^[A-Za-z0-9]{5,12}$/.test(n) ? null : 'El pasaporte tiene de 5 a 12 caracteres.';
    case 'A': return /^[A-Za-z0-9]{3,15}$/.test(n) ? null : 'Cédula diplomática inválida.';
    case '0': return n ? null : 'Escribe un número o identificador.';
    default: return 'Tipo de documento inválido.';
  }
}

export const esEmail = v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || ''));

// Redondeo monetario a 2 decimales sin errores de coma flotante.
export const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const soles = n => `S/ ${r2(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Normaliza texto para búsquedas (sin tildes, minúsculas).
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
