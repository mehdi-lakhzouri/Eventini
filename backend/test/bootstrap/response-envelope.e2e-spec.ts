import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IsString } from 'class-validator';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { applicationConfig, cookiesConfig } from '../../src/config';
import { buildValidationPipe } from '../../src/bootstrap';
import type { ApiEnvelope } from '../../src/common/api';
import { preSessionCsrf } from '../helpers';

function envelope<T>(body: unknown): ApiEnvelope<T> {
  return body as ApiEnvelope<T>;
}

class ProbeDto {
  @IsString()
  name!: string;
}

@Controller('probe')
class ProbeController {
  @Get('ok')
  ok(): { id: string } {
    return { id: 'evt_1' };
  }

  @Get('empty')
  @HttpCode(204)
  empty(): void {
    return;
  }

  @Get('boom')
  boom(): never {
    throw new Error('relation "users" does not exist');
  }

  @Post('echo')
  echo(@Body() body: ProbeDto): ProbeDto {
    return body;
  }
}

@Module({ imports: [AppModule], controllers: [ProbeController] })
class TestRootModule {}

describe('response envelope and exception filter (EVT-010)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(TestRootModule, {
      logger: false,
    });

    app.get<ConfigType<typeof applicationConfig>>(applicationConfig.KEY);
    // CsrfGuard is global from EVT-028, and it reads its context from a
    // cookie — without the parser the probe POST is refused before the
    // validation pipe this suite is actually about ever runs.
    app.use(
      cookieParser(
        app.get<ConfigType<typeof cookiesConfig>>(cookiesConfig.KEY).secret,
      ),
    );
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    // The envelope interceptor and exception filter arrive through AppModule's
    // APP_INTERCEPTOR/APP_FILTER providers (EVT-011), so registering them here
    // would run each one twice.

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps a success response in data/meta/error', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/ok');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: { id: 'evt_1' },
      meta: {
        requestId: expect.stringMatching(/^req_/) as string,
        timestamp: expect.any(String) as string,
        apiVersion: 'v1',
      },
      error: null,
    });
  });

  it('sends no body on a 204', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/probe/empty',
    );

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
  });

  it('renders an unknown thrown error as a 500 problem+json with no leaked detail', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/probe/boom',
    );

    expect(response.status).toBe(500);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    const body = envelope(response.body);
    expect(body.data).toBeNull();
    expect(body.error?.code).toBe('INTERNAL_ERROR');
    expect(body.error?.detail).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('users');
  });

  it('renders an unmatched route as RESOURCE_NOT_FOUND', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/does-not-exist',
    );

    expect(response.status).toBe(404);
    expect(envelope(response.body).error?.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('renders a mass-assignment rejection as VALIDATION_ERROR with a field error', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/probe/echo')
      .set((await preSessionCsrf(app)).headers())
      .send({ name: 'ok', role: 'ADMIN' });

    expect(response.status).toBe(400);
    const body = envelope(response.body);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(body.error?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'role', code: 'UNEXPECTED_FIELD' }),
      ]),
    );
  });

  it('keeps a valid client-supplied X-Request-Id end to end', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/ok')
      .set('X-Request-Id', 'client-supplied-id-42');

    expect(response.headers['x-request-id']).toBe('client-supplied-id-42');
    expect(envelope(response.body).meta.requestId).toBe(
      'client-supplied-id-42',
    );
  });
});
