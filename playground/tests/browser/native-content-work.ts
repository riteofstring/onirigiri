const parameters = new URLSearchParams(location.search);

if (parameters.has("cooperative")) {
  let ticks = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const output = document.createElement("output");
  document.body.append(output);
  const resume = () => {
    if (timer !== null) return;
    timer = setInterval(() => {
      ticks += 1;
      output.textContent = String(ticks);
    }, 20);
  };
  const pause = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  resume();
  setTimeout(() => {
    Object.assign(window, {
      __nativeContentWork: {
        snapshot: () => ({ running: timer !== null, ticks }),
      },
    });
    window.addEventListener("message", (event) => {
      if (
        event.source !== parent ||
        event.data?.protocol !== "onirigiri-native-test/v1"
      )
        return;
      if (event.data.command === "theme") {
        const theme = event.data.theme;
        document.documentElement.dataset.colorMode = theme.colorMode;
        document.documentElement.style.backgroundColor = theme.styles.surface;
        document.documentElement.style.color = theme.styles.text;
        document.documentElement.style.fontFamily = theme.styles["font-family"];
        parent.postMessage(
          {
            protocol: "onirigiri-native-test/v1",
            type: "theme-applied",
            requestId: event.data.requestId,
          },
          event.origin,
        );
      }
      if (event.data.command === "pause") pause();
      if (event.data.command === "resume") resume();
    });
    parent.postMessage(
      { protocol: "onirigiri-native-test/v1", type: "ready" },
      "*",
    );
  }, 500);
}
