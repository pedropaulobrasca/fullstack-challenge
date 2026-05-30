import { create } from "zustand";

type ReplayState = {
  roundId: string | null;
  playing: boolean;
  speed: number;
};

type ReplayActions = {
  openReplay: (roundId: string, autostart: boolean, defaultSpeed: number) => void;
  closeReplay: () => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
};

export const initialReplayState: ReplayState = {
  roundId: null,
  playing: false,
  speed: 1,
};

export const useReplayStore = create<ReplayState & ReplayActions>((set) => ({
  ...initialReplayState,
  openReplay: (roundId, autostart, defaultSpeed) =>
    set({ roundId, playing: autostart, speed: defaultSpeed }),
  closeReplay: () => set({ ...initialReplayState }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
}));

export function selectIsReplayOpen(state: ReplayState): boolean {
  return state.roundId !== null;
}
