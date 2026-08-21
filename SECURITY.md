# Política de seguridad

## Alcance

Esta política cubre el código de `Nexus-Battle-Player-Inventory`. Nexus Battles VI es un producto académico en desarrollo: no existe todavía una versión en producción con datos reales de usuarios.

## Versiones soportadas

| Versión | Estado                                                 |
| ------- | ------------------------------------------------------ |
| `0.1.x` | En desarrollo activo. Recibe correcciones de seguridad |

## Reporte de vulnerabilidades

Las vulnerabilidades **no se reportan mediante Issues públicas ni Pull Requests**.

Se utiliza el reporte privado de vulnerabilidades de GitHub, disponible en la pestaña _Security_ de este repositorio. Un reporte útil incluye:

- Componente afectado y versión o commit.
- Descripción del problema y su impacto.
- Pasos reproducibles.
- Configuración necesaria para reproducirlo.

El equipo propietario acusa recibo y coordina la corrección junto con los Scrum Masters. La divulgación se realiza después de que la corrección esté integrada.

## Controles activos en el repositorio

- Grafo de dependencias y alertas de Dependabot.
- Actualizaciones de seguridad de dependencias agrupadas y programadas.
- Escaneo de secretos con protección de subida.
- Análisis estático de código con CodeQL.
- Revisión obligatoria del Code Owner antes de integrar en `main`.
- Historial lineal y prohibición de forzar la subida o eliminar `main`.
- Permisos de solo lectura por defecto para el token de los workflows.
- Acciones de terceros fijadas por SHA de commit completo.
- Aprobación requerida para ejecutar workflows de contribuciones externas.

## Manejo de secretos

- No se incorporan secretos, credenciales, tokens ni claves al repositorio.
- La configuración sensible se entrega por variables de entorno. `.env` está ignorado por Git; `.env.example` documenta las variables sin valores reales.
- La imagen de contenedor no incluye archivos de entorno ni credenciales.
- No se utilizan claves de acceso de larga duración de AWS. Cuando se habilite el despliegue, la autenticación usará OIDC con credenciales de corta duración.
- La evidencia enlazada desde las Issues no debe contener secretos.

## Consideraciones específicas del servicio

- El servicio guarda referencias a jugadores y objetos, no datos personales directos. El identificador del jugador proviene del contexto Account y aquí se trata como opaco.
- El inventario nunca acepta una cantidad negativa o fraccionaria: la validación vive en el objeto de valor `Quantity`, de modo que ningún adaptador puede introducir un saldo imposible.
- La capacidad se aplica en el agregado, no en el controlador: una petición que llegue por otro adaptador queda igualmente limitada.
- La validación de entrada descarta propiedades no declaradas y rechaza la petición si llegan campos desconocidos, de modo que un cliente no puede alterar la capacidad de su propio inventario.
- La documentación interactiva OpenAPI permanece deshabilitada en producción salvo decisión explícita.

## Identidad

Este servicio no autentica. La identidad de quien realiza una petición proviene del contexto Account, cuya integración con un proveedor de identidad autorizado permanece pendiente de aprobación. Ver `docs/adr/ADR-004-identity-directory.md` en Nexus-Battle-Infrastructure.
