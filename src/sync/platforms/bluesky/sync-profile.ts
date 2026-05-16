import { Agent } from "@atproto/api";
import { Synchronizer } from "sync/synchronizer";

import { BlueskyPlatformStore } from "./types";
import { uploadBlueskyMedia } from "./utils/upload-bluesky-media";

export function syncProfile(args: {
  agent: Agent;
}): Synchronizer<typeof BlueskyPlatformStore> {
  const { agent } = args;

  let profileLock = Promise.resolve();
  function serialUpsertProfile(
    fn: Parameters<typeof agent.upsertProfile>[0],
  ): Promise<void> {
    const prev = profileLock;
    let resolve: () => void;
    profileLock = new Promise<void>((r) => (resolve = r));
    return prev.then(() => agent.upsertProfile(fn)).finally(() => resolve!());
  }

  return {
    syncBio: async (args) => {
      await serialUpsertProfile((o) => ({
        ...o,
        description: args.formattedBio,
      }));
    },

    syncUserName: async (args) => {
      await serialUpsertProfile((o) => ({
        ...o,
        displayName: args.name,
      }));
    },

    syncProfilePic: async (args) => {
      const avatar = await uploadBlueskyMedia(args.pfpFile, agent);
      if (!avatar) {
        throw new Error("Failed to upload avatar");
      }
      await serialUpsertProfile((o) => ({
        ...o,
        avatar: avatar.data.blob,
      }));
    },

    syncBanner: async (args) => {
      const res = await uploadBlueskyMedia(args.bannerFile, agent);
      if (!res) {
        throw new Error("Unable to upload banner");
      }
      await serialUpsertProfile((o) => ({
        ...o,
        banner: res?.data.blob,
      }));
    },
  };
}
