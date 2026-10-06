// Preguntas iniciales (las 15 del documento original).
// Solo se cargan si la tabla `questions` está vacía; después se editan desde el panel de admin.
// correct: 0 = A, 1 = B, 2 = C, 3 = D

module.exports = [
  // ---------- Principiante ----------
  { category: 'principiante', text: '¿Qué servicio de AWS usaríamos normalmente para almacenar archivos, imágenes o contenido estático?', options: ['Amazon EC2', 'Amazon S3', 'Amazon RDS', 'AWS IAM'], correct: 1 },
  { category: 'principiante', text: '¿Qué servicio permite ejecutar una aplicación en una máquina virtual dentro de AWS?', options: ['Amazon EC2', 'Amazon S3', 'Amazon CloudFront', 'Amazon Route 53'], correct: 0 },
  { category: 'principiante', text: '¿Qué servicio administrado de AWS podemos utilizar para una base de datos relacional?', options: ['Amazon RDS', 'Amazon S3', 'AWS Lambda', 'Amazon CloudFront'], correct: 0 },
  { category: 'principiante', text: '¿Qué componente permite distribuir tráfico entre varias instancias de una aplicación?', options: ['Amazon S3', 'Application Load Balancer', 'IAM Role', 'Security Group'], correct: 1 },
  { category: 'principiante', text: 'Si queremos conocer métricas, logs y crear alarmas sobre nuestra aplicación, ¿qué servicio vimos en la charla?', options: ['Amazon CloudWatch', 'Amazon S3', 'AWS Fargate', 'Amazon RDS'], correct: 0 },

  // ---------- Intermedio ----------
  { category: 'intermedio', text: 'Una empresa quiere mover rápidamente su aplicación desde una VM local hacia AWS haciendo la menor cantidad posible de cambios. ¿Qué estrategia de migración describe mejor este escenario?', options: ['Refactor', 'Rehost', 'Reescribir la aplicación', 'Serverless'], correct: 1 },
  { category: 'intermedio', text: '¿Por qué conviene que una aplicación sea stateless cuando tenemos varias instancias detrás de un Load Balancer?', options: ['Para que cada instancia guarde una sesión diferente', 'Para que cualquier instancia pueda atender cualquier request', 'Para eliminar la necesidad de una base de datos', 'Para evitar utilizar Auto Scaling'], correct: 1 },
  { category: 'intermedio', text: 'Una aplicación guarda archivos subidos por los usuarios en el disco local de EC2. Queremos escalar a varias instancias. ¿Qué sería una mejor alternativa?', options: ['Guardar una copia distinta en cada EC2', 'Guardarlos en Amazon S3', 'Guardarlos dentro del Load Balancer', 'Desactivar Auto Scaling'], correct: 1 },
  { category: 'intermedio', text: 'Tenemos una aplicación Next.js. ¿En qué caso podríamos servirla utilizando Amazon S3 + CloudFront?', options: ['Siempre que esté desarrollada con Next.js', 'Cuando puede generarse mediante Static Export', 'Cuando necesita SSR en cada request', 'Cuando necesita mantener un servidor Node.js ejecutándose permanentemente'], correct: 1 },
  { category: 'intermedio', text: '¿Qué ventaja obtenemos al mover una base de datos instalada dentro de EC2 hacia Amazon RDS?', options: ['AWS pasa a encargarse de parte de la administración de la base de datos', 'La aplicación deja de necesitar networking', 'Ya no necesitamos hacer backups nunca', 'La base de datos pasa a almacenarse en S3'], correct: 0 },

  // ---------- Avanzado ----------
  { category: 'avanzado', text: 'Tenemos una API Python que actualmente corre en EC2, ya está containerizada y queremos reducir la administración de servidores sin cambiar demasiado el código. ¿Qué opción sería razonable?', options: ['Amazon S3', 'Amazon ECS con AWS Fargate', 'Amazon CloudFront', 'Amazon Route 53'], correct: 1 },
  { category: 'avanzado', text: 'Tenemos dos instancias EC2 detrás de un ALB, pero las sesiones de usuario se guardan en memoria dentro de cada instancia. ¿Qué problema podría aparecer?', options: ['Un usuario podría perder su sesión si el siguiente request llega a otra instancia', 'RDS dejaría de funcionar', 'CloudFront no podría conectarse con S3', 'EC2 dejaría automáticamente de escalar'], correct: 0 },
  { category: 'avanzado', text: 'Una aplicación recibe muy pocas solicitudes durante gran parte del día, pero tiene picos impredecibles. Cada request ejecuta una operación corta e independiente. ¿Qué arquitectura podría resultar adecuada para ese backend?', options: ['Una única EC2 grande funcionando permanentemente', 'API Gateway + AWS Lambda', 'S3 + RDS sin backend', 'CloudFront únicamente'], correct: 1 },
  { category: 'avanzado', text: 'Tenemos una aplicación web con React como frontend y Python como backend. Queremos desacoplar ambos componentes. ¿Cuál de estas arquitecturas tiene sentido?', options: ['React en S3 + CloudFront y Python en ECS/Fargate', 'React dentro de RDS y Python dentro de S3', 'React dentro de IAM y Python en CloudFront', 'Toda la aplicación dentro de un Security Group'], correct: 0 },
  { category: 'avanzado', text: '¿Cuál de estas afirmaciones describe mejor cómo elegir entre EC2, ECS/Fargate y Lambda durante una modernización?', options: ['Lambda siempre es mejor porque es más moderno', 'ECS siempre reemplaza a EC2', 'La elección depende de cómo funciona la aplicación, sus dependencias, tráfico y requisitos operativos', 'Toda aplicación debería terminar en serverless'], correct: 2 }
];
