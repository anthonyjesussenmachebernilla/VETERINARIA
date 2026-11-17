/* tema.js — aplica el tema claro u oscuro antes de pintar la página (evita el destello del tema equivocado). */
(function () {
  try {
    var guardado = localStorage.getItem('veterinaria.tema');
    var oscuro = guardado === 'oscuro' || (!guardado && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    if (oscuro) document.documentElement.classList.add('dark');
  } catch (e) { /* sin almacenamiento: tema claro */ }
})();
