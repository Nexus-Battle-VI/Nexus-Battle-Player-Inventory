# Auction commitments (HU-65.4 / HU-69)

El contrato canónico de HU-65.4 vive en Infrastructure:
`docs/contracts/hu-65-auction-inventory-v1.md`. Ese documento excluye
explícitamente el endpoint de claim ("su endpoint y su claim quedan fuera de
HU-65.4"): la ruta `claim` de este archivo es la materialización de HU-69, no
parte de ese contrato.

Estas rutas internas sólo admiten `auction` con el HMAC existente. Crean
`ACTIVE`, liberan `RELEASED` para `WITHOUT_BIDS`, pasan a `PENDING_CLAIM` para
`WITH_WINNER` y, con `claim`, pasan a `CLAIMED` y entregan el producto al
inventario usable del ganador (`winnerId`), creando su inventario si aun no
existe. `expiresAt` no libera automáticamente. Mongo requiere transacciones
para inventario, commitment y ledger de operaciones idempotentes.
