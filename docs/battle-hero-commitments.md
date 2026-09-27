# Compromiso de héroe para una batalla (HU-29)

`POST /api/internal/v1/inventory/heroes/{heroId}/battle-commitments` compromete
un héroe para una batalla y
`POST /api/internal/v1/inventory/battle-commitments/{operationId}/release` lo
libera. Solo `combat` puede usar estas rutas, con la firma HMAC interna. El
contrato de referencia es `hu-29-battle-commitment-v1` de Infrastructure.

**Es lo que hace real el bloqueo de equipamiento.** `ADR-019` ya había decidido
esta frontera —compromiso del héroe al iniciar la batalla y liberación al
terminar, síncrono, con `operationId`— y hasta ahora nadie la implementaba. Sin
esta llamada, la regla de HU-29 existiría y nunca se dispararía.

Mientras el compromiso está vigente, el héroe está «en batalla» y su loadout
queda bloqueado: `PUT /api/inventories/me/heroes/{heroId}/equipment/{slot}`
responde `409` con `reason: battle_lock` y un mensaje que explica el motivo, sin
leer ni escribir el loadout. `GET .../equipment` publica `locked: true`, para que
la interfaz deshabilite el cambio sin reimplementar la regla. Con arma, armadura
e ítem por igual: la categoría no cambia la decisión. Al liberar, el flujo normal
de HU-28 vuelve.

La creación solo valida que el héroe sea de ese jugador: una batalla no exige
mazo completo, a diferencia del compromiso de misión. Una misma operación y
cuerpo devuelve el mismo `commitmentId`; otro cuerpo recibe
`409 OPERATION_ID_REUSED`. La liberación responde `204` aunque ya se hubiera
liberado o no se conozca.

`expiresAt` es obligatorio y un compromiso vencido **no bloquea**. Es la red que
impide que una liberación perdida deje el loadout bloqueado para siempre: el
reincidente que llega después libera de forma perezosa al vencido.

En MongoDB, `011-battle-hero-commitments` crea la colección con `_id =
operationId` —la idempotencia la impone el motor, no una lectura previa— y un
**índice único parcial** sobre `{playerId, heroId}` limitado a los `ACTIVE`, que
es lo que impide que un héroe esté en dos batallas a la vez sin necesidad de un
documento de exclusión aparte. El adaptador en memoria reproduce las dos
invariantes —clave única y un héroe activo a la vez— y **rechaza**, no lanza de
forma síncrona.

El registro de lo que ocurre queda en el controlador de equipamiento, con dos
eventos: `equipment_change_rejected` (`warn`, con `reason: battle_lock`) y
`equipment_change_applied` (`info`). El segundo no es decorativo: sin él no se
puede distinguir «no se intentó» de «se intentó y pasó».

## Límites conocidos

- **No hay exclusión cruzada entre propósitos.** Un héroe podría quedar
  comprometido a `MISSION` y a `BATTLE` a la vez; generalizar el mecanismo de
  exclusión toca la superficie de Missions y es una regla de producto que no está
  decidida.
- **El copy del mensaje** sigue pendiente del PO: lo único contratado es que
  explique el motivo.
- **Qué cuenta como «batalla activa» en el borde** lo fija Combat al decidir
  cuándo compromete. La lectura literal de la HU apunta a `IN_BATTLE`; ampliarlo
  a `PREPARING` rompería el lobby de preparación de HU-15.3.
- **La épica no entra en el bloqueo**: la HU nombra arma, armadura e ítem, y
  HU-28 excluye `EPICA` de las categorías equipables.
