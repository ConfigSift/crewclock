"use client";

import { create } from "zustand";
import type { Profile, Project, TimeEntry, ActiveSession } from "@/types/database";

interface AppState {
  // User
  profile: Profile | null;
  setProfile: (p: Profile | null) => void;

  // Projects
  projects: Project[];
  setProjects: (p: Project[]) => void;
  addProject: (p: Project) => void;
  updateProject: (id: string, data: Partial<Project>) => void;
  removeProject: (id: string) => void;

  // Active session (current user's clock-in)
  activeEntry: TimeEntry | null;
  setActiveEntry: (e: TimeEntry | null) => void;

  // Time entries
  timeEntries: TimeEntry[];
  setTimeEntries: (e: TimeEntry[]) => void;
  addTimeEntry: (e: TimeEntry) => void;

  // Manager: employees
  employees: Profile[];
  setEmployees: (e: Profile[]) => void;

  // Manager: active sessions (all company)
  activeSessions: ActiveSession[];
  setActiveSessions: (s: ActiveSession[]) => void;
}

export const useAppStore = create<AppState>((set) => ({
  profile: null,
  setProfile: (p) => set({ profile: p }),

  projects: [],
  setProjects: (p) => set({ projects: p }),
  addProject: (p) => set((s) => ({ projects: [...s.projects, p] })),
  updateProject: (id, data) =>
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, ...data } : p)),
    })),
  removeProject: (id) =>
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),

  activeEntry: null,
  setActiveEntry: (e) => set({ activeEntry: e }),

  timeEntries: [],
  setTimeEntries: (e) => set({ timeEntries: e }),
  addTimeEntry: (e) =>
    set((s) => ({ timeEntries: [e, ...s.timeEntries] })),

  employees: [],
  setEmployees: (e) => set({ employees: e }),

  activeSessions: [],
  setActiveSessions: (s) => set({ activeSessions: s }),
}));
