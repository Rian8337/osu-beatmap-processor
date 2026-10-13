import { createHash } from "crypto";

export function computeMD5(buffer: Buffer): string {
    return createHash("md5").update(buffer).digest("hex");
}
