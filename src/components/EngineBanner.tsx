import { Alert, Text } from "@mantine/core";
import type { EngineInfoT } from "../api/types";

interface Props {
  engine: EngineInfoT | null | undefined;
  /**
   * The branch's `rules-src/LANGUAGE-LEVEL`: `null` when it declares none (level 0, older than
   * any engine), `undefined` while not known yet (no banner).
   */
  branchLevel: number | null | undefined;
}

/**
 * The banner text of O13 for a branch level against the engine's, or `null` when they agree. A
 * branch without `rules-src/LANGUAGE-LEVEL` predates the levels: it counts as level 0 (review 8).
 */
export function versionBanner(
  engineLevel: number | undefined,
  branchLevel: number | null | undefined,
): { title: string; message: string } | null {
  if (branchLevel === undefined || engineLevel === undefined) return null;
  const level = branchLevel ?? 0;
  if (level === engineLevel) return null;
  const declared =
    branchLevel === null
      ? "The branch declares no rule-language level (rules-src/LANGUAGE-LEVEL), so it predates level 1"
      : `The branch declares rule-language level ${level}`;
  const both = `${declared}; this editor's engine runs level ${engineLevel}.`;
  return level > engineLevel
    ? { title: "This branch needs a newer editor", message: both }
    : {
        title: "This branch predates the engine — update from default",
        message: `${both} Rules may fail to load until the branch is updated from the default branch.`,
      };
}

/**
 * The engine-version banner of PLAN-rule-editor §5.4 (O13): any mismatch between the branch's
 * language level and the engine's, naming both, with direction-specific text; a branch that
 * declares no level counts as level 0 ("predates"). Plus a quiet notice when the instance runs without a metadata store
 * (completion and library tooltips are limited).
 */
export function EngineBanner({ engine, branchLevel }: Props) {
  const banner = versionBanner(engine?.languageLevel, branchLevel);
  const noStore = engine !== null && engine !== undefined && engine.storeAvailable === false;
  if (!banner && !noStore) return null;
  return (
    <>
      {banner && (
        <Alert
          color={banner.title.includes("newer") ? "red" : "orange"}
          title={banner.title}
          radius={0}
          py={6}
        >
          <Text size="sm">{banner.message}</Text>
        </Alert>
      )}
      {noStore && (
        <Text size="xs" c="dimmed" px="sm" py={2} role="note">
          No metadata store on this instance{engine.storeReason ? ` (${engine.storeReason})` : ""}:
          variable completion and library tooltips are limited.
        </Text>
      )}
    </>
  );
}
