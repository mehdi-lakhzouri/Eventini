export type UserSession = {
  id: string;
  deviceName: string | null;
  ipAddress: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  current: boolean;
};
