// Une el código de src/ en js/sistema.js (un solo script clásico, legible y sin módulos)
// para que el sistema abra con doble clic en index.html.
// Solo hace falta si modificas algo en src/:   npx -y esbuild@0.24 --version  (una vez)
//                                              node construir.mjs
import { execFileSync } from 'node:child_process';

const windows = process.platform === 'win32';
const banner = '/* Veterinaria · generado desde src/ con node construir.mjs. No editar aquí: los cambios se pierden al reconstruir. */';

const args = [
  '-y', 'esbuild@0.24',
  'src/app.js',
  '--bundle',
  '--format=iife',
  '--target=es2020',
  '--charset=utf8',
  '--legal-comments=none',
  '--outfile=js/sistema.js',
  // En Windows npx se ejecuta por la consola: el banner lleva espacios y va entre comillas.
  windows ? `"--banner:js=${banner}"` : `--banner:js=${banner}`
];

execFileSync(windows ? 'npx.cmd' : 'npx', args, { stdio: 'inherit', shell: windows });
console.log('Listo: js/sistema.js');
