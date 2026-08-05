import { Module, forwardRef } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../config/authentication.config';
import { RateLimitingModule } from '../../rate-limiting';
import { CsrfModule } from '../csrf';
import { MfaModule } from '../mfa';
import { PasswordsModule } from '../passwords';
import { SecurityEventsModule } from '../security-events';
import { IdentitySessionsModule } from '../sessions';
import { AuthenticationController } from './controllers/authentication.controller';
import { CurrentUserController } from './controllers/current-user.controller';
import { MfaChallengeController } from './controllers/mfa-challenge.controller';
import { SessionsController } from './controllers/sessions.controller';
import { CompleteMfaLoginUseCase } from './application/complete-mfa-login.use-case';
import { GetCurrentUserUseCase } from './application/get-current-user.use-case';
import { LoginUseCase } from './application/login.use-case';
import { LogoutUseCase } from './application/logout.use-case';
import { RefreshSessionUseCase } from './application/refresh-session.use-case';
import { SessionIssuer } from './application/session-issuer';
import { AuthenticationRepository } from './domain/authentication.repository';
import { PrismaAuthenticationRepository } from './infrastructure/prisma-authentication.repository';
import { AccessTokenSigner } from './infrastructure/jwt/access-token.signer';
import { AccessTokenVerifier } from './infrastructure/jwt/access-token.verifier';
import { CallerResolver } from './infrastructure/caller.resolver';
import { CallerIdempotencyContextResolver } from './infrastructure/caller-idempotency-context.resolver';
import { IdempotencyContextResolver } from '../../../common/idempotency/idempotency-context.resolver';
import { SigningKeySet } from './infrastructure/jwt/signing-keys';

type Auth = ConfigType<typeof authenticationConfig>;

@Module({
  imports: [
    CsrfModule,
    RateLimitingModule,
    IdentitySessionsModule,
    forwardRef(() => PasswordsModule),
    forwardRef(() => MfaModule),
    SecurityEventsModule,
  ],
  controllers: [
    AuthenticationController,
    CurrentUserController,
    MfaChallengeController,
    SessionsController,
  ],
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
    // The idempotency mechanism declares the port; whoever authenticates owns
    // the adapter, which is here. EVT-036's guard replaces both.
    {
      provide: IdempotencyContextResolver,
      useClass: CallerIdempotencyContextResolver,
    },
    SessionIssuer,
    CompleteMfaLoginUseCase,
    GetCurrentUserUseCase,
    LoginUseCase,
    LogoutUseCase,
    RefreshSessionUseCase,
  ],
  exports: [
    AccessTokenSigner,
    AccessTokenVerifier,
    CallerResolver,
    IdempotencyContextResolver,
    AuthenticationRepository,
    // EVT-033's organization switch issues a session without going through
    // login, and must produce exactly the same one.
    SessionIssuer,
  ],
})
export class AuthenticationModule {}
