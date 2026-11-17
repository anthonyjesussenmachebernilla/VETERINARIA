// Cifrado con la Web Crypto API del navegador (disponible al abrir con doble clic: file:// es contexto seguro).
//  - Contraseñas: PBKDF2-SHA256 con 600 000 vueltas (recomendación OWASP). De una sola derivación salen
//    el verificador que se guarda y una llave para abrir la bóveda, que nunca se guarda.
//  - Datos: AES-GCM de 256 bits (cifra y detecta cualquier alteración).

export const VUELTAS = 600000;
const sutil = () => {
  if (!globalThis.crypto?.subtle) throw new Error('Este navegador no permite cifrar. Usa Chrome, Edge o Firefox actualizados.');
  return globalThis.crypto.subtle;
};

export const aB64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const deB64 = txt => Uint8Array.from(atob(txt), c => c.charCodeAt(0));
const aHex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

export function aleatorio(n) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

// Compara sin cortar en la primera diferencia (no revela cuántos caracteres coinciden).
export function igualSeguro(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

// Deriva 64 bytes de la contraseña: los 32 primeros verifican, los 32 últimos abren la bóveda.
export async function derivar(clave, salB64, vueltas = VUELTAS) {
  const base = await sutil().importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await sutil().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deB64(salB64), iterations: vueltas }, base, 512));
  const llave = await sutil().importKey('raw', bits.slice(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { verificador: aHex(bits.slice(0, 32)), llave };
}

export const importarLlave = bytes => sutil().importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function cifrar(llave, bytes) {
  const iv = aleatorio(12);
  const ct = await sutil().encrypt({ name: 'AES-GCM', iv }, llave, bytes);
  return { iv: aB64(iv), ct: aB64(ct) };
}

export async function descifrar(llave, sobre) {
  const pt = await sutil().decrypt({ name: 'AES-GCM', iv: deB64(sobre.iv) }, llave, deB64(sobre.ct));
  return new Uint8Array(pt);
}

export const cifrarJson = (llave, obj) => cifrar(llave, new TextEncoder().encode(JSON.stringify(obj)));
export const descifrarJson = async (llave, sobre) => JSON.parse(new TextDecoder().decode(await descifrar(llave, sobre)));

// Archivo cifrado con una contraseña (respaldos de data.json).
export const FORMATO_RESPALDO = 'veterinaria-respaldo-cifrado';

export async function cifrarConContrasena(obj, clave) {
  const sal = aB64(aleatorio(16));
  const { llave } = await derivar(clave, sal);
  return { formato: FORMATO_RESPALDO, version: 1, kdf: { alg: 'PBKDF2-SHA256', vueltas: VUELTAS, sal }, cifrado: 'AES-256-GCM', ...(await cifrarJson(llave, obj)) };
}

export async function descifrarConContrasena(sobre, clave) {
  const { llave } = await derivar(clave, sobre.kdf.sal, sobre.kdf.vueltas);
  try {
    return await descifrarJson(llave, sobre);
  } catch {
    throw new Error('Contraseña incorrecta o archivo dañado.');
  }
}
