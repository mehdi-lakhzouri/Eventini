import { Module } from '@nestjs/common';
import { IdentityModule } from './modules/identity';

@Module({
  imports: [IdentityModule],
})
export class AppModule {}
