import { Anchor, Box, Text } from "@mantine/core";
import { brandAsset, type Brand } from "./useBrand";

const LOGO_HEIGHT = 22;

/**
 * The brand's logo (22 px high) and kicker for a header. A light/dark logo pair is swapped in CSS
 * (Mantine's `darkHidden` / `lightHidden`), so it never flickers on a scheme change; without a
 * `logoDark` the one logo serves both schemes. Renders nothing for a brand without a logo or kicker.
 */
export function BrandMark({ brand }: { brand: Brand }) {
  const { logo, logoDark, kicker, kickerUrl } = brand;
  return (
    <>
      {logo !== undefined && logoDark !== undefined && logoDark !== logo ? (
        <>
          <Box
            component="img"
            src={brandAsset(logo)}
            alt=""
            h={LOGO_HEIGHT}
            darkHidden
            data-brand-logo="light"
          />
          <Box
            component="img"
            src={brandAsset(logoDark)}
            alt=""
            h={LOGO_HEIGHT}
            lightHidden
            data-brand-logo="dark"
          />
        </>
      ) : (
        logo !== undefined && (
          <Box
            component="img"
            src={brandAsset(logo)}
            alt=""
            h={LOGO_HEIGHT}
            data-brand-logo="both"
          />
        )
      )}
      {kicker !== undefined &&
        (kickerUrl !== undefined ? (
          <Anchor
            href={kickerUrl}
            target="_blank"
            rel="noopener"
            size="xs"
            c="dimmed"
            data-brand-kicker
          >
            {kicker}
          </Anchor>
        ) : (
          <Text size="xs" c="dimmed" data-brand-kicker>
            {kicker}
          </Text>
        ))}
    </>
  );
}
