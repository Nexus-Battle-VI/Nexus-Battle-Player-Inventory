# Arquitectura de Nexus-Battle-Player-Inventory

Documento técnico del servicio. La arquitectura del sistema completo, los ADR y los diagramas viven en [Nexus-Battle-Infrastructure](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure).

## Bounded context

**Player/Inventory** es responsable de qué objetos posee un jugador y en qué cantidad. Su lenguaje ubicuo se limita a inventario, ranura, objeto, cantidad y capacidad.

No es responsable de qué **es** un objeto. El nombre, la descripción, el precio y la categoría pertenecen al contexto Catalog. Este servicio conoce el identificador del objeto y nada más.

Tampoco es responsable de quién es el jugador. El identificador proviene del contexto Account y aquí se trata como opaco.

Esa doble frontera es deliberada: evita duplicar el catálogo y el modelo de cuentas dentro del inventario, que es la forma habitual de que un microservicio deje de serlo.

### Datos que posee

Player/Inventory es propietario exclusivo de los inventarios: propietario, capacidad y ranuras. Ningún otro servicio accede a este almacén, ni directamente ni mediante claves foráneas.

## Capas

```text
+-------------------------------------------------------------+
|  adapters/inbound/http   InventoriesController               |
+-------------------------------------------------------------+
|  application             GetInventory, AddItemToInventory,   |
|                          RemoveItemFromInventory, ports/     |
+-------------------------------------------------------------+
|  domain                  Inventory, CapacityPolicy,          |
|                          PlayerId, ItemId, Quantity, eventos |
+-------------------------------------------------------------+
|  adapters/outbound       InMemoryInventoryRepository,        |
|                          SystemClock, UuidGenerator          |
+-------------------------------------------------------------+
|  infrastructure          config, observability, health,      |
|                          bootstrap (raiz de composicion)     |
+-------------------------------------------------------------+
```

Las dependencias apuntan siempre hacia el dominio. El dominio no conoce ninguna capa exterior, y la capa de aplicación no conoce NestJS.

## Puertos

| Puerto                    | Responsabilidad                   | Implementación actual         |
| ------------------------- | --------------------------------- | ----------------------------- |
| `InventoryRepositoryPort` | Persistir y recuperar el agregado | `InMemoryInventoryRepository` |
| `ClockPort`               | Proveer el instante actual        | `SystemClock`                 |
| `IdGeneratorPort`         | Generar identificadores           | `UuidGenerator`               |

## La regla de capacidad

La capacidad limita el número de **ranuras distintas**, no el total de unidades.

```text
add(objeto nuevo)      -> requiere ranura libre
add(objeto existente)  -> apila; la capacidad no interviene
remove(hasta agotar)   -> la ranura desaparece y libera capacidad
```

Modelarlo así tiene una consecuencia verificable: un inventario completo **sí** admite más unidades de lo que ya contiene. Hay una prueba específica que fija ese comportamiento, porque es exactamente el caso que un modelo ingenuo — contar unidades en lugar de ranuras — resolvería mal.

## Objetos de valor

`Quantity` es un entero estrictamente positivo acotado. Una ranura con cero unidades no existe: se elimina. Modelar la cantidad como objeto de valor impide que un adaptador introduzca un saldo negativo o fraccionario, con independencia de qué validación aplique el controlador.

`ItemId` exige kebab-case, que es el formato del catálogo. `PlayerId` solo exige no estar vacío, porque su formato lo define el contexto Account y este servicio no debe imponerle uno.

## Patrones aplicados

| Patrón             | Dónde                                            | Por qué                                                |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------ |
| Ports and Adapters | Todas las dependencias externas                  | Permite sustituir la persistencia sin tocar el dominio |
| Repository         | `InventoryRepositoryPort`                        | Aísla el agregado del mecanismo de almacenamiento      |
| Domain Events      | `inventory.item.added`, `inventory.item.removed` | Registra hechos del dominio de forma trazable          |

No se aplica CQRS ni Event Sourcing: el contexto no tiene un modelo de lectura diferenciado ni requiere reconstruir estado histórico.

## Eventos de dominio

| Evento                   | Cuándo                           |
| ------------------------ | -------------------------------- |
| `inventory.item.added`   | Se añaden unidades de un objeto  |
| `inventory.item.removed` | Se retiran unidades de un objeto |

Ambos incluyen la cantidad de la operación y la cantidad resultante, de modo que un consumidor puede reconstruir el saldo sin consultar el servicio.

## Observabilidad

Registro JSON estructurado por línea, emitido exclusivamente desde `infrastructure/observability/logger.ts`. El resto del código tiene prohibido escribir en la consola mediante la regla `no-console` de ESLint.

## Salud

`/api/health/live` confirma que el proceso responde y no consulta dependencias. `/api/health/ready` evalúa el repositorio real y responde `503` cuando falla. Una comprobación que lanza una excepción cuenta como fallo, nunca como éxito.

## Limitaciones conocidas del alcance actual

- La persistencia es en memoria y se pierde al reiniciar. El adaptador MongoDB depende de ADR-005, que debe decidir el ODM antes de escribir esquema y migraciones.
- No se valida la existencia del objeto en Catalog ni del jugador en Account. Hacerlo exige una llamada sincrónica entre servicios o una réplica local del catálogo, y ambas son decisiones de integración que corresponden a ADR-006.
- La capacidad es única para todos los jugadores. El modelo admite capacidades distintas sin cambios estructurales, pero no forma parte de este alcance.

Estas limitaciones están declaradas de forma explícita para que la arquitectura de demo no se confunda con la arquitectura objetivo.
