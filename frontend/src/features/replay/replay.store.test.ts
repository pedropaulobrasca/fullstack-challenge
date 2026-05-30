import { beforeEach, describe, expect, it } from "vitest";
import {
  initialReplayState,
  selectIsReplayOpen,
  useReplayStore,
} from "./replay.store";

beforeEach(() => {
  useReplayStore.setState({ ...initialReplayState });
});

describe("replay.store", () => {
  it("starts with no round, paused, at speed 1", () => {
    const state = useReplayStore.getState();
    expect(state.roundId).toBeNull();
    expect(state.playing).toBe(false);
    expect(state.speed).toBe(1);
  });

  it("openReplay with autostart=true mounts the round and starts playing", () => {
    useReplayStore.getState().openReplay("r1", true, 1);
    const state = useReplayStore.getState();
    expect(state.roundId).toBe("r1");
    expect(state.playing).toBe(true);
    expect(state.speed).toBe(1);
  });

  it("openReplay with autostart=false mounts the round paused at the chosen speed", () => {
    useReplayStore.getState().openReplay("r2", false, 2);
    const state = useReplayStore.getState();
    expect(state.roundId).toBe("r2");
    expect(state.playing).toBe(false);
    expect(state.speed).toBe(2);
  });

  it("closeReplay resets every field to its initial value", () => {
    useReplayStore.getState().openReplay("r1", true, 4);
    useReplayStore.getState().closeReplay();
    expect(useReplayStore.getState()).toMatchObject(initialReplayState);
  });

  it("setPlaying toggles the play flag without disturbing roundId or speed", () => {
    useReplayStore.getState().openReplay("r1", false, 2);
    useReplayStore.getState().setPlaying(true);
    expect(useReplayStore.getState().playing).toBe(true);
    useReplayStore.getState().setPlaying(false);
    const state = useReplayStore.getState();
    expect(state.playing).toBe(false);
    expect(state.roundId).toBe("r1");
    expect(state.speed).toBe(2);
  });

  it("setSpeed updates the speed without disturbing roundId or play state", () => {
    useReplayStore.getState().openReplay("r1", true, 1);
    useReplayStore.getState().setSpeed(4);
    const state = useReplayStore.getState();
    expect(state.speed).toBe(4);
    expect(state.roundId).toBe("r1");
    expect(state.playing).toBe(true);
  });

  it("selectIsReplayOpen tracks roundId presence across the modal lifecycle", () => {
    expect(selectIsReplayOpen(useReplayStore.getState())).toBe(false);
    useReplayStore.getState().openReplay("r1", true, 1);
    expect(selectIsReplayOpen(useReplayStore.getState())).toBe(true);
    useReplayStore.getState().closeReplay();
    expect(selectIsReplayOpen(useReplayStore.getState())).toBe(false);
  });
});
