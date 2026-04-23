import { Agent, AppBskyVideoDefs } from "@atproto/api";
import type { BlobRef } from "@atproto/lexicon";
import type { Ora } from "ora";

const VIDEO_SERVICE = "https://video.bsky.app";
const VIDEO_SERVICE_DID = "did:web:video.bsky.app";
const MAX_POLL_MS = 5 * 60 * 1000; // 5 minutes — video processing can be slow for large files
const INITIAL_POLL_MS = 1500;
const MAX_POLL_INTERVAL_MS = 10_000;

/**
 * Upload a video to Bluesky via the dedicated video.bsky.app endpoint.
 *
 * Unlike the generic com.atproto.repo.uploadBlob call (which is routed through
 * the PDS's Express layer and rejects payloads above ~50MB), this endpoint
 * accepts videos up to Bluesky's documented per-account limit (~100MB) and
 * processes them asynchronously with a job queue.
 *
 * Flow:
 *   1. Request a service-auth token scoped to video.bsky.app.
 *   2. Check the user's daily quota (optional — skips upload if exhausted).
 *   3. POST the video blob to app.bsky.video.uploadVideo.
 *   4. Poll app.bsky.video.getJobStatus with exponential backoff until the
 *      server returns JOB_STATE_COMPLETED (or JOB_STATE_FAILED / timeout).
 *   5. Return the resulting BlobRef for use in an app.bsky.embed.video record.
 */
export async function uploadBlueskyVideo(
  agent: Agent,
  videoBlob: Blob,
  log: Ora,
): Promise<BlobRef> {
  const did = agent.did;
  if (!did) throw new Error("Bluesky agent has no DID — not authenticated");

  // 1. Service-auth token for video.bsky.app, scoped to the upload lexicon.
  const { data: serviceAuth } = await agent.com.atproto.server.getServiceAuth({
    aud: VIDEO_SERVICE_DID,
    lxm: "com.atproto.repo.uploadBlob",
    exp: Math.floor(Date.now() / 1000) + 60 * 30,
  });
  const token = serviceAuth.token;

  // 2. Quota check — best-effort. If the endpoint is unreachable or rejects
  //    the lxm-scoped token, fall through and let the upload call surface
  //    whatever error actually occurs.
  let limits:
    | {
        canUpload?: boolean;
        message?: string;
        error?: string;
        remainingDailyVideos?: number;
        remainingDailyBytes?: number;
      }
    | undefined;
  try {
    const limitsRes = await fetch(
      `${VIDEO_SERVICE}/xrpc/app.bsky.video.getUploadLimits`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (limitsRes.ok) {
      limits = await limitsRes.json();
    }
  } catch (_) {
    // Ignore — quota check is advisory.
  }
  if (limits?.canUpload === false) {
    throw new Error(
      `Video upload quota exhausted: ${limits.message || limits.error || "no capacity remaining"}`,
    );
  }

  // 3. Upload the video bytes. Pass the Blob directly so the runtime can
  //    stream the existing buffer instead of materializing a second copy.
  log.text = "Uploading video to Bluesky...";
  const uploadUrl = new URL(`${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo`);
  uploadUrl.searchParams.set("did", did);
  uploadUrl.searchParams.set("name", `tweet-${Date.now()}.mp4`);

  // When the body is a Blob, fetch sets Content-Length from blob.size
  // automatically — don't pass it manually or the runtime may reject the
  // duplicate header.
  const uploadRes = await fetch(uploadUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "video/mp4",
    },
    body: videoBlob,
  });

  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => "<unreadable>");
    throw new Error(
      `Video upload failed (${uploadRes.status} ${uploadRes.statusText}): ${body.slice(0, 500)}`,
    );
  }

  const uploadData = (await uploadRes.json()) as {
    jobStatus?: AppBskyVideoDefs.JobStatus;
  };
  let jobStatus: AppBskyVideoDefs.JobStatus | undefined = uploadData.jobStatus;
  if (!jobStatus?.jobId) {
    throw new Error("Video upload response missing jobId");
  }
  const jobId = jobStatus.jobId;

  // 4. Poll for processing completion with exponential backoff. A single
  //    transient network error shouldn't abort a 5-minute upload, so we
  //    tolerate one consecutive getJobStatus failure before giving up.
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
      const { data } = await agent.app.bsky.video.getJobStatus({ jobId });
      jobStatus = data.jobStatus;
      state = jobStatus.state;
      consecutivePollErrors = 0;
    } catch (err) {
      consecutivePollErrors++;
      if (consecutivePollErrors >= 2) throw err;
      // else loop, back off, and try again on the next tick
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
