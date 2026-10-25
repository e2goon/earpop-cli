import { useEffect } from "react";
import { useStdout } from "ink";

// Live UI uses the alternate screen buffer. Inline mode cannot clear already-printed
// lines, so on resize old mis-wrapped glyphs linger and mix with the new frame.
// Alternate screen clears and redraws on each resize; leaving restores the prior screen.
export function useAlternateScreen(active: boolean) {
  const { stdout, write } = useStdout();
  useEffect(() => {
    if (!active) return;
    // ?1007: the mouse wheel sends Up/Down keys here, which scroll caption history.
    stdout.write("\x1b[?1049h\x1b[?1007h\x1b[H");
    // Ink's write() redraws the last frame after the clear; a raw write would leave the screen blank.
    const handleResize = () => write("\x1b[2J\x1b[3J\x1b[H");
    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
      // Raw write: Ink ignores its own write() once unmounting has started.
      stdout.write("\x1b[?1007l\x1b[?1049l");
    };
  }, [active, stdout, write]);
}
