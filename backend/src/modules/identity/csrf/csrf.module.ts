import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { CsrfController } from './csrf.controller';
import { CsrfGuard } from './csrf.guard';
import { CsrfService } from './csrf.service';
import { CsrfTokenService } from './csrf-token.service';
import { OriginValidatorService } from './origin-validator.service';

/**
 * The guard is bound globally from here rather than in `main.ts` because it
 * needs DI, and because a module that owns the subsystem owns its enforcement:
 * importing `CsrfModule` is what turns protection on, and there is no second
 * place to forget.
 *
 * `CsrfService` is exported for the two places that rebind a token to a
 * freshly created session — login and MFA challenge verification.
 */
@Module({
  controllers: [CsrfController],
  providers: [
    CsrfService,
    CsrfTokenService,
    OriginValidatorService,
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [CsrfService],
})
export class CsrfModule {}
