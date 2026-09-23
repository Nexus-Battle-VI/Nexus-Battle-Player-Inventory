import { IsDateString, IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

class Base {
  @IsString() @MinLength(1) @MaxLength(200) operationId!: string
  @IsString() @MinLength(1) @MaxLength(200) auctionId!: string
  @IsUUID() productId!: string
}
export class CreateAuctionCommitmentRequest extends Base {
  @IsString() @MinLength(1) @MaxLength(200) ownerId!: string
  @IsDateString() expiresAt!: string
}
export class ReleaseAuctionCommitmentRequest extends Base {
  @IsString() @MinLength(1) @MaxLength(200) ownerId!: string
  @IsIn(['AUCTION_WITHOUT_BIDS']) reason!: 'AUCTION_WITHOUT_BIDS'
}
export class PendingAuctionCommitmentRequest extends Base {
  @IsString() @MinLength(1) @MaxLength(200) sellerId!: string
  @IsString() @MinLength(1) @MaxLength(200) winnerId!: string
}
