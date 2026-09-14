import { hkdfSync } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { cookiesConfig } from '../../../config/cookies.config';
import { decodeBase64Secret } from '../../../config/parsers/secret.parser';
import { AppException } from '../app-exception';
import {
  paginationScope,
  signCursor,
  verifyCursor,
  type CursorKey,
} from './cursor';

/**
 * HKDF `info` label. Changing it invalidates every cursor in flight, which is
 * harmless — a client holding one gets a `400` and restarts from page one.
 */
const CURSOR_KEY_INFO = 'eventini/pagination-cursor/v1';

/**
 * Signs and verifies cursors for one query scope — see `cursor.ts`.
 *
 * ## Where the key comes from
 *
 * Derived from `COOKIE_SECRET` with HKDF-SHA256 under a dedicated label,
 * rather than a ninth independent secret. The derivation is one-way: holding
 * the cursor key reveals nothing about the cookie secret. The reverse
 * dependency is accepted on purpose — whoever holds `COOKIE_SECRET` could
 * forge a cursor, and a forged cursor can only reposition a page inside the
 * caller's own tenant-scoped result set. That impact does not justify another
 * deployment secret to generate, rotate and keep distinct (secret-hygiene
 * rules 7-9).
 */
@Injectable()
export class CursorCodec {
  private readonly key: Buffer;

  constructor(
    @Inject(cookiesConfig.KEY)
    cookies: ConfigType<typeof cookiesConfig>,
  ) {
    this.key = Buffer.from(
      hkdfSync(
        'sha256',
        decodeBase64Secret(cookies.secret),
        Buffer.alloc(0),
        CURSOR_KEY_INFO,
        32,
      ),
    );
  }

  /** The scope hash for a query — every input that changes the result set. */
  scope(parts: Record<string, unknown>): string {
    return paginationScope(parts);
  }

  encode(scope: string, key: CursorKey): string {
    return signCursor({ scope, key }, this.key);
  }

  /**
   * The keyset of a cursor issued for exactly this scope.
   *
   * Throws `400` for a cursor that is forged, corrupted, or was issued for a
   * different sort, filter, search or organization — API_CONVENTIONS.md §13,
   * tests 6 and 7.
   */
  decode(token: string, scope: string, field: string): CursorKey {
    const payload = verifyCursor(token, this.key);

    if (payload === null || payload.scope !== scope) {
      throw new AppException('VALIDATION_ERROR', {
        detail:
          'The pagination cursor is invalid or no longer matches this query. Restart from the first page.',
        errors: [
          {
            field,
            code: 'INVALID_CURSOR',
            message: `${field} is not a cursor issued for this query.`,
          },
        ],
      });
    }

    return payload.key;
  }
}
