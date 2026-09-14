export { ParticipantsModule } from './participants.module';
export {
  ParticipantRepository,
  type ParticipantProfile,
} from './domain/participant.repository';
export {
  normalizeParticipantEmail,
  participantFingerprint,
} from './domain/participant-identity';
