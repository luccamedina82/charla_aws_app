// Preguntas iniciales (15, basadas en la charla: AWS, ECS, arquitectura, CI/CD y Terraform).
// Solo se cargan si la tabla `questions` está vacía; después se editan desde el panel de admin.
// correct: 0 = A, 1 = B, 2 = C, 3 = D

module.exports = [
  // ---------- Principiante ----------
  { category: 'principiante', text: 'En la analogía del puerto, ¿qué representa ECS?', options: ['El contenedor', 'El barco', 'El jefe del puerto, que decide qué contenedor va en qué barco', 'La zona de disponibilidad'], correct: 2 },
  { category: 'principiante', text: '¿Qué es una Zona de Disponibilidad dentro de una región de AWS?', options: ['Un datacenter con energía y red propias', 'Un tipo de instancia EC2', 'Una cuenta de AWS distinta', 'Un plan de precios'], correct: 0 },
  { category: 'principiante', text: '¿Para qué sirve repartir la aplicación en dos zonas de disponibilidad?', options: ['Para pagar menos', 'Para que siga andando aunque se caiga una zona', 'Para que la app cargue más rápido en todo el mundo', 'Para no necesitar un Load Balancer'], correct: 1 },
  { category: 'principiante', text: '¿Qué es un contenedor?', options: ['Una computadora que se alquila en AWS', 'Un servicio de base de datos administrado', 'La app y todo lo que necesita en una caja estándar que corre igual en cualquier lado', 'Un archivo donde se guarda el estado de la infraestructura'], correct: 2 },
  { category: 'principiante', text: '¿Cuál de estos es un caso en el que NO conviene usar AWS?', options: ['Necesitamos que el sitio siga andando si se rompe una máquina', 'Necesitamos actualizar la app mientras la gente la usa', 'Proyecto chico, tráfico estable y sin apuro si se cae un rato', 'Necesitamos sumar máquinas para un pico de tráfico'], correct: 2 },

  // ---------- Intermedio ----------
  { category: 'intermedio', text: 'En ECS, ¿qué componente mantiene la cantidad de copias que pedimos y repone las que se caen?', options: ['Task definition', 'Service', 'Cluster', 'Task'], correct: 1 },
  { category: 'intermedio', text: '¿Qué define una Task definition en ECS?', options: ['Cuántas copias de la app deben estar corriendo', 'En qué zona se despliega cada contenedor', 'La imagen, CPU, memoria, puertos y variables del contenedor', 'Quién tiene permiso para desplegar'], correct: 2 },
  { category: 'intermedio', text: 'Elegimos ECS con launch type EC2 y no Fargate. ¿Qué implica esa decisión?', options: ['AWS pone las máquinas y pagamos por contenedor', 'Las máquinas son nuestras: más control y menor costo si se usan siempre, pero hay que mantener la flota', 'No hace falta un Auto Scaling Group', 'No se puede usar blue/green'], correct: 1 },
  { category: 'intermedio', text: 'En un blue/green, ¿qué pasa con la versión vieja (blue) apenas la nueva (green) pasa los controles?', options: ['Se elimina de inmediato', 'Queda disponible un rato por si hay que volver atrás, y recién después se da de baja', 'Sigue recibiendo la mitad del tráfico para siempre', 'Se convierte en la base de datos de respaldo'], correct: 1 },
  { category: 'intermedio', text: 'En el pipeline de CI/CD de la charla, ¿qué servicio arma la imagen del contenedor?', options: ['CodePipeline', 'ECR', 'CodeBuild', 'GitHub'], correct: 2 },

  // ---------- Avanzado ----------
  { category: 'avanzado', text: 'Estuvimos dos horas caídos porque la base cambió de lugar y el frontend la seguía buscando en el viejo. ¿Qué principio evita este problema?', options: ['Apuntar siempre a la dirección IP de la base', 'Que las piezas se encuentren por nombre y no dependan de dónde está cada una', 'Tener una sola copia de la base de datos', 'Desactivar el Load Balancer'], correct: 1 },
  { category: 'avanzado', text: 'Con 3 contenedores en régimen y blue/green, la capacidad llega a 5 contenedores simultáneos, y con 3 barcos hay 6 lugares. ¿Por qué se dimensiona así?', options: ['Para que durante el despliegue entren las dos versiones a la vez', 'Porque AWS exige un mínimo de 6 lugares', 'Para dejar 3 lugares libres de reserva permanente', 'Porque cada zona necesita su propio barco vacío'], correct: 0 },
  { category: 'avanzado', text: 'Cambiamos una sola línea del código de Terraform y corremos plan. ¿Qué muestra?', options: ['Todos los recursos, porque recrea todo', 'Nada, porque plan ya aplica los cambios', 'Solo la diferencia entre el código y lo que existe en AWS', 'Únicamente los recursos que se van a borrar'], correct: 2 },
  { category: 'avanzado', text: '¿Por qué el estado de Terraform vive en S3 con un candado?', options: ['Para que quede centralizado y que dos personas no apliquen a la vez', 'Para que AWS lo cobre como parte del plan gratuito', 'Para que Terraform no necesite credenciales', 'Para poder destruir la infraestructura más rápido'], correct: 0 },
  { category: 'avanzado', text: 'La arquitectura de la charla funciona y se recupera sola, pero no es de producción. ¿Cuál de estas mejoras corrige que hoy hay una sola copia de la base de datos?', options: ['Un WAF delante del Load Balancer', 'Un NAT Gateway por zona', 'RDS Multi-AZ', 'Alertas de AWS Budgets'], correct: 2 }
];
