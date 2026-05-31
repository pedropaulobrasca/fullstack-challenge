import { makeGaugeProvider } from "@willsoto/nestjs-prometheus";

export const CRASH_RTP_WINDOW = "crash_rtp_window";

export const crashRtpWindowProvider = makeGaugeProvider({
  name: CRASH_RTP_WINDOW,
  help: "Rolling RTP (payout/bet) over the last CRASH_RTP_WINDOW_ROUNDS settled rounds",
});
