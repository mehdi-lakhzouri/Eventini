import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { CsrfService } from './csrf.service';

/**
 * `GET /api/v1/auth/csrf-token` — the first call a web client makes, before
 * the login form is even rendered.
 *
 * A `GET`, so it is not protected by the guard it feeds; it mints nothing an
 * attacker could use, because the token it returns only validates against the
 * `HttpOnly` context cookie set alongside it.
 */
@Controller('auth')
export class CsrfController {
  constructor(private readonly csrf: CsrfService) {}

  @Get('csrf-token')
  issue(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const issued = this.csrf.issue(request, response);

    // Returned in the body as well as the cookie: a client on a different
    // origin cannot read a cookie it did not receive same-site, and the token
    // authorizes nothing on its own.
    return {
      token: issued.token,
      headerName: issued.headerName,
      expiresAt: issued.expiresAt?.toISOString() ?? null,
    };
  }
}
