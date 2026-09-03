# Entrega interna de compras (HU-59)

Para probar sin Docker puede definirse `MONGO_TEST_URI` apuntando a un Mongo replica set de pruebas. Cada suite crea una base `test_*_<UUID>` aislada y la elimina al finalizar; no usa la base de la aplicacion. Sin esa variable CI usa Testcontainers.

Commerce entrega un lote mediante `POST /api/internal/v1/inventory/grants`. El servicio no descuenta Catalog: la reserva y su confirmacion pertenecen al coordinador de Commerce.

```json
{
  "operationId": "22222222-2222-4222-8222-222222222222",
  "playerId": "cognito-sub-del-jugador",
  "items": [{ "productId": "11111111-1111-4111-8111-111111111111", "quantity": 2 }]
}
```

El lote admite 1..200 productos distintos, UUID v1-5 y cantidades 1..9999. Las referencias se normalizan a minusculas y se ordenan para comparar reintentos. El inventario conserva su capacidad actual (30 ranuras por defecto) y el maximo de 9999 unidades por producto. Las lecturas y operaciones del usuario siguen admitiendo identificadores legacy en kebab-case y ahora tambien UUID de Catalog.

## Autenticacion

Solo se admite `x-internal-service: commerce`, con `x-internal-timestamp` en milisegundos Unix y `x-internal-signature` hexadecimal HMAC-SHA256. La cadena firmada es:

```text
commerce
POST
/api/internal/v1/inventory/grants
<TIMESTAMP>
<SHA256 del JSON canonico>
```

El JSON canonico ordena claves recursivamente, conserva el orden de arrays y no agrega espacios. El secreto es `INTERNAL_SERVICE_AUTH_SECRET`; la ventana temporal es 30 segundos. Se renueva timestamp/firma al reintentar, conservando operationId/cuerpo. Esta ruta exige HMAC incluso cuando AUTH_MODE=disabled. No usa JWT ni debe exponerse mediante el proxy publico. Las rutas del usuario conservan su autenticacion JWT.

## Resultados y persistencia

| HTTP | Resultado                                                              | Accion del coordinador                            |
| ---- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| 200  | `{operationId,playerId,items,applied:true}` estable en replay          | Continuar confirmacion                            |
| 400  | Cuerpo invalido                                                        | Corregir contrato                                 |
| 401  | Firma, servicio o fecha invalidos                                      | Corregir autenticacion                            |
| 409  | operationId reutilizado con otro jugador/lote, o escritura concurrente | Mantener pendiente; no asumir que no hubo entrega |
| 422  | `{code:"INVENTORY_REJECTED",message}`                                  | Rechazo terminal: puede liberar la reserva        |
| 503  | Dependencia o secreto no disponible                                    | Reintentar el mismo operationId                   |

Con `PERSISTENCE_DRIVER=mongo`, una transaccion con lectura snapshot y escritura majority guarda el inventario completo y el resultado en `inventory_grants`. Un error de capacidad o apilado guarda el rechazo terminal sin modificar ninguna ranura. Ese rechazo permanece aunque luego se libere espacio; una compra nueva necesita otro operationId. Los resultados no caducan. El guardado publico usa revision CAS para impedir que una lectura anterior sobrescriba una entrega concurrente.

La migracion `002-purchase-grants` amplia el validador existente y crea el ledger. Antes de arrancar: `npm ci`, `npm run build`, `npm run migrate`. Requiere MongoDB replica set o cluster con soporte de transacciones; una instancia standalone no basta. Configurar `MONGODB_URI` con el replica set y `PERSISTENCE_DRIVER=mongo`. Produccion rechaza entregas con persistencia memory. Memory es solo un doble de desarrollo/pruebas.

## Verificacion

`npm run test:coverage -- --runInBand` valida dominio, HTTP, HMAC, replay y rechazos. `npm run test:db -- --runInBand` inicia MongoDB real con Testcontainers: prueba transacciones, reintentos concurrentes, reinicio del repositorio, rechazo terminal despues de liberar espacio y proteccion CAS del flujo legacy. Docker es requisito de esta ultima suite.
