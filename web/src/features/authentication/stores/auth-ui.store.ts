"use client";

import { create } from "zustand";

type MfaStep = "idle" | "verify" | "recovery";

type AuthUiState = {
  isSecurityDialogOpen: boolean;
  mfaStep: MfaStep;
  setSecurityDialogOpen: (isOpen: boolean) => void;
  setMfaStep: (step: MfaStep) => void;
};

export const useAuthUiStore = create<AuthUiState>((set) => ({
  isSecurityDialogOpen: false,
  mfaStep: "idle",
  setSecurityDialogOpen: (isSecurityDialogOpen) =>
    set({ isSecurityDialogOpen }),
  setMfaStep: (mfaStep) => set({ mfaStep }),
}));
