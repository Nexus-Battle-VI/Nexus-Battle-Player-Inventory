# Acreditación de experiencia al héroe (HU-09 y HU-10)

Player/Inventory es la **única** autoridad de la XP acumulada y del nivel del héroe (HU-08). Missions le pide acreditar experiencia por una operación interna; esta página resume **cómo la recibe este servicio**. El contrato completo vive en Infrastructure y **no se duplica aquí**:

- HU-09: [`hu-09-experience-reward-v1`](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure/blob/develop/docs/contracts/hu-09-experience-reward-v1.md) §7.
- HU-10: [`hu-10-mission-completion-reward-v1`](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure/blob/develop/docs/contracts/hu-10-mission-completion-reward-v1.md) §8.

```text
POST /api/internal/v1/players/{playerId}/heroes/{heroId}/experience
```

Ruta **interna**: `@InternalOnly()` + `@InternalCallers('missions')`, firma HMAC, sello dentro de la ventana, y falla cerrada (sin secreto configurado responde `503`). `missions` **no** está en la lista global de servicios: el permiso se acota a esta ruta. No hay ruta pública: Web no puede acreditar experiencia.

## Dos orígenes, un mismo motor

`source` es una **unión discriminada por `kind`**. Cada variante acepta **exactamente** sus campos:

| `source.kind`          | Historia | Qué representa                                            | Campos                                                                               | `operationId`                                                                                               |
| ---------------------- | -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `MISSION_RIVAL_DEFEAT` | HU-09    | La derrota de **un NPC** en una misión JvE                | `enrollmentId`, `simulationId`, `encounterId`, `enemyInstanceId`, `rivalRef`, `roll` | `mission:{enrollmentId}:encounter:{encounterId}:enemy:{enemyInstanceId}:hero:{heroId}:xp` (una por derrota) |
| `MISSION_COMPLETION`   | HU-10    | La **finalización** de la misión (`COMPLETED` o `FAILED`) | `enrollmentId`, `missionId`, `simulationId`, `difficulty`, `missionOutcome`          | `mission:{enrollmentId}:reward:completion:xp` (una por matrícula)                                           |

- Una finalización **no** lleva `roll`, `rivalRef`, `enemyInstanceId` ni `encounterId` (no hay derrota), y una derrota no lleva `missionId`, `difficulty` ni `missionOutcome`. Mezclar variantes es `400 SCHEMA_INVALID`.
- `difficulty` (`NORMAL | HEROIC | LEGENDARY | MYTHIC`) y `missionOutcome` (`COMPLETED | FAILED`) se validan por su vocabulario cerrado: es validar la **forma**. Este servicio **no decide** cuánta XP corresponde a una dificultad ni si un desenlace da derecho.
- El `operationId` de una finalización debe ser el de **su** matrícula; una clave que no corresponde a `source.enrollmentId` es `400`.
- **Ninguna fórmula de XP vive aquí.** El importe llega ya decidido por Missions (HU-09: `10 × 1,2^(1d8)` redondeada; HU-10: monto del contenido congelado) y este servicio valida que sea un entero no negativo y lo acredita con `HeroProgression.awardExperience` (HU-08): acumula sin restar, recalcula el nivel con la tabla vigente y no descarta XP en el nivel 8.

## Idempotencia y códigos

| Caso                                                                                           | Resultado                                                                      |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Primera aplicación                                                                             | `200`, `applied: true`                                                         |
| Mismo `operationId` + mismo contenido                                                          | `200`, `applied: false`, mismo resultado, **no** vuelve a acreditar            |
| Mismo `operationId` + contenido distinto (importe, dificultad, desenlace, misión, simulación…) | `409 EXPERIENCE_GRANT_CONFLICT`, sin sobrescribir                              |
| Importe fraccionario o negativo, o héroe no acreditable                                        | `422 EXPERIENCE_GRANT_REJECTED`                                                |
| Cuerpo o `source` fuera del contrato, `schemaVersion` distinta                                 | `400 SCHEMA_INVALID`                                                           |
| Colisión de versión de la progresión, persistencia caída                                       | `503 PLAYER_INVENTORY_UNAVAILABLE` (reintentar con el **mismo** `operationId`) |

La **huella** del contenido incluye solo los datos semánticos de la variante que llegó. La de `MISSION_RIVAL_DEFEAT` es **byte a byte la histórica** (una prueba la fija a mano) para que el reintento de un asiento ya guardado siga siendo un replay y no un `409`.

## Ledger (`experience_grants`)

Una acreditación deja su asiento y su progresión en **la misma transacción**. `_id = operationId`.

| Origen                         | Forma del asiento                                                                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MISSION_RIVAL_DEFEAT` (HU-09) | **Aplanada y sin `kind` ni `source`**, tal y como se guardó siempre (`roll`, `enrollmentId`, `simulationId`, `encounterId`, `enemyInstanceId`, `rivalRef`). No se migra ni se reescribe |
| `MISSION_COMPLETION` (HU-10)   | Un subdocumento `source` con su `kind` y **solo** sus campos, sin ningún campo de derrota                                                                                               |

El discriminador es la **presencia de `source`**. La migración `014-experience-grants-mission-completion` sustituye el validador por un `oneOf` cerrado de las dos formas (`collMod`, idempotente, **sin tocar ningún documento**): el motor rechaza un asiento que mezcle campos de derrota con un origen de finalización, o uno de derrota con `source`.

`toSource(documento)` (en `experience-grant-mapping`) devuelve el origen con su `kind` para cualquiera de las dos formas, y lanza si el asiento está a medias en lugar de inventar un origen.
