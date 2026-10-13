import { createServer } from "node:http";

const server = createServer((req, res) => {
    res.writeHead(req.url === "/ready" ? 200 : 404).end("ok");
});

server.listen(Number(process.env.PORT), "127.0.0.1", () => {
    console.log(`fixture listening on ${process.env.PORT}`);
});

process.once("SIGTERM", () => {
    server.close(() => process.exit(0));
});
