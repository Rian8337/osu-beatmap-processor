import { createHash } from "node:crypto";

/**
 * The MD5 hash of `data` as lowercase hex, the format of osu!'s `file_md5`.
 */
export function computeMD5(data: Buffer): string {
    return createHash("md5").update(data).digest("hex");
}
