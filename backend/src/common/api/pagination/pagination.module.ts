import { Module } from '@nestjs/common';

import { CursorCodec } from './cursor-codec';

/** Imported by each feature module that exposes a cursor-paginated list. */
@Module({
  providers: [CursorCodec],
  exports: [CursorCodec],
})
export class PaginationModule {}
