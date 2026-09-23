export const AuctionCommitmentStatus = {
  Active: 'ACTIVE',
  PendingClaim: 'PENDING_CLAIM',
  Released: 'RELEASED',
} as const

export type AuctionCommitmentStatus =
  (typeof AuctionCommitmentStatus)[keyof typeof AuctionCommitmentStatus]

export interface AuctionCommitmentResult {
  readonly operationId: string
  readonly commitmentId: string
  readonly status: AuctionCommitmentStatus
  readonly winnerId?: string
  readonly applied: boolean
}

export interface CreateAuctionCommitment {
  readonly operationId: string
  readonly auctionId: string
  readonly ownerId: string
  readonly productId: string
  readonly expiresAt: string
}

export interface ReleaseAuctionCommitment {
  readonly operationId: string
  readonly commitmentId: string
  readonly auctionId: string
  readonly ownerId: string
  readonly productId: string
  readonly reason: 'AUCTION_WITHOUT_BIDS'
}

export interface PendingAuctionCommitment {
  readonly operationId: string
  readonly commitmentId: string
  readonly auctionId: string
  readonly sellerId: string
  readonly winnerId: string
  readonly productId: string
}

export class AuctionCommitmentConflictError extends Error {
  constructor(message = 'La operacion o el producto comprometido entra en conflicto.') {
    super(message)
    this.name = 'AuctionCommitmentConflictError'
  }
}
export class AuctionCommitmentNotFoundError extends Error {
  constructor() {
    super('El commitment no existe.')
    this.name = 'AuctionCommitmentNotFoundError'
  }
}
export class AuctionCommitmentRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuctionCommitmentRejectedError'
  }
}

export interface AuctionCommitmentPort {
  commit(input: CreateAuctionCommitment): Promise<AuctionCommitmentResult>
  release(input: ReleaseAuctionCommitment): Promise<AuctionCommitmentResult>
  markPendingClaim(input: PendingAuctionCommitment): Promise<AuctionCommitmentResult>
}
export const AUCTION_COMMITMENTS = Symbol('AuctionCommitmentPort')
