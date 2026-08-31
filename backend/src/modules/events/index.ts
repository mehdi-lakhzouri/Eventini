export { EventsModule } from './events.module';
export { EventRepository, type EventProfile } from './domain/event.repository';
export {
  generateEventCode,
  isValidEventCode,
  normalizeEventCode,
} from './domain/event-code';
