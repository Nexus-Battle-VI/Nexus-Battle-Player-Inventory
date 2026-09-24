import type {
  AuctionCommitmentPort,
  AuctionCommitmentResult,
  ClaimAuctionCommitment,
  CreateAuctionCommitment,
  PendingAuctionCommitment,
  ReleaseAuctionCommitment,
} from '../../../application/ports/AuctionCommitmentPort'
import {
  AuctionCommitmentConflictError,
  AuctionCommitmentNotFoundError,
  AuctionCommitmentRejectedError,
  AuctionCommitmentStatus,
} from '../../../application/ports/AuctionCommitmentPort'
import type { InMemoryInventoryRepository } from './InMemoryInventoryRepository'
import { Inventory } from '../../../domain/entities/Inventory'
import { CapacityPolicy } from '../../../domain/policies/CapacityPolicy'
import { ItemId, PlayerId, Quantity } from '../../../domain/value-objects/identifiers'
import type { InMemoryHeroLoadoutRepository } from './InMemoryHeroLoadoutRepository'

interface Commitment {
  id: string
  auctionId: string
  ownerId: string
  productId: string
  winnerId?: string
  status: AuctionCommitmentStatus
  expiresAt: string
}
interface Operation {
  fingerprint: string
  result: AuctionCommitmentResult
}
const clone = <T>(value: T): T => structuredClone(value)

export class InMemoryAuctionCommitmentRepository implements AuctionCommitmentPort {
  private readonly commitments = new Map<string, Commitment>()
  private readonly operations = new Map<string, Operation>()
  constructor(
    private readonly inventories: InMemoryInventoryRepository,
    private readonly missionGates?: Pick<
      InMemoryHeroLoadoutRepository,
      'hasActiveMission' | 'isEquippedByActiveMission'
    >,
  ) {}
  async commit(input: CreateAuctionCommitment): Promise<AuctionCommitmentResult> {
    const fingerprint = JSON.stringify(input)
    const replay = this.replay(input.operationId, fingerprint)
    if (replay) return replay
    const inventory = await this.inventories.findByOwner(PlayerId.create(input.ownerId))
    const item = ItemId.create(input.productId)
    if (inventory === null || inventory.quantityOf(item) < 1)
      throw new AuctionCommitmentRejectedError('El vendedor no posee el producto.')
    if (
      this.missionGates?.hasActiveMission(input.ownerId, item.value) ||
      this.missionGates?.isEquippedByActiveMission(input.ownerId, item.value)
    ) {
      throw new AuctionCommitmentRejectedError('El heroe esta reservado para una mision.')
    }
    inventory.remove(item, Quantity.create(1), new Date())
    await this.inventories.save(inventory)
    const commitment: Commitment = {
      id: crypto.randomUUID(),
      auctionId: input.auctionId,
      ownerId: input.ownerId,
      productId: input.productId,
      status: AuctionCommitmentStatus.Active,
      expiresAt: input.expiresAt,
    }
    this.commitments.set(commitment.id, commitment)
    return this.store(input.operationId, fingerprint, {
      operationId: input.operationId,
      commitmentId: commitment.id,
      status: commitment.status,
      applied: true,
    })
  }
  async release(input: ReleaseAuctionCommitment): Promise<AuctionCommitmentResult> {
    const fingerprint = JSON.stringify(input)
    const replay = this.replay(input.operationId, fingerprint)
    if (replay) return replay
    const c = this.must(input.commitmentId, input.auctionId, input.ownerId, input.productId)
    if (c.status !== AuctionCommitmentStatus.Active)
      throw new AuctionCommitmentRejectedError(
        'El commitment no puede liberarse en su estado actual.',
      )
    const inventory = await this.inventories.findByOwner(PlayerId.create(c.ownerId))
    if (!inventory)
      throw new AuctionCommitmentRejectedError('El inventario del vendedor no existe.')
    inventory.add(ItemId.create(c.productId), Quantity.create(1), new Date())
    await this.inventories.save(inventory)
    c.status = AuctionCommitmentStatus.Released
    return this.store(input.operationId, fingerprint, {
      operationId: input.operationId,
      commitmentId: c.id,
      status: c.status,
      applied: true,
    })
  }
  markPendingClaim(input: PendingAuctionCommitment): Promise<AuctionCommitmentResult> {
    const fingerprint = JSON.stringify(input)
    const replay = this.replay(input.operationId, fingerprint)
    if (replay) return Promise.resolve(replay)
    const c = this.must(input.commitmentId, input.auctionId, input.sellerId, input.productId)
    if (c.status !== AuctionCommitmentStatus.Active)
      throw new AuctionCommitmentRejectedError(
        'El commitment no puede pasar a pending claim en su estado actual.',
      )
    c.status = AuctionCommitmentStatus.PendingClaim
    c.winnerId = input.winnerId
    return Promise.resolve(
      this.store(input.operationId, fingerprint, {
        operationId: input.operationId,
        commitmentId: c.id,
        status: c.status,
        winnerId: c.winnerId,
        applied: true,
      }),
    )
  }
  async claim(input: ClaimAuctionCommitment): Promise<AuctionCommitmentResult> {
    const fingerprint = JSON.stringify(input)
    const replay = this.replay(input.operationId, fingerprint)
    if (replay) return replay
    const c = this.commitments.get(input.commitmentId)
    if (!c) throw new AuctionCommitmentNotFoundError()
    if (
      c.auctionId !== input.auctionId ||
      c.productId !== input.productId ||
      c.winnerId !== input.winnerId
    )
      throw new AuctionCommitmentRejectedError('El intent no coincide con el commitment.')
    if (c.status !== AuctionCommitmentStatus.PendingClaim)
      throw new AuctionCommitmentRejectedError(
        'El commitment no puede reclamarse en su estado actual.',
      )
    const winner = PlayerId.create(input.winnerId)
    const inventory =
      (await this.inventories.findByOwner(winner)) ?? Inventory.createEmpty(winner, CapacityPolicy.default())
    inventory.add(ItemId.create(c.productId), Quantity.create(1), new Date())
    await this.inventories.save(inventory)
    c.status = AuctionCommitmentStatus.Claimed
    return this.store(input.operationId, fingerprint, {
      operationId: input.operationId,
      commitmentId: c.id,
      status: c.status,
      winnerId: c.winnerId,
      applied: true,
    })
  }
  private must(id: string, auctionId: string, ownerId: string, productId: string): Commitment {
    const c = this.commitments.get(id)
    if (!c) throw new AuctionCommitmentNotFoundError()
    if (c.auctionId !== auctionId || c.ownerId !== ownerId || c.productId !== productId)
      throw new AuctionCommitmentRejectedError('El intent no coincide con el commitment.')
    return c
  }
  private replay(id: string, fingerprint: string): AuctionCommitmentResult | undefined {
    const old = this.operations.get(id)
    if (!old) return undefined
    if (old.fingerprint !== fingerprint) throw new AuctionCommitmentConflictError()
    return { ...clone(old.result), applied: false }
  }
  private store(
    id: string,
    fingerprint: string,
    result: AuctionCommitmentResult,
  ): AuctionCommitmentResult {
    this.operations.set(id, { fingerprint, result: clone(result) })
    return result
  }
}
