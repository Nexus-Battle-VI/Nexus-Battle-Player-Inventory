import { BadRequestException, Controller, Get, Inject, Param } from '@nestjs/common'

import { DomainError } from '../../../domain/errors/DomainError'
import {
  GET_PRODUCT_OWNERS,
  GetProductOwners,
  type ProductOwnersResult,
} from '../../../application/use-cases/GetProductOwners'
import { InternalOnly } from './auth/decorators'

/**
 * Contrato interno de solo lectura para HU-38 (Management #46, TASK #175).
 *
 * Resuelve la brecha dejada por Notifications#20
 * (`ProductOwnersResolverPort`/`UnavailableProductOwnersResolver`): antes de
 * este endpoint, Notifications no tenia forma de saber que jugadores poseen un
 * producto sin acceder directamente a la base de datos de este servicio, lo
 * cual esta prohibido (ADR-005, frontera de datos entre contextos).
 *
 * Servicio-a-servicio EXCLUSIVAMENTE: `@InternalOnly()` exime del testimonio
 * JWT de jugador y exige en su lugar la firma HMAC de `InternalServiceGuard`
 * -el mismo mecanismo que ya protege `POST /internal/v1/inventory/grants`,
 * sin esquema paralelo-. No se publica mediante Caddy
 * (`handle /api/internal* { respond 404 }` en Infrastructure).
 *
 * HU-38 no transfiere ownership de datos: Player/Inventory sigue siendo el
 * unico dueno del inventario. Este endpoint no expone una lista de
 * propietarios en ninguna ruta publica ni a ningun rol de jugador; existe
 * solo para que Notifications pueda dirigir una notificacion de
 * suspension/reactivacion a quien posee el producto.
 */
@InternalOnly()
@Controller('internal/v1/inventory/products')
export class ProductOwnersController {
  constructor(@Inject(GET_PRODUCT_OWNERS) private readonly getProductOwners: GetProductOwners) {}

  @Get(':productId/owners')
  async owners(@Param('productId') productId: string): Promise<ProductOwnersResult> {
    try {
      return await this.getProductOwners.execute(productId)
    } catch (error: unknown) {
      if (error instanceof DomainError) {
        throw new BadRequestException(error.message)
      }

      throw error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
    }
  }
}
