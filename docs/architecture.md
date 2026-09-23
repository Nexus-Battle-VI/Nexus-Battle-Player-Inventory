# Arquitectura de Nexus-Battle-Player-Inventory

Documento técnico del servicio. La arquitectura del sistema completo, los ADR y los diagramas viven en [Nexus-Battle-Infrastructure](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure).

## Bounded context

**Player/Inventory** es responsable de qué objetos posee un jugador y en qué cantidad. Su lenguaje ubicuo se limita a inventario, ranura, objeto, cantidad y capacidad.

No es responsable de qué **es** un objeto. El nombre, la descripción, el precio y la categoría pertenecen al contexto Catalog. Este servicio conoce el identificador del objeto y nada más.

Tampoco es responsable de quién es el jugador. El identificador proviene del contexto Account y aquí se trata como opaco.

Esa doble frontera es deliberada: evita duplicar el catálogo y el modelo de cuentas dentro del inventario, que es la forma habitual de que un microservicio deje de serlo.

### Datos que posee

Player/Inventory es propietario exclusivo de los inventarios: propietario, capacidad y ranuras. Ningún otro servicio accede a este almacén, ni directamente ni mediante claves foráneas.

Posee además, como agregados propios y almacenes propios, el **equipamiento** del héroe (`HeroLoadout`, por jugador y héroe), la **selección** del héroe preparado (`HeroSelection`, una por jugador) y la **progresión** del héroe: su nivel y su experiencia acumulada (`HeroProgression`, por jugador y héroe).

El **umbral** de experiencia requerido para el siguiente nivel **no se posee ni se almacena**: se calcula con `ExperiencePolicy` a partir del nivel. Un valor derivado que se guarda es una segunda versión de la misma verdad.

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

`HeroLevel` es un entero dentro de `1..8` y **no normaliza en silencio**: un `2.5` no se trunca, un `"3"` no se convierte y un `9` no se recorta. `Experience` es la experiencia **acumulada**: un entero no negativo, sin techo, porque su techo es el umbral del nivel vigente, que es derivado.

## Progresión del héroe (HU-08, RF-08)

El nivel pertenece **al héroe, no al jugador**: un jugador puede tener varios héroes y cada uno progresa por su cuenta. Es la misma decisión que HU-11 tomó para el Poder.

```text
Jugador
  ├── Inventory        (qué posee)                    HU-27, HU-38
  ├── HeroSelection    (qué héroe tiene preparado)    HU-07   una por jugador
  ├── HeroLoadout      (qué lleva equipado)           HU-28   una por (jugador, héroe)
  └── HeroProgression  (nivel y experiencia)          HU-08   una por (jugador, héroe)
```

La progresión es un **agregado aparte** y no un campo de los otros dos. `HeroSelection` documenta expresamente que no guarda estadísticas ni equipamiento porque duplicarlos daría dos versiones de la misma verdad, y el nivel no es una excepción. `HeroLoadout` cambia por motivos y con ritmos distintos, y compartir agregado haría que subir de nivel compitiera por el bloqueo optimista con equipar un arma.

La regla vive en `src/domain/policies/ExperiencePolicy.ts` como **política pura**: no persiste, no expone HTTP y no otorga experiencia. Su diseño completo, con el caso de uso, los diagramas y las decisiones abiertas, está en [hu-08-progresion.md](hu-08-progresion.md).

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
- **La política de redondeo del umbral de experiencia no está decidida.** La fórmula `100 × 1,2^(Nivel−1)` produce valores fraccionarios (nivel 4 → `172,8`; nivel 7 → `298,5984`). `ExperiencePolicy` devuelve el valor **exacto** en forma decimal canónica y **no redondea**; el redondeo lo decidirá el Product Owner y se aplicará en la frontera que corresponda. Como el umbral no se persiste, cambiarlo después no exige migración de datos.
- **`CA-06` de HU-08 (el nivel como multiplicador de las estadísticas) queda fuera de alcance y sin resolver.** El umbral es función del nivel y **no** interviene en `computeEffectiveStats`, que sigue recibiendo solo estadísticas base y equipamiento. Ver [hu-08-progresion.md](hu-08-progresion.md).

Estas limitaciones están declaradas de forma explícita para que la arquitectura de demo no se confunda con la arquitectura objetivo.
