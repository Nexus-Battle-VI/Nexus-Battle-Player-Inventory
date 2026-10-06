# HU-86 — destino durable de épicas

Refs Nexus-Battle-VI/Nexus-Battle-Management#472, #493, #494 y #496.
Adición a `torneos-hu77-84-78-hu83-v2.0.0`; acuse propio de Inventory de
`torneos-cierre-v0.1.0-propuesta`. No congela el acuerdo ni aprueba G2.
Fuente: Infrastructure `a5cdcc5c9f610d0ee7eaa4ab57b224ea34a4966b`, contrato
`docs/contracts/torneos-cierre-premios-v0.1.0.md` y schema correspondiente.

## Ruta y permiso

`POST /api/internal/v1/inventory/tournament-prizes`, exclusivamente HMAC del
consumidor `tournament`. Reutiliza firma canónica, método, ruta sin query,
timestamp y ventana del guard existente. Cabeceras obligatorias:
`x-internal-service`, `x-internal-timestamp`, `x-internal-signature`.
El permiso se declara por ruta con `InternalCallers`; Tournament no entra en la
lista de acceso general ni obtiene grants de Commerce/Missions/Combat.
JWT y roles públicos no sustituyen HMAC. OpenAPI se genera en `/api/docs`.

DTO cerrado de diez campos; strings no vacíos, sin espacios externos ni controles:

| Campo                                    | Límite / valor                                 |
| ---------------------------------------- | ---------------------------------------------- |
| operationId                              | 512 caracteres; opaco, no necesita UUID        |
| tournamentId, championTeamId             | 160 caracteres                                 |
| finalEncounterId                         | 512 caracteres; id opaco, no etiqueta E1/Final |
| finalRoomId, playerId, heroId, productId | 160 caracteres                                 |
| kind                                     | `EPIC`                                         |
| amount                                   | `null`, obligatorio                            |

El servidor fija consumidor/propósito. Actor, autorización, propósito, estado,
cantidad y recibo enviados se rechazan. El orden de propiedades no cambia la huella.
Cada concesión agrega **una unidad**, sin equiparla ni modificar compromisos.

## Validación y recibo

Se reutilizan `InventoryQueryPort`, `resolveOwnedHero`, `CatalogReadPort` y los
parsers canónicos. El héroe debe existir en Catálogo como HEROE y ser poseído por
el jugador (UUID o ranura legacy SKU existente). `heroId` y `productId` del comando
deben coincidir con los productId canónicos devueltos por Catálogo. El producto debe
ser EPICA ACTIVE, tener definición canónica válida y `compatibleHeroSubtype` igual
al subtipo del héroe. Esta elegibilidad del premio no modifica HU-31: el equipamiento
existente sigue permitiendo seleccionar épicas de otro subtipo con efectos limitados.

Inventory confía en el comando autenticado de Tournament para campeón, final y
configuración aprobada. No consulta ni guarda la base de Tournament/Account/Catalog.
No demuestra por sí solo que una final fue jugada. La exclusividad global del producto
y el número/reparto de derechos esperan G2; no se impone una restricción por torneo
que impida otro derecho legítimo con diferente operationId.

Primera entrega y replay: HTTP 200 con los diez campos exactos más
`status:"DELIVERED"` y `receiptId` UUID persistido. Mismo operationId y propósito
completo devuelve el mismo recibo, incluso con Catálogo temporalmente caído o
propiedad cambiada después de la concesión. Otro jugador/héroe/producto/campeón/final
o propósito para el identificador ya confirmado devuelve 409.

Errores siempre `{statusCode,code,message}`, sin detalles de infraestructura:

| HTTP | code                         | Recuperación                                                                                |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| 400  | SCHEMA_INVALID               | Corregir DTO; no hubo concesión                                                             |
| 401  | INTERNAL_UNAUTHORIZED        | Corregir firma/caller/timestamp                                                             |
| 409  | OPERATION_ID_REUSED          | Revisar derecho; no cambiar id para repetir el premio                                       |
| 422  | PRIZE_INVALID                | Revisar héroe, producto, compatibilidad o capacidad                                         |
| 503  | PRIZE_DEPENDENCY_UNAVAILABLE | Repetir **mismo** derecho/id; una respuesta perdida puede haber ocurrido después del commit |

Antes de una concesión nueva se valida Catálogo. La transacción vuelve a comprobar
propiedad sobre el inventario vigente. Rechazos previos al commit no reservan una
concesión terminal; al recuperar Catálogo/propiedad/capacidad se puede repetir el
mismo derecho. Una colisión contra operación confirmada se comprueba antes de esas
dependencias. Un registro sin recibo es diagnóstico 503 y requiere revisión; no se
inventa ni se vuelve a conceder el ítem.

## Persistencia y configuración

Migración reservada `017-tournament-prize-grants`, después de las dieciséis actuales,
sin modificar DDL publicadas. Crea `tournament_prize_grants` con validador estricto,
`_id=operationId` y `tournament_prize_receipt_unique` sobre `receipt.receiptId`.
Comparte `inventory_grants` con compras/cofres/misiones; su `_id` impide colisiones
entre premios y concesiones existentes. El propósito de premio incluye los diez
campos y las constantes de servidor. No hay expiración/TTL de recibos.

Una transacción `snapshot`/`majority` confirma registro compartido, inventario con
revisión CAS y recibo. La transacción usa un solo cliente/pool y la base propia.
El driver reintenta conflictos/commit incierto; se vuelve a leer tras colisión `_id`.
La revisión impide que un guardado legacy sobrescriba el premio concurrente.

Requiere `PERSISTENCE_DRIVER=mongo`, `MONGODB_URI` con replica set o clúster que
soporte transacciones, `INTERNAL_SERVICE_AUTH_SECRET`, `CATALOG_BASE_URL` y
`CATALOG_TIMEOUT_MS`. Aplicar `npm run migrate` antes de servir; no migra al arrancar.
Modo memory, secreto ausente o dependencias inaccesibles fallan cerrado con 503.
No se crean héroes/productos DEV ni se activan respuestas simuladas en producto.
La topología se basa en las [transacciones de MongoDB](https://www.mongodb.com/docs/manual/core/transactions/).

## QA reproducible

`test/fixtures/tournament-prize.ts` identifica `QA-HU86-INVENTORY-v1`; solo se importa
desde tests. Las suites unitarias/HTTP con dobles comprueban validación y permisos;
no son evidencia de durabilidad. `test/db/mongo-tournament-prizes.spec.ts` usa Mongo
real, dos procesos/pools, veinte solicitudes, índices, rechazo transaccional del
motor antes del commit y desconexión TCP posterior al commit seguida de reinicio
de aplicación/pool. Incluye colisiones con concesiones vigentes y guardado legacy.

```powershell
npm ci
npm run lint
npm run format:check
npm run typecheck
npm run test:coverage -- --runInBand
$env:MONGO_TEST_URI='mongodb://127.0.0.1:27486/?directConnection=true'
npm run test:db -- --runInBand
npm run build
```

Sin MONGO_TEST_URI, la suite DB inicia `mongo:8.0` con Testcontainers/Docker.
La QA entre servicios y el upgrade desde develop se entregan como harness externo
en el directorio propio de Chat 04; no incorporan bases, secretos ni snapshots al PR.
La aceptación con campeón real espera HU-85/HU-80 y G2, además de QA del conjunto.

Ejemplo saneado de fixture (no premio operativo):

```json
{
  "operationId": "qa-hu86:epic:0",
  "tournamentId": "qa-hu86-tournament",
  "championTeamId": "qa-hu86-team",
  "finalEncounterId": "qa-hu86-final",
  "finalRoomId": "qa-hu86-room",
  "playerId": "qa-hu86-player",
  "heroId": "86000000-0000-4000-8000-000000000001",
  "kind": "EPIC",
  "amount": null,
  "productId": "86000000-0000-4000-8000-000000000002"
}
```
