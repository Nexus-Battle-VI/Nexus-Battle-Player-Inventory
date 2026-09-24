# Compromiso de héroe para Missions

`POST /api/internal/v1/inventory/heroes/{heroId}/commitments` crea una reserva
`MISSION` y `POST /api/internal/v1/inventory/commitments/{operationId}/release`
la libera. Solo `missions` puede usar estas rutas, con la firma HMAC interna.
Las respuestas siguen `hu-70-mission-enrollment-v1` de Infrastructure.

La creación comprueba que el héroe es del jugador, está activo, su equipo sigue
perteneciendo al jugador y está activo. Cuando `completeLoadout` es verdadero
exige las dos armas y las seis armaduras (`MISSION_REQUIRED_SLOTS`) y devuelve
`LOADOUT_INCOMPLETE` con el déficit por familia. Los ítems son opcionales: una
misión se puede iniciar con cero ítems (decisión del PO del 2026-09-24). Una misma operación y cuerpo devuelve el mismo `commitmentId`; otro
cuerpo recibe `409 OPERATION_ID_REUSED`. La liberación responde `204` aunque la
operación ya se hubiera liberado o no se conozca.

En MongoDB, `010-mission-hero-commitments` crea el ledger y un documento de
exclusión por jugador y héroe. Crear/liberar la reserva y guardar el loadout
escriben ese documento dentro de una transacción. Un cambio concurrente de
equipamiento invalida la versión observada y se reintenta la reserva; mientras
el compromiso está vigente, equipar devuelve `409`. El vencimiento se compara
con el reloj en cada operación; el ledger permanece para la idempotencia. La
persistencia de producción requiere el replica set que ya usan las entregas
idempotentes del inventario.

Auction comparte el documento de exclusión al retirar un héroe o una pieza
equipada por él. Si existe una reserva `MISSION` vigente, la publicación se
rechaza. La reserva de Missions vuelve a comprobar dentro de la transacción que
el jugador posee tanto el héroe como las piezas de su loadout; así no confirma
un estado leído antes de que Auction retirara uno de esos productos. El
adaptador en memoria reproduce el rechazo para las pruebas locales.

Esta operación solo conoce los compromisos `MISSION` de Player/Inventory. La
actividad de batalla y torneo todavía no se publica en esta frontera, de modo
que el bloqueo cruzado con esos dos contextos sigue pendiente. HU‑29 aún tiene
una PR separada sin integrar.
