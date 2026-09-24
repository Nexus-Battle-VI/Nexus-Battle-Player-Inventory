import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  AUCTION_COMMITMENT_USE_CASE,
  AuctionCommitments,
} from '../../../application/use-cases/AuctionCommitments'
import {
  AuctionCommitmentConflictError,
  AuctionCommitmentNotFoundError,
  AuctionCommitmentRejectedError,
} from '../../../application/ports/AuctionCommitmentPort'
import { InternalCallers, InternalOnly } from './auth/decorators'
import {
  ClaimAuctionCommitmentRequest,
  CreateAuctionCommitmentRequest,
  PendingAuctionCommitmentRequest,
  ReleaseAuctionCommitmentRequest,
} from './auction-commitments.dto'

@InternalOnly()
@InternalCallers('auction')
@Controller('internal/v1/inventory/auction-commitments')
export class AuctionCommitmentsController {
  constructor(@Inject(AUCTION_COMMITMENT_USE_CASE) private readonly useCase: AuctionCommitments) {}
  @Post() @HttpCode(200) async commit(@Body() body: CreateAuctionCommitmentRequest) {
    return this.run(() => this.useCase.commit(body))
  }
  @Post(':commitmentId/release') @HttpCode(200) async release(
    @Param('commitmentId') commitmentId: string,
    @Body() body: ReleaseAuctionCommitmentRequest,
  ) {
    return this.run(() =>
      this.useCase.release({
        operationId: body.operationId,
        auctionId: body.auctionId,
        ownerId: body.ownerId,
        productId: body.productId,
        reason: body.reason,
        commitmentId,
      }),
    )
  }
  @Post(':commitmentId/pending-claim') @HttpCode(200) async pending(
    @Param('commitmentId') commitmentId: string,
    @Body() body: PendingAuctionCommitmentRequest,
  ) {
    return this.run(() =>
      this.useCase.markPendingClaim({
        operationId: body.operationId,
        auctionId: body.auctionId,
        sellerId: body.sellerId,
        winnerId: body.winnerId,
        productId: body.productId,
        commitmentId,
      }),
    )
  }
  @Post(':commitmentId/claim') @HttpCode(200) async claim(
    @Param('commitmentId') commitmentId: string,
    @Body() body: ClaimAuctionCommitmentRequest,
  ) {
    return this.run(() =>
      this.useCase.claim({
        operationId: body.operationId,
        auctionId: body.auctionId,
        winnerId: body.winnerId,
        productId: body.productId,
        commitmentId,
      }),
    )
  }
  private async run(action: () => Promise<unknown>): Promise<unknown> {
    try {
      return await action()
    } catch (error: unknown) {
      if (error instanceof AuctionCommitmentConflictError)
        throw new ConflictException(error.message)
      if (error instanceof AuctionCommitmentNotFoundError)
        throw new NotFoundException(error.message)
      if (error instanceof AuctionCommitmentRejectedError)
        throw new UnprocessableEntityException({
          code: 'AUCTION_COMMITMENT_REJECTED',
          message: error.message,
        })
      throw new ServiceUnavailableException(
        'No se pudo registrar el commitment. Reintente con la misma operacion.',
      )
    }
  }
}
