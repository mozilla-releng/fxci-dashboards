// Delivering a profile to the Firefox Profiler. Free of imports, so the profile
// builders and the pages can all use it.
const PROFILER_ORIGIN = "https://profiler.firefox.com";
export const PROFILER_POST_URL = `${PROFILER_ORIGIN}/from-post-message/`;
const HANDSHAKE_INTERVAL_MS = 250;
const HANDSHAKE_TIMEOUT_MS = 30_000;

export function injectProfile(profilerWindow, profile) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const stop = () => {
      clearInterval(poll);
      window.removeEventListener("message", onMessage);
    };
    const onMessage = (event) => {
      if (event.origin !== PROFILER_ORIGIN || event.data?.name !== "ready:response") return;
      stop();
      profilerWindow.postMessage({name: "inject-profile", profile}, PROFILER_ORIGIN);
      resolve();
    };
    const poll = setInterval(() => {
      if (profilerWindow.closed) {
        stop();
        reject(new Error("the profiler window was closed"));
      } else if (Date.now() - startedAt > HANDSHAKE_TIMEOUT_MS) {
        stop();
        reject(new Error("the profiler did not answer"));
      } else {
        profilerWindow.postMessage({name: "ready:request"}, PROFILER_ORIGIN);
      }
    }, HANDSHAKE_INTERVAL_MS);
    window.addEventListener("message", onMessage);
  });
}

// The window is opened first, before anything is awaited, because a browser only
// allows that while it handles a click.
export async function openProfile(build) {
  const profilerWindow = window.open(PROFILER_POST_URL, "_blank");
  try {
    const profile = await build();
    if (!profilerWindow) {
      return {opened: false, downloadUrl: URL.createObjectURL(new Blob([JSON.stringify(profile)], {type: "application/json"}))};
    }
    await injectProfile(profilerWindow, profile);
    return {opened: true};
  } catch (error) {
    profilerWindow?.close();
    throw error;
  }
}
