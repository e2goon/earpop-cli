import { useEffect } from "react";
import { useStdout } from "ink";

// Live UI uses the alternate screen buffer. Inline mode cannot clear already-printed
// lines, so on resize old mis-wrapped glyphs linger and mix with the new frame.
// Alternate screen clears and redraws on each resize; leaving restores the prior screen.
export function useAlternateScreen({
  active,
  onRepaint,
}: {
  active: boolean;
  onRepaint: () => void;
}) {
  const { stdout } = useStdout();
  useEffect(() => {
    if (!active) return;
    stdout.write("\x1b[?1049h\x1b[H");
    const handleResize = () => {
      stdout.write("\x1b[2J\x1b[3J\x1b[H");
      onRepaint();
    };
    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
      stdout.write("\x1b[?1049l");
    };
  }, [active, stdout, onRepaint]);
}
