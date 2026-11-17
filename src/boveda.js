// Bóveda: guarda cifradas las credenciales de la API (URL, key y secret).
// Una llave maestra aleatoria (AES-256) cifra las credenciales; esa llave se guarda "envuelta"
// una vez por usuario con la llave que sale de su contraseña. Sin la contraseña de algún usuario,
// las credenciales no se pueden leer: ni en este navegador ni en un data.json copiado.
// La bóveda viaja dentro de data.json (configuracion.boveda), siempre cifrada.
import { store } from './store.js';
import { aB64, deB64, aleatorio, importarLlave, cifrar, descifrar, cifrarJson, descifrarJson } from './cripto.js';

const CLAVE_SESION = 'veterinaria.llave'; // llave maestra de la sesión abierta (se borra al cerrar la pestaña)
let credenciales = null;                   // credenciales descifradas, solo en memoria

const leerB = () => store.config().boveda || null;
const escribirB = b => store.setConfig({ boveda: b });

function llaveSesion() {
  try { const t = sessionStorage.getItem(CLAVE_SESION); return t ? deB64(t) : null; } catch { return null; }
}
function guardarLlaveSesion(bytes) {
  try { bytes ? sessionStorage.setItem(CLAVE_SESION, aB64(bytes)) : sessionStorage.removeItem(CLAVE_SESION); } catch { /* solo memoria */ }
}

export const boveda = {
  existe: () => Boolean(leerB()),
  abierta: () => Boolean(llaveSesion()),
  tieneCredenciales: () => Boolean(leerB()?.datos),
  tieneAcceso: id => Boolean(leerB()?.llaves?.[id]),

  // Al ingresar: abre la bóveda con la llave del usuario. Si aún no existe y es admin, la crea.
  async abrir(usuario, llaveUsuario) {
    let b = leerB();
    if (!b) {
      if (usuario.rol !== 'admin') return false;
      const maestra = aleatorio(32);
      b = { version: 1, datos: null, llaves: { [usuario.id]: await cifrar(llaveUsuario, maestra) } };
      escribirB(b);
      guardarLlaveSesion(maestra);
      return true;
    }
    const sobre = b.llaves?.[usuario.id];
    if (!sobre) return false;
    try {
      guardarLlaveSesion(await descifrar(llaveUsuario, sobre));
      await this.cargar();
      return true;
    } catch {
      return false;
    }
  },

  // Tras recargar la página con la sesión abierta: vuelve a descifrar las credenciales.
  async cargar() {
    credenciales = null;
    const b = leerB();
    const maestra = llaveSesion();
    if (!b?.datos || !maestra) return;
    try { credenciales = await descifrarJson(await importarLlave(maestra), b.datos); } catch { credenciales = null; }
  },

  cerrar() {
    credenciales = null;
    guardarLlaveSesion(null);
  },

  credenciales: () => credenciales,

  async guardarCredenciales(c) {
    const maestra = llaveSesion();
    if (!maestra) throw new Error('La bóveda está cerrada: cierra sesión e ingresa de nuevo con un usuario administrador.');
    const b = leerB();
    escribirB({ ...b, datos: await cifrarJson(await importarLlave(maestra), c) });
    credenciales = { ...c };
  },

  async borrarCredenciales() {
    const b = leerB();
    if (b) escribirB({ ...b, datos: null });
    credenciales = null;
  },

  // Da acceso a otro usuario (al crearlo o al cambiar su contraseña). Requiere la bóveda abierta.
  async darAcceso(usuarioId, llaveUsuario) {
    const maestra = llaveSesion();
    const b = leerB();
    if (!maestra || !b) return false;
    escribirB({ ...b, llaves: { ...b.llaves, [usuarioId]: await cifrar(llaveUsuario, maestra) } });
    return true;
  },

  quitarAcceso(usuarioId) {
    const b = leerB();
    if (!b?.llaves?.[usuarioId]) return;
    const llaves = { ...b.llaves };
    delete llaves[usuarioId];
    escribirB({ ...b, llaves });
  }
};
