# Auction commitments (HU-65.4)

El contrato canónico vive en Infrastructure: `docs/contracts/hu-65-auction-inventory-v1.md`.
Estas rutas internas sólo admiten `auction` con el HMAC existente. Crean `ACTIVE`,
liberan `RELEASED` para `WITHOUT_BIDS` y pasan a `PENDING_CLAIM` para
`WITH_WINNER`. `expiresAt` no libera automáticamente y HU-65.4 no concede el
producto al ganador. Mongo requiere transacciones para inventario, commitment
y ledger de operaciones idempotentes.
