import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'

import { HeroProfileController } from '../../src/adapters/inbound/http/hero-profile.controller'
import { CatalogUnavailableError } from '../../src/application/ports/CatalogReadPort'
import { HeroNotOwnedError } from '../../src/application/errors/ApplicationError'
import type { HeroProfileDto } from '../../src/application/dto/HeroProfileDto'
import type { GetHeroProfileForMission } from '../../src/application/use-cases/GetHeroProfileForMission'
import { DomainError } from '../../src/domain/errors/DomainError'

/**
 * HU-71: traduccion de errores del controlador del perfil de heroe.
 *
 * Se prueba aparte del HTTP porque hay caminos que la ruta no puede provocar --un
 * `DomainError` exige un identificador en blanco, y un segmento vacio no llega a
 * enrutar-- y porque el `code` del `404` es PARTE DEL CONTRATO: el consumidor solo
 * acepta el `404` como «el heroe no es de ese jugador» si el cuerpo trae
 * `HERO_NOT_OWNED`.
 */
const controllerFor = (execute: () => Promise<HeroProfileDto>): HeroProfileController =>
  new HeroProfileController({ execute } as unknown as GetHeroProfileForMission)

describe('HeroProfileController — traduccion de errores (HU-71)', () => {
  it('un heroe ajeno es 404 CON `code: HERO_NOT_OWNED`', async () => {
    const controller = controllerFor(() => Promise.reject(new HeroNotOwnedError('pid-ajeno')))

    await expect(controller.heroProfile('jugador-1', 'pid-ajeno')).rejects.toBeInstanceOf(
      NotFoundException,
    )

    try {
      await controller.heroProfile('jugador-1', 'pid-ajeno')
    } catch (error: unknown) {
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'HERO_NOT_OWNED',
      })
    }
  })

  it('Catalog caido es 503', async () => {
    const controller = controllerFor(() => Promise.reject(new CatalogUnavailableError('prueba')))

    await expect(controller.heroProfile('jugador-1', 'pid-heroe')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })

  it('un identificador en blanco es 400', async () => {
    const controller = controllerFor(() =>
      Promise.reject(new DomainError('El perfil necesita un heroe.')),
    )

    await expect(controller.heroProfile('jugador-1', '   ')).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('un fallo desconocido NO se disfraza de error del cliente', async () => {
    const original = new Error('se rompio algo')
    const controller = controllerFor(() => Promise.reject(original))

    await expect(controller.heroProfile('jugador-1', 'pid-heroe')).rejects.toBe(original)
  })

  it('un rechazo que no es `Error` se convierte en un error legible', async () => {
    // El motivo del rechazo es A PROPOSITO algo que no es un `Error`: es la unica
    // forma de ejercer la ultima rama de la traduccion. Un caso de uso de este
    // servicio no lo produce, pero un adaptador de terceros si puede.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const controller = controllerFor(() => Promise.reject('texto'))

    await expect(controller.heroProfile('jugador-1', 'pid-heroe')).rejects.toBeInstanceOf(Error)
  })

  it('devuelve el perfil tal cual cuando el caso de uso responde', async () => {
    const perfil = { heroId: 'pid-heroe' } as HeroProfileDto
    const controller = controllerFor(() => Promise.resolve(perfil))

    await expect(controller.heroProfile('jugador-1', 'pid-heroe')).resolves.toBe(perfil)
  })
})
