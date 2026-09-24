import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export class AuctionEligibilityParams {
  @IsString() @MinLength(1) @MaxLength(200) ownerId!: string
  @IsUUID() productId!: string
}

export interface AuctionEligibilityResponse {
  readonly ownerId: string
  readonly productId: string
  readonly ownedByPlayer: boolean
  readonly inUse: boolean
}
