export interface InventoryGrantItem {
  readonly productId: string
  readonly quantity: number
}

export interface InventoryGrantCommand {
  readonly operationId: string
  readonly playerId: string
  readonly items: readonly InventoryGrantItem[]
}

export interface InventoryGrantResult extends InventoryGrantCommand {
  readonly applied: true
}

export class InventoryGrantConflictError extends Error {
  constructor() {
    super('La operacion ya existe con otros datos.')
    this.name = 'InventoryGrantConflictError'
  }
}

export class InventoryGrantRejectedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'InventoryGrantRejectedError'
  }
}

export class InventoryConcurrentWriteError extends Error {
  constructor() {
    super('El inventario cambio durante la operacion. Vuelva a intentarlo.')
    this.name = 'InventoryConcurrentWriteError'
  }
}

export interface InventoryGrantPort {
  /** Registra el lote y la deduplicacion en la misma transaccion. */
  grant(command: InventoryGrantCommand): Promise<InventoryGrantResult>
}

export const INVENTORY_GRANTS = Symbol('InventoryGrantPort')
