import { ActionIcon, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { useColorScheme } from "@mantine/hooks";

// Sun and moon as inline SVG, taken over verbatim from the P300 websites' main.js so the control
// looks the same there and here (emoji were unreadable at this size on some systems).
const SUN = (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="10" r="4" fill="#f2b134" stroke="#c9861f" strokeWidth="1" />
    <g stroke="#e8a33d" strokeWidth="1.8" strokeLinecap="round">
      <line x1="10" y1="1.5" x2="10" y2="3.8" />
      <line x1="10" y1="16.2" x2="10" y2="18.5" />
      <line x1="1.5" y1="10" x2="3.8" y2="10" />
      <line x1="16.2" y1="10" x2="18.5" y2="10" />
      <line x1="4.2" y1="4.2" x2="5.8" y2="5.8" />
      <line x1="14.2" y1="14.2" x2="15.8" y2="15.8" />
      <line x1="4.2" y1="15.8" x2="5.8" y2="14.2" />
      <line x1="14.2" y1="5.8" x2="15.8" y2="4.2" />
    </g>
  </svg>
);

const MOON = (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M17 12.5A7.5 7.5 0 1 1 7.5 3a6 6 0 0 0 9.5 9.5Z"
      fill="#f2d675"
      stroke="#c9a83f"
      strokeWidth="1"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * The light/dark switch, behaving like the websites' toggle: it flips the computed scheme, and a
 * choice equal to the OS preference is stored as `auto` (follow the OS again), so a later OS change
 * is followed; a choice that differs from the OS is kept. Persisted by Mantine's manager under
 * `cumba-theme`, which `public/theme-init.js` reads before the first paint.
 */
export function ThemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light", { getInitialValueInEffect: false });
  const os = useColorScheme("light", { getInitialValueInEffect: false });
  const next = computed === "dark" ? "light" : "dark";
  return (
    <ActionIcon
      variant="default"
      radius="xl"
      size="lg"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => setColorScheme(next === os ? "auto" : next)}
    >
      {computed === "dark" ? SUN : MOON}
    </ActionIcon>
  );
}
