import express, { type Request, type Response } from "express";
import request from "supertest";
import { container } from "tsyringe";
import { describe, expect, it } from "vitest";
import { Controller } from "@/server/decorators/controller";
import { Get, Post } from "@/server/decorators/routes";
import { createRouter } from "@/server/http/router";

// Exported so the class counts as used; the decorator is what registers it.
@Controller("/things")
export class ThingsController {
    private readonly prefix = "thing-";

    @Get("")
    list(_req: Request, res: Response): void {
        res.json([`${this.prefix}a`]);
    }

    @Post("/:id")
    create(req: Request<{ id: string }>, res: Response): void {
        res.status(201).json({ id: `${this.prefix}${req.params.id}` });
    }
}

describe("createRouter", () => {
    it("serves the routes declared on controllers, bound to their instance", async () => {
        const app = express().use(
            createRouter(container.createChildContainer()),
        );

        const list = await request(app).get("/things");
        const created = await request(app).post("/things/7");

        expect(list.status).toBe(200);
        expect(list.body).toEqual(["thing-a"]);
        expect(created.status).toBe(201);
        expect(created.body).toEqual({ id: "thing-7" });
    });

    it("rejects a controller without a base path", () => {
        class Undecorated {}

        Reflect.defineMetadata("controllers", [Undecorated], globalThis);

        try {
            expect(() =>
                createRouter(container.createChildContainer()),
            ).toThrow("Undecorated has no base path");
        } finally {
            Reflect.defineMetadata(
                "controllers",
                [ThingsController],
                globalThis,
            );
        }
    });
});
