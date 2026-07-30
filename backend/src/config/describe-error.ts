/**
 * Extracts a readable message from an unknown thrown value.
 *
 * `error instanceof Error` is not reliable here: a value crossing a realm
 * boundary — which is what happens to Node's crypto errors under Jest's module
 * registry — fails the check despite being a perfectly ordinary Error. Relying
 * on it produced "unknown error" in a message whose entire job is to tell an
 * operator what went wrong.
 *
 * Duck-typing on `message` works in both cases.
 */
export function describeError(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    const message = (error as { message: string }).message;
    if (message.length > 0) {
      return message;
    }
  }

  return 'unknown error';
}
