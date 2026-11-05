# NAVE 26

Juego original de deducción social espacial para navegadores, inspirado en las mecánicas de Among Us. Recursos visuales propios, sin sprites, sonidos ni mapas del juego comercial. Interfaz en español, 26 plazas de estudiantes más un docente independiente. No utiliza IA, publicidad, cuentas estudiantiles ni servicios de seguimiento.

## Publicación sin instalar nada en la computadora

El destino previsto es un **Web Service de Render**, no un Static Site ni GitHub Pages: hace falta un proceso Node permanente para compartir la partida.

1. Crear un repositorio privado en GitHub llamado `nave-26` desde su sitio web.
2. Descomprimir este paquete y subir **el contenido de la carpeta `nave-26`** a la raíz del repositorio con “Add file → Upload files”. Incluir `.github`, `.gitignore` y `.dockerignore` (algunos exploradores ocultan estos elementos). No subir `node_modules`, `.env`, claves ni contraseñas.
3. En Render, conectar GitHub y crear un **Web Service** con ese repositorio. Runtime: **Docker**. Root directory: vacía si los archivos están en la raíz. Dockerfile: `./Dockerfile`. Dejar Docker Command vacío, pues el contenedor ya define el inicio.
4. Elegir inicialmente el plan **Free**, si está disponible para la cuenta. No activar planes pagos sin decidirlo expresamente. Una alternativa es crear un Blueprint usando `render.yaml`, que declara el plan gratuito.
5. En Environment, definir `ADMIN_PASSWORD` con una contraseña larga, única y privada (al menos 16 caracteres). No enviarla a los estudiantes ni escribirla en el repositorio. `NODE_ENV=production`. Render proporciona `PORT`; la aplicación escucha en `0.0.0.0`.
6. Health check path: `/health`. Desplegar y esperar a que el servicio esté activo.
7. Abrir la dirección HTTPS que asigna Render. El docente entra a “Panel docente”, ingresa la contraseña y crea una sala. Los estudiantes usan la misma URL, un apodo y el código de sala de ocho caracteres. No necesitan GitHub, Render ni ChatGPT.
8. Antes de usarlo con el grado, realizar la prueba de aceptación indicada más abajo. Confirmar que Socket.IO se conecta por WebSocket seguro en el dominio público y que los dispositivos de la escuela no bloquean el servicio.

La conexión al servidor usa el mismo origen del navegador; no hay que cambiar URLs dentro del código para publicar. Mantener **una sola instancia**. El estado de salas está en memoria: no usar escalado horizontal sin agregar almacenamiento/coordinación compartida.

### Plan gratuito y reinicios

Render documenta que los servicios gratuitos se suspenden tras 15 minutos sin tráfico entrante y pueden demorar aproximadamente un minuto en reactivarse. Un reinicio, suspensión o nuevo despliegue borra las salas en memoria. Abrir el sitio antes de la clase y crear una sala nueva; no actualizar la aplicación durante una partida. El plan gratuito sirve para pruebas, pero no garantiza disponibilidad para una clase. Documentación consultada el 2/11/2026: https://render.com/docs/free y https://render.com/docs/docker.

## Uso escolar

- Elegir apodos o identificadores, sin apellidos.
- El docente comparte el código sólo con su grupo y puede cerrar el ingreso al completar la sala.
- Configuración inicial: 3 impostores, 3 tareas, 60 segundos de discusión, 45 segundos para votar y 30 segundos entre eliminaciones. Debe haber más tripulantes que impostores; para probar con 4–6 personas, elegir 1 impostor.
- Abrir una sala con al menos cuatro jugadores para iniciar.
- Mostrar el panel docente sólo en una pantalla privada: contiene información de los roles.
- La pausa detiene el tiempo de simulación y las acciones. Se puede terminar o reiniciar la partida desde el panel.
- No hay chat libre ni mensajes privados; se usan frases predefinidas.
- Un estudiante eliminado puede continuar sus tareas como fantasma.

## Controles

WASD o flechas: caminar. E: interactuar con un terminal o reparar. R: reportar. Q: habilidad de impostor. Tab: mapa. Escape: cerrar ventana. La interfaz incluye botones táctiles y control de movimiento para móviles. Consultar los botones visibles para las acciones disponibles y sus tiempos de espera.

## Arquitectura

- `src/server/`: servidor autoritativo Express + Socket.IO. Controla roles, colisiones, tiempo, tareas, reuniones y victorias; filtra la información que recibe cada estudiante.
- `src/client/`: Phaser 3, interfaces y minijuegos.
- `src/shared/world.ts`: geometría original, terminales, colores, colisiones y visibilidad.
- `tests/`: pruebas de red y de accesibilidad del mapa.
- `Dockerfile`: construcción multietapa y ejecución como usuario sin privilegios.
- `.github/workflows/ci.yml`: comprobación de tipos, pruebas, compilación y construcción Docker en GitHub Actions.
- `render.yaml`: configuración inicial gratuita, contraseña suministrada fuera del repositorio.

El servidor procesa intenciones de movimiento, nunca coordenadas aceptadas directamente del cliente. Las sesiones usan tokens aleatorios; reutilizar un apodo no recupera una identidad. Los desafíos de tareas se validan en servidor. Esto no convierte el navegador en un entorno inviolable: una persona que programe un cliente propio puede automatizar soluciones válidas; no es un sistema antitrampas comercial.

## Comandos para entornos de desarrollo en la nube

Requiere Node.js 22 o superior. No son pasos necesarios en las computadoras de los estudiantes.

```sh
npm ci
npm run check
npm test
npm run build
```

Definir `ADMIN_PASSWORD` en las variables privadas del entorno y ejecutar `npm start`. Para desarrollar gráficos con recarga usar Vite junto al servidor; Vite reenvía `/socket.io` al servidor de desarrollo en puerto 3000. El contenedor de producción sirve todo desde un solo proceso y dominio.

```sh
docker build -t nave-26 .
docker run --rm -p 3000:3000 --env ADMIN_PASSWORD nave-26
```

La variable debe estar definida en el entorno del ejecutor antes del último comando. Nunca pasar contraseñas reales por archivos versionados.

## Actualizaciones

Modificar los archivos del repositorio y hacer commit a la rama conectada. GitHub Actions comprueba el proyecto y Render puede desplegar automáticamente ese commit. Cada actualización reinicia las salas; realizarla fuera del horario de juego. Para volver atrás, restaurar un commit comprobado. No hay que modificar manualmente el contenedor.

## Aceptación antes de una clase

1. Crear una sala pública desde la URL HTTPS y conectarse desde dos redes/dispositivos diferentes.
2. Completar las 26 plazas y verificar que el docente no consume una.
3. Iniciar, moverse, realizar tareas y comprobar que todos ven el mismo progreso.
4. Comprobar una eliminación, reporte, reunión, voto, expulsión y victoria.
5. Probar sabotajes y reparaciones, pausa de temporizadores, cierre de acceso y reinicio.
6. Recargar un navegador y verificar recuperación de identidad sin duplicación.
7. Probar al menos un Android y una computadora escolar. Validar legibilidad y desempeño durante una partida completa de 15–20 minutos.

Las pruebas automatizadas no reemplazan esta aceptación sobre el alojamiento y las redes de la escuela. Consultar `VALIDACION.md` para distinguir comprobaciones realizadas, limitaciones y funciones pendientes.
