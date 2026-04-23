import AtpAgent, { AppBskyVideoDefs } from "@atproto/api";
import type { BlobRef } from "@atproto/lexicon";
import type { Ora } from "ora";

const VIDEO_SERVICE = "https://video.bsky.app";
const MAX_POLL_MS = 5 * 60 * 1000; // 5 minutes — video processing can be slow for large files
const INITIAL_POLL_MS = 1500;
const MAX_POLL_INTERVAL_MS = 10_000;
const TOKEN_TTL_SEC = 60 * 30;

/**
 * Request a service-auth token signed by the user's PDS, scoped to a specific
 * lexicon method. `video.bsky.app` trusts tokens whose `aud` matches the
 * user's PDS DID (it verifies the signature against the PDS's DID doc).
 */
async function getVideoServiceAuthToken(
  agent: AtpAgent,
  lxm: string,
): Promise<string> {
  const pdsDid = `did:web:${agent.dispatchUrl.hostname}`;
  const { data } = await agent.com.atproto.server.getServiceAuth({
    aud: pdsDid,
    lxm,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
  });
  return data.token;
}

/**
 * Normalize an XRPC response body to a JobStatus. The lexicon documents a
 * `{jobStatus: {...}}` envelope, but video.bsky.app actually returns the
 * JobStatus fields flat at the top level. Accept either shape.
 */
function parseJobStatusBody(
  rawBody: string,
): AppBskyVideoDefs.JobStatus | undefined {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody);
  } catch (_) {
    return undefined;
  }
  if (
    parsed.jobStatus &&
    typeof parsed.jobStatus === "object" &&
    parsed.jobStatus !== null
  ) {
    return parsed.jobStatus as AppBskyVideoDefs.JobStatus;
  }
  if (typeof parsed.jobId === "string") {
    return parsed as unknown as AppBskyVideoDefs.JobStatus;
  }
  return undefined;
}

/**
 * Upload a video to Bluesky via the dedicated video.bsky.app endpoint.
 *
 * Unlike the generic com.atproto.repo.uploadBlob call (which is routed through
 * the PDS's Express layer and rejects payloads above ~50MB), this endpoint
 * accepts videos up to Bluesky's documented per-account limit (~100MB) and
 * processes them asynchronously with a job queue.
 *
 * Flow:
 *   1. Mint a service-auth token scoped to `com.atproto.repo.uploadBlob` with
 *      `aud` = the user's PDS DID. video.bsky.app validates it by verifying
 *      the PDS signature from the user's DID doc.
 *   2. POST the video blob to app.bsky.video.uploadVideo on video.bsky.app.
 *   3. Mint a second service-auth token scoped to `app.bsky.video.getJobStatus`
 *      and poll video.bsky.app directly (the user's PDS may not proxy this
 *      lexicon — some PDSes return 501 Method Not Implemented).
 *   4. Return the resulting BlobRef for use in an app.bsky.embed.video record.
 */
export async function uploadBlueskyVideo(
  agent: AtpAgent,
  videoBlob: Blob,
  log: Ora,
): Promise<BlobRef> {
  const did = agent.did;
  if (!did) throw new Error("Bluesky agent has no DID — not authenticated");

  // 1. Upload token.
  const uploadToken = await getVideoServiceAuthToken(
    agent,
    "com.atproto.repo.uploadBlob",
  );

  // 2. Upload. Pass the Blob directly so the runtime streams the existing
  //    buffer (no second copy); fetch sets Content-Length from blob.size.
  log.text = "Uploading video to Bluesky...";
  const uploadUrl = new URL(`${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo`);
  uploadUrl.searchParams.set("did", did);
  uploadUrl.searchParams.set("name", `tweet-${Date.now()}.mp4`);

  const uploadRes = await fetch(uploadUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${uploadToken}`,
      "Content-Type": "video/mp4",
    },
    body: videoBlob,
  });

  const uploadBody = await uploadRes.text().catch(() => "<unreadable>");
  if (!uploadRes.ok) {
    throw new Error(
      `Video upload failed (${uploadRes.status} ${uploadRes.statusText}): ${uploadBody.slice(0, 500)}`,
    );
  }

  let jobStatus = parseJobStatusBody(uploadBody);

  // Surface top-level {error, message} responses (validation rejections
  // that come back as HTTP 200 with no usable jobStatus).
  if (!jobStatus) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(uploadBody);
    } catch (_) {
      // fall through to generic error below
    }
    if (typeof parsed.error === "string") {
      const msg =
        typeof parsed.message === "string" ? ` — ${parsed.message}` : "";
      throw new Error(`Video upload rejected: ${parsed.error}${msg}`);
    }
    throw new Error(
      `Video upload returned unexpected body: ${uploadBody.slice(0, 500)}`,
    );
  }

  // Dedup shortcut: if Bluesky already processed this video on an earlier
  // retry, it can return the finished BlobRef inline.
  if (jobStatus.blob) return jobStatus.blob;

  if (!jobStatus.jobId) {
    throw new Error(
      `Video upload response missing jobId: ${uploadBody.slice(0, 500)}`,
    );
  }
  const jobId = jobStatus.jobId;

  // 3. Poll token + poll loop (direct fetch — SDK would route via the PDS,
  //    which may not proxy app.bsky.video.getJobStatus).
  const statusToken = await getVideoServiceAuthToken(
    agent,
    "app.bsky.video.getJobStatus",
  );
  const statusUrl = new URL(
    `${VIDEO_SERVICE}/xrpc/app.bsky.video.getJobStatus`,
  );
  statusUrl.searchParams.set("jobId", jobId);

  const pollStart = Date.now();
  let waitMs = INITIAL_POLL_MS;
  let state = jobStatus.state;
  let consecutivePollErrors = 0;
  while (state !== "JOB_STATE_COMPLETED" && state !== "JOB_STATE_FAILED") {
    if (Date.now() - pollStart > MAX_POLL_MS) {
      throw new Error(
        `Video processing timed out after ${MAX_POLL_MS / 1000}s (last state: ${state})`,
      );
    }
    await new Promise((r) => setTimeout(r, waitMs));
    waitMs = Math.min(Math.round(waitMs * 1.5), MAX_POLL_INTERVAL_MS);

    const progressStr =
      typeof jobStatus.progress === "number" ? ` ${jobStatus.progress}%` : "";
    log.text = `Processing video on Bluesky (${state}${progressStr})...`;

    try {
      const res = await fetch(statusUrl.toString(), {
        headers: { Authorization: `Bearer ${statusToken}` },
      });
      const body = await res.text().catch(() => "<unreadable>");
      if (!res.ok) {
        throw new Error(
          `getJobStatus failed (${res.status} ${res.statusText}): ${body.slice(0, 300)}`,
        );
      }
      const next = parseJobStatusBody(body);
      if (!next) {
        throw new Error(
          `getJobStatus returned unexpected body: ${body.slice(0, 300)}`,
        );
      }
      jobStatus = next;
      state = jobStatus.state;
      consecutivePollErrors = 0;
    } catch (err) {
      consecutivePollErrors++;
      if (consecutivePollErrors >= 2) throw err;
      // else loop, back off, try again on the next tick
    }
  }

  if (state === "JOB_STATE_FAILED") {
    throw new Error(
      `Video processing failed: ${jobStatus.error || jobStatus.message || "unknown"}`,
    );
  }

  if (!jobStatus.blob) {
    throw new Error("Video processing completed but no blob was returned");
  }

  return jobStatus.blob;
}
