import { BadRequestException, Controller, Get, Inject, Param } from '@nestjs/common'
import { DomainError } from '../../../domain/errors/DomainError'
import {
  GET_AUCTION_PRODUCT_ELIGIBILITY,
  GetAuctionProductEligibility,
} from '../../../application/use-cases/GetAuctionProductEligibility'
import { InternalCallers, InternalOnly } from './auth/decorators'
import { AuctionEligibilityParams } from './auction-eligibility.dto'
import type { AuctionEligibilityResponse } from './auction-eligibility.dto'

@InternalOnly()
@InternalCallers('auction')
@Controller('internal/v1/inventory/auction-eligibility')
export class AuctionEligibilityController {
  constructor(
    @Inject(GET_AUCTION_PRODUCT_ELIGIBILITY)
    private readonly eligibility: GetAuctionProductEligibility,
  ) {}

  @Get(':ownerId/:productId')
  async get(@Param() params: AuctionEligibilityParams): Promise<AuctionEligibilityResponse> {
    try {
      return await this.eligibility.execute(params.ownerId, params.productId)
    } catch (error: unknown) {
      if (error instanceof DomainError) throw new BadRequestException(error.message)
      throw error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
    }
  }
}
