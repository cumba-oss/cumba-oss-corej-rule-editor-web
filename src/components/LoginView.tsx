import { Anchor, Card, Center, Stack, Text, Title } from "@mantine/core";
import type { ServiceInfoT, SessionInfoT } from "../api/types";
import { LoginForm } from "./LoginForm";

interface Props {
  info: ServiceInfoT | null;
  onLoggedIn: (session: SessionInfoT) => void;
}

/** The login page: which repository this instance is bound to, and the token form. */
export function LoginView({ info, onLoggedIn }: Props) {
  const repo = info?.repository;
  return (
    <Center mih="100vh" p="md">
      <Card withBorder shadow="sm" w={420}>
        <Stack gap="md">
          <Title order={3}>coreJ rule editor</Title>
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
