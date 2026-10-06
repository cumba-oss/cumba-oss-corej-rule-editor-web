import { Anchor, Card, Center, Group, Stack, Text, Title } from "@mantine/core";
import type { ServiceInfoT, SessionInfoT } from "../api/types";
import { BrandMark } from "../brand/BrandMark";
import { ThemeToggle } from "../brand/ThemeToggle";
import { useBrand } from "../brand/useBrand";
import { LoginForm } from "./LoginForm";

interface Props {
  info: ServiceInfoT | null;
  onLoggedIn: (session: SessionInfoT) => void;
}

/**
 * The login page: which repository this instance is bound to, and the token form. The brand's logo
 * and kicker lead the card and the light/dark toggle sits at its right (the header that carries
 * them after login is not mounted yet — without this a dark-OS user had no switch before login).
 */
export function LoginView({ info, onLoggedIn }: Props) {
  const repo = info?.repository;
  const brand = useBrand();
  return (
    <Center mih="100vh" p="md">
      <Card withBorder shadow="sm" w={420}>
        <Stack gap="md">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <BrandMark brand={brand} />
              <Title order={3}>coreJ rule editor</Title>
            </Group>
            <ThemeToggle />
          </Group>
          {repo && (
            <Text size="sm" c="dimmed">
              Bound to{" "}
              <Anchor href={repo.url} target="_blank" rel="noreferrer">
                {repo.owner}/{repo.name}
              </Anchor>{" "}
              on {repo.forge}
              {info?.version ? ` · editor ${info.version}` : ""}
            </Text>
          )}
          <LoginForm onLoggedIn={onLoggedIn} />
        </Stack>
      </Card>
    </Center>
  );
}
