export const LANDING_TOAST_EVENT = "overlay:landing-toast";

export function landingToast(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LANDING_TOAST_EVENT, { detail: message }));
}
