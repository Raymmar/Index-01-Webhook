import { randomUUID } from "node:crypto";
import { objectStorageClient } from "./objectStorage";

function privateFile(objectPath: string) {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) throw new Error("Private audio storage is not configured");
  const parts = dir.replace(/^\/+/, "").split("/");
  const bucket = parts.shift()!;
  return objectStorageClient.bucket(bucket).file([...parts, objectPath].join("/"));
}

export async function saveAudio(bytes: Buffer) {
  const path = `ring-recordings/${randomUUID()}.m4a`;
  await privateFile(path).save(bytes, {
    resumable: false,
    contentType: "audio/mp4",
    metadata: { cacheControl: "private, no-store" },
  });
  return path;
}

export const audioFile = privateFile;
