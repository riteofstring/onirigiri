import {
  resolveOnirigiriSlotProps,
  useOnirigiriStyling,
} from "../styles/onirigiri-styling";

export type OnirigiriIconName =
  | "arrow-down"
  | "arrow-left"
  | "arrow-right"
  | "arrow-up"
  | "close"
  | "maximize"
  | "overview"
  | "restore";

const iconPaths: Record<OnirigiriIconName, string> = {
  "arrow-down": "M10 3.5v13M5.5 12l4.5 4.5 4.5-4.5",
  "arrow-left": "M16.5 10h-13M8 5.5L3.5 10 8 14.5",
  "arrow-right": "M3.5 10h13M12 5.5l4.5 4.5-4.5 4.5",
  "arrow-up": "M10 16.5v-13M5.5 8L10 3.5 14.5 8",
  close: "M5 5l10 10M15 5L5 15",
  maximize: "M6.5 3.5h10v10M13.5 16.5h-10v-10",
  overview:
    "M3.5 4.5h5v4h-5zM11.5 4.5h5v4h-5zM3.5 11.5h5v4h-5zM11.5 11.5h5v4h-5z",
  restore: "M5.5 6.5h10v10h-10zM8.5 6.5v-3h8v8h-1",
};

export function OnirigiriIcon({ name }: { name: OnirigiriIconName }) {
  const iconSlot = resolveOnirigiriSlotProps(useOnirigiriStyling(), "icon", "");
  return (
    <svg
      aria-hidden="true"
      className={iconSlot.className || undefined}
      data-onirigiri-slot="icon"
      fill="none"
      focusable="false"
      style={iconSlot.style}
      viewBox="0 0 20 20"
    >
      <path
        d={iconPaths[name]}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
