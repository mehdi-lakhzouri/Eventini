import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../config/authentication.config';
import { MfaModule } from '../mfa';
import { PasswordsModule } from '../passwords';
import { SecurityEventsModule } from '../security-events';
import { IdentitySessionsModule } from '../sessions';
import { AuthenticationController } from './controllers/authentication.controller';
import { SessionsController } from './controllers/sessions.controller';
import { GetCurrentUserUseCase } from './application/get-current-user.use-case';
import { LoginUseCase } from './application/login.use-case';
import { LogoutUseCase } from './application/logout.use-case';
import { RefreshSessionUseCase } from './application/refresh-session.use-case';
import { AuthenticationRepository } from './domain/authentication.repository';
import { PrismaAuthenticationRepository } from './infrastructure/prisma-authentication.repository';
import { AccessTokenSigner } from './infrastructure/jwt/access-token.signer';
import { AccessTokenVerifier } from './infrastructure/jwt/access-token.verifier';
import { CallerResolver } from './infrastructure/caller.resolver';
import { SigningKeySet } from './infrastructure/jwt/signing-keys';

type Auth = ConfigType<typeof authenticationConfig>;

@Module({
  imports: [
    IdentitySessionsModule,
    PasswordsModule,
    MfaModule,
    SecurityEventsModule,
  ],
  controllers: [AuthenticationController, SessionsController],
  providers: [
    {
      // Built once at boot: `createPrivateKey` throws on malformed PEM, so a
      // bad key fails the process rather than the first login.
      provide: SigningKeySet,
      inject: [authenticationConfig.KEY],
      useFactory: (auth: Auth) => new SigningKeySet(auth.accessToken),
    },
    {
      provide: AccessTokenSigner,
      inject: [SigningKeySet, authenticationConfig.KEY],
      useFactory: (keys: SigningKeySet, auth: Auth) =>
        new AccessTokenSigner(keys, auth.accessToken),
    },
    {
      provide: AccessTokenVerifier,
      inject: [SigningKeySet, authenticationConfig.KEY],
      useFactory: (keys: SigningKeySet, auth: Auth) =>
        new AccessTokenVerifier(keys, auth.accessToken),
    },
    {
      provide: AuthenticationRepository,
      useClass: PrismaAuthenticationRepository,
    },
    CallerResolver,
    GetCurrentUserUseCase,
    LoginUseCase,
    LogoutUseCase,
    RefreshSessionUseCase,
  ],
  exports: [AccessTokenSigner, AccessTokenVerifier],
})
export class AuthenticationModule {}
