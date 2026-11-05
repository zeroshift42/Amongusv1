# Estado de entrega y validación — NAVE 26

Versión 0.1.0, preparada el 2 de noviembre de 2026. **Versión funcional inicial, publicada en Render y pendiente de aceptación en la escuela. No equivale a completar todas las exigencias del documento original ni al acabado de un videojuego comercial.**

## Publicación comprobada

- Repositorio público: https://github.com/zeroshift42/Amongusv1
- Juego: https://nave-26.onrender.com/
- Render confirmó el despliegue `dep-dblv4561egvs73apoucg` como `live`, con el commit `598a638375d9ec824901cd3bc7c2ad81895c8c0b`, el 5/11/2026 UTC.
- GitHub Actions completó correctamente tipos, pruebas, compilación y construcción Docker: https://github.com/zeroshift42/Amongusv1/actions/runs/41959161065
- Pantalla inicial comprobada en Chrome sobre HTTPS; `/health` respondió 200.
- Prueba sobre el servidor público: 26 clientes Socket.IO más un docente conectados por WSS; creación autenticada de sala, ingreso de todos e inicio sincronizado comprobados. Sala finalizada y jugadores de prueba retirados. No equivale a 26 navegadores físicos ni a una partida completa.

## Comprobaciones ejecutadas

- `npm run check`: TypeScript sin errores.
- `npm test`: **12 pruebas aprobadas**, sin pruebas omitidas.
- `npm run build`: frontend Vite y servidor compilados correctamente.
- `npm audit --omit=dev --audit-level=high`: cero vulnerabilidades informadas en dependencias de ejecución en la consulta realizada. Esto no sustituye una auditoría de seguridad.
- Navegador Chrome del entorno cloud: pantalla inicial, ingreso a sala real, partida con tres clientes de prueba y un navegador, representación Phaser, reconexión tras recarga, reunión de emergencia y entrega de frase predefinida comprobados. Los clientes de prueba no forman parte del juego entregado.

## Cobertura automatizada

Las pruebas usan sockets de red reales con `socket.io-client` y un servidor Node, sin sustituir Socket.IO por una simulación. Algunas pruebas de mecánicas colocan posiciones o adelantan temporizadores mediante acceso interno al modelo del servidor: no se expone ese acceso a los clientes del juego.

1. 26 estudiantes y docente independiente; rechazo de plaza 27, tres impostores, privacidad de roles, movimiento concurrente, pausa, sabotaje y reparación, alcance de eliminación, cadáver/fantasma, reporte, reunión, 25 votos válidos tras una eliminación, rechazo de voto duplicado, expulsión, reinicio y segunda sala aislada.
2. Reconexión conserva identidad y rechaza tokens falsos; apodos no sustituyen credenciales.
3. Autenticación administrativa, cierre de acceso y rechazo de mensajes malformados.
4. Carga de 26 clientes con 100 tandas de movimiento (2.600 confirmaciones).
5. Reconexión durante sabotaje/reunión conserva tareas, rol y voto; reconexiones simultáneas mantienen una sola identidad.
6. Diez protocolos de tarea: rechazo de entrada inválida y finalización mediante secuencia válida.
7. Distancia de tareas, falsa finalización, pausa y tareas de fantasmas.
8. Reparación crítica con dos jugadores diferentes, congelación por pausa y victoria al expirar el sabotaje.
9. Filtrado por distancia/paredes, ocultación de fantasmas y roles.
10. Empate, abstención y condiciones de victoria por tareas o expulsión.
11. Accesibilidad de todas las habitaciones, tareas y ventilaciones mediante los pasillos del mapa.

La última ejecución de carga tardó 5,39 segundos: 2.600 confirmaciones, mediana de respuesta 1,55 ms, percentil 95 de 6,29 ms, 1.404 mensajes de estado recibidos por los estudiantes y aproximadamente 117 MiB de memoria máxima del proceso que alojaba servidor y clientes. **Son mediciones de comunicación interna en el mismo entorno, no latencia por Internet ni rendimiento de 26 navegadores Android.** En una ejecución concurrente con navegador y compilaciones, el entorno estuvo más lento. Se corrigió una prueba que asumía que 220 ms de reloj siempre permitían suficiente simulación; ahora espera evidencia de movimiento y renueva la intención hasta recibirla.

## Correcciones de la revisión

- Cancelación de tarea, incluso durante pausa, libera al personaje.
- Campos de configuración y nombres de sabotajes unificados entre cliente y servidor.
- Resultado muestra los nombres de equipos enviados por el servidor.
- Botones conservados entre estados equivalentes: antes su reconstrucción continua podía interrumpir clics.
- Limpieza de contadores de conexiones y vencimiento de plazas desconectadas.
- Elección de salida en la interfaz de ventilaciones.

## Implementado con simplificaciones

- Astronautas procedurales con piernas animadas, respiración, sombras y fantasmas; nave original de 13 sectores, mapa general y seguimiento de cámara.
- Las posiciones de otros jugadores se filtran en el servidor según visión y paredes. El plano y la decoración siguen visibles: no se implementó una máscara de iluminación con oclusión completa de todos los objetos.
- Diez minijuegos funcionales, algunos deliberadamente sencillos. Descarga y muestras requieren espera más confirmación/selección; no son sistemas complejos de varias etapas. La validación de gestos acepta valores del cliente y verifica secuencia, tiempo y distancia; no prueba que haya intervenido una persona.
- Reparaciones críticas: dos terminales diferentes, dos jugadores diferentes dentro de una ventana de ocho segundos. Cualquier terminal sirve; no se limitan a paneles exclusivos de oxígeno/reactor. Luces/comunicaciones se reparan desde un terminal. Puertas bloqueadas duran 15 segundos y también pueden repararse.
- Los impostores pueden aparentar trabajo acercándose a paneles, pero no tienen un minijuego de tarea falsa específico.
- Reportar un cuerpo cancela el sabotaje. El tiempo máximo produce “Sin ganador”; esa regla no es configurable. Empates y abstenciones no expulsan.
- Los fantasmas pueden ver las posiciones de otros jugadores, sin descubrir sus roles, y continúan sus tareas; permanecen dentro de las zonas transitables.
- La calidad baja reduce efectos CSS; no hay un sistema completo de adaptación de renderizado/red. Las instantáneas de estado son pequeñas y filtradas, pero no hay protocolo diferencial, compresión especializada ni predicción avanzada.
- Las decoraciones no tienen colisión individual; las paredes exteriores y las puertas saboteadas sí.

## Pendientes respecto del documento original

- Verificar disponibilidad y latencia desde la escuela, partida completa de 15–20 minutos, 26 navegadores físicos y controles táctiles en Android.
- Implementadas presentación animada del rol, expulsión espacial, transición a fantasma y entrada del panel final. Se pueden omitir y respetan movimiento reducido. Añadidas eliminación sin violencia gráfica, caída de jugadores observados y entrada/salida de conductos para el propio jugador y el docente. No se transmiten datos nuevos de jugadores ocultos. Pendientes: secuencias diferenciadas de victoria/derrota.
- Añadir puertas automáticas normales, accesorios/patrones por personaje, minimapa permanente, estadísticas individuales completas y optimización avanzada.
- Pruebas de accesibilidad con el grupo, balance de roles/tareas, revisión externa de seguridad y soporte de desconexiones prolongadas en redes escolares.

El estado vive en memoria y se pierde al reiniciar el servidor. No se promete continuidad entre despliegues. No se solicitó ni se generó ningún recurso de pago.
