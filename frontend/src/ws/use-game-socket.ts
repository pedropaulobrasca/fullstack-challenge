import { useEffect } from "react";
import { create } from "zustand";
import { getSocket, disconnectSocket } from "@/ws/socket";
import { useOidc } from "@/auth/oidc";
import { dispatchWsEvent, WS_EVENTS } from "@/stores/ws-dispatch";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

type ConnectionState = {
  status: ConnectionStatus;
  setStatus: (status: ConnectionStatus) => void;
};

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: "connecting",
  setStatus: (status) => set({ status }),
}));

export function useGameSocket(): void {
  const oidc = useOidc();
  const isLoggedIn = oidc.isUserLoggedIn;

  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }

    const socket = getSocket();
    const setStatus = useConnectionStore.getState().setStatus;

    const onConnect = () => setStatus("connected");
    const onDisconnect = () => setStatus("reconnecting");
    const onReconnectAttempt = () => setStatus("reconnecting");

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect_attempt", onReconnectAttempt);

    for (const event of WS_EVENTS) {
      socket.on(event, (payload: unknown) => dispatchWsEvent(event, payload));
    }

    if (!socket.connected) {
      socket.connect();
    } else {
      setStatus("connected");
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      for (const event of WS_EVENTS) {
        socket.off(event);
      }
      disconnectSocket();
    };
  }, [isLoggedIn]);
}
