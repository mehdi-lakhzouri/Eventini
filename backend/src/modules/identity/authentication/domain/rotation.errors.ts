export type RotationRejection =
  /** No cookie, or a token matching no row at all. */
  | 'UNKNOWN_TOKEN'
  /** The row exists but is not ACTIVE — §5.3 calls this replay. */
  | 'REUSE_DETECTED'
  | 'TOKEN_EXPIRED'
  | 'SESSION_REVOKED'
  | 'SESSION_IDLE_EXPIRED'
  | 'SESSION_ABSOLUTE_EXPIRED'
  /** A concurrent rotation won the unique index. Not an attack. */
  | 'CONCURRENT_ROTATION';

export class RotationError extends Error {
  constructor(readonly rejection: RotationRejection) {
    super(`Rotation refused: ${rejection}`);
    this.name = 'RotationError';
  }
}
