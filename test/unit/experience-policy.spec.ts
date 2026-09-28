import { DomainError } from '../../src/domain/errors/DomainError'
import {
  LEVEL_UP_THRESHOLDS,
  MAX_HERO_LEVEL,
  MIN_HERO_LEVEL,
  experienceRequiredForNextLevel,
  isHeroLevel,
  levelFromTotalXp,
} from '../../src/domain/policies/ExperiencePolicy'

/**
 * HU-08 / RF-08 — umbral de experiencia por nivel (Task #189).
 *
 * SEMANTICA VIGENTE: cada umbral es la XP ACUMULADA necesaria para PASAR del
 * nivel actual al siguiente (`1->2 = 100`, `2->3 = 300`, ... `7->8 = 1300`). El
 * nivel 8 es el maximo y no hay nivel 9.
 *
 * Los valores estan escritos aqui uno a uno y no derivados de una expresion: si
 * alguien cambiara la tabla, esta suite falla y hay que volver a pasar por el PO.
 *
 * LA TABLA SUSTITUYE, POR DECISION FUNCIONAL POSTERIOR, A LA FORMULA ORIGINAL DEL
 * PDF (`100 x 1,2^(n - 1)`) Y A LA TABLA TEMPORAL `100, 200, 400 ... 12800`.
 */
describe('ExperiencePolicy — HU-08 / RF-08', () => {
  describe('la tabla vigente', () => {
    it('son los siete umbrales vigentes, uno por paso de nivel (1->2 ... 7->8)', () => {
      expect(LEVEL_UP_THRESHOLDS).toEqual([100, 300, 500, 700, 900, 1100, 1300])
      expect(LEVEL_UP_THRESHOLDS).toHaveLength(MAX_HERO_LEVEL - MIN_HERO_LEVEL)
    })

    it('es inmutable: nadie puede reescribir la regla desde fuera', () => {
      expect(Object.isFrozen(LEVEL_UP_THRESHOLDS)).toBe(true)
    })

    it('crece estrictamente: mas nivel nunca cuesta menos experiencia', () => {
      for (let index = 1; index < LEVEL_UP_THRESHOLDS.length; index += 1) {
        const previous = LEVEL_UP_THRESHOLDS[index - 1] ?? 0
        const current = LEVEL_UP_THRESHOLDS[index] ?? 0

        expect(current).toBeGreaterThan(previous)
      }
    })

    it('sus siete valores son enteros: no hay nada que redondear', () => {
      for (const threshold of LEVEL_UP_THRESHOLDS) {
        expect(Number.isInteger(threshold)).toBe(true)
      }
    })
  })

  describe('niveles validos con siguiente nivel', () => {
    it('el nivel minimo (1) necesita 100 acumulados para pasar al 2', () => {
      expect(experienceRequiredForNextLevel(1)).toEqual({
        status: 'AVAILABLE',
        forNextLevel: 2,
        amount: 100,
      })
    })

    it('un nivel intermedio (4) necesita 700 acumulados para pasar al 5', () => {
      expect(experienceRequiredForNextLevel(4)).toEqual({
        status: 'AVAILABLE',
        forNextLevel: 5,
        amount: 700,
      })
    })

    it('el nivel 7 es el ultimo con siguiente nivel y necesita 1300', () => {
      expect(experienceRequiredForNextLevel(7)).toEqual({
        status: 'AVAILABLE',
        forNextLevel: 8,
        amount: 1300,
      })
    })

    it('los siete umbrales son los de la tabla, sin excepcion', () => {
      const expected = [100, 300, 500, 700, 900, 1100, 1300]

      for (const [index, amount] of expected.entries()) {
        const level = MIN_HERO_LEVEL + index
        const result = experienceRequiredForNextLevel(level)

        expect(result.status).toBe('AVAILABLE')
        expect(result.amount).toBe(amount)
        expect(result.forNextLevel).toBe(level + 1)
      }
    })
  })

  describe('nivel maximo', () => {
    it('el nivel 8 devuelve MAX_LEVEL y ningun umbral', () => {
      expect(experienceRequiredForNextLevel(MAX_HERO_LEVEL)).toEqual({
        status: 'MAX_LEVEL',
        currentLevel: 8,
        forNextLevel: null,
        amount: null,
      })
    })

    it('nunca calcula un nivel 9: el resultado no declara siguiente nivel', () => {
      // La forma completa se compara de una vez. El contrato de `currentLevel`
      // solo existe en la variante MAX_LEVEL, asi que comprobarlo por partes
      // exigiria un estrechamiento que TypeScript no puede deducir de un
      // `expect`.
      expect(experienceRequiredForNextLevel(8)).toEqual({
        status: 'MAX_LEVEL',
        currentLevel: MAX_HERO_LEVEL,
        forNextLevel: null,
        amount: null,
      })
    })

    it('el umbral mas alto que existe es el del nivel 7 hacia el 8, no mas alla', () => {
      // El siguiente nivel declarado nunca supera MAX_HERO_LEVEL: es la
      // comprobacion directa de "no calcular un siguiente nivel fuera del rango".
      for (let level = MIN_HERO_LEVEL; level < MAX_HERO_LEVEL; level += 1) {
        const result = experienceRequiredForNextLevel(level)

        expect(result.status).toBe('AVAILABLE')
        expect(result).toMatchObject({ forNextLevel: level + 1 })
        expect(result.forNextLevel).toBeLessThanOrEqual(MAX_HERO_LEVEL)
      }
    })
  })

  describe('levelFromTotalXp: de acumulado a nivel', () => {
    it('fronteras exactas de los ocho niveles (decision funcional vigente)', () => {
      const boundaries: readonly (readonly [number, number])[] = [
        [0, 1],
        [99, 1],
        [100, 2],
        [299, 2],
        [300, 3],
        [499, 3],
        [500, 4],
        [699, 4],
        [700, 5],
        [899, 5],
        [900, 6],
        [1099, 6],
        [1100, 7],
        [1299, 7],
        [1300, 8],
        [999_999, 8],
      ]

      for (const [xp, level] of boundaries) {
        expect([xp, levelFromTotalXp(xp)]).toEqual([xp, level])
      }
    })

    it('el nivel 1 es el suelo: sin llegar a 100 se sigue en 1', () => {
      expect(levelFromTotalXp(0)).toBe(1)
      expect(levelFromTotalXp(1)).toBe(1)
      expect(levelFromTotalXp(99)).toBe(1)
    })

    it('alcanzar un umbral SUBE de nivel en ese mismo valor, y no antes', () => {
      for (const [index, threshold] of LEVEL_UP_THRESHOLDS.entries()) {
        const levelBefore = MIN_HERO_LEVEL + index

        expect(levelFromTotalXp(threshold)).toBe(levelBefore + 1)
        expect(levelFromTotalXp(threshold - 1)).toBe(levelBefore)
      }
    })

    it('es monotona: mas experiencia nunca da menos nivel', () => {
      let previous = MIN_HERO_LEVEL

      for (let xp = 0; xp <= 1500; xp += 5) {
        const level = levelFromTotalXp(xp)

        expect(level).toBeGreaterThanOrEqual(previous)
        previous = level
      }
    })

    it('el tope no descarta experiencia: por encima de la tabla sigue siendo 8', () => {
      expect(levelFromTotalXp(1300)).toBe(8)
      expect(levelFromTotalXp(6300)).toBe(8)
      expect(levelFromTotalXp(1_000_000)).toBe(8)
    })

    it('las dos direcciones de la tabla concuerdan', () => {
      // El umbral que declara la politica para el siguiente nivel tiene que ser
      // el acumulado que produce ese nivel. Si alguien moviera una de las dos
      // operaciones, esto lo delata.
      for (let level = MIN_HERO_LEVEL; level < MAX_HERO_LEVEL; level += 1) {
        const threshold = experienceRequiredForNextLevel(level)

        expect(threshold.status).toBe('AVAILABLE')

        if (threshold.status === 'AVAILABLE') {
          expect(levelFromTotalXp(threshold.amount)).toBe(threshold.forNextLevel)
          expect(levelFromTotalXp(threshold.amount - 1)).toBe(level)
        }
      }
    })

    it('rechaza un acumulado negativo, fraccionario o de otro tipo', () => {
      const invalidos = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '520', null, undefined]

      for (const invalid of invalidos) {
        expect(() => levelFromTotalXp(invalid)).toThrow(DomainError)
      }
    })
  })

  describe('entradas invalidas', () => {
    it('rechaza el nivel 0 y los negativos', () => {
      expect(() => experienceRequiredForNextLevel(0)).toThrow(DomainError)
      expect(() => experienceRequiredForNextLevel(-1)).toThrow(DomainError)
    })

    it('rechaza el nivel superior a 8', () => {
      expect(() => experienceRequiredForNextLevel(9)).toThrow(DomainError)
      expect(() => experienceRequiredForNextLevel(99)).toThrow(DomainError)
    })

    it('rechaza un nivel no entero en lugar de truncarlo', () => {
      expect(() => experienceRequiredForNextLevel(2.5)).toThrow(DomainError)
      expect(() => experienceRequiredForNextLevel(7.0000001)).toThrow(DomainError)
    })

    it('rechaza una cadena numerica en lugar de convertirla', () => {
      expect(() => experienceRequiredForNextLevel('3')).toThrow(DomainError)
    })

    it('rechaza NaN, Infinity, null y undefined', () => {
      for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
        expect(() => experienceRequiredForNextLevel(invalid)).toThrow(DomainError)
      }
    })

    it('no normaliza en silencio: un 9 no se recorta a 8', () => {
      // Si normalizara, devolveria MAX_LEVEL en vez de fallar.
      expect(() => experienceRequiredForNextLevel(9)).toThrow(DomainError)
    })
  })

  describe('determinismo y pureza', () => {
    it('la consulta repetida produce el mismo resultado para la misma entrada', () => {
      for (const level of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const first = experienceRequiredForNextLevel(level)
        const second = experienceRequiredForNextLevel(level)

        expect(second).toEqual(first)
      }
    })

    it('no muta la entrada ni guarda estado entre llamadas', () => {
      const level = 4
      const before = JSON.stringify(experienceRequiredForNextLevel(level))
      const after = JSON.stringify(experienceRequiredForNextLevel(level))

      expect(after).toBe(before)
      expect(level).toBe(4)
    })

    it('el nivel resuelto no depende de haber consultado otros acumulados antes', () => {
      const ascending = [0, 100, 520, 1100, 5000].map(levelFromTotalXp)
      const descending = [5000, 1100, 520, 100, 0].map(levelFromTotalXp).reverse()

      expect(descending).toEqual(ascending)
    })
  })

  describe('isHeroLevel', () => {
    it('acepta solo enteros dentro del rango', () => {
      expect(isHeroLevel(1)).toBe(true)
      expect(isHeroLevel(8)).toBe(true)
      expect(isHeroLevel(0)).toBe(false)
      expect(isHeroLevel(9)).toBe(false)
      expect(isHeroLevel(2.5)).toBe(false)
      expect(isHeroLevel('3')).toBe(false)
      expect(isHeroLevel(null)).toBe(false)
    })
  })
})
