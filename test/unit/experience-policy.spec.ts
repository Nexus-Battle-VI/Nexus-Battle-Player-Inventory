import { DomainError } from '../../src/domain/errors/DomainError'
import {
  EXPERIENCE_THRESHOLDS,
  MAX_HERO_LEVEL,
  MIN_HERO_LEVEL,
  experienceRequiredForNextLevel,
  isHeroLevel,
  levelFromTotalXp,
} from '../../src/domain/policies/ExperiencePolicy'

/**
 * HU-08 / RF-08 — umbral de experiencia por nivel (Task #189).
 *
 * Cubre los escenarios que la Task exige: nivel minimo, intermedios, nivel 7,
 * nivel maximo 8, inferior a 1, superior a 8, y consulta repetida con el mismo
 * resultado. Anade la otra direccion de la tabla -- de acumulado a nivel -- que
 * es la que necesita quien acredita una recompensa.
 *
 * LOS VALORES SON LOS QUE APROBO EL PRODUCT OWNER, escritos aqui uno a uno y no
 * derivados de una expresion. Si alguien cambiara la tabla, esta suite falla y
 * hay que volver a pasar por el PO: es el control que impide que una tabla
 * distinta entre sin que nadie lo note. La regresion contra un fichero de
 * referencia guardado aparte es la Task #190.
 *
 * LA TABLA SUSTITUYE A LA FORMULA `100 x 1,2^(n - 1)` DE CA-03, que daba 100,
 * 120, 144, 172,8, 207,36, 248,832 y 298,5984. No es una diferencia de redondeo:
 * son sucesiones distintas. La divergencia esta medida en
 * `docs/hu-08-progresion.md`, seccion 3.
 */
describe('ExperiencePolicy — HU-08 / RF-08', () => {
  describe('la tabla aprobada', () => {
    it('son los ocho valores aprobados, uno por nivel y de 1 a 8', () => {
      expect(EXPERIENCE_THRESHOLDS).toEqual([100, 200, 400, 800, 1600, 3200, 6400, 12800])
      expect(EXPERIENCE_THRESHOLDS).toHaveLength(MAX_HERO_LEVEL - MIN_HERO_LEVEL + 1)
    })

    it('es inmutable: nadie puede reescribir la regla desde fuera', () => {
      expect(Object.isFrozen(EXPERIENCE_THRESHOLDS)).toBe(true)
    })

    it('crece estrictamente: mas nivel nunca cuesta menos experiencia', () => {
      for (let index = 1; index < EXPERIENCE_THRESHOLDS.length; index += 1) {
        const previous = EXPERIENCE_THRESHOLDS[index - 1] ?? 0
        const current = EXPERIENCE_THRESHOLDS[index] ?? 0

        expect(current).toBeGreaterThan(previous)
      }
    })

    it('sus ocho valores son enteros: no hay nada que redondear', () => {
      for (const threshold of EXPERIENCE_THRESHOLDS) {
        expect(Number.isInteger(threshold)).toBe(true)
      }
    })
  })

  describe('niveles validos con siguiente nivel', () => {
    it('el nivel minimo (1) necesita 200 acumulados para llegar al 2', () => {
      expect(experienceRequiredForNextLevel(1)).toEqual({
        status: 'AVAILABLE',
        forNextLevel: 2,
        amount: 200,
      })
    })

    it('un nivel intermedio (4) necesita 1600 acumulados para llegar al 5', () => {
      expect(experienceRequiredForNextLevel(4)).toEqual({
        status: 'AVAILABLE',
        forNextLevel: 5,
        amount: 1600,
      })
    })

    it('el nivel 7 es el ultimo con siguiente nivel y necesita 12800', () => {
      expect(experienceRequiredForNextLevel(7)).toEqual({
        status: 'AVAILABLE',
        forNextLevel: 8,
        amount: 12800,
      })
    })

    it('los siete umbrales son los de la tabla, sin excepcion', () => {
      const expected = [200, 400, 800, 1600, 3200, 6400, 12800]

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
    it('los cuatro vectores que aprobo el Product Owner', () => {
      expect(levelFromTotalXp(749)).toBe(3)
      expect(levelFromTotalXp(3500)).toBe(6)
      expect(levelFromTotalXp(890)).toBe(4)
      expect(levelFromTotalXp(13000)).toBe(8)
    })

    it('el nivel 1 es el suelo: sin llegar al primer umbral se sigue en 1', () => {
      expect(levelFromTotalXp(0)).toBe(1)
      expect(levelFromTotalXp(1)).toBe(1)
      expect(levelFromTotalXp(99)).toBe(1)
      // Con 100 acumulados se alcanza UMBRAL[1], y la respuesta sigue siendo el
      // nivel 1: el umbral del nivel 2 es 200.
      expect(levelFromTotalXp(100)).toBe(1)
      expect(levelFromTotalXp(199)).toBe(1)
    })

    it('cada umbral se alcanza exactamente en su valor, y no antes', () => {
      for (const [index, threshold] of EXPERIENCE_THRESHOLDS.entries()) {
        const expectedLevel = MIN_HERO_LEVEL + index

        expect(levelFromTotalXp(threshold)).toBe(expectedLevel)
        expect(levelFromTotalXp(threshold - 1)).toBe(Math.max(MIN_HERO_LEVEL, expectedLevel - 1))
      }
    })

    it('es monotona: mas experiencia nunca da menos nivel', () => {
      let previous = MIN_HERO_LEVEL

      for (let xp = 0; xp <= 14000; xp += 25) {
        const level = levelFromTotalXp(xp)

        expect(level).toBeGreaterThanOrEqual(previous)
        previous = level
      }
    })

    it('el tope no descarta experiencia: por encima de la tabla sigue siendo 8', () => {
      expect(levelFromTotalXp(12800)).toBe(8)
      expect(levelFromTotalXp(13500)).toBe(8)
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
      const invalidos = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '890', null, undefined]

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
      const ascending = [0, 200, 800, 3500, 13000].map(levelFromTotalXp)
      const descending = [13000, 3500, 800, 200, 0].map(levelFromTotalXp).reverse()

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
