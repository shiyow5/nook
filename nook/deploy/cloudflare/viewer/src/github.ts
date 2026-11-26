import { UpstreamError } from "./chat";
import { type FetchFn, type NookEnv, requireSecret } from "./env";

/** viewer の Retry ボタンから、その collector だけを GitHub Actions で再実行する。 */
export async function dispatchCollectorWorkflow(args: {
  env: Pick<NookEnv, "GITHUB_REPOSITORY" | "GITHUB_WORKFLOW" | "GITHUB_REF" | "GITHUB_TOKEN">;
  collector: string;
  fetchFn: FetchFn;
}): Promise<void> {
  const { env } = args;
  const token = requireSecret(env.GITHUB_TOKEN, "GITHUB_TOKEN");
  const response = await args.fetchFn(
    `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "nook-viewer",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ ref: env.GITHUB_REF, inputs: { collectors: args.collector } }),
    },
  );
  if (response.status !== 204) {
    throw new UpstreamError(
      `GitHub workflow dispatch returned ${response.status}: ${(await response.text()).slice(0, 500)}`,
    );
  }
}
