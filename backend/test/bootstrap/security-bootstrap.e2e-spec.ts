import { Body, Controller, Get, Module, Post, Req } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { IsString } from 'class-validator';
import type { Request } from 'express';
import helmet from 'helmet';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { applicationConfig, cookiesConfig } from '../../src/config';
import {
  buildCorsOptions,
  buildHelmetOptions,
  buildValidationPipe,
  permissionsPolicyMiddleware,
} from '../../src/bootstrap';
import { preSessionCsrf } from '../helpers';
import { Public } from '../../src/common/decorators';

/**
 * Route-free otherwise: `AppModule`'s own controllers don't yet expose a body
 * or a way to read `req.ip`, so this probes the two things only a live route
 * can prove — whitelist rejection and trust-proxy hop resolution — without
 * inventing a production endpoint to do it.
 */
class ProbeDto {
  @IsString()
  name!: string;
}

/**
 * `@Public()`: this probe exists to exercise the validation pipe, the response
 * envelope and the logger. Sending it through the authorization chain would
 * make those tests depend on a session and prove something else — the chain
 * itself is covered by `guard-chain.e2e-spec.ts`.
 */
@Public()
@Controller('probe')
class ProbeController {
  @Get('ip')
  ip(@Req() req: Request): { ip: string } {
    return { ip: req.ip ?? '' };
  }

  @Post('echo')
  echo(@Body() body: ProbeDto): ProbeDto {
    return body;
  }
}

@Module({ imports: [AppModule], controllers: [ProbeController] })
class TestRootModule {}

describe('security bootstrap (EVT-009)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(TestRootModule, {
      logger: false,
    });

    const application = app.get<ConfigType<typeof applicationConfig>>(
      applicationConfig.KEY,
    );
    const cookies = app.get<ConfigType<typeof cookiesConfig>>(
      cookiesConfig.KEY,
    );

    app.set('trust proxy', application.trustedProxyHops);
    app.use(helmet(buildHelmetOptions()));
    app.use(permissionsPolicyMiddleware);
    app.enableCors(
      buildCorsOptions(
        application.corsAllowedOrigins,
        application.corsMaxAgeSeconds,
      ),
    );
    app.use(cookieParser(cookies.secret));
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets the seven security headers and removes X-Powered-By', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/ip');

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(response.headers['strict-transport-security']).toContain(
      'max-age=31536000',
    );
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(response.headers['permissions-policy']).toBe(
      'camera=(self), microphone=(), geolocation=(), payment=()',
    );
  });

  it('echoes Access-Control-Allow-Origin for an allowed origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/ip')
      .set('Origin', 'http://localhost:3000');

    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
  });

  it('omits Access-Control-Allow-Origin for a disallowed origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/ip')
      .set('Origin', 'http://evil.example.com');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a body carrying a field the DTO does not declare', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/probe/echo')
      .set((await preSessionCsrf(app)).headers())
      .send({ name: 'ok', role: 'ADMIN' });

    expect(response.status).toBe(400);
  });

  it('accepts a body matching the DTO exactly', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/probe/echo')
      .set((await preSessionCsrf(app)).headers())
      .send({ name: 'ok' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      data: { name: 'ok' },
      error: null,
    });
  });

  it('does not let a forged X-Forwarded-For entry beyond the trusted hop count set req.ip', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/ip')
      .set('X-Forwarded-For', '1.1.1.1, 2.2.2.2, 9.9.9.9');

    const body = response.body as { ip: string };
    expect(body.ip).not.toBe('1.1.1.1');
  });
});
