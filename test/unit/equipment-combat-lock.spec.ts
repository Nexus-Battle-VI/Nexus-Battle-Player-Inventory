import {
  BATTLE_LOCK_MESSAGE,
  decideEquipmentChange,
} from '../../src/domain/policies/EquipmentCombatLockPolicy'

describe('EquipmentCombatLockPolicy — HU-29 / RF-29', () => {
  it.each(['WEAPON', 'ARMOR', 'ITEM'] as const)(
    'rechaza modificar %s durante una batalla con una razon estable',
    (category) => {
      expect(decideEquipmentChange(true, category)).toEqual({
        ok: false,
        reason: 'battle_lock',
        message: BATTLE_LOCK_MESSAGE,
      })
    },
  )

  it.each(['WEAPON', 'ARMOR', 'ITEM'] as const)(
    'permite modificar %s fuera de batalla',
    (category) => {
      expect(decideEquipmentChange(false, category)).toEqual({ ok: true })
    },
  )
})
