import { Module } from '@nestjs/common';
import { CsrfController } from './csrf.controller';
import { CsrfGuard } from './csrf.guard';
import { CsrfService } from './csrf.service';
import { CsrfTokenService } from './csrf-token.service';
import { OriginValidatorService } from './origin-validator.service';

@Module({
  controllers: [CsrfController],
  providers: [CsrfGuard, CsrfService, CsrfTokenService, OriginValidatorService],
  exports: [CsrfGuard, CsrfService],
})
export class CsrfModule {}
