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

El **umbral** de experiencia requerido para el siguiente nivel **no se posee ni se almacena**: se obtiene de la tabla vigente dentro de `ExperiencePolicy`, fijada por la aclaración funcional posterior del Product Owner. Un valor derivado que se guarda es una segunda versión de la misma verdad.

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

`HeroLevel` es un entero dentro de `1..8` y **no normaliza en silencio**: un `2.5` no se trunca, un `"3"` no se convierte y un `9` no se recorta. `Experience` es la experiencia **acumulada**: un entero no negativo, sin techo. Solo crece —subir de nivel no la descuenta— y en el nivel máximo sigue creciendo sin descartarse, así que su techo no es un número fijo.

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

La regla vive en `src/domain/policies/ExperiencePolicy.ts` como **política pura**: no persiste, no expone HTTP y no otorga experiencia por sí misma. Contiene la **tabla de umbrales vigente**, fijada por una decisión funcional posterior —`100 · 300 · 500 · 700 · 900 · 1.100 · 1.300`, de experiencia **acumulada** para **pasar** de cada nivel al siguiente (nivel máximo 8)— y las dos direcciones de esa tabla: el umbral para salir de un nivel y el nivel de un acumulado. Esa tabla sustituye a la fórmula original del PDF y a la tabla temporal anterior. La XP se suma, nunca se resta, y un solo otorgamiento puede cruzar varios niveles. Su diseño completo, con el caso de uso, los diagramas y las decisiones abiertas, está en [hu-08-progresion.md](hu-08-progresion.md).

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
- **`CA-03` de HU-08 se corrige al umbral acumulado vigente.** La fórmula original `100 × 1,2^(Nivel−1)` y la tabla temporal `100 · 200 · … · 12.800` quedan sustituidas por `100 · 300 · 500 · 700 · 900 · 1.100 · 1.300` (decisión funcional posterior; no estaba en el PDF). La migración `013-hero-progressions-cumulative-thresholds` recalcula el nivel de los héroes ya persistidos sin tocar su XP. Ver [hu-08-progresion.md](hu-08-progresion.md).
- **La política de redondeo de la recompensa de experiencia sigue abierta, y no es de este servicio.** `10 × 1,2^(1d8)` —la XP por muerte de NPC en misiones JvE— es de Missions, y su tirada `1d8` es de Combat (`ADR-021`). Player/Inventory solo recibe un importe entero y lo acredita; la tabla de umbrales no tiene fracciones que redondear.
- **`CA-06` de HU-08 (el nivel como multiplicador de las estadísticas) está implementado.** `computeEffectiveStats(base, equipamiento, nivel)` calcula `(base × nivel) + equipamiento` sobre poder, vida, defensa y ataque; el nivel es el del propio héroe (`HeroProgression`, nivel 1 sin documento). `power` escala (confirmado por el PO). `damage` y `healing` (dados) **no** se escalan todavía porque la semántica de escalar dados no está definida. El contrato `equipped-hero` lleva `level` y `levelStats` (aditivo) y `effectiveStats` ya incorpora el nivel. Ver [hu-08-progresion.md](hu-08-progresion.md), sección 12.

Estas limitaciones están declaradas de forma explícita para que la arquitectura de demo no se confunda con la arquitectura objetivo.
