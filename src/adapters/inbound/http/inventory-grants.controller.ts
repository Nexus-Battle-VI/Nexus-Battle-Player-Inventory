import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { DomainError } from '../../../domain/errors/DomainError'
import {
  InventoryConcurrentWriteError,
  InventoryGrantConflictError,
  InventoryGrantRejectedError,
  type InventoryGrantResult,
} from '../../../application/ports/InventoryGrantPort'
import {
  GRANT_PURCHASED_ITEMS,
  GrantPurchasedItems,
} from '../../../application/use-cases/GrantPurchasedItems'
import { InternalOnly } from './auth/decorators'
import { InventoryGrantRequest } from './inventory-grants.dto'

@InternalOnly()
@Controller('internal/v1/inventory/grants')
export class InventoryGrantsController {
  constructor(@Inject(GRANT_PURCHASED_ITEMS) private readonly grantItems: GrantPurchasedItems) {}

  @Post()
  @HttpCode(200)
  async grant(@Body() body: InventoryGrantRequest): Promise<InventoryGrantResult> {
    try {
      return await this.grantItems.execute(body)
    } catch (error: unknown) {
      if (
        error instanceof InventoryGrantConflictError ||
        error instanceof InventoryConcurrentWriteError
      ) {
        throw new ConflictException(error.message)
      }
      if (error instanceof InventoryGrantRejectedError) {
        throw new UnprocessableEntityException({
          code: 'INVENTORY_REJECTED',
          message: error.message,
        })
      }
      if (error instanceof DomainError) throw new BadRequestException(error.message)
      throw new ServiceUnavailableException(
        'No se pudo registrar la entrega. Reintente con la misma operacion.',
      )
    }
  }
}
