import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { fake } from "../test/handlers";
import { api, call, resetCsrf, toProblem } from "./client";
import * as editor from "./editor";

describe("toProblem", () => {
  it("reads status, code, detail and the extra properties of an RFC 9457 body", () => {
    const p = toProblem(
      {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        detail: "moved",
        code: "STALE",
        head: "h2",
      },
      new Response(null, { status: 409 }),
    );
    expect(p).toEqual({ status: 409, code: "STALE", detail: "moved", extra: { head: "h2" } });
  });

  it("falls back to the response for a non-problem body", () => {
    const p = toProblem("<html>", new Response(null, { status: 502, statusText: "Bad Gateway" }));
    expect(p.status).toBe(502);
    expect(p.code).toBe("HTTP_502");
    expect(p.detail).toBe("Bad Gateway");
    const q = toProblem(undefined, new Response(null, { status: 500 }));
    expect(q.detail).toBe("Request failed (500)");
  });
});

describe("call", () => {
  it("returns data on success and a problem on failure", async () => {
    const ok = await call(api.GET("/api/info"));
    expect(ok.data?.service).toBe("corej-rule-editor-rest");
    fake.sessionOpen = false;
    const bad = await call(api.GET("/api/status"));
    expect(bad.problem?.code).toBe("UNAUTHENTICATED");
    expect(bad.problem?.status).toBe(401);
  });

  it("turns a thrown fetch into a NETWORK problem", async () => {
    server.use(http.get("/api/info", () => HttpResponse.error()));
    const r = await call(api.GET("/api/info"));
    expect(r.problem?.code).toBe("NETWORK");
    expect(r.problem?.status).toBe(0);
  });
});

describe("CSRF middleware", () => {
  it("fetches the token once and sends it on every mutating request, not on GETs", async () => {
    await editor.status();
    await editor.commit("m", { branch: "feature/x", head: "aaaa111" });
    await editor.push({ branch: "feature/x", head: "aaaa111" });
    expect(fake.mutations.map((m) => m.csrf)).toEqual(["csrf-1", "csrf-1"]);
  });

  it("re-fetches the token after login rotates the session", async () => {
    const first = await editor.login("alice", "t");
    expect(first.data?.login).toBe("alice");
    // login rotated the server-side token; the next mutation must carry the new one
    await editor.logout();
    const [loginCall, logoutCall] = fake.mutations;
    expect(loginCall.csrf).toBe("csrf-1");
    expect(logoutCall.csrf).toBe(fake.csrfToken);
    expect(logoutCall.csrf).not.toBe("csrf-1");
  });

  it("does not cache a failed token fetch", async () => {
    resetCsrf();
    server.use(http.get("/api/session/csrf", () => HttpResponse.error(), { once: true }));
    const failed = await editor.push({ branch: "feature/x", head: "aaaa111" });
    expect(failed.problem?.code).toBe("NETWORK");
    const retried = await editor.push({ branch: "feature/x", head: "aaaa111" });
    expect(retried.data?.push?.status).toBe("OK");
  });

  it("is refused by the server when the token is wrong (403 CSRF)", async () => {
    fake.csrfToken = "rotated-elsewhere"; // the SPA still holds csrf-1 from the fixture
    server.use(
      http.get("/api/session/csrf", () =>
        HttpResponse.json({ headerName: "X-CSRF-TOKEN", parameterName: "_csrf", token: "csrf-1" }),
      ),
    );
    const r = await editor.commit("m", { branch: "feature/x", head: "aaaa111" });
    expect(r.problem?.code).toBe("CSRF");
    expect(r.problem?.status).toBe(403);
  });
});

describe("editor api helpers", () => {
  it("writeFile sends the stamp and the blob, and omits a null blob", async () => {
    const created = await editor.writeFile("rules-src/checks/CDISC/CDISC-NEW.yaml", "x", null, {
      branch: "feature/x",
      head: "aaaa111",
    });
    expect(created.data?.blob).toMatch(/^w/);
    const body = fake.mutations[0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      path: "rules-src/checks/CDISC/CDISC-NEW.yaml",
      branch: "feature/x",
    });
    expect("blob" in body).toBe(false);
    const stale = await editor.writeFile("rules-src/checks/CDISC/CDISC-NEW.yaml", "y", "wrong", {
      branch: "feature/x",
      head: "aaaa111",
    });
    expect(stale.problem?.code).toBe("STALE");
  });

  it("covers the remaining endpoints against the fake", async () => {
    expect((await editor.session()).data?.mode).toBe("EDIT");
    expect((await editor.branches()).data?.branches?.length).toBe(3);
    expect((await editor.listDirectory("rules-src/checks/CDISC")).data?.entries?.length).toBe(1);
    expect((await editor.readFile("rules-src/checks/FDA/FDA-SD1142.yaml")).data?.blob).toBe(
      "b1142",
    );
    expect((await editor.explorer()).data?.families?.map((f) => f.name)).toEqual(["CDISC", "FDA"]);
    expect((await editor.search("CG0270")).data?.hits?.[0]?.id).toBe("CDISC-CG0270");
    const stamp = { branch: "feature/x", head: "aaaa111" };
    expect((await editor.updateFromDefault(stamp)).data?.merge?.status).toBe("ALREADY_UP_TO_DATE");
    expect((await editor.updateFromRemote(stamp)).data?.merge?.status).toBe("MERGED");
    expect((await editor.deleteBranch("feature/x")).data?.branches?.length).toBe(2);
    const created = await editor.createBranch("feature/new", {
      branch: "feature/x",
      head: "merged44",
    });
    expect(created.data?.current).toBe("feature/new");
    expect(
      (await editor.switchBranch("main", { branch: "feature/new", head: "0000main" })).data
        ?.current,
    ).toBe("main");
  });
});
