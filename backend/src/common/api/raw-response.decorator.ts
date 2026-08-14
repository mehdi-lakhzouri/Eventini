import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_KEY = 'eventini:raw-response';

/**
 * Exempts a handler from `ResponseEnvelopeInterceptor`.
 *
 * The `data`/`meta`/`error` envelope (ADR-0008) is the contract for the JSON
 * API, and every route that serves a client should carry it. A handful of
 * endpoints are not that: they answer a machine that requires an exact media
 * type it did not ask us to choose. Prometheus scrapes
 * `text/plain; version=0.0.4` and fails outright on anything else, so wrapping
 * `/metrics` in JSON would not degrade the endpoint — it would silently
 * disable monitoring.
 *
 * Deliberately narrow. Reach for this only when an external protocol dictates
 * the response shape; "this response looks nicer unwrapped" is not a reason,
 * because a client that has to special-case some routes gains nothing from
 * the envelope existing on the others.
 */
export const RawResponse = (): MethodDecorator & ClassDecorator =>
  SetMetadata(RAW_RESPONSE_KEY, true);
