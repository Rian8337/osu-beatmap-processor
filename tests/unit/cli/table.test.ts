import { formatTable } from "@/cli/table";
import { describe, expect, it } from "vitest";

describe("formatTable", () => {
    it("pads every column but the last to its widest cell", () => {
        expect(
            formatTable(
                ["NAME", "ACCESS", "DESCRIPTION"],
                [
                    ["droid-live", "public", "Live"],
                    ["x", "private", "-"],
                ],
            ),
        ).toEqual([
            "NAME        ACCESS   DESCRIPTION",
            "droid-live  public   Live",
            "x           private  -",
        ]);
    });
});
