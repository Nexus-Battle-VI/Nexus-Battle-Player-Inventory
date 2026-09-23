import type {
  AuctionCommitmentPort,
  AuctionCommitmentResult,
  CreateAuctionCommitment,
  PendingAuctionCommitment,
  ReleaseAuctionCommitment,
} from '../ports/AuctionCommitmentPort'

export class AuctionCommitments {
  constructor(private readonly commitments: AuctionCommitmentPort) {}
  commit(input: CreateAuctionCommitment): Promise<AuctionCommitmentResult> {
    return this.commitments.commit(input)
  }
  release(input: ReleaseAuctionCommitment): Promise<AuctionCommitmentResult> {
    return this.commitments.release(input)
  }
  markPendingClaim(input: PendingAuctionCommitment): Promise<AuctionCommitmentResult> {
    return this.commitments.markPendingClaim(input)
  }
}
export const AUCTION_COMMITMENT_USE_CASE = Symbol('AuctionCommitments')
