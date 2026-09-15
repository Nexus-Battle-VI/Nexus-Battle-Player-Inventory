# Resolución de propietarios por producto (HU-38)

Contrato interno de solo lectura que resuelve la brecha dejada por
[`Nexus-Battle-Notifications#20`](https://github.com/Nexus-Battle-VI/Nexus-Battle-Notifications/pull/20):
Notifications necesita saber qué jugadores poseen un producto para dirigir una
notificación de suspensión/reactivación (HU-38, [Management#46](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/46),
[TASK #175](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/175)),
y no tenía forma de resolverlo sin acceder directamente a la base de datos de
este servicio -algo que la frontera de datos entre contextos (ADR-005) prohíbe-.

**HU-38 no transfiere ownership de datos.** Player/Inventory sigue siendo el
único dueño de los inventarios: este endpoint no es una segunda fuente de
verdad ni una réplica, es una consulta de solo lectura sobre el mismo agregado
que ya expone `GET /inventories/:ownerId`. No existe integración de correo en
este contrato ni en este servicio.

## Contrato

```text
GET /api/internal/v1/inventory/products/{productId}/owners
```

```json
{
  "productId": "11111111-1111-4111-8111-111111111111",
  "owners": [{ "playerId": "cognito-sub-1" }, { "playerId": "cognito-sub-2" }]
}
```

La respuesta contiene **exclusivamente** el `playerId` de cada propietario: ni
correo, ni nombre, ni el resto del inventario, ni cantidades, ni estadísticas.
Es la identidad técnica mínima que Notifications necesita para crear una
`CatalogNotification`.

Un producto sin propietarios responde `200` con `owners: []`, no un error. Un
`productId` que no tiene forma de UUID ni de referencia legacy kebab-case
responde `400`.

## Autenticación

Mismo mecanismo que `POST /internal/v1/inventory/grants` (`docs/purchase-grants.md`):
`InternalServiceGuard`, HMAC-SHA256 sobre `INTERNAL_SERVICE_AUTH_SECRET`, sin
esquema paralelo. La única diferencia es el servicio permitido:
`x-internal-service: notifications` (además de `commerce`, que sigue
reservado para la entrega de compras). La cadena firmada para este endpoint es:

```text
notifications
GET
/api/internal/v1/inventory/products/{productId}/owners
<TIMESTAMP>
<SHA256 del JSON canónico de {}>
```

No usa JWT y no debe exponerse mediante el proxy público (`/api/internal*` no
se publica en Caddy). Un jugador autenticado con testimonio JWT no obtiene
acceso: `@InternalOnly()` exime la ruta del guard de JWT y la deja
exclusivamente bajo `InternalServiceGuard`.

## Consulta y rendimiento

Un inventario es un único documento por jugador con `slots: [{itemId,
quantity}]` embebido (ver `migrations/001-inventories.ts`). "Poseer" un
producto es tener una ranura para ese `itemId`; el agregado elimina la ranura
al agotarse (`Inventory.remove`), así que la sola presencia en `slots` ya es
la posesión vigente.

```text
db.inventories.find({ 'slots.itemId': productId }, { projection: { _id: 1 } })
```

`migrations/005-product-owners-index.ts` crea `{ 'slots.itemId': 1 }` como
índice **multikey** (MongoDB indexa cada elemento del array por separado): la
consulta queda cubierta por el índice y no se degrada a un escaneo completo de
la colección al crecer el número de inventarios. Verificado con
`explain('queryPlanner')` en `test/db/mongo-product-owners.spec.ts`.

Cardinalidad esperada: cientos de miles de inventarios en el peor caso de la
demo, con como mucho 200 ranuras cada uno (`CapacityPolicy.MAX_CAPACITY`); el
costo de la consulta es proporcional al número de propietarios reales de un
producto, no al total de inventarios.

La consulta es de solo lectura: no modifica ranuras, no reserva stock y no
llama a Catalog.

## Próximo paso para Notifications

`ProductOwnersResolverPort` en Notifications está cubierto hoy por
`UnavailableProductOwnersResolver` (declara la resolución "no disponible" en
vez de inventar acceso a esta base de datos). El adaptador real debe:

1. Llamar a `GET /api/internal/v1/inventory/products/{productId}/owners` con
   el mismo mecanismo HMAC que ya usa Commerce (`internal-signature.ts`,
   duplicado por diseño en cada servicio).
2. Traducir `owners[].playerId` a `{ available: true, playerIds: [...] }`.
3. Traducir un fallo de red o un `5xx` a `{ available: false, reason }`, igual
   que hace `UnavailableProductOwnersResolver` hoy -sin inventar una lista
   vacía que se confundiría con "el producto no tiene propietarios"-.

Con ese adaptador en su lugar, `HandleCatalogLifecycleEvent` deja de responder
`RecipientsUnresolved` para `catalog.product.suspended`/`reactivated` y
empieza a crear `CatalogNotification` por cada propietario real. Ese cambio
vive en Notifications, no aquí; **TASK #175 solo puede cerrarse cuando exista
esa evidencia** (evento → destinatarios resueltos → notificación persistida),
no con la sola existencia de este endpoint.
