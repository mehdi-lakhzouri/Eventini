export {
  SecurityEventRecorder,
  type SecurityEventFacts,
} from './application/security-event-recorder.service';
export {
  SECURITY_EVENT_PROFILES,
  profileFor as securityEventProfileFor,
  type SecurityEventProfile,
} from './domain/security-event-profile';
export {
  SecurityEventRepository,
  type SecurityEventRecord,
} from './domain/security-event.repository';
export * from './security-events.module';
