import { Select as InkSelect } from "@inkjs/ui";
import { useRef, type ComponentProps } from "react";

// @inkjs/ui Select re-sends the last choice on every re-render; report each pick once.
export function Select(props: ComponentProps<typeof InkSelect>) {
  const pickedRef = useRef<string | null>(null);
  return (
    <InkSelect
      {...props}
      onChange={(value) => {
        if (pickedRef.current === value) return;
        pickedRef.current = value;
        props.onChange?.(value);
      }}
    />
  );
}
